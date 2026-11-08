import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from './auth';
import { metaSettingsInput } from '../shared/meta';
import { metaAccess } from './services/meta/access';
import { metaConfiguration } from './services/meta/config';
import { metaIntegrationStatus } from './services/meta/integration';
import { metaAuditStatement } from './services/meta/audit';
import { metaOAuthRoutes } from './services/meta/oauth';
import { metaContext } from './services/meta/context';
import { operationAudit } from './services/meta/store';
import { z } from 'zod';
import { messengerAutomationRoutes } from './services/meta/messenger-automation';

export const metaRoutes = new Hono<AppEnv>();
metaRoutes.use('*',async(c,next)=>{c.header('Referrer-Policy','no-referrer');await next();});
metaRoutes.get('/status', async (c) => {
  const access = await metaAccess(c);
  return c.json(await metaIntegrationStatus(c.env, access.admin));
});
metaRoutes.patch('/settings', bodyLimit({ maxSize: 2048 }), async (c) => {
  const { email } = await metaAccess(c, true);
  const input = metaSettingsInput.parse(await c.req.json());
  const config = metaConfiguration(c.env);
  if (input.demoEnabled && !config.flags.META_DEMO_MODE) {
    return c.json(
      {
        error: {
          code: 'META_DEMO_DISABLED',
          message:
            'Demo Mode must first be enabled in the Worker configuration.',
        },
      },
      409,
    );
  }
  const timestamp = new Date().toISOString();
  // Preference and its audit record commit together, or neither commits.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO meta_integration_settings(id,demo_enabled,updated_by,updated_at) VALUES('workspace',?,?,?)
      ON CONFLICT(id) DO UPDATE SET demo_enabled=excluded.demo_enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    ).bind(input.demoEnabled ? 1 : 0, email, timestamp),
    metaAuditStatement(
      c.env.DB,
      {
        actorEmail: email,
        mode: input.demoEnabled ? 'DEMO' : 'LIVE',
        action: 'SETTINGS_UPDATED',
        outcome: 'SUCCESS',
      },
      timestamp,
    ),
  ]);
  return c.json(await metaIntegrationStatus(c.env, true));
});
metaRoutes.get('/logs', async (c) => {
  await metaAccess(c, true);
  const rows = await c.env.DB.prepare(
    'SELECT id,mode,actor_email AS actorEmail,action,outcome,created_at AS createdAt FROM meta_audit_logs UNION ALL SELECT id,mode,actor_email AS actorEmail,action,outcome,created_at AS createdAt FROM meta_operation_audit_logs ORDER BY createdAt DESC,id DESC LIMIT 50',
  ).all();
  return c.json({ logs: rows.results });
});
metaRoutes.route('/',metaOAuthRoutes);
metaRoutes.route('/',messengerAutomationRoutes);
metaRoutes.post('/subscribe',async c=>{
  z.object({approvedByHuman:z.literal(true)}).strict().parse(await c.req.json());
  const ctx=await metaContext(c);await metaAccess(c,true);
  if(ctx.mode==='LIVE'&&!ctx.status.permissions.granted.includes('pages_manage_metadata'))
    return c.json({error:{message:'Page subscription requires pages_manage_metadata permission.'}},403);
  const fields:string[]=[];
  if(ctx.status.capabilities.readMessenger)fields.push('messages','messaging_postbacks','message_deliveries','message_reads');
  if(ctx.status.capabilities.syncLeads)fields.push('leadgen');
  if(!fields.length)return c.json({error:{message:'Enable an authorized Messenger or Lead Ads feature first.'}},409);
  await ctx.provider.write('subscribe',{fields:fields.join(',')});
  await operationAudit(c.env,ctx.mode,ctx.email,'WEBHOOK_SUBSCRIBED',ctx.pageId).run();
  return c.json({subscribed:true,fields,mode:ctx.mode});
});
