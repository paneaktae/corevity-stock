import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../../auth';
import type { MetaStatus } from '../../../shared/meta';
import { metaAccess } from './access';
import { metaIntegrationStatus } from './integration';
import { MockMetaProvider, GraphAPIMetaProvider } from './provider';
import { MetaGraphClient } from './graph';
import { loadToken } from './store';

export async function metaContext(
  c: Context<AppEnv>,
  capability?: keyof MetaStatus['capabilities'],
  ads = false,
) {
  const access = await metaAccess(c);
  const status = await metaIntegrationStatus(c.env, access.admin);
  if (!status.enabled)
    throw new HTTPException(409, {
      message: 'Meta integration is disabled. Setup remains available.',
    });
  if (capability && !status.capabilities[capability])
    throw new HTTPException(403, {
      message:
        'This Meta feature requires configuration, an enabled feature flag and the appropriate permissions.',
    });
  if (status.mode === 'DEMO')
    return {
      ...access,
      status,
      mode: 'DEMO' as const,
      pageId: 'demo:page',
      accountId: 'demo:ad-account',
      provider: new MockMetaProvider(),
    };
  if (c.env.META_LIVE_ACTIVATION_CONFIRMED !== 'true')
    throw new HTTPException(409, { message: 'READY FOR META CONFIGURATION' });
  if (!status.page)
    throw new HTTPException(409, {
      message: 'Select and validate a Facebook Page in Settings.',
    });
  const token = await loadToken(
    c.env,
    ads ? 'USER' : 'PAGE',
    ads ? '' : status.page.id,
  );
  const sanitizeMetrics = (value: string | undefined) =>
    (value ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => /^[a-z][a-z0-9_]{1,79}$/.test(v))
      .slice(0, 20)
      .join(',');
  return {
    ...access,
    status,
    mode: 'LIVE' as const,
    pageId: status.page.id,
    accountId: status.adAccount?.id ?? '',
    provider: new GraphAPIMetaProvider(
      new MetaGraphClient(c.env, token.token),
      status.page.id,
      status.adAccount?.id ?? '',
      sanitizeMetrics(c.env.META_PAGE_INSIGHT_METRICS),
      sanitizeMetrics(c.env.META_POST_INSIGHT_METRICS),
    ),
  };
}
export type MetaContext = Awaited<ReturnType<typeof metaContext>>;
