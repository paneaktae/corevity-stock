import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import type { Bindings } from '../worker/auth';
import {
  handleLineWebhook,
  hashCode,
  processLineReminders,
  type Reminder,
} from '../worker/services/line';
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
});
