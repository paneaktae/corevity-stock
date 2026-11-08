import { z } from 'zod';
import type { Bindings } from '../../auth';
import { timestamp } from './store';
import { metaAuditStatement } from './audit';

// Meta signed_request authenticates this exact public endpoint without a CRM cookie.
export async function handleMetaDeauthorization(
  request: Request,
  env: Bindings,
) {
  if (request.method !== 'POST')
    return new Response('Method not allowed', { status: 405 });
  if (!env.META_APP_SECRET)
    return new Response('Not configured', { status: 503 });
  const reader = request.body?.getReader();
  if (!reader) return new Response('Invalid request', { status: 400 });
  let body = '';
  const decoder = new TextDecoder();
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 16384) {
      await reader.cancel();
      return new Response('Payload too large', { status: 413 });
    }
    body += decoder.decode(part.value, { stream: true });
  }
  try {
    const signed = new URLSearchParams(body).get('signed_request') ?? '';
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(signed)) throw new Error();
    const [signature, payload] = signed.split('.');
    const decode = (value: string) =>
      Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (v) =>
        v.charCodeAt(0),
      );
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.META_APP_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    if (
      !(await crypto.subtle.verify(
        'HMAC',
        key,
        decode(signature),
        new TextEncoder().encode(payload),
      ))
    )
      throw new Error();
    const data = z
      .object({
        algorithm: z.literal('HMAC-SHA256'),
        user_id: z.string().regex(/^\d+$/).max(100),
        issued_at: z.number().int().nonnegative(),
      })
      .parse(JSON.parse(new TextDecoder().decode(decode(payload))));
    if (data.issued_at > Date.now() / 1000 + 300) throw new Error();
    // An old signed request must not invalidate a newer reauthorization.
    const connection = await env.DB.prepare(
      "SELECT id,generation FROM meta_connections WHERE mode='LIVE' AND provider_user_id=? AND status<>'DISCONNECTED' AND connected_at<=?",
    )
      .bind(data.user_id, new Date((data.issued_at + 1) * 1000).toISOString())
      .first<{ id: string; generation: number }>();
    if (connection) {
      const now = timestamp();
      await env.DB.batch([
        env.DB.prepare(
          'DELETE FROM meta_token_secrets WHERE token_id IN(SELECT id FROM meta_token_metadata WHERE connection_id=?) AND EXISTS(SELECT 1 FROM meta_connections WHERE id=? AND generation=?)',
        ).bind(connection.id, connection.id, connection.generation),
        env.DB.prepare(
          "UPDATE meta_token_metadata SET revoked_at=?,permission_status='REVOKED' WHERE connection_id=? AND EXISTS(SELECT 1 FROM meta_connections WHERE id=? AND generation=?)",
        ).bind(now, connection.id, connection.id, connection.generation),
        env.DB.prepare(
          "UPDATE meta_connections SET status='DISCONNECTED',generation=generation+1,disconnected_at=?,updated_at=? WHERE id=? AND generation=?",
        ).bind(now, now, connection.id, connection.generation),
        env.DB.prepare(
          'DELETE FROM meta_oauth_states WHERE generation<=?',
        ).bind(connection.generation),
        metaAuditStatement(env.DB, {
          actorEmail: 'meta:deauthorization',
          mode: 'LIVE',
          action: 'CONNECTION_DISCONNECTED',
          outcome: 'SUCCESS',
        }),
      ]);
    }
    return new Response('OK', { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('Invalid signed request', { status: 403 });
  }
}
