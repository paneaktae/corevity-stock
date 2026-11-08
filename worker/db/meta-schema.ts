import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/sqlite-core';
import { metaConnectionStates } from '../../shared/meta';

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
};
export const metaConnections = sqliteTable('meta_connections', {
  id: text('id').primaryKey().notNull(),
  mode: text('mode', { enum: ['LIVE', 'DEMO'] })
    .notNull()
    .unique(),
  status: text('status', { enum: metaConnectionStates })
    .notNull()
    .default('DISCONNECTED'),
  connectedBy: text('connected_by').notNull(),
    generation: integer('generation').notNull().default(0),
    providerUserId: text('provider_user_id'),
  connectedAt: text('connected_at'),
  disconnectedAt: text('disconnected_at'),
  lastSyncedAt: text('last_synced_at'),
  lastWebhookAt: text('last_webhook_at'),
  errorCode: text('error_code', {
    enum: [
      'PROVIDER_ERROR',
      'RATE_LIMITED',
      'NETWORK_ERROR',
      'PERMISSION_DENIED',
    ],
  }),
  ...timestamps,
});
export const metaPages = sqliteTable(
  'meta_pages',
  {
    id: text('id').primaryKey().notNull(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'cascade' }),
    providerPageId: text('provider_page_id').notNull(),
    name: text('name').notNull(),
    profileImageUrl: text('profile_image_url'),
    selected: integer('selected', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('meta_pages_provider').on(t.connectionId, t.providerPageId),
    uniqueIndex('meta_pages_selected')
      .on(t.connectionId)
      .where(sql`${t.selected}=1`),
  ],
);
export const metaAdAccounts = sqliteTable(
  'meta_ad_accounts',
  {
    id: text('id').primaryKey().notNull(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'cascade' }),
    providerAccountId: text('provider_account_id').notNull(),
    name: text('name').notNull(),
    currency: text('currency').notNull(),
    timezone: text('timezone').notNull(),
    selected: integer('selected', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('meta_ad_accounts_provider').on(
      t.connectionId,
      t.providerAccountId,
    ),
    uniqueIndex('meta_ad_accounts_selected')
      .on(t.connectionId)
      .where(sql`${t.selected}=1`),
  ],
);
export const metaPermissions = sqliteTable(
  'meta_permissions',
  {
    id: text('id').primaryKey().notNull(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    assetId: text('asset_id').notNull().default(''),
    status: text('status', {
      enum: ['GRANTED', 'DECLINED', 'EXPIRED', 'REVOKED'],
    }).notNull(),
    checkedAt: text('checked_at').notNull(),
  },
  (t) => [
    uniqueIndex('meta_permissions_asset').on(
      t.connectionId,
      t.permission,
      t.assetId,
    ),
  ],
);
export const metaTokenMetadata = sqliteTable(
  'meta_token_metadata',
  {
    id: text('id').primaryKey().notNull(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'cascade' }),
    tokenType: text('token_type', {
      enum: ['USER', 'PAGE', 'SYSTEM_USER'],
    }).notNull(),
    assetId: text('asset_id').notNull().default(''),
    issuedAt: text('issued_at'),
    expiresAt: text('expires_at'),
    dataAccessExpiresAt: text('data_access_expires_at'),
    lastValidatedAt: text('last_validated_at'),
    revokedAt: text('revoked_at'),
    permissionStatus: text('permission_status', {
      enum: ['UNKNOWN', 'GRANTED', 'MISSING', 'REVOKED'],
    })
      .notNull()
      .default('UNKNOWN'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('meta_token_metadata_asset').on(
      t.connectionId,
      t.tokenType,
      t.assetId,
    ),
  ],
);
export const metaTokenSecrets = sqliteTable('meta_token_secrets', {
  tokenId: text('token_id')
    .primaryKey()
    .notNull()
    .references(() => metaTokenMetadata.id, { onDelete: 'cascade' }),
  ciphertext: text('ciphertext').notNull(),
  nonce: text('nonce').notNull(),
  keyVersion: text('key_version').notNull(),
  algorithm: text('algorithm', { enum: ['AES-GCM'] })
    .notNull()
    .default('AES-GCM'),
  ...timestamps,
});
export const metaIntegrationSettings = sqliteTable(
  'meta_integration_settings',
  {
    id: text('id').primaryKey().notNull(),
    demoEnabled: integer('demo_enabled', { mode: 'boolean' })
      .notNull()
      .default(false),
    updatedBy: text('updated_by').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [check('meta_settings_singleton', sql`${t.id}='workspace'`)],
);
export const metaAuditLogs = sqliteTable(
  'meta_audit_logs',
  {
    id: text('id').primaryKey().notNull(),
    mode: text('mode', { enum: ['LIVE', 'DEMO'] }).notNull(),
    actorEmail: text('actor_email').notNull(),
    action: text('action', {
      enum: [
        'SETTINGS_UPDATED',
        'CONNECTION_STARTED',
        'CONNECTION_COMPLETED',
        'CONNECTION_DISCONNECTED',
        'TOKEN_VALIDATED',
        'OPERATION_REJECTED',
      ],
    }).notNull(),
    outcome: text('outcome', {
      enum: ['SUCCESS', 'DENIED', 'FAILED'],
    }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('meta_audit_logs_created').on(t.createdAt, t.id)],
);
