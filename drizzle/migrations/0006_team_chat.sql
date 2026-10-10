CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body)<=2000),
  product_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(product_ids)),
  created_at TEXT NOT NULL,
  UNIQUE(sender_email, request_id)
);
