import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, FormData } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { parseDescriptions } from '../worker/services/ai';
let mf: Miniflare;
beforeAll(async () => {
  const result = await build({
    entryPoints: ['worker/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    define: { 'import.meta.env.DEV': 'true' },
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: result.outputFiles[0].text,
      compatibilityDate: '2026-10-09',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'test-db' },
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
  it('serves bound static assets with security headers', async () => {
    const response = await mf.dispatchFetch('http://localhost/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html>App</html>');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('creates, reads, searches, updates and archives equipment', async () => {
    const p = await product('Cybex');
    expect(p.sku).toMatch(/^EQ-\d{4}-\d{4}$/);
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
describe('AI response validation', () => {
  const valid = {
    descriptionTh: 'อุปกรณ์ฟิตเนส',
    descriptionEn: 'Fitness equipment',
    shortDescription: 'Used equipment',
    facebookCaption: 'อุปกรณ์พร้อมขาย',
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
