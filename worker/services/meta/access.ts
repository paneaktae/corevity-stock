import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../../auth';
import { workspaceSalesEmails, allowedSales } from '../line';

export async function metaAccess(c: Context<AppEnv>, requireAdmin = false) {
  const email = c.get('email').trim().toLowerCase();
  if (!email)
    throw new HTTPException(401, { message: 'Please sign in to continue.' });
  // Recheck membership even for a still-valid session belonging to a removed user.
  if (!(await workspaceSalesEmails(c.env)).includes(email))
    throw new HTTPException(403, {
      message: 'Meta integration requires active workspace membership.',
    });
  const adminEmail = (c.env.AUTH_ADMIN_EMAIL ?? allowedSales(c.env)[0] ?? '')
    .trim()
    .toLowerCase();
  const admin = Boolean(adminEmail && email === adminEmail);
  if (requireAdmin && !admin)
    throw new HTTPException(403, {
      message: 'Only the workspace administrator can manage Meta integration.',
    });
  return { email, admin };
}
