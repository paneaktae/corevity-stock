-- When someone replied from the company mailbox in the same Gmail thread (latest reply time).
ALTER TABLE email_messages ADD COLUMN replied_at TEXT;
CREATE INDEX email_messages_thread ON email_messages(thread_id);
-- One-time backfill of sent mail (last 90 days) so older conversations show as replied.
ALTER TABLE gmail_connection ADD COLUMN sent_backfill_token TEXT;
ALTER TABLE gmail_connection ADD COLUMN sent_backfill_done INTEGER NOT NULL DEFAULT 0 CHECK(sent_backfill_done IN (0,1));
