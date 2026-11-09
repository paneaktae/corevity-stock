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
