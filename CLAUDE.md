# Fitness Equipment Manager (CRM / backoffice)

Internal Corevity backoffice: inventory, photos, AI sales copy, customers, leads, reservations, catalogs, quotations, Meta/Messenger/LINE. Live at https://management.corevityusedgym.com. See `README.md` and `docs/` (Meta phases, deployment records) for detail.

## Stack

React + TypeScript + React Router + Vite + Tailwind (`src/`); Hono API on a Cloudflare Worker (`worker/`, routes under `/api/*`); D1 via Drizzle (`worker/db`, SQL in `drizzle/migrations`); private R2 (`PRODUCT_IMAGES`); UI strings in `src/th.json` (Thai/English via `src/i18n.ts`).

## Commands

- `npm ci`, `cp .dev.vars.example .dev.vars`, `npm run types`, `npm run db:migrate`, `npm run db:seed` (local only), `npm run dev`
- `npm run check` = types + `tsc` + eslint + vitest. Run before calling work done. `npm run format` for prettier.
- `npm run deploy` builds production and runs `wrangler deploy --env production`.

## Rules

- **Never** run the Cloudflare resource-creation commands again (D1/R2 already provisioned). **Never** seed production.
- Do not deploy, apply remote migrations (`--remote`), or run `wrangler secret` without explicit user approval. Back up D1 before migrations.
- Schema changes: add a new numbered forward SQL migration in `drizzle/migrations`. Triggers and partial indexes are hand-written; never replace with ORM-generated diffs.
- Secrets (`AI_API_KEY`, `BOT_API_KEY`, Meta credentials) live only in Worker secrets / ignored `.dev.vars`. Never commit, print, or use `VITE_` for them.
- All protected endpoints go through session auth + `ALLOWED_EMAILS`. `LOCAL_MOCK_EMAIL` is local dev only; never weaken that guard.
- Money is THB, max 2 decimals. Timestamps are UTC ISO; business grouping uses `Asia/Bangkok`.
- Product deletion is archive-only; sold/customer/lead history is retained. Photo deletes are permanent.
- Sale/reservation logic relies on D1 batches and constraints for atomicity; keep that behaviour and its tests (`tests/`).
- The website (`../website`) consumes the public storefront/catalog endpoints. Do not expose prices or customer/internal CRM fields there, and keep existing share links working.
- Meta features are "ready for configuration"; don't claim live activation without real credentials/checks.
