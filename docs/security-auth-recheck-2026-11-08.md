# Security fix: recheck workspace access on every request — 2026-11-08

Deployed with user approval ("deploy only my fix") on 2026-11-08 at about 12:19 Asia/Bangkok.

## Changes

- `worker/auth.ts`: a valid session cookie is accepted only while its email is still in `ALLOWED_EMAILS` or an active `workspace_users` row. Previously only the Meta routes rechecked this, so a removed or deactivated user kept access to products, customers, quotations and finance for up to 30 days. Rejected sessions get HTTP 403 (or an unauthenticated `/api/auth/session` response) and are not deleted, so reactivating a user restores access.
- `zod` 4.6.5 → 4.6.7 (GHSA-mrhx-c7xc-m3w5, memory exhaustion on oversized collections), via a non-breaking `npm audit fix` lockfile update.
- `.gitignore` and ESLint now ignore `tmp/` and `output/`, which hold local quotation PDFs and screenshots that may contain customer data.
- New backend test: a still-valid session for a removed account gets 403 on `/products`, `/customers` and `/dashboard`.

## What was deployed

Only the `fitness-equipment-manager` Worker. The public catalog Worker was not changed.

Production before this deploy was the 2026-10-31 full build (`6eeefffc…`) plus the 2026-11-06 hotfix (`d7abb3fe…`). File timestamps showed no source change since then other than the 2026-11-06 hotfix files and this fix, so the build contained no other pending work.

| Worker | Previous version | New version |
| --- | --- | --- |
| fitness-equipment-manager | d7abb3fe-4d3a-4e74-b961-f50b9a16bada | 9dbb20c5-62f6-4c45-8c96-a40c009a6732 |

## Verification

- `npm run check`: types, strict TypeScript, ESLint, and 146 of 146 tests passed. The production build and Wrangler dry run passed with existing bindings and variables.
- Remote D1: no pending migrations. No migration or data write was performed.
- Live: `/` returned 200. `/api/products` returned 401 with no cookie and 401 with an invalid cookie. `/api/auth/session` reported unauthenticated. A cross-site POST returned 403. The public catalog API returned 200.

## Rollback

`npx wrangler rollback d7abb3fe-4d3a-4e74-b961-f50b9a16bada --env production`
