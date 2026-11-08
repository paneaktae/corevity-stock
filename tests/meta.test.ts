import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import {
  metaConfiguration,
  type MetaEnvironment,
} from '../worker/services/meta/config';
import { liveMetaState } from '../worker/services/meta/integration';
import {
  GraphAPIMetaProvider,
  MockMetaProvider,
} from '../worker/services/meta/provider';
import {
  encryptMetaToken,
  decryptMetaToken,
} from '../worker/services/meta/token-crypto';
import {
  metaFlagNames,
  metaSettingsInput,
  type MetaStatus,
} from '../shared/meta';
import { digest } from '../worker/auth';

// Synthetic test-only values. No provider is called and v1.0 asserts syntax only.
const complete: MetaEnvironment = {
  META_APP_ID: '123',
  META_APP_SECRET: 'synthetic-app-secret',
  META_WEBHOOK_VERIFY_TOKEN: 'synthetic-verify-token',
  META_GRAPH_API_VERSION: 'v1.0',
  META_OAUTH_REDIRECT_URL:
    'https://crm.example.test/api/integrations/meta/callback',
  META_TOKEN_ENCRYPTION_KEY: btoa(
    String.fromCharCode(...new Uint8Array(32).fill(7)),
  ),
  META_TOKEN_ENCRYPTION_KEY_VERSION: 'test-v1',
};
const identity = {
  connectionId: 'live-test',
  tokenId: 'token-test',
  tokenType: 'PAGE' as const,
  assetId: 'page-test',
};

describe('Meta config, health and provider isolation', () => {
  it('defaults every feature off with no credentials and distinguishes partial config', () => {
    const config = metaConfiguration({});
    expect(Object.values(config.flags).every((v) => v === false)).toBe(true);
    expect(liveMetaState(config, null)).toBe('NOT_CONFIGURED');
    expect(liveMetaState(metaConfiguration({ META_APP_ID: '123' }), null)).toBe(
      'CONFIGURATION_INCOMPLETE',
    );
    expect(liveMetaState(metaConfiguration(complete), null)).toBe(
      'READY_TO_CONNECT',
    );
  });
  it.each(['false', 'TRUE', '1', ' true ', '', 'yes'])(
    'fails closed on flag value %j',
    (value) => {
      expect(
        metaConfiguration({ META_ADS_WRITE_ENABLED: value }).flags
          .META_ADS_WRITE_ENABLED,
      ).toBe(false);
    },
  );
  it('validates version, callback and encryption config without leaking values', () => {
    const config = metaConfiguration({
      ...complete,
      META_APP_ID: 'private-invalid-value',
      META_GRAPH_API_VERSION: 'latest',
      META_TOKEN_ENCRYPTION_KEY: 'private-key',
      META_OAUTH_REDIRECT_URL: 'http://evil.example/callback',
    });
    expect(config.ready).toBe(false);
    expect(config.invalid).toEqual(
      expect.arrayContaining([
        'META_APP_ID',
        'META_GRAPH_API_VERSION',
        'META_TOKEN_ENCRYPTION_KEY',
        'META_OAUTH_REDIRECT_URL',
      ]),
    );
    expect(JSON.stringify(config)).not.toContain('private');
    expect(
      metaSettingsInput.safeParse({
        demoEnabled: true,
        META_APP_SECRET: 'injected',
      }).success,
    ).toBe(false);
  });
  it('gives revocation/expiry/permission problems priority over a saved CONNECTED state', () => {
    const config = metaConfiguration(complete);
    expect(
      liveMetaState(config, { status: 'CONNECTED', revokedAt: '2026-01-01' }),
    ).toBe('RECONNECT_REQUIRED');
    expect(
      liveMetaState(config, { status: 'CONNECTED', expiresAt: '2020-01-01' }),
    ).toBe('TOKEN_EXPIRED');
    expect(
      liveMetaState(config, {
        status: 'CONNECTED',
        dataAccessExpiresAt: 'invalid',
      }),
    ).toBe('TOKEN_EXPIRED');
    expect(
      liveMetaState(config, {
        status: 'CONNECTED',
        permissionStatus: 'MISSING',
      }),
    ).toBe('PERMISSION_REQUIRED');
    expect(
      liveMetaState(config, {
        status: 'CONNECTED',
        lastValidatedAt: new Date().toISOString(),
        hasSecret: true,
        permissionStatus: 'GRANTED',
      }),
    ).toBe('CONNECTED');
    for (const status of [
      'CONNECTING',
      'DISCONNECTED',
      'ERROR',
      'TOKEN_EXPIRED',
      'PERMISSION_REQUIRED',
      'RECONNECT_REQUIRED',
    ] as const)
      expect(liveMetaState(config, { status })).toBe(status);
  });
  it('mock and unimplemented live adapters make zero network requests', async () => {
    const http = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected network'));
    try {
      expect((await new MockMetaProvider().summary()).page.id).toBe(
        'demo:page',
      );
      await expect(new GraphAPIMetaProvider().summary()).rejects.toThrow(
        'META_NOT_CONFIGURED',
      );
      expect(http).not.toHaveBeenCalled();
    } finally {
      http.mockRestore();
    }
  });
});

describe('Meta token encryption', () => {
  it('uses random nonces and round-trips without plaintext in the envelope', async () => {
    const first = await encryptMetaToken(
      complete,
      identity,
      'synthetic-page-token',
    );
    const second = await encryptMetaToken(
      complete,
      identity,
      'synthetic-page-token',
    );
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toContain('synthetic-page-token');
    expect(await decryptMetaToken(complete, identity, first)).toBe(
      'synthetic-page-token',
    );
  });
  it('rejects swapped identity, tampering, wrong key and wrong key version', async () => {
    const encrypted = await encryptMetaToken(
      complete,
      identity,
      'synthetic-page-token',
    );
    await expect(
      decryptMetaToken(
        complete,
        { ...identity, assetId: 'other-page' },
        encrypted,
      ),
    ).rejects.toThrow('META_TOKEN_DECRYPTION_FAILED');
    await expect(
      decryptMetaToken(complete, identity, {
        ...encrypted,
        ciphertext: `${encrypted.ciphertext[0] === 'A' ? 'B' : 'A'}${encrypted.ciphertext.slice(1)}`,
      }),
    ).rejects.toThrow('META_TOKEN_DECRYPTION_FAILED');
    await expect(
      decryptMetaToken(
        {
          ...complete,
          META_TOKEN_ENCRYPTION_KEY: btoa(
            String.fromCharCode(...new Uint8Array(32).fill(8)),
          ),
        },
        identity,
        encrypted,
      ),
    ).rejects.toThrow('META_TOKEN_DECRYPTION_FAILED');
    await expect(
      decryptMetaToken(complete, identity, {
        ...encrypted,
        keyVersion: 'other-key',
      }),
    ).rejects.toThrow('META_ENCRYPTION_KEY_VERSION_MISMATCH');
  });
  it('cannot encrypt without valid configuration or with an empty token', async () => {
    await expect(encryptMetaToken({}, identity, 'synthetic')).rejects.toThrow(
      'META_ENCRYPTION_NOT_CONFIGURED',
    );
    await expect(encryptMetaToken(complete, identity, '')).rejects.toThrow(
      'META_TOKEN_INVALID',
    );
  });
});

let demo: Miniflare;
let unconfigured: Miniflare;
const migrationFiles = readdirSync('drizzle/migrations').sort();
const migrationSql = (files: string[]) =>
  files
    .map((file) => readFileSync(`drizzle/migrations/${file}`, 'utf8'))
    .join('\n')
    .replace(/^--.*$/gm, '')
    .replace(/\n/g, ' ');
const request = (
  runtime: Miniflare,
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  runtime.dispatchFetch(`http://localhost/api/integrations/meta${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const status = async (runtime = demo) =>
  (await (await request(runtime, '/status')).json()) as MetaStatus;

beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['worker/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:workers'],
    define: { 'import.meta.env.DEV': 'true' },
  });
  const runtime = (bindings: Record<string, string>) =>
    new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: '2026-10-09',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'meta-db', FRESH: 'fresh-db' },
        r2Buckets: ['PRODUCT_IMAGES'],
        durableObjects: {
          CHAT_ROOM: { className: 'ChatRoom', useSQLite: true },
        },
        serviceBindings: { ASSETS: async () => new Response('SPA') },
        bindings: {
          ENVIRONMENT: 'development',
          LOCAL_MOCK_EMAIL: 'admin@example.test',
          ALLOWED_EMAILS: 'admin@example.test,staff@example.test',
          AUTH_ADMIN_EMAIL: 'admin@example.test',
          ...bindings,
        },
      }),
    );
  demo = runtime({
    ...Object.fromEntries(Object.entries(complete)),
    ...Object.fromEntries(metaFlagNames.map((name) => [name, 'true'])),
  });
  unconfigured = runtime({});
  const db = await demo.getD1Database('DB');
  await db.exec(migrationSql(migrationFiles.filter((f) => f < '0030')));
  // A real existing customer must survive the new migration byte-for-byte.
  await db
    .prepare(
      `INSERT INTO customers(id,name,company_name,contact_name,phone,line_id,email,billing_address,budget,interested_in,notes,created_at,updated_at)
    VALUES('preserved','Existing customer','','','','','','',0,'','private original note','2026-01-01','2026-01-01')`,
    )
    .run();
  const before = await db
    .prepare("SELECT * FROM customers WHERE id='preserved'")
    .first();
  await db.exec(migrationSql(migrationFiles.filter((f) => f >= '0030')));
  expect(
    await db.prepare("SELECT * FROM customers WHERE id='preserved'").first(),
  ).toEqual(before);
  const fresh = await demo.getD1Database('FRESH');
  await fresh.exec(migrationSql(migrationFiles));
  await (
    await unconfigured.getD1Database('DB')
  ).exec(migrationSql(migrationFiles));
  for (const [email, token] of [
    ['staff@example.test', 'staff-session'],
    ['removed@example.test', 'removed-session'],
  ]) {
    await db
      .prepare(
        "INSERT INTO auth_users(email,password_salt,password_hash,password_iterations,created_at,updated_at) VALUES(?,'test-only-salt','test-only-hash',100000,'','')",
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
  await Promise.all([demo?.dispose(), unconfigured?.dispose()]);
});

describe('Meta foundation migrations and authenticated API', () => {
  it('installs the same Meta tables on fresh and upgraded databases without fixtures', async () => {
    for (const name of ['DB', 'FRESH']) {
      const db = await demo.getD1Database(name);
      const tables = await db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'meta_%'",
        )
        .all();
      expect(tables.results).toHaveLength(29);
      expect(
        await db.prepare('SELECT COUNT(*) AS n FROM meta_connections').first(),
      ).toEqual({ n: 0 });
    }
    expect(
      (
        await (
          await demo.getD1Database('DB')
        )
          .prepare("SELECT notes FROM customers WHERE id='preserved'")
          .first()
      )?.notes,
    ).toBe('private original note');
  });
  it('remains accessible without any Meta credentials or enabled integration', async () => {
    const result = await status(unconfigured);
    expect(result.state).toBe('NOT_CONFIGURED');
    expect(result.enabled).toBe(false);
    expect(result.configuration.ready).toBe(false);
    expect(result.capabilities.connect).toBe(false);
  });
  it('returns a clearly labeled mock Page and enables isolated mock capabilities with flags on', async () => {
    const result = await status();
    expect(result).toMatchObject({
      label: 'DEMO MODE',
      mode: 'DEMO',
      state: 'CONNECTED',
      tokenHealth: 'DEMO',
      implementation: 'ACTIVE',
    });
    expect(result.page?.id).toBe('demo:page');
    expect(result.capabilities).toEqual({
      manageIntegration: true,
      useDemo: true,
      connect: false,
      readMessenger: true,
      sendMessage: true,
      syncLeads: true,
      readAds: true,
      writeAds: true,
      useAI: true,
      publishContent: true,
      readPageInsights: true,
      readContent: true,
    });
    const encoded = JSON.stringify(result);
    for (const value of [
      complete.META_APP_SECRET!,
      complete.META_WEBHOOK_VERIFY_TOKEN!,
      complete.META_TOKEN_ENCRYPTION_KEY!,
    ])
      expect(encoded).not.toContain(value);
    const db = await demo.getD1Database('DB');
    expect(
      await db.prepare('SELECT COUNT(*) AS n FROM meta_connections').first(),
    ).toEqual({ n: 0 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM leads').first()).toEqual(
      { n: 0 },
    );
  });
  it('requires authentication and rejects removed users despite their valid session', async () => {
    const unauth = await demo.dispatchFetch(
      'https://crm.example.test/api/integrations/meta/status',
    );
    expect(unauth.status).toBe(401);
    expect(
      (
        await request(demo, '/status', 'GET', undefined, {
          Cookie: 'corevity_session=removed-session',
        })
      ).status,
    ).toBe(403);
  });
  it('allows staff status reads but denies settings, connection and logs', async () => {
    const headers = { Cookie: 'corevity_session=staff-session' };
    const result = await request(demo, '/status', 'GET', undefined, headers);
    expect(result.status).toBe(200);
    expect(
      ((await result.json()) as MetaStatus).capabilities.manageIntegration,
    ).toBe(false);
    expect(
      (
        await request(
          demo,
          '/settings',
          'PATCH',
          { demoEnabled: false },
          headers,
        )
      ).status,
    ).toBe(403);
    expect(
      (await request(demo, '/connect', 'GET', undefined, headers)).status,
    ).toBe(403);
    expect(
      (await request(demo, '/logs', 'GET', undefined, headers)).status,
    ).toBe(403);
  });
  it('rechecks invited-user membership on every request after deactivation', async () => {
    const db = await demo.getD1Database('DB');
    await db
      .prepare(
        "INSERT INTO workspace_users(email,is_active,created_by,created_at) VALUES('removed@example.test',1,'admin@example.test','')",
      )
      .run();
    const headers = { Cookie: 'corevity_session=removed-session' };
    expect(
      (await request(demo, '/status', 'GET', undefined, headers)).status,
    ).toBe(200);
    await db
      .prepare(
        "UPDATE workspace_users SET is_active=0 WHERE email='removed@example.test'",
      )
      .run();
    expect(
      (await request(demo, '/status', 'GET', undefined, headers)).status,
    ).toBe(403);
  });
  it('rejects cross-origin writes, unknown fields, oversized payloads and environment flag escalation', async () => {
    expect(
      (
        await request(
          demo,
          '/settings',
          'PATCH',
          { demoEnabled: false },
          { Origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(demo, '/settings', 'PATCH', {
          demoEnabled: true,
          appSecret: 'injected',
        })
      ).status,
    ).toBe(422);
    expect(
      (await request(demo, '/settings', 'PATCH', { extra: 'x'.repeat(3000) }))
        .status,
    ).toBe(413);
    expect(
      (await request(unconfigured, '/settings', 'PATCH', { demoEnabled: true }))
        .status,
    ).toBe(409);
  });
  it('persists a Demo preference with audit and never turns complete config into a verified live connection', async () => {
    const response = await request(demo, '/settings', 'PATCH', {
      demoEnabled: false,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: 'LIVE',
      state: 'READY_TO_CONNECT',
      tokenHealth: 'NOT_CONFIGURED',
    });
    expect((await status()).mode).toBe('LIVE');
    const logs = (await (await request(demo, '/logs')).json()) as {
      logs: { action: string; actorEmail: string }[];
    };
    expect(logs.logs).toHaveLength(1);
    expect(logs.logs[0]).toMatchObject({
      action: 'SETTINGS_UPDATED',
      actorEmail: 'admin@example.test',
    });
    expect((await request(demo, '/connect')).status).toBe(409);
  });
  it('enforces foreign keys, singleton mode, selected-page and scoped permission uniqueness', async () => {
    const db = await demo.getD1Database('DB');
    await db
      .prepare(
        "INSERT INTO meta_connections(id,mode,status,connected_by,created_at,updated_at) VALUES('live-test','LIVE','CONNECTED','admin@example.test','2026-01-01','2026-01-01')",
      )
      .run();
    await expect(
      db
        .prepare(
          "INSERT INTO meta_connections(id,mode,connected_by,created_at,updated_at) VALUES('other','LIVE','admin','','')",
        )
        .run(),
    ).rejects.toThrow();
    await expect(
      db
        .prepare(
          "INSERT INTO meta_pages(id,connection_id,provider_page_id,name,created_at,updated_at) VALUES('orphan','missing','page','Page','','')",
        )
        .run(),
    ).rejects.toThrow();
    await db
      .prepare(
        "INSERT INTO meta_pages(id,connection_id,provider_page_id,name,selected,created_at,updated_at) VALUES('p1','live-test','page-test','Page',1,'','')",
      )
      .run();
    await expect(
      db
        .prepare(
          "INSERT INTO meta_pages(id,connection_id,provider_page_id,name,selected,created_at,updated_at) VALUES('p2','live-test','other','Page',1,'','')",
        )
        .run(),
    ).rejects.toThrow();
    await db
      .prepare(
        "INSERT INTO meta_permissions(id,connection_id,permission,status,checked_at) VALUES('perm','live-test','example_read','GRANTED','')",
      )
      .run();
    await expect(
      db
        .prepare(
          "INSERT INTO meta_permissions(id,connection_id,permission,status,checked_at) VALUES('dup','live-test','example_read','GRANTED','')",
        )
        .run(),
    ).rejects.toThrow();
    await expect(
      db.prepare("UPDATE meta_connections SET status='UNKNOWN'").run(),
    ).rejects.toThrow();
  });
  it('stores only an encrypted token envelope, reports expiry and never returns secret storage', async () => {
    const db = await demo.getD1Database('DB');
    const encrypted = await encryptMetaToken(
      complete,
      identity,
      'synthetic-private-token',
    );
    await db.batch([
      db.prepare(
        "INSERT INTO meta_token_metadata(id,connection_id,token_type,asset_id,expires_at,created_at,updated_at) VALUES('token-test','live-test','PAGE','page-test','2020-01-01','','')",
      ),
      db
        .prepare(
          "INSERT INTO meta_token_secrets(token_id,ciphertext,nonce,key_version,created_at,updated_at) VALUES('token-test',?,?,?,'','')",
        )
        .bind(encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion),
    ]);
    expect(
      await db.prepare('SELECT ciphertext FROM meta_token_secrets').first(),
    ).toEqual({ ciphertext: encrypted.ciphertext });
    const result = await status();
    expect(result).toMatchObject({
      state: 'TOKEN_EXPIRED',
      tokenHealth: 'EXPIRED',
    });
    const encoded = JSON.stringify(result);
    for (const value of [
      'synthetic-private-token',
      encrypted.ciphertext,
      encrypted.nonce,
    ])
      expect(encoded).not.toContain(value);
    await db
      .prepare("UPDATE meta_token_metadata SET revoked_at='2026-01-01'")
      .run();
    expect(await status()).toMatchObject({
      state: 'RECONNECT_REQUIRED',
      tokenHealth: 'REVOKED',
    });
    await db
      .prepare(
        "UPDATE meta_token_metadata SET revoked_at=NULL,expires_at=NULL,permission_status='MISSING'",
      )
      .run();
    expect(await status()).toMatchObject({ state: 'PERMISSION_REQUIRED' });
  });
  it('rolls back settings if the required audit insert fails', async () => {
    const db = await demo.getD1Database('DB');
    await db.exec(
      "CREATE TRIGGER meta_test_audit_failure BEFORE INSERT ON meta_audit_logs BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;",
    );
    try {
      expect(
        (await request(demo, '/settings', 'PATCH', { demoEnabled: true }))
          .status,
      ).toBe(500);
      expect((await status()).mode).toBe('LIVE');
      expect(
        await db.prepare('SELECT COUNT(*) AS n FROM meta_audit_logs').first(),
      ).toEqual({ n: 1 });
    } finally {
      await db.exec('DROP TRIGGER meta_test_audit_failure;');
    }
  });
});
