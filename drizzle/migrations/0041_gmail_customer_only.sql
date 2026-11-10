-- Only mail from possible customers is kept in the CRM. Ads, newsletters and notifications stay in
-- Gmail and are dropped on arrival. email_skipped remembers their ids for a few days so the hourly
-- re-check does not fetch them again.
CREATE TABLE email_skipped (
  id TEXT PRIMARY KEY,
  seen_at TEXT NOT NULL
);
CREATE INDEX email_skipped_seen ON email_skipped(seen_at);
ALTER TABLE gmail_sync_log ADD COLUMN dropped INTEGER NOT NULL DEFAULT 0;
-- Remember the stored non-customer ids first, then remove them (alerts cascade).
INSERT OR IGNORE INTO email_skipped(id,seen_at) SELECT id,created_at FROM email_messages WHERE classification='NOT_CUSTOMER';
DELETE FROM email_messages WHERE classification='NOT_CUSTOMER';
