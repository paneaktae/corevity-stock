ALTER TABLE chat_messages ADD COLUMN mentions TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(mentions));

CREATE TABLE chat_mention_notifications (
  id TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  sent_at TEXT,
  last_error TEXT,
  UNIQUE(message_id, email)
);

CREATE INDEX chat_mention_notifications_due_idx
  ON chat_mention_notifications(status, next_attempt_at, lease_until);
