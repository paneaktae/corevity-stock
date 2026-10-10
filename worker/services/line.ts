import type { Bindings } from '../auth';
const encoder = new TextEncoder();
export const allowedSales = (env: Bindings) =>
  env.ALLOWED_EMAILS.split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
export const lineConfigured = (env: Bindings) =>
  !!(env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_CHANNEL_SECRET);
export async function hashCode(code: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(code));
  return [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
export async function verifyLineSignature(
  body: string,
  signature: string,
  secret: string,
) {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'HMAC',
      key,
      Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)),
      encoder.encode(body),
    );
  } catch {
    return false;
  }
}
export async function handleLineWebhook(
  request: Request,
  env: Bindings,
): Promise<Response> {
  if (request.method !== 'POST')
    return new Response('Method not allowed', { status: 405 });
  if (!env.LINE_CHANNEL_SECRET)
    return new Response('Not configured', { status: 503 });
  if (Number(request.headers.get('content-length')) > 65536)
    return new Response('Too large', { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Response('Bad request', { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      return new Response('Too large', { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const body = new TextDecoder().decode(bytes);
  if (
    !(await verifyLineSignature(
      body,
      request.headers.get('x-line-signature') ?? '',
      env.LINE_CHANNEL_SECRET,
    ))
  )
    return new Response('Unauthorized', { status: 401 });
  let data: {
    events?: {
      type?: string;
      timestamp?: number;
      source?: { type?: string; userId?: string };
      message?: { type?: string; text?: string };
    }[];
  };
  try {
    data = JSON.parse(body);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (!Array.isArray(data.events) || data.events.length > 100)
    return new Response('Bad request', { status: 400 });
  const now = new Date().toISOString();
  for (const event of data.events) {
    const userId = event.source?.userId;
    if (
      event.source?.type !== 'user' ||
      !userId ||
      !/^U[0-9a-f]{32}$/.test(userId)
    )
      continue;
    // Ignore stale/replayed deliveries; linking codes also expire independently.
    if (
      !event.timestamp ||
      Math.abs(Date.now() - event.timestamp) > 10 * 60 * 1000
    )
      continue;
    if (event.type === 'unfollow') {
      await env.DB.prepare(
        'UPDATE line_accounts SET enabled = 0 WHERE line_user_id = ?',
      )
        .bind(userId)
        .run();
      continue;
    }
    if (event.type !== 'message' || event.message?.type !== 'text') continue;
    const code = event.message.text
      ?.trim()
      .match(/^COREVITY\s+([a-f0-9]{32})$/i)?.[1]
      ?.toLowerCase();
    if (!code) continue;
    const digest = await hashCode(code);
    const link = await env.DB.prepare(
      'SELECT email FROM line_link_codes WHERE code_hash = ? AND expires_at > ?',
    )
      .bind(digest, now)
      .first<{ email: string }>();
    if (!link || !allowedSales(env).includes(link.email)) continue;
    // Conditional insert + consumption in one transaction prevents concurrent reuse.
    // A LINE identity already linked to another email is never silently reassigned.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO line_accounts(email, line_user_id, enabled, linked_at)
        SELECT email, ?, 1, ? FROM line_link_codes WHERE code_hash = ? AND expires_at > ?
        AND NOT EXISTS (SELECT 1 FROM line_accounts WHERE line_user_id = ? AND email <> line_link_codes.email)
        ON CONFLICT(email) DO UPDATE SET line_user_id = excluded.line_user_id, enabled = 1, linked_at = excluded.linked_at`,
      ).bind(userId, now, digest, now, userId),
      env.DB.prepare('DELETE FROM line_link_codes WHERE code_hash = ?').bind(
        digest,
      ),
    ]);
  }
  return Response.json({ ok: true });
}
export async function lineRequest(
  env: Bindings,
  path: string,
  options: RequestInit = {},
) {
  return fetch(`https://api.line.me/v2/bot/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
}
export type Reminder = {
  id: string;
  lead_id: string;
  appointment_at: string;
  email: string;
  line_user_id: string;
  attempts: number;
  created_at: string;
};
export type SendReminder = (
  env: Bindings,
  reminder: Reminder,
  message: string,
) => Promise<{ ok: boolean; retryable: boolean; error?: string }>;
export const pushReminder: SendReminder = async (env, reminder, message) => {
  const response = await lineRequest(env, 'message/push', {
    method: 'POST',
    headers: { 'X-Line-Retry-Key': reminder.id },
    body: JSON.stringify({
      to: reminder.line_user_id,
      messages: [{ type: 'text', text: message }],
    }),
  });
  // LINE returns 409 with this header when the same retry key was already accepted.
  const accepted =
    response.ok ||
    (response.status === 409 &&
      !!response.headers.get('x-line-accepted-request-id'));
  return {
    ok: accepted,
    retryable: response.status === 429 || response.status >= 500,
    error: accepted ? undefined : `LINE_HTTP_${response.status}`,
  };
};
export async function processLineReminders(
  env: Bindings,
  time = Date.now(),
  send: SendReminder = pushReminder,
) {
  if (!lineConfigured(env) || !env.APP_URL) return;
  const origin = new URL(env.APP_URL);
  if (origin.protocol !== 'https:') throw new Error('Invalid application URL');
  const now = new Date(time).toISOString(),
    nextDay = new Date(time + 86400000).toISOString();
  const allowed = allowedSales(env);
  // Cancel stale jobs before enqueuing current appointments. No customer notes or prices leave the app.
  await env.DB.prepare(
    `UPDATE line_reminders SET status='cancelled', lease_until=NULL WHERE status='pending' AND NOT EXISTS (
    SELECT 1 FROM leads l JOIN line_accounts a ON a.email=l.assigned_to
    WHERE l.id=line_reminders.lead_id AND l.next_follow_up_at=line_reminders.appointment_at
    AND l.assigned_to=line_reminders.email AND a.line_user_id=line_reminders.line_user_id
    AND a.enabled=1 AND l.status NOT IN ('WON','LOST') AND l.next_follow_up_at > ?)`,
  )
    .bind(now)
    .run();
  for (const email of allowed) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO line_reminders(id,lead_id,appointment_at,email,line_user_id,status,attempts,created_at,next_attempt_at)
      SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))), l.id,l.next_follow_up_at,l.assigned_to,a.line_user_id,'pending',0,?,?
      FROM leads l JOIN line_accounts a ON a.email=l.assigned_to
      WHERE l.assigned_to=? AND a.enabled=1 AND l.status NOT IN ('WON','LOST') AND l.next_follow_up_at > ? AND l.next_follow_up_at <= ?`,
    )
      .bind(now, now, email, now, nextDay)
      .run();
  }
  // Resume cancelled, unsent reminders only within the original retry-key window.
  for (const email of allowed) {
    await env.DB.prepare(
      `UPDATE line_reminders SET status='pending',lease_until=NULL WHERE status='cancelled' AND email=? AND attempts<12 AND created_at>? AND EXISTS (
      SELECT 1 FROM leads l JOIN line_accounts a ON a.email=l.assigned_to WHERE l.id=line_reminders.lead_id
      AND l.assigned_to=line_reminders.email AND l.next_follow_up_at=line_reminders.appointment_at
      AND a.line_user_id=line_reminders.line_user_id AND a.enabled=1 AND l.status NOT IN ('WON','LOST')
      AND l.next_follow_up_at>? AND l.next_follow_up_at<=?)`,
    )
      .bind(email, new Date(time - 23 * 3600000).toISOString(), now, nextDay)
      .run();
  }
  // Retry keys live for 24h at LINE. Stop earlier to avoid delivery duplication after expiration.
  await env.DB.prepare(
    "UPDATE line_reminders SET status='failed', last_error='RETRY_WINDOW_EXPIRED' WHERE status='pending' AND (created_at <= ? OR attempts >= 12)",
  )
    .bind(new Date(time - 23 * 3600000).toISOString())
    .run();
  const jobs = await env.DB.prepare(
    "SELECT * FROM line_reminders WHERE status='pending' AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?) ORDER BY appointment_at LIMIT 50",
  )
    .bind(now, now)
    .all<Reminder>();
  for (const job of jobs.results) {
    if (!allowed.includes(job.email)) {
      await env.DB.prepare(
        "UPDATE line_reminders SET status='cancelled' WHERE id=?",
      )
        .bind(job.id)
        .run();
      continue;
    }
    const lease = await env.DB.prepare(
      "UPDATE line_reminders SET lease_until=?, attempts=attempts+1 WHERE id=? AND status='pending' AND (lease_until IS NULL OR lease_until<=?)",
    )
      .bind(new Date(time + 120000).toISOString(), job.id, now)
      .run();
    if (!lease.meta.changes) continue;
    // Recheck the live assignment immediately before sending, including changed recipients.
    const valid = await env.DB.prepare(
      `SELECT l.id FROM leads l JOIN line_accounts a ON a.email=l.assigned_to WHERE l.id=? AND l.assigned_to=? AND l.next_follow_up_at=? AND l.next_follow_up_at>? AND l.status NOT IN ('WON','LOST') AND a.enabled=1 AND a.line_user_id=?`,
    )
      .bind(job.lead_id, job.email, job.appointment_at, now, job.line_user_id)
      .first();
    if (!valid) {
      await env.DB.prepare(
        "UPDATE line_reminders SET status='cancelled',lease_until=NULL WHERE id=?",
      )
        .bind(job.id)
        .run();
      continue;
    }
    const when = new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(job.appointment_at));
    const message = `Corevity แจ้งเตือนนัดติดตามลูกค้า\nนัดหมาย: ${when} (เวลาไทย)\nเปิดรายละเอียด: ${origin.origin}/sales/${encodeURIComponent(job.lead_id)}\nหากมีการเปลี่ยนแปลง โปรดดูเวลาล่าสุดในระบบ`;
    try {
      const result = await send(env, job, message);
      await env.DB.prepare(
        'UPDATE line_reminders SET status=?,sent_at=?,lease_until=NULL,next_attempt_at=?,last_error=? WHERE id=?',
      )
        .bind(
          result.ok ? 'sent' : result.retryable ? 'pending' : 'failed',
          result.ok ? now : null,
          new Date(
            time + Math.min(60, 5 * 2 ** job.attempts) * 60000,
          ).toISOString(),
          result.error ?? null,
          job.id,
        )
        .run();
    } catch {
      await env.DB.prepare(
        "UPDATE line_reminders SET lease_until=NULL,next_attempt_at=?,last_error='NETWORK_ERROR' WHERE id=?",
      )
        .bind(
          new Date(
            time + Math.min(60, 5 * 2 ** job.attempts) * 60000,
          ).toISOString(),
          job.id,
        )
        .run();
    }
  }
  await env.DB.prepare('DELETE FROM line_link_codes WHERE expires_at <= ?')
    .bind(now)
    .run();
}
