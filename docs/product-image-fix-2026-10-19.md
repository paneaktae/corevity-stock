# Product images — 2026-10-19

## Fixed and deployed

- Messenger attachment picker used public catalog image URLs while the CRM CSP permits same-origin images only. Added authenticated `/api/meta/products/:id/thumbnail`, restricted to active CRM members and published, unarchived products. The picker now uses this route; public sharing URLs and CSP remain unchanged.
- Catalog item photos referenced saved R2 keys. One existing snapshot referenced a removed photo. Preserve a valid snapshot; otherwise stream a current photo from the same authorized product. Current photos also fill catalog items created before a photo was uploaded. No product descriptions, prices, catalog choices or R2 objects were changed.
- Website catalog and cover image URLs include the current image ID as a cache revision so website optimizers do not keep old image failures after replacement. Dynamic fallback images have a short cache lifetime; old positional URLs remain no-store.

## Validation

- Before: 52 published catalog entries across five catalogs, 40 photo URLs returned200, one returned404, and11 entries had no photo. The11 entries refer to seven distinct products below.
- TypeScript, ESLint, production build and129 regression tests passed. Tests exercise same-origin preview delivery/auth, unpublished/archived denial, preserved snapshots, removed-object recovery, missing snapshot recovery, revision URLs and public availability restrictions.
- Production catalog Worker version: `4a7bae0b-0d2a-43e6-aa33-846836ef6c96`.
- Production CRM Worker version: `5ed82202-0533-4f8b-849f-d2eaefcf989a`.
- Formerly broken Life Fitness Fit Smith Machine image now returns200 image/jpeg. Browser confirmed all five Smith Machine photos decoded and use revision URLs. CRM browser confirmed first ten visible product thumbnails decoded from the authenticated same-origin route.

## Products that need an original photo uploaded

These products have zero product_images rows in the actual inventory. They cannot display a real product photo until one is uploaded. No image from another machine was substituted.

| SKU | Product |
| --- | --- |
|202610127|Cybex Eagle|
|202610128|Cybex Eagle|
|202610015|Life Fitness Insignia|
|202610018|Life Fitness Insignia|
|202610019|Life Fitness Insignia|
|202610020|Life Fitness Insignia|
|202610060|Star Trac Plate Loaded|

Upload in CRM → Inventory → select exact SKU → product photos. Existing catalog items without saved photos will automatically use a newly uploaded current photo.
