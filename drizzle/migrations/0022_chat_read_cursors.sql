CREATE TABLE chat_read_cursors (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  last_read_message_id INTEGER NOT NULL DEFAULT 0 CHECK(last_read_message_id >= 0),
  updated_at TEXT NOT NULL
);
