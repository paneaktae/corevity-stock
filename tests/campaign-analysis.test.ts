import { describe, expect, it } from 'vitest';
import { campaignPerformance } from '../worker/services/meta/reports';
import {
  WorkerMetaAIProvider,
  campaignAdviceUsesSuppliedNumbers,
} from '../worker/services/meta/ai';

const row = {
  campaign_id: 'campaign-a',
  campaign_name: 'Lead campaign',
  spend: '600',
  impressions: '10000',
  clicks: '200',
  actions: [{ action_type: 'lead', value: '10' }],
};

describe('campaign performance evidence', () => {
  it('rejects unsupported numeric claims in advice and tests while accepting rounded evidence', () => {
    const context = { campaign: { costPerLead: 267.777777, spend: 4820 } };
    expect(
      campaignAdviceUsesSuppliedNumbers(
        { campaignId: 'a', suggestion: 'CPL 267.78, spend 4,820' },
        context,
      ),
    ).toBe(true);
    expect(
      campaignAdviceUsesSuppliedNumbers(
        { campaignId: 'a', suggestion: 'ROAS 99.9' },
        context,
      ),
    ).toBe(false);
    expect(
      campaignAdviceUsesSuppliedNumbers(
        {
          campaignId: 'a',
          suggestion: 'Review creative',
          improvements: [
            {
              area: 'BUDGET',
              action: 'Increase budget by 25%',
              measure: 'Track CPL',
            },
          ],
        },
        context,
      ),
    ).toBe(false);
  });
  it('asks the configured AI for language-specific tests and accepts validated structured advice', async () => {
    const expected = {
      intent: 'OTHER',
      language: 'th',
      productIds: [],
      translation: '',
      evidence: [],
      recommendations: [
        {
          campaignId: 'campaign-a',
          suggestion: 'ต้นทุนลีดสูงกว่าเป้าหมายที่กำหนด',
          improvements: [
            {
              area: 'CREATIVE',
              action: 'ทดสอบภาพสินค้าใหม่โดยคงกลุ่มเป้าหมาย',
              measure: 'ติดตาม CTR และต้นทุนลีด',
            },
          ],
        },
      ],
    };
    const env = {
      AI_API_KEY: 'synthetic-test-only',
      AI_BASE_URL: 'https://ai.example.test/v1',
      AI_MODEL: 'test-model',
    } as ConstructorParameters<typeof WorkerMetaAIProvider>[0];
    const provider = new WorkerMetaAIProvider(env, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.input[0].content).toContain('Do not infer ROAS/ROI');
      expect(body.input[0].content).toContain('untrusted data');
      expect(JSON.parse(body.input[1].content)).toMatchObject({
        task: 'ADS',
        targetLanguage: 'th',
      });
      return Response.json({ output_text: JSON.stringify(expected) });
    });
    expect(
      await provider.analyze(
        'ADS',
        { comparison: campaignPerformance([row], 50) },
        'th',
      ),
    ).toEqual(expected);
  });
  it('calculates weighted campaign metrics and compares observed CPL only to the supplied target', () => {
    expect(campaignPerformance([row], 50)[0]).toMatchObject({
      ctr: 2,
      cpc: 3,
      cpm: 60,
      costPerLead: 60,
      leadConversionRate: 5,
      assessment: 'ABOVE_TARGET',
    });
    expect(campaignPerformance([row], 60)[0].assessment).toBe('ON_TARGET');
    expect(campaignPerformance([row])[0].assessment).toBe('NO_TARGET');
    const second = {
      ...row,
      spend: '100',
      impressions: '1000',
      clicks: '100',
      actions: [{ action_type: 'lead', value: '5' }],
    };
    const combined = campaignPerformance([row, second], 50);
    expect(combined).toHaveLength(1);
    expect(combined[0].costPerLead).toBeCloseTo(700 / 15);
    expect(combined[0].ctr).toBeCloseTo((300 / 11000) * 100);
    expect(combined[0].assessment).toBe('ON_TARGET');
  });
  it('keeps missing outcomes distinct from zero and does not divide by zero', () => {
    const missing = campaignPerformance([{ ...row, actions: [] }], 50)[0];
    expect(missing.leads).toBeNull();
    expect(missing.costPerLead).toBeNull();
    expect(missing.assessment).toBe('INSUFFICIENT_DATA');
    const zero = campaignPerformance(
      [{ ...row, clicks: '0', actions: [{ action_type: 'lead', value: '0' }] }],
      50,
    )[0];
    expect(zero.leads).toBe(0);
    expect(zero.cpc).toBeNull();
    expect(zero.leadConversionRate).toBeNull();
    expect(zero.assessment).toBe('INSUFFICIENT_DATA');
  });
  it('does not label a campaign without delivery as assessable or fabricate absent campaigns', () => {
    expect(
      campaignPerformance([{ ...row, impressions: '0' }])[0].assessment,
    ).toBe('INSUFFICIENT_DATA');
    expect(campaignPerformance([])).toEqual([]);
    expect(campaignPerformance([{ ...row, campaign_id: '' }])).toEqual([]);
    expect(
      campaignPerformance([row, { ...row, campaign_id: 'campaign-b' }]),
    ).toHaveLength(2);
  });
});
