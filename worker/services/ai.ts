import {
  descriptionSchema,
  type Descriptions,
  type Product,
} from '../../shared/schemas';

export interface DescriptionProvider {
  generate(product: Product): Promise<Descriptions>;
}

export function parseDescriptions(content: string): Descriptions {
  return descriptionSchema.parse(
    JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')),
  );
}

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    descriptionTh: { type: 'string' },
    descriptionEn: { type: 'string' },
    shortDescription: { type: 'string' },
    facebookCaption: { type: 'string' },
    features: { type: 'array', items: { type: 'string' } },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    priceRating: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    designRating: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    qualityPerformanceRating: {
      anyOf: [{ type: 'number' }, { type: 'null' }],
    },
    ratingReasons: {
      type: 'object',
      additionalProperties: false,
      properties: {
        price: { type: 'string' },
        design: { type: 'string' },
        qualityPerformance: { type: 'string' },
      },
      required: ['price', 'design', 'qualityPerformance'],
    },
    analysisSources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['title', 'url'],
      },
    },
  },
  required: [
    'descriptionTh',
    'descriptionEn',
    'shortDescription',
    'facebookCaption',
    'features',
    'strengths',
    'weaknesses',
    'priceRating',
    'designRating',
    'qualityPerformanceRating',
    'ratingReasons',
    'analysisSources',
  ],
} as const;

type ResponsesPayload = {
  output_text?: string;
  output?: Array<{
    type?: string;
    action?: {
      sources?: Array<{ title?: string; url?: string }>;
    };
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function responseText(data: ResponsesPayload): string {
  if (typeof data.output_text === 'string' && data.output_text.trim())
    return data.output_text;
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter(
      (item) => item.type === 'output_text' && typeof item.text === 'string',
    )
    .map((item) => item.text as string)
    .join('');
}

function responseSources(data: ResponsesPayload) {
  return (data.output ?? [])
    .filter((item) => item.type === 'web_search_call')
    .flatMap((item) => item.action?.sources ?? [])
    .filter(
      (source): source is { title: string; url: string } =>
        typeof source.title === 'string' &&
        typeof source.url === 'string' &&
        /^https?:\/\//.test(source.url),
    )
    .slice(0, 10);
}

export function createDescriptionProvider(config: {
  AI_API_KEY?: string;
  AI_MODEL: string;
  AI_BASE_URL: string;
}): DescriptionProvider {
  return {
    async generate(product) {
      if (!config.AI_API_KEY || !config.AI_MODEL || !config.AI_BASE_URL)
        throw new Error('AI_NOT_CONFIGURED');
      const base = new URL(config.AI_BASE_URL);
      if (base.protocol !== 'https:') throw new Error('AI_NOT_CONFIGURED');
      const response = await fetch(
        `${base.href.replace(/\/$/, '')}/responses`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.AI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(60000),
          body: JSON.stringify({
            model: config.AI_MODEL,
            temperature: 0,
            tools: [{ type: 'web_search', search_context_size: 'high' }],
            tool_choice: 'required',
            include: ['web_search_call.action.sources'],
            text: {
              format: {
                type: 'json_schema',
                name: 'product_analysis',
                strict: true,
                schema: outputSchema,
              },
            },
            input: [
              {
                role: 'system',
                content:
                  'You are a product research analyst for used fitness equipment. You MUST use web search before writing anything. Search the exact brand and model, including official manufacturer pages and manuals first. Use only facts that match the exact model; clearly separate facts from reasonable condition-based considerations. Return detailed Thai and English copy. Put model-specific features and functions in features as concise Thai bullets. Never invent a specification, feature, warranty, certification, market price, or performance claim. For each score use only retrieved evidence and the supplied selling price and condition. Apply a stable rubric: price is value versus documented new/used reference prices, design is documented ergonomics/usability/build choices, qualityPerformance is documented construction, capacity, motor/resistance and exercise functions adjusted for condition. Scores are 0 to 10. If evidence is insufficient for a category, return null for that score and explain that evidence was insufficient in ratingReasons. Do not use a neutral default. Every non-empty feature and every non-null score must be supported by one or more exact-model sources. Copy only the source title and URL actually returned by web search into analysisSources. Use empty arrays when no supported point exists. Return only the JSON schema response.',
              },
              {
                role: 'user',
                content: JSON.stringify({
                  brand: product.brand,
                  model: product.model,
                  category: product.category,
                  condition: product.condition,
                  sellingPriceThb: product.sellingPrice,
                  notes: product.notes,
                }),
              },
            ],
          }),
        },
      );
      if (!response.ok) throw new Error('AI_PROVIDER_ERROR');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('AI_PROVIDER_ERROR');
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256000) {
          await reader.cancel();
          throw new Error('AI_PROVIDER_ERROR');
        }
        chunks.push(value);
      }
      const all = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.length;
      }
      const data = JSON.parse(
        new TextDecoder().decode(all),
      ) as ResponsesPayload;
      const parsed = parseDescriptions(responseText(data));
      const sources = responseSources(data);
      return sources.length ? { ...parsed, analysisSources: sources } : parsed;
    },
  };
}
