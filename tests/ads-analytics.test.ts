import { describe, expect, it } from 'vitest';
import {
  MESSAGING_ACTION,
  adsAlerts,
  dailyPoints,
  peerBenchmarks,
  performanceMetrics,
  periodChanges,
  periodMetrics,
  previousRange,
  resultTypeFor,
  totalMetrics,
} from '../shared/ads-analytics';
import { insightQuery } from '../worker/services/meta/provider';
import { demoInsights } from '../worker/services/meta/demo-insights';

const chatRow = {
  campaign_id: '1',
  spend: '1000',
  impressions: '20000',
  reach: '5000',
  clicks: '600',
  inline_link_clicks: '300',
  actions: [{ action_type: MESSAGING_ACTION, value: '20' }],
};

describe('objective-aware results', () => {
  it('counts Messenger conversations as results for engagement campaigns', () => {
    const m = performanceMetrics([chatRow], 'OUTCOME_ENGAGEMENT');
    expect(m).toMatchObject({
      resultType: 'MESSAGING',
      results: 20,
      costPerResult: 50,
      messagingConversations: 20,
      leads: null,
      frequency: 4,
      linkCtr: 1.5,
      ctr: 3,
      costPerLinkClick: 1000 / 300,
    });
    expect(m.resultRate).toBeCloseTo((20 / 300) * 100);
  });
  it('picks the result type from the objective and reported actions', () => {
    expect(resultTypeFor('OUTCOME_TRAFFIC', 5, 5)).toBe('LINK_CLICK');
    expect(resultTypeFor('OUTCOME_AWARENESS', null, null)).toBe('REACH');
    expect(resultTypeFor('OUTCOME_LEADS', 3, 9)).toBe('LEAD');
    expect(resultTypeFor('OUTCOME_LEADS', null, 9)).toBe('MESSAGING');
    expect(resultTypeFor('OUTCOME_ENGAGEMENT', 4, null)).toBe('LEAD');
    expect(resultTypeFor(null, null, null)).toBe('LEAD');
  });
  it('never adds reach across rows and keeps missing results unknown', () => {
    const m = performanceMetrics([chatRow, chatRow], 'OUTCOME_ENGAGEMENT');
    expect(m.reach).toBeNull();
    expect(m.frequency).toBeNull();
    const missing = performanceMetrics(
      [{ ...chatRow, actions: undefined }],
      'OUTCOME_ENGAGEMENT',
    );
    expect(missing.results).toBeNull();
    expect(missing.costPerResult).toBeNull();
  });
  it('totals only reported lead and chat counts and groups daily points', () => {
    const t = totalMetrics([
      chatRow,
      { ...chatRow, actions: [{ action_type: 'lead', value: '4' }] },
    ]);
    expect(t).toMatchObject({
      leads: 4,
      messagingConversations: 20,
      spend: 2000,
      costPerLead: 250,
      costPerMessagingConversation: 50,
    });
    expect(
      dailyPoints([
        { ...chatRow, date_start: '2026-11-02' },
        { ...chatRow, date_start: '2026-11-01' },
        { ...chatRow, date_start: 'bad' },
      ]).map((p) => p.date),
    ).toEqual(['2026-11-01', '2026-11-02']);
  });
  it('computes the previous range of equal length', () => {
    expect(previousRange('2026-11-01', '2026-11-07')).toEqual({
      since: '2026-10-25',
      until: '2026-10-31',
    });
    expect(previousRange('2026-03-01', '2026-03-01')).toEqual({
      since: '2026-02-28',
      until: '2026-02-28',
    });
  });
});

describe('rule-based alerts', () => {
  const base = performanceMetrics([chatRow], 'OUTCOME_ENGAGEMENT');
  it('flags creative fatigue when frequency is high and link CTR fell', () => {
    const previous = periodMetrics(
      performanceMetrics(
        [{ ...chatRow, inline_link_clicks: '500' }],
        'OUTCOME_ENGAGEMENT',
      ),
    );
    const campaign = {
      ...base,
      previous,
      changes: periodChanges(periodMetrics(base), previous),
    };
    const codes = adsAlerts(campaign, peerBenchmarks([campaign])).map(
      (a) => a.code,
    );
    expect(codes).toContain('CREATIVE_FATIGUE');
    expect(codes).not.toContain('HIGH_FREQUENCY');
  });
  it('waits for data before judging small campaigns', () => {
    const small = performanceMetrics(
      [{ ...chatRow, impressions: '500' }],
      'OUTCOME_ENGAGEMENT',
    );
    expect(adsAlerts(small, peerBenchmarks([small]))).toEqual([
      expect.objectContaining({ code: 'LOW_DATA' }),
    ]);
  });
  it('flags spend without results and highlights the best peer', () => {
    const peers = [
      performanceMetrics(
        [{ ...chatRow, reach: '15000' }],
        'OUTCOME_ENGAGEMENT',
      ),
      performanceMetrics(
        [
          {
            ...chatRow,
            reach: '15000',
            spend: '3000',
            actions: [{ action_type: MESSAGING_ACTION, value: '20' }],
          },
        ],
        'OUTCOME_ENGAGEMENT',
      ),
      performanceMetrics(
        [
          {
            ...chatRow,
            reach: '15000',
            actions: [{ action_type: MESSAGING_ACTION, value: '0' }],
          },
        ],
        'OUTCOME_ENGAGEMENT',
      ),
    ];
    const benchmarks = peerBenchmarks(peers);
    expect(adsAlerts(peers[0], benchmarks).map((a) => a.code)).toContain(
      'TOP_PERFORMER',
    );
    const clicked = adsAlerts({ ...peers[2], spend: 200 }, benchmarks);
    expect(clicked[0].code).toBe('CLICKS_NO_RESULTS');
    const costly = adsAlerts(peers[2], benchmarks);
    expect(costly[0]).toMatchObject({
      code: 'SPEND_NO_RESULTS',
      severity: 'CRITICAL',
    });
    expect(adsAlerts(peers[1], benchmarks, 100).map((a) => a.code)).toContain(
      'ABOVE_TARGET',
    );
  });
});

describe('Graph insight query', () => {
  it('requests link clicks, reach and objective and forwards only safe filters', () => {
    const q = insightQuery({
      since: '2026-11-01',
      until: '2026-11-07',
      campaignIds: '123,demo:x,456',
      breakdowns: 'age',
    });
    expect(q.level).toBe('campaign');
    expect(q.fields.split(',')).toEqual(
      expect.arrayContaining([
        'objective',
        'reach',
        'frequency',
        'inline_link_clicks',
        'actions',
      ]),
    );
    expect(JSON.parse(q.filtering!)).toEqual([
      { field: 'campaign.id', operator: 'IN', value: ['123', '456'] },
    ]);
    expect(q.breakdowns).toBe('age');
    const daily = insightQuery({
      since: '2026-11-01',
      until: '2026-11-07',
      level: 'account',
      timeIncrement: '1',
      breakdowns: 'device_platform',
    });
    expect(daily).toMatchObject({
      level: 'account',
      time_increment: '1',
      limit: '100',
    });
    expect(daily.fields).toContain('date_start');
    expect(daily.fields).not.toContain('campaign_id');
    expect('breakdowns' in daily).toBe(false);
    expect(insightQuery({ level: 'bogus' }).level).toBe('campaign');
  });
  it('generates deterministic demo breakdowns and daily rows', () => {
    const range = { since: '2026-10-01', until: '2026-10-07' };
    expect(
      demoInsights({ ...range, level: 'account', timeIncrement: '1' }),
    ).toHaveLength(7);
    const ages = demoInsights({
      ...range,
      breakdowns: 'age',
      campaignIds: 'demo:campaign-2',
    });
    expect(
      ages.every((r) => r.campaign_id === 'demo:campaign-2' && r.age),
    ).toBe(true);
    expect(demoInsights(range)).toEqual(demoInsights(range));
  });
});
