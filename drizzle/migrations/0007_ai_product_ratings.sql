ALTER TABLE products ADD COLUMN price_rating REAL CHECK(price_rating IS NULL OR (price_rating >= 0 AND price_rating <= 10));
ALTER TABLE products ADD COLUMN design_rating REAL CHECK(design_rating IS NULL OR (design_rating >= 0 AND design_rating <= 10));
ALTER TABLE products ADD COLUMN quality_performance_rating REAL CHECK(quality_performance_rating IS NULL OR (quality_performance_rating >= 0 AND quality_performance_rating <= 10));
