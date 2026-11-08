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

export function productResearchContext(product: Product) {
  const brand = product.brand.trim();
  const model = product.model.trim();
  const specification = product.targetBodyPart.trim();
  const category = product.category.trim();
  const exactIdentity = [brand, model, specification, category]
    .filter(Boolean)
    .map((part) => `"${part.replaceAll('"', '')}"`)
    .join(' ');
  return {
    productIdentity: { brand, model, specification, category },
    searchQueries: [
      exactIdentity,
      [brand, model, 'official manufacturer'].filter(Boolean).join(' '),
      [brand, model, 'manual specifications'].filter(Boolean).join(' '),
    ],
    evaluationContext: {
      condition: product.condition,
      sellingPriceThb: product.sellingPrice,
      notes: product.notes,
    },
  };
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
                  'You are a careful product researcher for used fitness equipment. Before drafting, use web search for EVERY searchQueries entry supplied by the user. The productIdentity fields are authoritative: brand and model identify the exact machine; specification and category are mandatory disambiguators and must be checked against each candidate source. Search the exact quoted combination first, then the exact brand+model on the official manufacturer site, then the exact brand+model in official manuals/specification sheets. Do not substitute a similar model, another generation, a product family, or a machine that trains the same body part. A source is usable for model-specific facts only when it explicitly identifies the same model; if that cannot be verified, exclude it. The specification is the target body part, not a free-form cue to guess machine functions. Category identifies equipment type and must also agree. Use condition, price, and notes only as context; they are not evidence for product specifications. If reliable exact-model sources cannot be found, say so in the descriptions and leave unsupported features/rating scores empty or null. Return detailed Thai and English copy. Put verified model-specific features and functions in features as concise Thai bullets. Never invent a specification, feature, warranty, certification, market price, or performance claim. For price ratings, compare only sourced prices for the same model and clearly state when no comparable price evidence exists. For design and qualityPerformance, use only retrieved exact-model evidence; consider condition only when clearly marked as an estimate. Apply a stable 0–10 rubric and use null plus an explanation in ratingReasons whenever evidence is insufficient; do not use a neutral default. Every non-empty feature and every non-null score must be supported by one or more exact-model sources. In analysisSources, cite only relevant search results that you actually used, copying their exact title and URL. Return only the JSON schema response.',
              },
              {
                role: 'user',
                content: JSON.stringify(productResearchContext(product)),
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
      const searchSources = responseSources(data);
      const returnedUrls = new Set(searchSources.map((source) => source.url));
      const citedSources = parsed.analysisSources.filter((source) =>
        returnedUrls.has(source.url),
      );
      return { ...parsed, analysisSources: citedSources };
    },
  };
}
