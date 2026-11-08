import { Hono } from 'hono';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Bindings } from '../../auth';
import { digest } from '../../auth';
import {
  draftInput,
  draftTransition,
  type MetaDraft,
} from '../../../shared/meta-domain';
import { metaContext } from './context';
import { metaAccess } from './access';
import { object, string, MetaAPIError } from './graph';
import { publicProducts } from './inbox';
import { operationAudit, timestamp, uuid, rateLimit } from './store';
async function preparePayload(
  env: Bindings,
  input: z.infer<typeof draftInput>,
) {
  if (input.kind !== 'POST') return input.payload;
  if (input.payload.scheduledAt) {
    const difference = Date.parse(input.payload.scheduledAt) - Date.now();
    if (
      env.META_PAGE_SCHEDULING_SUPPORTED !== 'true' ||
      difference < 600_000 ||
      difference > 75 * 86_400_000
    )
      throw new HTTPException(422, {
        message:
          'Scheduling requires a verified supported API configuration and a time between 10 minutes and 75 days from now.',
      });
  }
  if (!input.payload.productId) return input.payload;
  const product = (
    await publicProducts(env, '', '', '', 'AVAILABLE', input.payload.productId)
  )[0];
  if (!product)
    throw new HTTPException(409, {
      message: 'Choose an available, publicly shareable product.',
    });
  if (!product.imageUrl)
    throw new HTTPException(422, {
      message:
        'This product has no public image. Add an image or remove the product attachment for a text-only post.',
    });
  return { ...input.payload, productSnapshot: product };
}
async function validateStoredPayload(env: Bindings, draft: MetaDraft) {
  const raw = object(JSON.parse(draft.payload)),
    { productSnapshot, ...payload } = raw;
  const input = draftInput.parse({ kind: draft.kind, payload });
  const prepared = await preparePayload(env, input);
  if (
    draft.kind === 'POST' &&
    productSnapshot &&
    JSON.stringify(object(prepared).productSnapshot) !==
      JSON.stringify(productSnapshot)
  )
    throw new HTTPException(409, {
      message:
        'The product changed after this draft was prepared. Edit and review the draft again.',
    });
  return { input, raw };
}
export const metaDraftRoutes = new Hono<AppEnv>();
metaDraftRoutes.get('/drafts', async (c) => {
  const ctx = await metaContext(c),
    kind = z.enum(['CAMPAIGN', 'POST']).optional().parse(c.req.query('kind'));
  const result = await c.env.DB.prepare(
    "SELECT id,mode,kind,asset_id,payload,revision,status,provider_id,error_code,created_by,updated_at FROM meta_drafts WHERE mode=? AND (? IS NULL OR (?='POST' AND kind='POST') OR (?='CAMPAIGN' AND kind<>'POST')) AND asset_id IN (?,?) ORDER BY updated_at DESC LIMIT 100",
  )
    .bind(
      ctx.mode,
      kind ?? null,
      kind ?? null,
      kind ?? null,
      ctx.pageId,
      ctx.accountId,
    )
    .all();
  return c.json({ mode: ctx.mode, drafts: result.results });
});
metaDraftRoutes.post('/drafts', async (c) => {
  const input = draftInput.parse(await c.req.json());
  const ctx = await metaContext(
    c,
    input.kind === 'POST' ? 'publishContent' : 'writeAds',
    input.kind !== 'POST',
  );
  await metaAccess(c, true);
  const payload = await preparePayload(c.env, input),
    serialized = JSON.stringify(payload),
    id = uuid(),
    now = timestamp();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO meta_drafts(id,mode,kind,asset_id,payload,payload_hash,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    ).bind(
      id,
      ctx.mode,
      input.kind,
      input.kind === 'POST' ? ctx.pageId : ctx.accountId,
      serialized,
      await digest(serialized),
      ctx.email,
      now,
      now,
    ),
    operationAudit(c.env, ctx.mode, ctx.email, 'DRAFT_CREATED', id),
  ]);
  return c.json({ id, revision: 1, status: 'DRAFT', mode: ctx.mode }, 201);
});
metaDraftRoutes.patch('/drafts/:id', async (c) => {
  const input = z
    .object({ revision: z.number().int().positive(), draft: draftInput })
    .strict()
    .parse(await c.req.json());
  const ctx = await metaContext(
    c,
    input.draft.kind === 'POST' ? 'publishContent' : 'writeAds',
    input.draft.kind !== 'POST',
  );
  await metaAccess(c, true);
  const payload = JSON.stringify(await preparePayload(c.env, input.draft)),
    now = timestamp();
  const guard = uuid(),
    id = c.req.param('id');
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO meta_atomic_guards(id,valid) VALUES(?,EXISTS(SELECT 1 FROM meta_drafts WHERE id=? AND mode=? AND asset_id IN (?,?) AND kind=? AND revision=? AND status IN ('DRAFT','VALIDATION','REVIEW','CONFIRMATION','FAILED')))",
      ).bind(
        guard,
        id,
        ctx.mode,
        ctx.pageId,
        ctx.accountId,
        input.draft.kind,
        input.revision,
      ),
      c.env.DB.prepare(
        "UPDATE meta_drafts SET payload=?,payload_hash=?,revision=revision+1,status='DRAFT',reviewed_by=NULL,approved_by=NULL,approval_hash=NULL,approval_expires_at=NULL,error_code=NULL,updated_at=? WHERE id=?",
      ).bind(payload, await digest(payload), now, id),
      operationAudit(c.env, ctx.mode, ctx.email, 'DRAFT_EDITED', id),
      c.env.DB.prepare('DELETE FROM meta_atomic_guards WHERE id=?').bind(guard),
    ]);
  } catch {
    throw new HTTPException(409, {
      message:
        'This draft changed or cannot be edited. Refresh and review it again.',
    });
  }
  const updated = { id, revision: input.revision + 1, status: 'DRAFT' };
  return c.json(updated);
});
metaDraftRoutes.post('/drafts/:id/transition', async (c) => {
  const access = await metaAccess(c, true),
    input = draftTransition.parse(await c.req.json());
  const statusCtx = await metaContext(c);
  const draft = await c.env.DB.prepare(
    'SELECT * FROM meta_drafts WHERE id=? AND mode=? AND asset_id IN (?,?)',
  )
    .bind(
      c.req.param('id'),
      statusCtx.mode,
      statusCtx.pageId,
      statusCtx.accountId,
    )
    .first<MetaDraft>();
  if (!draft) throw new HTTPException(404, { message: 'Draft not found.' });
  const ctx = await metaContext(
    c,
    draft.kind === 'POST' ? 'publishContent' : 'writeAds',
    draft.kind !== 'POST',
  );
  if (input.revision !== draft.revision)
    throw new HTTPException(409, {
      message: 'The draft revision changed. Review the current version.',
    });
  if (input.action === 'PUBLISH' && draft.status === 'PUBLISHED')
    return c.json({
      id: draft.id,
      status: draft.status,
      providerId: draft.provider_id,
      replayed: true,
    });
  const { input: validated, raw } = await validateStoredPayload(c.env, draft);
  if (input.action !== 'PUBLISH') {
    const transitions = {
      VALIDATE: { from: ['DRAFT'], to: 'VALIDATION', audit: 'DRAFT_VALIDATED' },
      REVIEW: { from: ['VALIDATION'], to: 'REVIEW', audit: 'DRAFT_REVIEWED' },
      CONFIRM: {
        from: ['REVIEW', 'CONFIRMATION'],
        to: 'CONFIRMATION',
        audit: 'DRAFT_CONFIRMED',
      },
    } as const;
    const transition = transitions[input.action];
    if (!(transition.from as readonly string[]).includes(draft.status))
      throw new HTTPException(409, {
        message: 'Complete draft validation, review and confirmation in order.',
      });
    if (
      (input.action === 'REVIEW' || input.action === 'CONFIRM') &&
      !input.approvedByHuman
    )
      throw new HTTPException(422, {
        message: 'Explicit human review is required.',
      });
    if (
      input.action === 'CONFIRM' &&
      input.confirmation !== 'APPROVE ' + draft.id
    )
      throw new HTTPException(422, {
        message: 'Confirm the exact draft before approval.',
      });
    const token = input.action === 'CONFIRM' ? uuid() + uuid() : null;
    const guard = uuid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO meta_atomic_guards(id,valid) VALUES(?,EXISTS(SELECT 1 FROM meta_drafts WHERE id=? AND revision=? AND status=?))',
      ).bind(guard, draft.id, input.revision, draft.status),
      c.env.DB.prepare(
        'UPDATE meta_drafts SET status=?,reviewed_by=?,approved_by=?,approval_hash=?,approval_expires_at=?,updated_at=? WHERE id=?',
      ).bind(
        transition.to,
        input.action === 'REVIEW' ? access.email : (draft.reviewed_by ?? null),
        input.action === 'CONFIRM' ? access.email : null,
        token ? await digest(token) : null,
        token ? new Date(Date.now() + 600_000).toISOString() : null,
        timestamp(),
        draft.id,
      ),
      operationAudit(c.env, ctx.mode, access.email, transition.audit, draft.id),
      c.env.DB.prepare('DELETE FROM meta_atomic_guards WHERE id=?').bind(guard),
    ]);
    return c.json({
      id: draft.id,
      status: transition.to,
      revision: draft.revision,
      ...(token ? { approvalToken: token } : {}),
    });
  }
  if (
    draft.status !== 'CONFIRMATION' ||
    !input.approvedByHuman ||
    input.confirmation !== 'PUBLISH ' + draft.id ||
    !input.approvalToken ||
    !draft.approval_hash ||
    draft.approval_hash !== (await digest(input.approvalToken)) ||
    !draft.approval_expires_at ||
    Date.parse(draft.approval_expires_at) <= Date.now()
  )
    throw new HTTPException(409, {
      message:
        'Approval is missing, expired or already used. Confirm this draft again.',
    });
  if ((await digest(draft.payload)) !== draft.payload_hash)
    throw new HTTPException(409, {
      message: 'The draft changed after approval.',
    });
  await rateLimit(c.env, access.email, 'publish', 5);
  const guard = uuid();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO meta_atomic_guards(id,valid) VALUES(?,EXISTS(SELECT 1 FROM meta_drafts WHERE id=? AND status='CONFIRMATION' AND revision=? AND approval_hash=?))",
      ).bind(guard, draft.id, draft.revision, draft.approval_hash),
      c.env.DB.prepare(
        "UPDATE meta_drafts SET status='PUBLISHING',approval_hash=NULL,updated_at=? WHERE id=?",
      ).bind(timestamp(), draft.id),
      operationAudit(
        c.env,
        ctx.mode,
        access.email,
        'DRAFT_PUBLISH_STARTED',
        draft.id,
      ),
      c.env.DB.prepare('DELETE FROM meta_atomic_guards WHERE id=?').bind(guard),
    ]);
  } catch {
    throw new HTTPException(409, {
      message:
        'This publication has already started. Refresh the draft before doing anything else.',
    });
  }
  try {
    const payload = validated.payload;
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload))
      params[key] = Array.isArray(value)
        ? JSON.stringify(value)
        : String(value);
    if (validated.kind === 'POST' && raw.productSnapshot)
      params.imageUrl = string(object(raw.productSnapshot).imageUrl);
    const result = await ctx.provider.write(
      validated.kind === 'CAMPAIGN'
        ? 'campaign'
        : validated.kind === 'POST'
          ? 'post'
          : 'campaignUpdate',
      params,
    );
    const providerId =
      string(result.id) ||
      string(result.post_id) ||
      (validated.kind === 'CAMPAIGN_STATUS' ||
      validated.kind === 'CAMPAIGN_UPDATE'
        ? validated.payload.campaignId
        : '');
    if (!providerId) throw new MetaAPIError(0, true, true);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE meta_drafts SET status='PUBLISHED',provider_id=?,updated_at=? WHERE id=? AND status='PUBLISHING'",
      ).bind(providerId, timestamp(), draft.id),
      c.env.DB.prepare(
        'DELETE FROM meta_insights_cache WHERE mode=? AND asset_id=?',
      ).bind(ctx.mode, draft.asset_id),
      operationAudit(
        c.env,
        ctx.mode,
        access.email,
        'DRAFT_PUBLISHED',
        draft.id,
      ),
    ]);
    return c.json({
      id: draft.id,
      status: 'PUBLISHED',
      providerId,
      mode: ctx.mode,
      paused: validated.kind === 'CAMPAIGN',
    });
  } catch (error) {
    const ambiguous = !(error instanceof MetaAPIError) || error.ambiguous;
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE meta_drafts SET status=?,error_code=?,updated_at=? WHERE id=? AND status='PUBLISHING'",
      ).bind(
        ambiguous ? 'UNKNOWN' : 'FAILED',
        ambiguous ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_REJECTED',
        timestamp(),
        draft.id,
      ),
      operationAudit(
        c.env,
        ctx.mode,
        access.email,
        'DRAFT_FAILED',
        draft.id,
        ambiguous ? 'UNKNOWN' : 'FAILED',
      ),
    ]);
    throw new HTTPException(502, {
      message: ambiguous
        ? 'Publication outcome is unknown. Check Meta before creating another draft.'
        : 'Meta rejected publication. Review permissions and draft settings.',
    });
  }
});
