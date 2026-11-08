import type {
  AdsAlert,
  DailyPoint,
  PerformanceMetrics,
  PeriodMetrics,
  ResultType,
  TotalMetrics,
} from './campaign-analysis';

/** Meta action types counted as results. Missing actions are unknown, not zero. */
export const LEAD_ACTION = 'lead';
export const MESSAGING_ACTION =
  'onsite_conversion.messaging_conversation_started_7d';

/** Rule thresholds. Shared with the AI so its prose can cite them. */
export const ADS_THRESHOLDS = {
  minImpressions: 1000,
  minPreviousResults: 3,
  highFrequency: 3,
  fatigueFrequency: 2.5,
  fatigueCtrDropPercent: 20,
  ctrDropPercent: 25,
  cpmRisePercent: 30,
  costPerResultRisePercent: 30,
  lowLinkCtrRatio: 0.6,
  lowResultRateRatio: 0.5,
  minLinkClicksForRate: 30,
  clicksWithoutResults: 50,
  spendWithoutResultsMultiple: 2,
  topPerformerRatio: 0.75,
  topPerformerMinResults: 5,
  scaleBudgetPercent: 20,
} as const;

type Row = Record<string, unknown>;

export const metricNumber = (value: unknown): number | null => {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '')
    return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const asObject = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};
export const divide = (
  a: number | null,
  b: number | null,
  multiplier = 1,
): number | null =>
  a !== null && b !== null && b > 0 ? (a / b) * multiplier : null;

/** Value of one action type in a Meta row, or null when Meta did not report it. */
export function actionValue(row: Row, type: string): number | null {
  if (!Array.isArray(row.actions)) return null;
  const action = row.actions.map(asObject).find((v) => v.action_type === type);
  return action ? metricNumber(action.value) : null;
}
/** Sum only when every row reports the value; otherwise unknown. */
function strictTotal<T>(rows: T[], read: (row: T) => number | null) {
  const values = rows.map(read);
  return values.length && values.every((v) => v !== null)
    ? values.reduce<number>((sum, v) => sum + v!, 0)
    : null;
}
/** Sum of reported values; null only when no row reports it. */
function reportedTotal<T>(rows: T[], read: (row: T) => number | null) {
  const values = rows.map(read).filter((v): v is number => v !== null);
  return values.length ? values.reduce((sum, v) => sum + v, 0) : null;
}
export function resultTypeFor(
  objective: string | null,
  leads: number | null,
  messaging: number | null,
): ResultType {
  const objectiveName = (objective ?? '').toUpperCase();
  if (['OUTCOME_TRAFFIC', 'LINK_CLICKS'].includes(objectiveName))
    return 'LINK_CLICK';
  if (
    ['OUTCOME_AWARENESS', 'REACH', 'BRAND_AWARENESS', 'VIDEO_VIEWS'].includes(
      objectiveName,
    )
  )
    return 'REACH';
  const hasLeads = (leads ?? 0) > 0,
    hasMessaging = (messaging ?? 0) > 0;
  if (['OUTCOME_LEADS', 'LEAD_GENERATION'].includes(objectiveName))
    return hasLeads || !hasMessaging ? 'LEAD' : 'MESSAGING';
  if (
    ['OUTCOME_ENGAGEMENT', 'MESSAGES', 'OUTCOME_SALES', 'CONVERSIONS'].includes(
      objectiveName,
    )
  )
    return hasMessaging || !hasLeads ? 'MESSAGING' : 'LEAD';
  return hasMessaging && !hasLeads ? 'MESSAGING' : 'LEAD';
}
/** Metrics for a group of Meta insight rows that belong together. */
export function performanceMetrics(
  rows: Row[],
  objective: string | null = null,
): PerformanceMetrics {
  const total = (key: string) =>
    strictTotal(rows, (row) => metricNumber(row[key]));
  const spend = total('spend'),
    impressions = total('impressions'),
    clicks = total('clicks'),
    linkClicks = total('inline_link_clicks'),
    leads = strictTotal(rows, (row) => actionValue(row, LEAD_ACTION)),
    messagingConversations = strictTotal(rows, (row) =>
      actionValue(row, MESSAGING_ACTION),
    );
  // Reach is unique people and cannot be added across rows.
  const reach = rows.length === 1 ? metricNumber(rows[0].reach) : null;
  const frequency =
    divide(impressions, reach) ??
    (rows.length === 1 ? metricNumber(rows[0].frequency) : null);
  const resultType = resultTypeFor(objective, leads, messagingConversations);
  const results =
    resultType === 'LEAD'
      ? leads
      : resultType === 'MESSAGING'
        ? messagingConversations
        : resultType === 'LINK_CLICK'
          ? linkClicks
          : reach;
  return {
    spend,
    impressions,
    reach,
    frequency,
    clicks,
    linkClicks,
    leads,
    messagingConversations,
    ctr: divide(clicks, impressions, 100),
    linkCtr: divide(linkClicks, impressions, 100),
    cpc: divide(spend, clicks),
    costPerLinkClick: divide(spend, linkClicks),
    cpm: divide(spend, impressions, 1000),
    costPerLead: divide(spend, leads),
    costPerMessagingConversation: divide(spend, messagingConversations),
    resultType,
    results,
    costPerResult:
      resultType === 'REACH'
        ? divide(spend, reach, 1000)
        : divide(spend, results),
    resultRate:
      resultType === 'LEAD' || resultType === 'MESSAGING'
        ? divide(results, linkClicks, 100)
        : null,
  };
}
/** Account totals. Lead and chat counts include only what Meta reported. */
export function totalMetrics(rows: Row[]): TotalMetrics {
  const total = (key: string) =>
    strictTotal(rows, (row) => metricNumber(row[key]));
  const spend = total('spend'),
    impressions = total('impressions'),
    clicks = total('clicks'),
    linkClicks = total('inline_link_clicks'),
    leads = reportedTotal(rows, (row) => actionValue(row, LEAD_ACTION)),
    messagingConversations = reportedTotal(rows, (row) =>
      actionValue(row, MESSAGING_ACTION),
    );
  // A cost per lead or chat only uses spend of rows optimised for that result,
  // so traffic or lead-form spend does not inflate the cost per chat.
  const costFor = (type: 'LEAD' | 'MESSAGING', action: string) => {
    const matching = rows.filter(
      (row) =>
        resultTypeFor(
          typeof row.objective === 'string' ? row.objective : null,
          actionValue(row, LEAD_ACTION),
          actionValue(row, MESSAGING_ACTION),
        ) === type && actionValue(row, action) !== null,
    );
    return divide(
      strictTotal(matching, (row) => metricNumber(row.spend)),
      reportedTotal(matching, (row) => actionValue(row, action)),
    );
  };
  return {
    spend,
    impressions,
    clicks,
    linkClicks,
    leads,
    messagingConversations,
    ctr: divide(clicks, impressions, 100),
    linkCtr: divide(linkClicks, impressions, 100),
    cpm: divide(spend, impressions, 1000),
    costPerLinkClick: divide(spend, linkClicks),
    costPerLead: costFor('LEAD', LEAD_ACTION),
    costPerMessagingConversation: costFor('MESSAGING', MESSAGING_ACTION),
  };
}
export function dailyPoints(rows: Row[]): DailyPoint[] {
  const byDate = new Map<string, Row[]>();
  for (const row of rows) {
    const date = typeof row.date_start === 'string' ? row.date_start : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(date))
      byDate.set(date, [...(byDate.get(date) ?? []), row]);
  }
  return [...byDate]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => {
      const t = totalMetrics(entries);
      return {
        date,
        spend: t.spend,
        impressions: t.impressions,
        linkClicks: t.linkClicks,
        leads: t.leads,
        messagingConversations: t.messagingConversations,
        linkCtr: t.linkCtr,
        cpm: t.cpm,
      };
    });
}
export function periodMetrics(metrics: PerformanceMetrics): PeriodMetrics {
  return {
    spend: metrics.spend,
    impressions: metrics.impressions,
    frequency: metrics.frequency,
    linkClicks: metrics.linkClicks,
    results: metrics.results,
    linkCtr: metrics.linkCtr,
    cpm: metrics.cpm,
    costPerResult: metrics.costPerResult,
    resultRate: metrics.resultRate,
  };
}
export const percentChange = (
  current: number | null | undefined,
  previous: number | null | undefined,
) =>
  current === null ||
  current === undefined ||
  previous === null ||
  previous === undefined ||
  previous === 0
    ? null
    : ((current - previous) / previous) * 100;
const round = (value: number | null) =>
  value === null ? null : Math.round(value * 100) / 100;
export function periodChanges(current: PeriodMetrics, previous: PeriodMetrics) {
  return Object.fromEntries(
    (Object.keys(current) as (keyof PeriodMetrics)[]).map((key) => [
      key,
      round(percentChange(current[key], previous[key])),
    ]),
  ) as Partial<Record<keyof PeriodMetrics, number | null>>;
}
/** Peer averages per result type, used to spot outliers within one report. */
export function peerBenchmarks(campaigns: PerformanceMetrics[]) {
  const delivered = campaigns.filter(
    (c) => (c.impressions ?? 0) >= ADS_THRESHOLDS.minImpressions,
  );
  const linkCtrPeers = delivered.filter((c) => c.linkCtr !== null);
  const byType = (type: ResultType) => {
    const peers = delivered.filter(
      (c) => c.resultType === type && c.results !== null && c.spend !== null,
    );
    return {
      count: peers.length,
      costPerResult: divide(
        reportedTotal(peers, (c) => c.spend),
        reportedTotal(peers, (c) => c.results),
      ),
      resultRate: divide(
        reportedTotal(peers, (c) => c.results),
        reportedTotal(peers, (c) => c.linkClicks),
        100,
      ),
    };
  };
  const impressions = reportedTotal(linkCtrPeers, (c) => c.impressions);
  const linkClicks = reportedTotal(linkCtrPeers, (c) => c.linkClicks);
  return {
    linkCtrCount: linkCtrPeers.length,
    linkCtr: divide(linkClicks, impressions, 100),
    LEAD: byType('LEAD'),
    MESSAGING: byType('MESSAGING'),
  };
}
/**
 * Deterministic rules on reported numbers. They point at what to check or test;
 * they cannot prove why a metric moved.
 */
export function adsAlerts(
  campaign: PerformanceMetrics & {
    previous?: PeriodMetrics | null;
    changes?: Partial<Record<keyof PeriodMetrics, number | null>>;
  },
  benchmarks: ReturnType<typeof peerBenchmarks>,
  targetCostPerResult?: number,
): AdsAlert[] {
  const t = ADS_THRESHOLDS;
  const alerts: AdsAlert[] = [];
  const converting =
    campaign.resultType === 'LEAD' || campaign.resultType === 'MESSAGING';
  if ((campaign.impressions ?? 0) < t.minImpressions) {
    alerts.push({
      code: 'LOW_DATA',
      severity: 'INFO',
      area: 'BUDGET',
      values: {
        impressions: campaign.impressions,
        minImpressions: t.minImpressions,
      },
    });
    return alerts;
  }
  const peer = converting
    ? benchmarks[campaign.resultType as 'LEAD' | 'MESSAGING']
    : null;
  const noResults = campaign.results === null || campaign.results === 0;
  const spendBenchmark = Math.max(
    peer?.costPerResult !== null &&
      peer?.costPerResult !== undefined &&
      peer.count > 1
      ? peer.costPerResult * t.spendWithoutResultsMultiple
      : 0,
    targetCostPerResult ?? 0,
  );
  if (
    converting &&
    noResults &&
    spendBenchmark > 0 &&
    (campaign.spend ?? 0) >= spendBenchmark
  )
    alerts.push({
      code: 'SPEND_NO_RESULTS',
      severity: 'CRITICAL',
      area: 'TRACKING',
      values: {
        spend: campaign.spend,
        results: campaign.results,
        benchmarkCostPerResult: peer?.costPerResult ?? null,
        targetCostPerResult: targetCostPerResult ?? null,
      },
    });
  else if (
    converting &&
    noResults &&
    (campaign.linkClicks ?? 0) >= t.clicksWithoutResults
  )
    alerts.push({
      code: 'CLICKS_NO_RESULTS',
      severity: 'WARNING',
      area: 'LANDING_PAGE',
      values: { linkClicks: campaign.linkClicks, results: campaign.results },
    });
  const changes = campaign.changes ?? {};
  const previous = campaign.previous ?? null;
  const comparable =
    previous !== null && (previous.impressions ?? 0) >= t.minImpressions;
  const ctrChange = comparable ? (changes.linkCtr ?? null) : null;
  if (
    (campaign.frequency ?? 0) >= t.fatigueFrequency &&
    ctrChange !== null &&
    ctrChange <= -t.fatigueCtrDropPercent
  )
    alerts.push({
      code: 'CREATIVE_FATIGUE',
      severity: 'WARNING',
      area: 'CREATIVE',
      values: {
        frequency: campaign.frequency,
        linkCtr: campaign.linkCtr,
        previousLinkCtr: previous!.linkCtr,
        linkCtrChangePercent: ctrChange,
      },
    });
  else {
    if ((campaign.frequency ?? 0) >= t.highFrequency)
      alerts.push({
        code: 'HIGH_FREQUENCY',
        severity: 'WARNING',
        area: 'AUDIENCE',
        values: { frequency: campaign.frequency, threshold: t.highFrequency },
      });
    if (ctrChange !== null && ctrChange <= -t.ctrDropPercent)
      alerts.push({
        code: 'CTR_DROP',
        severity: 'WARNING',
        area: 'CREATIVE',
        values: {
          linkCtr: campaign.linkCtr,
          previousLinkCtr: previous!.linkCtr,
          linkCtrChangePercent: ctrChange,
        },
      });
  }
  const cpmChange = comparable ? (changes.cpm ?? null) : null;
  if (cpmChange !== null && cpmChange >= t.cpmRisePercent)
    alerts.push({
      code: 'CPM_RISE',
      severity: 'INFO',
      area: 'AUDIENCE',
      values: {
        cpm: campaign.cpm,
        previousCpm: previous!.cpm,
        cpmChangePercent: cpmChange,
      },
    });
  const costChange =
    comparable && converting && (previous!.results ?? 0) >= t.minPreviousResults
      ? (changes.costPerResult ?? null)
      : null;
  if (costChange !== null && costChange >= t.costPerResultRisePercent)
    alerts.push({
      code: 'COST_PER_RESULT_RISE',
      severity: 'WARNING',
      area: 'LANDING_PAGE',
      values: {
        costPerResult: campaign.costPerResult,
        previousCostPerResult: previous!.costPerResult,
        costPerResultChangePercent: costChange,
      },
    });
  if (
    benchmarks.linkCtrCount > 1 &&
    benchmarks.linkCtr !== null &&
    campaign.linkCtr !== null &&
    campaign.linkCtr < benchmarks.linkCtr * t.lowLinkCtrRatio
  )
    alerts.push({
      code: 'LOW_LINK_CTR',
      severity: 'WARNING',
      area: 'CREATIVE',
      values: { linkCtr: campaign.linkCtr, averageLinkCtr: benchmarks.linkCtr },
    });
  if (
    peer &&
    peer.count > 1 &&
    peer.resultRate !== null &&
    campaign.resultRate !== null &&
    (campaign.linkClicks ?? 0) >= t.minLinkClicksForRate &&
    campaign.resultRate < peer.resultRate * t.lowResultRateRatio
  )
    alerts.push({
      code: 'LOW_RESULT_RATE',
      severity: 'WARNING',
      area: 'LANDING_PAGE',
      values: {
        resultRate: campaign.resultRate,
        averageResultRate: peer.resultRate,
      },
    });
  if (
    converting &&
    targetCostPerResult !== undefined &&
    campaign.costPerResult !== null &&
    campaign.costPerResult > targetCostPerResult
  )
    alerts.push({
      code: 'ABOVE_TARGET',
      severity: 'WARNING',
      area: 'BUDGET',
      values: {
        costPerResult: campaign.costPerResult,
        targetCostPerResult,
      },
    });
  if (
    peer &&
    peer.count > 1 &&
    peer.costPerResult !== null &&
    campaign.costPerResult !== null &&
    (campaign.results ?? 0) >= t.topPerformerMinResults &&
    campaign.costPerResult <= peer.costPerResult * t.topPerformerRatio &&
    (targetCostPerResult === undefined ||
      campaign.costPerResult <= targetCostPerResult) &&
    (campaign.frequency ?? 0) < t.fatigueFrequency
  )
    alerts.push({
      code: 'TOP_PERFORMER',
      severity: 'POSITIVE',
      area: 'BUDGET',
      values: {
        costPerResult: campaign.costPerResult,
        averageCostPerResult: peer.costPerResult,
        scaleBudgetPercent: t.scaleBudgetPercent,
      },
    });
  const order = { CRITICAL: 0, WARNING: 1, INFO: 2, POSITIVE: 3 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
/** Range of the same length immediately before `since`. */
export function previousRange(since: string, until: string) {
  const day = 86_400_000;
  const length = Math.round((Date.parse(until) - Date.parse(since)) / day) + 1;
  const end = Date.parse(since) - day;
  return {
    since: new Date(end - (length - 1) * day).toISOString().slice(0, 10),
    until: new Date(end).toISOString().slice(0, 10),
  };
}
