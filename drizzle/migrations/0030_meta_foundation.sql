-- Additive foundation only. No credentials or Demo fixtures are seeded.
CREATE TABLE meta_connections (
  id TEXT PRIMARY KEY NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('LIVE','DEMO')),
  status TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK(status IN ('NOT_CONFIGURED','CONFIGURATION_INCOMPLETE','READY_TO_CONNECT','CONNECTING','CONNECTED','TOKEN_EXPIRED','PERMISSION_REQUIRED','RECONNECT_REQUIRED','ERROR','DISCONNECTED')),
  connected_by TEXT NOT NULL,
  connected_at TEXT,
  disconnected_at TEXT,
  last_synced_at TEXT,
  last_webhook_at TEXT,
  error_code TEXT CHECK(error_code IS NULL OR error_code IN ('PROVIDER_ERROR','RATE_LIMITED','NETWORK_ERROR','PERMISSION_DENIED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(mode)
);
CREATE TABLE meta_pages (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  provider_page_id TEXT NOT NULL,
  name TEXT NOT NULL,
  profile_image_url TEXT,
  selected INTEGER NOT NULL DEFAULT 0 CHECK(selected IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connection_id,provider_page_id)
);
CREATE UNIQUE INDEX meta_pages_selected ON meta_pages(connection_id) WHERE selected=1;
CREATE TABLE meta_ad_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  provider_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  timezone TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 0 CHECK(selected IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connection_id,provider_account_id)
);
CREATE UNIQUE INDEX meta_ad_accounts_selected ON meta_ad_accounts(connection_id) WHERE selected=1;
CREATE TABLE meta_permissions (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  asset_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('GRANTED','DECLINED','EXPIRED','REVOKED')),
  checked_at TEXT NOT NULL,
  UNIQUE(connection_id,permission,asset_id)
);
CREATE TABLE meta_token_metadata (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  token_type TEXT NOT NULL CHECK(token_type IN ('USER','PAGE','SYSTEM_USER')),
  asset_id TEXT NOT NULL DEFAULT '',
  issued_at TEXT,
  expires_at TEXT,
  data_access_expires_at TEXT,
  last_validated_at TEXT,
  revoked_at TEXT,
  permission_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(permission_status IN ('UNKNOWN','GRANTED','MISSING','REVOKED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connection_id,token_type,asset_id)
);
CREATE TABLE meta_token_secrets (
  token_id TEXT PRIMARY KEY NOT NULL REFERENCES meta_token_metadata(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL CHECK(length(ciphertext)>=24),
  nonce TEXT NOT NULL CHECK(length(nonce)=16),
  key_version TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'AES-GCM' CHECK(algorithm='AES-GCM'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE meta_integration_settings (
  id TEXT PRIMARY KEY NOT NULL CHECK(id='workspace'),
  demo_enabled INTEGER NOT NULL DEFAULT 0 CHECK(demo_enabled IN (0,1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE meta_audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('LIVE','DEMO')),
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('SETTINGS_UPDATED','CONNECTION_STARTED','CONNECTION_COMPLETED','CONNECTION_DISCONNECTED','TOKEN_VALIDATED','OPERATION_REJECTED')),
  outcome TEXT NOT NULL CHECK(outcome IN ('SUCCESS','DENIED','FAILED')),
  created_at TEXT NOT NULL
);
CREATE INDEX meta_audit_logs_created ON meta_audit_logs(created_at DESC,id DESC);
