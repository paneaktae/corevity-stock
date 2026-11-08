import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import { customers, leads } from './schema';
import { conversationStatuses } from '../../shared/meta-domain';
const created = { createdAt: text('created_at').notNull() };
const timestamps = { ...created, updatedAt: text('updated_at').notNull() };
export const metaOAuthStates = sqliteTable(
  'meta_oauth_states',
  {
    stateHash: text('state_hash').primaryKey().notNull(),
    actorEmail: text('actor_email').notNull(),
    sessionHash: text('session_hash').notNull(),
    generation: integer('generation').notNull(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
  },
  (t) => [index('meta_oauth_expiry').on(t.expiresAt)],
);
export const metaAtomicGuards = sqliteTable('meta_atomic_guards', {
  id: text('id').primaryKey().notNull(),
  valid: integer('valid').notNull(),
});
export const metaConversations = sqliteTable(
  'meta_conversations',
  {
    id: text('id').primaryKey().notNull(),
    mode: text('mode', { enum: ['DEMO', 'LIVE'] }).notNull(),
    pageId: text('page_id').notNull(),
    senderId: text('sender_id').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status', { enum: conversationStatuses })
      .notNull()
      .default('NEW'),
    assignedTo: text('assigned_to').notNull().default(''),
    customerId: text('customer_id').references(() => customers.id),
    lastIncomingAt: text('last_incoming_at'),
    lastMessageAt: text('last_message_at').notNull(),
    unreadCount: integer('unread_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('meta_conversations_identity').on(t.mode, t.pageId, t.senderId),
    index('meta_conversations_inbox').on(t.mode, t.lastMessageAt, t.id),
  ],
);
export const metaMessages = sqliteTable(
  'meta_messages',
  {
    id: text('id').primaryKey().notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => metaConversations.id, { onDelete: 'cascade' }),
    providerMessageId: text('provider_message_id'),
    clientRequestId: text('client_request_id'),
    actorEmail: text('actor_email'),
    direction: text('direction', { enum: ['INBOUND', 'OUTBOUND'] }).notNull(),
    body: text('body').notNull(),
    kind: text('kind', { enum: ['TEXT', 'ATTACHMENT', 'POSTBACK'] })
      .notNull()
      .default('TEXT'),
    status: text('status', {
      enum: [
        'RECEIVED',
        'PENDING',
        'SENT',
        'DELIVERED',
        'READ',
        'FAILED',
        'UNKNOWN',
        'SUPERSEDED',
      ],
    }).notNull(),
    ...created,
  },
  (t) => [
    uniqueIndex('meta_messages_provider').on(
      t.conversationId,
      t.providerMessageId,
    ),
    uniqueIndex('meta_messages_request').on(
      t.conversationId,
      t.clientRequestId,
    ),
    index('meta_messages_history').on(t.conversationId, t.createdAt, t.id),
  ],
);
export const metaReceiptWatermarks = sqliteTable(
  'meta_receipt_watermarks',
  {
    pageId: text('page_id').notNull(),
    senderId: text('sender_id').notNull(),
    deliveredAt: text('delivered_at'),
    readAt: text('read_at'),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.senderId] })],
);
export const metaConversationNotes = sqliteTable('meta_conversation_notes', {
  id: text('id').primaryKey().notNull(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => metaConversations.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  actorEmail: text('actor_email').notNull(),
  ...created,
});
export const metaCustomerIdentities = sqliteTable(
  'meta_customer_identities',
  {
    id: text('id').primaryKey().notNull(),
    provider: text('provider').notNull().default('FACEBOOK'),
    pageId: text('page_id').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('meta_customer_identity').on(
      t.provider,
      t.pageId,
      t.providerUserId,
    ),
  ],
);
export const metaLeadLinks = sqliteTable('meta_lead_links', {
  conversationId: text('conversation_id')
    .primaryKey()
    .notNull()
    .references(() => metaConversations.id),
  leadId: text('lead_id')
    .notNull()
    .unique()
    .references(() => leads.id),
  source: text('source').notNull(),
  ...created,
});
const jobFields = {
  id: text('id').primaryKey().notNull(),
  status: text('status').notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: text('next_attempt_at').notNull(),
  leaseUntil: text('lease_until'),
  leaseToken: text('lease_token'),
  errorCode: text('error_code'),
  ...created,
};
export const metaWebhookEvents = sqliteTable(
  'meta_webhook_events',
  {
    ...jobFields,
    pageId: text('page_id').notNull(),
    kind: text('kind').notNull(),
    payload: text('payload').notNull(),
    processedAt: text('processed_at'),
  },
  (t) => [
    index('meta_webhook_due').on(t.status, t.nextAttemptAt, t.leaseUntil),
  ],
);
export const metaSyncJobs = sqliteTable(
  'meta_sync_jobs',
  {
    ...jobFields,
    mode: text('mode').notNull(),
    kind: text('kind').notNull(),
    assetId: text('asset_id').notNull(),
    payload: text('payload').notNull().default('{}'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('meta_sync_asset').on(t.mode, t.kind, t.assetId),
    index('meta_sync_due').on(t.status, t.nextAttemptAt, t.leaseUntil),
  ],
);
export const metaLeadFormMappings = sqliteTable(
  'meta_lead_form_mappings',
  {
    id: text('id').primaryKey().notNull(),
    mode: text('mode').notNull(),
    pageId: text('page_id').notNull(),
    formId: text('form_id').notNull(),
    fieldMapping: text('field_mapping').notNull().default('{}'),
    assignedTo: text('assigned_to').notNull().default(''),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('meta_form_mapping').on(t.mode, t.pageId, t.formId)],
);
export const metaLeadSyncEvents = sqliteTable(
  'meta_lead_sync_events',
  {
    id: text('id').primaryKey().notNull(),
    pageId: text('page_id').notNull(),
    formId: text('form_id').notNull(),
    providerLeadId: text('provider_lead_id').notNull(),
    status: text('status').notNull(),
    leadId: text('lead_id').references(() => leads.id),
    errorCode: text('error_code'),
    ...timestamps,
  },
  (t) => [uniqueIndex('meta_lead_source').on(t.pageId, t.providerLeadId)],
);
export const metaDrafts = sqliteTable(
  'meta_drafts',
  {
    id: text('id').primaryKey().notNull(),
    mode: text('mode').notNull(),
    kind: text('kind').notNull(),
    assetId: text('asset_id').notNull(),
    payload: text('payload').notNull(),
    revision: integer('revision').notNull().default(1),
    status: text('status').notNull().default('DRAFT'),
    payloadHash: text('payload_hash').notNull(),
    reviewedBy: text('reviewed_by'),
    approvedBy: text('approved_by'),
    approvalHash: text('approval_hash'),
    approvalExpiresAt: text('approval_expires_at'),
    providerId: text('provider_id'),
    errorCode: text('error_code'),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (t) => [index('meta_drafts_mode').on(t.mode, t.kind, t.updatedAt)],
);
export const metaInsightsCache = sqliteTable(
  'meta_insights_cache',
  {
    cacheKey: text('cache_key').primaryKey().notNull(),
    mode: text('mode').notNull(),
    assetId: text('asset_id').notNull(),
    data: text('data').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('meta_insights_expiry').on(t.expiresAt)],
);
export const metaCampaignCache = sqliteTable(
  'meta_campaign_cache',
  {
    id: text('id').primaryKey().notNull(),
    mode: text('mode').notNull(),
    accountId: text('account_id').notNull(),
    data: text('data').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('meta_campaign_cache_asset').on(t.mode, t.accountId, t.id),
  ],
);
export const metaOperationAuditLogs = sqliteTable(
  'meta_operation_audit_logs',
  {
    id: text('id').primaryKey().notNull(),
    mode: text('mode').notNull(),
    actorEmail: text('actor_email').notNull(),
    action: text('action').notNull(),
    entityId: text('entity_id').notNull(),
    outcome: text('outcome').notNull(),
    ...created,
  },
  (t) => [index('meta_operation_audit_created').on(t.createdAt, t.id)],
);
export const metaDemoEntities = sqliteTable('meta_demo_entities', {
  id: text('id').primaryKey().notNull(),
  kind: text('kind').notNull(),
  data: text('data').notNull(),
  ...created,
});
export const metaAiDrafts = sqliteTable('meta_ai_drafts', {
  id: text('id').primaryKey().notNull(),
  mode: text('mode').notNull(),
  conversationId: text('conversation_id'),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  contextHash: text('context_hash').notNull(),
  status: text('status').notNull().default('DRAFT'),
  createdBy: text('created_by').notNull(),
  approvedBy: text('approved_by'),
  ...created,
  approvedAt: text('approved_at'),
});
export const metaRateLimits = sqliteTable('meta_rate_limits', {
  bucket: text('bucket').primaryKey().notNull(),
  windowStart: integer('window_start').notNull(),
  attempts: integer('attempts').notNull(),
});

export const metaMessengerAutomationSettings = sqliteTable(
  'meta_messenger_automation_settings',
  {
    pageId: text('page_id').primaryKey().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    welcomeText: text('welcome_text').notNull(),
    contactLabel: text('contact_label').notNull(),
    acknowledgmentText: text('acknowledgment_text').notNull(),
    defaultSalespersonEmail: text('default_salesperson_email')
      .notNull()
      .default(''),
    updatedBy: text('updated_by').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
);
export const metaMessengerAutomationJobs = sqliteTable(
  'meta_messenger_automation_jobs',
  {
    ...jobFields,
    dedupeKey: text('dedupe_key').notNull().unique(),
    pageId: text('page_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => metaConversations.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['WELCOME', 'CONTACT_ACK', 'SALES_LINE'],
    }).notNull(),
    messageId: text('message_id').references(() => metaMessages.id, {
      onDelete: 'set null',
    }),
    recipientEmail: text('recipient_email').notNull().default(''),
    lineUserId: text('line_user_id').notNull().default(''),
    payload: text('payload').notNull().default('{}'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('meta_messenger_automation_due').on(t.status, t.nextAttemptAt)],
);
