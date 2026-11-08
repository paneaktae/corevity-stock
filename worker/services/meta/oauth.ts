import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv, Bindings } from '../../auth';
import { digest } from '../../auth';
import { metaAccess } from './access';
import { metaConfiguration, type MetaEnvironment } from './config';
import { MetaGraphClient, object, string, providerId } from './graph';
import {
  loadToken,
  tokenStatements,
  uuid,
  timestamp,
  operationAudit,
  rateLimit,
} from './store';
import { metaAuditStatement } from './audit';

export function sessionToken(header: string | undefined) {
  return (
    (header ?? '')
      .split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('corevity_session='))
      ?.slice('corevity_session='.length) ?? ''
  );
}
function configured(env: Bindings, origin: string) {
  const config = metaConfiguration(env);
  if (
    !config.ready ||
    !config.flags.META_INTEGRATION_ENABLED ||
    env.META_LIVE_ACTIVATION_CONFIRMED !== 'true'
  )
    throw new HTTPException(409, {
      message:
        'READY FOR META CONFIGURATION: configure and verify the Meta app before connecting.',
    });
  if (new URL(env.META_OAUTH_REDIRECT_URL!).origin !== origin)
    throw new HTTPException(403, {
      message: 'Use the configured CRM hostname to connect Meta.',
    });
  return config;
}
export async function isDemo(env: Bindings) {
  const preference = await env.DB.prepare(
    "SELECT demo_enabled FROM meta_integration_settings WHERE id='workspace'",
  ).first<{ demo_enabled: number }>();
  return env.META_DEMO_MODE === 'true' && (preference?.demo_enabled ?? 1) === 1;
}
function secondsIso(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}
export async function inspectToken(
  env: Bindings,
  token: string,
  http: typeof fetch = fetch,
) {
  const client = new MetaGraphClient(
    env,
    env.META_APP_ID + '|' + env.META_APP_SECRET,
    http,
  );
  const raw = object(
    (await client.request('debug_token', { input_token: token })).data,
  );
  if (
    raw.is_valid !== true ||
    string(raw.app_id) !== env.META_APP_ID ||
    !string(raw.user_id) ||
    [raw.expires_at, raw.data_access_expires_at].some(
      (v) => typeof v === 'number' && v > 0 && v * 1000 <= Date.now(),
    )
  )
    throw new HTTPException(401, {
      message: 'Meta token is invalid or expired. Please reconnect.',
    });
  return {
    userId: string(raw.user_id),
    expiresAt: secondsIso(raw.expires_at),
    dataAccessExpiresAt: secondsIso(raw.data_access_expires_at),
    issuedAt: secondsIso(raw.issued_at),
    scopes: Array.isArray(raw.scopes)
      ? raw.scopes.filter((v): v is string => typeof v === 'string')
      : [],
    granular: Array.isArray(raw.granular_scopes)
      ? raw.granular_scopes.map(object)
      : [],
  };
}
export async function refreshMetaTokens(env: Bindings, actor = 'system') {
  if (
    (await isDemo(env)) ||
    env.META_INTEGRATION_ENABLED !== 'true' ||
    env.META_LIVE_ACTIVATION_CONFIRMED !== 'true'
  )
    return;
  const connection = await env.DB.prepare(
    "SELECT id,generation FROM meta_connections WHERE mode='LIVE' AND status<>'DISCONNECTED'",
  ).first<{ id: string; generation: number }>();
  if (!connection) return;
  const rows = await env.DB.prepare(
    'SELECT token_type,asset_id FROM meta_token_metadata WHERE connection_id=? AND revoked_at IS NULL AND (?=1 OR last_validated_at IS NULL OR last_validated_at<?) ORDER BY token_type DESC',
  )
    .bind(
      connection.id,
      actor === 'system' ? 0 : 1,
      new Date(Date.now() - 6 * 3600_000).toISOString(),
    )
    .all<{ token_type: 'USER' | 'PAGE'; asset_id: string }>();
  for (const token of rows.results.slice(0, 20)) {
    try {
      const loaded = await loadToken(
        env,
        token.token_type,
        token.asset_id,
        true,
      );
      const inspected = await inspectToken(env, loaded.token);
      const guard = uuid();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO meta_atomic_guards(id,valid) VALUES(?,EXISTS(SELECT 1 FROM meta_connections WHERE id=? AND generation=? AND status<>'DISCONNECTED'))",
        ).bind(guard, connection.id, connection.generation),
        env.DB.prepare(
          "UPDATE meta_token_metadata SET expires_at=?,data_access_expires_at=?,last_validated_at=?,permission_status='GRANTED',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM meta_connections WHERE id=? AND generation=? AND status<>'DISCONNECTED')",
        ).bind(
          inspected.expiresAt,
          inspected.dataAccessExpiresAt,
          timestamp(),
          timestamp(),
          loaded.row.id,
          connection.id,
          connection.generation,
        ),
        env.DB.prepare(
          'DELETE FROM meta_permissions WHERE connection_id=? AND (?=1 OR asset_id=?)',
        ).bind(
          connection.id,
          token.token_type === 'USER' ? 1 : 0,
          token.asset_id,
        ),
        ...permissionStatements(
          env,
          connection.id,
          inspected.scopes,
          inspected.granular,
          token.asset_id,
        ),
        operationAudit(
          env,
          'LIVE',
          actor,
          'CONNECTION_REFRESHED',
          loaded.row.id,
        ),
        env.DB.prepare('DELETE FROM meta_atomic_guards WHERE id=?').bind(guard),
      ]);
    } catch (error) {
      const expired =
        error instanceof HTTPException && [401, 409].includes(error.status);
      await env.DB.prepare(
        "UPDATE meta_token_metadata SET permission_status=?,revoked_at=CASE WHEN ?=1 THEN ? ELSE revoked_at END,updated_at=? WHERE connection_id=? AND token_type=? AND asset_id=? AND EXISTS(SELECT 1 FROM meta_connections WHERE id=? AND generation=? AND status<>'DISCONNECTED')",
      )
        .bind(
          expired ? 'REVOKED' : 'UNKNOWN',
          expired ? 1 : 0,
          timestamp(),
          timestamp(),
          connection.id,
          token.token_type,
          token.asset_id,
          connection.id,
          connection.generation,
        )
        .run();
    }
  }
}
function permissionStatements(
  env: Bindings,
  connectionId: string,
  scopes: string[],
  granular: Record<string, unknown>[],
  defaultAsset = '',
) {
  return scopes.flatMap((permission) => {
    const row = granular.find((v) => v.scope === permission);
    const targets =
      row && Array.isArray(row.target_ids)
        ? row.target_ids.filter(
            (v): v is string => typeof v === 'string' && /^\d+$/.test(v),
          )
        : [defaultAsset];
    return targets.map((asset) =>
      env.DB.prepare(
        "INSERT INTO meta_permissions(id,connection_id,permission,asset_id,status,checked_at) VALUES(?,?,?,?,'GRANTED',?) ON CONFLICT(connection_id,permission,asset_id) DO UPDATE SET status='GRANTED',checked_at=excluded.checked_at",
      ).bind(uuid(), connectionId, permission, asset, timestamp()),
    );
  });
}
export const metaOAuthRoutes = new Hono<AppEnv>();
metaOAuthRoutes.get('/connect', async (c) => {
  const access = await metaAccess(c, true);
  configured(c.env, new URL(c.req.url).origin);
  if (await isDemo(c.env))
    throw new HTTPException(409, {
      message: 'Switch to live setup before connecting a real account.',
    });
  const session = sessionToken(c.req.header('Cookie'));
  if (!session || c.get('authMethod') !== 'password')
    throw new HTTPException(401, {
      message: 'Sign in with a password session before connecting Meta.',
    });
  await rateLimit(c.env, access.email, 'oauth', 5);
  const state = uuid() + uuid();
  const now = timestamp();
  const [result] = await c.env.DB.batch<{ generation: number }>([
    c.env.DB.prepare(
      "INSERT INTO meta_connections(id,mode,status,connected_by,generation,created_at,updated_at) VALUES('meta-live','LIVE','CONNECTING',?,1,?,?) ON CONFLICT(mode) DO UPDATE SET generation=generation+1,status='CONNECTING',connected_by=excluded.connected_by,updated_at=excluded.updated_at RETURNING generation",
    ).bind(access.email, now, now),
  ]);
  const generation = result.results[0].generation;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM meta_oauth_states WHERE expires_at<?').bind(
      now,
    ),
    c.env.DB.prepare(
      'INSERT INTO meta_oauth_states(state_hash,actor_email,session_hash,generation,expires_at) VALUES(?,?,?,?,?)',
    ).bind(
      await digest(state),
      access.email,
      await digest(session),
      generation,
      new Date(Date.now() + 600_000).toISOString(),
    ),
    metaAuditStatement(c.env.DB, {
      actorEmail: access.email,
      mode: 'LIVE',
      action: 'CONNECTION_STARTED',
      outcome: 'SUCCESS',
    }),
  ]);
  return c.redirect(metaAuthorizationUrl(c.env, state).href, 302);
});
export function metaAuthorizationUrl(env: MetaEnvironment, state: string) {
  const config = metaConfiguration(env);
  const scopes = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_metadata',
  ];
  if (config.flags.META_MESSENGER_ENABLED) scopes.push('pages_messaging');
  if (config.flags.META_LEADS_ENABLED)
    scopes.push('leads_retrieval', 'pages_manage_ads');
  if (config.flags.META_ADS_READ_ENABLED) scopes.push('ads_read');
  if (config.flags.META_ADS_WRITE_ENABLED) scopes.push('ads_management');
  if (config.flags.META_PAGE_CONTENT_ENABLED) scopes.push('pages_manage_posts');
  scopes.push('read_insights');
  const url = new URL(
    'https://www.facebook.com/' + env.META_GRAPH_API_VERSION + '/dialog/oauth',
  );
  url.search = new URLSearchParams({
    client_id: env.META_APP_ID!,
    redirect_uri: env.META_OAUTH_REDIRECT_URL!,
    response_type: 'code',
    state,
  }).toString();
  if (env.META_LOGIN_CONFIG_ID) {
    url.searchParams.set('config_id', env.META_LOGIN_CONFIG_ID);
    url.searchParams.set('override_default_response_type', 'true');
  } else {
    url.searchParams.set('scope', scopes.join(','));
    url.searchParams.set('auth_type', 'rerequest');
  }
  return url;
}
metaOAuthRoutes.get('/callback', async (c) => {
  const access = await metaAccess(c, true);
  configured(c.env, new URL(c.req.url).origin);
  const state = c.req.query('state') ?? '';
  const session = sessionToken(c.req.header('Cookie'));
  if (!state || state.length > 200 || !session)
    throw new HTTPException(403, {
      message: 'OAuth state is invalid or expired.',
    });
  const attempt = await c.env.DB.prepare(
    'UPDATE meta_oauth_states SET consumed_at=? WHERE state_hash=? AND actor_email=? AND session_hash=? AND expires_at>? AND consumed_at IS NULL RETURNING generation',
  )
    .bind(
      timestamp(),
      await digest(state),
      access.email,
      await digest(session),
      timestamp(),
    )
    .first<{ generation: number }>();
  if (!attempt)
    throw new HTTPException(403, {
      message: 'OAuth state is invalid, expired or already used.',
    });
  if (c.req.query('error')) {
    await c.env.DB.prepare(
      "UPDATE meta_connections SET status='RECONNECT_REQUIRED',updated_at=? WHERE mode='LIVE' AND generation=?",
    )
      .bind(timestamp(), attempt.generation)
      .run();
    return c.redirect('/settings?tab=integrations&meta=cancelled', 303);
  }
  const code = c.req.query('code');
  if (!code || code.length > 4096 || (await isDemo(c.env)))
    throw new HTTPException(400, {
      message: 'OAuth callback did not contain a valid authorization code.',
    });
  const client = new MetaGraphClient(
    c.env,
    c.env.META_APP_ID + '|' + c.env.META_APP_SECRET,
  );
  let stage = 'TOKEN_EXCHANGE';
  try {
    const short = await client.request('oauth/access_token', {
      client_id: c.env.META_APP_ID!,
      client_secret: c.env.META_APP_SECRET!,
      redirect_uri: c.env.META_OAUTH_REDIRECT_URL!,
      code,
    });
    if (!string(short.access_token))
      throw new HTTPException(502, {
        message: 'Meta did not return a valid access token.',
      });
    const extended = await client.request('oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: c.env.META_APP_ID!,
      client_secret: c.env.META_APP_SECRET!,
      fb_exchange_token: string(short.access_token),
    });
    const token = string(extended.access_token);
    stage = 'TOKEN_VALIDATION';
    const inspected = await inspectToken(c.env, token);
    const user = new MetaGraphClient(c.env, token);
    stage = 'ASSET_DISCOVERY';
    const pages = await user.all('me/accounts', {
      fields: 'id,name,access_token,picture{url},tasks',
    });
    const accounts = inspected.scopes.some(
      (v) => v === 'ads_read' || v === 'ads_management',
    )
      ? await user.all('me/adaccounts', {
          fields: 'id,name,currency,timezone_name',
        })
      : [];
    const now = timestamp();
    stage = 'ASSET_STORAGE';
    const statements = [
      c.env.DB.prepare(
        'INSERT INTO meta_atomic_guards(id,valid) VALUES(?,(SELECT COUNT(*) FROM meta_connections WHERE mode=? AND generation=? AND status=?))',
      ).bind(state, 'LIVE', attempt.generation, 'CONNECTING'),
      c.env.DB.prepare('DELETE FROM meta_pages WHERE connection_id=?').bind(
        'meta-live',
      ),
      c.env.DB.prepare(
        'DELETE FROM meta_ad_accounts WHERE connection_id=?',
      ).bind('meta-live'),
      c.env.DB.prepare(
        'DELETE FROM meta_permissions WHERE connection_id=?',
      ).bind('meta-live'),
      c.env.DB.prepare(
        'DELETE FROM meta_token_metadata WHERE connection_id=?',
      ).bind('meta-live'),
      ...(await tokenStatements(c.env, {
        connectionId: 'meta-live',
        type: 'USER',
        token,
        ...inspected,
      })),
      ...permissionStatements(
        c.env,
        'meta-live',
        inspected.scopes,
        inspected.granular,
      ),
    ];
    for (const page of pages) {
      const pageId = providerId(string(page.id));
      const pageToken = string(page.access_token);
      if (!pageToken) continue;
      const health = await inspectToken(c.env, pageToken);
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO meta_pages(id,connection_id,provider_page_id,name,profile_image_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        ).bind(
          uuid(),
          'meta-live',
          pageId,
          string(page.name),
          string(
            object(page.picture).data && object(object(page.picture).data).url,
          ) || null,
          now,
          now,
        ),
      );
      statements.push(
        ...(await tokenStatements(c.env, {
          connectionId: 'meta-live',
          type: 'PAGE',
          assetId: pageId,
          token: pageToken,
          ...health,
        })),
      );
    }
    for (const account of accounts)
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO meta_ad_accounts(id,connection_id,provider_account_id,name,currency,timezone,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        ).bind(
          uuid(),
          'meta-live',
          providerId(string(account.id)),
          string(account.name),
          string(account.currency),
          string(account.timezone_name),
          now,
          now,
        ),
      );
    statements.push(
      c.env.DB.prepare(
        "UPDATE meta_connections SET status='CONNECTED',provider_user_id=?,connected_at=?,disconnected_at=NULL,error_code=NULL,updated_at=? WHERE mode='LIVE' AND generation=?",
      ).bind(inspected.userId, now, now, attempt.generation),
      c.env.DB.prepare('DELETE FROM meta_atomic_guards WHERE id=?').bind(state),
      metaAuditStatement(c.env.DB, {
        actorEmail: access.email,
        mode: 'LIVE',
        action: 'CONNECTION_COMPLETED',
        outcome: 'SUCCESS',
      }),
    );
    await c.env.DB.batch(statements);
    return c.redirect('/settings?tab=integrations&meta=select-page', 303);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'meta_oauth_failure',
        stage,
        type: error instanceof Error ? error.name : 'unknown',
      }),
    );
    await c.env.DB.prepare(
      "UPDATE meta_connections SET status='RECONNECT_REQUIRED',error_code='PROVIDER_ERROR',updated_at=? WHERE mode='LIVE' AND generation=?",
    )
      .bind(timestamp(), attempt.generation)
      .run();
    throw new HTTPException(502, {
      message:
        'Meta connection failed at ' +
        stage +
        '. Please verify app settings and reconnect.',
    });
  }
});
metaOAuthRoutes.get('/pages', async (c) => {
  await metaAccess(c, true);
  const rows = await c.env.DB.prepare(
    "SELECT p.provider_page_id AS id,p.name,p.profile_image_url AS profileImageUrl,p.selected FROM meta_pages p JOIN meta_connections c ON c.id=p.connection_id WHERE c.mode='LIVE' AND c.status<>'DISCONNECTED'",
  ).all();
  return c.json({ pages: rows.results });
});
metaOAuthRoutes.get('/accounts', async (c) => {
  await metaAccess(c, true);
  const rows = await c.env.DB.prepare(
    "SELECT a.provider_account_id AS id,a.name,a.currency,a.timezone,a.selected FROM meta_ad_accounts a JOIN meta_connections c ON c.id=a.connection_id WHERE c.mode='LIVE' AND c.status<>'DISCONNECTED'",
  ).all();
  return c.json({ accounts: rows.results });
});
metaOAuthRoutes.post('/assets', async (c) => {
  const access = await metaAccess(c, true);
  if (await isDemo(c.env))
    throw new HTTPException(409, {
      message: 'Live assets cannot be selected in Demo Mode.',
    });
  const input = z
    .object({
      pageId: z.string().regex(/^\d+$/),
      accountId: z
        .string()
        .regex(/^(act_)?\d+$/)
        .optional(),
    })
    .strict()
    .parse(await c.req.json());
  const page = await c.env.DB.prepare(
    "SELECT p.id,p.connection_id FROM meta_pages p JOIN meta_connections c ON c.id=p.connection_id WHERE c.mode='LIVE' AND c.status='CONNECTED' AND p.provider_page_id=?",
  )
    .bind(input.pageId)
    .first<{ id: string; connection_id: string }>();
  if (!page)
    throw new HTTPException(404, {
      message: 'Choose a Page returned by your authorized account.',
    });
  const loaded = await loadToken(c.env, 'PAGE', input.pageId);
  await inspectToken(c.env, loaded.token);
  if (
    input.accountId &&
    !(await c.env.DB.prepare(
      'SELECT id FROM meta_ad_accounts WHERE connection_id=? AND provider_account_id=?',
    )
      .bind(page.connection_id, input.accountId)
      .first())
  )
    throw new HTTPException(403, {
      message: 'Choose an authorized ad account.',
    });
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE meta_pages SET selected=0 WHERE connection_id=?',
    ).bind(page.connection_id),
    c.env.DB.prepare(
      'UPDATE meta_pages SET selected=1,updated_at=? WHERE id=?',
    ).bind(timestamp(), page.id),
    c.env.DB.prepare(
      'UPDATE meta_ad_accounts SET selected=0 WHERE connection_id=?',
    ).bind(page.connection_id),
    ...(input.accountId
      ? [
          c.env.DB.prepare(
            'UPDATE meta_ad_accounts SET selected=1,updated_at=? WHERE connection_id=? AND provider_account_id=?',
          ).bind(timestamp(), page.connection_id, input.accountId),
        ]
      : []),
    operationAudit(
      c.env,
      'LIVE',
      access.email,
      'CONNECTION_REFRESHED',
      page.id,
    ),
  ]);
  return c.json({ selected: true });
});
metaOAuthRoutes.post('/refresh', async (c) => {
  const access = await metaAccess(c, true);
  await rateLimit(c.env, access.email, 'token-check', 5);
  await refreshMetaTokens(c.env, access.email);
  return c.json({ checked: true });
});
metaOAuthRoutes.post('/disconnect', async (c) => {
  const access = await metaAccess(c, true);
  if (await isDemo(c.env)) return c.json({ disconnected: true, mode: 'DEMO' });
  const input = z
    .object({ revoke: z.boolean().default(false) })
    .strict()
    .parse(await c.req.json());
  if (input.revoke) {
    const loaded = await loadToken(c.env, 'USER', '', true);
    await new MetaGraphClient(c.env, loaded.token).request(
      'me/permissions',
      {},
      'DELETE',
    );
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE meta_connections SET status='DISCONNECTED',generation=generation+1,disconnected_at=?,updated_at=? WHERE mode='LIVE'",
    ).bind(timestamp(), timestamp()),
    c.env.DB.prepare(
      "DELETE FROM meta_token_secrets WHERE token_id IN (SELECT m.id FROM meta_token_metadata m JOIN meta_connections c ON c.id=m.connection_id WHERE c.mode='LIVE')",
    ),
    c.env.DB.prepare(
      "UPDATE meta_token_metadata SET revoked_at=?,permission_status='REVOKED' WHERE connection_id IN(SELECT id FROM meta_connections WHERE mode='LIVE')",
    ).bind(timestamp()),
    c.env.DB.prepare('DELETE FROM meta_oauth_states'),
    metaAuditStatement(c.env.DB, {
      actorEmail: access.email,
      mode: 'LIVE',
      action: 'CONNECTION_DISCONNECTED',
      outcome: 'SUCCESS',
    }),
  ]);
  return c.json({ disconnected: true, revoked: input.revoke });
});
