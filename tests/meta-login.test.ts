import { describe, it, expect } from 'vitest';
import { metaAuthorizationUrl } from '../worker/services/meta/oauth';
import {
  metaConfiguration,
  type MetaEnvironment,
} from '../worker/services/meta/config';
const complete: MetaEnvironment = {
  META_APP_ID: '123',
  META_APP_SECRET: 'synthetic',
  META_WEBHOOK_VERIFY_TOKEN: 'synthetic',
  META_GRAPH_API_VERSION: 'v99.0',
  META_OAUTH_REDIRECT_URL:
    'https://crm.example.test/api/integrations/meta/callback',
  META_TOKEN_ENCRYPTION_KEY: btoa(
    String.fromCharCode(...new Uint8Array(32).fill(7)),
  ),
  META_TOKEN_ENCRYPTION_KEY_VERSION: 'test',
};
describe('Meta business login configuration', () => {
  it('preserves session state and code flow for Business configurations and legacy scope flows', () => {
    const legacy = metaAuthorizationUrl(
      { ...complete, META_MESSENGER_ENABLED: 'true' },
      'bound-state',
    );
    expect(legacy.searchParams.get('state')).toBe('bound-state');
    expect(legacy.searchParams.get('scope')).toContain('pages_messaging');
    expect(legacy.searchParams.has('config_id')).toBe(false);
    const business = metaAuthorizationUrl(
      { ...complete, META_LOGIN_CONFIG_ID: '456' },
      'bound-state',
    );
    expect(business.searchParams.get('state')).toBe('bound-state');
    expect(business.searchParams.get('redirect_uri')).toBe(
      complete.META_OAUTH_REDIRECT_URL,
    );
    expect(business.searchParams.get('response_type')).toBe('code');
    expect(business.searchParams.get('config_id')).toBe('456');
    expect(business.searchParams.has('scope')).toBe(false);
    expect(
      metaConfiguration({ ...complete, META_LOGIN_CONFIG_ID: 'invalid' })
        .invalid,
    ).toContain('META_LOGIN_CONFIG_ID');
  });
});
