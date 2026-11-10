-- Where a Catalog shows product prices: on the private share link and/or on the website.
-- Existing Catalogs keep today's behaviour (private link shows prices, website does not).
ALTER TABLE catalogs ADD COLUMN show_price_private INTEGER NOT NULL DEFAULT 1;
ALTER TABLE catalogs ADD COLUMN show_price_web INTEGER NOT NULL DEFAULT 0;
