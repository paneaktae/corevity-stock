import { LEAD_ACTION, MESSAGING_ACTION } from '../../../shared/ads-analytics';

// Simulated, deterministic ad insights for DEMO mode. Never Meta data.
type DemoCampaign = {
  id: string;
  name: string;
  objective: string;
  spend: number;
  impressions: number;
  linkCtr: number;
  resultPerClick: number;
  result: 'LEAD' | 'MESSAGING' | null;
  frequencyBase: number;
  frequencyPerDay: number;
  /** Recent days lose CTR, so the demo shows creative fatigue. */
  fatigue: boolean;
};
const campaigns: DemoCampaign[] = [
  {
    id: 'demo:campaign-1',
    name: 'Demo · Cardio equipment (Messenger)',
    objective: 'OUTCOME_ENGAGEMENT',
    spend: 690,
    impressions: 1780,
    linkCtr: 1.7,
    resultPerClick: 1 / 7,
    result: 'MESSAGING',
    frequencyBase: 1.3,
    frequencyPerDay: 0.3,
    fatigue: true,
  },
  {
    id: 'demo:campaign-2',
    name: 'Demo · Strength equipment (Lead form)',
    objective: 'OUTCOME_LEADS',
    spend: 450,
    impressions: 1270,
    linkCtr: 1.25,
    resultPerClick: 1 / 6,
    result: 'LEAD',
    frequencyBase: 1.1,
    frequencyPerDay: 0.08,
    fatigue: false,
  },
  {
    id: 'demo:campaign-3',
    name: 'Demo · Clearance sale (Website)',
    objective: 'OUTCOME_TRAFFIC',
    spend: 300,
    impressions: 2600,
    linkCtr: 0.55,
    resultPerClick: 0,
    result: null,
    frequencyBase: 1.05,
    frequencyPerDay: 0.04,
    fatigue: false,
  },
];
type Segment = {
  key: string;
  label: string;
  share: number;
  ctr: number;
  result: number;
};
const segments: Record<string, Segment[]> = {
  adset: [
    {
      key: 'broad',
      label: 'Broad · Thailand 25-55',
      share: 0.55,
      ctr: 0.9,
      result: 0.8,
    },
    {
      key: 'interest',
      label: 'Interest · Fitness & gym',
      share: 0.45,
      ctr: 1.15,
      result: 1.3,
    },
  ],
  ad: [
    {
      key: 'photo',
      label: 'Photo · real product',
      share: 0.5,
      ctr: 1.1,
      result: 1.15,
    },
    {
      key: 'video',
      label: 'Video · equipment in use',
      share: 0.3,
      ctr: 1.25,
      result: 0.9,
    },
    {
      key: 'carousel',
      label: 'Carousel · price list',
      share: 0.2,
      ctr: 0.65,
      result: 0.7,
    },
  ],
  age: [
    { key: '18-24', label: '18-24', share: 0.1, ctr: 1.2, result: 0.4 },
    { key: '25-34', label: '25-34', share: 0.33, ctr: 1.1, result: 1 },
    { key: '35-44', label: '35-44', share: 0.3, ctr: 1, result: 1.35 },
    { key: '45-54', label: '45-54', share: 0.18, ctr: 0.85, result: 1.2 },
    { key: '55-64', label: '55-64', share: 0.07, ctr: 0.7, result: 0.8 },
    { key: '65+', label: '65+', share: 0.02, ctr: 0.6, result: 0.5 },
  ],
  gender: [
    { key: 'male', label: 'male', share: 0.63, ctr: 1.05, result: 1.1 },
    { key: 'female', label: 'female', share: 0.34, ctr: 0.9, result: 0.85 },
    { key: 'unknown', label: 'unknown', share: 0.03, ctr: 0.8, result: 0.6 },
  ],
  publisher_platform: [
    { key: 'facebook', label: 'facebook', share: 0.6, ctr: 1, result: 1.15 },
    {
      key: 'instagram',
      label: 'instagram',
      share: 0.33,
      ctr: 1.1,
      result: 0.75,
    },
    {
      key: 'audience_network',
      label: 'audience_network',
      share: 0.05,
      ctr: 0.6,
      result: 0.2,
    },
    {
      key: 'messenger',
      label: 'messenger',
      share: 0.02,
      ctr: 0.9,
      result: 1.2,
    },
  ],
  platform_position: [
    { key: 'facebook|feed', label: 'feed', share: 0.42, ctr: 1.1, result: 1.2 },
    {
      key: 'facebook|marketplace',
      label: 'marketplace',
      share: 0.12,
      ctr: 1.2,
      result: 1.3,
    },
    {
      key: 'facebook|facebook_reels',
      label: 'facebook_reels',
      share: 0.08,
      ctr: 0.8,
      result: 0.6,
    },
    { key: 'instagram|feed', label: 'feed', share: 0.15, ctr: 1, result: 0.8 },
    {
      key: 'instagram|instagram_stories',
      label: 'instagram_stories',
      share: 0.1,
      ctr: 0.9,
      result: 0.6,
    },
    {
      key: 'instagram|instagram_reels',
      label: 'instagram_reels',
      share: 0.08,
      ctr: 1.1,
      result: 0.7,
    },
    {
      key: 'audience_network|an_classic',
      label: 'an_classic',
      share: 0.05,
      ctr: 0.6,
      result: 0.2,
    },
  ],
  region: [
    { key: 'Bangkok', label: 'Bangkok', share: 0.44, ctr: 1.05, result: 1.1 },
    {
      key: 'Nonthaburi Province',
      label: 'Nonthaburi Province',
      share: 0.12,
      ctr: 1,
      result: 1.15,
    },
    {
      key: 'Samut Prakan Province',
      label: 'Samut Prakan Province',
      share: 0.1,
      ctr: 1,
      result: 1,
    },
    {
      key: 'Chon Buri Province',
      label: 'Chon Buri Province',
      share: 0.09,
      ctr: 0.95,
      result: 0.9,
    },
    {
      key: 'Chiang Mai Province',
      label: 'Chiang Mai Province',
      share: 0.07,
      ctr: 0.9,
      result: 0.7,
    },
    {
      key: 'Nakhon Ratchasima Province',
      label: 'Nakhon Ratchasima Province',
      share: 0.06,
      ctr: 0.9,
      result: 0.8,
    },
    {
      key: 'Khon Kaen Province',
      label: 'Khon Kaen Province',
      share: 0.05,
      ctr: 0.85,
      result: 0.7,
    },
    {
      key: 'Phuket Province',
      label: 'Phuket Province',
      share: 0.04,
      ctr: 0.9,
      result: 0.6,
    },
    {
      key: 'Songkhla Province',
      label: 'Songkhla Province',
      share: 0.03,
      ctr: 0.85,
      result: 0.6,
    },
  ],
};
const DAY = 86_400_000;
const isDate = (v: string | undefined): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
function days(since: string, until: string) {
  const out: string[] = [];
  for (
    let t = Date.parse(since);
    t <= Date.parse(until) && out.length < 400;
    t += DAY
  )
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
type Totals = {
  spend: number;
  impressions: number;
  linkClicks: number;
  results: number;
};
function day(campaign: DemoCampaign, date: string, index: number): Totals {
  const dayNumber = Math.floor(Date.parse(date) / DAY);
  const noise = 1 + 0.12 * Math.sin(dayNumber * 1.7 + index);
  const daysAgo = Math.floor(
    (Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(date)) /
      DAY,
  );
  const fatigue = campaign.fatigue
    ? 0.6 + 0.4 * Math.min(1, Math.max(0, daysAgo) / 14)
    : 1;
  const impressions = Math.round(campaign.impressions * noise);
  const linkClicks = Math.round(
    ((impressions * campaign.linkCtr) / 100) * fatigue,
  );
  return {
    spend: Math.round(campaign.spend * noise * 100) / 100,
    impressions,
    linkClicks,
    results: Math.round(linkClicks * campaign.resultPerClick),
  };
}
function row(
  campaign: DemoCampaign,
  totals: Totals,
  dayCount: number,
  extra: Record<string, unknown>,
) {
  const frequency = Math.min(
    6,
    campaign.frequencyBase + campaign.frequencyPerDay * dayCount,
  );
  const actions: { action_type: string; value: string }[] = [
    { action_type: 'link_click', value: String(totals.linkClicks) },
  ];
  if (campaign.result === 'LEAD')
    actions.push({ action_type: LEAD_ACTION, value: String(totals.results) });
  if (campaign.result === 'MESSAGING')
    actions.push({
      action_type: MESSAGING_ACTION,
      value: String(totals.results),
    });
  return {
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    objective: campaign.objective,
    spend: totals.spend.toFixed(2),
    impressions: String(totals.impressions),
    reach: String(Math.round(totals.impressions / frequency)),
    frequency: frequency.toFixed(4),
    clicks: String(Math.round(totals.linkClicks * 1.9)),
    inline_link_clicks: String(totals.linkClicks),
    actions,
    account_currency: 'THB',
    ...extra,
  };
}
export function demoInsights(
  params: Record<string, string>,
): Record<string, unknown>[] {
  const until = isDate(params.until)
    ? params.until
    : new Date().toISOString().slice(0, 10);
  const since = isDate(params.since)
    ? params.since
    : new Date(Date.parse(until) - 6 * DAY).toISOString().slice(0, 10);
  const dates = days(since, until);
  const ids = params.campaignIds ? params.campaignIds.split(',') : null;
  const selected = campaigns.filter((c) => !ids || ids.includes(c.id));
  const sum = (c: DemoCampaign, index: number, list = dates) =>
    list
      .map((d) => day(c, d, index))
      .reduce(
        (a, b) => ({
          spend: Math.round((a.spend + b.spend) * 100) / 100,
          impressions: a.impressions + b.impressions,
          linkClicks: a.linkClicks + b.linkClicks,
          results: a.results + b.results,
        }),
        { spend: 0, impressions: 0, linkClicks: 0, results: 0 },
      );
  if (params.level === 'account' && params.timeIncrement === '1')
    return dates.map((date) => {
      const parts = selected.map((c) => ({
        c,
        t: sum(c, campaigns.indexOf(c), [date]),
      }));
      const leads = parts
        .filter((p) => p.c.result === 'LEAD')
        .reduce((n, p) => n + p.t.results, 0);
      const chats = parts
        .filter((p) => p.c.result === 'MESSAGING')
        .reduce((n, p) => n + p.t.results, 0);
      const linkClicks = parts.reduce((n, p) => n + p.t.linkClicks, 0);
      const impressions = parts.reduce((n, p) => n + p.t.impressions, 0);
      return {
        date_start: date,
        date_stop: date,
        spend: parts.reduce((n, p) => n + p.t.spend, 0).toFixed(2),
        impressions: String(impressions),
        clicks: String(Math.round(linkClicks * 1.9)),
        inline_link_clicks: String(linkClicks),
        actions: [
          { action_type: 'link_click', value: String(linkClicks) },
          { action_type: LEAD_ACTION, value: String(leads) },
          { action_type: MESSAGING_ACTION, value: String(chats) },
        ],
        account_currency: 'THB',
      };
    });
  const dimension =
    params.level === 'adset' || params.level === 'ad'
      ? params.level
      : params.breakdowns === 'publisher_platform,platform_position'
        ? 'platform_position'
        : (params.breakdowns ?? '');
  return selected.flatMap((c) => {
    const index = campaigns.indexOf(c);
    const totals = sum(c, index);
    const parts = segments[dimension];
    if (!parts) return [row(c, totals, dates.length, {})];
    return parts.map((segment) => {
      const linkClicks = Math.round(
        totals.linkClicks * segment.share * segment.ctr,
      );
      const split: Totals = {
        spend: Math.round(totals.spend * segment.share * 100) / 100,
        impressions: Math.round(totals.impressions * segment.share),
        linkClicks,
        results: Math.round(linkClicks * c.resultPerClick * segment.result),
      };
      const extra: Record<string, unknown> =
        dimension === 'adset'
          ? {
              adset_id: c.id + ':adset-' + segment.key,
              adset_name: segment.label,
            }
          : dimension === 'ad'
            ? { ad_id: c.id + ':ad-' + segment.key, ad_name: segment.label }
            : dimension === 'platform_position'
              ? {
                  publisher_platform: segment.key.split('|')[0],
                  platform_position: segment.label,
                }
              : { [dimension]: segment.key };
      return row(c, split, dates.length, extra);
    });
  });
}
