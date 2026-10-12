import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, FormData } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { parseDescriptions } from '../worker/services/ai';
import { exchangeRate } from '../worker/services/exchange-rate';
import { generateSkus, nextSku } from '../worker/services/sku';
import type { ChatMessage } from '../shared/schemas';
import type { Quotation } from '../shared/quotations';
let mf: Miniflare;
let publicCatalogWorker: {
  fetch: (
    request: Request,
    env: unknown,
    ctx: unknown,
  ) => Promise<{
    status: number;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
  }>;
};
beforeAll(async () => {
  const result = await build({
    entryPoints: ['worker/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:workers'],
    define: { 'import.meta.env.DEV': 'true' },
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: result.outputFiles[0].text,
      compatibilityDate: '2026-10-09',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'test-db' },
      durableObjects: {
        CHAT_ROOM: { className: 'ChatRoom', useSQLite: true },
      },
      r2Buckets: ['PRODUCT_IMAGES'],
      serviceBindings: {
        ASSETS: async () =>
          new Response('<html>App</html>', {
            headers: { 'Content-Type': 'text/html' },
          }),
      },
      bindings: {
        ENVIRONMENT: 'development',
        LOCAL_MOCK_EMAIL: 'tester@example.test',
        ACCESS_TEAM_DOMAIN: '',
        ACCESS_AUD: '',
        ALLOWED_EMAILS: 'tester@example.test,second@example.test',
        AI_MODEL: '',
        AI_BASE_URL: '',
        MAX_UPLOAD_MB: '10',
        BUSINESS_TIMEZONE: 'Asia/Bangkok',
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  const migration = readdirSync('drizzle/migrations')
    .sort()
    .map((file) => readFileSync(`drizzle/migrations/${file}`, 'utf8'))
    .join('\n');
  await db.exec(migration.replace(/^--.*$/gm, '').replace(/\n/g, ' '));
  const publicBuild = await build({
    entryPoints: ['worker/public-catalog.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  const publicModule = (await import(
    `data:text/javascript;base64,${Buffer.from(publicBuild.outputFiles[0].text).toString('base64')}`
  )) as { default: typeof publicCatalogWorker };
  publicCatalogWorker =
    publicModule.default as unknown as typeof publicCatalogWorker;
});
afterAll(async () => {
  await mf?.dispose();
});
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return mf.dispatchFetch(`http://localhost/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function json<T>(response: Awaited<ReturnType<typeof request>>) {
  return (await response.json()) as T;
}
async function product(brand = 'Matrix') {
  const r = await request('/products', 'POST', {
    brand,
    model: 'Test model',
    purchaseCost: 100,
    sellingPrice: 150,
  });
  expect(r.status).toBe(201);
  return json<{ id: string; sku: string; status: string }>(r);
}
async function customer() {
  const r = await request('/customers', 'POST', { name: 'Test customer' });
  expect(r.status).toBe(201);
  return json<{ id: string }>(r);
}
describe('D1-backed inventory and sales', () => {
  it('keeps unpublished products private and exposes only approved public fields', async () => {
    const item = await product('Public boundary');
    const database = await mf.getD1Database('DB');
    await database
      .prepare("UPDATE products SET notes='confidential test note' WHERE id=?")
      .bind(item.id)
      .run();
    const bucket = await mf.getR2Bucket('PRODUCT_IMAGES');
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => void promise,
    } as ExecutionContext;
    const url = `http://catalog.test/catalog/products/${item.sku}`;
    const privateResponse = await publicCatalogWorker.fetch(
      new Request(url),
      { DB: database, PRODUCT_IMAGES: bucket },
      ctx,
    );
    expect(privateResponse.status).toBe(404);
    expect(await privateResponse.text()).toContain('Product unavailable');

    const publish = await request(`/products/${item.id}/publish`, 'POST', {
      showPrice: false,
      publicDescriptionEn: 'Reviewed public description',
    });
    expect(publish.status).toBe(200);
    const storedPublicProduct = await database
      .prepare('SELECT public_slug,is_published FROM products WHERE id=?')
      .bind(item.id)
      .first<{ public_slug: string; is_published: number }>();
    expect(storedPublicProduct?.is_published).toBe(1);
    const { product: productRow } = await json<{
      product: { publicSlug: string };
    }>(await request(`/products/${item.id}`));
    const publicResponse = await publicCatalogWorker.fetch(
      new Request(
        `http://catalog.test/api/public/products/${productRow.publicSlug}`,
      ),
      { DB: database, PRODUCT_IMAGES: bucket },
      ctx,
    );
    const payload = (await publicResponse.json()) as {
      product: Record<string, unknown>;
    };
    expect(payload).toMatchObject({ product: { slug: expect.any(String) } });
    expect(publicResponse.status).toBe(200);
    expect(payload.product).toMatchObject({
      slug: productRow.publicSlug,
      showPrice: false,
      description: 'Reviewed public description',
    });
    expect(payload.product).not.toHaveProperty('price');
    expect(payload.product).not.toHaveProperty('purchaseCost');
    expect(payload.product).not.toHaveProperty('notes');
    const publicList = await publicCatalogWorker.fetch(
      new Request('http://catalog.test/api/public/catalog'),
      { DB: database, PRODUCT_IMAGES: bucket },
      ctx,
    );
    const listPayload = (await publicList.json()) as {
      products: Array<{ slug: string; price?: number }>;
    };
    expect(listPayload.products.map((product) => product.slug)).toContain(
      productRow.publicSlug,
    );
    expect(
      listPayload.products.find(
        (product) => product.slug === productRow.publicSlug,
      ),
    ).toHaveProperty('price', null);

    const unpublish = await request(`/products/${item.id}/unpublish`, 'POST');
    expect(unpublish.status).toBe(200);
    const listAfterUnpublish = await publicCatalogWorker.fetch(
      new Request('http://catalog.test/api/public/catalog'),
      { DB: database, PRODUCT_IMAGES: bucket },
      ctx,
    );
    const hiddenList = (await listAfterUnpublish.json()) as {
      products: Array<{ slug: string }>;
    };
    expect(hiddenList.products.map((product) => product.slug)).not.toContain(
      productRow.publicSlug,
    );
    const hiddenAgain = await publicCatalogWorker.fetch(
      new Request(
        `http://catalog.test/api/public/products/${productRow.publicSlug}`,
      ),
      { DB: database, PRODUCT_IMAGES: bucket },
      ctx,
    );
    expect(hiddenAgain.status).toBe(404);
  });
  it('creates and duplicates CRM-linked catalogs with snapshot pricing, live availability, expiry, and share metadata', async () => {
    const item = await product('Catalog snapshot');
    const customerRecord = await customer();
    expect(
      (
        await request(`/products/${item.id}/publish`, 'POST', {
          showPrice: true,
          publicDescriptionEn: 'Public item description',
        })
      ).status,
    ).toBe(200);
    const { product: published } = await json<{
      product: { publicSlug: string };
    }>(await request(`/products/${item.id}`));
    const database = await mf.getD1Database('DB');
    const bucket = await mf.getR2Bucket('PRODUCT_IMAGES');
    const imageKey = `test-catalog/${item.id}.jpg`;
    await bucket.put(imageKey, new Uint8Array([255, 216, 255, 217]), {
      httpMetadata: { contentType: 'image/jpeg' },
    });
    await database
      .prepare(
        'INSERT INTO product_images(id,product_id,r2_key,file_name,mime_type,file_size,sort_order,is_primary,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        crypto.randomUUID(),
        item.id,
        imageKey,
        'sample.jpg',
        'image/jpeg',
        4,
        0,
        1,
        new Date().toISOString(),
      )
      .run();
    const created = await request('/catalogs', 'POST', {
      title: 'Snapshot collection',
      description: 'Selected products for a customer',
      customerId: customerRecord.id,
      showPrices: true,
      showSold: false,
      expiresAt: '2099-12-31T23:59:59.999Z',
      items: [
        {
          productId: item.id,
          displayPrice: 12345,
          description: 'Catalog-specific snapshot copy',
        },
      ],
    });
    expect(created.status).toBe(201);
    const catalog = await json<{ id: string; slug: string }>(created);
    const sharedCatalogs = await json<{
      catalogs: Array<{ id: string; slug: string }>;
      publicBaseUrl: string;
    }>(await request(`/customers/${customerRecord.id}/catalogs`));
    expect(sharedCatalogs.catalogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: catalog.id, slug: catalog.slug }),
      ]),
    );
    await database
      .prepare(
        "UPDATE products SET brand='Renamed brand',model='Renamed model' WHERE id=?",
      )
      .bind(item.id)
      .run();
    const editedCatalog = await request(`/catalogs/${catalog.id}`, 'PATCH', {
      title: 'Snapshot collection revised',
      description: 'Selected products for a customer',
      customerId: customerRecord.id,
      showPrices: true,
      showSold: false,
      expiresAt: '2099-12-31T23:59:59.999Z',
      items: [{ productId: item.id }],
    });
    expect(editedCatalog.status).toBe(200);
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => void promise,
    } as ExecutionContext;
    const fetchPublic = (path: string) =>
      publicCatalogWorker.fetch(
        new Request(`http://catalog.test${path}`),
        { DB: database, PRODUCT_IMAGES: bucket },
        ctx,
      );
    const publicApi = await fetchPublic(`/api/public/catalogs/${catalog.slug}`);
    const publicData = (await publicApi.json()) as {
      products: Array<Record<string, unknown>>;
    };
    expect(publicApi.status).toBe(200);
    expect(publicData.products[0]).toMatchObject({
      slug: published.publicSlug,
      brand: 'Catalog snapshot',
      model: 'Test model',
      description: 'Catalog-specific snapshot copy',
      price: 12345,
      availability: 'AVAILABLE',
    });
    expect(publicData.products[0]).not.toHaveProperty('productId');
    expect(publicData.products[0]).not.toHaveProperty('purchaseCost');

    const html = await fetchPublic(`/s/${catalog.slug}`);
    const htmlText = await html.text();
    expect(htmlText).toContain('property="og:title"');
    expect(htmlText).toContain('property="og:description"');
    expect(htmlText).toContain('property="og:image"');
    expect(htmlText).toContain('/media/catalogs/');

    const duplicated = await request(
      `/catalogs/${catalog.id}/duplicate`,
      'POST',
    );
    expect(duplicated.status).toBe(201);
    const duplicate = await json<{ slug: string }>(duplicated);
    const duplicatedApi = await fetchPublic(
      `/api/public/catalogs/${duplicate.slug}`,
    );
    const duplicatedData = (await duplicatedApi.json()) as {
      products: Array<Record<string, unknown>>;
    };
    expect(duplicatedData.products[0]).toMatchObject({ price: 12345 });

    await database
      .prepare("UPDATE products SET status='NOT_AVAILABLE' WHERE id=?")
      .bind(item.id)
      .run();
    const updatedAvailability = await fetchPublic(
      `/api/public/catalogs/${catalog.slug}`,
    );
    const updatedData = (await updatedAvailability.json()) as {
      products: Array<Record<string, unknown>>;
    };
    expect(updatedData.products[0].availability).toBe('NOT_AVAILABLE');

    await database
      .prepare("UPDATE products SET status='SOLD' WHERE id=?")
      .bind(item.id)
      .run();
    const soldProduct = await fetchPublic(
      `/api/public/products/${published.publicSlug}`,
    );
    expect(soldProduct.status).toBe(404);
    const hiddenSold = await fetchPublic(
      `/api/public/catalogs/${catalog.slug}`,
    );
    const hiddenSoldData = (await hiddenSold.json()) as {
      products: Array<Record<string, unknown>>;
    };
    expect(hiddenSoldData.products).toHaveLength(0);

    await database
      .prepare(
        "UPDATE catalogs SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      )
      .bind(catalog.id)
      .run();
    const expired = await fetchPublic(`/s/${catalog.slug}`);
    expect(expired.status).toBe(404);
  });
  it('refreshes BOT FX after publication and retains valid rates on source failure', async () => {
    const db = await mf.getD1Database('DB');
    let calls = 0;
    const fetcher: typeof fetch = async (url, options) => {
      expect(String(url)).toContain(
        'gateway.api.bot.or.th/Stat-ReferenceRate/v2/DAILY_REF_RATE/',
      );
      expect(new Headers(options?.headers).get('Authorization')).toBe(
        'test-key',
      );
      calls++;
      return new Response(
        JSON.stringify({
          result: {
            data: {
              data_detail: [
                { period: '2026-10-09', rate: '34.9' },
                { period: '2026-10-10', rate: '35.0000' },
              ],
            },
          },
        }),
      );
    };
    const first = await exchangeRate(
      db,
      fetcher,
      new Date('2026-10-10T16:00:00Z'),
      'test-key',
    );
    expect(first.rate).toBe(35);
    expect(3500 / first.rate!).toBe(100);
    expect(first.source).toBe('BOT');
    await exchangeRate(
      db,
      fetcher,
      new Date('2026-10-11T11:14:00Z'),
      'test-key',
    );
    expect(calls).toBe(1);
    const failed: typeof fetch = async () => {
      calls++;
      return new Response('{}', { status: 503 });
    };
    const fallback = await exchangeRate(
      db,
      failed,
      new Date('2026-10-11T11:15:00Z'),
      'test-key',
    );
    expect(fallback).toMatchObject({
      rate: 35,
      stale: true,
      date: '2026-10-10',
    });
    await exchangeRate(
      db,
      failed,
      new Date('2026-10-11T11:16:00Z'),
      'test-key',
    );
    expect(calls).toBe(2);
    const invalid: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          result: {
            data: { data_detail: [{ period: '2026-10-11', rate: '0' }] },
          },
        }),
      );
    expect(
      (
        await exchangeRate(
          db,
          invalid,
          new Date('2026-10-11T12:00:00Z'),
          'test-key',
        )
      ).rate,
    ).toBe(35);
  });
  it('keeps the old source label until BOT succeeds and accepts the latest published holiday rate', async () => {
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        "DELETE FROM settings WHERE key IN ('fx_usd_thb','fx_refresh_lock')",
      )
      .run();
    await db
      .prepare("INSERT INTO settings(key,value) VALUES('fx_usd_thb',?)")
      .bind(
        JSON.stringify({
          base: 'USD',
          quote: 'THB',
          rate: 33.589,
          date: '2026-10-10',
          checkedAt: '2026-10-11T03:00:00Z',
        }),
      )
      .run();
    const unused: typeof fetch = async () => {
      throw new Error('Must not fetch without a key');
    };
    expect(
      await exchangeRate(db, unused, new Date('2026-10-11T04:00:00Z')),
    ).toMatchObject({ source: 'Frankfurter', rate: 33.589, stale: true });
    const empty: typeof fetch = async () =>
      new Response(JSON.stringify({ result: { data: { data_detail: [] } } }));
    expect(
      await exchangeRate(
        db,
        empty,
        new Date('2026-10-11T04:00:00Z'),
        'test-key',
      ),
    ).toMatchObject({ source: 'Frankfurter', rate: 33.589, stale: true });
    const published: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          result: {
            data: { data_detail: [{ period: '2026-10-09', rate: '33.1' }] },
          },
        }),
      );
    expect(
      await exchangeRate(
        db,
        published,
        new Date('2026-10-11T04:31:00Z'),
        'test-key',
      ),
    ).toMatchObject({
      source: 'BOT',
      rate: 33.1,
      date: '2026-10-09',
      stale: false,
    });
  });
  it('serves bound static assets with security headers', async () => {
    const response = await mf.dispatchFetch('http://localhost/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html>App</html>');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('creates, reads, searches, updates and archives equipment', async () => {
    const p = await product('Cybex');
    expect(p.sku).toMatch(/^\d{6}\d{3,}$/);
    expect((await request(`/products/${p.id}`)).status).toBe(200);
    const found = await json<{ id: string }[]>(
      await request('/products?q=Cybex'),
    );
    expect(found.some((v) => v.id === p.id)).toBe(true);
    expect(
      (await request(`/products/${p.id}`, 'PATCH', { sellingPrice: 180 }))
        .status,
    ).toBe(200);
    expect((await request(`/products/${p.id}`, 'DELETE')).status).toBe(200);
    expect((await request(`/products/${p.id}`)).status).toBe(404);
  });
  it('manages brand and category choices independently of conditions', async () => {
    const p = await product('Legacy Brand');
    const initial = await json<{
      brands: string[];
      categories: string[];
      conditions: string[];
    }>(await request('/settings'));
    expect(initial.brands).toContain('Legacy Brand');
    expect(initial.categories).toContain('Treadmills');
    expect(
      (
        await request('/settings', 'PATCH', {
          brands: [' Brand A ', 'Brand B'],
        })
      ).status,
    ).toBe(200);
    const updated = await json<{ brands: string[]; conditions: string[] }>(
      await request('/settings'),
    );
    expect(updated.brands).toEqual(['Brand A', 'Brand B']);
    expect(updated.conditions).toEqual(initial.conditions);
    expect(
      (
        await request('/settings', 'PATCH', {
          categories: ['Custom Category', 'Accessories'],
        })
      ).status,
    ).toBe(200);
    const withCategories = await json<{ categories: string[] }>(
      await request('/settings'),
    );
    expect(withCategories.categories).toEqual([
      'Custom Category',
      'Accessories',
    ]);
    expect(
      (
        await request('/settings', 'PATCH', {
          categories: ['Custom Category', 'custom category'],
        })
      ).status,
    ).toBe(422);
    expect(
      (await request('/settings', 'PATCH', { brands: ['Brand A', 'brand a'] }))
        .status,
    ).toBe(422);
    expect(
      (await request('/settings', 'PATCH', { conditions: initial.conditions }))
        .status,
    ).toBe(200);
    expect(
      (await json<{ brands: string[] }>(await request('/settings'))).brands,
    ).toEqual(updated.brands);
    expect(
      (
        await json<{ product: { brand: string } }>(
          await request(`/products/${p.id}`),
        )
      ).product.brand,
    ).toBe('Legacy Brand');
    expect((await request('/settings', 'PATCH', { brands: [] })).status).toBe(
      200,
    );
    expect(
      (await json<{ brands: string[] }>(await request('/settings'))).brands,
    ).toEqual([]);
    expect(
      (
        await request('/settings', 'PATCH', {
          categories: initial.categories,
        })
      ).status,
    ).toBe(200);
  });
  it('allocates annual SKU sequences atomically with Bangkok month and year boundaries', async () => {
    const db = await mf.getD1Database('DB');
    const january = new Date('2090-01-01T00:00:00Z');
    expect(await nextSku(db, january)).toBe('209001001');
    expect(await nextSku(db, january)).toBe('209001001');
    const batches = await Promise.all([
      generateSkus(db, 2, january),
      generateSkus(db, 2, january),
    ]);
    expect(batches.flat().sort()).toEqual([
      '209001001',
      '209001002',
      '209001003',
      '209001004',
    ]);
    expect(await generateSkus(db, 1, new Date('2090-01-31T17:00:00Z'))).toEqual(
      ['209002005'],
    );
    expect(await generateSkus(db, 1, new Date('2090-12-31T16:59:59Z'))).toEqual(
      ['209012006'],
    );
    expect(await generateSkus(db, 1, new Date('2090-12-31T17:00:00Z'))).toEqual(
      ['209101001'],
    );
    await db
      .prepare('UPDATE sku_sequences SET value=999 WHERE year=2091')
      .run();
    expect(await generateSkus(db, 1, new Date('2091-02-01T00:00:00Z'))).toEqual(
      ['2091021000'],
    );
    const before = await db
      .prepare('SELECT value FROM sku_sequences WHERE year=2091')
      .first();
    expect(await generateSkus(db, 0, new Date('2091-02-01T00:00:00Z'))).toEqual(
      [],
    );
    expect(
      await db
        .prepare('SELECT value FROM sku_sequences WHERE year=2091')
        .first(),
    ).toEqual(before);
  });
  it('uses the latest stored product SKU when previewing and allocating a new one', async () => {
    const db = await mf.getD1Database('DB');
    const clock = new Date('2092-03-15T00:00:00Z');
    await db
      .prepare(
        "INSERT INTO products(id,sku,brand,model,created_at,updated_at) VALUES('legacy-sku-2092','209202087','Legacy','Imported',?,?)",
      )
      .bind(clock.toISOString(), clock.toISOString())
      .run();
    expect(await nextSku(db, clock)).toBe('209203088');
    expect(await generateSkus(db, 1, clock)).toEqual(['209203088']);
    expect(await nextSku(db, clock)).toBe('209203089');
  });
  it('rejects invalid Excel imports before changing inventory', async () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob(['not an Excel workbook'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'products.xlsx',
    );
    const response = await mf.dispatchFetch(
      'http://localhost/api/products/import',
      { method: 'POST', body: form },
    );
    expect(response.status).toBe(422);
  });
  it('imports the downloadable template and rejects invalid categories atomically with Excel row numbers', async () => {
    const db = await mf.getD1Database('DB');
    const count = () =>
      db.prepare('SELECT COUNT(*) AS n FROM products').first<{ n: number }>();
    const upload = async (path: string) => {
      const form = new FormData();
      form.append('file', new Blob([readFileSync(path)]), 'products.xlsx');
      return mf.dispatchFetch('http://localhost/api/products/import', {
        method: 'POST',
        body: form,
      });
    };
    const before = (await count())!.n;
    const invalid = await upload('tests/fixtures/invalid-category.xlsx');
    expect(invalid.status).toBe(422);
    expect(await invalid.text()).toContain('Row 5: Category');
    expect((await count())!.n).toBe(before);
    const valid = await upload(
      'public/downloads/Corevity-Product-Import-Example.xlsx',
    );
    expect(valid.status).toBe(201);
    expect(await valid.json()).toMatchObject({ created: 3 });
    expect((await count())!.n).toBe(before + 3);
    const saved = await db
      .prepare(
        "SELECT category FROM products WHERE brand='Example Brand' ORDER BY model",
      )
      .all<{ category: string }>();
    expect(saved.results.map((row) => row.category)).toEqual([
      'Upright Bike',
      'Rowwing',
      'Treadmills',
    ]);
  });
  it('deletes customers without history and protects customer history', async () => {
    const removable = await customer();
    expect((await request(`/customers/${removable.id}`, 'DELETE')).status).toBe(
      204,
    );
    expect((await request(`/customers/${removable.id}`)).status).toBe(404);
    const retained = await customer();
    const lead = await json<{ id: string }>(
      await request('/leads', 'POST', {
        customerId: retained.id,
        title: 'Remove this lead first',
      }),
    );
    expect((await request(`/customers/${retained.id}`, 'DELETE')).status).toBe(
      409,
    );
    expect((await request(`/leads/${lead.id}`, 'DELETE')).status).toBe(204);
    expect((await request(`/customers/${retained.id}`, 'DELETE')).status).toBe(
      204,
    );
  });
  it('deletes leads safely and protects reservations and closed sale history', async () => {
    const customerWithReservation = await customer();
    const reservedProduct = await product();
    const reservedLead = await json<{ id: string }>(
      await request('/leads', 'POST', {
        customerId: customerWithReservation.id,
        title: 'Reserved lead',
        productIds: [reservedProduct.id],
      }),
    );
    await request(`/products/${reservedProduct.id}/reserve`, 'POST', {
      customerId: customerWithReservation.id,
      leadId: reservedLead.id,
    });
    expect((await request(`/leads/${reservedLead.id}`, 'DELETE')).status).toBe(
      409,
    );
    await request(
      `/products/${reservedProduct.id}/release-reservation`,
      'POST',
    );
    expect((await request(`/leads/${reservedLead.id}`, 'DELETE')).status).toBe(
      204,
    );
    expect(
      (await request(`/customers/${customerWithReservation.id}`, 'DELETE'))
        .status,
    ).toBe(204);

    const soldProduct = await product();
    const soldCustomer = await customer();
    const soldLead = await json<{ id: string }>(
      await request('/leads', 'POST', {
        customerId: soldCustomer.id,
        title: 'Closed lead',
        productIds: [soldProduct.id],
      }),
    );
    expect(
      (
        await request(`/leads/${soldLead.id}/win`, 'POST', {
          productIds: [soldProduct.id],
        })
      ).status,
    ).toBe(200);
    expect((await request(`/leads/${soldLead.id}`, 'DELETE')).status).toBe(409);
  });
  it('partial updates preserve omitted fields and linked products', async () => {
    const p = await product(),
      c = await customer();
    await request(`/products/${p.id}`, 'PATCH', { notes: 'Changed' });
    const detail = await json<{
      product: { purchaseCost: number; sellingPrice: number };
    }>(await request(`/products/${p.id}`));
    expect(detail.product.purchaseCost).toBe(100);
    expect(detail.product.sellingPrice).toBe(150);
    const l = await json<{ id: string }>(
      await request('/leads', 'POST', {
        customerId: c.id,
        title: 'Keep linked items',
        status: 'QUOTED',
        productIds: [p.id],
        estimatedValue: 150,
      }),
    );
    await request(`/leads/${l.id}`, 'PATCH', { notes: 'Updated' });
    const updated = await json<{
      lead: { status: string; estimatedValue: number; productIds: string[] };
    }>(await request(`/leads/${l.id}`));
    expect(updated.lead.status).toBe('QUOTED');
    expect(updated.lead.estimatedValue).toBe(150);
    expect(updated.lead.productIds).toEqual([p.id]);
  });
  it('stores only valid AI ratings from zero to ten', async () => {
    const p = await product();
    const initial = await json<{
      product: { priceRating: number | null };
    }>(await request(`/products/${p.id}`));
    expect(initial.product.priceRating).toBeNull();
    const saved = await json<{
      priceRating: number;
      designRating: number;
      qualityPerformanceRating: number;
      strengths: string[];
      weaknesses: string[];
    }>(
      await request(`/products/${p.id}`, 'PATCH', {
        priceRating: 8.5,
        designRating: 7,
        qualityPerformanceRating: 9.25,
        strengths: ['แบรนด์เป็นที่รู้จัก'],
        weaknesses: ['ยังไม่มีข้อมูลการรับประกัน'],
      }),
    );
    expect(saved).toMatchObject({
      priceRating: 8.5,
      designRating: 7,
      qualityPerformanceRating: 9.25,
      strengths: ['แบรนด์เป็นที่รู้จัก'],
      weaknesses: ['ยังไม่มีข้อมูลการรับประกัน'],
    });
    expect(
      (await request(`/products/${p.id}`, 'PATCH', { priceRating: 10.1 }))
        .status,
    ).toBe(422);
  });
  it('rejects a sale reserved for another customer and rolls the whole win back', async () => {
    const a = await product(),
      b = await product(),
      c = await customer(),
      other = await customer();
    await request(`/products/${b.id}/reserve`, 'POST', {
      customerId: other.id,
    });
    const l = await json<{ id: string }>(
      await request('/leads', 'POST', {
        customerId: c.id,
        title: 'Conflicting sale',
        productIds: [a.id, b.id],
      }),
    );
    expect(
      (
        await request(`/leads/${l.id}/win`, 'POST', {
          productIds: [a.id, b.id],
        })
      ).status,
    ).toBe(409);
    const detail = await json<{ product: { status: string } }>(
      await request(`/products/${a.id}`),
    );
    expect(detail.product.status).toBe('AVAILABLE');
    const lead = await json<{ lead: { status: string } }>(
      await request(`/leads/${l.id}`),
    );
    expect(lead.lead.status).toBe('NEW');
  });
  it('prevents two leads from selling the same equipment', async () => {
    const p = await product(),
      c = await customer();
    const make = () =>
      request('/leads', 'POST', {
        customerId: c.id,
        title: 'Exclusive sale',
        productIds: [p.id],
      });
    const a = await json<{ id: string }>(await make()),
      b = await json<{ id: string }>(await make());
    const results = await Promise.all([
      request(`/leads/${a.id}/win`, 'POST', { productIds: [p.id] }),
      request(`/leads/${b.id}/win`, 'POST', { productIds: [p.id] }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it('rejects invalid prices, status and customer email', async () => {
    expect(
      (
        await request('/products', 'POST', {
          brand: 'A',
          model: 'B',
          purchaseCost: -1,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request('/products', 'POST', {
          brand: 'A',
          model: 'B',
          status: 'BROKEN',
        })
      ).status,
    ).toBe(422);
    expect(
      (await request('/customers', 'POST', { name: 'A', email: 'bad' })).status,
    ).toBe(422);
  });
  it('reserves once, rejects conflicting reservations and releases atomically', async () => {
    const p = await product(),
      c = await customer();
    const results = await Promise.all([
      request(`/products/${p.id}/reserve`, 'POST', { customerId: c.id }),
      request(`/products/${p.id}/reserve`, 'POST', { customerId: c.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const detail = await json<{
      product: { status: string };
      reservation: { customerId: string };
    }>(await request(`/products/${p.id}`));
    expect(detail.product.status).toBe('RESERVED');
    expect(detail.reservation.customerId).toBe(c.id);
    expect(
      (await request(`/products/${p.id}`, 'PATCH', { status: 'AVAILABLE' }))
        .status,
    ).toBe(422);
    expect(
      (await request(`/products/${p.id}/release-reservation`, 'POST')).status,
    ).toBe(200);
    const released = await json<{
      product: { status: string };
      reservation: null;
    }>(await request(`/products/${p.id}`));
    expect(released.product.status).toBe('AVAILABLE');
    expect(released.reservation).toBeNull();
  });
  it('marks only selected attached products sold when winning a lead', async () => {
    const a = await product(),
      b = await product(),
      c = await customer();
    const l = await json<{ id: string }>(
      await request('/leads', 'POST', {
        customerId: c.id,
        title: 'Two machines',
        productIds: [a.id, b.id],
      }),
    );
    expect(
      (await request(`/leads/${l.id}`, 'PATCH', { status: 'QUOTED' })).status,
    ).toBe(200);
    expect(
      (await request(`/leads/${l.id}`, 'PATCH', { status: 'WON' })).status,
    ).toBe(422);
    expect(
      (
        await request(`/products/${a.id}/reserve`, 'POST', {
          customerId: c.id,
          leadId: l.id,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`/leads/${l.id}/win`, 'POST', { productIds: [a.id] }))
        .status,
    ).toBe(200);
    const sold = await json<{ product: { status: string }; reservation: null }>(
      await request(`/products/${a.id}`),
    );
    expect(sold.product.status).toBe('SOLD');
    expect(sold.reservation).toBeNull();
    const unsold = await json<{ product: { status: string } }>(
      await request(`/products/${b.id}`),
    );
    expect(unsold.product.status).toBe('AVAILABLE');
    expect(
      (await request(`/leads/${l.id}/win`, 'POST', { productIds: [b.id] }))
        .status,
    ).toBe(409);
  });
  it('cannot sell an unrelated product through a lead', async () => {
    const p = await product(),
      c = await customer();
    const l = await json<{ id: string }>(
      await request('/leads', 'POST', {
        customerId: c.id,
        title: 'Empty lead',
      }),
    );
    expect(
      (await request(`/leads/${l.id}/win`, 'POST', { productIds: [p.id] }))
        .status,
    ).toBe(422);
  });
  it('sold equipment retains its sale timestamp and cannot be reserved', async () => {
    const p = await product(),
      c = await customer();
    expect((await request(`/products/${p.id}/mark-sold`, 'POST')).status).toBe(
      200,
    );
    const first = await json<{ soldAt: string }>(
      await request(`/products/${p.id}/mark-sold`, 'POST'),
    );
    const second = await json<{ soldAt: string }>(
      await request(`/products/${p.id}/mark-sold`, 'POST'),
    );
    expect(first.soldAt).toBe(second.soldAt);
    expect(
      (await request(`/products/${p.id}/reserve`, 'POST', { customerId: c.id }))
        .status,
    ).toBe(409);
  });
  it('excludes unavailable stock, permits availability edits and protects reserved and sold statuses', async () => {
    const p = await product(),
      c = await customer();
    const dashboard = async () =>
      json<{ inventoryCostValue: number }>(await request('/dashboard'));
    const before = await dashboard();
    expect(
      (await request(`/products/${p.id}`, 'PATCH', { status: 'NOT_AVAILABLE' }))
        .status,
    ).toBe(200);
    expect((await dashboard()).inventoryCostValue).toBe(
      before.inventoryCostValue - 100,
    );
    const list = await json<{ status: string }[]>(
      await request('/products?status=NOT_AVAILABLE'),
    );
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((item) => item.status === 'NOT_AVAILABLE')).toBe(true);
    expect(
      (await request(`/products/${p.id}/reserve`, 'POST', { customerId: c.id }))
        .status,
    ).toBe(409);
    expect((await request(`/products/${p.id}/mark-sold`, 'POST')).status).toBe(
      409,
    );
    expect(
      (await request(`/products/${p.id}`, 'PATCH', { status: 'AVAILABLE' }))
        .status,
    ).toBe(200);
    expect((await dashboard()).inventoryCostValue).toBe(
      before.inventoryCostValue,
    );
    expect(
      (await request(`/products/${p.id}/reserve`, 'POST', { customerId: c.id }))
        .status,
    ).toBe(200);
    expect(
      (await request(`/products/${p.id}`, 'PATCH', { status: 'NOT_AVAILABLE' }))
        .status,
    ).toBe(422);
    await request(`/products/${p.id}/mark-sold`, 'POST');
    expect(
      (await request(`/products/${p.id}`, 'PATCH', { status: 'AVAILABLE' }))
        .status,
    ).toBe(422);
    expect(
      (await request(`/products/${p.id}`, 'PATCH', { status: 'NOT_AVAILABLE' }))
        .status,
    ).toBe(422);
    expect((await dashboard()).inventoryCostValue).toBe(
      before.inventoryCostValue - 100,
    );
    const created = await request('/products', 'POST', {
      brand: 'Test',
      model: 'Unavailable',
      status: 'NOT_AVAILABLE',
      purchaseCost: 500,
      sellingPrice: 700,
    });
    expect(created.status).toBe(201);
    expect((await dashboard()).inventoryCostValue).toBe(
      before.inventoryCostValue - 100,
    );
  });
  it('dashboard computes current inventory costs excluding sold and archived items', async () => {
    const before = await json<{
      inventoryCostValue: number;
      available: number;
      soldThisMonth: number;
    }>(await request('/dashboard'));
    const p = await product();
    const after = await json<typeof before>(await request('/dashboard'));
    expect(after.inventoryCostValue).toBe(before.inventoryCostValue + 100);
    expect(after.available).toBe(before.available + 1);
    await request(`/products/${p.id}/mark-sold`, 'POST');
    const sold = await json<typeof before>(await request('/dashboard'));
    expect(sold.inventoryCostValue).toBe(before.inventoryCostValue);
    expect(sold.soldThisMonth).toBe(before.soldThisMonth + 1);
  });
  it('includes the primary photo id for recent products on the dashboard', async () => {
    const item = await product('Dashboard photo');
    const db = await mf.getD1Database('DB');
    const imageId = crypto.randomUUID();
    await db
      .prepare(
        'INSERT INTO product_images(id,product_id,r2_key,file_name,mime_type,file_size,sort_order,is_primary,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        imageId,
        item.id,
        `products/${item.id}/thumb.jpg`,
        'thumb.jpg',
        'image/jpeg',
        128,
        0,
        1,
        new Date().toISOString(),
      )
      .run();
    const dashboard = await json<{
      recentProducts: { id: string; primaryImageId: string | null }[];
    }>(await request('/dashboard'));
    expect(
      dashboard.recentProducts.find((recent) => recent.id === item.id)
        ?.primaryImageId,
    ).toBe(imageId);
  });
  it('groups due follow-ups and clears contacted tasks without downgrading a quoted lead', async () => {
    const c = await customer();
    const l = await json<{ id: string }>(
      await request('/leads', 'POST', {
        customerId: c.id,
        title: 'Call',
        status: 'QUOTED',
        nextFollowUpAt: new Date(Date.now() - 86400000).toISOString(),
      }),
    );
    const due = await json<{ overdue: { id: string }[] }>(
      await request('/followups'),
    );
    expect(due.overdue.some((v) => v.id === l.id)).toBe(true);
    await request(`/leads/${l.id}`, 'PATCH', {
      lastContactAt: new Date().toISOString(),
      nextFollowUpAt: null,
    });
    const updated = await json<{
      lead: { status: string; nextFollowUpAt: null };
    }>(await request(`/leads/${l.id}`));
    expect(updated.lead.status).toBe('QUOTED');
    expect(updated.lead.nextFollowUpAt).toBeNull();
  });
  it('rejects cross-origin writes and identity headers outside localhost', async () => {
    expect(
      (
        await request(
          '/products',
          'POST',
          { brand: 'A', model: 'B' },
          { Origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    const denied = await mf.dispatchFetch(
      'https://production.example/api/products',
      {
        headers: {
          'Cf-Access-Authenticated-User-Email': 'tester@example.test',
        },
      },
    );
    expect(denied.status).toBe(503);
  });
  it('returns a safe AI configuration error without changing descriptions', async () => {
    const p = await product();
    const r = await request(`/products/${p.id}/generate-description`, 'POST', {
      target: 'all',
    });
    expect(r.status).toBe(503);
    const detail = await json<{ product: { descriptionEn: string } }>(
      await request(`/products/${p.id}`),
    );
    expect(detail.product.descriptionEn).toBe('');
  });
  it('uploads to R2, serves an authenticated image and deletes it', async () => {
    const p = await product();
    const form = new FormData();
    form.append(
      'files',
      new Blob(
        [
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
            'base64',
          ),
        ],
        { type: 'image/png' },
      ),
      'photo.png',
    );
    const result = await mf.dispatchFetch(
      `http://localhost/api/products/${p.id}/images`,
      { method: 'POST', body: form },
    );
    expect(result.status).toBe(201);
    const images = await json<{ id: string; r2Key: string }[]>(result);
    const object = await (
      await mf.getR2Bucket('PRODUCT_IMAGES')
    ).get(images[0].r2Key);
    expect(object).not.toBeNull();
    const served = await request(`/images/${images[0].id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('Content-Type')).toBe('image/png');
    expect(
      (await request(`/products/${p.id}/images/${images[0].id}`, 'DELETE'))
        .status,
    ).toBe(200);
    expect(
      await (await mf.getR2Bucket('PRODUCT_IMAGES')).get(images[0].r2Key),
    ).toBeNull();
  });
  it('rejects files whose bytes do not match their declared type', async () => {
    const p = await product();
    const form = new FormData();
    form.append(
      'files',
      new Blob(['not an image'], { type: 'image/png' }),
      'bad.png',
    );
    const r = await mf.dispatchFetch(
      `http://localhost/api/products/${p.id}/images`,
      { method: 'POST', body: form },
    );
    expect(r.status).toBe(422);
  });
});

describe('quotation workflow', () => {
  it('protects quotation endpoints with Cloudflare Access authentication', async () => {
    expect(
      (await mf.dispatchFetch('https://example.test/api/quotations')).status,
    ).toBe(503);
    expect(
      (await mf.dispatchFetch('https://example.test/api/quotation-settings'))
        .status,
    ).toBe(503);
  });

  async function makeQuotation(customerId: string, productId: string) {
    const response = await request('/quotations', 'POST', {
      customerId,
      issueDate: '2026-10-12',
      validUntil: '2026-11-11',
      currency: 'THB',
      items: [
        {
          productId,
          imageId: null,
          displayName: 'Saved product name',
          description: 'A snapshot description',
          quantity: 2,
          unitPrice: 1000,
          discount: 100,
        },
      ],
      discount: 50,
      deliveryFee: 100,
      installationFee: 10,
      otherCharges: 0,
      vatEnabled: true,
      vatRate: 7,
      taxMode: 'EXCLUSIVE',
      paymentTerms: '50% deposit',
      deliveryTerms: '',
      warrantyTerms: '',
      notes: '',
    });
    return response;
  }

  it('creates a numbered quote with correct totals and immutable customer/product snapshots', async () => {
    const customerRecord = await customer();
    const equipment = await product('Snapshot Brand');
    const response = await makeQuotation(customerRecord.id, equipment.id);
    expect(response.status).toBe(201);
    const quote = await json<Quotation>(response);
    expect(quote.quotationNumber).toMatch(/^QT-2026-\d{4}$/);
    expect(quote.status).toBe('DRAFT');
    expect(quote.subtotal).toBe(1900);
    expect(quote.beforeTax).toBe(1960);
    expect(quote.vatAmount).toBe(137.2);
    expect(quote.grandTotal).toBe(2097.2);
    expect(quote.items[0].productName).toBe('Saved product name');
    expect(quote.items[0].brand).toBe('Snapshot Brand');

    const db = await mf.getD1Database('DB');
    await db
      .prepare('UPDATE customers SET name=? WHERE id=?')
      .bind('Changed customer', customerRecord.id)
      .run();
    await db
      .prepare('UPDATE products SET brand=?,model=? WHERE id=?')
      .bind('Changed brand', 'Changed model', equipment.id)
      .run();
    const saved = await json<Quotation>(
      await request(`/quotations/${quote.id}`),
    );
    expect(saved.customer.name).toBe('Test customer');
    expect(saved.items[0].brand).toBe('Snapshot Brand');
    expect(saved.history.map((entry) => entry.toStatus)).toEqual(['DRAFT']);
  });

  it('locks sent quotes, records status history and duplicates into a new draft number', async () => {
    const customerRecord = await customer();
    const equipment = await product('Status Brand');
    const quote = await json<Quotation>(
      await makeQuotation(customerRecord.id, equipment.id),
    );
    expect(
      (
        await request(`/quotations/${quote.id}/status`, 'POST', {
          status: 'SENT',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/quotations/${quote.id}`, 'PATCH', {
          customerId: customerRecord.id,
          issueDate: '2026-10-12',
          validUntil: '2026-11-11',
          currency: 'THB',
          items: [
            {
              productId: equipment.id,
              imageId: null,
              displayName: 'No edit',
              description: '',
              quantity: 1,
              unitPrice: 1,
              discount: 0,
            },
          ],
          discount: 0,
          deliveryFee: 0,
          installationFee: 0,
          otherCharges: 0,
          vatEnabled: false,
          vatRate: 7,
          taxMode: 'EXCLUSIVE',
          paymentTerms: '',
          deliveryTerms: '',
          warrantyTerms: '',
          notes: '',
        })
      ).status,
    ).toBe(409);
    const copyResponse = await request(
      `/quotations/${quote.id}/duplicate`,
      'POST',
    );
    expect(copyResponse.status).toBe(201);
    const copy = await json<Quotation>(copyResponse);
    expect(copy.id).not.toBe(quote.id);
    expect(copy.quotationNumber).not.toBe(quote.quotationNumber);
    expect(copy.status).toBe('DRAFT');
    expect(copy.grandTotal).toBe(quote.grandTotal);
    expect(copy.history.map((entry) => entry.toStatus)).toEqual(['DRAFT']);
  });

  it('reserves unique sequential numbers when quotes are created concurrently', async () => {
    const customerRecord = await customer();
    const equipment = await product('Concurrent Brand');
    const [first, second] = await Promise.all([
      makeQuotation(customerRecord.id, equipment.id),
      makeQuotation(customerRecord.id, equipment.id),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const [a, b] = await Promise.all([
      json<Quotation>(first),
      json<Quotation>(second),
    ]);
    expect(a.quotationNumber).not.toBe(b.quotationNumber);
  });
});
describe('AI response validation', () => {
  const valid = {
    descriptionTh: 'อุปกรณ์ฟิตเนส',
    descriptionEn: 'Fitness equipment',
    shortDescription: 'Used equipment',
    facebookCaption: 'อุปกรณ์พร้อมขาย',
    priceRating: 8.5,
    designRating: 7,
    qualityPerformanceRating: 9,
    features: ['ปรับระดับแรงต้านได้'],
    strengths: ['แบรนด์เป็นที่รู้จัก'],
    weaknesses: ['ยังไม่มีข้อมูลการรับประกัน'],
    analysisSources: [
      { title: 'Manufacturer manual', url: 'https://example.com/manual' },
    ],
    ratingReasons: {
      price: 'มีราคาอ้างอิงจากแหล่งข้อมูล',
      design: 'มีข้อมูลการออกแบบจากคู่มือ',
      qualityPerformance: 'มีข้อมูลสมรรถนะจากคู่มือ',
    },
  };
  it('accepts valid structured JSON and fenced JSON', () => {
    expect(parseDescriptions(JSON.stringify(valid))).toEqual(valid);
    expect(
      parseDescriptions('```json\n' + JSON.stringify(valid) + '\n```'),
    ).toEqual(valid);
  });
  it('rejects incomplete, malformed and extra-field responses', () => {
    expect(() => parseDescriptions('{bad')).toThrow();
    expect(() =>
      parseDescriptions('{"descriptionEn":"Only English"}'),
    ).toThrow();
    expect(() =>
      parseDescriptions(JSON.stringify({ ...valid, secret: 'unwanted' })),
    ).toThrow();
    expect(() =>
      parseDescriptions(JSON.stringify({ ...valid, priceRating: 11 })),
    ).toThrow();
  });
});

describe('Salesperson profiles', () => {
  it('persists Thai profiles, retains email identity and LINE mapping, and records the editor', async () => {
    const before = await json<{ email: string; firstName: string }[]>(
      await request('/salespeople'),
    );
    expect(before.map((s) => s.email)).toContain('second@example.test');
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        'INSERT INTO line_accounts(email,line_user_id,enabled,linked_at) VALUES(?,?,1,?)',
      )
      .bind(
        'second@example.test',
        'U' + 'a'.repeat(32),
        new Date().toISOString(),
      )
      .run();
    const c = await customer();
    const created = await request('/leads', 'POST', {
      customerId: c.id,
      title: 'Assigned lead',
      assignedTo: 'second@example.test',
    });
    expect(created.status).toBe(201);
    const lead = await json<{ id: string }>(created);
    const r = await request('/salespeople/second%40example.test', 'PUT', {
      firstName: '  วรดา  ',
      lastName: 'ทดสอบ',
      phone: '0812345678',
    });
    expect(r.status).toBe(200);
    const after = await json<
      {
        email: string;
        firstName: string;
        lastName: string;
        phone: string;
        lineReady: boolean;
      }[]
    >(await request('/salespeople'));
    expect(after.find((s) => s.email === 'second@example.test')).toMatchObject({
      firstName: 'วรดา',
      lastName: 'ทดสอบ',
      phone: '0812345678',
      lineReady: true,
    });
    expect(
      await db
        .prepare('SELECT assigned_to FROM leads WHERE id=?')
        .bind(lead.id)
        .first('assigned_to'),
    ).toBe('second@example.test');
    expect(
      await db
        .prepare(
          "SELECT user_email FROM activities WHERE entity_type='salesperson' AND entity_id='second@example.test'",
        )
        .first('user_email'),
    ).toBe('tester@example.test');
    const legacy = await json<{ email: string; firstName: string }[]>(
      await request('/line/salespeople'),
    );
    expect(
      legacy.find((s) => s.email === 'second@example.test')?.firstName,
    ).toBe('วรดา');
  });
  it('rejects blank or excessive names, unknown fields and accounts without access', async () => {
    for (const body of [
      { firstName: ' ', lastName: 'Valid' },
      { firstName: 'x'.repeat(101), lastName: 'Valid' },
      { firstName: 'Valid', lastName: 'Name', email: 'new@example.test' },
    ]) {
      expect(
        (await request('/salespeople/tester%40example.test', 'PUT', body))
          .status,
      ).toBe(422);
    }
    expect(
      (
        await request('/salespeople/outsider%40example.test', 'PUT', {
          firstName: 'Not',
          lastName: 'Allowed',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(
          '/salespeople/tester%40example.test',
          'PUT',
          { firstName: 'Valid', lastName: 'Name' },
          { Origin: 'https://other.test' },
        )
      ).status,
    ).toBe(403);
    const db = await mf.getD1Database('DB');
    expect(
      await db
        .prepare(
          "SELECT email FROM salespeople WHERE email='outsider@example.test'",
        )
        .first(),
    ).toBeNull();
  });
});

describe('Private shared team chat', () => {
  it('keeps AI inventory search history private to the authenticated user', async () => {
    const db = await mf.getD1Database('DB');
    const p = await product('Private assistant equipment');
    await db.batch([
      db
        .prepare(
          "INSERT INTO assistant_messages(user_email,role,body,product_ids,created_at) VALUES(?,'assistant',?,?,?)",
        )
        .bind(
          'tester@example.test',
          'Your private result',
          JSON.stringify([p.id]),
          new Date().toISOString(),
        ),
      db
        .prepare(
          "INSERT INTO assistant_messages(user_email,role,body,product_ids,created_at) VALUES(?,'assistant',?,?,?)",
        )
        .bind(
          'second@example.test',
          'Another user private result',
          JSON.stringify([p.id]),
          new Date().toISOString(),
        ),
    ]);
    const history = await json<{
      messages: { body: string; products: { id: string }[] }[];
    }>(await request('/chat/assistant'));
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]).toMatchObject({
      body: 'Your private result',
      products: [{ id: p.id }],
    });
  });
  it('broadcasts persisted messages over an authenticated WebSocket', async () => {
    expect((await request('/chat/socket')).status).toBe(426);
    const response = await request('/chat/socket', 'GET', undefined, {
      Upgrade: 'websocket',
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    socket!.accept();
    const receivedPresence = new Promise<{
      type: string;
      users: { email: string; name: string }[];
    }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for chat presence')),
        2_000,
      );
      socket!.addEventListener('message', (event) => {
        const data = JSON.parse(String(event.data));
        if (data.type === 'chat.presence') {
          clearTimeout(timeout);
          resolve(data);
        }
      });
    });
    const received = new Promise<{ type: string; message: ChatMessage }>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for chat broadcast')),
          2_000,
        );
        socket!.addEventListener('message', (event) => {
          const data = JSON.parse(String(event.data));
          if (data.type === 'chat.message') {
            clearTimeout(timeout);
            resolve(data);
          }
        });
      },
    );
    await expect(receivedPresence).resolves.toMatchObject({
      type: 'chat.presence',
      users: [{ email: 'tester@example.test', name: 'tester@example.test' }],
    });
    const sent = await json<ChatMessage>(
      await request('/chat', 'POST', {
        requestId: crypto.randomUUID(),
        body: 'Real-time message',
      }),
    );
    const event = await received;
    expect(event).toMatchObject({
      type: 'chat.message',
      message: { id: sent.id, body: 'Real-time message' },
    });
    socket!.close(1000, 'Test complete');
  });
  it('stores authenticated messages and attached products, including attachment-only messages', async () => {
    const p = await product('Chat equipment');
    const sent = await request('/chat', 'POST', {
      requestId: crypto.randomUUID(),
      body: 'Hello team <script>alert(1)</script>',
      productIds: [p.id],
    });
    expect(sent.status).toBe(201);
    const m = await json<{
      id: number;
      senderEmail: string;
      body: string;
      products: { id: string; sku: string; purchaseCost?: number }[];
    }>(sent);
    expect(m.senderEmail).toBe('tester@example.test');
    expect(m.products[0].id).toBe(p.id);
    expect(m.products[0].purchaseCost).toBeUndefined();
    const feed = await json<{ messages: (typeof m)[] }>(await request('/chat'));
    expect(feed.messages.find((item) => item.id === m.id)?.body).toBe(m.body);
    expect(
      (
        await request('/chat', 'POST', {
          requestId: crypto.randomUUID(),
          productIds: [p.id],
        })
      ).status,
    ).toBe(201);
    const db = await mf.getD1Database('DB');
    await db
      .prepare('UPDATE products SET archived_at=? WHERE id=?')
      .bind(new Date().toISOString(), p.id)
      .run();
    const history = await json<{
      messages: { id: number; products: { archivedAt: string }[] }[];
    }>(await request('/chat'));
    expect(
      history.messages.find((item) => item.id === m.id)?.products[0].archivedAt,
    ).toBeTruthy();
    expect(
      (
        await request('/chat', 'POST', {
          requestId: crypto.randomUUID(),
          productIds: [p.id],
        })
      ).status,
    ).toBe(422);
  });
  it('deduplicates concurrent retries and rejects changed content for the same request', async () => {
    const payload = { requestId: crypto.randomUUID(), body: 'Send only once' };
    const replies = await Promise.all([
      request('/chat', 'POST', payload),
      request('/chat', 'POST', payload),
    ]);
    const a = await json<{ id: number }>(replies[0]),
      b = await json<{ id: number }>(replies[1]);
    expect(a.id).toBe(b.id);
    expect(
      (await request('/chat', 'POST', { ...payload, body: 'Different' }))
        .status,
    ).toBe(409);
    const db = await mf.getD1Database('DB');
    expect(
      await db
        .prepare(
          'SELECT count(*) AS count FROM chat_messages WHERE request_id=?',
        )
        .bind(payload.requestId)
        .first('count'),
    ).toBe(1);
  });
  it('rejects spoofed senders, invalid attachments, empty or excessive messages and cross-site writes', async () => {
    for (const payload of [
      { body: ' ' },
      { body: 'x'.repeat(2001) },
      { body: 'Hello', senderEmail: 'second@example.test' },
      { productIds: ['missing'] },
      { productIds: ['a', 'a'] },
      { productIds: ['a', 'b', 'c', 'd'] },
    ]) {
      expect(
        (
          await request('/chat', 'POST', {
            requestId: crypto.randomUUID(),
            ...payload,
          })
        ).status,
      ).toBe(422);
    }
    expect(
      (
        await request(
          '/chat',
          'POST',
          { requestId: crypto.randomUUID(), body: 'Blocked' },
          { Origin: 'https://other.test' },
        )
      ).status,
    ).toBe(403);
    const unauth = await mf.dispatchFetch('https://example.test/api/chat');
    expect(unauth.status).toBe(503);
  });
  it('paginates a shared conversation without missing or duplicating teammate messages', async () => {
    const db = await mf.getD1Database('DB');
    await db.batch(
      Array.from({ length: 55 }, (_, i) =>
        db
          .prepare(
            'INSERT INTO chat_messages(request_id,sender_email,body,created_at) VALUES(?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            'second@example.test',
            `Team message ${i}`,
            new Date().toISOString(),
          ),
      ),
    );
    type Page = {
      messages: { id: number; senderEmail: string; senderName: string }[];
      hasMore: boolean;
    };
    const latest = await json<Page>(await request('/chat'));
    expect(latest.messages).toHaveLength(50);
    expect(latest.hasMore).toBe(true);
    expect(latest.messages.at(-1)?.senderEmail).toBe('second@example.test');
    expect(latest.messages.at(-1)?.senderName).toBe('วรดา ทดสอบ');
    const older = await json<Page>(
      await request(`/chat?before=${latest.messages[0].id}`),
    );
    expect(older.messages.every((m) => m.id < latest.messages[0].id)).toBe(
      true,
    );
    const after = await json<Page>(
      await request(`/chat?after=${latest.messages[0].id}`),
    );
    expect(after.messages.map((m) => m.id)).toEqual(
      latest.messages.slice(1).map((m) => m.id),
    );
    expect((await request('/chat?after=-1')).status).toBe(422);
    expect((await request('/chat?after=0&before=1')).status).toBe(422);
  });
});
