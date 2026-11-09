# Catalog editor popup + cover upload — production deployment 2026-11-09

User explicitly requested "Commit and deploy all".

- Commit: `6561bcf` on `main` (clean tree, pushed). Checks: 159 tests, TypeScript, lint.
- D1 backup: `output/d1-backup-2026-11-09-pre-0036.sql` (local, gitignored; 1.3 MB).
- Remote D1: applied `0036_catalog_cover_image.sql` only (adds `catalogs.cover_image_key`,
  `catalogs.cover_image_mime`; no data written).
- Management Worker `fitness-equipment-manager`: `cc869c08` → `0adb132b` (6561bcf), then
  redeployed as `195fb82c` and `a0dd58ce` (same commit) to republish static assets.
- Public Catalog Worker `fitness-equipment-catalog`: `69b17728` → `df3e2a8a`.
- Smoke checks: CRM `/` and `/catalogs` 200; anonymous `POST`/`GET /api/catalogs/:id/cover` 401;
  storefront list (8 Catalogs), a Catalog detail, `/s/` share link, `/api/public/storefront`
  and website `/th/catalog` 200. No Catalog has an uploaded cover yet, so covers still fall
  back to the first product photo.
- **Stale front-end after deploy (resolved):** after `0adb132b` and the redeploy `195fb82c`,
  both `management.corevityusedgym.com` and the workers.dev URL kept serving the previous
  bundle (`index-DJ9s2TR_.js`, from f000283) for about 13 minutes; the new
  `/assets/index-BlihMgkE.js` returned the SPA fallback even though Wrangler reported the
  assets as uploaded. A third deploy of the same build with one extra untracked file
  (`build-info.txt`, forcing a new asset manifest) produced version
  `a0dd58ce-70a2-4623-9d7b-3a9959d885e2`; right after it the live HTML referenced
  `index-BlihMgkE.js`, and that bundle contains the popup and cover upload. It is unclear
  whether the forced manifest or delayed propagation fixed it. After any CRM deploy, check
  that the live HTML references the new `dist/client/assets/index-*.js`.
- Not yet verified: a signed-in cover upload on production.
- No secrets, Meta flags or access controls changed.

## Follow-up: private catalog availability label

- Commit `22775a8` (user requested "Commit and deploy"): share page shows "AVAILABLE" /
  "พร้อมขาย" instead of "1 UNIT AVAILABLE" / "พร้อมขาย 1 เครื่อง".
- Public Catalog Worker only: `df3e2a8a` → `6283b765-12f7-4497-b7dd-dd7d50311e7c`. No migration,
  CRM Worker unchanged.
- Verified live: `/s/<slug>` in Thai and English shows the new labels; no "1 เครื่อง"/"1 UNIT" left.
- `npm run check` had one flaky failure on the first run (not identified); three reruns passed 159/159.
