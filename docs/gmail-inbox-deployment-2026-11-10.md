# Email inbox (Gmail + LINE alerts) — production deployment 2026-11-10

User explicitly requested "Commit and deploy".

- Commit: `f1635b7` on `main` (clean tree, pushed). Checks: 171 tests, TypeScript, lint.
- D1 backup: `output/d1-backup-2026-11-10-pre-0037.sql` (local, gitignored; 1.3 MB).
- Remote D1: applied `0037_gmail_inbox.sql` only (new tables `gmail_connection`, `gmail_oauth_states`,
  `email_messages`, `email_notifications`; no existing data changed).
- Management Worker `fitness-equipment-manager`: `8d05dd64` → `91bf6ea0-7569-4380-afc1-65e4bd9b563a`.
  New var `GMAIL_MAILBOX=info@corevityusedgym.com`. Catalog Worker unchanged.
- Verified live: custom domain and workers.dev serve `index-B2grdN1p.js` (contains the inbox UI);
  `/`, `/inbox`, `/catalogs` 200; anonymous `/api/email/status`, `/api/email/messages`,
  `POST /api/email/sync`, `/api/integrations/gmail/connect` all 401.
- **Not active yet:** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are not set, so the 5-minute cron
  skips Gmail and the inbox shows "not connected". Next: Google Cloud setup per
  `docs/gmail-inbox-setup.md`, `wrangler secret put` both values (needs approval), then the admin
  connects `info@corevityusedgym.com` in Settings → Integrations.
- No other secrets, Meta flags or access controls changed.

## Follow-up 2026-11-10: Google OAuth secrets

- The user set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as production Worker secrets themselves
  (values never shared in chat). Verified by name with `wrangler secret list`.
- Remaining: the admin connects `info@corevityusedgym.com` in Settings → Integrations → Gmail inbox.

## Follow-up: backfill, Junk tab, HTML view (93cdc0c) and ads filter + call cap (286a35f)

- `93cdc0c`: migration `0038_email_html_backfill.sql` applied after backup
  `output/d1-backup-2026-11-10-pre-0038.sql`; Worker `0a66d85c` → `f2604655`. (`fbc29181`, `b129ccf1`,
  `0a66d85c` were "Secret Change" versions from setting the Google secrets; same code as `91bf6ea0`.)
- Observed after `93cdc0c`: sync runs failed with `GMAIL_SYNC_FAILED` from 17:43 to 17:50 UTC while
  the 50-per-page backfill ran (likely the per-invocation subrequest cap; exact cause not recorded).
  It recovered on its own at 17:50.
- `286a35f` (user requested "Commit and deploy"): Inbox shows only emails from people; ads/newsletters/
  sign-in/automated mail go to "Ads & alerts"; stored emails re-checked once; Gmail calls capped at 35
  per run, backfill 25 per page; unexpected errors now record their text. Worker `f2604655` →
  `470bbee2-60d4-47f7-a59c-62edd1408e63`, no migration.
- Verified: first run on `470bbee2` (17:55 UTC) succeeded with no error; backfill complete (109 emails,
  last 90 days); legacy-reason rows re-checked (0 left); Inbox view = 2 emails from people.
