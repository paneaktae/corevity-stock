import { describe, expect, it } from 'vitest';
import { translateThaiToEnglish } from '../worker/services/translate';

const config = { AI_API_KEY: 'test-key', AI_MODEL: 'test-model', AI_BASE_URL: 'https://ai.example.test/v1' };
function fakeFetch(output: unknown, status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('Thai to English term translation', () => {
  it('sends only non-empty texts and returns one English string per key', async () => {
    const { impl, calls } = fakeFetch({ paymentTerms: '30% deposit of the total product price' });
    const result = await translateThaiToEnglish(
      config,
      { paymentTerms: 'มัดจำ 30% ของราคาสินค้าทั้งหมด', warrantyTerms: '  ' },
      impl,
    );
    expect(result).toEqual({ paymentTerms: '30% deposit of the total product price' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ai.example.test/v1/responses');
    const format = (calls[0].body.text as { format: { schema: { required: string[] } } }).format;
    expect(format.schema.required).toEqual(['paymentTerms']);
  });

  it('does not call the provider when there is nothing to translate', async () => {
    const { impl, calls } = fakeFetch({});
    expect(await translateThaiToEnglish(config, { paymentTerms: '' }, impl)).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('reports a missing configuration and bad provider output', async () => {
    await expect(
      translateThaiToEnglish({ ...config, AI_API_KEY: '' }, { paymentTerms: 'มัดจำ' }),
    ).rejects.toThrow('AI_NOT_CONFIGURED');
    await expect(
      translateThaiToEnglish(config, { paymentTerms: 'มัดจำ' }, fakeFetch({ paymentTerms: '' }).impl),
    ).rejects.toThrow('AI_PROVIDER_ERROR');
    await expect(
      translateThaiToEnglish(config, { paymentTerms: 'มัดจำ' }, fakeFetch({}, 500).impl),
    ).rejects.toThrow('AI_PROVIDER_ERROR');
  });
});
