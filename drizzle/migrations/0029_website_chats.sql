ALTER TABLE catalog_chats ADD COLUMN source TEXT NOT NULL DEFAULT 'CATALOG' CHECK(source IN ('CATALOG','WEBSITE'));
ALTER TABLE catalog_chats ADD COLUMN visitor_email TEXT NOT NULL DEFAULT '';
CREATE INDEX catalog_chats_source_last_message ON catalog_chats(source,last_message_at DESC);
