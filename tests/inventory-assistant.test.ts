import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InventoryAssistantInput } from '../shared/schemas';
import { answerInventoryQuestion } from '../worker/services/inventory-assistant';

afterEach(() => vi.unstubAllGlobals());

describe('inventory assistant', () => {
  it('only attaches products returned from the inventory search', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              reply: 'This item matches your request.',
              productIds: [
                'real-product',
                'invented-product',
                'real-product',
              ],
            }),
          }),
        ),
    );
    vi.stubGlobal(
      'fetch',
      fetchMock,
    );
    const input: InventoryAssistantInput = {
      message: 'Find a treadmill',
      language: 'en',
      history: [],
    };
    const product = {
      id: 'real-product',
      sku: '202601001',
      brand: 'Corevity',
      model: 'Run 1',
      status: 'AVAILABLE' as const,
      sellingPrice: 25000,
      primaryImageId: null,
      archivedAt: null,
      category: 'Treadmills',
      condition: 'Good',
      descriptionTh: '',
      descriptionEn: '',
    };
    const result = await answerInventoryQuestion(
      input,
      {
        terms: ['treadmill'],
        brand: null,
        model: null,
        category: null,
        minPrice: null,
        maxPrice: null,
        statuses: [],
      },
      [product],
      {
        AI_API_KEY: 'test-key',
        AI_MODEL: 'gpt-4.1-mini',
        AI_BASE_URL: 'https://api.openai.com/v1',
      },
    );
    expect(result.products).toEqual([product]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      max_output_tokens: number;
    };
    expect(body.max_output_tokens).toBe(320);
  });
});
