ALTER TABLE catalogs ADD COLUMN assigned_salesperson_email TEXT NOT NULL DEFAULT '';
CREATE INDEX catalogs_assigned_salesperson ON catalogs(assigned_salesperson_email,status,updated_at DESC);

CREATE TABLE catalog_chats (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  catalog_slug TEXT NOT NULL DEFAULT '',
  catalog_title TEXT NOT NULL DEFAULT '',
  assigned_email TEXT NOT NULL DEFAULT '',
  visitor_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL
);
CREATE INDEX catalog_chats_assigned ON catalog_chats(assigned_email,status,last_message_at DESC);
CREATE INDEX catalog_chats_updated ON catalog_chats(status,last_message_at DESC);

CREATE TABLE catalog_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL REFERENCES catalog_chats(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK(sender_type IN ('VISITOR','SALESPERSON')),
  sender_email TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL CHECK(length(body)<=2000),
  products TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(products)),
  created_at TEXT NOT NULL
);
CREATE INDEX catalog_chat_messages_chat ON catalog_chat_messages(chat_id,id);

CREATE TABLE catalog_chat_rate_limits (
  visitor_hash TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('thread','message')),
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(visitor_hash,scope,window_start)
);
CREATE INDEX catalog_chat_rate_limits_window ON catalog_chat_rate_limits(window_start);
