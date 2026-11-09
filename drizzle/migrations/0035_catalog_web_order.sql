-- Manual website order for published Catalogs (lower first). NULL = not on the
-- website. Existing published Catalogs keep their current newest-first order.
ALTER TABLE catalogs ADD COLUMN web_sort_order INTEGER;
UPDATE catalogs SET web_sort_order=(
  SELECT COUNT(*) FROM catalogs other
   WHERE other.publish_to_web=1
     AND (other.published_to_web_at>catalogs.published_to_web_at
       OR (other.published_to_web_at=catalogs.published_to_web_at AND other.slug<catalogs.slug))
) WHERE publish_to_web=1;
CREATE INDEX catalogs_web_order ON catalogs(publish_to_web,web_sort_order);
