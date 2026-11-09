# Catalog delete + manual website order — production deployment 2026-11-09

User explicitly requested "Migrate and deploy".

- Commit: `f000283` on `main` (clean tree, pushed to origin/main).
- Checks: 158 tests, TypeScript and lint passed (`npm run check`).
- D1 backup before migration: `output/d1-backup-2026-11-09-pre-0035.sql` (local, gitignored; 1.3 MB).
- Remote D1: applied `0035_catalog_web_order.sql` only (adds `catalogs.web_sort_order`,
  backfilled newest-first for the 8 published Catalogs, so website order is unchanged).
- Management Worker `fitness-equipment-manager` (production):
  previous `03ff8304-cf9b-4f52-ab77-a008f7cf5a88` (c86028f) → new `cc869c08-ba67-4a49-85f6-ed3198c1ecf8`.
- Smoke checks: `/` and `/catalogs` return 200 (build asset `index-DJ9s2TR_.js`);
  anonymous `DELETE /api/catalogs/:id` and `PUT /api/catalogs/web-order` return 401.
- Public Catalog Worker `fitness-equipment-catalog`: **not redeployed** (still
  `2b1c422f-875a-48d6-99dc-6e319764309c`, matching git snapshot f4ea19a). Until it is
  redeployed, the website keeps ordering Catalogs by publish time; the order set in the
  CRM is saved but not yet applied. Deleting Catalogs works without it.
- No secrets, Meta flags or access controls changed.
