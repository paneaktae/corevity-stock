import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from './auth';
import {
  allowedSales,
  hashCode,
  lineConfigured,
  lineRequest,
} from './services/line';
export const lineRoutes = new Hono<AppEnv>();
lineRoutes.get('/status', async (c) => {
  const account = await c.env.DB.prepare(
    'SELECT enabled,linked_at FROM line_accounts WHERE email=?',
  )
    .bind(c.get('email'))
    .first<{ enabled: number; linked_at: string }>();
  const latest = await c.env.DB.prepare(
    'SELECT status,sent_at,last_error,appointment_at FROM line_reminders WHERE email=? ORDER BY created_at DESC LIMIT 5',
  )
    .bind(c.get('email'))
    .all();
  let botId: string | null = null;
  let providerError = '';
  let webhookActive = false;
  if (lineConfigured(c.env)) {
    try {
      const r = await lineRequest(c.env, 'info');
      if (r.ok) {
        const info = (await r.json()) as { basicId?: string };
        botId = info.basicId ?? null;
        const check = await lineRequest(c.env, 'channel/webhook/endpoint');
        if (check.ok) {
          const hook = (await check.json()) as {
            endpoint?: string;
            active?: boolean;
          };
          webhookActive =
            hook.active === true &&
            hook.endpoint === `${c.env.APP_URL}/api/line/webhook`;
        }
      } else {
        providerError =
          r.status === 401
            ? 'LINE access token is invalid. Ask your administrator to update it.'
            : 'Could not verify LINE configuration. Please try again.';
      }
    } catch {
      providerError = 'Could not verify LINE configuration. Please try again.';
    }
  }
  return c.json({
    configured: lineConfigured(c.env),
    linked: !!account,
    enabled: !!account?.enabled,
    linkedAt: account?.linked_at ?? null,
    botId,
    providerError,
    webhookActive,
    recent: latest.results,
  });
});
lineRoutes.post('/link', async (c) => {
  if (!lineConfigured(c.env))
    return c.json({ error: { message: 'LINE is not configured.' } }, 503);
  const code = crypto.randomUUID().replaceAll('-', '');
  const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
  await c.env.DB.prepare(
    'INSERT INTO line_link_codes(email,code_hash,expires_at) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at',
  )
    .bind(c.get('email'), await hashCode(code), expiresAt)
    .run();
  return c.json({ code: `COREVITY ${code}`, expiresAt });
});
lineRoutes.patch('/preferences', async (c) => {
  const { enabled } = z
    .object({ enabled: z.boolean() })
    .parse(await c.req.json());
  const result = await c.env.DB.prepare(
    'UPDATE line_accounts SET enabled=? WHERE email=?',
  )
    .bind(enabled ? 1 : 0, c.get('email'))
    .run();
  if (!result.meta.changes)
    return c.json(
      { error: { message: 'Connect your LINE account first.' } },
      422,
    );
  return c.json({ ok: true });
});
lineRoutes.delete('/link', async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM line_accounts WHERE email=?').bind(
      c.get('email'),
    ),
    c.env.DB.prepare('DELETE FROM line_link_codes WHERE email=?').bind(
      c.get('email'),
    ),
    c.env.DB.prepare(
      "UPDATE line_reminders SET status='cancelled' WHERE email=? AND status='pending'",
    ).bind(c.get('email')),
  ]);
  return c.json({ ok: true });
});
lineRoutes.get('/salespeople', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT email,enabled FROM line_accounts',
  ).all<{ email: string; enabled: number }>();
  return c.json(
    allowedSales(c.env).map((email) => ({
      email,
      lineReady: rows.results.some((r) => r.email === email && r.enabled === 1),
    })),
  );
});
