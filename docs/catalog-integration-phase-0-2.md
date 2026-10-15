# Corevity Catalog integration, Phase 0–2

This handoff contains the Phase 0 architecture assessment and the Phase 2 Cloudflare changes prepared against paneaktae/corevity-stock branch feature/shareable-product-catalog. The integration/catalog-only-public-api branch is prepared for review. No production D1 writes, migrations, or deployments have been performed.

## Phase 0: architecture assessment

- The public storefront is the separate Next.js App Router application on Vercel. It has no catalog repository yet; its product data source is currently empty.
- The back-office application is React/Vite and Cloudflare Workers. Its Manager API is protected by Cloudflare Access, while the separate public Catalog Worker is intentionally unauthenticated for share-link reads.
- CRM inventory and Catalog data share the existing D1 database. Product images use the existing R2 bucket. Existing quotations and customer records remain in their current Manager workflows; there is no storefront RFQ intake route yet.
- The Catalog feature is on feature/shareable-product-catalog, which is one commit ahead of main at the time of this audit. The integration must use the Catalog-enabled branch as its base.
- The back office is a React/Vite SPA backed by Cloudflare Workers, D1, and R2. The authenticated Manager Worker uses Cloudflare Access; its inventory, customer, quotation, and sales routes remain behind that boundary.
- The Sales Catalog workflow already exists in the feature/shareable-product-catalog branch. The Manager API creates/edits Catalogs and snapshots selected product description, category, condition, image key, and display price into catalog_items.
- Product image files are stored in the existing R2 bucket. Catalog items hold a snapshot key so public reads do not need access to CRM image records.
- The separate public Catalog Worker shares the existing D1 and R2 bindings. It renders /s/{slug} pages and exposes /api/public/catalogs/{slug}.
- The existing implementation also exposed an aggregate /catalog page, /api/public/catalog, per-product /api/public/products/{slug}, standalone product pages, and unscoped product media. Those paths bypass Sales' Catalog selection and are removed from the prepared change.
- The Catalog Manager previously required a separate product-level publish flag and public slug before Sales could add inventory. That duplicated visibility control and also copied internal descriptions as a fallback. The product detail page also showed that legacy publish toggle; the prepared change replaces it with a note that Sales Catalog membership controls website visibility.

The smallest safe design keeps both applications and their existing data models. D1 remains the source of truth. Sales Catalog membership controls public visibility; Catalog title/options and item snapshots control the public presentation. Existing CRM rows are not rewritten, deleted, or migrated.

## Phase 1: scope and data safety

Phase 0–2 needs no D1 migration. Migration 0013_public_catalog.sql already creates the Catalog tables and product public fields in the Catalog feature branch. No customer, quotation, sales, expense, or inventory row is changed by the prepared implementation.

The public worker reads only the current public Catalog and its non-archived item snapshots, joining only current product status for availability. Sold items remain hidden unless Sales enabled “Include sold products.” Archived products remain hidden. Price is returned only when the Catalog has “Show prices” enabled. The public response omits purchase cost, margins, supplier fields, notes, customer identity, and CRM IDs.

Sales may add an inventory product without changing its product-level is_published flag. Product-level publishing fields remain in the existing Manager for compatibility, but no longer control public Catalog inclusion.

## Phase 2: public API contract

### Catalog data

GET /api/public/catalogs/{catalogSlug}

Returns 404 for an unknown, archived, or expired Catalog. For an active Catalog, returns:

- catalog: title, description, showPrices, and expiresAt
- products[]: Catalog item ID scoped to this Catalog, readable item slug, brand, model, category, condition, current availability, Catalog description snapshot, and an optional Catalog-scoped image URL
- price: included only when showPrices is true

Products are ordered by the Sales-selected Catalog order. The response is read-only and cached for 30 seconds in browsers and 60 seconds at the shared cache, with 5 minutes stale-while-revalidate.

### Catalog-scoped image

GET /media/catalogs/{catalogSlug}/items/{itemId}/0

Serves the Catalog item's image snapshot only when the item belongs to that active Catalog and remains eligible under its sold/archived rules. The R2 object remains in the existing bucket. Image responses use the existing public image cache policy.

### Removed public access paths

The root and /catalog no longer show an aggregate inventory list. /api/public/catalog, /api/public/products/{slug}, /catalog/products/{slug}, and /media/products/{slug}/{position} return 404. Product detail pages and images are available only under a Sales-created Catalog. Existing product links continue to resolve only when that product is a member of the referenced Catalog.

### CORS

The prepared Catalog Worker configuration allows browser reads only from https://corevityusedgym.com and https://www.corevityusedgym.com. It allows GET/OPTIONS without credentials. The Manager API remains authenticated and is not opened to the storefront.

## Prepared files

The ready-to-apply source copies are worker/public-catalog.ts, worker/catalogs.ts, src/pages/Catalogs.tsx, src/pages/Inventory.tsx, src/th.json, tests/backend.test.ts, and wrangler.catalog.jsonc.

## Database and deployment

There is no database migration to apply for Phase 0–2. Do not run the production migration command for this change.

The prepared wrangler.catalog.jsonc adds PUBLIC_STOREFRONT_ORIGINS. Existing DB, PRODUCT_IMAGES, and PUBLIC_CATALOG_BASE_URL bindings remain as configured. No secret or new infrastructure is required.

After the patch is reviewed and merged, validate in a non-production Worker environment first, then deploy the Catalog Worker with: npx wrangler deploy --config wrangler.catalog.jsonc

That configuration points at the current shared production D1/R2 resources, so running the command would deploy to production. It has not been run. The storefront's Vercel environment variable and dynamic catalog pages belong to Phase 3 and are not included here.

## Verification

The prepared backend tests cover Catalog-only visibility, absence of aggregate and standalone product endpoints, private field exclusion, CORS allowlisting, Catalog detail pages, Catalog-scoped images, current availability, sold filtering, and expiration.

The full repository test suite could not be run from this workspace because the back-office repository is not checked out locally. Syntax and formatting checks passed for the prepared files; run the repository CI checks on this branch before merging.
