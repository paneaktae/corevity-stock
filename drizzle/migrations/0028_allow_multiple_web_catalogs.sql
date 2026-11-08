-- Remove the earlier one-Catalog storefront restriction. Published Catalogs
-- are now ordered by published_to_web_at, so several may be active together.
DROP INDEX IF EXISTS catalogs_single_web_publication;
