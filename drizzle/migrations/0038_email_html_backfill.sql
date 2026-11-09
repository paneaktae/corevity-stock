-- Sanitized HTML body (rendered in a sandboxed frame). NULL = not fetched yet (older rows are
-- filled in when opened); '' = the email has no HTML part.
ALTER TABLE email_messages ADD COLUMN body_html TEXT;
-- Gradual backfill of the last 90 days (Inbox + Junk), a page per sync run.
ALTER TABLE gmail_connection ADD COLUMN backfill_page_token TEXT;
ALTER TABLE gmail_connection ADD COLUMN backfill_done INTEGER NOT NULL DEFAULT 0 CHECK(backfill_done IN (0,1));
CREATE INDEX email_messages_folder ON email_messages(in_spam,received_at DESC);
