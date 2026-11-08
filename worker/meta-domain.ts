import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from './auth';
import { metaInboxRoutes } from './services/meta/inbox';
import { metaReportRoutes } from './services/meta/reports';
import { metaLeadRoutes } from './services/meta/leads';
import { metaDraftRoutes } from './services/meta/drafts';
import { metaAIRoutes } from './services/meta/ai';
import { metaContext } from './services/meta/context';
import { metaAccess } from './services/meta/access';
import { timestamp } from './services/meta/store';
import { processMetaWebhooks } from './services/meta/webhooks';
import { ensureDemoInbox } from './services/meta/inbox';
import { operationAudit, uuid } from './services/meta/store';
export const metaDomainRoutes = new Hono<AppEnv>();
metaDomainRoutes.use(
  '*',
  bodyLimit({
    maxSize: 16_384,
    onError: (c) =>
      c.json(
        {
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Meta request is too large.',
          },
        },
        413,
      ),
  }),
);
metaDomainRoutes.route('/', metaInboxRoutes);
metaDomainRoutes.route('/', metaReportRoutes);
metaDomainRoutes.route('/', metaLeadRoutes);
metaDomainRoutes.route('/', metaDraftRoutes);
metaDomainRoutes.route('/', metaAIRoutes);
metaDomainRoutes.post('/demo/connection', async (c) => {
  const ctx = await metaContext(c);
  await metaAccess(c, true);
  if (ctx.mode !== 'DEMO')
    throw new HTTPException(403, {
      message: 'This operation is available only in Demo Mode.',
    });
  const input = z
    .object({ connected: z.boolean() })
    .strict()
    .parse(await c.req.json());
  await c.env.DB.prepare(
    "INSERT INTO meta_demo_entities(id,kind,data,created_at) VALUES('demo:connection','CONNECTION',?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,created_at=excluded.created_at",
  )
    .bind(JSON.stringify(input), timestamp())
    .run();
  return c.json({ mode: 'DEMO', simulated: true, ...input });
});
metaDomainRoutes.post('/demo/events', async (c) => {
  const ctx = await metaContext(c, 'readMessenger');
  if (ctx.mode !== 'DEMO')
    throw new HTTPException(403, {
      message: 'This operation is available only in Demo Mode.',
    });
  const input = z
    .object({
      kind: z.enum(['MESSAGE', 'READ', 'LEAD']),
      text: z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .default('Demo inquiry: could you share the available equipment?'),
    })
    .strict()
    .parse(await c.req.json());
  await ensureDemoInbox(c.env);
  const id = uuid(),
    now = timestamp(),
    statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        "INSERT INTO meta_demo_entities(id,kind,data,created_at) VALUES(?,'WEBHOOK',?,?)",
      ).bind(
        'demo:event:' + id,
        JSON.stringify({
          kind: input.kind,
          status: 'PROCESSED',
          simulated: true,
        }),
        now,
      ),
    ];
  if (input.kind === 'MESSAGE')
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO meta_messages(id,conversation_id,provider_message_id,direction,body,status,created_at) VALUES(?,'demo:conversation',?,'INBOUND',?,'RECEIVED',?)",
      ).bind(id, 'demo:mid:' + id, input.text, now),
      c.env.DB.prepare(
        "UPDATE meta_conversations SET last_incoming_at=?,last_message_at=?,unread_count=unread_count+1,updated_at=? WHERE id='demo:conversation' AND mode='DEMO'",
      ).bind(now, now, now),
    );
  if (input.kind === 'READ')
    statements.push(
      c.env.DB.prepare(
        "UPDATE meta_messages SET status='READ' WHERE conversation_id='demo:conversation' AND direction='OUTBOUND' AND status IN ('SENT','DELIVERED')",
      ),
    );
  if (input.kind === 'LEAD')
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO meta_demo_entities(id,kind,data,created_at) VALUES(?,'LEAD',?,?)",
      ).bind(
        'demo:lead:' + id,
        JSON.stringify({
          name: 'Demo inquiry',
          source: 'FACEBOOK_LEAD_AD',
          simulated: true,
        }),
        now,
      ),
    );
  statements.push(
    operationAudit(c.env, 'DEMO', ctx.email, 'DEMO_INITIALIZED', id),
  );
  await c.env.DB.batch(statements);
  return c.json({ mode: 'DEMO', simulated: true, id }, 201);
});
metaDomainRoutes.get('/permissions', async (c) => {
  const ctx = await metaContext(c);
  return c.json({ mode: ctx.mode, ...ctx.status.permissions });
});
metaDomainRoutes.get('/ads/accounts', async (c) => {
  const ctx = await metaContext(c, 'readAds', true);
  return c.json({
    mode: ctx.mode,
    accounts: ctx.status.adAccount ? [ctx.status.adAccount] : [],
  });
});
metaDomainRoutes.get('/webhooks', async (c) => {
  const ctx = await metaContext(c);
  await metaAccess(c, true);
  if (ctx.mode === 'DEMO') {
    const events = await c.env.DB.prepare(
      "SELECT id,data,created_at FROM meta_demo_entities WHERE kind='WEBHOOK' ORDER BY created_at DESC LIMIT 100",
    ).all<{ id: string; data: string; created_at: string }>();
    return c.json({
      mode: 'DEMO',
      events: events.results.map((v) => ({
        id: v.id,
        created_at: v.created_at,
        attempts: 1,
        ...JSON.parse(v.data),
      })),
    });
  }
  const events = await c.env.DB.prepare(
    'SELECT id,kind,status,attempts,error_code,created_at,processed_at FROM meta_webhook_events WHERE page_id=? ORDER BY created_at DESC LIMIT 100',
  )
    .bind(ctx.pageId)
    .all();
  return c.json({ mode: ctx.mode, events: events.results });
});
metaDomainRoutes.post('/webhooks/:id/retry', async (c) => {
  const ctx = await metaContext(c);
  await metaAccess(c, true);
  const input = z
    .object({ approvedByHuman: z.literal(true) })
    .strict()
    .parse(await c.req.json());
  if (!input.approvedByHuman)
    throw new HTTPException(422, { message: 'Confirmation required.' });
  const event = await c.env.DB.prepare(
    "UPDATE meta_webhook_events SET status='PENDING',attempts=0,next_attempt_at=?,error_code=NULL WHERE id=? AND page_id=? AND status='FAILED' AND payload<>'{}' RETURNING id",
  )
    .bind(timestamp(), c.req.param('id'), ctx.pageId)
    .first();
  if (!event)
    throw new HTTPException(404, {
      message: 'Retryable webhook event not found.',
    });
  c.executionCtx.waitUntil(processMetaWebhooks(c.env).catch(() => undefined));
  return c.json({ queued: true }, 202);
});
