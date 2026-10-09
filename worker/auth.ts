import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
export type Bindings = Env & { LOCAL_MOCK_EMAIL?: string; AI_API_KEY?: string };
export type AppEnv = { Bindings: Bindings; Variables: { email: string } };
export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const url = new URL(c.req.url);
  if (
    import.meta.env.DEV &&
    c.env.ENVIRONMENT === 'development' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    c.env.LOCAL_MOCK_EMAIL
  ) {
    c.set('email', c.env.LOCAL_MOCK_EMAIL);
    return next();
  }
  if (!c.env.ACCESS_TEAM_DOMAIN || !c.env.ACCESS_AUD || !c.env.ALLOWED_EMAILS)
    return c.json(
      {
        error: {
          message: 'Cloudflare Access is not configured.',
          code: 'AUTH_CONFIGURATION',
        },
      },
      503,
    );
  try {
    const issuer = `https://${c.env.ACCESS_TEAM_DOMAIN}`;
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) throw new Error('Missing token');
    const { payload } = await jwtVerify(
      token,
      createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
      { issuer, audience: c.env.ACCESS_AUD, algorithms: ['RS256'] },
    );
    const email =
      typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (
      !c.env.ALLOWED_EMAILS.split(',')
        .map((v) => v.trim().toLowerCase())
        .includes(email) ||
      !email
    )
      return c.json(
        {
          error: { message: 'This account is not allowed.', code: 'FORBIDDEN' },
        },
        403,
      );
    c.set('email', email);
  } catch {
    return c.json(
      {
        error: {
          message: 'Sign in through Cloudflare Access.',
          code: 'UNAUTHORIZED',
        },
      },
      401,
    );
  }
  return next();
};
