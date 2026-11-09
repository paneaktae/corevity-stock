-- Optional uploaded cover photo for a Catalog (private R2 key). When empty, the
-- website keeps using the first product photo as the cover.
ALTER TABLE catalogs ADD COLUMN cover_image_key TEXT;
ALTER TABLE catalogs ADD COLUMN cover_image_mime TEXT NOT NULL DEFAULT '';
