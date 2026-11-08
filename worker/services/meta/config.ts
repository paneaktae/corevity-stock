import { metaFlagNames, type MetaFlags } from '../../../shared/meta';

export type MetaEnvironment = Partial<
  Record<(typeof metaFlagNames)[number], string>
> & {
  META_APP_ID?: string;
  META_LOGIN_CONFIG_ID?: string;
  META_APP_SECRET?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_GRAPH_API_VERSION?: string;
  META_OAUTH_REDIRECT_URL?: string;
  META_TOKEN_ENCRYPTION_KEY?: string;
  META_TOKEN_ENCRYPTION_KEY_VERSION?: string;
  META_LIVE_ACTIVATION_CONFIRMED?: string;
  META_PAGE_INSIGHT_METRICS?: string;
  META_POST_INSIGHT_METRICS?: string;
  META_PAGE_SCHEDULING_SUPPORTED?: string;
  META_DATA_RETENTION_DAYS?: string;
};

export function metaConfiguration(env: MetaEnvironment) {
  // Only the exact value "true" enables a flag. Missing/typo values fail closed.
  const flags = Object.fromEntries(
    metaFlagNames.map((name) => [name, env[name] === 'true']),
  ) as MetaFlags;
  const required = [
    'META_APP_ID',
    'META_APP_SECRET',
    'META_WEBHOOK_VERIFY_TOKEN',
    'META_GRAPH_API_VERSION',
    'META_OAUTH_REDIRECT_URL',
    'META_TOKEN_ENCRYPTION_KEY',
    'META_TOKEN_ENCRYPTION_KEY_VERSION',
  ] as const;
  const missing = required.filter((name) => !env[name]?.trim());
  const invalid: string[] = [];
  if (env.META_APP_ID && !/^\d+$/.test(env.META_APP_ID))
    invalid.push('META_APP_ID');
  if (env.META_LOGIN_CONFIG_ID && !/^\d{1,100}$/.test(env.META_LOGIN_CONFIG_ID))
    invalid.push('META_LOGIN_CONFIG_ID');
  // Syntax validation only; support must be checked against Meta docs in Phase 4.
  if (
    env.META_GRAPH_API_VERSION &&
    !/^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION)
  )
    invalid.push('META_GRAPH_API_VERSION');
  if (
    env.META_TOKEN_ENCRYPTION_KEY &&
    !/^[A-Za-z0-9+/]{43}=$/.test(env.META_TOKEN_ENCRYPTION_KEY)
  )
    invalid.push('META_TOKEN_ENCRYPTION_KEY');
  if (
    env.META_TOKEN_ENCRYPTION_KEY_VERSION &&
    !/^[A-Za-z0-9_-]{1,32}$/.test(env.META_TOKEN_ENCRYPTION_KEY_VERSION)
  )
    invalid.push('META_TOKEN_ENCRYPTION_KEY_VERSION');
  if (env.META_OAUTH_REDIRECT_URL) {
    try {
      const url = new URL(env.META_OAUTH_REDIRECT_URL);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash ||
        url.search ||
        url.pathname !== '/api/integrations/meta/callback'
      )
        throw new Error();
    } catch {
      invalid.push('META_OAUTH_REDIRECT_URL');
    }
  }
  return {
    flags,
    ready: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    empty: missing.length === required.length,
  };
}
