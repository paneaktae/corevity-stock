import type { Bindings } from '../auth';
import { lineConfigured, lineRequest, workspaceSalesEmails } from './line';

// Read-only Gmail inbox for the company mailbox. Nothing here sends, labels or
// deletes mail: the only Google scope requested is gmail.readonly.
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const RETENTION_DAYS = 90;
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MAX_MESSAGES_PER_SYNC = 40;
// Inbox and Junk (Spam): includeSpamTrash=true with trash/sent/drafts excluded by query.
const MAILBOX_SCOPE = '-in:sent -in:drafts -in:trash -in:chats';
const FIRST_SYNC_QUERY = `newer_than:3d ${MAILBOX_SCOPE}`;
// Safety net: re-list recent mail every hour so a missed history entry can't hide an email.
const SWEEP_QUERY = `newer_than:2d ${MAILBOX_SCOPE}`;
const SWEEP_INTERVAL_MS = 60 * 60_000;
// Alert when the mailbox has not been read successfully for this long.
export const HEALTH_ALERT_AFTER_MS = 30 * 60_000;
const BODY_LIMIT = 20_000;
const HTML_LIMIT = 400_000;
// Backfill: the last 90 days (matches retention), one page per sync run, without LINE alerts.
const BACKFILL_QUERY = `newer_than:${90}d -in:sent -in:drafts -in:trash -in:chats`;
const BACKFILL_PAGE = 25;
const SENT_SWEEP_QUERY = 'in:sent newer_than:2d';
const SENT_BACKFILL_QUERY = 'in:sent newer_than:90d';
// Outbound calls per sync run (token, Gmail API, AI). Workers cap subrequests per invocation and
// the cron shares that budget with LINE and other jobs, so stay well below it and resume next run.
const MAX_CALLS_PER_SYNC = 35;

export type Http = typeof fetch;

export function gmailConfig(env: Bindings) {
  const mailbox = (env.GMAIL_MAILBOX ?? '').trim().toLowerCase();
  let redirectUri = '';
  try {
    if (env.APP_URL) redirectUri = new URL('/api/integrations/gmail/callback', env.APP_URL).href;
  } catch {
    redirectUri = '';
  }
  const encryption = Boolean(
    env.META_TOKEN_ENCRYPTION_KEY &&
      /^[A-Za-z0-9+/]{43}=$/.test(env.META_TOKEN_ENCRYPTION_KEY) &&
      env.META_TOKEN_ENCRYPTION_KEY_VERSION &&
      /^[A-Za-z0-9_-]{1,32}$/.test(env.META_TOKEN_ENCRYPTION_KEY_VERSION),
  );
  const missing = [
    !env.GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID',
    !env.GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET',
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mailbox) && 'GMAIL_MAILBOX',
    !redirectUri.startsWith('https://') && !redirectUri.startsWith('http://localhost') && 'APP_URL',
    !encryption && 'META_TOKEN_ENCRYPTION_KEY',
  ].filter((value): value is string => Boolean(value));
  return { ready: missing.length === 0, missing, mailbox, redirectUri };
}

// --- Token encryption (AES-GCM, shared workspace key, Gmail-specific AAD) ---
const encoder = new TextEncoder();
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
async function encryptionKey(env: Bindings) {
  if (gmailConfig(env).missing.includes('META_TOKEN_ENCRYPTION_KEY')) throw new Error('GMAIL_ENCRYPTION_NOT_CONFIGURED');
  return crypto.subtle.importKey('raw', fromBase64(env.META_TOKEN_ENCRYPTION_KEY!), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const aad = (version: string, mailbox: string) =>
  encoder.encode(JSON.stringify(['corevity:gmail:refresh-token:v1', version, mailbox]));
export async function encryptRefreshToken(env: Bindings, mailbox: string, token: string) {
  if (!token.trim() || token.length > 4096) throw new Error('GMAIL_TOKEN_INVALID');
  const version = env.META_TOKEN_ENCRYPTION_KEY_VERSION!;
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad(version, mailbox), tagLength: 128 },
    await encryptionKey(env),
    encoder.encode(token),
  );
  return { ciphertext: toBase64(new Uint8Array(cipher)), nonce: toBase64(nonce), keyVersion: version };
}
export async function decryptRefreshToken(
  env: Bindings,
  mailbox: string,
  stored: { ciphertext: string; nonce: string; keyVersion: string },
) {
  if (stored.keyVersion !== env.META_TOKEN_ENCRYPTION_KEY_VERSION) throw new Error('GMAIL_KEY_VERSION_MISMATCH');
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(stored.nonce), additionalData: aad(stored.keyVersion, mailbox), tagLength: 128 },
      await encryptionKey(env),
      fromBase64(stored.ciphertext),
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    throw new Error('GMAIL_TOKEN_DECRYPTION_FAILED');
  }
}

// --- Google OAuth ---
export function authorizationUrl(env: Bindings, state: string) {
  const config = gmailConfig(env);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    login_hint: config.mailbox,
    state,
  }).toString();
  return url;
}
type TokenResponse = { access_token?: string; refresh_token?: string; scope?: string; error?: string };
export async function exchangeCode(env: Bindings, code: string, http: Http = fetch) {
  const response = await http(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: gmailConfig(env).redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !data.access_token) throw new Error('GMAIL_TOKEN_EXCHANGE_FAILED');
  return data;
}
async function accessToken(env: Bindings, refreshToken: string, http: Http) {
  const response = await http(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (response.status === 400 && data.error === 'invalid_grant') throw new Error('GMAIL_RECONNECT_REQUIRED');
  if (!response.ok || !data.access_token) throw new Error(`GMAIL_TOKEN_HTTP_${response.status}`);
  return data.access_token;
}
export async function gmailGet<T>(token: string, path: string, http: Http = fetch): Promise<T> {
  const response = await http(`${GMAIL_API}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 401 || response.status === 403) throw new Error('GMAIL_RECONNECT_REQUIRED');
  if (response.status === 404) throw new Error('GMAIL_NOT_FOUND');
  if (!response.ok) throw new Error(`GMAIL_HTTP_${response.status}`);
  return (await response.json()) as T;
}
export async function revokeToken(token: string, http: Http = fetch) {
  await http(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
  }).catch(() => undefined);
}

// --- Message parsing ---
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};
function decodeBase64Url(data: string) {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    return new TextDecoder('utf-8').decode(fromBase64(padded));
  } catch {
    return '';
  }
}
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', apos: "'" };
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (match, code: string) => {
      if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith('#') && code !== '#39') return String.fromCodePoint(Number(code.slice(1)));
      return entities[code.toLowerCase()] ?? match;
    })
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}
function findBody(part: GmailPart | undefined, mime: string): string {
  if (!part) return '';
  if (part.mimeType === mime && part.body?.data && !part.filename) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findBody(child, mime);
    if (found) return found;
  }
  return '';
}
// Defence in depth only: the CRM renders this inside a sandboxed iframe (no scripts, opaque
// origin) under the page CSP, which also blocks remote images and connections.
const BLOCKED_ELEMENTS = 'script|iframe|object|embed|applet|form|textarea|select|button|noscript|template|svg|math|frameset|frame';
export function sanitizeEmailHtml(html: string) {
  if (!html.trim()) return '';
  return html
    .slice(0, HTML_LIMIT)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(new RegExp(`<(${BLOCKED_ELEMENTS})\\b[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<\\/?(${BLOCKED_ELEMENTS}|input|link|meta|base)\\b[^>]*>`, 'gi'), '')
    .replace(/\s(on[a-z]+|srcdoc|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src|action|background|xlink:href)\s*=\s*("\s*(?:javascript|vbscript|data:text\/html)[^"]*"|'\s*(?:javascript|vbscript|data:text\/html)[^']*'|(?:javascript|vbscript|data:text\/html)[^\s>]*)/gi, '');
}
export function parseAddress(value: string) {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = (match ? match[2] : value).trim().toLowerCase();
  const name = (match ? match[1] : '').trim();
  return { name, email: /^[^@\s]+@[^@\s]+$/.test(email) ? email : '' };
}
export function parseMessage(message: GmailMessage) {
  const headers = new Map(
    (message.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]),
  );
  const from = parseAddress(headers.get('from') ?? '');
  const plain = findBody(message.payload, 'text/plain');
  const html = findBody(message.payload, 'text/html');
  const body = (plain || htmlToText(html)).slice(0, BODY_LIMIT);
  const internal = Number(message.internalDate);
  return {
    id: message.id,
    threadId: message.threadId,
    labels: message.labelIds ?? [],
    fromName: from.name.slice(0, 200),
    fromEmail: from.email,
    to: (headers.get('to') ?? '').slice(0, 500),
    subject: (headers.get('subject') ?? '').slice(0, 500),
    snippet: htmlToText(message.snippet ?? '').slice(0, 500),
    body,
    html: sanitizeEmailHtml(html),
    receivedAt: new Date(Number.isFinite(internal) && internal > 0 ? internal : Date.now()).toISOString(),
    headers,
  };
}
export type ParsedMessage = ReturnType<typeof parseMessage>;

// --- Customer detection ---
const AUTOMATED_LOCAL =
  /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|newsletters?|news|marketing|updates?|calendar-notification|support-noreply)([+._-]|$)/i;
const AUTOMATED_DOMAINS = [
  'google.com', 'googlemail.com', 'facebookmail.com', 'facebook.com', 'meta.com', 'instagram.com',
  'linkedin.com', 'vercel.com', 'cloudflare.com', 'github.com', 'line.me', 'linecorp.com',
  'openai.com', 'apple.com', 'microsoft.com', 'amazonses.com',
];
const SKIP_CATEGORIES = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'CATEGORY_UPDATES'];
export const PERSONAL_REASON = 'Email from a person outside the company';
const LEGACY_PERSONAL_REASON = 'Personal email from an external sender';
const MARKETING_HEADERS = ['feedback-id', 'x-mailgun-sid', 'x-sg-eid', 'x-mc-user', 'x-campaign', 'x-campaign-id', 'x-mailchimp-campaign'];
const MARKETING_MAILERS = /mailchimp|sendgrid|hubspot|klaviyo|sendinblue|brevo|mailerlite|constant ?contact|campaign ?monitor|marketo|salesforce marketing|mailjet|getresponse|activecampaign/i;
// Content signals for ads/newsletters and system notifications that slip past header checks.
// Sign-in/OTP words are checked in the subject only, so a customer mentioning "login" is kept.
export function contentClassification(subject: string, body: string) {
  const text = `${subject}\n${body.slice(0, 6000)}`;
  if (/unsubscribe|opt[- ]?out|manage (your )?(email )?(preferences|subscription)|email preferences|ยกเลิกการ(รับ|สมัคร|ติดตาม)|เลิกรับ(ข่าวสาร|อีเมล)|view (this email )?in (your |a )?browser|ดูอีเมลนี้(ใน|บน)เบราว์เซอร์/i.test(text))
    return 'Advertising or newsletter';
  if (/\b\d{1,2}% off\b|flash sale|limited[- ]time offer|promo(tion)? code|coupon code|ลดสูงสุด\s*\d|โค้ดส่วนลด/i.test(subject))
    return 'Advertising or newsletter';
  if (/verification code|security code|\bOTP\b|one[- ]time (password|code|passcode)|sign[- ]?in|log[- ]?in|new (device|login|sign-in)|password reset|reset your password|verify your (email|account)|confirm your (email|account|registration)|security alert|รหัสยืนยัน|รหัส OTP|เข้าสู่ระบบ|ยืนยันตัวตน|ยืนยันอีเมล|รีเซ็ตรหัสผ่าน|แจ้งเตือนความปลอดภัย/i.test(subject))
    return 'Sign-in or security notification';
  if (/this is an automated (message|email|notification)|(please )?do not reply to this (email|message)|automatically generated|อีเมลนี้(ถูก)?ส่ง(มา)?(โดย)?อัตโนมัติ|กรุณาอย่าตอบกลับ|ไม่ต้องตอบกลับอีเมลนี้/i.test(text))
    return 'Automated notification';
  return null;
}
export function ruleClassification(message: ParsedMessage, mailbox: string) {
  const [local = '', domain = ''] = message.fromEmail.split('@');
  const ownDomain = mailbox.split('@')[1] ?? '';
  if (!message.fromEmail) return { customer: false, reason: 'No sender address' };
  if (domain === ownDomain) return { customer: false, reason: 'Sent from our own domain' };
  if (AUTOMATED_LOCAL.test(local)) return { customer: false, reason: 'Automated sender address' };
  if (AUTOMATED_DOMAINS.some((known) => domain === known || domain.endsWith(`.${known}`)))
    return { customer: false, reason: 'Service notification' };
  if (message.headers.has('list-unsubscribe') || message.headers.has('list-id'))
    return { customer: false, reason: 'Mailing list or newsletter' };
  if (/^(bulk|list|junk)$/i.test(message.headers.get('precedence') ?? ''))
    return { customer: false, reason: 'Bulk mail' };
  const autoSubmitted = message.headers.get('auto-submitted');
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') return { customer: false, reason: 'Auto-generated' };
  if (message.labels.some((label) => SKIP_CATEGORIES.includes(label)))
    return { customer: false, reason: 'Gmail promotions/social/updates category' };
  if (MARKETING_HEADERS.some((name) => message.headers.has(name)) || MARKETING_MAILERS.test(message.headers.get('x-mailer') ?? ''))
    return { customer: false, reason: 'Advertising or newsletter' };
  const content = contentClassification(message.subject, message.body);
  if (content) return { customer: false, reason: content };
  return { customer: true, reason: PERSONAL_REASON };
}

export type AiClassifier = (message: ParsedMessage) => Promise<{ customer: boolean; reason: string } | null>;
export function openAiClassifier(env: Bindings, http: Http = fetch): AiClassifier | null {
  if (!env.AI_API_KEY || !env.AI_MODEL || !env.AI_BASE_URL) return null;
  let base: URL;
  try {
    base = new URL(env.AI_BASE_URL);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:') return null;
  return async (message) => {
    try {
      const response = await http(`${base.href.replace(/\/$/, '')}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.AI_API_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model: env.AI_MODEL,
          temperature: 0,
          store: false,
          text: {
            format: {
              type: 'json_schema',
              name: 'email_triage',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['isCustomer', 'reason'],
                properties: { isCustomer: { type: 'boolean' }, reason: { type: 'string' } },
              },
            },
          },
          input: [
            {
              role: 'system',
              content:
                'You triage email for COREVITY, a Thai company selling pre-owned commercial gym equipment and exporting it. Decide if the email is from a real person who is or may become a customer: product or price inquiries, quotation or purchase requests, delivery/export questions, replies in an ongoing sales conversation, or a business wanting to buy equipment. Not customers: suppliers selling to us, job applicants, spam, phishing, newsletters, automated notifications, receipts, account or security messages. When unsure but a real person is asking about equipment, answer true. Reply with a short English reason (max 12 words).',
            },
            {
              role: 'user',
              content: JSON.stringify({
                from: `${message.fromName} <${message.fromEmail}>`,
                subject: message.subject,
                body: message.body.slice(0, 2000),
              }),
            },
          ],
        }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { output?: { content?: { type?: string; text?: string }[] }[] };
      const text = data.output?.flatMap((item) => item.content ?? []).find((part) => part.type === 'output_text')?.text;
      const parsed = JSON.parse(text ?? '') as { isCustomer?: unknown; reason?: unknown };
      if (typeof parsed.isCustomer !== 'boolean') return null;
      return { customer: parsed.isCustomer, reason: `AI: ${String(parsed.reason ?? '').slice(0, 120)}` };
    } catch {
      return null;
    }
  };
}

// --- Replies ---
const threadKnown = async (env: Bindings, threadId: string) =>
  Boolean(await env.DB.prepare('SELECT 1 FROM email_messages WHERE thread_id=? LIMIT 1').bind(threadId).first());
export async function markReplied(env: Bindings, threadId: string, sentAt: string) {
  await env.DB.prepare(
    'UPDATE email_messages SET replied_at=? WHERE thread_id=? AND received_at<? AND (replied_at IS NULL OR replied_at<?)',
  )
    .bind(sentAt, threadId, sentAt, sentAt)
    .run();
}
async function recordReply(env: Bindings, token: string, id: string, http: Http) {
  try {
    const message = await gmailGet<GmailMessage>(token, `messages/${encodeURIComponent(id)}?format=minimal`, http);
    const internal = Number(message.internalDate);
    if (!message.threadId || !Number.isFinite(internal) || !(message.labelIds ?? []).includes('SENT')) return;
    await markReplied(env, message.threadId, new Date(internal).toISOString());
  } catch (error) {
    if (!(error instanceof Error && error.message === 'GMAIL_NOT_FOUND')) throw error;
  }
}

// --- Sync ---
type Connection = {
  email: string;
  status: string;
  token_ciphertext: string;
  token_nonce: string;
  token_key_version: string;
  history_id: string | null;
  ai_classify: number;
  last_sweep_at: string | null;
  backfill_page_token: string | null;
  backfill_done: number;
  sent_backfill_token: string | null;
  sent_backfill_done: number;
};
type HistoryPage = {
  history?: { messagesAdded?: { message: { id: string; threadId?: string; labelIds?: string[] } }[] }[];
  historyId?: string;
  nextPageToken?: string;
};
export type SyncResult = {
  status: 'skipped' | 'ok' | 'reconnect' | 'error';
  imported: number;
  customers: number;
  backfillDone?: boolean;
  error?: string;
  queued?: number;
  apiCalls?: number;
  mode?: 'first' | 'history' | 'sweep';
};

async function enqueueNotifications(env: Bindings, messageId: string, now: string) {
  const allowed = new Set(await workspaceSalesEmails(env));
  const { results } = await env.DB.prepare('SELECT email,line_user_id FROM line_accounts WHERE enabled=1').all<{
    email: string;
    line_user_id: string;
  }>();
  const recipients = results.filter((row) => allowed.has(row.email.toLowerCase()));
  if (!recipients.length) return 0;
  await env.DB.batch(
    recipients.map((row) =>
      env.DB.prepare(
        'INSERT OR IGNORE INTO email_notifications(id,message_id,email,line_user_id,next_attempt_at,created_at) VALUES(?,?,?,?,?,?)',
      ).bind(crypto.randomUUID(), messageId, row.email, row.line_user_id, now, now),
    ),
  );
  return recipients.length;
}

async function importMessage(
  env: Bindings,
  token: string,
  id: string,
  options: { notify: boolean; mailbox: string; classifier: AiClassifier | null; http: Http },
) {
  if (await env.DB.prepare('SELECT 1 FROM email_messages WHERE id=?').bind(id).first()) return null;
  let raw: GmailMessage;
  try {
    raw = await gmailGet<GmailMessage>(token, `messages/${encodeURIComponent(id)}?format=full`, options.http);
  } catch (error) {
    if (error instanceof Error && error.message === 'GMAIL_NOT_FOUND') return null;
    throw error;
  }
  const labels = raw.labelIds ?? [];
  const inSpam = labels.includes('SPAM');
  if ((!labels.includes('INBOX') && !inSpam) || labels.some((label) => ['TRASH', 'DRAFT', 'SENT'].includes(label))) return null;
  const message = parseMessage(raw);
  const known = message.fromEmail
    ? await env.DB.prepare("SELECT id FROM customers WHERE lower(trim(email))=? AND email<>'' LIMIT 1")
        .bind(message.fromEmail)
        .first<{ id: string }>()
    : null;
  let verdict = ruleClassification(message, options.mailbox);
  if (known && message.fromEmail.split('@')[1] !== options.mailbox.split('@')[1]) {
    verdict = { customer: true, reason: 'Known customer' };
  } else if (verdict.customer && options.classifier) {
    verdict = (await options.classifier(message)) ?? verdict;
  }
  const now = new Date().toISOString();
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO email_messages(id,thread_id,from_name,from_email,to_text,subject,snippet,body_text,body_html,received_at,classification,reason,customer_id,in_spam,notified,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
  )
    .bind(
      message.id, message.threadId, message.fromName, message.fromEmail, message.to, message.subject,
      message.snippet, message.body, message.html, message.receivedAt, verdict.customer ? 'CUSTOMER' : 'NOT_CUSTOMER',
      verdict.reason, known?.id ?? null, Number(inSpam), now,
    )
    .run();
  if (!inserted.meta.changes) return null;
  let queued = 0;
  if (verdict.customer && options.notify) {
    queued = await enqueueNotifications(env, message.id, now);
    if (queued) await env.DB.prepare('UPDATE email_messages SET notified=1 WHERE id=?').bind(message.id).run();
  }
  return { customer: verdict.customer, queued };
}

type SyncOptions = { http?: Http; classifier?: AiClassifier | null; time?: number };

async function runGmailSync(env: Bindings, options: SyncOptions): Promise<SyncResult> {
  const baseHttp = options.http ?? fetch;
  let calls = 0;
  const http: Http = (input, init) => {
    calls++;
    return baseHttp(input, init);
  };
  const budgetLeft = () => MAX_CALLS_PER_SYNC - calls;
  const config = gmailConfig(env);
  if (!config.ready) return { status: 'skipped', imported: 0, customers: 0 };
  const time = options.time ?? Date.now();
  const now = new Date(time).toISOString();
  const lease = await env.DB.prepare(
    "UPDATE gmail_connection SET sync_lease_until=? WHERE id='workspace' AND status='CONNECTED' AND (sync_lease_until IS NULL OR sync_lease_until<=?)",
  )
    .bind(new Date(time + 4 * 60_000).toISOString(), now)
    .run();
  if (!lease.meta.changes) return { status: 'skipped', imported: 0, customers: 0 };
  const connection = (await env.DB.prepare("SELECT * FROM gmail_connection WHERE id='workspace'").first<Connection>())!;
  let imported = 0;
  let customers = 0;
  let queued = 0;
  try {
    const refresh = await decryptRefreshToken(env, connection.email, {
      ciphertext: connection.token_ciphertext,
      nonce: connection.token_nonce,
      keyVersion: connection.token_key_version,
    });
    const token = await accessToken(env, refresh, http);
    const classifier =
      options.classifier !== undefined ? options.classifier : connection.ai_classify ? openAiClassifier(env, http) : null;
    let ids: string[] = [];
    let sentFromHistory: { id: string; threadId?: string }[] = [];
    let historyId = connection.history_id;
    let notify = true;
    if (historyId) {
      const startHistoryId = historyId;
      try {
        let pageToken = '';
        const found: string[] = [];
        const sent: { id: string; threadId?: string }[] = [];
        for (let page = 0; page < 3; page++) {
          const history: HistoryPage = await gmailGet<HistoryPage>(
            token,
            `history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded&maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
            http,
          );
          for (const entry of history.history ?? [])
            for (const added of entry.messagesAdded ?? []) {
              const labels = added.message.labelIds;
              if (labels?.includes('SENT') && !labels.includes('INBOX')) sent.push(added.message);
              else if (!labels || labels.includes('INBOX') || labels.includes('SPAM')) found.push(added.message.id);
            }
          if (history.historyId) historyId = history.historyId;
          if (!history.nextPageToken) break;
          pageToken = history.nextPageToken;
        }
        ids = [...new Set(found)];
        sentFromHistory = sent;
      } catch (error) {
        if (!(error instanceof Error && error.message === 'GMAIL_NOT_FOUND')) throw error;
        historyId = null; // History expired: fall back to a recent listing (dedupe protects from repeats).
      }
    } else {
      notify = false; // First sync: show recent mail without alerting on old messages.
    }
    const list = async (query: string) =>
      (
        await gmailGet<{ messages?: { id: string }[] }>(
          token,
          `messages?includeSpamTrash=true&maxResults=${MAX_MESSAGES_PER_SYNC}&q=${encodeURIComponent(query)}`,
          http,
        )
      ).messages?.map((message) => message.id) ?? [];
    const listWithThreads = async (query: string, pageToken?: string | null) => {
      const page = await gmailGet<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(
        token,
        `messages?maxResults=${BACKFILL_PAGE}&q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
        http,
      );
      return { messages: page.messages ?? [], nextPageToken: page.nextPageToken };
    };
    let swept = false;
    if (!historyId) {
      const profile = await gmailGet<{ historyId?: string }>(token, 'profile', http);
      ids = await list(connection.history_id ? SWEEP_QUERY : FIRST_SYNC_QUERY);
      historyId = profile.historyId ?? null;
      swept = true;
    } else if (!connection.last_sweep_at || Date.parse(connection.last_sweep_at) <= time - SWEEP_INTERVAL_MS) {
      ids = [...new Set([...ids, ...(await list(SWEEP_QUERY))])];
      swept = true;
    }
    for (const id of ids.slice(-MAX_MESSAGES_PER_SYNC * 2)) {
      if (budgetLeft() < 3) break; // the hourly sweep / next run picks up the rest
      const result = await importMessage(env, token, id, { notify, mailbox: connection.email, classifier, http });
      if (!result) continue;
      imported++;
      queued += result.queued;
      if (result.customer) customers++;
    }
    // Backfill older mail a page at a time (no alerts) until the 90-day window is complete.
    let backfillToken = connection.backfill_page_token;
    let backfillDone = connection.backfill_done;
    if (!backfillDone && budgetLeft() > 6) {
      const page = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(
        token,
        `messages?includeSpamTrash=true&maxResults=${BACKFILL_PAGE}&q=${encodeURIComponent(BACKFILL_QUERY)}${backfillToken ? `&pageToken=${encodeURIComponent(backfillToken)}` : ''}`,
        http,
      );
      let complete = true;
      for (const message of page.messages ?? []) {
        if (budgetLeft() < 3) {
          complete = false; // finish this page next run; already-imported ids are skipped without a fetch
          break;
        }
        const result = await importMessage(env, token, message.id, { notify: false, mailbox: connection.email, classifier, http });
        if (!result) continue;
        imported++;
        queued += result.queued;
        if (result.customer) customers++;
      }
      if (complete) {
        backfillToken = page.nextPageToken ?? null;
        backfillDone = backfillToken ? 0 : 1;
      }
    }
    // Replies sent from the mailbox: mark the matching thread as replied. Sent mail in threads
    // the CRM doesn't hold is skipped without a fetch.
    const sentQueue = [...sentFromHistory];
    if (swept && budgetLeft() > 6) sentQueue.push(...(await listWithThreads(SENT_SWEEP_QUERY)).messages);
    let sentToken = connection.sent_backfill_token;
    let sentDone = connection.sent_backfill_done;
    let sentPageComplete = true;
    let sentPageNext: string | null = null;
    if (!sentDone && budgetLeft() > 6) {
      const page = await listWithThreads(SENT_BACKFILL_QUERY, sentToken);
      sentQueue.push(...page.messages);
      sentPageNext = page.nextPageToken ?? null;
    } else sentPageComplete = false;
    const seen = new Set<string>();
    for (const message of sentQueue) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      if (message.threadId && !(await threadKnown(env, message.threadId))) continue;
      if (budgetLeft() < 2) {
        sentPageComplete = false;
        break;
      }
      await recordReply(env, token, message.id, http);
    }
    if (!sentDone && sentPageComplete) {
      sentToken = sentPageNext;
      sentDone = sentToken ? 0 : 1;
    }
    await env.DB.prepare(
      "UPDATE gmail_connection SET history_id=?,last_sync_at=?,last_sweep_at=CASE WHEN ?=1 THEN ? ELSE last_sweep_at END,backfill_page_token=?,backfill_done=?,sent_backfill_token=?,sent_backfill_done=?,last_error=NULL,health_alerted_at=NULL,sync_lease_until=NULL,updated_at=? WHERE id='workspace'",
    )
      .bind(historyId, now, Number(swept), now, backfillToken, backfillDone, sentToken, sentDone, now)
      .run();
    return {
      status: 'ok',
      imported,
      customers,
      queued,
      apiCalls: calls,
      mode: connection.history_id ? (swept ? 'sweep' : 'history') : 'first',
      backfillDone: Boolean(backfillDone),
    };
  } catch (error) {
    const code =
      error instanceof Error && /^GMAIL_[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : `GMAIL_SYNC_FAILED: ${(error instanceof Error ? `${error.name} ${error.message}` : String(error)).replace(/[^\x20-\x7E]/g, '').slice(0, 160)}`;
    const reconnect = code === 'GMAIL_RECONNECT_REQUIRED' || code === 'GMAIL_TOKEN_DECRYPTION_FAILED' || code === 'GMAIL_KEY_VERSION_MISMATCH';
    await env.DB.prepare(
      `UPDATE gmail_connection SET status=?,last_error=?,sync_lease_until=NULL,updated_at=? WHERE id='workspace'`,
    )
      .bind(reconnect ? 'RECONNECT_REQUIRED' : 'CONNECTED', code, now)
      .run();
    return { status: reconnect ? 'reconnect' : 'error', imported, customers, queued, apiCalls: calls, error: code };
  }
}

// Every real run (not "skipped") leaves one counts-only row plus a structured log line, so a
// missed email can be traced to "ran, found nothing" vs "failed" vs "never ran".
async function recordSyncRun(env: Bindings, run: { trigger: 'cron' | 'manual'; startedAt: number; durationMs: number; result: SyncResult }) {
  const { result } = run;
  if (result.status === 'skipped') return;
  const entry = {
    trigger: run.trigger,
    status: result.status,
    mode: result.mode ?? '',
    imported: result.imported,
    customers: result.customers,
    alertsQueued: result.queued ?? 0,
    apiCalls: result.apiCalls ?? 0,
    durationMs: run.durationMs,
    error: result.error ?? null,
  };
  console.log(JSON.stringify({ event: 'gmail_sync', ...entry }));
  try {
    await env.DB.prepare(
      'INSERT INTO gmail_sync_log(id,started_at,duration_ms,trigger,status,mode,imported,customers,alerts_queued,api_calls,error) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        crypto.randomUUID(),
        new Date(run.startedAt).toISOString(),
        entry.durationMs,
        entry.trigger,
        entry.status,
        entry.mode,
        entry.imported,
        entry.customers,
        entry.alertsQueued,
        entry.apiCalls,
        entry.error,
      )
      .run();
  } catch (error) {
    console.error(JSON.stringify({ event: 'gmail_sync_log_failed', error: error instanceof Error ? error.name : 'unknown' }));
  }
}

export async function syncGmail(env: Bindings, options: SyncOptions & { trigger?: 'cron' | 'manual' } = {}): Promise<SyncResult> {
  const begun = Date.now();
  let result: SyncResult | undefined;
  let thrown: unknown;
  try {
    result = await runGmailSync(env, options);
  } catch (error) {
    thrown = error;
    result = {
      status: 'error',
      imported: 0,
      customers: 0,
      error: `GMAIL_SYNC_FAILED: ${(error instanceof Error ? `${error.name} ${error.message}` : String(error)).replace(/[^\x20-\x7E]/g, '').slice(0, 160)}`,
    };
  }
  await recordSyncRun(env, { trigger: options.trigger ?? 'cron', startedAt: options.time ?? begun, durationMs: Date.now() - begun, result });
  if (thrown) throw thrown;
  return result;
}

// Emails classified before the content rules existed: re-check them once with the new rules.
export async function reclassifyStoredEmails(env: Bindings) {
  const { results } = await env.DB.prepare(
    'SELECT id,subject,body_text FROM email_messages WHERE reason=? LIMIT 500',
  )
    .bind(LEGACY_PERSONAL_REASON)
    .all<{ id: string; subject: string; body_text: string }>();
  if (!results.length) return 0;
  await env.DB.batch(
    results.map((row) => {
      const automated = contentClassification(row.subject, row.body_text);
      return env.DB.prepare('UPDATE email_messages SET classification=?,reason=? WHERE id=? AND reason=?').bind(
        automated ? 'NOT_CUSTOMER' : 'CUSTOMER',
        automated ?? PERSONAL_REASON,
        row.id,
        LEGACY_PERSONAL_REASON,
      );
    }),
  );
  return results.length;
}

// The whole Gmail conversation for one thread, including replies sent from the mailbox.
export type ThreadMessage = {
  id: string;
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  receivedAt: string;
  sent: boolean;
  inSpam: boolean;
  bodyText: string;
  bodyHtml: string;
};
async function mailboxAccessToken(env: Bindings, http: Http) {
  if (!gmailConfig(env).ready) return null;
  const connection = await env.DB.prepare(
    "SELECT email,token_ciphertext,token_nonce,token_key_version FROM gmail_connection WHERE id='workspace' AND status='CONNECTED'",
  ).first<{ email: string; token_ciphertext: string; token_nonce: string; token_key_version: string }>();
  if (!connection) return null;
  const refresh = await decryptRefreshToken(env, connection.email, {
    ciphertext: connection.token_ciphertext,
    nonce: connection.token_nonce,
    keyVersion: connection.token_key_version,
  });
  return { token: await accessToken(env, refresh, http), mailbox: connection.email };
}
export async function loadThread(env: Bindings, threadId: string, http: Http = fetch): Promise<ThreadMessage[] | null> {
  try {
    const access = await mailboxAccessToken(env, http);
    if (!access) return null;
    const thread = await gmailGet<{ messages?: GmailMessage[] }>(access.token, `threads/${encodeURIComponent(threadId)}?format=full`, http);
    const messages = (thread.messages ?? [])
      .filter((message) => !(message.labelIds ?? []).some((label) => label === 'DRAFT' || label === 'TRASH'))
      .slice(-50)
      .map((raw) => {
        const message = parseMessage(raw);
        const sent = message.labels.includes('SENT') || message.fromEmail === access.mailbox;
        return {
          id: message.id,
          fromName: message.fromName,
          fromEmail: message.fromEmail,
          to: message.to,
          subject: message.subject,
          receivedAt: message.receivedAt,
          sent,
          inSpam: message.labels.includes('SPAM'),
          bodyText: message.body,
          bodyHtml: message.html,
        };
      })
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    const lastSent = messages.filter((message) => message.sent).at(-1);
    if (lastSent) await markReplied(env, threadId, lastSent.receivedAt);
    return messages;
  } catch {
    return null;
  }
}

// Older rows were stored as text only: fetch the HTML part once, when the email is opened.
export async function loadMessageHtml(env: Bindings, id: string, http: Http = fetch) {
  if (!gmailConfig(env).ready) return null;
  const connection = await env.DB.prepare(
    "SELECT email,token_ciphertext,token_nonce,token_key_version FROM gmail_connection WHERE id='workspace' AND status='CONNECTED'",
  ).first<{ email: string; token_ciphertext: string; token_nonce: string; token_key_version: string }>();
  if (!connection) return null;
  try {
    const refresh = await decryptRefreshToken(env, connection.email, {
      ciphertext: connection.token_ciphertext,
      nonce: connection.token_nonce,
      keyVersion: connection.token_key_version,
    });
    const token = await accessToken(env, refresh, http);
    const message = parseMessage(await gmailGet<GmailMessage>(token, `messages/${encodeURIComponent(id)}?format=full`, http));
    await env.DB.prepare('UPDATE email_messages SET body_html=? WHERE id=?').bind(message.html, id).run();
    return message.html;
  } catch (error) {
    if (error instanceof Error && error.message === 'GMAIL_NOT_FOUND')
      await env.DB.prepare("UPDATE email_messages SET body_html='' WHERE id=?").bind(id).run();
    return null;
  }
}

// --- LINE alerts ---
type EmailJob = {
  id: string;
  message_id: string;
  email: string;
  line_user_id: string;
  attempts: number;
  from_name: string;
  from_email: string;
  subject: string;
  snippet: string;
  reason: string;
  in_spam: number;
};
export function emailAlertText(
  job: Pick<EmailJob, 'message_id' | 'from_name' | 'from_email' | 'subject' | 'snippet' | 'reason'> & { in_spam?: number },
  origin: string,
) {
  const sender = job.from_name ? `${job.from_name} <${job.from_email}>` : job.from_email;
  const snippet = job.snippet.replace(/\s+/g, ' ').trim().slice(0, 300);
  return `Corevity · อีเมลใหม่ที่น่าจะเป็นลูกค้า\nจาก: ${sender}\nเรื่อง: ${job.subject || '(ไม่มีหัวข้อ)'}\n${snippet}${job.snippet.length > 300 ? '…' : ''}${job.reason === 'Known customer' ? '\n(ลูกค้าที่มีอยู่ในระบบ)' : ''}${job.in_spam ? '\n⚠️ อยู่ในโฟลเดอร์ Junk/Spam ของ Gmail' : ''}\n\nเปิดใน CRM: ${origin}/inbox?message=${encodeURIComponent(job.message_id)}`;
}
export async function processEmailNotifications(env: Bindings, time = Date.now()) {
  if (!lineConfigured(env) || !env.APP_URL) return;
  let origin: URL;
  try {
    origin = new URL(env.APP_URL);
  } catch {
    return;
  }
  if (origin.protocol !== 'https:') return;
  const now = new Date(time).toISOString();
  const allowed = new Set(await workspaceSalesEmails(env));
  const jobs = await env.DB.prepare(
    `SELECT n.id,n.message_id,n.email,n.line_user_id,n.attempts,m.from_name,m.from_email,m.subject,m.snippet,m.reason,m.in_spam
     FROM email_notifications n JOIN email_messages m ON m.id=n.message_id
     WHERE n.status='pending' AND n.next_attempt_at<=? AND (n.lease_until IS NULL OR n.lease_until<=?)
     ORDER BY n.created_at LIMIT 50`,
  )
    .bind(now, now)
    .all<EmailJob>();
  const outcome = { sent: 0, retrying: 0, failed: 0, cancelled: 0 };
  const errors = new Set<string>();
  for (const job of jobs.results) {
    if (!allowed.has(job.email.toLowerCase())) {
      await env.DB.prepare("UPDATE email_notifications SET status='cancelled',lease_until=NULL,last_error='RECIPIENT_REMOVED' WHERE id=?")
        .bind(job.id)
        .run();
      outcome.cancelled++;
      continue;
    }
    const lease = await env.DB.prepare(
      "UPDATE email_notifications SET lease_until=?,attempts=attempts+1 WHERE id=? AND status='pending' AND (lease_until IS NULL OR lease_until<=?)",
    )
      .bind(new Date(time + 120_000).toISOString(), job.id, now)
      .run();
    if (!lease.meta.changes) continue;
    const attempts = job.attempts + 1;
    try {
      const response = await lineRequest(env, 'message/push', {
        method: 'POST',
        headers: { 'X-Line-Retry-Key': job.id },
        body: JSON.stringify({ to: job.line_user_id, messages: [{ type: 'text', text: emailAlertText(job, origin.origin) }] }),
      });
      const accepted = response.ok || (response.status === 409 && !!response.headers.get('x-line-accepted-request-id'));
      const retryable = response.status === 429 || response.status >= 500;
      const next = accepted ? 'sent' : retryable && attempts < 10 ? 'pending' : 'failed';
      outcome[next === 'pending' ? 'retrying' : next]++;
      if (!accepted) errors.add(`LINE_HTTP_${response.status}`);
      await env.DB.prepare('UPDATE email_notifications SET status=?,sent_at=?,lease_until=NULL,next_attempt_at=?,last_error=? WHERE id=?')
        .bind(
          next,
          accepted ? now : null,
          new Date(time + (retryable ? Math.min(60, 2 ** attempts) : 0) * 60_000).toISOString(),
          accepted ? null : `LINE_HTTP_${response.status}`,
          job.id,
        )
        .run();
    } catch (error) {
      outcome[attempts < 10 ? 'retrying' : 'failed']++;
      errors.add(error instanceof Error ? error.name : 'LINE_REQUEST_FAILED');
      await env.DB.prepare('UPDATE email_notifications SET status=?,lease_until=NULL,next_attempt_at=?,last_error=? WHERE id=?')
        .bind(
          attempts < 10 ? 'pending' : 'failed',
          new Date(time + Math.min(60, 2 ** attempts) * 60_000).toISOString(),
          error instanceof Error ? error.name : 'LINE_REQUEST_FAILED',
          job.id,
        )
        .run();
    }
  }
  if (jobs.results.length) console.log(JSON.stringify({ event: 'email_line_alerts', ...outcome, errors: [...errors] }));
  return outcome;
}

export async function cleanupGmail(env: Bindings, time = Date.now()) {
  const cutoff = new Date(time - RETENTION_DAYS * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_notifications WHERE message_id IN (SELECT id FROM email_messages WHERE received_at<?)').bind(cutoff),
    env.DB.prepare('DELETE FROM email_messages WHERE received_at<?').bind(cutoff),
    env.DB.prepare('DELETE FROM gmail_oauth_states WHERE expires_at<?').bind(new Date(time).toISOString()),
    env.DB.prepare('DELETE FROM gmail_sync_log WHERE started_at<?').bind(new Date(time - 14 * 86_400_000).toISOString()),
  ]);
}

// Cron entry point: never throws, so other scheduled jobs keep running. Each step is isolated so a
// failure in one (e.g. reclassify) can't silently skip LINE alerts or the health check after it.
export async function maintainGmail(env: Bindings) {
  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'gmail_maintain_failed',
          step: name,
          error: error instanceof Error ? `${error.name}: ${error.message}`.replace(/[^\x20-\x7E]/g, '').slice(0, 160) : 'unknown',
        }),
      );
    }
  };
  await step('sync', () => syncGmail(env, { trigger: 'cron' }));
  await step('reclassify', () => reclassifyStoredEmails(env));
  await step('notify', () => processEmailNotifications(env));
  await step('health', () => checkGmailHealth(env));
  await step('cleanup', () => cleanupGmail(env));
}

// Watchdog: if the mailbox can't be read (revoked access, repeated errors), tell the admin on
// LINE once per incident so customer email is not silently missed. Cleared by the next good sync.
export async function checkGmailHealth(env: Bindings, time = Date.now()) {
  if (!lineConfigured(env) || !env.APP_URL || !gmailConfig(env).ready) return false;
  let origin: URL;
  try {
    origin = new URL(env.APP_URL);
  } catch {
    return false;
  }
  const row = await env.DB.prepare(
    "SELECT email,status,last_sync_at,last_error,connected_at,health_alerted_at FROM gmail_connection WHERE id='workspace'",
  ).first<{
    email: string;
    status: string;
    last_sync_at: string | null;
    last_error: string | null;
    connected_at: string;
    health_alerted_at: string | null;
  }>();
  if (!row || row.health_alerted_at) return false;
  const lastGood = row.last_sync_at ?? row.connected_at;
  const stale = Date.parse(lastGood) <= time - HEALTH_ALERT_AFTER_MS;
  const broken = row.status === 'RECONNECT_REQUIRED' || (Boolean(row.last_error) && stale);
  if (!broken) return false;
  const allowed = new Set(await workspaceSalesEmails(env));
  const { results } = await env.DB.prepare('SELECT email,line_user_id FROM line_accounts WHERE enabled=1').all<{
    email: string;
    line_user_id: string;
  }>();
  const members = results.filter((account) => allowed.has(account.email.toLowerCase()));
  const adminEmail = (env.AUTH_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const admin = members.filter((account) => account.email.toLowerCase() === adminEmail);
  const recipients = admin.length ? admin : members;
  if (!recipients.length) return false;
  const since = new Intl.DateTimeFormat('th-TH-u-nu-latn', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(lastGood));
  const text = `Corevity · ระบบตรวจอีเมลหยุดทำงาน\nCRM อ่านอีเมล ${row.email} ไม่ได้ (อ่านสำเร็จล่าสุด ${since})\n${
    row.status === 'RECONNECT_REQUIRED' ? 'ต้องเชื่อม Gmail ใหม่' : `ปัญหา: ${row.last_error}`
  }\nระหว่างนี้อีเมลลูกค้าใหม่จะไม่ถูกแจ้งเตือน กรุณาเช็ก Gmail โดยตรง\n\nแก้ไข: ${origin.origin}/settings?tab=integrations`;
  let delivered = false;
  for (const account of recipients) {
    try {
      const response = await lineRequest(env, 'message/push', {
        method: 'POST',
        headers: { 'X-Line-Retry-Key': crypto.randomUUID() },
        body: JSON.stringify({ to: account.line_user_id, messages: [{ type: 'text', text }] }),
      });
      delivered ||= response.ok;
    } catch {
      /* try the next recipient; retried next run if none succeed */
    }
  }
  if (delivered)
    await env.DB.prepare("UPDATE gmail_connection SET health_alerted_at=? WHERE id='workspace'")
      .bind(new Date(time).toISOString())
      .run();
  return delivered;
}
