import { z } from 'zod';

export const metaConnectionStates = [
  'NOT_CONFIGURED',
  'CONFIGURATION_INCOMPLETE',
  'READY_TO_CONNECT',
  'CONNECTING',
  'CONNECTED',
  'TOKEN_EXPIRED',
  'PERMISSION_REQUIRED',
  'RECONNECT_REQUIRED',
  'ERROR',
  'DISCONNECTED',
] as const;
export const metaStateSchema = z.enum(metaConnectionStates);
export type MetaConnectionState = z.infer<typeof metaStateSchema>;
export const metaFlagNames = [
  'META_INTEGRATION_ENABLED',
  'META_DEMO_MODE',
  'META_MESSENGER_ENABLED',
  'META_LEADS_ENABLED',
  'META_ADS_READ_ENABLED',
  'META_ADS_WRITE_ENABLED',
  'META_AI_ENABLED',
  'META_PAGE_CONTENT_ENABLED',
] as const;
export type MetaFlags = Record<(typeof metaFlagNames)[number], boolean>;
export type MetaMode = 'DEMO' | 'LIVE';

export const metaSettingsInput = z
  .object({
    // Secrets, flags, permissions and connection state cannot be changed here.
    demoEnabled: z.boolean(),
  })
  .strict();

export interface MetaStatus {
  mode: MetaMode;
  label: 'DEMO MODE' | 'LIVE MODE';
  enabled: boolean;
  state: MetaConnectionState;
  message: string;
  flags: MetaFlags;
  configuration: { ready: boolean; missing: string[]; invalid: string[] };
  page: { id: string; name: string; profileImageUrl: string | null } | null;
  adAccount: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
  } | null;
  permissions: { granted: string[]; missing: string[] };
  integrationError: {
    code:
      | 'PROVIDER_ERROR'
      | 'RATE_LIMITED'
      | 'NETWORK_ERROR'
      | 'PERMISSION_DENIED';
    message: string;
  } | null;
  tokenHealth:
    | 'NOT_CONFIGURED'
    | 'NOT_VALIDATED'
    | 'VALID'
    | 'EXPIRED'
    | 'REVOKED'
    | 'DEMO';
  lastSyncedAt: string | null;
  lastWebhookAt: string | null;
  capabilities: {
    manageIntegration: boolean;
    useDemo: boolean;
    connect: boolean;
    readMessenger: boolean;
    sendMessage: boolean;
    syncLeads: boolean;
    readAds: boolean;
    writeAds: boolean;
    useAI: boolean;
    publishContent: boolean;
    readPageInsights: boolean;
    readContent: boolean;
  };
  implementation: 'FOUNDATION_ONLY' | 'READY_FOR_META_CONFIGURATION' | 'ACTIVE';
}
