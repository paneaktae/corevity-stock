import { Hono } from 'hono';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Bindings } from '../../auth';
import { digest } from '../../auth';
import { formMappingInput } from '../../../shared/meta-domain';
import { metaContext } from './context';
import { metaAccess } from './access';
import { object, string, MetaGraphClient } from './graph';
import {
  GraphAPIMetaProvider,
  type MetaProvider,
  type ProviderPage,
} from './provider';
import { loadToken, operationAudit, rateLimit, timestamp, uuid } from './store';
import { workspaceSalesEmails } from '../line';
import { isDemo } from './oauth';
export async function importMetaLead(
  env: Bindings,
  job: { id: string; asset_id: string; payload: string },
  provider?: MetaProvider,
) {
  const payload = z
    .object({
      pageId: z.string().regex(/^\d+$/),
      formId: z.string().regex(/^\d+$/),
    })
    .parse(JSON.parse(job.payload));
  const previous = await env.DB.prepare(
    'SELECT lead_id FROM meta_lead_sync_events WHERE page_id=? AND provider_lead_id=? AND lead_id IS NOT NULL',
  )
    .bind(payload.pageId, job.asset_id)
    .first<{ lead_id: string }>();
  if (previous) return { id: previous.lead_id, duplicate: true };
  const mapping = await env.DB.prepare(
    "SELECT field_mapping,assigned_to FROM meta_lead_form_mappings WHERE mode='LIVE' AND page_id=? AND form_id=? AND enabled=1",
  )
    .bind(payload.pageId, payload.formId)
    .first<{ field_mapping: string; assigned_to: string }>();
  if (!mapping) throw new Error('MAPPING_REQUIRED');
  const permission = await env.DB.prepare(
    "SELECT id FROM meta_permissions WHERE permission='leads_retrieval' AND status='GRANTED' AND (asset_id='' OR asset_id=?) AND connection_id IN(SELECT id FROM meta_connections WHERE mode='LIVE' AND status='CONNECTED')",
  )
    .bind(payload.pageId)
    .first();
  const page = await env.DB.prepare(
    "SELECT p.id FROM meta_pages p JOIN meta_connections c ON c.id=p.connection_id WHERE c.mode='LIVE' AND c.status='CONNECTED' AND p.selected=1 AND p.provider_page_id=?",
  )
    .bind(payload.pageId)
    .first();
  if (!permission || !page) throw new Error('PERMISSION_REQUIRED');
  if (
    mapping.assigned_to &&
    !(await workspaceSalesEmails(env)).includes(mapping.assigned_to)
  )
    throw new Error('OWNER_INACTIVE');
  const live =
    provider ??
    new GraphAPIMetaProvider(
      new MetaGraphClient(
        env,
        (await loadToken(env, 'PAGE', payload.pageId)).token,
      ),
      payload.pageId,
    );
  const remote = await live.lead(job.asset_id);
  if (
    string(remote.id) !== job.asset_id ||
    string(remote.form_id) !== payload.formId
  )
    throw new Error('FORM_MISMATCH');
  const fields: Record<string, string> = {};
  const definition = z
    .record(
      z.string(),
      z.enum([
        'name',
        'email',
        'phone',
        'country',
        'interest',
        'budget',
        'notes',
      ]),
    )
    .parse(JSON.parse(mapping.field_mapping));
  for (const entry of Array.isArray(remote.field_data)
    ? remote.field_data.map(object)
    : []) {
    const target = definition[string(entry.name)];
    if (target && Array.isArray(entry.values))
      fields[target] = entry.values
        .filter((v): v is string => typeof v === 'string')
        .join(', ')
        .slice(0, 4000);
  }
  const now = timestamp(),
    customerId = await digest(
      'meta-customer:' + payload.pageId + ':' + job.asset_id,
    ),
    leadId = await digest(
      'meta-lead-ad:' + payload.pageId + ':' + job.asset_id,
    );
  const budget =
    fields.budget &&
    /^\d+(\.\d{1,2})?$/.test(fields.budget) &&
    Number(fields.budget) <= 999999999
      ? Number(fields.budget)
      : 0;
  const email =
    fields.email && z.email().safeParse(fields.email).success
      ? fields.email
      : '';
  const notes = [
    fields.country ? 'Country: ' + fields.country : '',
    fields.notes ?? '',
    fields.budget
      ? 'Submitted budget: ' + fields.budget
      : 'Budget not provided',
  ]
    .filter(Boolean)
    .join('\n');
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customers(id,name,company_name,contact_name,phone,line_id,email,billing_address,budget,interested_in,notes,created_at,updated_at) VALUES(?,?,?, ?,?,'',?,'',?,?,?,?,?)",
      ).bind(
        customerId,
        fields.name || 'Facebook Lead',
        '',
        fields.name ?? '',
        fields.phone ?? '',
        email,
        budget,
        fields.interest ?? '',
        notes,
        now,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO leads(id,customer_id,title,status,assigned_to,estimated_value,notes,created_at,updated_at) VALUES(?,?,?,'NEW',?,?,?,?,?)",
      ).bind(
        leadId,
        customerId,
        'Facebook Lead Ads' + (fields.interest ? ' · ' + fields.interest : ''),
        mapping.assigned_to,
        budget,
        notes,
        now,
        now,
      ),
      env.DB.prepare(
        "UPDATE meta_lead_sync_events SET status='SYNCED',lead_id=?,error_code=NULL,updated_at=? WHERE page_id=? AND provider_lead_id=?",
      ).bind(leadId, now, payload.pageId, job.asset_id),
      operationAudit(env, 'LIVE', 'system', 'LEAD_IMPORTED', leadId),
    ]);
  } catch (error) {
    const winner = await env.DB.prepare(
      'SELECT lead_id FROM meta_lead_sync_events WHERE page_id=? AND provider_lead_id=? AND lead_id IS NOT NULL',
    )
      .bind(payload.pageId, job.asset_id)
      .first<{ lead_id: string }>();
    if (winner) return { id: winner.lead_id, duplicate: true };
    throw error;
  }
  return { id: leadId, duplicate: false };
}
export async function processMetaSyncJobs(env: Bindings) {
  if (
    env.META_INTEGRATION_ENABLED !== 'true' ||
    env.META_LEADS_ENABLED !== 'true' ||
    env.META_LIVE_ACTIVATION_CONFIRMED !== 'true' ||
    (await isDemo(env))
  )
    return;
  const now = timestamp();
  const rows = await env.DB.prepare(
    "SELECT id FROM meta_sync_jobs WHERE mode='LIVE' AND kind='LEAD_IMPORT' AND attempts<8 AND ((status='PENDING' AND next_attempt_at<=?) OR(status='PROCESSING' AND lease_until<?)) ORDER BY created_at LIMIT 10",
  )
    .bind(now, now)
    .all<{ id: string }>();
  for (const row of rows.results) {
    const lease = uuid();
    const job = await env.DB.prepare(
      "UPDATE meta_sync_jobs SET status='PROCESSING',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=? AND attempts<8 AND ((status='PENDING' AND next_attempt_at<=?) OR(status='PROCESSING' AND lease_until<?)) RETURNING id,asset_id,payload,attempts",
    )
      .bind(
        lease,
        new Date(Date.now() + 120_000).toISOString(),
        now,
        row.id,
        now,
        now,
      )
      .first<{
        id: string;
        asset_id: string;
        payload: string;
        attempts: number;
      }>();
    if (!job) continue;
    try {
      await importMetaLead(env, job);
      await env.DB.prepare(
        "UPDATE meta_sync_jobs SET status='SYNCED',error_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?",
      )
        .bind(timestamp(), job.id, lease)
        .run();
    } catch {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE meta_sync_jobs SET status=?,error_code='IMPORT_FAILED',next_attempt_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?",
        ).bind(
          job.attempts >= 8 ? 'FAILED' : 'PENDING',
          new Date(
            Date.now() + Math.min(3600, 60 * 2 ** job.attempts) * 1000,
          ).toISOString(),
          timestamp(),
          job.id,
          lease,
        ),
        env.DB.prepare(
          "UPDATE meta_lead_sync_events SET status='FAILED',error_code='IMPORT_FAILED',updated_at=? WHERE id=? AND lead_id IS NULL",
        ).bind(timestamp(), job.id),
      ]);
    }
  }
}
export const metaLeadRoutes = new Hono<AppEnv>();
metaLeadRoutes.get('/leads', async (c) => {
  const ctx = await metaContext(c, 'syncLeads');
  const [forms, mappings, events] = await Promise.all([
    ctx.provider.list('forms', {
      ...(c.req.query('after')
        ? { after: z.string().max(2048).parse(c.req.query('after')) }
        : {}),
    }),
    c.env.DB.prepare(
      'SELECT form_id,field_mapping,assigned_to,enabled FROM meta_lead_form_mappings WHERE mode=? AND page_id=?',
    )
      .bind(ctx.mode, ctx.pageId)
      .all(),
    ctx.mode === 'LIVE'
      ? c.env.DB.prepare(
          'SELECT id,provider_lead_id,form_id,status,lead_id,error_code,updated_at FROM meta_lead_sync_events WHERE page_id=? ORDER BY updated_at DESC LIMIT 100',
        )
          .bind(ctx.pageId)
          .all()
      : c.env.DB.prepare(
          "SELECT id,data,created_at FROM meta_demo_entities WHERE kind='LEAD' ORDER BY created_at DESC LIMIT 100",
        ).all(),
  ]);
  return c.json({
    mode: ctx.mode,
    forms: forms.data,
    after: forms.after,
    mappings: mappings.results,
    events: events.results,
  });
});
metaLeadRoutes.post('/leads/mappings', async (c) => {
  const ctx = await metaContext(c, 'syncLeads');
  await metaAccess(c, true);
  const input = formMappingInput.parse(await c.req.json());
  if (
    new Set(Object.values(input.fields)).size !==
    Object.keys(input.fields).length
  )
    throw new HTTPException(422, { message: 'Map each CRM field only once.' });
  if (
    input.assignedTo &&
    !(await workspaceSalesEmails(c.env)).includes(input.assignedTo)
  )
    throw new HTTPException(422, { message: 'Choose an active salesperson.' });
  let after: string | null = null,
    owned = false;
  for (let page = 0; page < 20; page++) {
    const forms: ProviderPage = await ctx.provider.list(
      'forms',
      after ? { after } : {},
    );
    if (forms.data.some((row) => row.id === input.formId)) {
      owned = true;
      break;
    }
    after = forms.after;
    if (!after) break;
  }
  if (!owned)
    throw new HTTPException(403, {
      message: 'Choose a form belonging to the selected Page.',
    });
  const now = timestamp();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO meta_lead_form_mappings(id,mode,page_id,form_id,field_mapping,assigned_to,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(mode,page_id,form_id) DO UPDATE SET field_mapping=excluded.field_mapping,assigned_to=excluded.assigned_to,enabled=excluded.enabled,updated_at=excluded.updated_at',
    ).bind(
      uuid(),
      ctx.mode,
      ctx.pageId,
      input.formId,
      JSON.stringify(input.fields),
      input.assignedTo,
      input.enabled ? 1 : 0,
      now,
      now,
    ),
    operationAudit(
      c.env,
      ctx.mode,
      ctx.email,
      'FORM_MAPPING_UPDATED',
      input.formId,
    ),
  ]);
  return c.json({ saved: true });
});
metaLeadRoutes.post('/leads/sync', async (c) => {
  const ctx = await metaContext(c, 'syncLeads');
  await rateLimit(c.env, ctx.email, 'lead-sync', 5);
  const input = z
    .object({
      formId: z.string().max(100),
      after: z.string().max(2048).optional(),
    })
    .strict()
    .parse(await c.req.json());
  const mapping = await c.env.DB.prepare(
    'SELECT id FROM meta_lead_form_mappings WHERE mode=? AND page_id=? AND form_id=? AND enabled=1',
  )
    .bind(ctx.mode, ctx.pageId, input.formId)
    .first();
  if (!mapping)
    throw new HTTPException(409, {
      message: 'Enable an authorized form mapping before syncing.',
    });
  const result = await ctx.provider.list('formLeads', {
    formId: input.formId,
    ...(input.after ? { after: input.after } : {}),
  });
  const now = timestamp(),
    statements: D1PreparedStatement[] = [];
  for (const lead of result.data) {
    const leadId = string(lead.id);
    if (ctx.mode === 'DEMO') {
      statements.push(
        c.env.DB.prepare(
          "INSERT OR IGNORE INTO meta_demo_entities(id,kind,data,created_at) VALUES(?,'LEAD',?,?)",
        ).bind(
          'demo:import:' + leadId,
          JSON.stringify({ ...lead, simulated: true }),
          now,
        ),
      );
      continue;
    }
    const id = await digest(ctx.pageId + ':' + leadId);
    statements.push(
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO meta_lead_sync_events(id,page_id,form_id,provider_lead_id,status,created_at,updated_at) VALUES(?,?,?,?,'PENDING',?,?)",
      ).bind(id, ctx.pageId, input.formId, leadId, now, now),
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO meta_sync_jobs(id,mode,kind,asset_id,payload,next_attempt_at,created_at,updated_at) VALUES(?,'LIVE','LEAD_IMPORT',?,?,?,?,?)",
      ).bind(
        id,
        leadId,
        JSON.stringify({ pageId: ctx.pageId, formId: input.formId }),
        now,
        now,
        now,
      ),
    );
  }
  if (statements.length) await c.env.DB.batch(statements);
  if (ctx.mode === 'LIVE')
    c.executionCtx.waitUntil(processMetaSyncJobs(c.env).catch(() => undefined));
  return c.json(
    { mode: ctx.mode, queued: result.data.length, after: result.after },
    202,
  );
});
metaLeadRoutes.post('/leads/:id/retry', async (c) => {
  const ctx = await metaContext(c, 'syncLeads');
  await metaAccess(c, true);
  const result = await c.env.DB.prepare(
    "UPDATE meta_sync_jobs SET status='PENDING',attempts=0,next_attempt_at=?,updated_at=? WHERE id=? AND status='FAILED' AND mode=? AND json_extract(payload,'$.pageId')=? RETURNING id",
  )
    .bind(timestamp(), timestamp(), c.req.param('id'), ctx.mode, ctx.pageId)
    .first();
  if (!result)
    throw new HTTPException(404, { message: 'Failed lead job not found.' });
  c.executionCtx.waitUntil(processMetaSyncJobs(c.env).catch(() => undefined));
  return c.json({ queued: true }, 202);
});
