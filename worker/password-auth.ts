import { Hono } from 'hono';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from './auth';
import { digest } from './auth';
import { allowedSales } from './services/line';

export const passwordAuthRoutes = new Hono<AppEnv>();
// Cloudflare Workers currently rejects PBKDF2 iteration counts above 100,000.
const ITERATIONS = 100_000;
const SESSION_DAYS = 30;
const dummySalt = 'corevity-login-dummy-salt-v1';
const encoder = new TextEncoder();

async function allowedEmails(env: AppEnv['Bindings']) {
  const users = await env.DB.prepare(
    'SELECT email FROM workspace_users WHERE is_active=1',
  ).all<{ email: string }>();
  return [...new Set([...allowedSales(env), ...(users.results ?? []).map((user) => user.email.toLowerCase())])];
}

function requireWorkspaceAdmin(c: Context<AppEnv>) {
  const admin = (c.env.AUTH_ADMIN_EMAIL ?? allowedSales(c.env)[0] ?? '').toLowerCase();
  if (!admin || c.get('email').toLowerCase() !== admin)
    throw new HTTPException(403, { message: 'Only the workspace administrator can add users.' });
}

function cookieToken(header: string | undefined) {
  for (const item of (header ?? '').split(';')) {
    const [key, ...rest] = item.trim().split('=');
    if (key === 'corevity_session') return rest.join('=');
  }
  return '';
}

function cookie(value: string, secure: boolean) {
  return `corevity_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}

async function passwordHash(password: string, salt: string, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function equalDigest(left: string, right: string) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++)
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

function randomToken(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function passwordIsValid(password: string) {
  const length = Array.from(password).length;
  return length >= 6 && length <= 128;
}

async function createSession(c: Context<AppEnv>, email: string) {
  const token = randomToken();
  const timestamp = new Date();
  const now = timestamp.toISOString();
  timestamp.setDate(timestamp.getDate() + SESSION_DAYS);
  const tokenHash = await digest(token);
  await c.env.DB.prepare(
    'INSERT INTO auth_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)',
  ).bind(tokenHash, email, now, timestamp.toISOString(), now).run();
  const isSecure = new URL(c.req.url).protocol === 'https:';
  c.header('Set-Cookie', cookie(token, isSecure));
}

passwordAuthRoutes.get('/session', async (c) => {
  const email = c.get('email');
  if (!email) return c.json({ authenticated: false });
  const user = await c.env.DB.prepare('SELECT email FROM auth_users WHERE email=? COLLATE NOCASE')
    .bind(email).first<{ email: string }>();
  return c.json({
    authenticated: true,
    email,
    method: c.get('authMethod'),
    hasPassword: Boolean(user),
  });
});

passwordAuthRoutes.post('/login', async (c) => {
  const body = z.object({ username: z.string().trim().max(254), password: z.string().max(256) }).parse(await c.req.json());
  const username = body.username.toLowerCase();
  const bucket = await digest(`${username}\0${c.req.header('CF-Connecting-IP') ?? 'unknown'}`);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - 900;
  await c.env.DB.prepare('DELETE FROM auth_login_attempts WHERE window_started_at<?').bind(now - 86_400).run();
  const attempt = await c.env.DB.prepare(
    `INSERT INTO auth_login_attempts(bucket_key,window_started_at,attempts) VALUES(?,?,1)
     ON CONFLICT(bucket_key) DO UPDATE SET
       attempts=CASE WHEN auth_login_attempts.window_started_at < ? THEN 1 ELSE auth_login_attempts.attempts+1 END,
       window_started_at=CASE WHEN auth_login_attempts.window_started_at < ? THEN ? ELSE auth_login_attempts.window_started_at END
     RETURNING attempts`,
  ).bind(bucket, now, windowStart, windowStart, now).first<{ attempts: number }>();
  if ((attempt?.attempts ?? 0) > 8)
    return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait 15 minutes.' } }, 429);

  const row = (await allowedEmails(c.env)).includes(username)
    ? await c.env.DB.prepare('SELECT email,password_salt AS salt,password_hash AS hash,password_iterations AS iterations FROM auth_users WHERE email=? COLLATE NOCASE')
        .bind(username)
        .first<{ email: string; salt: string; hash: string; iterations: number }>()
    : null;
  const candidate = await passwordHash(body.password, row?.salt ?? dummySalt, row?.iterations ?? ITERATIONS);
  if (!row || !equalDigest(candidate, row.hash))
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Username or password is incorrect.' } }, 401);

  await c.env.DB.prepare('DELETE FROM auth_login_attempts WHERE bucket_key=?').bind(bucket).run();
  await c.env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(new Date().toISOString()).run();
  await createSession(c, row.email);
  return c.json({ authenticated: true, email: row.email });
});

passwordAuthRoutes.post('/password', async (c) => {
  const email = c.get('email').toLowerCase();
  if (!email || c.get('authMethod') === 'none' || !(await allowedEmails(c.env)).includes(email))
    return c.json({ error: { code: 'FORBIDDEN', message: 'This account is not allowed to set a password.' } }, 403);
  const body = z.object({
    password: z.string().max(256),
    currentPassword: z.string().max(256).optional(),
  }).parse(await c.req.json());
  if (!passwordIsValid(body.password))
    return c.json({ error: { code: 'VALIDATION', message: 'Use a password between 6 and 128 characters.' } }, 422);

  const existing = await c.env.DB.prepare('SELECT password_salt AS salt,password_hash AS hash,password_iterations AS iterations FROM auth_users WHERE email=? COLLATE NOCASE')
    .bind(email).first<{ salt: string; hash: string; iterations: number }>();
  if (existing && c.get('authMethod') === 'password') {
    const current = body.currentPassword ?? '';
    const currentHash = await passwordHash(current, existing.salt, existing.iterations);
    if (!equalDigest(currentHash, existing.hash))
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect.' } }, 401);
  }
  const salt = randomToken(16);
  const hash = await passwordHash(body.password, salt);
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO auth_users(email,password_salt,password_hash,password_iterations,created_at,updated_at)
     VALUES(?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET password_salt=excluded.password_salt,
     password_hash=excluded.password_hash,password_iterations=excluded.password_iterations,updated_at=excluded.updated_at`,
  ).bind(email, salt, hash, ITERATIONS, now, now).run();
  await c.env.DB.prepare('DELETE FROM auth_sessions WHERE email=?').bind(email).run();
  await createSession(c, email);
  return c.json({ saved: true, email });
});

passwordAuthRoutes.post('/users', async (c) => {
  requireWorkspaceAdmin(c);
  const input = z.object({
    email: z.string().trim().email().max(254),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    phone: z.string().trim().max(50).default(''),
  }).strict().parse(await c.req.json());
  const email = input.email.toLowerCase();
  if ((await allowedEmails(c.env)).includes(email) || await c.env.DB.prepare('SELECT email FROM auth_users WHERE email=? COLLATE NOCASE').bind(email).first())
    return c.json({ error: { code: 'CONFLICT', message: 'This email already has workspace access.' } }, 409);

  const temporaryPassword = randomToken(18);
  const salt = randomToken(16);
  const hash = await passwordHash(temporaryPassword, salt);
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO workspace_users(email,is_active,created_by,created_at) VALUES(?,1,?,?)').bind(email,c.get('email'),now),
    c.env.DB.prepare('INSERT INTO auth_users(email,password_salt,password_hash,password_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(email,salt,hash,ITERATIONS,now,now),
    c.env.DB.prepare('INSERT INTO salespeople(email,first_name,last_name,phone,updated_at) VALUES(?,?,?,?,?)').bind(email,input.firstName,input.lastName,input.phone,now),
  ]);
  return c.json({ email, temporaryPassword }, 201);
});

passwordAuthRoutes.post('/logout', async (c) => {
  const token = cookieToken(c.req.header('Cookie'));
  if (token)
    await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await digest(token)).run();
  c.header('Set-Cookie', `corevity_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(c.req.url).protocol === 'https:' ? '; Secure' : ''}`);
  return c.json({ loggedOut: true });
});

passwordAuthRoutes.get('/readiness', async (c) => {
  const email = c.get('email').toLowerCase();
  const adminEmail = (c.env.AUTH_ADMIN_EMAIL ?? allowedSales(c.env)[0] ?? '').toLowerCase();
  if (!email || email !== adminEmail)
    return c.json({ error: { code: 'FORBIDDEN', message: 'Only the account administrator can view sign-in readiness.' } }, 403);
  const users = await c.env.DB.prepare('SELECT email FROM auth_users').all<{ email: string }>();
  const enrolled = new Set((users.results ?? []).map((user) => user.email.toLowerCase()));
  const accounts = (await allowedEmails(c.env)).map((address) => ({ email: address, ready: enrolled.has(address) }));
  return c.json({ accounts, ready: accounts.length > 0 && accounts.every((account) => account.ready) });
});
