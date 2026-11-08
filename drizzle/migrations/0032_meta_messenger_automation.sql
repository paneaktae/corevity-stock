CREATE TABLE meta_messenger_automation_settings (
 page_id TEXT PRIMARY KEY NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 welcome_text TEXT NOT NULL,
 contact_label TEXT NOT NULL,
 acknowledgment_text TEXT NOT NULL,
 default_salesperson_email TEXT NOT NULL DEFAULT '',
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE meta_messenger_automation_jobs (
 id TEXT PRIMARY KEY NOT NULL,
 dedupe_key TEXT NOT NULL UNIQUE,
 page_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL REFERENCES meta_conversations(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('WELCOME','CONTACT_ACK','SALES_LINE')),
 message_id TEXT REFERENCES meta_messages(id) ON DELETE SET NULL,
 recipient_email TEXT NOT NULL DEFAULT '',
 line_user_id TEXT NOT NULL DEFAULT '',
 payload TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','SENT','FAILED','UNKNOWN','CANCELLED')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL,
 lease_until TEXT,
 lease_token TEXT,
 error_code TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX meta_messenger_automation_due ON meta_messenger_automation_jobs(status,next_attempt_at);
