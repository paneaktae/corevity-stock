import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from './auth';
import { digest } from './auth';
import { allowedSales, workspaceSalesEmails } from './services/line';
import { sessionToken } from './services/meta/oauth';
import {
  GMAIL_SCOPE,
  authorizationUrl,
  decryptRefreshToken,
  encryptRefreshToken,
  exchangeCode,
  gmailConfig,
  gmailGet,
  loadMessageHtml,
  openAiClassifier,
  reclassifyStoredEmails,
  revokeToken,
  syncGmail,
} from './services/gmail';

export const gmailRoutes = new Hono<AppEnv>();
export const gmailOAuthRoutes = new Hono<AppEnv>();
const now = () => new Date().toISOString();

async function memberAccess(c: Context<AppEnv>, requireAdmin = false) {
  const email = c.get('email').trim().toLowerCase();
  if (!email) throw new HTTPException(401, { message: 'Please sign in to continue.' });
  if (!(await workspaceSalesEmails(c.env)).includes(email))
    throw new HTTPException(403, { message: 'Email inbox requires active workspace membership.' });
  const adminEmail = (c.env.AUTH_ADMIN_EMAIL ?? allowedSales(c.env)[0] ?? '').trim().toLowerCase();
  const admin = Boolean(adminEmail && email === adminEmail);
  if (requireAdmin && !admin)
    throw new HTTPException(403, { message: 'Only the workspace administrator can manage the Gmail connection.' });
  return { email, admin };
}

gmailRoutes.get('/status', async (c) => {
  const access = await memberAccess(c);
  const config = gmailConfig(c.env);
  const row = await c.env.DB.prepare(
    "SELECT email,status,ai_classify,connected_by,connected_at,last_sync_at,last_error,backfill_done FROM gmail_connection WHERE id='workspace'",
  ).first<{
    email: string;
    status: string;
    ai_classify: number;
    backfill_done: number;
    connected_by: string;
    connected_at: string;
    last_sync_at: string | null;
    last_error: string | null;
  }>();
  return c.json({
    configured: config.ready,
    missing: access.admin ? config.missing : [],
    mailbox: config.mailbox,
    connected: row?.status === 'CONNECTED',
    status: row?.status ?? 'NOT_CONNECTED',
    email: row?.email ?? null,
    connectedAt: row?.connected_at ?? null,
    lastSyncAt: row?.last_sync_at ?? null,
    lastError: row?.last_error ?? null,
    aiClassify: Boolean(row?.ai_classify),
    backfillDone: Boolean(row?.backfill_done),
    aiAvailable: Boolean(openAiClassifier(c.env)),
    isAdmin: access.admin,
  });
});

gmailRoutes.get('/messages', async (c) => {
  await memberAccess(c);
  const requested = c.req.query('view') ?? 'inbox';
  const view = ['inbox', 'other', 'customer', 'junk', 'all'].includes(requested) ? requested : 'inbox';
  const q = (c.req.query('q') ?? '').trim().slice(0, 100);
  const like = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT m.id,m.thread_id AS threadId,m.from_name AS fromName,m.from_email AS fromEmail,m.subject,m.snippet,
      m.received_at AS receivedAt,m.classification,m.reason,m.customer_id AS customerId,c.name AS customerName,m.in_spam AS inSpam
     FROM email_messages m LEFT JOIN customers c ON c.id=m.customer_id
     WHERE CASE ? WHEN 'inbox' THEN m.in_spam=0 AND m.classification='CUSTOMER' WHEN 'other' THEN m.in_spam=0 AND m.classification='NOT_CUSTOMER' WHEN 'junk' THEN m.in_spam=1 WHEN 'customer' THEN m.classification='CUSTOMER' ELSE 1 END
       AND (?='' OR m.subject LIKE ? ESCAPE '\\' OR m.from_email LIKE ? ESCAPE '\\' OR m.from_name LIKE ? ESCAPE '\\' OR m.snippet LIKE ? ESCAPE '\\')
     ORDER BY m.received_at DESC LIMIT 200`,
  )
    .bind(view, q, like, like, like, like)
    .all();
  const counts = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total,SUM(classification='CUSTOMER') AS customers,SUM(in_spam=0 AND classification='CUSTOMER') AS inbox,SUM(in_spam=0 AND classification='NOT_CUSTOMER') AS other,SUM(in_spam=1) AS junk FROM email_messages",
  ).first<{ total: number; customers: number | null; inbox: number | null; other: number | null; junk: number | null }>();
  return c.json({
    messages: results,
    total: counts?.total ?? 0,
    customers: counts?.customers ?? 0,
    inbox: counts?.inbox ?? 0,
    other: counts?.other ?? 0,
    junk: counts?.junk ?? 0,
  });
});

gmailRoutes.get('/messages/:id', async (c) => {
  await memberAccess(c);
  const message = await c.env.DB.prepare(
    `SELECT m.id,m.thread_id AS threadId,m.from_name AS fromName,m.from_email AS fromEmail,m.to_text AS toText,m.subject,
      m.body_text AS bodyText,m.body_html AS bodyHtml,m.snippet,m.received_at AS receivedAt,m.classification,m.reason,m.customer_id AS customerId,
      c.name AS customerName,m.in_spam AS inSpam
     FROM email_messages m LEFT JOIN customers c ON c.id=m.customer_id WHERE m.id=?`,
  )
    .bind(c.req.param('id'))
    .first();
  if (!message) return c.json({ error: { message: 'Email not found.' } }, 404);
  if ((message as { bodyHtml: string | null }).bodyHtml === null)
    (message as { bodyHtml: string | null }).bodyHtml = await loadMessageHtml(c.env, c.req.param('id'));
  return c.json(message);
});

const classificationInput = z.object({ classification: z.enum(['CUSTOMER', 'NOT_CUSTOMER']) }).strict();
gmailRoutes.patch('/messages/:id', async (c) => {
  const access = await memberAccess(c);
  const input = classificationInput.parse(await c.req.json());
  const result = await c.env.DB.prepare('UPDATE email_messages SET classification=?,reason=? WHERE id=?')
    .bind(input.classification, `Marked by ${access.email}`, c.req.param('id'))
    .run();
  if (!result.meta.changes) return c.json({ error: { message: 'Email not found.' } }, 404);
  return c.json({ ok: true });
});

gmailRoutes.post('/sync', async (c) => {
  await memberAccess(c);
  const result = await syncGmail(c.env);
  await reclassifyStoredEmails(c.env);
  if (result.status === 'reconnect')
    return c.json({ error: { message: 'Gmail needs to be reconnected by the administrator.' } }, 409);
  if (result.status === 'error') return c.json({ error: { message: 'Gmail could not be checked. Please retry shortly.' } }, 502);
  return c.json(result);
});

const settingsInput = z.object({ aiClassify: z.boolean() }).strict();
gmailRoutes.patch('/settings', async (c) => {
  await memberAccess(c, true);
  const input = settingsInput.parse(await c.req.json());
  const result = await c.env.DB.prepare("UPDATE gmail_connection SET ai_classify=?,updated_at=? WHERE id='workspace'")
    .bind(Number(input.aiClassify), now())
    .run();
  if (!result.meta.changes) return c.json({ error: { message: 'Connect Gmail first.' } }, 409);
  return c.json({ ok: true });
});

// --- OAuth (top-level navigations; errors redirect back to Settings) ---
const back = (c: Context<AppEnv>, outcome: string) =>
  c.redirect(`/settings?tab=integrations&gmail=${encodeURIComponent(outcome)}`, 303);

gmailOAuthRoutes.get('/connect', async (c) => {
  const access = await memberAccess(c, true);
  const config = gmailConfig(c.env);
  if (!config.ready) return back(c, 'not-configured');
  if (new URL(config.redirectUri).origin !== new URL(c.req.url).origin) return back(c, 'wrong-host');
  const session = sessionToken(c.req.header('Cookie'));
  if (!session || c.get('authMethod') !== 'password') return back(c, 'password-session-required');
  const state = crypto.randomUUID() + crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM gmail_oauth_states WHERE expires_at<? OR actor_email=?').bind(now(), access.email),
    c.env.DB.prepare('INSERT INTO gmail_oauth_states(state_hash,actor_email,session_hash,expires_at) VALUES(?,?,?,?)').bind(
      await digest(state),
      access.email,
      await digest(session),
      new Date(Date.now() + 600_000).toISOString(),
    ),
  ]);
  return c.redirect(authorizationUrl(c.env, state).href, 302);
});

gmailOAuthRoutes.get('/callback', async (c) => {
  const access = await memberAccess(c, true);
  const config = gmailConfig(c.env);
  if (!config.ready) return back(c, 'not-configured');
  const state = c.req.query('state') ?? '';
  const session = sessionToken(c.req.header('Cookie'));
  if (!state || state.length > 200 || !session) return back(c, 'invalid-state');
  const valid = await c.env.DB.prepare(
    'UPDATE gmail_oauth_states SET consumed_at=? WHERE state_hash=? AND actor_email=? AND session_hash=? AND expires_at>? AND consumed_at IS NULL',
  )
    .bind(now(), await digest(state), access.email, await digest(session), now())
    .run();
  if (!valid.meta.changes) return back(c, 'invalid-state');
  if (c.req.query('error')) return back(c, 'cancelled');
  const code = c.req.query('code') ?? '';
  if (!code || code.length > 4096) return back(c, 'invalid-code');
  let tokens;
  try {
    tokens = await exchangeCode(c.env, code);
  } catch {
    return back(c, 'token-failed');
  }
  if (!tokens.refresh_token || !(tokens.scope ?? '').split(' ').includes(GMAIL_SCOPE)) {
    if (tokens.refresh_token) await revokeToken(tokens.refresh_token);
    return back(c, 'missing-permission');
  }
  let profileEmail: string;
  try {
    profileEmail = ((await gmailGet<{ emailAddress?: string }>(tokens.access_token!, 'profile')).emailAddress ?? '').toLowerCase();
  } catch {
    return back(c, 'profile-failed');
  }
  if (profileEmail !== config.mailbox) {
    await revokeToken(tokens.refresh_token);
    return back(c, 'wrong-mailbox');
  }
  const encrypted = await encryptRefreshToken(c.env, config.mailbox, tokens.refresh_token);
  const time = now();
  const previous = await c.env.DB.prepare("SELECT email,token_ciphertext,token_nonce,token_key_version FROM gmail_connection WHERE id='workspace'").first<{
    email: string;
    token_ciphertext: string;
    token_nonce: string;
    token_key_version: string;
  }>();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO gmail_connection(id,email,status,token_ciphertext,token_nonce,token_key_version,history_id,connected_by,connected_at,updated_at)
       VALUES('workspace',?,'CONNECTED',?,?,?,NULL,?,?,?)
       ON CONFLICT(id) DO UPDATE SET email=excluded.email,status='CONNECTED',token_ciphertext=excluded.token_ciphertext,
         token_nonce=excluded.token_nonce,token_key_version=excluded.token_key_version,
         history_id=CASE WHEN gmail_connection.email=excluded.email THEN gmail_connection.history_id ELSE NULL END,
         connected_by=excluded.connected_by,connected_at=excluded.connected_at,last_error=NULL,health_alerted_at=NULL,sync_lease_until=NULL,updated_at=excluded.updated_at`,
    ).bind(config.mailbox, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, access.email, time, time),
    c.env.DB.prepare(
      'INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) VALUES(?,?,?,?,?,?,?)',
    ).bind(crypto.randomUUID(), 'integration', 'gmail', 'connected', `Gmail inbox connected: ${config.mailbox}`, access.email, time),
  ]);
  if (previous) {
    try {
      await revokeToken(
        await decryptRefreshToken(c.env, previous.email, {
          ciphertext: previous.token_ciphertext,
          nonce: previous.token_nonce,
          keyVersion: previous.token_key_version,
        }),
      );
    } catch {
      /* old token is unusable anyway */
    }
  }
  return back(c, 'connected');
});

gmailOAuthRoutes.post('/disconnect', async (c) => {
  const access = await memberAccess(c, true);
  const row = await c.env.DB.prepare("SELECT email,token_ciphertext,token_nonce,token_key_version FROM gmail_connection WHERE id='workspace'").first<{
    email: string;
    token_ciphertext: string;
    token_nonce: string;
    token_key_version: string;
  }>();
  if (!row) return c.json({ ok: true });
  try {
    await revokeToken(
      await decryptRefreshToken(c.env, row.email, {
        ciphertext: row.token_ciphertext,
        nonce: row.token_nonce,
        keyVersion: row.token_key_version,
      }),
    );
  } catch {
    /* still remove the local connection */
  }
  const time = now();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM gmail_connection WHERE id='workspace'"),
    c.env.DB.prepare(
      'INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) VALUES(?,?,?,?,?,?,?)',
    ).bind(crypto.randomUUID(), 'integration', 'gmail', 'disconnected', `Gmail inbox disconnected: ${row.email}`, access.email, time),
  ]);
  return c.json({ ok: true });
});
