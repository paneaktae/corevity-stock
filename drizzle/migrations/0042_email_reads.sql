-- Which salesperson has opened which email in the CRM (drives the unread badge on the menu).
-- One row per (message, person); removed with the message.
CREATE TABLE email_reads (
  message_id TEXT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (message_id, email)
);
CREATE INDEX email_reads_person ON email_reads(email);
