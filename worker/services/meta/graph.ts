import { HTTPException } from 'hono/http-exception';
import type { MetaEnvironment } from './config';

export class MetaAPIError extends HTTPException {
  constructor(
    public providerCode: number,
    public transient = false,
    public ambiguous = false,
  ) {
    super(
      providerCode === 190
        ? 401
        : providerCode === 10 || providerCode === 200
          ? 403
          : providerCode === 4 || providerCode === 613
            ? 429
            : 502,
      {
        message:
          providerCode === 190
            ? 'Please reconnect your Facebook account.'
            : providerCode === 10 || providerCode === 200
              ? 'Meta permissions need to be updated.'
              : providerCode === 4 || providerCode === 613
                ? 'Meta rate limit reached. Please try again later.'
                : ambiguous
                  ? 'Provider outcome is unknown. Reconcile with Meta before retrying.'
                  : 'Meta could not complete this operation.',
      },
    );
  }
}
export async function boundedJson(
  response: Response,
  maxBytes = 1_048_576,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new MetaAPIError(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new MetaAPIError(0);
      chunks.push(value);
    }
  } catch {
    await reader.cancel();
    throw new MetaAPIError(0);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new MetaAPIError(0);
  }
}
export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const string = (value: unknown) =>
  typeof value === 'string' ? value : '';
export function providerId(value: string) {
  if (!/^(?:act_)?\d+$/.test(value))
    throw new HTTPException(422, { message: 'Invalid Meta asset identifier.' });
  return value;
}
export class MetaGraphClient {
  constructor(
    private env: MetaEnvironment,
    private token: string,
    private http: typeof fetch = fetch,
  ) {}
  async request(
    path: string,
    params: Record<string, string> = {},
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
  ) {
    if (
      this.env.META_LIVE_ACTIVATION_CONFIRMED !== 'true' ||
      !/^v\d+\.\d+$/.test(this.env.META_GRAPH_API_VERSION ?? '')
    )
      throw new HTTPException(503, {
        message:
          'READY FOR META CONFIGURATION: verify the API version and activate live access in Worker configuration.',
      });
    if (!/^[a-zA-Z0-9_/-]+$/.test(path)) throw new MetaAPIError(0);
    const url = new URL(
      'https://graph.facebook.com/' +
        this.env.META_GRAPH_API_VERSION +
        '/' +
        path,
    );
    if (this.env.META_APP_SECRET && this.token && !path.startsWith('oauth/')) {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(this.env.META_APP_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const proof = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(this.token),
      );
      params = {
        ...params,
        appsecret_proof: [...new Uint8Array(proof)]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join(''),
      };
    }
    if (method !== 'POST')
      for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value);
    let response: Response;
    const http = this.http;
    try {
      response = await http.call(globalThis, url.href, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: 'Bearer ' + this.token,
          ...(method === 'POST'
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        body: method === 'POST' ? new URLSearchParams(params) : undefined,
      });
    } catch {
      throw new MetaAPIError(0, true, method !== 'GET');
    }
    if (response.status >= 300 && response.status < 400)
      throw new MetaAPIError(0, false, method !== 'GET');
    let result: unknown;
    try {
      result = await boundedJson(response);
    } catch {
      throw new MetaAPIError(0, true, method !== 'GET');
    }
    const error = object(object(result).error);
    if (!response.ok || Object.keys(error).length) {
      throw new MetaAPIError(
        Number(error.code) || (response.status === 429 ? 4 : 0),
        error.is_transient === true || response.status >= 500,
        method !== 'GET' && response.status >= 500,
      );
    }
    return object(result);
  }
  async list(path: string, params: Record<string, string> = {}) {
    const result = await this.request(path, { limit: '50', ...params });
    const data = Array.isArray(result.data) ? result.data.map(object) : [];
    const paging = object(result.paging);
    const after = paging.next ? string(object(paging.cursors).after) : null;
    return { data, after: after || null };
  }
  async all(path: string, params: Record<string, string> = {}) {
    const rows: Record<string, unknown>[] = [];
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const next: { data: Record<string, unknown>[]; after: string | null } =
        await this.list(path, { ...params, ...(after ? { after } : {}) });
      rows.push(...next.data);
      after = next.after;
      if (!after) return rows;
    }
    throw new HTTPException(422, {
      message:
        'Meta asset list is too large. Reduce the selected business scope before connecting.',
    });
  }
}
