import type { MetaStatus } from '../../../shared/meta';
import { MetaGraphClient, object, string, providerId } from './graph';

export type MetaResource =
  | 'campaigns'
  | 'adsets'
  | 'ads'
  | 'insights'
  | 'forms'
  | 'formLeads'
  | 'pageInsights'
  | 'postInsights'
  | 'posts';
export type MetaWrite =
  'message' | 'campaign' | 'campaignUpdate' | 'post' | 'subscribe';
export type ProviderPage = {
  data: Record<string, unknown>[];
  after: string | null;
};

export interface MetaProvider {
  readonly mode: 'DEMO' | 'LIVE';
  summary(): Promise<Pick<MetaStatus, 'page' | 'adAccount'>>;
  list(
    resource: MetaResource,
    params?: Record<string, string>,
  ): Promise<ProviderPage>;
  write(
    operation: MetaWrite,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>>;
  lead(id: string): Promise<Record<string, unknown>>;
}

// No HTTP client, credentials, database or CRM side effects in the mock adapter.
export class MockMetaProvider implements MetaProvider {
  readonly mode = 'DEMO';
  async summary() {
    return {
      page: {
        id: 'demo:page',
        name: 'Corevity Demo Page (simulated)',
        profileImageUrl: null,
      },
      adAccount: {
        id: 'demo:ad-account',
        name: 'Demo ad account (simulated)',
        currency: 'THB',
        timezone: 'Asia/Bangkok',
      },
    };
  }
  async list(resource: MetaResource): Promise<ProviderPage> {
    const data: Record<MetaResource, Record<string, unknown>[]> = {
      campaigns: [
        {
          id: 'demo:campaign-1',
          name: 'Demo · Cardio equipment',
          status: 'PAUSED',
          objective: 'OUTCOME_LEADS',
          daily_budget: '50000',
        },
        {
          id: 'demo:campaign-2',
          name: 'Demo · Strength equipment',
          status: 'PAUSED',
          objective: 'OUTCOME_TRAFFIC',
          daily_budget: '30000',
        },
      ],
      adsets: [
        {
          id: 'demo:adset',
          name: 'Demo ad set',
          campaign_id: 'demo:campaign-1',
          status: 'PAUSED',
          daily_budget: '50000',
          targeting: { geo_locations: { countries: ['TH'] } },
        },
      ],
      ads: [
        {
          id: 'demo:ad',
          name: 'Demo product ad',
          status: 'PAUSED',
          campaign_id: 'demo:campaign-1',
          adset_id: 'demo:adset',
        },
      ],
      insights: [
        {
          campaign_id: 'demo:campaign-1',
          campaign_name: 'Demo · Cardio equipment',
          spend: '4820',
          impressions: '12400',
          clicks: '380',
          actions: [{ action_type: 'lead', value: '18' }],
          account_currency: 'THB',
        },
        {
          campaign_id: 'demo:campaign-2',
          campaign_name: 'Demo · Strength equipment',
          spend: '3150',
          impressions: '8900',
          clicks: '190',
          actions: [{ action_type: 'lead', value: '11' }],
          account_currency: 'THB',
        },
      ],
      forms: [
        {
          id: 'demo:form',
          name: 'Demo equipment inquiry',
          status: 'ACTIVE',
          questions: [
            { key: 'full_name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'equipment', label: 'Interested equipment' },
          ],
        },
      ],
      formLeads: [
        {
          id: 'demo:lead',
          form_id: 'demo:form',
          created_time: '2026-10-18T00:00:00Z',
          field_data: [
            { name: 'full_name', values: ['Demo inquiry'] },
            { name: 'email', values: ['demo@example.test'] },
            { name: 'equipment', values: ['Treadmill'] },
          ],
        },
      ],
      pageInsights: [
        {
          name: 'demo_reach',
          period: 'day',
          values: [{ value: 1280, end_time: '2026-10-18T00:00:00Z' }],
        },
        {
          name: 'demo_engagement',
          period: 'day',
          values: [{ value: 96, end_time: '2026-10-18T00:00:00Z' }],
        },
      ],
      postInsights: [
        {
          name: 'demo_post_engagement',
          period: 'lifetime',
          values: [{ value: 42 }],
        },
      ],
      posts: [
        {
          id: 'demo:post',
          message: 'Demo equipment update. This post was never published.',
          created_time: '2026-10-18T00:00:00Z',
          is_published: false,
        },
      ],
    };
    return { data: structuredClone(data[resource]), after: null };
  }
  async write(
    operation: MetaWrite,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    return {
      id: 'demo:' + operation + ':' + crypto.randomUUID(),
      message_id:
        operation === 'message'
          ? 'demo:mid:' + params.clientRequestId
          : undefined,
      success: true,
      simulated: true,
    };
  }
  async lead() {
    return (await this.list('formLeads')).data[0];
  }
}

// Live access requires explicit activation and fresh OAuth/permission verification.
// A syntactically complete config is never proof of a valid Meta connection.
export class GraphAPIMetaProvider implements MetaProvider {
  readonly mode = 'LIVE';
  constructor(
    private client?: MetaGraphClient,
    private pageId = '',
    private accountId = '',
    private pageMetrics = '',
    private postMetrics = '',
  ) {}
  async summary(): Promise<Pick<MetaStatus, 'page' | 'adAccount'>> {
    if (!this.client) throw new Error('META_NOT_CONFIGURED');
    const page = await this.client.request(providerId(this.pageId), {
      fields: 'id,name,picture{url}',
    });
    return {
      page: {
        id: string(page.id),
        name: string(page.name),
        profileImageUrl: string(object(object(page.picture).data).url) || null,
      },
      adAccount: null,
    };
  }
  async list(
    resource: MetaResource,
    params: Record<string, string> = {},
  ): Promise<ProviderPage> {
    if (!this.client) throw new Error('META_NOT_CONFIGURED');
    const page = () => providerId(this.pageId),
      account = () => providerId(this.accountId);
    const cursor: Record<string, string> = params.after
      ? { after: params.after }
      : {};
    if (resource === 'campaigns')
      return this.client.list(account() + '/campaigns', {
        fields: 'id,name,status,objective,daily_budget,lifetime_budget',
        ...cursor,
      });
    if (resource === 'adsets')
      return this.client.list(account() + '/adsets', {
        fields:
          'id,name,campaign_id,status,daily_budget,lifetime_budget,targeting,optimization_goal',
        ...cursor,
      });
    if (resource === 'ads')
      return this.client.list(account() + '/ads', {
        fields: 'id,name,campaign_id,adset_id,status,creative{id,name}',
        ...cursor,
      });
    if (resource === 'forms')
      return this.client.list(page() + '/leadgen_forms', {
        fields: 'id,name,status,questions',
        ...cursor,
      });
    if (resource === 'formLeads')
      return this.client.list(providerId(params.formId) + '/leads', {
        fields: 'id,created_time,form_id,field_data',
        ...cursor,
      });
    if (resource === 'posts')
      return this.client.list(page() + '/published_posts', {
        fields: 'id,message,created_time,permalink_url',
        ...cursor,
      });
    if (resource === 'postInsights') {
      if (!this.postMetrics) return { data: [], after: null };
      if (!new RegExp('^' + page() + '_\\d+$').test(params.postId))
        throw new Error('META_ASSET_NOT_AUTHORIZED');
      return this.client.list(params.postId + '/insights', {
        metric: this.postMetrics,
        period: 'lifetime',
        ...cursor,
      });
    }
    if (resource === 'pageInsights') {
      if (!this.pageMetrics) return { data: [], after: null };
      return this.client.list(page() + '/insights', {
        metric: this.pageMetrics,
        period: 'day',
        since: params.since,
        until: params.until,
        ...cursor,
      });
    }
    return this.client.list(account() + '/insights', {
      fields:
        'campaign_id,campaign_name,spend,impressions,clicks,actions,account_currency',
      level: 'campaign',
      time_range: JSON.stringify({ since: params.since, until: params.until }),
      use_account_attribution_setting: 'true',
      ...cursor,
    });
  }
  async write(operation: MetaWrite, params: Record<string, string>) {
    if (!this.client) throw new Error('META_NOT_CONFIGURED');
    if (operation === 'message')
      return this.client.request(
        providerId(this.pageId) + '/messages',
        {
          recipient: JSON.stringify({ id: providerId(params.recipient) }),
          messaging_type: 'RESPONSE',
          message: JSON.stringify({
            text: params.text,
            metadata: params.clientRequestId,
          }),
        },
        'POST',
      );
    if (operation === 'campaign')
      return this.client.request(
        providerId(this.accountId) + '/campaigns',
        {
          name: params.name,
          objective: params.objective,
          special_ad_categories: params.special_ad_categories,
          status: 'PAUSED',
          buying_type: 'AUCTION',
        },
        'POST',
      );
    if (operation === 'campaignUpdate') {
      const remote = await this.client.request(providerId(params.campaignId), {
        fields: 'id,account_id',
      });
      if (string(remote.account_id) !== this.accountId.replace(/^act_/, ''))
        throw new Error('META_ASSET_NOT_AUTHORIZED');
      return this.client.request(
        providerId(params.campaignId),
        params.status ? { status: params.status } : { name: params.name },
        'POST',
      );
    }
    if (operation === 'subscribe')
      return this.client.request(
        providerId(this.pageId) + '/subscribed_apps',
        { subscribed_fields: params.fields },
        'POST',
      );
    const scheduled: Record<string, string> = params.scheduledAt
      ? {
          published: 'false',
          scheduled_publish_time: String(
            Math.floor(Date.parse(params.scheduledAt) / 1000),
          ),
        }
      : {};
    return params.imageUrl
      ? this.client.request(
          providerId(this.pageId) + '/photos',
          { url: params.imageUrl, caption: params.message, ...scheduled },
          'POST',
        )
      : this.client.request(
          providerId(this.pageId) + '/feed',
          { message: params.message, ...scheduled },
          'POST',
        );
  }
  async lead(id: string) {
    if (!this.client) throw new Error('META_NOT_CONFIGURED');
    return this.client.request(providerId(id), {
      fields: 'id,created_time,form_id,field_data',
    });
  }
}
