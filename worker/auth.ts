import type { MiddlewareHandler } from 'hono';
import type { MetaEnvironment } from './services/meta/config';
import { workspaceSalesEmails } from './services/line';
export type Bindings = Env & MetaEnvironment & {
  LOCAL_MOCK_EMAIL?: string;
  AI_API_KEY?: string;
  BOT_API_KEY?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
  APP_URL?: string;
  PUBLIC_CATALOG_BASE_URL?: string;
  AUTH_ADMIN_EMAIL?: string;
  CATALOG_CHAT_INTERNAL_SECRET?: string;
};
export type AppEnv = {
  Bindings: Bindings;
  Variables: { email: string; authMethod: 'password' | 'access' | 'none' };
};

export async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Compare secrets without leaking how many leading characters match.
// Hashing first gives both sides the same length; the XOR loop runs on Workers and in tests.
export async function secretsEqual(provided: string, expected: string) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function cookieValue(header: string | undefined, name: string) {
  for (const item of (header ?? '').split(';')) {
    const [key, ...value] = item.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}

export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const url = new URL(c.req.url);
  const optional = ['/api/auth/login', '/api/auth/session', '/api/auth/logout'].includes(url.pathname);
  const sessionCookie = cookieValue(c.req.header('Cookie'), 'corevity_session');
  if (sessionCookie) {
    const tokenHash = await digest(sessionCookie);
    const session = await c.env.DB.prepare(
      'SELECT email FROM auth_sessions WHERE token_hash=? AND expires_at>? LIMIT 1',
    ).bind(tokenHash, new Date().toISOString()).first<{ email: string }>();
    if (session) {
      // A session outlives access changes, so re-check the account on every request.
      if ((await workspaceSalesEmails(c.env)).includes(session.email.toLowerCase())) {
        c.set('email', session.email);
        c.set('authMethod', 'password');
        return next();
      }
      c.set('email', '');
      c.set('authMethod', 'none');
      if (optional) return next();
      return c.json(
        { error: { message: 'This account no longer has access.', code: 'FORBIDDEN' } },
        403,
      );
    }
  }
  if (
    import.meta.env.DEV &&
    c.env.ENVIRONMENT === 'development' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    c.env.LOCAL_MOCK_EMAIL
  ) {
    c.set('email', c.env.LOCAL_MOCK_EMAIL);
    c.set('authMethod', 'access');
    return next();
  }
  c.set('email', '');
  c.set('authMethod', 'none');
  if (optional) return next();
  return c.json(
    {
      error: {
        message: 'Please sign in to continue.',
        code: 'UNAUTHORIZED',
      },
    },
    401,
  );
};
