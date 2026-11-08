ALTER TABLE meta_connections ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meta_connections ADD COLUMN provider_user_id TEXT;
CREATE TABLE meta_oauth_states (
 state_hash TEXT PRIMARY KEY NOT NULL, actor_email TEXT NOT NULL, session_hash TEXT NOT NULL,
 generation INTEGER NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT
);
CREATE INDEX meta_oauth_expiry ON meta_oauth_states(expires_at);
CREATE TABLE meta_atomic_guards(id TEXT PRIMARY KEY NOT NULL, valid INTEGER NOT NULL CHECK(valid=1));
CREATE TABLE meta_conversations (
 id TEXT PRIMARY KEY NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('DEMO','LIVE')),
 page_id TEXT NOT NULL, sender_id TEXT NOT NULL, display_name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','OPEN','WAITING_CUSTOMER','FOLLOW_UP','CLOSED')),
 assigned_to TEXT NOT NULL DEFAULT '', customer_id TEXT REFERENCES customers(id),
 last_incoming_at TEXT, last_message_at TEXT NOT NULL, unread_count INTEGER NOT NULL DEFAULT 0 CHECK(unread_count>=0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(mode,page_id,sender_id),
 CHECK(mode='LIVE' OR customer_id IS NULL)
);
CREATE INDEX meta_conversations_inbox ON meta_conversations(mode,last_message_at DESC,id);
CREATE TABLE meta_messages (
 id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL REFERENCES meta_conversations(id) ON DELETE CASCADE,
 provider_message_id TEXT, client_request_id TEXT, actor_email TEXT,
 direction TEXT NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')),
 body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'TEXT' CHECK(kind IN ('TEXT','ATTACHMENT','POSTBACK')),
 status TEXT NOT NULL CHECK(status IN ('RECEIVED','PENDING','SENT','DELIVERED','READ','FAILED','UNKNOWN','SUPERSEDED')),
 created_at TEXT NOT NULL, UNIQUE(conversation_id,provider_message_id), UNIQUE(conversation_id,client_request_id)
);
CREATE INDEX meta_messages_history ON meta_messages(conversation_id,created_at,id);
CREATE TABLE meta_receipt_watermarks (
 page_id TEXT NOT NULL,sender_id TEXT NOT NULL,delivered_at TEXT,read_at TEXT,
 PRIMARY KEY(page_id,sender_id)
);
CREATE TABLE meta_conversation_notes (
 id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL REFERENCES meta_conversations(id) ON DELETE CASCADE,
 body TEXT NOT NULL, actor_email TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE meta_customer_identities (
 id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL DEFAULT 'FACEBOOK' CHECK(provider='FACEBOOK'),
 page_id TEXT NOT NULL, provider_user_id TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(provider,page_id,provider_user_id)
);
CREATE TABLE meta_lead_links (
 conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES meta_conversations(id),
 lead_id TEXT NOT NULL UNIQUE REFERENCES leads(id),
 source TEXT NOT NULL CHECK(source='FACEBOOK_MESSENGER'), created_at TEXT NOT NULL
);
CREATE TABLE meta_webhook_events (
 id TEXT PRIMARY KEY NOT NULL, page_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','PROCESSED','FAILED','IGNORED')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, lease_until TEXT, lease_token TEXT,
 error_code TEXT, created_at TEXT NOT NULL, processed_at TEXT
);
CREATE INDEX meta_webhook_due ON meta_webhook_events(status,next_attempt_at,lease_until);
CREATE TABLE meta_sync_jobs (
 id TEXT PRIMARY KEY NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('DEMO','LIVE')),
 kind TEXT NOT NULL CHECK(kind IN ('LEAD_IMPORT','TOKEN_CHECK')), asset_id TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','SYNCED','FAILED')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, lease_until TEXT, lease_token TEXT,
 error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(mode,kind,asset_id)
);
CREATE INDEX meta_sync_due ON meta_sync_jobs(status,next_attempt_at,lease_until);
CREATE TABLE meta_lead_form_mappings (
 id TEXT PRIMARY KEY NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('DEMO','LIVE')),
 page_id TEXT NOT NULL, form_id TEXT NOT NULL, field_mapping TEXT NOT NULL DEFAULT '{}',
 assigned_to TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(mode,page_id,form_id)
);
CREATE TABLE meta_lead_sync_events (
 id TEXT PRIMARY KEY NOT NULL, page_id TEXT NOT NULL, form_id TEXT NOT NULL, provider_lead_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('SYNCED','DUPLICATE','FAILED','PENDING')),
 lead_id TEXT REFERENCES leads(id), error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(page_id,provider_lead_id)
);
CREATE TABLE meta_drafts (
 id TEXT PRIMARY KEY NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('DEMO','LIVE')),
 kind TEXT NOT NULL CHECK(kind IN ('CAMPAIGN','CAMPAIGN_UPDATE','CAMPAIGN_STATUS','POST')),
 asset_id TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','VALIDATION','REVIEW','CONFIRMATION','PUBLISHING','PUBLISHED','FAILED','UNKNOWN')),
 payload_hash TEXT NOT NULL, reviewed_by TEXT, approved_by TEXT, approval_hash TEXT, approval_expires_at TEXT,
 provider_id TEXT, error_code TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX meta_drafts_mode ON meta_drafts(mode,kind,updated_at DESC);
CREATE TABLE meta_insights_cache (
 cache_key TEXT PRIMARY KEY NOT NULL, mode TEXT NOT NULL, asset_id TEXT NOT NULL,
 data TEXT NOT NULL, fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX meta_insights_expiry ON meta_insights_cache(expires_at);
CREATE TABLE meta_campaign_cache (
 id TEXT PRIMARY KEY NOT NULL, mode TEXT NOT NULL, account_id TEXT NOT NULL,
 data TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(mode,account_id,id)
);
CREATE TABLE meta_operation_audit_logs (
 id TEXT PRIMARY KEY NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('DEMO','LIVE')),
 actor_email TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT NOT NULL, outcome TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX meta_operation_audit_created ON meta_operation_audit_logs(created_at DESC,id);
CREATE TABLE meta_demo_entities (
 id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE meta_ai_drafts (
 id TEXT PRIMARY KEY NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('DEMO','LIVE')), conversation_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('REPLY','SUMMARY','TRANSLATION','ADS','CAPTION')),
 content TEXT NOT NULL, context_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED')),
 created_by TEXT NOT NULL, approved_by TEXT, created_at TEXT NOT NULL, approved_at TEXT
);
CREATE TABLE meta_rate_limits (
 bucket TEXT PRIMARY KEY NOT NULL, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL
);

CREATE INDEX meta_receipt_event_lookup ON meta_webhook_events(page_id,kind,created_at);
