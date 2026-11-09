import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, FormData } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { parseDescriptions } from '../worker/services/ai';
import { exchangeRate } from '../worker/services/exchange-rate';
import { generateSkus, nextSku } from '../worker/services/sku';
import { digest } from '../worker/auth';
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
    headers: Headers;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
    arrayBuffer: () => Promise<ArrayBuffer>;
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
describe('password sign-in migration', () => {
  it('rejects a still-valid session once the account is no longer allowed', async () => {
    const db = await mf.getD1Database('DB');
    const token = 'removed-account-session';
    await db
      .prepare("INSERT INTO auth_users(email,password_salt,password_hash,password_iterations,created_at,updated_at) VALUES(?,'test-only-salt','test-only-hash',100000,'','')")
      .bind('removed@example.test')
      .run();
    await db
      .prepare('INSERT INTO auth_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)')
      .bind(await digest(token), 'removed@example.test', new Date().toISOString(), '2099-01-01T00:00:00Z', new Date().toISOString())
      .run();
    for (const path of ['/products', '/customers', '/dashboard'])
      expect((await request(path, 'GET', undefined, { Cookie: `corevity_session=${token}` })).status).toBe(403);
    const session = await request('/auth/session', 'GET', undefined, { Cookie: `corevity_session=${token}` });
    expect(await json(session)).toMatchObject({ authenticated: false });
  });

  it('lets an existing authorized user set a password and sign in with a session cookie', async () => {
    const enrolled = await request('/auth/password', 'POST', {
      password: 'aB3!xy',
    });
    expect(enrolled.status).toBe(200);
    const cookie = enrolled.headers.get('Set-Cookie')?.split(';', 1)[0];
    expect(cookie).toMatch(/^corevity_session=/);

    const session = await request('/auth/session', 'GET', undefined, {
      Cookie: cookie!,
    });
    expect(session.status).toBe(200);
    expect(await json(session)).toMatchObject({
      authenticated: true,
      email: 'tester@example.test',
      method: 'password',
      hasPassword: true,
    });

    const login = await request('/auth/login', 'POST', {
      username: 'tester@example.test',
      password: 'aB3!xy',
    });
    expect(login.status).toBe(200);
    const loginCookie = login.headers.get('Set-Cookie')?.split(';', 1)[0];
    expect(loginCookie).toMatch(/^corevity_session=/);

    const logout = await request('/auth/logout', 'POST', undefined, {
      Cookie: loginCookie!,
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0');
    const db = await mf.getD1Database('DB');
    const sessions = await db.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE token_hash=?')
      .bind(await digest(loginCookie!.slice('corevity_session='.length)))
      .first<{ count: number }>();
    expect(sessions?.count).toBe(0);
  });

  it('lets only the workspace administrator create a salesperson login with a temporary password', async () => {
    const created = await request('/auth/users', 'POST', {
      email: 'new.sales@example.test',
      firstName: 'New',
      lastName: 'Sales',
      phone: '0812345678',
    });
    expect(created.status).toBe(201);
    const account = await json<{ email: string; temporaryPassword: string }>(created);
    expect(account.email).toBe('new.sales@example.test');
    expect(account.temporaryPassword.length).toBeGreaterThanOrEqual(6);
    const salespeople = await json<{ email: string; firstName: string }[]>(
      await request('/salespeople'),
    );
    expect(salespeople).toContainEqual(expect.objectContaining({
      email: account.email,
      firstName: 'New',
    }));
    const login = await request('/auth/login', 'POST', {
      username: account.email,
      password: account.temporaryPassword,
    });
    expect(login.status).toBe(200);
    const memberCookie = login.headers.get('Set-Cookie')?.split(';', 1)[0];
    const denied = await request('/auth/users', 'POST', {
      email: 'second.new@example.test',
      firstName: 'Second',
      lastName: 'User',
    }, { Cookie: memberCookie! });
    expect(denied.status).toBe(403);
  });
});
async function product(brand = 'Matrix') {
  const r = await request('/products', 'POST', {
    brand,
    model: 'Test model',
    targetBodyPart: 'Bicep',
    category: 'Other',
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
  it('lets signed-in users enter manual Catalog Detail and uses it in new catalog snapshots', async () => {
    const manual = 'Admin catalog detail\nDimensions: 120 × 80 cm';
    const createdProduct = await request('/products', 'POST', {
      brand: 'Manual catalog copy', model: 'Test model', category: 'Other', catalogDetail: manual,
    });
    expect(createdProduct.status).toBe(201);
    const p = await json<{ id: string; catalogDetail: string }>(createdProduct);
    expect(p.catalogDetail).toBe(manual);
    const save = await request(`/products/${p.id}/catalog-detail`, 'PATCH', { catalogDetail: manual });
    expect(save.status).toBe(200);
    expect(await json<{ catalogDetail: string }>(save)).toMatchObject({ catalogDetail: manual });

    const database = await mf.getD1Database('DB');
    const account = await json<{ email: string; temporaryPassword: string }>(await request('/auth/users', 'POST', {
      email: 'catalog.member@example.test', firstName: 'Catalog', lastName: 'Member',
    }));
    const login = await request('/auth/login', 'POST', { username: account.email, password: account.temporaryPassword });
    const memberCookie = login.headers.get('Set-Cookie')!.split(';', 1)[0];
    const memberSave = await request(`/products/${p.id}/catalog-detail`, 'PATCH', { catalogDetail: manual }, { Cookie: memberCookie });
    expect(memberSave.status).toBe(200);
    expect((await request(`/products/${p.id}/catalog-detail`, 'PATCH', { catalogDetail: 'x'.repeat(10001) })).status).toBe(422);
    const memberCreated = await request('/products', 'POST', {
      brand: 'Member product', model: 'Test', category: 'Other', catalogDetail: manual,
    }, { Cookie: memberCookie });
    expect(memberCreated.status).toBe(201);
    expect(await json<{ catalogDetail: string }>(memberCreated)).toMatchObject({ catalogDetail: manual });
    expect((await request(`/products/${p.id}`, 'PATCH', {
      catalogDetail: manual,
    }, { Cookie: memberCookie })).status).toBe(200);
    expect((await request(`/products/${p.id}`, 'PATCH', {
      catalogDetail: manual + ' edited',
    })).status).toBe(200);
    await request(`/products/${p.id}`, 'PATCH', { catalogDetail: manual });
    // Saving AI descriptions has no Catalog Detail field and preserves manual copy.
    expect((await request(`/products/${p.id}`, 'PATCH', {
      descriptionEn: 'AI draft saved after review',
    })).status).toBe(200);
    const invalidTarget = await request(`/products/${p.id}/generate-description`, 'POST', { target: 'catalogDetail' });
    expect(invalidTarget.status).toBe(422);
    await request(`/products/${p.id}/generate-description`, 'POST', { target: 'all' });
    const detail = await json<{ product: { catalogDetail: string } }>(await request(`/products/${p.id}`));
    expect(detail.product.catalogDetail).toBe(manual);
    const published = await database.prepare('SELECT public_slug AS slug FROM products WHERE id=?')
      .bind(p.id).first<{ slug: string }>();
    const publicPage = await publicCatalogWorker.fetch(
      new Request(`http://catalog.test/catalog/products/${published!.slug}?lang=en`),
      { DB: database, PRODUCT_IMAGES: await mf.getR2Bucket('PRODUCT_IMAGES') },
      { waitUntil: (promise: Promise<unknown>) => void promise },
    );
    expect(publicPage.status).toBe(200);
    expect(await publicPage.text()).toContain(manual);

    const created = await request('/catalogs', 'POST', { title: 'Manual catalog', items: [{ productId: p.id }] });
    expect(created.status).toBe(201);
    const catalog = await json<{ id: string }>(created);
    const snapshot = await database.prepare('SELECT description_snapshot AS description FROM catalog_items WHERE catalog_id=?')
      .bind(catalog.id).first<{ description: string }>();
    expect(snapshot?.description).toBe(manual);
    await request(`/products/${p.id}/catalog-detail`, 'PATCH', { catalogDetail: 'Changed manually' });
    const preserved = await database.prepare('SELECT description_snapshot AS description FROM catalog_items WHERE catalog_id=?')
      .bind(catalog.id).first<{ description: string }>();
    expect(preserved?.description).toBe(manual);
    expect((await request(`/products/${p.id}/catalog-detail`, 'PATCH', { catalogDetail: '' })).status).toBe(200);
  });

  it('allows an empty specification and filters products that have one', async () => {
    const created = await request('/products', 'POST', {
      brand: 'Matrix',
      model: 'Chest Press',
      targetBodyPart: 'Chest',
      category: 'Other',
      purchaseCost: 100,
      sellingPrice: 150,
    });
    expect(created.status).toBe(201);
    const product = await json<{ id: string; targetBodyPart: string }>(created);
    expect(product.targetBodyPart).toBe('Chest');

    const search = await json<{ id: string; targetBodyPart: string }[]>(
      await request('/products?targetBodyPart=Chest'),
    );
    expect(search).toContainEqual(expect.objectContaining({ id: product.id, targetBodyPart: 'Chest' }));

    const missing = await request('/products', 'POST', {
        brand: 'Matrix', model: 'Legacy product', category: 'Other', purchaseCost: 0, sellingPrice: 0,
      });
    expect(missing.status).toBe(201);
    const legacy = await json<{ targetBodyPart: string }>(missing);
    expect(legacy.targetBodyPart).toBe('');
  });

  it('requires a category when creating a product', async () => {
    const response = await request('/products', 'POST', {
      brand: 'Matrix',
      model: 'Uncategorized press',
      category: '   ',
    });
    expect(response.status).toBe(422);
    expect(await json<{ error: { fields: { category: string[] } } }>(response)).toMatchObject({
      error: { fields: { category: ['Category is required'] } },
    });
  });

  it('saves a selected category from Settings at the configured maximum length', async () => {
    const category = `Custom ${'strength '.repeat(12)}`.trim();
    expect(category.length).toBeLessThanOrEqual(120);
    const initial = await json<{ categories: string[] }>(await request('/settings'));
    const settings = await request('/settings', 'PATCH', {
      categories: [...initial.categories, category],
    });
    expect(settings.status).toBe(200);
    try {
      const created = await request('/products', 'POST', {
        brand: 'Matrix',
        model: 'Category save regression',
        category,
        purchaseCost: 100,
        sellingPrice: 150,
      });
      expect(created.status).toBe(201);
      expect(await json<{ category: string }>(created)).toMatchObject({ category });
    } finally {
      await request('/settings', 'PATCH', { categories: initial.categories });
    }
  });

  it('skips short OpenStreetMap searches and rejects oversized search terms', async () => {
    const shortQuery = await request('/calendar/locations?q=ab');
    expect(shortQuery.status).toBe(200);
    expect(await json(shortQuery)).toEqual({ suggestions: [], configured: true });
    const longQuery = await request(`/calendar/locations?q=${'a'.repeat(121)}`);
    expect(longQuery.status).toBe(422);
  });

  it('shares team calendar events, validates invited teammates, and removes deleted events', async () => {
    const startsAt = new Date(Date.now() + 2 * 86400000).toISOString();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(startsAt));
    const created = await request('/calendar', 'POST', {
      title: 'Team planning', details: 'Plan next month', location: 'Meeting room',
      locationPlaceId: 'ChIJ-test-place-id',
      locationMapUrl: '<iframe src="https://www.google.com/maps/embed?pb=test-map&amp;entry=ttu" width="600" height="450" style="border:0" allowfullscreen="" loading="lazy"></iframe>',
      startsAt, endsAt: new Date(new Date(startsAt).getTime() + 3600000).toISOString(),
      reminderMinutes: 1440, attendeeEmails: ['second@example.test'],
    });
    expect(created.status).toBe(201);
    const { id } = await json<{ id: string }>(created);
    const sentAt = new Date(Date.now() - 3600000).toISOString();
    await (await mf.getD1Database('DB')).prepare(
      "INSERT INTO calendar_reminders(id,event_id,email,line_user_id,starts_at,reminder_minutes,remind_at,status,attempts,created_at,next_attempt_at,sent_at) VALUES(?,?,?,?,?,?,?,'sent',1,?,?,?)",
    ).bind('test-calendar-reminder', id, 'second@example.test', 'U' + '1'.repeat(32), startsAt, 1440, startsAt, sentAt, sentAt, sentAt).run();
    const list = await request(`/calendar?from=${day}&to=${day}`);
    expect(list.status).toBe(200);
    expect(await json<Array<{ id: string; locationPlaceId: string; locationMapUrl: string; reminderDelivery: { sentCount: number; sentAt: string }; attendees: { email: string }[] }>>(list)).toEqual([
      expect.objectContaining({ id, locationPlaceId: 'ChIJ-test-place-id', locationMapUrl: 'https://www.google.com/maps/embed?pb=test-map&entry=ttu', reminderDelivery: { sentCount: 1, sentAt }, attendees: expect.arrayContaining([
        expect.objectContaining({ email: 'tester@example.test' }),
        expect.objectContaining({ email: 'second@example.test' }),
      ]) }),
    ]);
    const updated = await request(`/calendar/${id}`, 'PUT', {
      title: 'Team planning updated', details: 'Agenda finalized', location: 'Meeting room',
      locationMapUrl: '',
      startsAt, endsAt: null, reminderMinutes: 30, attendeeEmails: [],
    });
    expect(updated.status).toBe(200);
    const afterUpdate = await json<Array<{ id: string; title: string; attendees: { email: string }[] }>>(
      await request(`/calendar?from=${day}&to=${day}`),
    );
    expect(afterUpdate[0]).toMatchObject({
      id, title: 'Team planning updated',
      attendees: [expect.objectContaining({ email: 'tester@example.test' })],
    });
    const conflict = await request('/calendar', 'POST', {
      title: 'Overlapping event', startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + 30 * 60000).toISOString(),
      attendeeEmails: [],
    });
    expect(conflict.status).toBe(409);
    expect(await json<{ error: { code: string; conflicts: { attendeeEmail: string; title: string }[] } }>(conflict)).toMatchObject({
      error: { code: 'EVENT_CONFLICT', conflicts: [expect.objectContaining({ attendeeEmail: 'tester@example.test', title: 'Team planning updated' })] },
    });
    const invalidInvite = await request('/calendar', 'POST', {
      title: 'Invalid invite', startsAt, attendeeEmails: ['outsider@example.test'],
    });
    expect(invalidInvite.status).toBe(422);
    const invalidMapLink = await request('/calendar', 'POST', {
      title: 'Unsafe map link', startsAt, locationMapUrl: 'https://maps.example.test/embed',
    });
    expect(invalidMapLink.status).toBe(422);
    const deleted = await request(`/calendar/${id}`, 'DELETE');
    expect(deleted.status).toBe(200);
    expect(await request(`/calendar?from=${day}&to=${day}`).then((response) => response.json())).toEqual([]);
  });
  it('adds finance records without changing inventory and prevents overpayment or voiding paid expenses', async () => {
    const db = await mf.getD1Database('DB');
    const before = await db.prepare('SELECT COUNT(*) AS count FROM products').first<{ count: number }>();
    const categories = await request('/expense-categories');
    expect(categories.status).toBe(200);
    const categoryList = await json<Array<{ id: string }>>(categories);
    expect(categoryList.some((item) => item.id === 'software-subscription')).toBe(true);
    const idempotencyKey = crypto.randomUUID();
    const created = await request('/expenses', 'POST', {
      expenseDate: '2026-10-12', description: 'Finance test subscription',
      categoryId: 'software-subscription', amount: 100, currency: 'THB',
      exchangeRate: 1, vendor: 'Test vendor', dueDate: '2026-10-15',
      idempotencyKey,
    });
    expect(created.status).toBe(201);
    const expense = await json<{ id: string; expenseNumber: string; status: string; outstanding: number }>(created);
    expect(expense).toMatchObject({ expenseNumber: expect.stringMatching(/^EXP-2026-\d{4}$/), status: 'UNPAID', outstanding: 100 });
    const replay = await request('/expenses', 'POST', {
      expenseDate: '2026-10-12', description: 'Finance test subscription',
      categoryId: 'software-subscription', amount: 100, currency: 'THB',
      exchangeRate: 1, vendor: 'Test vendor', dueDate: '2026-10-15',
      idempotencyKey,
    });
    expect((await json<{ id: string }>(replay)).id).toBe(expense.id);
    const paymentKey = crypto.randomUUID();
    const paidPart = await request(`/expenses/${expense.id}/payments`, 'POST', {
      amount: 40, paymentDate: '2026-10-12', paymentMethod: 'BANK_TRANSFER',
      idempotencyKey: paymentKey,
    });
    expect((await json<{ status: string; outstanding: number }>(paidPart)).status).toBe('PARTIALLY_PAID');
    const overpayment = await request(`/expenses/${expense.id}/payments`, 'POST', {
      amount: 61, paymentDate: '2026-10-12', paymentMethod: 'BANK_TRANSFER',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(overpayment.status).toBe(422);
    const voidPaid = await request(`/expenses/${expense.id}/void`, 'POST', { reason: 'Paid record' });
    expect(voidPaid.status).toBe(409);
    const after = await db.prepare('SELECT COUNT(*) AS count FROM products').first<{ count: number }>();
    expect(after?.count).toBe(before?.count);
    const overview = await request('/finance/overview?from=2026-10-01&to=2026-10-31');
    expect(overview.status).toBe(200);
    expect((await json<{ expenseRecognition: { operatingExpenses: number }; cashPaid: number }>(overview)).expenseRecognition.operatingExpenses).toBeGreaterThanOrEqual(100);
  });

  it('converts foreign currency using the saved rate and allocates product costs with exact deterministic rounding', async () => {
    const items = await Promise.all([product('Cost allocation A'), product('Cost allocation B'), product('Cost allocation C')]);
    const expenseResponse = await request('/expenses', 'POST', {
      expenseDate: '2026-10-12', description: 'Imported freight', categoryId: 'international-shipping',
      expenseType: 'PRODUCT_COST', amount: 10.01, currency: 'USD', exchangeRate: 35.5,
      exchangeRateDate: '2026-10-10', idempotencyKey: crypto.randomUUID(),
    });
    expect(expenseResponse.status).toBe(201);
    const expense = await json<{ id: string; convertedThb: number }>(expenseResponse);
    expect(expense.convertedThb).toBe(355.36);
    const allocationResponse = await request(`/expenses/${expense.id}/allocations`, 'POST', {
      method: 'EQUAL', allocations: items.map((item) => ({ productId: item.id })),
    });
    expect(allocationResponse.status).toBe(200);
    const allocations = await json<{ allocations: { amountThb: number }[]; totalThb: number }>(allocationResponse);
    expect(allocations.totalThb).toBe(355.36);
    expect(allocations.allocations.map((item) => item.amountThb)).toEqual([118.46,118.45,118.45]);
    expect(allocations.allocations.reduce((sum,item)=>sum+item.amountThb,0)).toBe(355.36);
    const costs = await json<{ allocatedProductCosts: number; totalCost: number; estimatedGrossMargin: number }>(await request(`/finance/products/${items[0].id}/cost`));
    expect(costs.allocatedProductCosts).toBe(118.46);
    expect(costs.totalCost).toBe(218.46);
    expect(Number.isFinite(costs.estimatedGrossMargin)).toBe(true);
  });

  it('keeps unpublished products private and exposes only approved public fields', async () => {
    const item = await product('Public boundary');
    const database = await mf.getD1Database('DB');
    await database
      .prepare("UPDATE products SET is_published=0,public_slug=NULL,notes='confidential test note',description_en='Saved English description',description_th='คำบรรยายภาษาไทย' WHERE id=?")
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
    });
    expect(publish.status).toBe(200);
    const imageId = crypto.randomUUID();
    const imageKey = `test-public-catalog/${imageId}.jpg`;
    await bucket.put(imageKey, new Uint8Array([255, 216, 255, 217]), {
      httpMetadata: { contentType: 'image/jpeg' },
    });
    await database
      .prepare(
        'INSERT INTO product_images(id,product_id,r2_key,file_name,mime_type,file_size,sort_order,is_primary,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .bind(imageId, item.id, imageKey, 'sample.jpg', 'image/jpeg', 4, 0, 1, new Date().toISOString())
      .run();
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
      description: 'Saved English description',
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
    ).not.toHaveProperty('price');
    const skuSearch = await publicCatalogWorker.fetch(
      new Request(`http://catalog.test/catalog?q=${encodeURIComponent(item.sku)}`),
      { DB: database, PRODUCT_IMAGES: bucket },
      ctx,
    );
    const skuSearchHtml = await skuSearch.text();
    expect(skuSearchHtml).toContain('1 products');
    expect(skuSearchHtml).toContain('Public boundary Test model');
    expect(skuSearchHtml).toContain(
      `/media/products/${productRow.publicSlug}/image/${imageId}`,
    );
    const publicImage = await publicCatalogWorker.fetch(
      new Request(`http://catalog.test/media/products/${productRow.publicSlug}/image/${imageId}`),
      { DB: database, PRODUCT_IMAGES: bucket },
      ctx,
    );
    expect(publicImage.status).toBe(200);
    expect(new Uint8Array(await publicImage.arrayBuffer())).toEqual(
      new Uint8Array([255, 216, 255, 217]),
    );
    expect(skuSearchHtml).toContain("addEventListener('input',updateCatalog)");

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
    const bulkPublish = await request('/products/publish-all', 'POST');
    expect(bulkPublish.status).toBe(200);
    const bulkResult = await json<{ published: number; showPrices: boolean }>(
      bulkPublish,
    );
    expect(bulkResult.published).toBeGreaterThan(0);
    expect(bulkResult.showPrices).toBe(false);
    const republished = await database
      .prepare('SELECT is_published,show_price,public_slug FROM products WHERE id=?')
      .bind(item.id)
      .first<{ is_published: number; show_price: number; public_slug: string }>();
    expect(republished).toMatchObject({ is_published: 1, show_price: 0 });
    expect(republished?.public_slug).toBeTruthy();
  });
  it('publishes multiple customer catalogs to the website and removes archived or expired ones', async () => {
    const item = await product('Website collection');
    const customerRecord = await customer();
    expect((await request(`/products/${item.id}/publish`, 'POST', {showPrice: false})).status).toBe(200);
    const createCatalog = async (title: string) => json<{id: string; slug: string}>(await request('/catalogs','POST',{
      title, description: 'Website description', customerId: customerRecord.id,
      assignedSalespersonEmail: 'tester@example.test', showPrices: false, showSold: false,
      expiresAt: '2099-12-31T23:59:59.999Z', items: [{productId: item.id}],
    }));
    const first = await createCatalog('Website first');
    const second = await createCatalog('Website second');
    const database = await mf.getD1Database('DB');
    const bucket = await mf.getR2Bucket('PRODUCT_IMAGES');
    const ctx = {waitUntil: (promise: Promise<unknown>) => void promise} as ExecutionContext;
    const fetchPublic = (path: string) => publicCatalogWorker.fetch(
      new Request(`http://catalog.test${path}`), {DB: database, PRODUCT_IMAGES: bucket}, ctx,
    );
    const list = async () => (await (await fetchPublic('/api/public/storefront/catalogs')).json()) as {catalogs: Array<{slug: string}>};
    expect((await list()).catalogs).not.toEqual(expect.arrayContaining([{slug: first.slug}]));
    expect((await fetchPublic(`/api/public/storefront/catalogs/${first.slug}`)).status).toBe(404);
    expect((await request(`/catalogs/${first.id}/publish-to-web`,'POST')).status).toBe(200);
    expect((await request(`/catalogs/${second.id}/publish-to-web`,'POST')).status).toBe(200);
    await database.prepare('UPDATE catalogs SET published_to_web_at=? WHERE id=?').bind('2020-01-01T00:00:00.000Z',first.id).run();
    expect((await list()).catalogs.map((value) => value.slug).slice(0,2)).toEqual([second.slug,first.slug]);
    const latest = await fetchPublic('/api/public/storefront');
    expect(((await latest.json()) as {slug: string}).slug).toBe(second.slug);
    const duplicate = await json<{id: string; slug: string}>(await request(`/catalogs/${first.id}/duplicate`,'POST'));
    expect((await list()).catalogs.some((value) => value.slug === duplicate.slug)).toBe(false);
    const detail = await fetchPublic(`/api/public/storefront/catalogs/${first.slug}`);
    const payload = await detail.json() as { products: Array<{productSlug: string}> };
    expect(detail.status).toBe(200);
    expect(payload.products[0].productSlug).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain(customerRecord.id);
    expect(JSON.stringify(payload)).not.toContain('customerId');
    expect(JSON.stringify(payload)).not.toContain('purchaseCost');
    expect((await fetchPublic(`/s/${first.slug}`)).status).toBe(200);
    expect((await request(`/catalogs/${first.id}/unpublish-from-web`,'POST')).status).toBe(200);
    expect((await fetchPublic(`/api/public/storefront/catalogs/${first.slug}`)).status).toBe(404);
    expect((await fetchPublic(`/s/${first.slug}`)).status).toBe(200);
    expect((await request(`/catalogs/${second.id}/archive`,'POST')).status).toBe(200);
    expect((await list()).catalogs.some((value) => value.slug === second.slug)).toBe(false);
    const expired = await createCatalog('Website expired');
    await database.prepare('UPDATE catalogs SET expires_at=? WHERE id=?').bind('2020-01-01T00:00:00.000Z',expired.id).run();
    expect((await request(`/catalogs/${expired.id}/publish-to-web`,'POST')).status).toBe(409);
  });

  it('orders website Catalogs manually and deletes Catalogs permanently', async () => {
    const item = await product('Website ordering');
    expect((await request(`/products/${item.id}/publish`, 'POST', {showPrice: false})).status).toBe(200);
    const createCatalog = async (title: string) => json<{id: string; slug: string}>(await request('/catalogs','POST',{
      title, assignedSalespersonEmail: 'tester@example.test', items: [{productId: item.id}],
    }));
    const database = await mf.getD1Database('DB');
    await database.prepare('UPDATE catalogs SET publish_to_web=0,web_sort_order=NULL').run();
    const a = await createCatalog('Order A');
    const b = await createCatalog('Order B');
    const c = await createCatalog('Order C');
    for (const catalog of [a, b, c]) expect((await request(`/catalogs/${catalog.id}/publish-to-web`,'POST')).status).toBe(200);
    const bucket = await mf.getR2Bucket('PRODUCT_IMAGES');
    const ctx = {waitUntil: (promise: Promise<unknown>) => void promise} as ExecutionContext;
    const fetchPublic = (path: string) => publicCatalogWorker.fetch(
      new Request(`http://catalog.test${path}`), {DB: database, PRODUCT_IMAGES: bucket}, ctx,
    );
    const order = async () => ((await (await fetchPublic('/api/public/storefront/catalogs')).json()) as {catalogs: Array<{slug: string}>}).catalogs.map((value) => value.slug);
    expect(await order()).toEqual([c.slug, b.slug, a.slug]);
    expect((await request('/catalogs/web-order','PUT',{ids: [a.id, c.id]})).status).toBe(409);
    expect((await request('/catalogs/web-order','PUT',{ids: [a.id, c.id, b.id]})).status).toBe(200);
    expect(await order()).toEqual([a.slug, c.slug, b.slug]);
    expect(((await (await fetchPublic('/api/public/storefront')).json()) as {slug: string}).slug).toBe(a.slug);
    const listed = await json<{catalogs: Array<{id: string; webSortOrder: number | null}>}>(await request('/catalogs'));
    expect(listed.catalogs.find((value) => value.id === c.id)?.webSortOrder).toBe(1);
    expect((await request(`/catalogs/${c.id}`,'DELETE')).status).toBe(200);
    expect((await request(`/catalogs/${c.id}`)).status).toBe(404);
    expect((await request(`/catalogs/${c.id}`,'DELETE')).status).toBe(404);
    expect(await order()).toEqual([a.slug, b.slug]);
    expect((await fetchPublic(`/s/${c.slug}`)).status).toBe(404);
    expect(await database.prepare('SELECT COUNT(*) AS n FROM catalog_items WHERE catalog_id=?').bind(c.id).first('n')).toBe(0);
    expect((await request(`/catalogs/${b.id}/archive`,'POST')).status).toBe(200);
    expect((await request(`/catalogs/${b.id}`,'DELETE')).status).toBe(200);
    expect(await order()).toEqual([a.slug]);
  });
  it('allows website chat preflight only from the approved origin', async () => {
    const database = await mf.getD1Database('DB');
    const bucket = await mf.getR2Bucket('PRODUCT_IMAGES');
    const ctx = {waitUntil: (promise: Promise<unknown>) => void promise} as ExecutionContext;
    const invoke = (origin: string) => publicCatalogWorker.fetch(
      new Request('http://catalog.test/api/public/chat', {method: 'OPTIONS', headers: {Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization'}}),
      {DB: database, PRODUCT_IMAGES: bucket}, ctx,
    );
    const allowed = await invoke('https://corevityusedgym.com');
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://corevityusedgym.com');
    expect(allowed.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    const refused = await invoke('https://other.example');
    expect(refused.status).toBe(403);
    expect(refused.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('creates and duplicates CRM-linked catalogs without public prices, with live availability and share metadata', async () => {
    const item = await product('Catalog snapshot');
    const customerRecord = await customer();
    const database = await mf.getD1Database('DB');
    await database
      .prepare("UPDATE products SET description_en='Saved catalog description' WHERE id=?")
      .bind(item.id)
      .run();
    expect(
      (
        await request(`/products/${item.id}/publish`, 'POST', {
          showPrice: true,
        })
      ).status,
    ).toBe(200);
    const { product: published } = await json<{
      product: { publicSlug: string };
    }>(await request(`/products/${item.id}`));
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
      assignedSalespersonEmail: 'tester@example.test',
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
    const catalogDetail = await json<{ catalog: { assignedSalespersonEmail: string } }>(await request(`/catalogs/${catalog.id}`));
    expect(catalogDetail.catalog.assignedSalespersonEmail).toBe('tester@example.test');
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
      items: [{ productId: item.id, description: '' }],
    });
    expect(editedCatalog.status).toBe(200);
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => void promise,
    } as ExecutionContext;
    const fetchPublic = (path: string, options: RequestInit = {}) =>
      publicCatalogWorker.fetch(
        new Request(`http://catalog.test${path}`, options),
        {
          DB: database,
          PRODUCT_IMAGES: bucket,
          PUBLIC_CATALOG_BASE_URL: 'https://catalog.corevityusedgym.com',
        },
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
      availability: 'AVAILABLE',
    });
    expect(publicData.products[0]).not.toHaveProperty('price');
    expect(publicData.products[0]).not.toHaveProperty('productId');
    expect(publicData.products[0]).not.toHaveProperty('purchaseCost');

    const publicCatalogHtml = await fetchPublic('/catalog?lang=en');
    const publicCatalogText = await publicCatalogHtml.text();
    expect(publicCatalogText).toContain('class="catalog-product-photo"');
    expect(publicCatalogText).toContain('object-fit:contain');
    expect(publicCatalogText).toContain('<dt>Brand</dt>');
    expect(publicCatalogText).not.toContain('<dt>Model</dt>');
    expect(publicCatalogText).not.toContain('<dt>Specification</dt>');
    expect(publicCatalogText).toContain('<dt>Status</dt>');
    expect(publicCatalogText).not.toContain('<dt>Category</dt>');
    expect(publicCatalogText).not.toContain('<dt>Quality</dt>');
    expect(publicCatalogText).toContain('<dd>Renamed brand · Renamed model · Bicep</dd>');
    expect(publicCatalogText).not.toContain('class="catalog-chat-fab"');

    const genericProductHtml = await fetchPublic(`/catalog/products/${published.publicSlug}`);
    expect(await genericProductHtml.text()).not.toContain('class="catalog-chat-fab"');

    const html = await fetchPublic(`/s/${catalog.slug}`);
    const htmlText = await html.text();
    expect(htmlText).toContain('property="og:title"');
    expect(htmlText).toContain('property="og:description"');
    expect(htmlText).toContain('property="og:image"');
    expect(htmlText).toContain(
      `property="og:url" content="https://catalog.corevityusedgym.com/s/${catalog.slug}"`,
    );
    expect(htmlText).toContain(`href="/s/${catalog.slug}?lang=th"`);
    expect(htmlText).toContain(`href="/s/${catalog.slug}?lang=en"`);
    expect(htmlText).not.toContain('>Equipment catalog</a>');
    expect(htmlText).toContain(`/media/catalogs/${catalog.slug}/item/`);
    expect(htmlText).toContain('class="catalog-chat-fab"');
    expect(htmlText).toContain('class="catalog-chat-badge"');
    expect(htmlText).toContain('function updateBadge(messages)');
    expect(htmlText).toContain('data-catalog-slug="' + catalog.slug + '"');
    expect(htmlText).toContain('class="private-catalog"');
    expect(htmlText).toContain('class="editorial-products"');
    expect(htmlText).toContain('class="ebook-toolbar"');
    expect(htmlText).toContain('data-book-contents');
    expect(htmlText).toContain('data-book-next');
    expect(htmlText).toContain('class="editorial-photo"');
    expect(htmlText).toContain('class="editorial-brand">Catalog snapshot');
    expect(htmlText).toContain('class="editorial-availability">1 UNIT AVAILABLE');
    expect(htmlText).toContain('Catalog-specific snapshot copy');
    expect(htmlText).toContain('<strong>12,345</strong>');
    expect(htmlText).not.toContain('purchaseCost');
    expect(publicCatalogText).not.toContain('class="private-catalog"');
    const catalogItem = await database
      .prepare('SELECT i.id,p.public_slug AS product_slug FROM catalog_items i JOIN products p ON p.id=i.product_id WHERE i.catalog_id=? AND i.product_id=?')
      .bind(catalog.id, item.id)
      .first<{ id: string; product_slug: string }>();
    expect(catalogItem?.id).toBeTruthy();
    const detailHtml = await fetchPublic(
      `/s/${catalog.slug}/p/${catalogItem!.product_slug}?lang=en`,
    );
    const detailText = await detailHtml.text();
    expect(detailText).toContain(
      `href="/s/${catalog.slug}/p/${catalogItem!.product_slug}?lang=th"`,
    );
    expect(detailText).toContain(
      `href="/s/${catalog.slug}/p/${catalogItem!.product_slug}?lang=en"`,
    );
    expect(detailText).toContain('<h1>Test model</h1>');
    expect(detailText).toContain('class="private-catalog"');
    expect(detailText).toContain('class="editorial-brand">Catalog snapshot');
    expect(detailText).toContain('class="editorial-specification">Bicep');
    expect(detailText).toContain('class="editorial-availability">1 UNIT AVAILABLE');
    expect(detailText).toContain('<strong>12,345</strong>');
    expect(detailText).not.toContain('Contact details are being updated.');
    expect(detailText).toContain('Catalog-specific snapshot copy');
    await database
      .prepare("UPDATE catalog_items SET description_snapshot='' WHERE catalog_id=? AND product_id=?")
      .bind(catalog.id, item.id)
      .run();
    const detailWithLegacyDescription = await fetchPublic(
      `/s/${catalog.slug}/p/${catalogItem!.product_slug}?lang=en`,
    );
    expect(await detailWithLegacyDescription.text()).toContain(
      'Saved catalog description',
    );
    const catalogImage = await fetchPublic(
      `/media/catalogs/${catalog.slug}/item/${catalogItem!.id}`,
    );
    expect(catalogImage.status).toBe(200);
    expect(catalogImage.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await catalogImage.arrayBuffer())).toEqual(
      new Uint8Array([255, 216, 255, 217]),
    );

    // Catalog snapshots survive image replacement, then recover using only this
    // product's current photo if their original object has been removed.
    const replacementKey = `test-catalog/${item.id}-replacement.png`;
    const replacementPhoto = new Uint8Array([137, 80, 78, 71]);
    await bucket.put(replacementKey, replacementPhoto, { httpMetadata: { contentType: 'image/png' } });
    await database.prepare('UPDATE product_images SET r2_key=?,mime_type=? WHERE product_id=?')
      .bind(replacementKey, 'image/png', item.id).run();
    const preserved = await fetchPublic(`/media/catalogs/${catalog.slug}/item/${catalogItem!.id}`);
    expect(preserved.headers.get('Content-Type')).toBe('image/jpeg');
    await bucket.delete(imageKey);
    const recovered = await fetchPublic(`/media/catalogs/${catalog.slug}/item/${catalogItem!.id}`);
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get('Content-Type')).toBe('image/png');
    expect(recovered.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=60');
    expect(new Uint8Array(await recovered.arrayBuffer())).toEqual(replacementPhoto);
    const positional = await fetchPublic(`/media/catalogs/${catalog.slug}/0`);
    expect(positional.status).toBe(200);
    expect(positional.headers.get('Cache-Control')).toBe('no-store');
    await database.prepare("UPDATE catalog_items SET image_key_snapshot='',image_mime_snapshot='' WHERE id=?")
      .bind(catalogItem!.id).run();
    expect((await fetchPublic(`/s/${catalog.slug}`)).status).toBe(200);
    expect(await (await fetchPublic(`/s/${catalog.slug}`)).text()).toContain(`/media/catalogs/${catalog.slug}/item/${catalogItem!.id}`);
    expect((await fetchPublic(`/media/catalogs/${catalog.slug}/item/${catalogItem!.id}`)).status).toBe(200);
    await database.prepare('UPDATE catalogs SET publish_to_web=1 WHERE id=?').bind(catalog.id).run();
    const photoRecord = await database.prepare('SELECT id FROM product_images WHERE product_id=?').bind(item.id).first<{id: string}>();
    const storefrontImages = await (await fetchPublic(`/api/public/storefront/catalogs/${catalog.slug}`)).json() as {products: {imageUrl: string}[]};
    expect(storefrontImages.products[0].imageUrl).toContain(`?v=${photoRecord!.id}`);
    const covers = await (await fetchPublic('/api/public/storefront/catalogs')).json() as {catalogs: {slug: string; coverImageUrl: string}[]};
    expect(covers.catalogs.find(c => c.slug === catalog.slug)?.coverImageUrl).toBe(storefrontImages.products[0].imageUrl);
    await database.prepare('UPDATE catalogs SET publish_to_web=0 WHERE id=?').bind(catalog.id).run();
    await database.prepare('UPDATE catalog_items SET image_key_snapshot=?,image_mime_snapshot=? WHERE id=?')
      .bind(imageKey, 'image/jpeg', catalogItem!.id).run();
    // The fallback must not expose a photo after the product becomes private.
    await database.prepare('UPDATE products SET is_published=0 WHERE id=?').bind(item.id).run();
    expect((await fetchPublic(`/media/catalogs/${catalog.slug}/item/${catalogItem!.id}`)).status).toBe(404);
    await database.prepare('UPDATE products SET is_published=1 WHERE id=?').bind(item.id).run();

    const chatProducts = await fetchPublic(`/api/public/chat/products?catalog=${catalog.slug}`);
    expect(chatProducts.status).toBe(200);
    expect((await chatProducts.json() as { products: Array<{ slug: string }> }).products).toContainEqual(expect.objectContaining({ slug: catalogItem!.product_slug }));
    const unboundChat = await fetchPublic('/api/public/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorName: 'Catalog customer', body: 'A message without a catalog' }),
    });
    expect(unboundChat.status).toBe(400);
    const missingContact = await fetchPublic('/api/public/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogSlug: catalog.slug, body: 'A message without contact details' }),
    });
    expect(missingContact.status).toBe(400);
    const firstChatMessage = await fetchPublic('/api/public/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogSlug: catalog.slug, visitorName: 'Catalog customer', visitorPhone: '+66812345678', body: 'Is this machine available?', productSlugs: [catalogItem!.product_slug] }),
    });
    expect(firstChatMessage.status).toBe(201);
    const chatSession = await firstChatMessage.json() as { session: { id: string; token: string } };
    const inbox = await request('/catalog-chats');
    expect(inbox.status).toBe(200);
    expect((await json<{ threads: Array<{ id: string; visitorName: string; visitorPhone: string }> }>(inbox)).threads).toContainEqual(expect.objectContaining({ id: chatSession.session.id, visitorName: 'Catalog customer', visitorPhone: '+66812345678' }));
    const staffReply = await request(`/catalog-chats/${chatSession.session.id}/messages`, 'POST', { body: 'Yes, it is available.' });
    expect(staffReply.status).toBe(201);
    const customerChat = await fetchPublic(`/api/public/chat/${chatSession.session.id}`, { headers: { Authorization: `Bearer ${chatSession.session.token}` } });
    const customerMessages = await customerChat.json() as { messages: Array<{ body: string; senderType: string }> };
    expect(customerMessages.messages.at(-1)).toMatchObject({ body: 'Yes, it is available.', senderType: 'SALESPERSON' });

    const missingWebsiteEmail = await fetchPublic('/api/public/chat/website', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorName: 'Website visitor', visitorPhone: '+66812345678', body: 'Hello from the website' }),
    });
    expect(missingWebsiteEmail.status).toBe(400);
    const websiteChat = await fetchPublic('/api/public/chat/website', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorName: 'Website visitor', visitorPhone: '+66812345678', visitorEmail: 'visitor@example.test', body: 'Hello from the website' }),
    });
    expect(websiteChat.status).toBe(201);
    const websiteSession = await websiteChat.json() as { session: { id: string; token: string } };
    const websiteInbox = await json<{ threads: Array<{ id: string; source: string; visitorEmail: string }> }>(await request('/catalog-chats'));
    expect(websiteInbox.threads).toContainEqual(expect.objectContaining({ id: websiteSession.session.id, source: 'WEBSITE', visitorEmail: 'visitor@example.test' }));
    const websiteReply = await request(`/catalog-chats/${websiteSession.session.id}/messages`, 'POST', { body: 'Thanks for contacting us.' });
    expect(websiteReply.status).toBe(201);
    const websiteConversation = await fetchPublic(`/api/public/chat/${websiteSession.session.id}`, { headers: { Authorization: `Bearer ${websiteSession.session.token}` } });
    expect((await websiteConversation.json() as { messages: Array<{ body: string }> }).messages.at(-1)?.body).toBe('Thanks for contacting us.');

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
    expect(duplicatedData.products[0]).not.toHaveProperty('price');

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
    expect(soldProduct.status).toBe(200);
    const soldPayload = (await soldProduct.json()) as {
      product: { availability: string };
    };
    expect(soldPayload.product.availability).toBe('SOLD');
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
  it('creates a duplicate with generated SKU, blank serial and copied analysis', async () => {
    const response = await request('/products', 'POST', {
      brand: 'Duplicate Brand',
      model: 'Duplicate Model',
      targetBodyPart: 'Bicep',
      category: 'Other',
      purchaseCost: 100,
      sellingPrice: 200,
      serialNumber: '',
      status: 'AVAILABLE',
      descriptionTh: 'คำอธิบายภาษาไทย',
      shortDescription: 'Short copy',
      priceRating: 8,
      features: ['Verified feature'],
      ratingReasons: {
        price: 'Price evidence',
        design: '',
        qualityPerformance: '',
      },
    });
    expect(response.status).toBe(201);
    const created = await json<{
      sku: string;
      serialNumber: string;
      notes: string;
      descriptionTh: string;
      shortDescription: string;
      priceRating: number | null;
      features: string[];
      ratingReasons: { price: string };
    }>(response);
    expect(created).toMatchObject({
      sku: expect.stringMatching(/^\d{9,}$/),
      serialNumber: '',
      notes: '',
      descriptionTh: 'คำอธิบายภาษาไทย',
      shortDescription: 'Short copy',
      priceRating: 8,
      features: ['Verified feature'],
      ratingReasons: { price: 'Price evidence' },
    });
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
      targetBodyPart: 'Legs',
      category: 'Other',
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
    expect(denied.status).toBe(401);
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
  it('accepts valid image bytes despite a nonstandard MIME and stores the canonical type', async () => {
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
        { type: 'application/octet-stream' },
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
    expect(object?.httpMetadata?.contentType).toBe('image/png');
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
  it('protects quotation endpoints until a password session is present', async () => {
    expect(
      (await mf.dispatchFetch('https://example.test/api/quotations')).status,
    ).toBe(401);
    expect(
      (await mf.dispatchFetch('https://example.test/api/quotation-settings'))
        .status,
    ).toBe(401);
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
    const receivedRead = new Promise<{
      type: string;
      readerEmail: string;
      lastReadMessageId: number;
    }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for chat read receipt')),
        2_000,
      );
      socket!.addEventListener('message', (event) => {
        const data = JSON.parse(String(event.data));
        if (data.type === 'chat.read') {
          clearTimeout(timeout);
          resolve(data);
        }
      });
    });
    const receivedReaction = new Promise<{
      type: string;
      messageId: number;
      reactions: { emoji: string; count: number; reactedByMe: boolean }[];
    }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for chat reaction update')),
        2_000,
      );
      socket!.addEventListener('message', (event) => {
        const data = JSON.parse(String(event.data));
        if (data.type === 'chat.reaction') {
          clearTimeout(timeout);
          resolve(data);
        }
      });
    });
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
    await request('/chat/read', 'POST', { messageId: sent.id });
    await expect(receivedRead).resolves.toMatchObject({
      type: 'chat.read',
      readerEmail: 'tester@example.test',
      lastReadMessageId: sent.id,
    });
    const reaction = await json<{ reactions: { emoji: string; count: number; reactedByMe: boolean }[] }>(
      await request(`/chat/${sent.id}/reactions`, 'POST', { emoji: '🎉' }),
    );
    expect(reaction.reactions).toEqual([{ emoji: '🎉', count: 1, reactedByMe: true }]);
    await expect(receivedReaction).resolves.toMatchObject({
      type: 'chat.reaction',
      messageId: sent.id,
      reactions: [{ emoji: '🎉', count: 1, reactedByMe: true }],
    });
    socket!.close(1000, 'Test complete');
  });
  it('tracks chat read receipts monotonically and returns per-message reader counts', async () => {
    const older = await json<{ id: number }>(
      await request('/chat', 'POST', {
        requestId: crypto.randomUUID(),
        body: 'Older read receipt test message',
      }),
    );
    const sent = await json<{ id: number; senderEmail: string }>(
      await request('/chat', 'POST', {
        requestId: crypto.randomUUID(),
        body: 'Read receipt test message',
      }),
    );
    const db = await mf.getD1Database('DB');
    await db.prepare(
      'INSERT INTO chat_read_cursors(email,last_read_message_id,updated_at) VALUES(?,?,?)',
    ).bind('second@example.test', sent.id, new Date().toISOString()).run();

    const page = await json<{
      messages: { id: number; readCount: number }[];
      readCursors: { email: string; lastReadMessageId: number }[];
    }>(await request('/chat'));
    expect(page.messages.find((message) => message.id === sent.id)?.readCount).toBe(1);

    const marked = await request('/chat/read', 'POST', { messageId: sent.id });
    expect(marked.status).toBe(200);
    const cursor = await db.prepare(
      'SELECT last_read_message_id AS lastReadMessageId FROM chat_read_cursors WHERE email=?',
    ).bind('tester@example.test').first<{ lastReadMessageId: number }>();
    expect(cursor?.lastReadMessageId).toBe(sent.id);

    await request('/chat/read', 'POST', { messageId: older.id });
    const unchanged = await db.prepare(
      'SELECT last_read_message_id AS lastReadMessageId FROM chat_read_cursors WHERE email=?',
    ).bind('tester@example.test').first<{ lastReadMessageId: number }>();
    expect(unchanged?.lastReadMessageId).toBe(sent.id);
    expect((await request('/chat/read', 'POST', { messageId: 999999 })).status).toBe(404);
  });
  it('toggles persistent reactions and returns counts for the current user', async () => {
    const message = await json<{ id: number }>(
      await request('/chat', 'POST', {
        requestId: crypto.randomUUID(),
        body: 'Reaction test message',
      }),
    );
    const added = await json<{ reactions: { emoji: string; count: number; reactedByMe: boolean }[] }>(
      await request(`/chat/${message.id}/reactions`, 'POST', { emoji: '👍' }),
    );
    expect(added.reactions).toEqual([{ emoji: '👍', count: 1, reactedByMe: true }]);

    const db = await mf.getD1Database('DB');
    await db.prepare(
      'INSERT INTO chat_reactions(message_id,email,emoji,created_at) VALUES(?,?,?,?)',
    ).bind(message.id, 'second@example.test', '👍', new Date().toISOString()).run();
    const feed = await json<{ messages: { id: number; reactions: { emoji: string; count: number; reactedByMe: boolean }[] }[] }>(
      await request('/chat'),
    );
    expect(feed.messages.find((item) => item.id === message.id)?.reactions).toEqual([
      { emoji: '👍', count: 2, reactedByMe: true },
    ]);

    const removed = await json<{ reactions: { emoji: string; count: number; reactedByMe: boolean }[] }>(
      await request(`/chat/${message.id}/reactions`, 'POST', { emoji: '👍' }),
    );
    expect(removed.reactions).toEqual([{ emoji: '👍', count: 1, reactedByMe: false }]);
    expect((await request(`/chat/${message.id}/reactions`, 'POST', { emoji: '🚀' })).status).toBe(422);
    expect((await request('/chat/999999/reactions', 'POST', { emoji: '❤️' })).status).toBe(404);
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
    expect(unauth.status).toBe(401);
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
  it('stores validated mentions and loads a focused message window for notification links', async () => {
    const db = await mf.getD1Database('DB');
    await db.batch([
      db.prepare("INSERT INTO salespeople(email,first_name,last_name,updated_at) VALUES('second@example.test','Second','Teammate',?) ON CONFLICT(email) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,updated_at=excluded.updated_at")
        .bind(new Date().toISOString()),
      db.prepare("INSERT INTO line_accounts(email,line_user_id,enabled,linked_at) VALUES('second@example.test','U' || ?,1,?) ON CONFLICT(email) DO UPDATE SET line_user_id=excluded.line_user_id,enabled=1,linked_at=excluded.linked_at")
        .bind('2'.repeat(32), new Date().toISOString()),
    ]);
    const body = 'Can you review this? @Second Teammate';
    const sent = await request('/chat', 'POST', {
      requestId: crypto.randomUUID(),
      body,
      mentions: [{ email: 'second@example.test', token: '@Second Teammate' }],
    });
    expect(sent.status).toBe(201);
    const message = await json<ChatMessage>(sent);
    expect(message.mentions).toEqual([
      { email: 'second@example.test', token: '@Second Teammate' },
    ]);
    const queue = await db.prepare(
      'SELECT email,status FROM chat_mention_notifications WHERE message_id=?',
    ).bind(message.id).first<{ email: string; status: string }>();
    expect(queue).toBeNull();
    const focused = await json<{ messages: ChatMessage[]; hasMore: boolean }>(
      await request(`/chat?around=${message.id}`),
    );
    expect(focused.messages.some((item) => item.id === message.id)).toBe(true);
    expect(focused.messages.find((item) => item.id === message.id)?.mentions).toEqual(message.mentions);
    expect(focused.hasMore).toBe(true);
    expect((await request(`/chat?around=${message.id}&before=${message.id}`)).status).toBe(422);
  });
  it('does not allow mentioning an email outside the workspace', async () => {
    const response = await request('/chat', 'POST', {
      requestId: crypto.randomUUID(),
      body: 'Hello @outsider',
      mentions: [{ email: 'outsider@example.test', token: '@outsider' }],
    });
    expect(response.status).toBe(422);
  });
});
