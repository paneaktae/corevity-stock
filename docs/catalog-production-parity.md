# Catalog chat source parity

## Verified differences

- The deployed Catalog Worker has visitor chat routes, a chat widget on shared Catalog pages, rate limiting, and product attachments restricted to the active Sales Catalog.
- The deployed Manager Worker has an authenticated Catalog Chats inbox, salesperson replies, open/closed status, Catalog salesperson assignment, and an internal LINE notification endpoint.
- The deployed D1 migration ledger includes migrations through 0025. The repository at `c1aebd6` only contains migrations through 0013; source definitions for 0014–0023 are not present in that revision.
- The deployed Catalog Worker also has older aggregate and standalone product routes. This change does not restore those routes; public product visibility stays controlled by membership in an active Sales Catalog.

## Source changes

Migrations 0024 and 0025 add the Catalog assignment and chat tables/phone field. They do not alter existing product, customer, quotation, sale, or finance rows. These migrations are already recorded in the inspected production database and must not be reapplied there.

The public chat API stores a one-way hash of the visitor token, validates the visitor's phone and message, limits request volume, rejects honeypot submissions, and resolves attached item IDs only inside the requested active Catalog. Manager chat endpoints remain behind Cloudflare Access. Only the internal notification endpoint bypasses Access; it requires the existing shared `CATALOG_CHAT_INTERNAL_SECRET` and sends through the assigned salesperson's existing LINE account.

## Data and deployment safeguards

- This source change has not run a remote D1 migration, changed a production row, or deployed either Worker.
- Before running any D1 migration command in any environment, restore and verify the authoritative 0014–0023 migration files. Do not invent those historical migrations from the current database schema.
- Production already has the 0024–0025 schema, so a source deployment should not run `db:migrate:production`.
- Keep `CATALOG_CHAT_INTERNAL_SECRET` in Cloudflare Worker Secrets on both Workers. Use the same existing secret value on the Catalog and Manager Workers; do not put it in `vars`, source control, or browser configuration.
- Deploy the Manager Worker first, then the Catalog Worker so its `MANAGEMENT` service binding points to the Worker with the chat routes. Smoke-test an existing Sales Catalog and assigned salesperson inbox after deployment.

The Catalog configuration keeps the existing D1 and R2 resources, sets the Catalog canonical URL to `https://catalog.corevityusedgym.com`, preserves the storefront origin allowlist, and adds only the existing Manager Worker service binding.
