ALTER TABLE catalogs ADD COLUMN publish_to_web INTEGER NOT NULL DEFAULT 0 CHECK(publish_to_web IN (0,1));
