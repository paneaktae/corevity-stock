export type ImprovementArea =
  'CREATIVE' | 'AUDIENCE' | 'LANDING_PAGE' | 'BUDGET' | 'TRACKING';
export type CampaignRecommendation = {
  campaignId: string;
  suggestion: string;
  improvements?: {
    area: ImprovementArea;
    action: string;
    measure: string;
  }[];
};
/** What a campaign is optimised for, derived from its Meta objective. */
export type ResultType = 'LEAD' | 'MESSAGING' | 'LINK_CLICK' | 'REACH';
/** Metrics of one row group (campaign, ad set, ad or breakdown value). */
export type PerformanceMetrics = {
  spend: number | null;
  impressions: number | null;
  /** Unique people; only available when the group is a single Meta row. */
  reach: number | null;
  frequency: number | null;
  /** All clicks (likes, photo opens, link clicks…). */
  clicks: number | null;
  linkClicks: number | null;
  leads: number | null;
  messagingConversations: number | null;
  ctr: number | null;
  linkCtr: number | null;
  cpc: number | null;
  costPerLinkClick: number | null;
  cpm: number | null;
  costPerLead: number | null;
  costPerMessagingConversation: number | null;
  resultType: ResultType;
  results: number | null;
  costPerResult: number | null;
  /** Results divided by link clicks, in percent. */
  resultRate: number | null;
};
export type PeriodMetrics = Pick<
  PerformanceMetrics,
  | 'spend'
  | 'impressions'
  | 'frequency'
  | 'linkClicks'
  | 'results'
  | 'linkCtr'
  | 'cpm'
  | 'costPerResult'
  | 'resultRate'
>;
export type AlertCode =
  | 'LOW_DATA'
  | 'SPEND_NO_RESULTS'
  | 'CLICKS_NO_RESULTS'
  | 'CREATIVE_FATIGUE'
  | 'HIGH_FREQUENCY'
  | 'CTR_DROP'
  | 'CPM_RISE'
  | 'COST_PER_RESULT_RISE'
  | 'LOW_LINK_CTR'
  | 'LOW_RESULT_RATE'
  | 'ABOVE_TARGET'
  | 'TOP_PERFORMER';
export type AdsAlert = {
  code: AlertCode;
  severity: 'CRITICAL' | 'WARNING' | 'INFO' | 'POSITIVE';
  area: ImprovementArea;
  /** The evidence the rule used; shown to people and to the AI. */
  values: Record<string, number | null>;
};
export type CampaignPerformance = PerformanceMetrics & {
  campaignId: string;
  name: string;
  objective: string | null;
  leadConversionRate: number | null;
  assessment:
    | 'NO_TARGET'
    | 'INSUFFICIENT_DATA'
    | 'ON_TARGET'
    | 'ABOVE_TARGET'
    | 'NOT_APPLICABLE';
  previous?: PeriodMetrics | null;
  /** Percent change against the previous period of the same length. */
  changes?: Partial<Record<keyof PeriodMetrics, number | null>>;
  alerts?: AdsAlert[];
};
export type BreakdownRow = PerformanceMetrics & {
  key: string;
  label: string;
  campaignId: string | null;
};
export type TotalMetrics = Pick<
  PerformanceMetrics,
  | 'spend'
  | 'impressions'
  | 'clicks'
  | 'linkClicks'
  | 'leads'
  | 'messagingConversations'
  | 'ctr'
  | 'linkCtr'
  | 'cpm'
  | 'costPerLinkClick'
  | 'costPerLead'
  | 'costPerMessagingConversation'
>;
export type DailyPoint = {
  date: string;
  spend: number | null;
  impressions: number | null;
  linkClicks: number | null;
  leads: number | null;
  messagingConversations: number | null;
  linkCtr: number | null;
  cpm: number | null;
};
export type AdsAnalysis = {
  mode: 'DEMO' | 'LIVE';
  fetchedAt: string;
  currency: string | null;
  timezone: string | null;
  notice: string;
  after: string | null;
  range: { since: string; until: string };
  previousRange: { since: string; until: string };
  campaigns: CampaignPerformance[];
  totals: { current: TotalMetrics; previous: TotalMetrics | null };
  daily: DailyPoint[] | null;
  targetCostPerResult: number | null;
  warnings: string[];
};
export const breakdownDimensions = [
  'adset',
  'ad',
  'age',
  'gender',
  'publisher_platform',
  'platform_position',
  'region',
] as const;
export type BreakdownDimension = (typeof breakdownDimensions)[number];
export type AdsBreakdown = {
  mode: 'DEMO' | 'LIVE';
  dimension: BreakdownDimension;
  campaignId: string;
  rows: BreakdownRow[];
  hasMore: boolean;
  currency: string | null;
  fetchedAt: string;
};
