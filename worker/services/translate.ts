/**
 * Thai → English translation of quotation/invoice terms through the
 * configured OpenAI-compatible Responses API (the same AI_* settings used for
 * product descriptions). No web search: a plain, deterministic translation.
 */
export type TranslateConfig = {
  AI_API_KEY?: string;
  AI_MODEL: string;
  AI_BASE_URL: string;
};

const instructions =
  'You translate Thai business text from a used commercial gym equipment company (Corevity) into clear, professional English for quotations and invoices. ' +
  'Translate each value faithfully and naturally; do not add, remove or soften any condition. ' +
  'Keep numbers, percentages, amounts, dates, durations, account numbers, names, phone numbers and line breaks exactly. ' +
  'Bank names use their usual English names (e.g. กสิกรไทย → Kasikornbank, ไทยพาณิชย์ → Siam Commercial Bank, กรุงเทพ → Bangkok Bank). ' +
  'If a value is already in English, return it unchanged. Return only the JSON object with the same keys.';

function responseText(data: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('');
}

export async function translateThaiToEnglish(
  config: TranslateConfig,
  texts: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string>> {
  const keys = Object.keys(texts).filter((key) => texts[key].trim());
  if (!keys.length) return {};
  if (!config.AI_API_KEY || !config.AI_MODEL || !config.AI_BASE_URL)
    throw new Error('AI_NOT_CONFIGURED');
  const base = new URL(config.AI_BASE_URL);
  if (base.protocol !== 'https:') throw new Error('AI_NOT_CONFIGURED');
  const input = Object.fromEntries(keys.map((key) => [key, texts[key]]));
  const response = await fetchImpl(`${base.href.replace(/\/$/, '')}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.AI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: config.AI_MODEL,
      temperature: 0,
      text: {
        format: {
          type: 'json_schema',
          name: 'translations',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: keys,
            properties: Object.fromEntries(keys.map((key) => [key, { type: 'string' }])),
          },
        },
      },
      input: [
        { role: 'system', content: instructions },
        { role: 'user', content: JSON.stringify(input) },
      ],
    }),
  });
  if (!response.ok) throw new Error('AI_PROVIDER_ERROR');
  const raw = await response.text();
  if (raw.length > 200000) throw new Error('AI_PROVIDER_ERROR');
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText(JSON.parse(raw)));
  } catch {
    throw new Error('AI_PROVIDER_ERROR');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('AI_PROVIDER_ERROR');
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error('AI_PROVIDER_ERROR');
    result[key] = value.trim().slice(0, 2000);
  }
  return result;
}
