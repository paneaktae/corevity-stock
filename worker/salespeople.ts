import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Bindings } from './auth';
import { salespersonInput, type Salesperson } from '../shared/schemas';
import { allowedSales } from './services/line';

export async function listSalespeople(env: Bindings): Promise<Salesperson[]> {
  const emails = [...new Set(allowedSales(env))];
  if (!emails.length) return [];
  const rows = await env.DB.prepare(
    'SELECT email,first_name AS firstName,last_name AS lastName,phone FROM salespeople',
  ).all<Omit<Salesperson, 'lineReady'>>();
  const existing = new Set(rows.results.map((r) => r.email));
  const missing = emails.filter((email) => !existing.has(email));
  if (missing.length) {
    const now = new Date().toISOString();
    await env.DB.batch(
      missing.map((email) =>
        env.DB.prepare(
          'INSERT INTO salespeople(email,updated_at) VALUES(?,?) ON CONFLICT(email) DO NOTHING',
        ).bind(email, now),
      ),
    );
  }
  const linked = await env.DB.prepare(
    'SELECT email FROM line_accounts WHERE enabled=1',
  ).all<{ email: string }>();
  const ready = new Set(linked.results.map((r) => r.email));
  return emails
    .map((email) => ({
      email,
      firstName: '',
      lastName: '',
      phone: '',
      ...rows.results.find((r) => r.email === email),
      lineReady: ready.has(email),
    }))
    .sort((a, b) =>
      (a.firstName || a.email).localeCompare(b.firstName || b.email, 'th'),
    );
}

export const salespeopleRoutes = new Hono<AppEnv>();
salespeopleRoutes.get('/', async (c) => c.json(await listSalespeople(c.env)));
salespeopleRoutes.put('/:email', async (c) => {
  const email = c.req.param('email').trim().toLowerCase();
  if (!allowedSales(c.env).includes(email))
    throw new HTTPException(422, {
      message: 'This salesperson does not have workspace access.',
    });
  const data = salespersonInput.parse(await c.req.json());
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO salespeople(email,first_name,last_name,phone,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,phone=excluded.phone,updated_at=excluded.updated_at',
    ).bind(email, data.firstName, data.lastName, data.phone, now),
    c.env.DB.prepare(
      'INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) VALUES(?,?,?,?,?,?,?)',
    ).bind(
      crypto.randomUUID(),
      'salesperson',
      email,
      'updated',
      'Salesperson profile updated',
      c.get('email'),
      now,
    ),
  ]);
  return c.json({ ok: true });
});
