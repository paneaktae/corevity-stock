import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import type { Bindings } from '../worker/auth';
import {
  checkGmailHealth,
  cleanupGmail,
  decryptRefreshToken,
  emailAlertText,
  encryptRefreshToken,
  parseMessage,
  processEmailNotifications,
  ruleClassification,
  syncGmail,
  type GmailMessage,
} from '../worker/services/gmail';

let mf: Miniflare;
let env: Bindings;
const mailbox = 'info@corevity.test';
const sales = 'sale@example.test';
const lineUser = 'U' + '2'.repeat(32);
const b64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

function gmailMessage(
  id: string,
  from: string,
  subject: string,
  body: string,
  extra: { labels?: string[]; headers?: Record<string, string>; html?: boolean } = {},
): GmailMessage {
  const headers = [
    { name: 'From', value: from },
    { name: 'To', value: mailbox },
    { name: 'Subject', value: subject },
    ...Object.entries(extra.headers ?? {}).map(([name, value]) => ({ name, value })),
  ];
  return {
    id,
    threadId: `t-${id}`,
    labelIds: extra.labels ?? ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'],
    snippet: body.slice(0, 80),
    internalDate: String(Date.parse('2026-11-10T03:00:00Z')),
    payload: {
      mimeType: 'multipart/alternative',
      headers,
      parts: extra.html
        ? [{ mimeType: 'text/html', body: { data: b64url(`<p>${body}</p><p>Thanks&nbsp;&amp; regards</p>`) } }]
        : [{ mimeType: 'text/plain', body: { data: b64url(body) } }],
    },
  };
}

type Mailbox = {
  historyId: string;
  history: { id: string; labels?: string[] }[];
  listing: string[];
  messages: Record<string, GmailMessage>;
  tokenError?: boolean;
  historyExpired?: boolean;
};
function fakeGoogle(state: Mailbox) {
  const calls: string[] = [];
  const http = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (url.hostname === 'oauth2.googleapis.com')
      return state.tokenError
        ? Response.json({ error: 'invalid_grant' }, { status: 400 })
        : Response.json({ access_token: 'access-token', expires_in: 3599 });
    const path = url.pathname.replace('/gmail/v1/users/me/', '');
    if (path === 'profile') return Response.json({ emailAddress: mailbox, historyId: state.historyId });
    if (path === 'history') {
      if (state.historyExpired) return new Response('{}', { status: 404 });
      return Response.json({
        historyId: state.historyId,
        history: state.history.map((message) => ({ messagesAdded: [{ message: { id: message.id, labelIds: message.labels ?? ['INBOX'] } }] })),
      });
    }
    if (path === 'messages') {
      expect(url.searchParams.get('includeSpamTrash')).toBe('true');
      expect(url.searchParams.get('q')).toContain('-in:trash');
      return Response.json({ messages: state.listing.map((id) => ({ id })) });
    }
    const message = state.messages[decodeURIComponent(path.replace('messages/', ''))];
    return message ? Response.json(message) : new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { http, calls };
}

async function connect(historyId: string | null = null) {
  const token = await encryptRefreshToken(env, mailbox, 'refresh-token-1');
  await env.DB.prepare(
    `INSERT INTO gmail_connection(id,email,status,token_ciphertext,token_nonce,token_key_version,history_id,connected_by,connected_at,updated_at)
     VALUES('workspace',?,'CONNECTED',?,?,?,?,?,?,?)`,
  )
    .bind(mailbox, token.ciphertext, token.nonce, token.keyVersion, historyId, sales, '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z')
    .run();
}

beforeEach(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'gmail-test' },
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
    ALLOWED_EMAILS: sales,
    APP_URL: 'https://crm.example.test',
    GMAIL_MAILBOX: mailbox,
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    META_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    META_TOKEN_ENCRYPTION_KEY_VERSION: 'test-1',
    LINE_CHANNEL_SECRET: 'line-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
  } as unknown as Bindings;
  await db
    .prepare('INSERT INTO line_accounts(email,line_user_id,enabled,linked_at) VALUES(?,?,1,?)')
    .bind(sales, lineUser, '2026-11-01T00:00:00Z')
    .run();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await mf.dispose();
});

describe('Gmail message parsing and customer rules', () => {
  it('reads plain text or HTML bodies and the sender name', () => {
    const plain = parseMessage(gmailMessage('m1', '"Somchai K." <Somchai@Buyer.co.th>', 'ราคาลู่วิ่ง', 'สนใจ Technogym Excite'));
    expect(plain).toMatchObject({ fromName: 'Somchai K.', fromEmail: 'somchai@buyer.co.th', subject: 'ราคาลู่วิ่ง' });
    expect(plain.body).toBe('สนใจ Technogym Excite');
    const html = parseMessage(gmailMessage('m2', 'buyer@example.com', 'Quote', 'Need 3 bikes', { html: true }));
    expect(html.body).toContain('Need 3 bikes');
    expect(html.body).toContain('Thanks & regards');
    expect(html.body).not.toContain('<p>');
  });

  it('treats personal external mail as a possible customer and filters automated mail', () => {
    const classify = (message: GmailMessage) => ruleClassification(parseMessage(message), mailbox);
    expect(classify(gmailMessage('a', 'buyer@gmail.com', 'Hi', 'Price?')).customer).toBe(true);
    expect(classify(gmailMessage('b', 'no-reply@shop.example', 'Order', 'x')).customer).toBe(false);
    expect(classify(gmailMessage('c', 'news@brand.example', 'Sale', 'x', { headers: { 'List-Unsubscribe': '<mailto:u@x>' } })).customer).toBe(false);
    expect(classify(gmailMessage('d', 'team@corevity.test', 'Internal', 'x')).customer).toBe(false);
    expect(classify(gmailMessage('e', 'deals@store.example', 'Promo', 'x', { labels: ['INBOX', 'CATEGORY_PROMOTIONS'] })).customer).toBe(false);
    expect(classify(gmailMessage('f', 'security@accounts.google.com', 'Alert', 'x')).customer).toBe(false);
  });

  it('encrypts the refresh token bound to the mailbox', async () => {
    const stored = await encryptRefreshToken(env, mailbox, 'secret-refresh');
    expect(stored.ciphertext).not.toContain('secret-refresh');
    expect(await decryptRefreshToken(env, mailbox, stored)).toBe('secret-refresh');
    await expect(decryptRefreshToken(env, 'other@corevity.test', stored)).rejects.toThrow('GMAIL_TOKEN_DECRYPTION_FAILED');
  });
});

describe('Gmail sync and LINE alerts', () => {
  it('imports recent mail on first sync without alerting, then alerts on new customer mail only once', async () => {
    await connect();
    const state: Mailbox = {
      historyId: '100',
      history: [],
      listing: ['old1'],
      messages: { old1: gmailMessage('old1', 'old@buyer.example', 'Earlier inquiry', 'Old question') },
    };
    const google = fakeGoogle(state);
    expect(await syncGmail(env, { http: google.http, classifier: null })).toEqual({ status: 'ok', imported: 1, customers: 1 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM email_notifications').first('n')).toBe(0);
    expect(await env.DB.prepare("SELECT history_id FROM gmail_connection WHERE id='workspace'").first('history_id')).toBe('100');

    await env.DB.prepare(
      "INSERT INTO customers(id,name,company_name,contact_name,phone,line_id,email,budget,interested_in,notes,created_at,updated_at) VALUES('cust1','Gym Co','','','','','Owner@GymCo.example',0,'','','','')",
    ).run();
    state.historyId = '140';
    state.history = [{ id: 'new1' }, { id: 'news1' }, { id: 'known1' }, { id: 'new1' }];
    state.messages.new1 = gmailMessage('new1', 'Khun A <a@buyer.example>', 'ขอใบเสนอราคา Life Fitness', 'ต้องการ 5 เครื่อง');
    state.messages.news1 = gmailMessage('news1', 'promo@brand.example', 'Big sale', 'x', { headers: { 'List-Id': 'promo.brand.example' } });
    state.messages.known1 = gmailMessage('known1', 'owner@gymco.example', 'Re: delivery', 'When can you ship?', {
      headers: { 'List-Unsubscribe': '<mailto:x@y>' },
    });
    expect(await syncGmail(env, { http: google.http, classifier: null })).toEqual({ status: 'ok', imported: 3, customers: 2 });
    expect(google.calls.some((call) => call.startsWith('/gmail/v1/users/me/history?startHistoryId=100'))).toBe(true);
    const rows = await env.DB.prepare('SELECT id,classification,reason,customer_id,notified FROM email_messages ORDER BY id').all();
    expect(rows.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'new1', classification: 'CUSTOMER', notified: 1 }),
        expect.objectContaining({ id: 'news1', classification: 'NOT_CUSTOMER', notified: 0 }),
        expect.objectContaining({ id: 'known1', classification: 'CUSTOMER', reason: 'Known customer', customer_id: 'cust1', notified: 1 }),
      ]),
    );
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM email_notifications').first('n')).toBe(2);

    // Re-delivered history entries never create duplicate rows or alerts.
    expect((await syncGmail(env, { http: google.http, classifier: null })).imported).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM email_notifications').first('n')).toBe(2);

    const pushes: { to: string; text: string; retryKey: string | null }[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { to: string; messages: { text: string }[] };
      pushes.push({ to: body.to, text: body.messages[0].text, retryKey: new Headers(init?.headers).get('X-Line-Retry-Key') });
      return new Response('{}', { status: 200 });
    });
    await processEmailNotifications(env);
    expect(pushes).toHaveLength(2);
    expect(pushes.every((push) => push.to === lineUser && push.retryKey)).toBe(true);
    const alert = pushes.find((push) => push.text.includes('ขอใบเสนอราคา'))!;
    expect(alert.text).toContain('Khun A <a@buyer.example>');
    expect(alert.text).toContain('https://crm.example.test/inbox?message=new1');
    expect(pushes.find((push) => push.text.includes('Re: delivery'))!.text).toContain('ลูกค้าที่มีอยู่ในระบบ');
    await processEmailNotifications(env);
    expect(pushes).toHaveLength(2);
  });

  it('uses the AI verdict when enabled and does not alert on non-customers', async () => {
    await connect('100');
    const state: Mailbox = {
      historyId: '110',
      history: [{ id: 'sup1' }],
      listing: [],
      messages: { sup1: gmailMessage('sup1', 'sales@supplier.example', 'We sell dumbbells', 'Wholesale offer') },
    };
    const classifier = vi.fn(async () => ({ customer: false, reason: 'AI: supplier offer' }));
    const result = await syncGmail(env, { http: fakeGoogle(state).http, classifier });
    expect(result).toEqual({ status: 'ok', imported: 1, customers: 0 });
    expect(classifier).toHaveBeenCalledOnce();
    expect(await env.DB.prepare("SELECT reason FROM email_messages WHERE id='sup1'").first('reason')).toBe('AI: supplier offer');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM email_notifications').first('n')).toBe(0);
  });

  it('recovers from expired history and marks the connection for reconnect on a revoked token', async () => {
    await connect('5');
    const state: Mailbox = {
      historyId: '900',
      history: [],
      historyExpired: true,
      listing: ['r1'],
      messages: { r1: gmailMessage('r1', 'buyer@example.org', 'Hello', 'Price list please') },
    };
    expect(await syncGmail(env, { http: fakeGoogle(state).http, classifier: null })).toMatchObject({ status: 'ok', imported: 1 });
    expect(await env.DB.prepare("SELECT history_id FROM gmail_connection WHERE id='workspace'").first('history_id')).toBe('900');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM email_notifications').first('n')).toBe(1);

    state.tokenError = true;
    expect(await syncGmail(env, { http: fakeGoogle(state).http, classifier: null })).toMatchObject({
      status: 'reconnect',
      error: 'GMAIL_RECONNECT_REQUIRED',
    });
    expect(await env.DB.prepare("SELECT status FROM gmail_connection WHERE id='workspace'").first('status')).toBe('RECONNECT_REQUIRED');
    // A connection that needs reconnecting is not polled again.
    expect((await syncGmail(env, { http: fakeGoogle(state).http, classifier: null })).status).toBe('skipped');
  });

  it('imports Junk/Spam mail, flags it and says so in the LINE alert, but ignores sent and trashed mail', async () => {
    await connect('100');
    await env.DB.prepare("UPDATE gmail_connection SET last_sweep_at=?").bind(new Date().toISOString()).run();
    const state: Mailbox = {
      historyId: '120',
      history: [{ id: 'spam1', labels: ['SPAM'] }, { id: 'sent1', labels: ['SENT'] }, { id: 'trash1', labels: ['TRASH'] }],
      listing: [],
      messages: {
        spam1: gmailMessage('spam1', 'Real Buyer <buyer@newgym.example>', 'Quotation for 10 bikes', 'Please quote', { labels: ['SPAM'] }),
        trash1: gmailMessage('trash1', 'x@y.example', 'Deleted', 'x', { labels: ['TRASH'] }),
      },
    };
    const google = fakeGoogle(state);
    expect(await syncGmail(env, { http: google.http, classifier: null })).toEqual({ status: 'ok', imported: 1, customers: 1 });
    expect(google.calls.some((call) => call.includes('/messages/sent1'))).toBe(false);
    expect(google.calls.find((call) => call.includes('/history?'))).not.toContain('labelId');
    expect(await env.DB.prepare("SELECT in_spam FROM email_messages WHERE id='spam1'").first('in_spam')).toBe(1);
    const texts: string[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      texts.push((JSON.parse(String(init?.body)) as { messages: { text: string }[] }).messages[0].text);
      return new Response('{}', { status: 200 });
    });
    await processEmailNotifications(env);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('Junk/Spam');
  });

  it('re-checks the last 2 days hourly and alerts on an email the history feed missed', async () => {
    await connect('100');
    const state: Mailbox = {
      historyId: '101',
      history: [],
      listing: ['missed1'],
      messages: { missed1: gmailMessage('missed1', 'Late Buyer <late@buyer.example>', 'Need a treadmill', 'Hello') },
    };
    const google = fakeGoogle(state);
    const start = Date.now();
    expect(await syncGmail(env, { http: google.http, classifier: null, time: start })).toMatchObject({ imported: 1, customers: 1 });
    expect(await env.DB.prepare("SELECT notified FROM email_messages WHERE id='missed1'").first('notified')).toBe(1);
    const listings = () => google.calls.filter((call) => call.startsWith('/gmail/v1/users/me/messages?')).length;
    expect(listings()).toBe(1);
    await syncGmail(env, { http: google.http, classifier: null, time: start + 10 * 60_000 });
    expect(listings()).toBe(1);
    await syncGmail(env, { http: google.http, classifier: null, time: start + 61 * 60_000 });
    expect(listings()).toBe(2);
  });

  it('alerts the admin on LINE once when the mailbox stops being readable, and again after recovery', async () => {
    env = { ...env, AUTH_ADMIN_EMAIL: sales } as Bindings;
    await connect('100');
    const now = Date.parse('2026-11-10T05:00:00Z');
    const pushes: string[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      pushes.push((JSON.parse(String(init?.body)) as { messages: { text: string }[] }).messages[0].text);
      return new Response('{}', { status: 200 });
    });
    await env.DB.prepare("UPDATE gmail_connection SET last_sync_at=?,last_error='GMAIL_HTTP_500'").bind('2026-11-10T04:50:00Z').run();
    expect(await checkGmailHealth(env, now)).toBe(false); // a short blip is not an incident
    await env.DB.prepare("UPDATE gmail_connection SET last_sync_at=?").bind('2026-11-10T04:20:00Z').run();
    expect(await checkGmailHealth(env, now)).toBe(true);
    expect(pushes[0]).toContain('ระบบตรวจอีเมลหยุดทำงาน');
    expect(pushes[0]).toContain('GMAIL_HTTP_500');
    expect(pushes[0]).toContain('https://crm.example.test/settings?tab=integrations');
    expect(await checkGmailHealth(env, now + 3_600_000)).toBe(false);
    expect(pushes).toHaveLength(1);
    // A successful sync clears the incident; a later revocation alerts again.
    const state: Mailbox = { historyId: '130', history: [], listing: [], messages: {} };
    expect((await syncGmail(env, { http: fakeGoogle(state).http, classifier: null })).status).toBe('ok');
    state.tokenError = true;
    expect((await syncGmail(env, { http: fakeGoogle(state).http, classifier: null })).status).toBe('reconnect');
    expect(await checkGmailHealth(env)).toBe(true);
    expect(pushes[1]).toContain('ต้องเชื่อม Gmail ใหม่');
  });

  it('skips when Gmail is not configured and removes mail older than 90 days', async () => {
    expect((await syncGmail({ ...env, GOOGLE_CLIENT_SECRET: '' } as Bindings)).status).toBe('skipped');
    await env.DB.prepare(
      "INSERT INTO email_messages(id,thread_id,from_email,received_at,classification,created_at) VALUES('old','t','a@b.example','2026-07-01T00:00:00Z','CUSTOMER','2026-07-01T00:00:00Z'),('fresh','t','a@b.example','2026-11-01T00:00:00Z','CUSTOMER','2026-11-01T00:00:00Z')",
    ).run();
    await cleanupGmail(env, Date.parse('2026-11-10T00:00:00Z'));
    const { results } = await env.DB.prepare('SELECT id FROM email_messages').all<{ id: string }>();
    expect(results.map((row) => row.id)).toEqual(['fresh']);
  });

  it('builds a short Thai LINE alert with a CRM link', () => {
    const text = emailAlertText(
      { message_id: 'abc', from_name: '', from_email: 'x@y.example', subject: '', snippet: 'a'.repeat(400), reason: 'Personal' },
      'https://crm.example.test',
    );
    expect(text).toContain('จาก: x@y.example');
    expect(text).toContain('(ไม่มีหัวข้อ)');
    expect(text).toContain('…');
    expect(text.endsWith('https://crm.example.test/inbox?message=abc')).toBe(true);
  });
});
