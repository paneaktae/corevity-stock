ALTER TABLE products ADD COLUMN is_published INTEGER NOT NULL DEFAULT 0 CHECK(is_published IN (0,1));
ALTER TABLE products ADD COLUMN show_price INTEGER NOT NULL DEFAULT 0 CHECK(show_price IN (0,1));
ALTER TABLE products ADD COLUMN public_slug TEXT;
ALTER TABLE products ADD COLUMN public_description_th TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN public_description_en TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN published_at TEXT;
CREATE UNIQUE INDEX products_public_slug_unique ON products(public_slug) WHERE public_slug IS NOT NULL;
CREATE INDEX products_public_catalog ON products(is_published,status,archived_at,created_at DESC);

CREATE TABLE catalogs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  show_prices INTEGER NOT NULL DEFAULT 1 CHECK(show_prices IN (0,1)),
  show_sold INTEGER NOT NULL DEFAULT 0 CHECK(show_sold IN (0,1)),
  expires_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX catalogs_status_updated ON catalogs(status,updated_at DESC);
CREATE INDEX catalogs_customer ON catalogs(customer_id);

CREATE TABLE catalog_items (
  id TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  brand_snapshot TEXT NOT NULL,
  model_snapshot TEXT NOT NULL,
  category_snapshot TEXT NOT NULL,
  condition_snapshot TEXT NOT NULL,
  description_snapshot TEXT NOT NULL DEFAULT '',
  image_key_snapshot TEXT NOT NULL DEFAULT '',
  image_mime_snapshot TEXT NOT NULL DEFAULT '',
  display_price REAL CHECK(display_price IS NULL OR display_price >= 0),
  UNIQUE(catalog_id,product_id)
);
CREATE INDEX catalog_items_order ON catalog_items(catalog_id,sort_order);
CREATE INDEX catalog_items_product ON catalog_items(product_id);

-- Aggregate by hour and discard visitor identifiers to keep analytics privacy-conscious.
CREATE TABLE catalog_events (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('CATALOG','PRODUCT','PUBLIC')),
  entity_slug TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('PAGE_VIEW','PRODUCT_VIEW','CONTACT_CLICK')),
  hour TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0),
  PRIMARY KEY(entity_type,entity_slug,event_type,hour)
);
CREATE INDEX catalog_events_slug ON catalog_events(entity_type,entity_slug,event_type);

ALTER TABLE quotation_settings ADD COLUMN line_url TEXT NOT NULL DEFAULT '';
ALTER TABLE quotation_settings ADD COLUMN facebook_url TEXT NOT NULL DEFAULT '';
