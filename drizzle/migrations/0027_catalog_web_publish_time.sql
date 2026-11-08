ALTER TABLE catalogs ADD COLUMN published_to_web_at TEXT;
CREATE INDEX catalogs_web_published ON catalogs(publish_to_web,status,published_to_web_at DESC);
