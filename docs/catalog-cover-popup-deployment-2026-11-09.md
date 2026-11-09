# Catalog editor popup + cover upload — production deployment 2026-11-09

User explicitly requested "Commit and deploy all".

- Commit: `6561bcf` on `main` (clean tree, pushed). Checks: 159 tests, TypeScript, lint.
- D1 backup: `output/d1-backup-2026-11-09-pre-0036.sql` (local, gitignored; 1.3 MB).
- Remote D1: applied `0036_catalog_cover_image.sql` only (adds `catalogs.cover_image_key`,
  `catalogs.cover_image_mime`; no data written).
- Management Worker `fitness-equipment-manager`: `cc869c08` → `0adb132b` (6561bcf), then
  redeployed as `195fb82c` (same commit) to republish static assets.
- Public Catalog Worker `fitness-equipment-catalog`: `69b17728` → `df3e2a8a`.
- Smoke checks: CRM `/` and `/catalogs` 200; anonymous `POST`/`GET /api/catalogs/:id/cover` 401;
  storefront list (8 Catalogs), a Catalog detail, `/s/` share link, `/api/public/storefront`
  and website `/th/catalog` 200. No Catalog has an uploaded cover yet, so covers still fall
  back to the first product photo.
- **Open issue:** after both CRM deploys, `management.corevityusedgym.com` and the workers.dev
  URL kept serving the previous front-end bundle (`index-DJ9s2TR_.js`, from f000283) for
  10+ minutes, and the new `/assets/index-BlihMgkE.js` returned the SPA fallback. Wrangler's
  log shows the 5 new assets uploaded successfully. The old UI is compatible with the new
  API, so nothing is broken, but the popup editor and cover field are not visible until
  Cloudflare serves the new assets.
- No secrets, Meta flags or access controls changed.
