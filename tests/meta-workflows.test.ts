import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { digest } from '../worker/auth';
import { messengerDefaults, messengerActions } from '../shared/meta-messenger';
import { adsMetrics, reportRange } from '../worker/services/meta/reports';
import {
  normalizeMetaWebhook,
  verifyMetaSignature,
} from '../worker/services/meta/webhooks';
import { messagingWindowOpen } from '../worker/services/meta/inbox';
import { metaFlagNames, type MetaStatus } from '../shared/meta';
import { MetaGraphClient } from '../worker/services/meta/graph';
import { WorkerMetaAIProvider } from '../worker/services/meta/ai';
let live: Miniflare, demo: Miniflare;
let writes = 0,
  reads = 0,
  demoEgress = 0,
  campaignWrites = 0,
  failCampaign = false;
let lastCampaign: Record<string, string> = {};
const providerPaths: string[] = [];
const automaticMessages: Record<string, string>[] = [];
const linePushes: { to: string; key: string; text: string }[] = [];
let failMessenger = false,
  failProfile = false,
  lineStatus = 200;
let profileFields = '';

const secret = 'synthetic-meta-app-secret';
const permissions = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_messaging',
  'leads_retrieval',
  'ads_read',
  'ads_management',
  'pages_manage_posts',
  'read_insights',
];
const liveHeaders = { Cookie: 'corevity_session=meta-admin-session' };
const staffHeaders = { Cookie: 'corevity_session=meta-staff-session' };
const config = {
  META_APP_ID: '123',
  META_LOGIN_CONFIG_ID: '456',
  META_APP_SECRET: secret,
  META_WEBHOOK_VERIFY_TOKEN: 'synthetic-verify',
  META_GRAPH_API_VERSION: 'v99.0', // Synthetic version: never contacted outside the stub.
  META_OAUTH_REDIRECT_URL:
    'https://crm.example.test/api/integrations/meta/callback',
  META_TOKEN_ENCRYPTION_KEY: btoa(
    String.fromCharCode(...new Uint8Array(32).fill(4)),
  ),
  META_TOKEN_ENCRYPTION_KEY_VERSION: 'test-key',
  META_LIVE_ACTIVATION_CONFIRMED: 'true',
  META_PAGE_INSIGHT_METRICS: 'test_metric',
  PUBLIC_CATALOG_BASE_URL: 'https://catalog.example.test',
};
async function fakeGraph(request: {
  url: string;
  method: string;
  text: () => Promise<string>;
  headers: { get(name: string): string | null };
}) {
  const url = new URL(request.url);
  if (
    url.hostname === 'api.line.me' &&
    url.pathname === '/v2/bot/message/push'
  ) {
    const value = JSON.parse(await request.text());
    linePushes.push({
      to: value.to,
      key: request.headers.get('x-line-retry-key') ?? '',
      text: value.messages[0].text,
    });
    return new Response('{}', {
      status: lineStatus,
      headers:
        lineStatus === 409 ? { 'x-line-accepted-request-id': 'accepted' } : {},
    });
  }
  if (url.hostname !== 'graph.facebook.com')
    throw new Error('Unexpected outbound hostname');
  const path = url.pathname.replace(/^\/v[^/]+\//, '');
  providerPaths.push(path);
  const params =
    request.method === 'POST'
      ? Object.fromEntries(new URLSearchParams(await request.text()))
      : Object.fromEntries(url.searchParams);
  if (request.method === 'GET') reads++;
  else writes++;
  const response = (data: unknown) => Response.json(data);
  if (path === 'oauth/access_token')
    return response({
      access_token: params.grant_type
        ? 'synthetic-user-token'
        : 'synthetic-short-token',
    });
  if (path === 'debug_token')
    return response({
      data: {
        is_valid: true,
        app_id: '123',
        user_id: '42',
        issued_at: Math.floor(Date.now() / 1000) - 60,
        expires_at: Math.floor(Date.now() / 1000) + 86400,
        scopes: permissions,
      },
    });
  if (path === 'me/accounts')
    return response({
      data: [
        {
          id: '100',
          name: 'Authorized test page',
          access_token: 'synthetic-page-token',
          tasks: ['MESSAGE', 'MANAGE'],
          picture: { data: { url: 'https://example.test/avatar' } },
        },
      ],
    });
  if (path === 'me/adaccounts')
    return response({
      data: [
        {
          id: 'act_200',
          name: 'Test ads',
          currency: 'THB',
          timezone_name: 'Asia/Bangkok',
        },
      ],
    });
  if (path === 'me/messenger_profile') {
    if (failProfile) throw new Error('Synthetic profile failure');
    profileFields = params.fields ?? '';
    return response({ success: true });
  }
  if (path === '100/messages') {
    automaticMessages.push(params);
    if (failMessenger) throw new Error('Synthetic ambiguous send');
    return response({ recipient_id: '10', message_id: 'test-mid:' + writes });
  }
  if (path === '100/subscribed_apps') return response({ success: true });
  if (path === '100/leadgen_forms')
    return response({
      data: [
        {
          id: '300',
          name: 'Test form',
          questions: [
            { key: 'full_name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'budget', label: 'Budget' },
          ],
        },
      ],
    });
  if (path === '300/leads')
    return response({ data: [{ id: '400', form_id: '300' }] });
  if (path === '400')
    return response({
      id: '400',
      form_id: '300',
      field_data: [
        { name: 'full_name', values: ['Authorized lead'] },
        { name: 'email', values: ['lead@example.test'] },
        { name: 'budget', values: ['15000'] },
      ],
    });
  if (path === 'act_200/insights')
    return response({
      data: [
        {
          campaign_id: '500',
          campaign_name: 'Test campaign',
          spend: '100',
          impressions: '1000',
          clicks: '50',
          actions: [{ action_type: 'lead', value: '5' }],
          account_currency: 'THB',
        },
      ],
    });
  if (path === 'act_200/campaigns' && request.method === 'POST') {
    campaignWrites++;
    lastCampaign = params;
    if (failCampaign) throw new Error('Synthetic ambiguous transport failure');
    return response({ id: '500' });
  }
  if (path === 'act_200/campaigns')
    return response({
      data: [
        {
          id: '500',
          name: 'Test campaign',
          status: 'PAUSED',
          objective: 'OUTCOME_LEADS',
        },
      ],
    });
  if (path === '500' && request.method === 'GET')
    return response({ id: '500', account_id: '200' });
  if (path === '500' && request.method === 'POST')
    return response({ success: true });
  if (path === 'act_200/adsets' || path === 'act_200/ads')
    return response({ data: [] });
  if (path === '100/published_posts') return response({ data: [] });
  if (path === '100/feed' || path === '100/photos')
    return response({ id: '100_600' });
  if (path === '100/insights')
    return response({
      data: [
        {
          name: 'test_metric',
          period: 'day',
          values: [{ value: 5, end_time: new Date().toISOString() }],
        },
      ],
    });
  if (path === 'me/permissions' && request.method === 'DELETE')
    return response({ success: true });
  throw new Error('Unmocked provider operation');
}
beforeAll(async () => {
  const result = await build({
    entryPoints: ['worker/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:workers'],
    define: { 'import.meta.env.DEV': 'true' },
  });
  const runtime = (demoMode: boolean) =>
    new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: result.outputFiles[0].text,
        compatibilityDate: '2026-10-09',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'workflow-db' },
        r2Buckets: ['PRODUCT_IMAGES'],
        durableObjects: {
          CHAT_ROOM: { className: 'ChatRoom', useSQLite: true },
        },
        outboundService: async (request) => {
          if (demoMode) {
            demoEgress++;
            throw new Error('Demo must never use the network');
          }
          return fakeGraph(request);
        },
        serviceBindings: { ASSETS: async () => new Response('SPA') },
        bindings: {
          ENVIRONMENT: 'development',
          LOCAL_MOCK_EMAIL: 'admin@example.test',
          ALLOWED_EMAILS: 'admin@example.test,staff@example.test',
          AUTH_ADMIN_EMAIL: 'admin@example.test',
          APP_URL: 'https://crm.example.test',
          LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-line-token',
          LINE_CHANNEL_SECRET: 'synthetic-line-secret',
          AI_MODEL: '',
          AI_BASE_URL: '',
          MAX_UPLOAD_MB: '10',
          BUSINESS_TIMEZONE: 'Asia/Bangkok',
          ...config,
          ...Object.fromEntries(metaFlagNames.map((name) => [name, 'true'])),
          META_DEMO_MODE: demoMode ? 'true' : 'false',
        },
      }),
    );
  live = runtime(false);
  demo = runtime(true);
  const sql = readdirSync('drizzle/migrations')
    .sort()
    .map((file) => readFileSync('drizzle/migrations/' + file, 'utf8'))
    .join('\n')
    .replace(/^--.*$/gm, '')
    .replace(/\n/g, ' ');
  for (const runtime of [live, demo])
    await (await runtime.getD1Database('DB')).exec(sql);
  const db = await live.getD1Database('DB');
  for (const [email, token] of [
    ['admin@example.test', 'meta-admin-session'],
    ['staff@example.test', 'meta-staff-session'],
  ]) {
    await db
      .prepare(
        "INSERT INTO auth_users(email,password_salt,password_hash,password_iterations,created_at,updated_at) VALUES(?,'test','test',100000,'','')",
      )
      .bind(email)
      .run();
    await db
      .prepare(
        'INSERT INTO auth_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)',
      )
      .bind(
        await digest(token),
        email,
        new Date().toISOString(),
        '2099-01-01T00:00:00Z',
        new Date().toISOString(),
      )
      .run();
  }
});
afterAll(async () => {
  await Promise.all([live?.dispose(), demo?.dispose()]);
});
const request = (
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = liveHeaders,
  runtime = live,
) =>
  runtime.dispatchFetch(
    (runtime === demo ? 'http://localhost' : 'https://crm.example.test') +
      '/api' +
      path,
    {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    },
  );
async function read<T>(
  response: Awaited<ReturnType<typeof request>>,
): Promise<T> {
  return (await response.json()) as T;
}
async function sign(value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  );
  return (
    'sha256=' +
    [...new Uint8Array(bytes)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}
async function webhook(mid: string, page = '100', sender = '10') {
  const body = JSON.stringify({
    object: 'page',
    entry: [
      {
        id: page,
        messaging: [
          {
            sender: { id: sender },
            recipient: { id: page },
            timestamp: Date.now(),
            message: { mid, text: 'Customer inquiry' },
          },
        ],
      },
    ],
  });
  return live.dispatchFetch('https://crm.example.test/api/webhooks/meta', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': await sign(body),
    },
    body,
  });
}
async function sendAutomationEvent(event: unknown) {
  const body = JSON.stringify({
    object: 'page',
    entry: [{ id: '100', messaging: [event] }],
  });
  return live.dispatchFetch('https://crm.example.test/api/webhooks/meta', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': await sign(body),
    },
    body,
  });
}
async function waitFor(query: () => Promise<boolean>) {
  for (let i = 0; i < 50; i++) {
    if (await query()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Expected asynchronous job did not finish');
}
async function transition(
  id: string,
  revision: number,
  action: string,
  approvalToken?: string,
) {
  return request('/meta/drafts/' + id + '/transition', 'POST', {
    revision,
    action,
    approvedByHuman: true,
    confirmation: (action === 'PUBLISH' ? 'PUBLISH ' : 'APPROVE ') + id,
    ...(approvalToken ? { approvalToken } : {}),
  });
}
async function approvedCampaign(name: string) {
  const draft = await read<{ id: string; revision: number }>(
    await request('/meta/drafts', 'POST', {
      kind: 'CAMPAIGN',
      payload: { name, objective: 'OUTCOME_LEADS', special_ad_categories: [] },
    }),
  );
  expect((await transition(draft.id, 1, 'VALIDATE')).status).toBe(200);
  expect((await transition(draft.id, 1, 'REVIEW')).status).toBe(200);
  const approval = await read<{ approvalToken: string }>(
    await transition(draft.id, 1, 'CONFIRM'),
  );
  return { ...draft, approvalToken: approval.approvalToken };
}
describe('Meta policy and metrics', () => {
  it('does not fabricate metrics from missing values or divide by zero', () => {
    expect(adsMetrics([])).toMatchObject({
      spend: null,
      clicks: null,
      leads: null,
      cpc: null,
    });
    expect(
      adsMetrics([
        {
          spend: '100',
          impressions: '0',
          clicks: '0',
          actions: [{ action_type: 'lead', value: '0' }],
        },
      ]),
    ).toMatchObject({
      spend: 100,
      ctr: null,
      cpc: null,
      costPerLead: null,
      leads: 0,
    });
    expect(
      adsMetrics([
        {
          spend: '100',
          impressions: '1000',
          clicks: '50',
          actions: [
            { action_type: 'lead', value: '5' },
            { action_type: 'onsite_conversion.lead_grouped', value: '5' },
          ],
        },
      ]),
    ).toMatchObject({ leads: 5, ctr: 5, cpc: 2, costPerLead: 20 });
    expect(adsMetrics([{ spend: '100' }, { clicks: '5' }]).spend).toBeNull();
  });
  it('validates real calendar dates, date range and the standard messaging window', () => {
    expect(() =>
      reportRange({ since: '2026-02-30', until: '2026-03-01' }),
    ).toThrow();
    expect(() =>
      reportRange({ since: '2020-01-01', until: '2020-12-31' }),
    ).toThrow();
    const now = Date.now();
    expect(
      messagingWindowOpen(new Date(now - 86_399_999).toISOString(), now),
    ).toBe(true);
    expect(
      messagingWindowOpen(new Date(now - 86_400_000).toISOString(), now),
    ).toBe(false);
    expect(messagingWindowOpen(new Date(now + 1).toISOString(), now)).toBe(
      false,
    );
  });
  it('verifies raw bytes and rejects malformed, oversized or cross-Page events', async () => {
    const body = new TextEncoder().encode('test');
    expect(await verifyMetaSignature(body, await sign('test'), secret)).toBe(
      true,
    );
    expect(await verifyMetaSignature(body, await sign('other'), secret)).toBe(
      false,
    );
    expect(await verifyMetaSignature(body, 'sha256=bad', secret)).toBe(false);
    expect(() =>
      normalizeMetaWebhook({
        object: 'page',
        entry: [{ id: '100', messaging: [{ sender: { id: '10' } }] }],
      }),
    ).toThrow();
    expect(
      normalizeMetaWebhook({
        object: 'page',
        entry: [
          {
            id: '100',
            messaging: [
              {
                sender: { id: '10' },
                recipient: { id: '999' },
                message: { mid: 'one', text: 'x' },
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });
});
describe('OAuth and live adapter with synthetic provider', () => {
  it('binds one-time OAuth state to the initiating CRM session before any provider access', async () => {
    const connect = await request('/integrations/meta/connect');
    expect(connect.status).toBe(302);
    const url = new URL(connect.headers.get('Location')!);
    expect(url.hostname).toBe('www.facebook.com');
    expect(url.searchParams.get('config_id')).toBe('456');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('override_default_response_type')).toBe('true');
    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.href).not.toContain(secret);
    const state = url.searchParams.get('state')!,
      before = reads;
    expect(
      (await request('/integrations/meta/callback?state=wrong&code=test'))
        .status,
    ).toBe(403);
    expect(
      (
        await request(
          '/integrations/meta/callback?state=' + state + '&code=test',
          'GET',
          undefined,
          staffHeaders,
        )
      ).status,
    ).toBe(403);
    expect(reads).toBe(before);
    const callback = await request(
      '/integrations/meta/callback?state=' + state + '&code=test',
    );
    expect(
      callback.status,
      JSON.stringify({
        paths: providerPaths,
        response: callback.status !== 303 ? await callback.text() : '',
      }),
    ).toBe(303);
    const calls = reads;
    expect(
      (
        await request(
          '/integrations/meta/callback?state=' + state + '&code=test',
        )
      ).status,
    ).toBe(403);
    expect(reads).toBe(calls);
    const pages = await read<{ pages: { id: string }[] }>(
      await request('/integrations/meta/pages'),
    );
    expect(pages.pages[0].id).toBe('100');
    expect(JSON.stringify(pages)).not.toContain('synthetic-page-token');
    expect(
      (
        await request('/integrations/meta/assets', 'POST', {
          pageId: '100',
          accountId: 'act_200',
        })
      ).status,
    ).toBe(200);
    const status = await read<MetaStatus>(
      await request('/integrations/meta/status'),
    );
    expect(status).toMatchObject({
      state: 'CONNECTED',
      tokenHealth: 'VALID',
      page: { id: '100' },
      adAccount: { id: 'act_200' },
    });
    const db = await live.getD1Database('DB');
    const encrypted = await db
      .prepare('SELECT ciphertext,nonce FROM meta_token_secrets')
      .all();
    expect(encrypted.results).toHaveLength(2);
    expect(JSON.stringify(encrypted)).not.toContain('synthetic-page-token');
    expect(
      (await request('/integrations/meta/assets', 'POST', { pageId: '999' }))
        .status,
    ).toBe(404);
  });
  it('receives signed messages durably, deduplicates and scopes Page sender identities', async () => {
    expect(
      (
        await live.dispatchFetch(
          'https://crm.example.test/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=synthetic-verify&hub.challenge=123',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await live.dispatchFetch(
          'https://crm.example.test/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await live.dispatchFetch('https://crm.example.test/api/webhooks/meta', {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect((await webhook('incoming-one')).status).toBe(200);
    const db = await live.getD1Database('DB');
    await waitFor(async () =>
      Boolean(
        await db
          .prepare(
            "SELECT id FROM meta_messages WHERE provider_message_id='incoming-one'",
          )
          .first(),
      ),
    );
    expect((await webhook('incoming-one')).status).toBe(200);
    await webhook('outside-page', '999', '10');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const rows = await db
      .prepare("SELECT * FROM meta_conversations WHERE mode='LIVE'")
      .all();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].unread_count).toBe(1);
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM meta_messages WHERE provider_message_id='incoming-one'",
        )
        .first(),
    ).toEqual({ n: 1 });
  });
  it('enforces 24 hours, explicit human action and send idempotency without duplicate provider writes', async () => {
    const db = await live.getD1Database('DB'),
      conversation = await db
        .prepare("SELECT id FROM meta_conversations WHERE mode='LIVE'")
        .first<{ id: string }>(),
      id = conversation!.id;
    const input = {
      text: 'Reviewed response',
      clientRequestId: crypto.randomUUID(),
      approvedByHuman: true,
    };
    await db
      .prepare('UPDATE meta_conversations SET last_incoming_at=? WHERE id=?')
      .bind(new Date(Date.now() - 25 * 3600_000).toISOString(), id)
      .run();
    const before = writes;
    expect(
      (await request('/meta/conversations/' + id + '/messages', 'POST', input))
        .status,
    ).toBe(409);
    expect(writes).toBe(before);
    await db
      .prepare('UPDATE meta_conversations SET last_incoming_at=? WHERE id=?')
      .bind(new Date().toISOString(), id)
      .run();
    expect(
      (
        await request('/meta/conversations/' + id + '/messages', 'POST', {
          ...input,
          approvedByHuman: false,
        })
      ).status,
    ).toBe(422);
    expect(
      (await request('/meta/conversations/' + id + '/messages', 'POST', input))
        .status,
    ).toBe(201);
    expect(
      (await request('/meta/conversations/' + id + '/messages', 'POST', input))
        .status,
    ).toBe(200);
    expect(writes).toBe(before + 1);
    expect(
      (
        await request('/meta/conversations/' + id + '/messages', 'POST', {
          ...input,
          text: 'Changed message',
        })
      ).status,
    ).toBe(409);
    await db
      .prepare(
        "UPDATE meta_token_metadata SET expires_at='2020-01-01' WHERE token_type='PAGE'",
      )
      .run();
    expect(
      (
        await request('/meta/conversations/' + id + '/messages', 'POST', {
          ...input,
          clientRequestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(403);
    await db
      .prepare(
        "UPDATE meta_token_metadata SET expires_at=? WHERE token_type='PAGE'",
      )
      .bind(new Date(Date.now() + 86400000).toISOString())
      .run();
  });
  it('links by Page-scoped identity and converts once into the existing customer/lead/follow-up models', async () => {
    const db = await live.getD1Database('DB'),
      conversation = await db
        .prepare("SELECT id FROM meta_conversations WHERE mode='LIVE'")
        .first<{ id: string }>(),
      id = conversation!.id;
    const customer = await read<{ id: string }>(
      await request('/customers', 'POST', { name: 'Known customer' }),
    );
    expect(
      (
        await request('/meta/conversations/' + id + '/customer', 'POST', {
          customerId: customer.id,
        })
      ).status,
    ).toBe(200);
    const input = {
      customerId: customer.id,
      title: 'Reviewed inquiry',
      assignedTo: 'staff@example.test',
      nextFollowUpAt: new Date(Date.now() + 86400000).toISOString(),
    };
    const first = await read<{ id: string }>(
      await request('/meta/conversations/' + id + '/lead', 'POST', input),
    );
    const repeat = await read<{ id: string }>(
      await request('/meta/conversations/' + id + '/lead', 'POST', input),
    );
    expect(first.id).toBe(repeat.id);
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM leads WHERE id=?')
        .bind(first.id)
        .first(),
    ).toEqual({ n: 1 });
    expect(
      await db
        .prepare('SELECT assigned_to,next_follow_up_at FROM leads WHERE id=?')
        .bind(first.id)
        .first(),
    ).toMatchObject({
      assigned_to: 'staff@example.test',
      next_follow_up_at: input.nextFollowUpAt,
    });
    expect(
      await db
        .prepare(
          'SELECT page_id,provider_user_id,customer_id FROM meta_customer_identities',
        )
        .first(),
    ).toEqual({
      page_id: '100',
      provider_user_id: '10',
      customer_id: customer.id,
    });
    const other = await read<{ id: string }>(
      await request('/customers', 'POST', { name: 'Another customer' }),
    );
    expect(
      (
        await request('/meta/conversations/' + id + '/customer', 'POST', {
          customerId: other.id,
        })
      ).status,
    ).toBe(409);
  });
  it('creates and links a customer once from a chat and exposes the sales round trip', async () => {
    const db = await live.getD1Database('DB');
    const now = new Date().toISOString();
    const id = 'sales-flow-conversation';
    await db
      .prepare(
        "INSERT INTO meta_conversations(id,mode,page_id,sender_id,display_name,last_message_at,created_at,updated_at,assigned_to) VALUES(?,'LIVE','100','sales-flow-visitor','Sales visitor',?,?,?,'staff@example.test')",
      )
      .bind(id, now, now, now)
      .run();
    const path = '/meta/conversations/' + id;
    const created = await request(path + '/customer/new', 'POST', {
      name: 'Chat customer',
      phone: '0812345678',
    });
    expect(created.status).toBe(201);
    const customer = await read<{ id: string }>(created);
    const replay = await read<{ id: string }>(
      await request(path + '/customer/new', 'POST', {
        name: 'Do not overwrite',
        phone: '',
      }),
    );
    expect(replay.id).toBe(customer.id);
    expect(
      await db
        .prepare('SELECT name,phone FROM customers WHERE id=?')
        .bind(customer.id)
        .first(),
    ).toEqual({ name: 'Chat customer', phone: '0812345678' });
    const viewingAt = new Date(Date.now() + 86400000).toISOString();
    const converted = await request(path + '/lead', 'POST', {
      customerId: customer.id,
      title: 'Home gym',
      estimatedValue: 45000,
      assignedTo: 'staff@example.test',
      viewingAt,
    });
    expect(converted.status).toBe(201);
    const lead = await read<{ id: string }>(converted);
    let detail = await read<{
      lead: {
        id: string;
        status: string;
        estimated_value: number;
        viewing_at: string;
        next_follow_up_at: string;
      };
    }>(await request(path));
    expect(detail.lead).toMatchObject({
      id: lead.id,
      status: 'NEW',
      estimated_value: 45000,
      viewing_at: viewingAt,
      next_follow_up_at: viewingAt,
    });
    expect(
      (await request('/leads/' + lead.id, 'PATCH', { status: 'QUOTED' }))
        .status,
    ).toBe(200);
    detail = await read<typeof detail>(await request(path));
    expect(detail.lead.status).toBe('QUOTED');
    const sales = await read<{
      messenger: { conversationId: string };
      lead: { viewingAt: string };
    }>(await request('/leads/' + lead.id));
    expect(sales.messenger.conversationId).toBe(id);
    expect(sales.lead.viewingAt).toBe(viewingAt);
    expect(
      (await request('/leads/' + lead.id, 'PATCH', { status: 'WON' })).status,
    ).toBe(422);
    expect(
      (
        await request('/meta/conversations/' + id + '/customer', 'POST', {
          customerId: 'does-not-exist',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request('/meta/conversations/' + id + '/customer/new', 'POST', {
          name: '',
        })
      ).status,
    ).toBe(422);
  });
  it('maps authorized form fields and imports each Lead Ad only once', async () => {
    expect(
      (
        await request('/meta/leads/mappings', 'POST', {
          formId: '999',
          fields: { full_name: 'name' },
          assignedTo: 'staff@example.test',
          enabled: true,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/meta/leads/mappings', 'POST', {
          formId: '300',
          fields: { full_name: 'name', email: 'email', budget: 'budget' },
          assignedTo: 'staff@example.test',
          enabled: true,
        })
      ).status,
    ).toBe(200);
    const db = await live.getD1Database('DB'),
      before = await db
        .prepare('SELECT COUNT(*) AS n FROM leads')
        .first<{ n: number }>();
    expect(
      (await request('/meta/leads/sync', 'POST', { formId: '300' })).status,
    ).toBe(202);
    await waitFor(async () =>
      Boolean(
        await db
          .prepare(
            "SELECT id FROM meta_lead_sync_events WHERE provider_lead_id='400' AND status='SYNCED'",
          )
          .first(),
      ),
    );
    await request('/meta/leads/sync', 'POST', { formId: '300' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await db.prepare('SELECT COUNT(*) AS n FROM leads').first()).toEqual(
      { n: before!.n + 1 },
    );
    expect(
      await db
        .prepare(
          "SELECT name,email,budget FROM customers WHERE name='Authorized lead'",
        )
        .first(),
    ).toEqual({
      name: 'Authorized lead',
      email: 'lead@example.test',
      budget: 15000,
    });
  });
  it('caches scoped reports and preserves currency/timezone and honest missing metrics', async () => {
    const first = await read<{
      metrics: { spend: number; leads: number };
      currency: string;
      timezone: string;
    }>(await request('/meta/ads/insights'));
    const calls = reads;
    const repeat = await request('/meta/ads/insights');
    expect(repeat.status).toBe(200);
    expect(reads).toBe(calls);
    expect(first).toMatchObject({
      metrics: { spend: 100, leads: 5 },
      currency: 'THB',
      timezone: 'Asia/Bangkok',
    });
  });
  it('requires flags, admin permission and the full revision-specific approval flow, then publishes once PAUSED', async () => {
    expect(
      (
        await request(
          '/meta/drafts',
          'POST',
          {
            kind: 'CAMPAIGN',
            payload: { name: 'Unauthorized', objective: 'OUTCOME_LEADS' },
          },
          staffHeaders,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/meta/drafts', 'POST', {
          kind: 'CAMPAIGN',
          payload: {
            name: 'Budget injection',
            objective: 'OUTCOME_LEADS',
            daily_budget: 99999,
          },
        })
      ).status,
    ).toBe(422);
    const draft = await approvedCampaign('Reviewed campaign');
    expect((await transition(draft.id, 1, 'PUBLISH')).status).toBe(409);
    expect(
      (
        await request('/meta/drafts/' + draft.id, 'PATCH', {
          revision: 1,
          draft: {
            kind: 'CAMPAIGN',
            payload: { name: 'Changed campaign', objective: 'OUTCOME_LEADS' },
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (await transition(draft.id, 1, 'PUBLISH', draft.approvalToken)).status,
    ).toBe(409);
    await transition(draft.id, 2, 'VALIDATE');
    await transition(draft.id, 2, 'REVIEW');
    const approval = await read<{ approvalToken: string }>(
      await transition(draft.id, 2, 'CONFIRM'),
    );
    const before = campaignWrites;
    const results = await Promise.all([
      transition(draft.id, 2, 'PUBLISH', approval.approvalToken),
      transition(draft.id, 2, 'PUBLISH', approval.approvalToken),
    ]);
    expect(results.some((v) => v.status === 200)).toBe(true);
    expect(campaignWrites).toBe(before + 1);
    expect(lastCampaign.status).toBe('PAUSED');
    expect(lastCampaign).not.toHaveProperty('daily_budget');
    expect(
      (await transition(draft.id, 2, 'PUBLISH', approval.approvalToken)).status,
    ).toBe(200);
    expect(campaignWrites).toBe(before + 1);
  });
  it('never retries an ambiguous publication outcome automatically', async () => {
    const draft = await approvedCampaign('Ambiguous campaign'),
      before = campaignWrites;
    failCampaign = true;
    try {
      expect(
        (await transition(draft.id, 1, 'PUBLISH', draft.approvalToken)).status,
      ).toBe(502);
      const db = await live.getD1Database('DB');
      expect(
        await db
          .prepare('SELECT status FROM meta_drafts WHERE id=?')
          .bind(draft.id)
          .first(),
      ).toEqual({ status: 'UNKNOWN' });
      expect(
        (await transition(draft.id, 1, 'PUBLISH', draft.approvalToken)).status,
      ).toBe(409);
      expect(campaignWrites).toBe(before + 1);
    } finally {
      failCampaign = false;
    }
  });
  it('rejects cross-site mutations, excludes secrets and keeps private message bodies out of audits', async () => {
    expect(
      (
        await request(
          '/meta/drafts',
          'POST',
          {
            kind: 'CAMPAIGN',
            payload: { name: 'Cross-site', objective: 'OUTCOME_LEADS' },
          },
          { ...liveHeaders, Origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    const logs = await read<unknown>(await request('/integrations/meta/logs'));
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('synthetic-page-token');
    expect(serialized).not.toContain('Reviewed response');
    expect(
      (await request('/integrations/meta/logs', 'GET', undefined, staffHeaders))
        .status,
    ).toBe(403);
  });
});
describe('Complete Demo isolation and human-reviewed AI', () => {
  const demoRequest = (path: string, method = 'GET', body?: unknown) =>
    request(path, method, body, {}, demo);
  it('supports simulated incoming events, replies, leads and reports without network or real CRM writes', async () => {
    expect(
      (
        await demoRequest('/meta/demo/events', 'POST', {
          kind: 'MESSAGE',
          text: 'Demo inquiry',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await demoRequest(
          '/meta/conversations/demo:conversation/messages',
          'POST',
          {
            text: 'Simulated response',
            clientRequestId: crypto.randomUUID(),
            approvedByHuman: true,
          },
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await demoRequest(
          '/meta/conversations/demo:conversation/lead',
          'POST',
          {
            customerId: 'real-customer-must-not-be-touched',
            title: 'Demo lead',
          },
        )
      ).status,
    ).toBe(201);
    const report = await read<{ mode: string; data: unknown[] }>(
      await demoRequest('/meta/ads/insights'),
    );
    expect(report.mode).toBe('DEMO');
    expect(report.data.length).toBeGreaterThan(0);
    const db = await demo.getD1Database('DB');
    expect(
      await db.prepare('SELECT COUNT(*) AS n FROM customers').first(),
    ).toEqual({ n: 0 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM leads').first()).toEqual(
      { n: 0 },
    );
    expect(demoEgress).toBe(0);
  });
  it('returns grounded per-campaign metrics, target assessment and actionable advice without ad writes', async () => {
    const writesBefore = writes;
    const response = await demoRequest('/meta/ai/analyze-campaign', 'POST', {
      since: '2026-10-01',
      until: '2026-10-07',
      language: 'th',
      targetCostPerLead: 270,
    });
    expect(response.status).toBe(201);
    const draft = await read<import('../src/meta').AiDraftResponse>(response);
    expect(draft.simulated).toBe(true);
    expect(draft.content.reportScope).toMatchObject({
      since: '2026-10-01',
      until: '2026-10-07',
      targetCostPerLead: 270,
      currency: 'THB',
      hasMore: false,
    });
    expect(draft.content.comparison).toHaveLength(2);
    expect(draft.content.comparison?.[0]).toMatchObject({
      campaignId: 'demo:campaign-1',
      spend: 4820,
      leads: 18,
      assessment: 'ON_TARGET',
    });
    expect(draft.content.comparison?.[1].assessment).toBe('ABOVE_TARGET');
    expect(draft.content.recommendations?.map((v) => v.campaignId)).toEqual(
      draft.content.comparison?.map((v) => v.campaignId),
    );
    expect(
      draft.content.recommendations?.every((v) =>
        v.improvements?.every((item) => item.action && item.measure),
      ),
    ).toBe(true);
    const withoutTarget = await read<import('../src/meta').AiDraftResponse>(
      await demoRequest('/meta/ai/analyze-campaign', 'POST', {
        language: 'en',
      }),
    );
    expect(
      withoutTarget.content.comparison?.every(
        (v) => v.assessment === 'NO_TARGET',
      ),
    ).toBe(true);
    expect(withoutTarget.content.recommendations?.[0].suggestion).toContain(
      'DEMO',
    );
    expect(writes).toBe(writesBefore);
    expect(demoEgress).toBe(0);
    for (const targetCostPerLead of [0, -1, '270']) {
      expect(
        (
          await demoRequest('/meta/ai/analyze-campaign', 'POST', {
            targetCostPerLead,
          })
        ).status,
      ).toBe(422);
    }
  });
  it('requires approval of the exact AI reply and keeps simulation out of the real AI provider', async () => {
    const draft = await read<{
      id: string;
      simulated: boolean;
      content: { text: string };
    }>(
      await demoRequest('/meta/ai/suggest-reply', 'POST', {
        conversationId: 'demo:conversation',
        language: 'th',
      }),
    );
    expect(draft.simulated).toBe(true);
    const message = {
      text: draft.content.text,
      clientRequestId: crypto.randomUUID(),
      approvedByHuman: true,
      aiDraftId: draft.id,
    };
    expect(
      (
        await demoRequest(
          '/meta/conversations/demo:conversation/messages',
          'POST',
          message,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await demoRequest('/meta/ai/drafts/' + draft.id + '/approve', 'POST', {
          text: draft.content.text,
          approvedByHuman: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await demoRequest(
          '/meta/conversations/demo:conversation/messages',
          'POST',
          { ...message, text: 'Changed after approval' },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await demoRequest(
          '/meta/conversations/demo:conversation/messages',
          'POST',
          message,
        )
      ).status,
    ).toBe(201);
    expect(demoEgress).toBe(0);
  });
  it('simulates Page connection and disconnection without touching live assets', async () => {
    expect(
      (await demoRequest('/meta/demo/connection', 'POST', { connected: false }))
        .status,
    ).toBe(200);
    expect(
      await read<MetaStatus>(await demoRequest('/integrations/meta/status')),
    ).toMatchObject({
      mode: 'DEMO',
      state: 'DISCONNECTED',
      capabilities: { sendMessage: false },
    });
    expect(
      (await demoRequest('/meta/demo/connection', 'POST', { connected: true }))
        .status,
    ).toBe(200);
    expect(
      await read<MetaStatus>(await demoRequest('/integrations/meta/status')),
    ).toMatchObject({ mode: 'DEMO', state: 'CONNECTED' });
    expect(demoEgress).toBe(0);
  });
});

describe('Meta release hardening', () => {
  it('blocks redirects without following provider-controlled URLs or leaking credentials', async () => {
    let calls = 0;
    const http: typeof fetch = async (_url, init) => {
      calls++;
      expect(init?.redirect).toBe('manual');
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://untrusted.example/collect' },
      });
    };
    await expect(
      new MetaGraphClient(config, 'synthetic-token', http).request('me'),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it('keeps missing AI configuration harmless without attempting external calls', async () => {
    let calls = 0;
    const env = {
      AI_BASE_URL: '',
      AI_MODEL: '',
      AI_API_KEY: '',
    } as ConstructorParameters<typeof WorkerMetaAIProvider>[0];
    await expect(
      new WorkerMetaAIProvider(env, async () => {
        calls++;
        return Response.json({});
      }).analyze('REPLY', {}, 'th'),
    ).rejects.toThrow('not configured');
    expect(calls).toBe(0);
  });
  it('applies a delivery receipt only to its explicit message IDs and never downgrades READ', async () => {
    const db = await live.getD1Database('DB');
    const conversation = await db
      .prepare(
        "SELECT id FROM meta_conversations WHERE mode='LIVE' AND page_id='100' AND sender_id='10'",
      )
      .first<{ id: string }>();
    for (const [id, status] of [
      ['receipt-a', 'SENT'],
      ['receipt-b', 'SENT'],
      ['receipt-c', 'READ'],
    ])
      await db
        .prepare(
          "INSERT INTO meta_messages(id,conversation_id,provider_message_id,direction,body,status,created_at) VALUES(?,?,?,'OUTBOUND','Receipt test',?,?)",
        )
        .bind(
          id,
          conversation!.id,
          id,
          status,
          new Date(Date.now() - 1000).toISOString(),
        )
        .run();
    const body = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: '100',
          messaging: [
            {
              sender: { id: '10' },
              recipient: { id: '100' },
              delivery: { mids: ['receipt-a', 'receipt-c'] },
            },
          ],
        },
      ],
    });
    expect(
      (
        await live.dispatchFetch('https://crm.example.test/api/webhooks/meta', {
          method: 'POST',
          headers: { 'X-Hub-Signature-256': await sign(body) },
          body,
        })
      ).status,
    ).toBe(200);
    await waitFor(async () =>
      Boolean(
        await db
          .prepare(
            "SELECT id FROM meta_messages WHERE id='receipt-a' AND status='DELIVERED'",
          )
          .first(),
      ),
    );
    expect(
      (
        await db
          .prepare(
            "SELECT id,status FROM meta_messages WHERE id LIKE 'receipt-%' ORDER BY id",
          )
          .all()
      ).results,
    ).toEqual([
      { id: 'receipt-a', status: 'DELIVERED' },
      { id: 'receipt-b', status: 'SENT' },
      { id: 'receipt-c', status: 'READ' },
    ]);
    expect(
      await db
        .prepare(
          "SELECT * FROM meta_receipt_watermarks WHERE page_id='100' AND sender_id='10'",
        )
        .first(),
    ).toBeNull();
  });
  it('preserves READ when the read receipt arrives before the outgoing echo', async () => {
    const db = await live.getD1Database('DB');
    const conversation = await db
      .prepare(
        "SELECT id FROM meta_conversations WHERE mode='LIVE' AND sender_id='10'",
      )
      .first<{ id: string }>();
    const now = Date.now(),
      id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO meta_messages(id,conversation_id,direction,body,status,created_at) VALUES(?,?,'OUTBOUND','Pending echo','PENDING',?)",
      )
      .bind(id, conversation!.id, new Date(now - 2000).toISOString())
      .run();
    const submit = async (event: unknown) => {
      const body = JSON.stringify({
        object: 'page',
        entry: [{ id: '100', messaging: [event] }],
      });
      return live.dispatchFetch('https://crm.example.test/api/webhooks/meta', {
        method: 'POST',
        headers: { 'X-Hub-Signature-256': await sign(body) },
        body,
      });
    };
    await submit({
      sender: { id: '10' },
      recipient: { id: '100' },
      read: { watermark: now },
    });
    await waitFor(async () =>
      Boolean(
        await db
          .prepare("SELECT id FROM meta_messages WHERE id=? AND status='READ'")
          .bind(id)
          .first(),
      ),
    );
    await submit({
      sender: { id: '100' },
      recipient: { id: '10' },
      timestamp: now - 1000,
      message: {
        mid: 'out-of-order-echo',
        text: 'Pending echo',
        is_echo: true,
        metadata: id,
      },
    });
    await waitFor(async () =>
      Boolean(
        await db
          .prepare(
            "SELECT id FROM meta_messages WHERE provider_message_id='out-of-order-echo' AND status='READ'",
          )
          .first(),
      ),
    );
    expect(
      (
        await db
          .prepare(
            "SELECT id FROM meta_messages WHERE provider_message_id='out-of-order-echo'",
          )
          .all()
      ).results,
    ).toHaveLength(1);
  });
  it('removes expired Ads token capabilities independently of a healthy Page token', async () => {
    const db = await live.getD1Database('DB');
    await db
      .prepare(
        "UPDATE meta_token_metadata SET expires_at='2000-01-01T00:00:00Z' WHERE token_type='USER'",
      )
      .run();
    const status = await read<MetaStatus>(
      await request('/integrations/meta/status'),
    );
    expect(status.capabilities.readAds).toBe(false);
    expect(status.capabilities.writeAds).toBe(false);
    expect(status.capabilities.readMessenger).toBe(true);
    expect((await request('/meta/ads/insights')).status).toBe(403);
    await db
      .prepare(
        "UPDATE meta_token_metadata SET expires_at='2099-01-01T00:00:00Z' WHERE token_type='USER'",
      )
      .run();
    await db
      .prepare(
        "UPDATE meta_permissions SET status='DECLINED' WHERE permission='ads_management'",
      )
      .run();
    expect(
      (await read<MetaStatus>(await request('/integrations/meta/status')))
        .capabilities.writeAds,
    ).toBe(false);
    await db
      .prepare(
        "UPDATE meta_permissions SET status='GRANTED' WHERE permission='ads_management'",
      )
      .run();
  });
  it('shares only public inventory and rejects AI replies whose approved inventory changed', async () => {
    const db = await demo.getD1Database('DB'),
      now = new Date().toISOString();
    await db
      .prepare(
        "INSERT INTO products(id,sku,brand,model,purchase_cost,selling_price,notes,serial_number,is_published,show_price,public_slug,created_at,updated_at) VALUES('share-test','share-test','Test Brand','Public Model',123,500,'private margin note','private-serial',1,0,'safe-product',?,?)",
      )
      .bind(now, now)
      .run();
    await db
      .prepare(
        "INSERT INTO products(id,sku,brand,model,created_at,updated_at) VALUES('unpublished-test','private-test','Private Brand','Hidden Model',?,?)",
      )
      .bind(now, now)
      .run();
    const call = (path: string, body?: unknown) =>
      request(path, body ? 'POST' : 'GET', body, {}, demo);
    const products = await read<{ products: { id: string; price: null }[] }>(
      await call('/meta/products'),
    );
    expect(products.products).toHaveLength(1);
    expect(products.products[0].price).toBeNull();
    expect(JSON.stringify(products)).not.toMatch(
      /purchase_cost|private margin|private-serial|Hidden Model/,
    );
    const photo = new Uint8Array([137, 80, 78, 71]);
    await (
      await demo.getR2Bucket('PRODUCT_IMAGES')
    ).put('share-preview.png', photo);
    await db
      .prepare(
        "INSERT INTO product_images(id,product_id,r2_key,file_name,mime_type,file_size,sort_order,is_primary,created_at) VALUES('share-photo','share-test','share-preview.png','preview.png','image/png',4,0,1,?)",
      )
      .bind(now)
      .run();
    const preview = await call('/meta/products/share-test/thumbnail');
    expect(preview.status).toBe(200);
    expect(preview.headers.get('Content-Type')).toBe('image/png');
    expect(preview.headers.get('Cache-Control')).toContain('private');
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(photo);
    expect(
      (await call('/meta/products/unpublished-test/thumbnail')).status,
    ).toBe(404);
    expect(
      (
        await request(
          '/meta/products/share-test/thumbnail',
          'GET',
          undefined,
          {},
        )
      ).status,
    ).toBe(401);
    await db
      .prepare("UPDATE products SET archived_at=? WHERE id='share-test'")
      .bind(now)
      .run();
    expect((await call('/meta/products/share-test/thumbnail')).status).toBe(
      404,
    );
    await db
      .prepare("UPDATE products SET archived_at=NULL WHERE id='share-test'")
      .run();
    const draft = await read<{ id: string; content: { text: string } }>(
      await call('/meta/ai/suggest-reply', {
        conversationId: 'demo:conversation',
        language: 'en',
      }),
    );
    expect(
      (
        await call('/meta/ai/drafts/' + draft.id + '/approve', {
          text: draft.content.text,
          approvedByHuman: true,
        })
      ).status,
    ).toBe(200);
    await db
      .prepare(
        "UPDATE products SET status='NOT_AVAILABLE' WHERE id='share-test'",
      )
      .run();
    expect(
      (
        await call('/meta/conversations/demo:conversation/messages', {
          text: draft.content.text,
          aiDraftId: draft.id,
          clientRequestId: crypto.randomUUID(),
          approvedByHuman: true,
        })
      ).status,
    ).toBe(409);
    expect(demoEgress).toBe(0);
  });
  it('publishes Page content only after the same explicit approval chain and blocks cross-Page insights', async () => {
    const draft = await read<{ id: string }>(
      await request('/meta/drafts', 'POST', {
        kind: 'POST',
        payload: { message: 'Reviewed test post' },
      }),
    );
    expect((await transition(draft.id, 1, 'PUBLISH')).status).toBe(409);
    await transition(draft.id, 1, 'VALIDATE');
    await transition(draft.id, 1, 'REVIEW');
    const approval = await read<{ approvalToken: string }>(
      await transition(draft.id, 1, 'CONFIRM'),
    );
    expect(
      (await transition(draft.id, 1, 'PUBLISH', approval.approvalToken)).status,
    ).toBe(200);
    const before = reads;
    expect((await request('/meta/page/posts/999_600/insights')).status).toBe(
      403,
    );
    expect(reads).toBe(before);
  });

  it('restricts automation configuration and requires an eligible LINE recipient', async () => {
    const db = await live.getD1Database('DB');
    for (const [email, id] of [
      ['admin@example.test', 'Uadmin'],
      ['staff@example.test', 'Ustaff'],
    ])
      await db
        .prepare(
          'INSERT INTO line_accounts(email,line_user_id,enabled,linked_at) VALUES(?,?,1,?)',
        )
        .bind(email, id, new Date().toISOString())
        .run();
    const settings = {
      ...messengerDefaults,
      enabled: true,
      defaultSalespersonEmail: 'admin@example.test',
      approvedByHuman: true,
    };
    expect(
      (
        await request(
          '/integrations/meta/messenger-automation',
          'GET',
          undefined,
          staffHeaders,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          '/integrations/meta/messenger-automation',
          'PUT',
          settings,
          staffHeaders,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/integrations/meta/messenger-automation', 'PUT', {
          ...settings,
          defaultSalespersonEmail: 'outside@example.test',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request('/integrations/meta/messenger-automation', 'PUT', {
          ...settings,
          contactLabel: 'x'.repeat(21),
        })
      ).status,
    ).toBe(422);
    const before = automaticMessages.length;
    await webhook('automation-disabled', '100', '901');
    await waitFor(
      async () =>
        !!(await db
          .prepare("SELECT id FROM meta_conversations WHERE sender_id='901'")
          .first()),
    );
    expect(automaticMessages.length).toBe(before);
    expect(
      (
        await request(
          '/integrations/meta/messenger-automation',
          'PUT',
          settings,
        )
      ).status,
    ).toBe(200);
  });
  it('welcomes once, preserves postbacks and routes a deduplicated alert to the assigned owner or fallback', async () => {
    const db = await live.getD1Database('DB');
    const postback = async (sender: string, payload: string) =>
      sendAutomationEvent({
        sender: { id: sender },
        recipient: { id: '100' },
        timestamp: Date.now(),
        postback: { mid: crypto.randomUUID(), title: 'Contact', payload },
      });
    const before = automaticMessages.length;
    await webhook('automation-welcome', '100', '902');
    await waitFor(
      async () =>
        !!(await db
          .prepare(
            "SELECT id FROM meta_messenger_automation_jobs WHERE conversation_id=? AND kind='WELCOME' AND status='SENT'",
          )
          .bind(await digest('LIVE:100:902'))
          .first()),
    );
    expect(
      JSON.parse(automaticMessages.at(-1)!.message).attachment.payload
        .buttons[0].payload,
    ).toBe(messengerActions.contact);
    await webhook('automation-welcome-again', '100', '902');
    await postback('902', messengerActions.start);
    await postback('902', messengerActions.contact);
    await waitFor(async () => linePushes.some((p) => p.to === 'Uadmin'));
    await postback('902', messengerActions.contact);
    await waitFor(
      async () =>
        !!(await db
          .prepare(
            "SELECT id FROM meta_messenger_automation_jobs WHERE conversation_id=? AND kind='CONTACT_ACK' AND status='SENT'",
          )
          .bind(await digest('LIVE:100:902'))
          .first()),
    );
    expect(automaticMessages.length - before).toBe(2);
    expect(linePushes.filter((p) => p.to === 'Uadmin')).toHaveLength(1);
    expect(linePushes.at(-1)!.text).toContain(
      '/meta/inbox?conversation=' + (await digest('LIVE:100:902')),
    );
    expect(linePushes.at(-1)!.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      await db
        .prepare('SELECT assigned_to FROM meta_conversations WHERE id=?')
        .bind(await digest('LIVE:100:902'))
        .first('assigned_to'),
    ).toBe('admin@example.test');
    await webhook('automation-owner', '100', '903');
    await waitFor(
      async () =>
        !!(await db
          .prepare("SELECT id FROM meta_conversations WHERE sender_id='903'")
          .first()),
    );
    await db
      .prepare(
        "UPDATE meta_conversations SET assigned_to='staff@example.test' WHERE sender_id='903'",
      )
      .run();
    await postback('903', messengerActions.contact);
    await waitFor(async () => linePushes.some((p) => p.to === 'Ustaff'));
    const count = linePushes.length;
    await db
      .prepare(
        "UPDATE line_accounts SET enabled=0 WHERE email='staff@example.test'",
      )
      .run();
    await webhook('automation-disconnected-owner', '100', '904');
    await waitFor(
      async () =>
        !!(await db
          .prepare("SELECT id FROM meta_conversations WHERE sender_id='904'")
          .first()),
    );
    await db
      .prepare(
        "UPDATE meta_conversations SET assigned_to='staff@example.test' WHERE sender_id='904'",
      )
      .run();
    await postback('904', messengerActions.contact);
    await waitFor(
      async () =>
        !!(await db
          .prepare(
            "SELECT id FROM meta_messenger_automation_jobs WHERE conversation_id=? AND error_code='LINE_RECIPIENT_UNAVAILABLE'",
          )
          .bind(await digest('LIVE:100:904'))
          .first()),
    );
    expect(linePushes.length).toBe(count);
  });
  it('retries LINE with the same key, but reconciles ambiguous Meta sends without retrying', async () => {
    const db = await live.getD1Database('DB');
    lineStatus = 429;
    await sendAutomationEvent({
      sender: { id: '905' },
      recipient: { id: '100' },
      timestamp: Date.now(),
      postback: { mid: 'contact-retry', payload: messengerActions.contact },
    });
    await waitFor(
      async () =>
        !!(await db
          .prepare(
            "SELECT id FROM meta_messenger_automation_jobs WHERE conversation_id=? AND kind='SALES_LINE' AND status='PENDING' AND attempts=1",
          )
          .bind(await digest('LIVE:100:905'))
          .first()),
    );
    const retryKey = linePushes.at(-1)!.key;
    await db
      .prepare(
        "UPDATE meta_messenger_automation_jobs SET next_attempt_at='2000-01-01' WHERE id=?",
      )
      .bind(retryKey)
      .run();
    lineStatus = 409;
    await sendAutomationEvent({
      sender: { id: '905' },
      recipient: { id: '100' },
      timestamp: Date.now(),
      postback: { mid: 'tick', payload: 'OTHER' },
    });
    await waitFor(
      async () =>
        (await db
          .prepare(
            'SELECT status FROM meta_messenger_automation_jobs WHERE id=?',
          )
          .bind(retryKey)
          .first('status')) === 'SENT',
    );
    expect(linePushes.at(-1)!.key).toBe(retryKey);
    lineStatus = 200;
    failMessenger = true;
    await webhook('automation-ambiguous', '100', '906');
    await waitFor(
      async () =>
        !!(await db
          .prepare(
            "SELECT id FROM meta_messenger_automation_jobs WHERE conversation_id=? AND kind='WELCOME' AND status='UNKNOWN'",
          )
          .bind(await digest('LIVE:100:906'))
          .first()),
    );
    failMessenger = false;
    const message = JSON.parse(automaticMessages.at(-1)!.message),
      count = automaticMessages.length;
    await sendAutomationEvent({
      sender: { id: '100' },
      recipient: { id: '906' },
      timestamp: Date.now(),
      message: {
        mid: 'echo-resolved',
        is_echo: true,
        text: 'Welcome',
        metadata: message.metadata,
      },
    });
    await waitFor(
      async () =>
        !!(await db
          .prepare(
            "SELECT id FROM meta_messenger_automation_jobs WHERE message_id=? AND status='SENT'",
          )
          .bind(message.metadata)
          .first()),
    );
    expect(automaticMessages.length).toBe(count);
  });
  it('ignores stale inbound messages and stops locally even when Meta profile cleanup fails', async () => {
    const db = await live.getD1Database('DB'),
      count = automaticMessages.length;
    await sendAutomationEvent({
      sender: { id: '907' },
      recipient: { id: '100' },
      timestamp: Date.now() - 25 * 3600_000,
      message: { mid: 'stale-automation', text: 'Old' },
    });
    await waitFor(
      async () =>
        !!(await db
          .prepare("SELECT id FROM meta_conversations WHERE sender_id='907'")
          .first()),
    );
    expect(automaticMessages.length).toBe(count);
    failProfile = true;
    const result = await request(
      '/integrations/meta/messenger-automation',
      'PUT',
      { ...messengerDefaults, approvedByHuman: true },
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      profileCleanupPending: true,
      settings: { enabled: false },
    });
    failProfile = false;
    expect(
      (
        await request('/integrations/meta/messenger-automation', 'PUT', {
          ...messengerDefaults,
          approvedByHuman: true,
        })
      ).status,
    ).toBe(200);
    expect(JSON.parse(profileFields)).toEqual(['get_started', 'greeting']);
    await webhook('automation-stopped', '100', '908');
    await waitFor(
      async () =>
        !!(await db
          .prepare("SELECT id FROM meta_conversations WHERE sender_id='908'")
          .first()),
    );
    expect(automaticMessages.length).toBe(count);
  });
  it('expires OAuth states before provider access and accepts signed deauthorization idempotently', async () => {
    const connect = await request('/integrations/meta/connect');
    const state = new URL(connect.headers.get('Location')!).searchParams.get(
      'state',
    )!;
    const db = await live.getD1Database('DB');
    await db
      .prepare('UPDATE meta_oauth_states SET expires_at=? WHERE state_hash=?')
      .bind('2000-01-01T00:00:00Z', await digest(state))
      .run();
    const before = reads;
    expect(
      (
        await request(
          '/integrations/meta/callback?state=' + state + '&code=test',
        )
      ).status,
    ).toBe(403);
    expect(reads).toBe(before);
    const callback =
      'https://crm.example.test/api/integrations/meta/deauthorize';
    expect(
      (
        await live.dispatchFetch(callback, {
          method: 'POST',
          body: 'signed_request=forged',
        })
      ).status,
    ).toBe(403);
    const payload = btoa(
      JSON.stringify({
        algorithm: 'HMAC-SHA256',
        user_id: '42',
        issued_at: Math.floor(Date.now() / 1000),
      }),
    )
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const hex = (await sign(payload)).slice(7);
    const sig = btoa(
      String.fromCharCode(...hex.match(/../g)!.map((v) => parseInt(v, 16))),
    )
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    for (let i = 0; i < 2; i++)
      expect(
        (
          await live.dispatchFetch(callback, {
            method: 'POST',
            body: new URLSearchParams({
              signed_request: sig + '.' + payload,
            }).toString(),
          })
        ).status,
      ).toBe(200);
    expect(
      (await db.prepare('SELECT token_id FROM meta_token_secrets').all())
        .results,
    ).toHaveLength(0);
    expect(
      (await read<MetaStatus>(await request('/integrations/meta/status')))
        .state,
    ).toBe('DISCONNECTED');
  });
});
