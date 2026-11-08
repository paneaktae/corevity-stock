import { Hono } from 'hono';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Bindings } from '../../auth';
import { digest } from '../../auth';
import type { MetaReport } from '../../../shared/meta-domain';
import { metaContext, type MetaContext } from './context';
import type { MetaResource } from './provider';
import { object, string } from './graph';
import { timestamp, rateLimit } from './store';
import type { CampaignPerformance } from '../../../shared/campaign-analysis';
export const metricNumber = (value: unknown): number | null => {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '')
    return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
export function adsMetrics(rows: Record<string, unknown>[]) {
  const total = (key: string) =>
    rows.length && rows.every((v) => metricNumber(v[key]) !== null)
      ? rows.reduce((sum, row) => sum + metricNumber(row[key])!, 0)
      : null;
  const leadCounts = rows.map((row) => {
    if (!Array.isArray(row.actions)) return null;
    const lead = row.actions.map(object).find((v) => v.action_type === 'lead');
    return lead ? metricNumber(lead.value) : null;
  });
  const leads =
    leadCounts.length && leadCounts.every((v) => v !== null)
      ? leadCounts.reduce<number>((sum, v) => sum + v!, 0)
      : null;
  const spend = total('spend'),
    impressions = total('impressions'),
    clicks = total('clicks');
  const divide = (a: number | null, b: number | null, multiplier = 1) =>
    a !== null && b !== null && b > 0 ? (a / b) * multiplier : null;
  return {
    spend,
    impressions,
    clicks,
    leads,
    ctr: divide(clicks, impressions, 100),
    cpc: divide(spend, clicks),
    cpm: divide(spend, impressions, 1000),
    costPerLead: divide(spend, leads),
  };
}
export function campaignPerformance(
  rows: Record<string, unknown>[],
  targetCostPerLead?: number,
): CampaignPerformance[] {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const id = string(row.campaign_id);
    if (id) grouped.set(id, [...(grouped.get(id) ?? []), row]);
  }
  return [...grouped].map(([campaignId, entries]) => {
    const metrics = adsMetrics(entries);
    const { clicks, leads, costPerLead } = metrics;
    return {
      campaignId,
      name: string(entries[0].campaign_name) || campaignId,
      ...metrics,
      leadConversionRate:
        clicks !== null && clicks > 0 && leads !== null
          ? (leads / clicks) * 100
          : null,
      assessment:
        metrics.spend === null ||
        metrics.impressions === null ||
        metrics.impressions === 0 ||
        clicks === null
          ? 'INSUFFICIENT_DATA'
          : targetCostPerLead === undefined
            ? 'NO_TARGET'
            : costPerLead === null
              ? 'INSUFFICIENT_DATA'
              : costPerLead > targetCostPerLead
                ? 'ABOVE_TARGET'
                : 'ON_TARGET',
    };
  });
}
export function reportRange(
  query: Record<string, string>,
  timezone = 'Asia/Bangkok',
) {
  let today: string;
  try {
    today = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    today = new Date().toISOString().slice(0, 10);
  }
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) =>
        Number.isFinite(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v,
    );
  const until = date.parse(query.until ?? today),
    since = date.parse(
      query.since ??
        new Date(Date.parse(until) - 6 * 86_400_000).toISOString().slice(0, 10),
    );
  if (
    since > until ||
    Date.parse(until) - Date.parse(since) > 92 * 86_400_000 ||
    until > today
  )
    throw new HTTPException(422, {
      message: 'Choose a past or current date range of up to 93 days.',
    });
  return {
    since,
    until,
    ...(query.after ? { after: z.string().max(2048).parse(query.after) } : {}),
  };
}
function safeRows(resource: MetaResource, rows: Record<string, unknown>[]) {
  const fields: Record<MetaResource, string[]> = {
    campaigns: [
      'id',
      'name',
      'status',
      'objective',
      'daily_budget',
      'lifetime_budget',
    ],
    adsets: [
      'id',
      'name',
      'campaign_id',
      'status',
      'daily_budget',
      'lifetime_budget',
      'targeting',
      'optimization_goal',
    ],
    ads: ['id', 'name', 'campaign_id', 'adset_id', 'status', 'creative'],
    insights: [
      'campaign_id',
      'campaign_name',
      'spend',
      'impressions',
      'clicks',
      'actions',
      'account_currency',
    ],
    forms: ['id', 'name', 'status', 'questions'],
    formLeads: ['id', 'form_id', 'created_time', 'field_data'],
    postInsights: ['name', 'period', 'values', 'title', 'description'],
    posts: ['id', 'message', 'created_time', 'permalink_url'],
    pageInsights: ['name', 'period', 'values', 'title', 'description'],
  };
  return rows.map((row) =>
    Object.fromEntries(
      fields[resource]
        .filter((key) => Object.hasOwn(row, key))
        .map((key) => [key, row[key]]),
    ),
  );
}
export async function readMetaReport(
  env: Bindings,
  ctx: MetaContext,
  resource: MetaResource,
  params: Record<string, string> = {},
): Promise<MetaReport> {
  const key = await digest(
    JSON.stringify({
      mode: ctx.mode,
      page: ctx.pageId,
      account: ctx.accountId,
      resource,
      params,
      version: env.META_GRAPH_API_VERSION ?? 'DEMO',
      metrics: [
        env.META_PAGE_INSIGHT_METRICS ?? '',
        env.META_POST_INSIGHT_METRICS ?? '',
      ],
    }),
  );
  const cached = await env.DB.prepare(
    'SELECT data FROM meta_insights_cache WHERE cache_key=? AND expires_at>?',
  )
    .bind(key, timestamp())
    .first<{ data: string }>();
  if (cached) return JSON.parse(cached.data) as MetaReport;
  const result = await ctx.provider.list(resource, params),
    data = safeRows(resource, result.data);
  const currencies = new Set(
    data.map((v) => string(v.account_currency)).filter(Boolean),
  );
  const report: MetaReport = {
    mode: ctx.mode,
    data,
    after: result.after,
    fetchedAt: timestamp(),
    currency:
      ctx.mode === 'DEMO'
        ? 'THB'
        : currencies.size === 1
          ? [...currencies][0]
          : (ctx.status.adAccount?.currency ?? null),
    timezone:
      ctx.mode === 'DEMO'
        ? 'Asia/Bangkok'
        : (ctx.status.adAccount?.timezone ?? null),
    ...(resource === 'insights' ? { metrics: adsMetrics(data) } : {}),
    notice:
      ctx.mode === 'LIVE' &&
      (resource === 'pageInsights' || resource === 'postInsights') &&
      !data.length
        ? 'No supported metrics are configured or available for this asset. Verify metric names for the selected API version.'
        : ctx.mode === 'DEMO'
          ? 'DEMO MODE: simulated data, not Meta reporting.'
          : 'Meta reporting can be delayed. Attribution and account timezone affect results. Missing metrics are unavailable, not zero.',
  };
  if (resource === 'insights' && currencies.size > 1)
    report.metrics = adsMetrics([]);
  await env.DB.prepare(
    'INSERT INTO meta_insights_cache(cache_key,mode,asset_id,data,fetched_at,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at',
  )
    .bind(
      key,
      ctx.mode,
      ctx.accountId || ctx.pageId,
      JSON.stringify(report),
      report.fetchedAt,
      new Date(Date.now() + 300_000).toISOString(),
    )
    .run();
  return report;
}
export const metaReportRoutes = new Hono<AppEnv>();
for (const [path, resource] of [
  ['/ads/campaigns', 'campaigns'],
  ['/ads/adsets', 'adsets'],
  ['/ads/ads', 'ads'],
  ['/ads/insights', 'insights'],
] as const) {
  metaReportRoutes.get(path, async (c) => {
    const ctx = await metaContext(c, 'readAds', true);
    await rateLimit(c.env, ctx.email, 'reports', 60);
    const params = reportRange(
      c.req.query(),
      ctx.status.adAccount?.timezone ?? 'Asia/Bangkok',
    );
    return c.json(await readMetaReport(c.env, ctx, resource, params));
  });
}
metaReportRoutes.get('/page/insights', async (c) => {
  const ctx = await metaContext(c, 'readPageInsights');
  return c.json(
    await readMetaReport(
      c.env,
      ctx,
      'pageInsights',
      reportRange(c.req.query()),
    ),
  );
});
metaReportRoutes.get('/page/posts', async (c) => {
  const ctx = await metaContext(c, 'readContent');
  return c.json(
    await readMetaReport(c.env, ctx, 'posts', reportRange(c.req.query())),
  );
});

metaReportRoutes.get('/page/posts/:id/insights', async (c) => {
  const ctx = await metaContext(c, 'readPageInsights');
  const postId = z
    .string()
    .max(200)
    .regex(/^\d+_\d+$|^demo:post$/)
    .parse(c.req.param('id'));
  if (ctx.mode === 'LIVE' && !postId.startsWith(ctx.pageId + '_'))
    throw new HTTPException(403, {
      message: 'This post does not belong to the selected Page.',
    });
  return c.json(await readMetaReport(c.env, ctx, 'postInsights', { postId }));
});
