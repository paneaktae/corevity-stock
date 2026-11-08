# Ads analysis v2 production deployment — 2026-11-08

User explicitly requested deployment ("deploy").

- Worker: `fitness-equipment-manager`, production.
- Commit: `c86028f` on `main` (clean tree).
- Previous version: `5c0129b3-fa4e-46a4-a614-c59870af6d2f` (matched `b631b3a`; no out-of-band deploys found).
- New version: `03ff8304-cf9b-4f52-ab77-a008f7cf5a88`. Worker startup: 32 ms.
- Checks: 157 tests, TypeScript and lint passed; production build and Wrangler dry run passed.
- Remote D1: no pending migrations. No migration or data write performed.
- No secrets, Meta flags, ads, budgets or access controls changed.
- Smoke checks: `/` and `/meta/ads` return 200 and reference the current build asset `index-Dvencw9m.js`; anonymous `/api/meta/ads/analysis`, `/api/meta/ads/breakdown` and `/api/meta/ads/insights` return 401.
- Not yet verified: an authenticated load of the new dashboard against live Meta data (new insight fields, previous-period filter, daily and breakdown queries).
