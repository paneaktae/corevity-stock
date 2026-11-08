import type { Bindings } from '../../auth';
import {
  metaStateSchema,
  type MetaConnectionState,
  type MetaStatus,
} from '../../../shared/meta';
import { metaConfiguration } from './config';
import { MockMetaProvider } from './provider';

export type MetaHealth = {
  status: MetaConnectionState;
  revokedAt?: string | null;
  expiresAt?: string | null;
  dataAccessExpiresAt?: string | null;
  lastValidatedAt?: string | null;
  permissionStatus?: string | null;
  hasSecret?: boolean;
};

export function liveMetaState(
  config: ReturnType<typeof metaConfiguration>,
  health: MetaHealth | null,
  now = new Date(),
): MetaConnectionState {
  if (config.empty) return 'NOT_CONFIGURED';
  if (!config.ready) return 'CONFIGURATION_INCOMPLETE';
  if (!health) return 'READY_TO_CONNECT';
  if (health.status === 'DISCONNECTED') return 'DISCONNECTED';
  if (health.revokedAt || health.permissionStatus === 'REVOKED')
    return 'RECONNECT_REQUIRED';
  for (const expiry of [health.expiresAt, health.dataAccessExpiresAt]) {
    if (
      expiry &&
      (!Number.isFinite(Date.parse(expiry)) ||
        Date.parse(expiry) <= now.getTime())
    )
      return 'TOKEN_EXPIRED';
  }
  if (health.permissionStatus === 'MISSING') return 'PERMISSION_REQUIRED';
  if (health.status === 'CONNECTED') {
    return health.hasSecret &&
      health.permissionStatus === 'GRANTED' &&
      health.lastValidatedAt &&
      Number.isFinite(Date.parse(health.lastValidatedAt)) &&
      Date.parse(health.lastValidatedAt) >= now.getTime() - 86_400_000
      ? 'CONNECTED'
      : 'RECONNECT_REQUIRED';
  }
  return health.status;
}

export async function metaIntegrationStatus(
  env: Bindings,
  admin: boolean,
): Promise<MetaStatus> {
  const config = metaConfiguration(env);
  const settings = await env.DB.prepare(
    "SELECT demo_enabled FROM meta_integration_settings WHERE id='workspace'",
  ).first<{ demo_enabled: number }>();
  // The environment is the hard ceiling; UI preference can only turn Demo off.
  const demo =
    config.flags.META_DEMO_MODE && (settings?.demo_enabled ?? 1) === 1;
  const enabled = config.flags.META_INTEGRATION_ENABLED;
  let state: MetaConnectionState = liveMetaState(config, null);
  let page: MetaStatus['page'] = null;
  let adAccount: MetaStatus['adAccount'] = null;
  let tokenHealth: MetaStatus['tokenHealth'] = 'NOT_CONFIGURED';
  let lastSyncedAt: string | null = null;
  let lastWebhookAt: string | null = null;
  const permissions: MetaStatus['permissions'] = { granted: [], missing: [] };
  let adsTokenHealthy = demo;
  let integrationError: MetaStatus['integrationError'] = null;
  if (demo) {
    const demoConnection = await env.DB.prepare(
      "SELECT data FROM meta_demo_entities WHERE id='demo:connection' AND kind='CONNECTION'",
    ).first<{ data: string }>();
    const demoConnected =
      !demoConnection || JSON.parse(demoConnection.data).connected === true;
    if (enabled && demoConnected) {
      ({ page, adAccount } = await new MockMetaProvider().summary());
      state = 'CONNECTED';
      tokenHealth = 'DEMO';
    } else state = 'DISCONNECTED';
  } else {
    const connection = await env.DB.prepare(
      "SELECT id,status,last_synced_at,last_webhook_at,error_code FROM meta_connections WHERE mode='LIVE'",
    ).first<{
      id: string;
      status: string;
      last_synced_at: string | null;
      last_webhook_at: string | null;
      error_code: NonNullable<MetaStatus['integrationError']>['code'] | null;
    }>();
    if (connection) {
      const safeErrors = {
        PROVIDER_ERROR:
          'Meta returned an error. Review the required permissions and reconnect.',
        RATE_LIMITED: 'Meta temporarily limited requests. Try again later.',
        NETWORK_ERROR: 'Meta could not be reached. Try again later.',
        PERMISSION_DENIED:
          'Meta permissions need to be updated before continuing.',
      } as const;
      if (
        connection.error_code &&
        Object.hasOwn(safeErrors, connection.error_code)
      ) {
        integrationError = {
          code: connection.error_code,
          message: safeErrors[connection.error_code],
        };
      }
      const selectedPage = await env.DB.prepare(
        'SELECT provider_page_id,name,profile_image_url FROM meta_pages WHERE connection_id=? AND selected=1',
      )
        .bind(connection.id)
        .first<{
          provider_page_id: string;
          name: string;
          profile_image_url: string | null;
        }>();
      if (selectedPage)
        page = {
          id: selectedPage.provider_page_id,
          name: selectedPage.name,
          profileImageUrl: selectedPage.profile_image_url,
        };
      const account = await env.DB.prepare(
        'SELECT provider_account_id,name,currency,timezone FROM meta_ad_accounts WHERE connection_id=? AND selected=1',
      )
        .bind(connection.id)
        .first<{
          provider_account_id: string;
          name: string;
          currency: string;
          timezone: string;
        }>();
      if (account)
        adAccount = {
          id: account.provider_account_id,
          name: account.name,
          currency: account.currency,
          timezone: account.timezone,
        };
      const token = selectedPage
        ? await env.DB.prepare(
            `SELECT m.revoked_at,m.expires_at,m.data_access_expires_at,m.last_validated_at,m.permission_status,
        EXISTS(SELECT 1 FROM meta_token_secrets s WHERE s.token_id=m.id) AS has_secret
        FROM meta_token_metadata m WHERE m.connection_id=? AND m.token_type='PAGE' AND m.asset_id=?`,
          )
            .bind(connection.id, selectedPage.provider_page_id)
            .first<{
              revoked_at: string | null;
              expires_at: string | null;
              data_access_expires_at: string | null;
              last_validated_at: string | null;
              permission_status: string;
              has_secret: number;
            }>()
        : null;
      state = liveMetaState(config, {
        status: metaStateSchema.parse(connection.status),
        revokedAt: token?.revoked_at,
        expiresAt: token?.expires_at,
        dataAccessExpiresAt: token?.data_access_expires_at,
        lastValidatedAt: token?.last_validated_at,
        permissionStatus: token?.permission_status,
        hasSecret: token?.has_secret === 1,
      });
      tokenHealth =
        token?.revoked_at || token?.permission_status === 'REVOKED'
          ? 'REVOKED'
          : state === 'TOKEN_EXPIRED'
            ? 'EXPIRED'
            : token?.has_secret === 1
              ? 'NOT_VALIDATED'
              : 'NOT_CONFIGURED';
      if (state === 'CONNECTED') tokenHealth = 'VALID';
      if (!selectedPage && config.ready && connection.status === 'CONNECTED')
        state = 'PERMISSION_REQUIRED';
      lastSyncedAt = connection.last_synced_at;
      lastWebhookAt = connection.last_webhook_at;
      const rows = await env.DB.prepare(
        `SELECT permission,CASE WHEN MIN(status='GRANTED')=1 THEN 'GRANTED' ELSE 'MISSING' END AS status
         FROM meta_permissions WHERE connection_id=? AND (asset_id='' OR asset_id=?)
         GROUP BY permission ORDER BY permission`,
      )
        .bind(connection.id, selectedPage?.provider_page_id ?? '')
        .all<{ permission: string; status: string }>();
      const userToken = await env.DB.prepare(
        "SELECT m.expires_at,m.data_access_expires_at,m.revoked_at,m.last_validated_at,m.permission_status,EXISTS(SELECT 1 FROM meta_token_secrets s WHERE s.token_id=m.id) AS has_secret FROM meta_token_metadata m WHERE m.connection_id=? AND m.token_type='USER' AND m.asset_id=''",
      )
        .bind(connection.id)
        .first<{
          expires_at: string | null;
          data_access_expires_at: string | null;
          revoked_at: string | null;
          last_validated_at: string | null;
          permission_status: string;
          has_secret: number;
        }>();
      adsTokenHealthy = Boolean(
        userToken &&
        liveMetaState(config, {
          status: 'CONNECTED',
          expiresAt: userToken.expires_at,
          dataAccessExpiresAt: userToken.data_access_expires_at,
          revokedAt: userToken.revoked_at,
          lastValidatedAt: userToken.last_validated_at,
          permissionStatus: userToken.permission_status,
          hasSecret: userToken.has_secret === 1,
        }) === 'CONNECTED',
      );
      // Capabilities require both stored grants and current token validation.
      for (const row of rows.results) {
        (row.status === 'GRANTED'
          ? permissions.granted
          : permissions.missing
        ).push(row.permission);
      }
    }
  }
  const has = (permission: string) =>
    permissions.granted.includes(permission) &&
    !permissions.missing.includes(permission);
  const connected = enabled && state === 'CONNECTED';
  const can = (flag: keyof typeof config.flags, permission: string) =>
    connected && config.flags[flag] && (demo || has(permission));
  const liveActivated = env.META_LIVE_ACTIVATION_CONFIRMED === 'true';
  const liveUsable = demo || liveActivated;
  const stateMessages: Partial<Record<MetaConnectionState, string>> = {
    TOKEN_EXPIRED: 'The stored token has expired. Reconnect in Settings.',
    RECONNECT_REQUIRED: 'Please reconnect your Facebook Page in Settings.',
    PERMISSION_REQUIRED:
      'Facebook permissions need to be updated. Reconnect and approve the required permissions.',
    DISCONNECTED: 'Facebook is disconnected. Setup remains accessible.',
    ERROR:
      'The stored connection has an error. Review configuration and reconnect in Settings.',
  };
  return {
    mode: demo ? 'DEMO' : 'LIVE',
    label: demo ? 'DEMO MODE' : 'LIVE MODE',
    enabled,
    state,
    message: !enabled
      ? 'Meta integration is disabled. Setup remains accessible.'
      : demo
        ? 'Simulated data only. No requests are sent to Meta.'
        : (stateMessages[state] ??
          (config.ready
            ? page
              ? 'Connection metadata is available. Refresh token validation before activating features.'
              : 'Connect an account and select an authorized Facebook Page.'
            : 'Meta integration is not configured. Configure the missing or invalid Worker settings.')),
    flags: config.flags,
    configuration: {
      ready: config.ready,
      missing: config.missing,
      invalid: config.invalid,
    },
    page,
    adAccount,
    permissions,
    integrationError,
    tokenHealth,
    lastSyncedAt,
    lastWebhookAt,
    capabilities: {
      manageIntegration: admin,
      useDemo: enabled && demo,
      connect: admin && enabled && !demo && config.ready && liveActivated,
      readMessenger:
        liveUsable && can('META_MESSENGER_ENABLED', 'pages_messaging'),
      sendMessage:
        liveUsable && can('META_MESSENGER_ENABLED', 'pages_messaging'),
      syncLeads: liveUsable && can('META_LEADS_ENABLED', 'leads_retrieval'),
      readAds:
        adsTokenHealthy &&
        liveUsable &&
        Boolean(demo || adAccount) &&
        (can('META_ADS_READ_ENABLED', 'ads_read') ||
          can('META_ADS_READ_ENABLED', 'ads_management')),
      writeAds:
        adsTokenHealthy &&
        admin &&
        liveUsable &&
        Boolean(demo || adAccount) &&
        can('META_ADS_WRITE_ENABLED', 'ads_management'),
      useAI:
        connected &&
        config.flags.META_AI_ENABLED &&
        Boolean(demo || (env.AI_API_KEY && env.AI_MODEL && env.AI_BASE_URL)),
      publishContent:
        admin &&
        liveUsable &&
        can('META_PAGE_CONTENT_ENABLED', 'pages_manage_posts'),
      readPageInsights:
        connected && liveUsable && (demo || has('read_insights')),
      readContent:
        connected && liveUsable && (demo || has('pages_read_engagement')),
    },
    implementation:
      connected && liveUsable ? 'ACTIVE' : 'READY_FOR_META_CONFIGURATION',
  };
}
