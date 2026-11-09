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
  reclassifyStoredEmails,
  sanitizeEmailHtml,
  loadMessageHtml,
  loadThread,
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
      if (url.searchParams.get('q')?.startsWith('in:sent')) return Response.json({ messages: [] });
      expect(url.searchParams.get('includeSpamTrash')).toBe('true');
      expect(url.searchParams.get('q')).toContain('-in:trash');
      return Response.json({ messages: state.listing.map((id) => ({ id })) });
    }
    const message = state.messages[decodeURIComponent(path.replace('messages/', ''))];
    return message ? Response.json(message) : new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { http, calls };
}

async function connect(historyId: string | null = null, backfillDone = true) {
  const token = await encryptRefreshToken(env, mailbox, 'refresh-token-1');
  await env.DB.prepare(
    `INSERT INTO gmail_connection(id,email,status,token_ciphertext,token_nonce,token_key_version,history_id,connected_by,connected_at,updated_at,backfill_done,sent_backfill_done)
     VALUES('workspace',?,'CONNECTED',?,?,?,?,?,?,?,?,?)`,
  )
    .bind(mailbox, token.ciphertext, token.nonce, token.keyVersion, historyId, sales, '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z', Number(backfillDone), Number(backfillDone))
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

  it('moves ads, newsletters and sign-in/OTP notifications out of the inbox by content and headers', () => {
    const classify = (message: GmailMessage) => ruleClassification(parseMessage(message), mailbox);
    const verdict = (subject: string, body: string, headers: Record<string, string> = {}) =>
      classify(gmailMessage('x', 'Shop <hello@shop.example>', subject, body, { headers }));
    expect(verdict('Your weekly picks', 'Great deals. Click here to unsubscribe.')).toMatchObject({ customer: false, reason: 'Advertising or newsletter' });
    expect(verdict('ข่าวสาร', 'หากไม่ต้องการรับ กด ยกเลิกการรับข่าวสาร')).toMatchObject({ customer: false });
    expect(verdict('Flash sale: 30% off today', 'Shop now')).toMatchObject({ customer: false, reason: 'Advertising or newsletter' });
    expect(verdict('Your verification code is 123456', 'Use it within 10 minutes')).toMatchObject({ customer: false, reason: 'Sign-in or security notification' });
    expect(verdict('มีการเข้าสู่ระบบจากอุปกรณ์ใหม่', 'x')).toMatchObject({ customer: false });
    expect(verdict('Order shipped', 'This is an automated message, please do not reply to this email.')).toMatchObject({ customer: false, reason: 'Automated notification' });
    expect(verdict('Hello', 'x', { 'Feedback-ID': '123:campaign:mailchimp' })).toMatchObject({ customer: false });
    expect(verdict('Hello', 'x', { 'X-Mailer': 'Klaviyo' })).toMatchObject({ customer: false });
    // Real customers mentioning login or discounts stay in the inbox.
    expect(verdict('ขอส่วนลดลู่วิ่ง 2 เครื่อง', 'ลูกค้าเข้าสู่ระบบเว็บไม่ได้ เลยส่งอีเมลมาแทน')).toMatchObject({ customer: true });
    expect(verdict('Quote please', 'We need 4 bikes, can you login to share the price list?')).toMatchObject({ customer: true });
  });

  it('strips scripts, handlers and dangerous links from HTML while keeping layout styles', () => {
    const out = sanitizeEmailHtml(
      `<p onclick="evil()" style="color:red">Hi <a href="javascript:alert(1)">x</a> <a href='https://ok.example'>ok</a></p><script>alert(1)</script><iframe src="x"></iframe><img src=x onerror=alert(1)><form action="y"><input name=a></form><!-- c --><meta http-equiv=refresh content=0><svg><script>1</script></svg><a href=" JavaScript:x">y</a>`,
    );
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|<iframe|<form|<input|<meta|<svg/i);
    expect(out).toContain('style="color:red"');
    expect(out).toContain("href='https://ok.example'");
    expect(sanitizeEmailHtml('   ')).toBe('');
    const parsed = parseMessage(gmailMessage('h', 'a@b.example', 'Hi', 'Hello there', { html: true }));
    expect(parsed.html).toContain('<p>Hello there</p>');
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
    expect(await syncGmail(env, { http: google.http, classifier: null })).toMatchObject({ status: 'ok', imported: 1, customers: 1 });
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
    expect(await syncGmail(env, { http: google.http, classifier: null })).toMatchObject({ status: 'ok', imported: 3, customers: 2 });
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
    expect(result).toMatchObject({ status: 'ok', imported: 1, customers: 0 });
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
    expect(await syncGmail(env, { http: google.http, classifier: null })).toMatchObject({ status: 'ok', imported: 1, customers: 1 });
    // Sent mail is only looked up (format=minimal) for reply tracking, never imported into the inbox.
    expect(google.calls.some((call) => call.includes('/messages/sent1?format=full'))).toBe(false);
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
    const listings = () =>
      google.calls.filter((call) => call.startsWith('/gmail/v1/users/me/messages?') && !call.includes('q=in%3Asent')).length;
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

  it('backfills the last 90 days a page per run without alerts, then stops', async () => {
    await connect('100', false);
    await env.DB.prepare("UPDATE gmail_connection SET last_sweep_at=?").bind(new Date().toISOString()).run();
    const pages: Record<string, { ids: string[]; next?: string }> = {
      '': { ids: ['b1', 'b2'], next: 'p2' },
      p2: { ids: ['b3'] },
    };
    const messages: Record<string, GmailMessage> = {
      b1: gmailMessage('b1', 'old1@buyer.example', 'Old 1', 'x'),
      b2: gmailMessage('b2', 'old2@buyer.example', 'Old 2', 'x', { labels: ['SPAM'] }),
      b3: gmailMessage('b3', 'old3@buyer.example', 'Old 3', 'x'),
    };
    const seen: string[] = [];
    const http = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'a' });
      const path = url.pathname.replace('/gmail/v1/users/me/', '');
      if (path === 'history') return Response.json({ historyId: '100', history: [] });
      if (path === 'messages') {
        if (url.searchParams.get('q')?.startsWith('in:sent')) return Response.json({ messages: [] });
        expect(url.searchParams.get('q')).toContain('newer_than:90d');
        const page = pages[url.searchParams.get('pageToken') ?? ''];
        seen.push(url.searchParams.get('pageToken') ?? 'first');
        return Response.json({ messages: page.ids.map((id) => ({ id })), nextPageToken: page.next });
      }
      return Response.json(messages[decodeURIComponent(path.replace('messages/', ''))]);
    }) as typeof fetch;
    expect(await syncGmail(env, { http, classifier: null })).toMatchObject({ imported: 2, backfillDone: false });
    expect(await syncGmail(env, { http, classifier: null })).toMatchObject({ imported: 1, backfillDone: true });
    expect(await syncGmail(env, { http, classifier: null })).toMatchObject({ imported: 0, backfillDone: true });
    expect(seen).toEqual(['first', 'p2']);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM email_messages').first('n')).toBe(3);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM email_notifications').first('n')).toBe(0);
    expect(await env.DB.prepare("SELECT in_spam FROM email_messages WHERE id='b2'").first('in_spam')).toBe(1);
  });

  it('fetches and stores HTML once for emails saved before HTML support', async () => {
    await connect('100');
    await env.DB.prepare(
      "INSERT INTO email_messages(id,thread_id,from_email,received_at,classification,created_at) VALUES('legacy','t','a@b.example','2026-11-10T00:00:00Z','CUSTOMER','2026-11-10T00:00:00Z')",
    ).run();
    const state: Mailbox = {
      historyId: '1',
      history: [],
      listing: [],
      messages: { legacy: gmailMessage('legacy', 'a@b.example', 'Hi', 'Rich <b>content</b>', { html: true }) },
    };
    expect(await loadMessageHtml(env, 'legacy', fakeGoogle(state).http)).toContain('<b>content</b>');
    expect(await env.DB.prepare("SELECT body_html FROM email_messages WHERE id='legacy'").first('body_html')).toContain('<b>content</b>');
  });

  it('caps Gmail calls per run and resumes the backfill page on the next run', async () => {
    await connect('100', false);
    await env.DB.prepare("UPDATE gmail_connection SET last_sweep_at=?").bind(new Date().toISOString()).run();
    const ids = Array.from({ length: 40 }, (_, i) => `m${i}`);
    let calls = 0;
    const http = (async (input: RequestInfo | URL) => {
      calls++;
      const url = new URL(String(input));
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'a' });
      const path = url.pathname.replace('/gmail/v1/users/me/', '');
      if (path === 'history') return Response.json({ historyId: '100', history: [] });
      if (path === 'messages') return Response.json({ messages: ids.map((id) => ({ id })) });
      const id = decodeURIComponent(path.replace('messages/', ''));
      return Response.json(gmailMessage(id, `${id}@buyer.example`, id, 'x'));
    }) as typeof fetch;
    const first = await syncGmail(env, { http, classifier: null });
    expect(calls).toBeLessThanOrEqual(35);
    expect(first).toMatchObject({ status: 'ok', backfillDone: false });
    calls = 0;
    const second = await syncGmail(env, { http, classifier: null });
    expect(first.imported).toBeLessThan(40);
    expect(first.imported + second.imported).toBe(40);
    expect(second.backfillDone).toBe(true);
  });

  it('records the underlying error for unexpected failures', async () => {
    await connect('100');
    const http = (async (input: RequestInfo | URL) => {
      if (new URL(String(input)).hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'a' });
      throw new TypeError('Too many subrequests.');
    }) as typeof fetch;
    expect((await syncGmail(env, { http, classifier: null })).error).toBe('GMAIL_SYNC_FAILED: TypeError Too many subrequests.');
  });

  it('re-checks emails stored under the old rule once', async () => {
    await env.DB.prepare(
      `INSERT INTO email_messages(id,thread_id,from_email,subject,body_text,received_at,classification,reason,created_at) VALUES
       ('n1','t','a@shop.example','Deals','Click to unsubscribe','2026-11-10T00:00:00Z','CUSTOMER','Personal email from an external sender','2026-11-10T00:00:00Z'),
       ('p1','t','b@buyer.example','Price?','Need a treadmill','2026-11-10T00:00:00Z','CUSTOMER','Personal email from an external sender','2026-11-10T00:00:00Z'),
       ('m1','t','c@x.example','Hi','unsubscribe','2026-11-10T00:00:00Z','CUSTOMER','Marked by sale@example.test','2026-11-10T00:00:00Z')`,
    ).run();
    expect(await reclassifyStoredEmails(env)).toBe(2);
    const rows = (await env.DB.prepare('SELECT id,classification,reason FROM email_messages ORDER BY id').all()).results;
    expect(rows).toEqual([
      { id: 'm1', classification: 'CUSTOMER', reason: 'Marked by sale@example.test' },
      { id: 'n1', classification: 'NOT_CUSTOMER', reason: 'Advertising or newsletter' },
      { id: 'p1', classification: 'CUSTOMER', reason: 'Email from a person outside the company' },
    ]);
    expect(await reclassifyStoredEmails(env)).toBe(0);
  });

  it('marks threads as replied from sent mail (history and 90-day backfill), skipping unknown threads', async () => {
    await connect('100');
    await env.DB.prepare("UPDATE gmail_connection SET last_sweep_at=?,sent_backfill_done=0").bind(new Date().toISOString()).run();
    await env.DB.prepare(
      `INSERT INTO email_messages(id,thread_id,from_email,received_at,classification,created_at) VALUES
       ('c1','th1','a@buyer.example','2026-11-08T01:00:00Z','CUSTOMER','2026-11-08T01:00:00Z'),
       ('c2','th2','b@buyer.example','2026-11-08T02:00:00Z','CUSTOMER','2026-11-08T02:00:00Z'),
       ('c3','th3','c@buyer.example','2026-11-09T05:00:00Z','CUSTOMER','2026-11-09T05:00:00Z')`,
    ).run();
    const sentMessages: Record<string, { threadId: string; at: string }> = {
      s1: { threadId: 'th1', at: '2026-11-08T03:00:00Z' }, // reply after the customer email
      s2: { threadId: 'th3', at: '2026-11-09T01:00:00Z' }, // sent BEFORE the customer email: not a reply to it
      s3: { threadId: 'other', at: '2026-11-08T04:00:00Z' }, // thread not in the CRM: never fetched
      s4: { threadId: 'th2', at: '2026-11-09T09:00:00Z' }, // arrives via history
    };
    const fetched: string[] = [];
    const http = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'a' });
      const path = url.pathname.replace('/gmail/v1/users/me/', '');
      if (path === 'history')
        return Response.json({ historyId: '101', history: [{ messagesAdded: [{ message: { id: 's4', threadId: 'th2', labelIds: ['SENT'] } }] }] });
      if (path === 'messages') {
        expect(url.searchParams.get('q')).toBe('in:sent newer_than:90d');
        return Response.json({ messages: ['s1', 's2', 's3'].map((id) => ({ id, threadId: sentMessages[id].threadId })) });
      }
      const id = decodeURIComponent(path.replace('messages/', ''));
      fetched.push(id);
      expect(url.searchParams.get('format')).toBe('minimal');
      return Response.json({ id, threadId: sentMessages[id].threadId, labelIds: ['SENT'], internalDate: String(Date.parse(sentMessages[id].at)) });
    }) as typeof fetch;
    expect((await syncGmail(env, { http, classifier: null })).status).toBe('ok');
    expect(fetched.sort()).toEqual(['s1', 's2', 's4']);
    const rows = (await env.DB.prepare('SELECT id,replied_at FROM email_messages ORDER BY id').all()).results;
    expect(rows).toEqual([
      { id: 'c1', replied_at: '2026-11-08T03:00:00.000Z' },
      { id: 'c2', replied_at: '2026-11-09T09:00:00.000Z' },
      { id: 'c3', replied_at: null },
    ]);
    expect(await env.DB.prepare("SELECT sent_backfill_done FROM gmail_connection").first('sent_backfill_done')).toBe(1);
  });

  it('loads the whole conversation including our replies, in order', async () => {
    await connect('100');
    await env.DB.prepare(
      "INSERT INTO email_messages(id,thread_id,from_email,received_at,classification,created_at) VALUES('q1','thr','buyer@x.example','2026-11-10T01:00:00Z','CUSTOMER','2026-11-10T01:00:00Z')",
    ).run();
    const question = { ...gmailMessage('q1', 'Buyer <buyer@x.example>', 'Price?', 'How much?'), threadId: 'thr', internalDate: String(Date.parse('2026-11-10T01:00:00Z')) };
    const answer = {
      ...gmailMessage('a1', `Corevity <${mailbox}>`, 'Re: Price?', 'It is 50,000 THB', { labels: ['SENT'], html: true }),
      threadId: 'thr',
      internalDate: String(Date.parse('2026-11-10T02:00:00Z')),
    };
    const draft = { ...gmailMessage('d1', `Corevity <${mailbox}>`, 'Re: Price?', 'draft', { labels: ['DRAFT'] }), threadId: 'thr' };
    const http = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'a' });
      expect(url.pathname).toBe('/gmail/v1/users/me/threads/thr');
      return Response.json({ messages: [answer, draft, question] });
    }) as typeof fetch;
    const thread = await loadThread(env, 'thr', http);
    expect(thread?.map((m) => [m.id, m.sent])).toEqual([['q1', false], ['a1', true]]);
    expect(thread?.[1].bodyHtml).toContain('50,000 THB');
    expect(await env.DB.prepare("SELECT replied_at FROM email_messages WHERE id='q1'").first('replied_at')).toBe('2026-11-10T02:00:00.000Z');
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
