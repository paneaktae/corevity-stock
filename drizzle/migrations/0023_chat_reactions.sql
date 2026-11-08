CREATE TABLE chat_reactions (
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, email, emoji)
);

CREATE INDEX chat_reactions_message_idx ON chat_reactions(message_id);
