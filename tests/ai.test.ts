import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../shared/schemas';
import { createDescriptionProvider, productResearchContext } from '../worker/services/ai';

const product = {
  brand: 'Life Fitness',
  model: 'Insignia Biceps Curl',
  targetBodyPart: 'Bicep',
  category: 'Machine Pin',
  condition: 'GOOD',
  sellingPrice: 75000,
  notes: '',
} as Product;

afterEach(() => vi.unstubAllGlobals());

describe('AI product research context', () => {
  it('builds exact-identity searches from brand, model, specification and category', () => {
    const context = productResearchContext(product);
    expect(context.productIdentity).toEqual({
      brand: 'Life Fitness',
      model: 'Insignia Biceps Curl',
      specification: 'Bicep',
      category: 'Machine Pin',
    });
    expect(context.searchQueries).toEqual([
      '"Life Fitness" "Insignia Biceps Curl" "Bicep" "Machine Pin"',
      'Life Fitness Insignia Biceps Curl official manufacturer',
      'Life Fitness Insignia Biceps Curl manual specifications',
    ]);
  });

  it('sends the identity search plan and keeps only citations returned by web search', async () => {
    const verifiedSource = {
      title: 'Insignia Series Biceps Curl',
      url: 'https://www.lifefitness.com/product/insignia-biceps-curl',
    };
    const unverifiedSource = {
      title: 'Similar Biceps Curl Machine',
      url: 'https://example.com/similar-machine',
    };
    const output = {
      descriptionTh: 'เครื่องฝึกกล้ามเนื้อ Bicep',
      descriptionEn: 'Bicep training machine',
      shortDescription: 'Bicep curl machine',
      facebookCaption: 'Equipment for focused arm training',
      features: ['แขนรองรับเพื่อช่วยจัดท่าฝึก'],
      strengths: [],
      weaknesses: [],
      priceRating: null,
      designRating: null,
      qualityPerformanceRating: null,
      ratingReasons: { price: 'ข้อมูลราคาไม่เพียงพอ', design: '', qualityPerformance: '' },
      analysisSources: [verifiedSource, unverifiedSource],
    };
    let sentBody = '';
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = String(init?.body ?? '');
      return new Response(JSON.stringify({
        output_text: JSON.stringify(output),
        output: [{ type: 'web_search_call', action: { sources: [verifiedSource] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const result = await createDescriptionProvider({
      AI_API_KEY: 'test-key',
      AI_MODEL: 'test-model',
      AI_BASE_URL: 'https://api.example.test/v1',
    }).generate(product);

    const request = JSON.parse(sentBody) as {
      input: { role: string; content: string }[];
    };
    const context = JSON.parse(request.input[1].content) as ReturnType<typeof productResearchContext>;
    expect(context.productIdentity).toEqual(productResearchContext(product).productIdentity);
    expect(request.input[0].content).toContain('EVERY searchQueries entry');
    expect(result.analysisSources).toEqual([verifiedSource]);
  });
});
