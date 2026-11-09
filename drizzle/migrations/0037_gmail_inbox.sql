-- Read-only Gmail inbox for the company mailbox (one connection per workspace).
-- The refresh token is stored AES-GCM encrypted; nothing here can send or change mail.
CREATE TABLE gmail_connection (
  id TEXT PRIMARY KEY CHECK(id='workspace'),
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('CONNECTED','RECONNECT_REQUIRED')),
  token_ciphertext TEXT NOT NULL,
  token_nonce TEXT NOT NULL,
  token_key_version TEXT NOT NULL,
  history_id TEXT,
  ai_classify INTEGER NOT NULL DEFAULT 0 CHECK(ai_classify IN (0,1)),
  connected_by TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  last_sync_at TEXT,
  last_error TEXT,
  last_sweep_at TEXT,
  health_alerted_at TEXT,
  sync_lease_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE gmail_oauth_states (
  state_hash TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

-- Inbox and Junk (Spam) mail, kept for 90 days (see worker/services/gmail.ts). Body is plain text only.
CREATE TABLE email_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL,
  to_text TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  classification TEXT NOT NULL CHECK(classification IN ('CUSTOMER','NOT_CUSTOMER')),
  reason TEXT NOT NULL DEFAULT '',
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  in_spam INTEGER NOT NULL DEFAULT 0 CHECK(in_spam IN (0,1)),
  notified INTEGER NOT NULL DEFAULT 0 CHECK(notified IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX email_messages_received ON email_messages(received_at DESC);
CREATE INDEX email_messages_customer ON email_messages(classification,received_at DESC);

CREATE TABLE email_notifications (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(message_id,email)
);
CREATE INDEX email_notifications_due ON email_notifications(status,next_attempt_at);
