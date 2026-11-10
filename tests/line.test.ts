import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import type { Bindings } from '../worker/auth';
import {
  handleLineWebhook,
  hashCode,
  processChatMentionNotifications,
  processLineReminders,
  type Reminder,
} from '../worker/services/line';
import { processCalendarReminders, type CalendarReminder } from '../worker/calendar';
import publicCatalog from '../worker/public-catalog';
import { notifyCatalogChat } from '../worker/catalogs';
let mf: Miniflare;
let env: Bindings;
const email = 'sale@example.test',
  userId = 'U' + '1'.repeat(32),
  base = Date.now();
beforeEach(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'line-test' },
    }),
  );
  const db = await mf.getD1Database('DB');
  await db.exec(
    readdirSync('drizzle/migrations')
      .sort()
      .map((f) => readFileSync(`drizzle/migrations/${f}`, 'utf8'))
      .join('\n')
      .replace(/^--.*$/gm, '')
      .replace(/\n/g, ' '),
  );
  env = {
    DB: db,
    ALLOWED_EMAILS: email,
    LINE_CHANNEL_SECRET: 'test-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
    APP_URL: 'https://example.test',
  } as unknown as Bindings;
  await env.DB.prepare(
    "INSERT INTO customers(id,name,company_name,contact_name,phone,line_id,email,budget,interested_in,notes,created_at,updated_at) VALUES('c','Customer','','','','','',0,'','','','')",
  ).run();
  await env.DB.prepare(
    'INSERT INTO line_accounts(email,line_user_id,enabled,linked_at) VALUES(?,?,1,?)',
  )
    .bind(email, userId, new Date(base).toISOString())
    .run();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await mf.dispose();
});
async function lead(id: string, hours = 24, status = 'NEW', owner = email) {
  await env.DB.prepare(
    'INSERT INTO leads(id,customer_id,title,status,estimated_value,last_contact_at,next_follow_up_at,notes,created_at,updated_at,assigned_to) VALUES(?,?,?,?,0,NULL,?,?,?,?,?)',
  )
    .bind(
      id,
      'c',
      'Private title',
      status,
      new Date(base + hours * 3600000).toISOString(),
      'private notes',
      new Date(base).toISOString(),
      new Date(base).toISOString(),
      owner,
    )
    .run();
}
async function webhook(events: unknown[], valid = true) {
  const body = JSON.stringify({ events });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('test-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
      ),
    ),
  );
  return handleLineWebhook(
    new Request('https://example.test/api/line/webhook', {
      method: 'POST',
      body,
      headers: { 'x-line-signature': valid ? sig : 'bad' },
    }),
    env,
  );
}
describe('LINE linking and reminders', () => {
  it('notifies linked workspace members for the first and subsequent website messages', async () => {
    env = { ...env, CATALOG_CHAT_INTERNAL_SECRET: 'internal-test' };
    const invited = 'invited@example.test';
    await env.DB.prepare("INSERT INTO workspace_users(email,is_active,created_by,created_at) VALUES(?,1,?,?)")
      .bind(invited, email, new Date(base).toISOString()).run();
    for (const [account, enabled, digit] of [[invited, 1, '2'], ['removed@example.test', 1, '3'], ['paused@example.test', 0, '4']] as const) {
      await env.DB.prepare('INSERT INTO line_accounts(email,line_user_id,enabled,linked_at) VALUES(?,?,?,?)')
        .bind(account, 'U' + digit.repeat(32), enabled, new Date(base).toISOString()).run();
    }
    const pushes: { to: string; messages: { text: string }[] }[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      pushes.push(JSON.parse(String(init?.body)));
      return Response.json({});
    });
    const notify = vi.fn((request: Request) => notifyCatalogChat(env, request));
    const publicEnv = { DB: env.DB, PRODUCT_IMAGES: env.PRODUCT_IMAGES, CATALOG_CHAT_INTERNAL_SECRET: 'internal-test', MANAGEMENT: { fetch: notify } as unknown as Fetcher };
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const first = await publicCatalog.fetch(new Request('https://catalog.test/api/public/chat/website', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorName: 'Website visitor', visitorPhone: '+66812345678', visitorEmail: 'visitor@example.test', body: 'Hello from website' }),
    }), publicEnv, ctx);
    expect(first.status).toBe(201);
    const { session } = await first.json() as { session: { id: string; token: string } };
    expect(notify).toHaveBeenCalledTimes(1);
    expect(pushes.map((push) => push.to).sort()).toEqual([userId, 'U' + '2'.repeat(32)].sort());
    expect(pushes[0].messages[0].text).toContain('Website inquiry');
    expect(pushes[0].messages[0].text).toContain('Hello from website');
    expect(pushes[0].messages[0].text).toContain(`/catalog-chats?thread=${session.id}`);
    const next = await publicCatalog.fetch(new Request(`https://catalog.test/api/public/chat/${session.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ body: 'A follow-up question' }),
    }), publicEnv, ctx);
    expect(next.status).toBe(201);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(pushes).toHaveLength(4);
    expect(pushes[2].messages[0].text).toContain('A follow-up question');

    // Shared catalog conversations still notify only their assigned salesperson.
    await env.DB.prepare("UPDATE catalog_chats SET source='CATALOG',assigned_email=?,catalog_title='Private catalog' WHERE id=?")
      .bind(email, session.id).run();
    await notifyCatalogChat(env, new Request('https://management.internal/internal/catalog-chat-notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-catalog-chat-secret': 'internal-test' },
      body: JSON.stringify({ threadId: session.id, body: 'Catalog question', products: [] }),
    }));
    expect(pushes).toHaveLength(5);
    expect(pushes[4].to).toBe(userId);
    expect(pushes[4].messages[0].text).toContain('Catalog inquiry · Private catalog');

    // The internal endpoint is publicly reachable, so a wrong or missing secret must be refused.
    const forged: Record<string, string>[] = [{ 'x-catalog-chat-secret': 'internal-tesX' }, { 'x-catalog-chat-secret': 'internal-test-extra' }, {}];
    for (const headers of forged) {
      const refused = await notifyCatalogChat(env, new Request('https://management.internal/internal/catalog-chat-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ threadId: session.id, body: 'Forged', products: [] }),
      }));
      expect(refused.status).toBe(401);
    }
    expect(pushes).toHaveLength(5);
  });

  it('retries team chat mention alerts and links directly to the mentioned message', async () => {
    const recipientEmail = 'mentioned@example.test';
    env = { ...env, ALLOWED_EMAILS: `${email},${recipientEmail}` };
    await env.DB.prepare(
      "INSERT INTO salespeople(email,first_name,last_name,updated_at) VALUES(?,?,?,?)",
    ).bind(email, 'Sale', 'Sender', new Date(base).toISOString()).run();
    await env.DB.prepare(
      'INSERT INTO line_accounts(email,line_user_id,enabled,linked_at) VALUES(?,?,1,?)',
    ).bind(recipientEmail, 'U' + '3'.repeat(32), new Date(base).toISOString()).run();
    const inserted = await env.DB.prepare(
      'INSERT INTO chat_messages(request_id,sender_email,body,mentions,product_ids,created_at) VALUES(?,?,?,?,?,?)',
    ).bind(
      crypto.randomUUID(), email, 'Please review this @Teammate',
      JSON.stringify([{ email: recipientEmail, token: '@Teammate' }]), '[]', new Date(base).toISOString(),
    ).run();
    const messageId = Number(inserted.meta.last_row_id);
    const jobId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO chat_mention_notifications(id,message_id,email,line_user_id,status,attempts,created_at,next_attempt_at) VALUES(?,?,?,?,'pending',0,?,?)",
    ).bind(jobId, messageId, recipientEmail, 'U' + '3'.repeat(32), new Date(base).toISOString(), new Date(base).toISOString()).run();

    const sends: { retryKey: string | null; text: string }[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: { text: string }[] };
      sends.push({ retryKey: new Headers(init?.headers).get('X-Line-Retry-Key'), text: body.messages[0].text });
      return new Response('{}', { status: sends.length === 1 ? 503 : 200 });
    });
    await processChatMentionNotifications(env, base);
    await processChatMentionNotifications(env, base + 60_000);
    await processChatMentionNotifications(env, base + 2 * 60_000);
    expect(sends).toHaveLength(2);
    expect(sends[0].retryKey).toBe(jobId);
    expect(sends[1].retryKey).toBe(jobId);
    expect(sends[1].text).toContain('Sale Sender mentioned you');
    expect(sends[1].text).toContain(`/chat?message=${messageId}`);
    const job = await env.DB.prepare(
      'SELECT status,sent_at FROM chat_mention_notifications WHERE id=?',
    ).bind(jobId).first<{ status: string; sent_at: string | null }>();
    expect(job?.status).toBe('sent');
    expect(job?.sent_at).toBeTruthy();
  });

  it('rejects forged signatures and accepts LINE verification with no events', async () => {
    expect((await webhook([], false)).status).toBe(401);
    expect((await webhook([])).status).toBe(200);
  });
  it('links only a private chat with a fresh one-time code and does not reassign a used identity', async () => {
    const code = 'a'.repeat(32),
      newUser = 'U' + '2'.repeat(32);
    await env.DB.prepare('INSERT INTO line_link_codes VALUES(?,?,?)')
      .bind(
        email,
        await hashCode(code),
        new Date(Date.now() + 600000).toISOString(),
      )
      .run();
    const event = {
      type: 'message',
      timestamp: Date.now(),
      source: { type: 'group', userId: newUser },
      message: { type: 'text', text: `COREVITY ${code}` },
    };
    await webhook([event]);
    expect(
      (
        await env.DB.prepare('SELECT line_user_id FROM line_accounts').first<{
          line_user_id: string;
        }>()
      )?.line_user_id,
    ).toBe(userId);
    event.source.type = 'user';
    await webhook([event]);
    expect(
      (
        await env.DB.prepare('SELECT line_user_id FROM line_accounts').first<{
          line_user_id: string;
        }>()
      )?.line_user_id,
    ).toBe(newUser);
    event.source.userId = userId;
    await webhook([event]);
    expect(
      (
        await env.DB.prepare('SELECT line_user_id FROM line_accounts').first<{
          line_user_id: string;
        }>()
      )?.line_user_id,
    ).toBe(newUser);
  });
  it('ignores expired codes and stops reminders on unfollow', async () => {
    await env.DB.prepare('INSERT INTO line_link_codes VALUES(?,?,?)')
      .bind(
        email,
        await hashCode('b'.repeat(32)),
        new Date(base - 1000).toISOString(),
      )
      .run();
    await webhook([
      {
        type: 'message',
        timestamp: Date.now(),
        source: { type: 'user', userId: 'U' + '2'.repeat(32) },
        message: { type: 'text', text: 'COREVITY ' + 'b'.repeat(32) },
      },
    ]);
    await webhook([
      {
        type: 'unfollow',
        timestamp: Date.now(),
        source: { type: 'user', userId },
      },
    ]);
    expect(
      (
        await env.DB.prepare('SELECT enabled FROM line_accounts').first<{
          enabled: number;
        }>()
      )?.enabled,
    ).toBe(0);
  });
  it('sends once inside 24 hours, skips closed/unassigned/past/future, and shares only time and protected link', async () => {
    await lead('due');
    await lead('later', 25);
    await lead('past', -1);
    await lead('closed', 10, 'LOST');
    await lead('unassigned', 10, 'NEW', '');
    const messages: string[] = [];
    const send = async (_env: Bindings, _r: Reminder, text: string) => {
      messages.push(text);
      return { ok: true, retryable: false };
    };
    await Promise.all([
      processLineReminders(env, base, send),
      processLineReminders(env, base, send),
    ]);
    await processLineReminders(env, base + 300000, send);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('/sales/due');
    expect(messages[0]).not.toContain('Private title');
    expect(messages[0]).not.toContain('private notes');
  });
  it('retries with the same idempotency key and cancels after rescheduling or reassignment', async () => {
    await lead('retry', 20);
    const keys: string[] = [];
    const retry = async (_env: Bindings, r: Reminder) => {
      keys.push(r.id);
      return { ok: false, retryable: true, error: 'LINE_HTTP_503' };
    };
    await processLineReminders(env, base, retry);
    await processLineReminders(env, base + 300000, retry);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await env.DB.prepare(
      "UPDATE leads SET next_follow_up_at=? WHERE id='retry'",
    )
      .bind(new Date(base + 48 * 3600000).toISOString())
      .run();
    await processLineReminders(env, base + 900000, retry);
    expect(keys).toHaveLength(2);
    expect(
      (
        await env.DB.prepare('SELECT status FROM line_reminders').first<{
          status: string;
        }>()
      )?.status,
    ).toBe('cancelled');
  });
  it('does not send for paused or removed salespeople and stops permanent failures', async () => {
    await lead('due', 10);
    await env.DB.prepare('UPDATE line_accounts SET enabled=0').run();
    let sends = 0;
    const send = async () => {
      sends++;
      return { ok: false, retryable: false, error: 'LINE_HTTP_401' };
    };
    await processLineReminders(env, base, send);
    expect(sends).toBe(0);
    await env.DB.prepare('UPDATE line_accounts SET enabled=1').run();
    await processLineReminders({ ...env, ALLOWED_EMAILS: '' }, base, send);
    expect(sends).toBe(0);
    await processLineReminders(env, base, send);
    await processLineReminders(env, base + 3600000, send);
    expect(sends).toBe(1);
  });
  it('sends one private LINE reminder to each invited attendee at the selected lead time', async () => {
    const startsAt = new Date(base + 2 * 3600000).toISOString();
    await env.DB.prepare(
      'INSERT INTO calendar_events(id,title,details,location,starts_at,ends_at,reminder_minutes,created_by,created_at,updated_at) VALUES(?,?,?,?,?,NULL,60,?,?,?)',
    ).bind('team-event', 'Quarterly team review', 'Do not send these private notes', 'Bangkok office', startsAt, email, new Date(base).toISOString(), new Date(base).toISOString()).run();
    await env.DB.prepare('INSERT INTO calendar_event_attendees(event_id,email) VALUES(?,?)').bind('team-event', email).run();
    const sent: { job: CalendarReminder; text: string }[] = [];
    const send = async (_env: Bindings, job: CalendarReminder, text: string) => {
      sent.push({ job, text });
      return { ok: true, retryable: false };
    };
    await processCalendarReminders(env, base + 3600000, send);
    await processCalendarReminders(env, base + 3900000, send);
    expect(sent).toHaveLength(1);
    expect(sent[0].job.email).toBe(email);
    expect(sent[0].text).toContain('Quarterly team review');
    expect(sent[0].text).toContain('Bangkok office');
    const eventDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(startsAt));
    expect(sent[0].text).toContain(`/calendar?date=${eventDay}&event=team-event`);
    expect(sent[0].text).not.toContain('Do not send these private notes');
    const reminder = await env.DB.prepare('SELECT status FROM calendar_reminders WHERE event_id=?').bind('team-event').first<{ status: string }>();
    expect(reminder?.status).toBe('sent');
  });
});

describe('LINE status and test message', () => {
  async function call(path: string, init: RequestInit = {}) {
    const { Hono } = await import('hono');
    const { lineRoutes } = await import('../worker/line-routes');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('email' as never, email as never);
      await next();
    });
    app.route('/', lineRoutes as never);
    return app.request(path, init, env as never);
  }

  it('pushes a test message only to the signed-in user and explains a monthly-limit rejection', async () => {
    const pushes: { to: string }[] = [];
    let status = 200;
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      pushes.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status });
    });
    const ok = await call('/test', { method: 'POST' });
    expect(ok.status).toBe(200);
    expect(pushes).toEqual([expect.objectContaining({ to: userId })]);
    status = 429;
    const limited = await call('/test', { method: 'POST' });
    expect(limited.status).toBe(502);
    expect(JSON.stringify(await limited.json())).toContain('monthly');
    await env.DB.prepare('UPDATE line_accounts SET enabled=0').run();
    expect((await call('/test', { method: 'POST' })).status).toBe(422);
    expect(pushes).toHaveLength(2);
  });

  it('shows the monthly message quota in the status', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/info')) return Response.json({ basicId: '@corevity' });
      if (url.endsWith('/webhook/endpoint')) return Response.json({ endpoint: 'https://example.test/api/line/webhook', active: true });
      if (url.endsWith('/quota')) return Response.json({ type: 'limited', value: 200 });
      if (url.endsWith('/quota/consumption')) return Response.json({ totalUsage: 37 });
      return new Response('{}', { status: 404 });
    });
    const body = (await (await call('/status')).json()) as { quota: unknown; webhookActive: boolean };
    expect(body.quota).toEqual({ type: 'limited', limit: 200, used: 37 });
    expect(body.webhookActive).toBe(true);
  });
});
