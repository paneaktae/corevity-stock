ALTER TABLE leads ADD COLUMN assigned_to TEXT NOT NULL DEFAULT '';
CREATE INDEX leads_followup_owner ON leads(assigned_to, next_follow_up_at);
CREATE TABLE line_accounts (
 email TEXT PRIMARY KEY, line_user_id TEXT NOT NULL UNIQUE,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), linked_at TEXT NOT NULL
);
CREATE TABLE line_link_codes (
 email TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL
);
CREATE TABLE line_reminders (
 id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id),
 appointment_at TEXT NOT NULL, email TEXT NOT NULL, line_user_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
 next_attempt_at TEXT NOT NULL, lease_until TEXT, sent_at TEXT, last_error TEXT,
 UNIQUE(lead_id, appointment_at, email, line_user_id)
);
CREATE INDEX line_reminders_pending ON line_reminders(status, next_attempt_at);
