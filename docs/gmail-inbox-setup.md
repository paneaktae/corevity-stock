# Gmail inbox + LINE alerts — setup

The CRM reads `info@corevityusedgym.com` Inbox **and Junk/Spam** (read-only, `gmail.readonly`) every 5 minutes, shows mail at
**Email inbox** (`/inbox`) and sends a LINE alert to every salesperson with LINE connected when a new
email looks like a customer. It cannot send, delete or change mail.

## Not missing email

- Every 5 minutes: Gmail history since the last check (Inbox + Junk/Spam; Sent, Drafts and Trash ignored).
- Every hour: re-lists the last 2 days and imports anything the history feed missed (deduplicated, so no
  double alerts).
- Junk/Spam emails are flagged **Junk** in the inbox and in the LINE alert, with a hint to mark them
  "Not spam" in Gmail.
- Watchdog: if the mailbox has not been read for 30 minutes (repeated errors) or Google access is
  revoked, the admin (`AUTH_ADMIN_EMAIL`, or every LINE-linked salesperson if the admin has no LINE)
  gets one LINE alert per incident. A successful check clears it.

- Backfill: after connecting, older mail from the last 90 days (Inbox + Junk) is imported 50 emails
  per check (every 5 minutes) until complete, without LINE alerts.
- Inbox page tabs: **Inbox** (everything not in Junk), **Possible customers** (both folders), **Junk**.
- HTML emails are shown in a sandboxed frame (no scripts, no access to the CRM, remote images blocked
  by the page CSP). Emails stored before HTML support fetch their HTML once when opened.

## How customer emails are picked

1. Skipped as not-customer: our own domain, `noreply`/notification senders, newsletters
   (`List-Unsubscribe`/`List-Id`), bulk/auto-generated mail, Gmail Promotions/Social/Updates/Forums
   categories, and service senders (Google, Facebook, LINE, Vercel, Cloudflare…).
2. A sender whose email matches an existing customer → **Known customer** (always alerted).
3. Everything else is a possible customer. If **Use AI** is on (Settings → Integrations, off by
   default), the sender, subject and first 2,000 characters go to the configured AI provider
   (`AI_BASE_URL`, `store: false`) to decide; on AI failure the rule result is kept.
4. The first sync after connecting imports the last 3 days **without** alerts. After that each new
   customer email alerts once per salesperson (LINE retry key, up to 10 retries).
5. Staff can mark any email as customer / not a customer. Mail older than 90 days is deleted.

## One-time Google setup (Workspace admin)

Do this signed in to Google with a **@corevityusedgym.com** account (an "Internal" app must belong to
the company Workspace; a personal @gmail.com account cannot create it).

1. https://console.cloud.google.com → create a project, e.g. `Corevity CRM`.
2. **APIs & Services → Library** → enable **Gmail API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding/Audience):
   - User type / Audience: **Internal**
   - App name `Corevity CRM`, support email `info@corevityusedgym.com`
   - Data access / Scopes: add `https://www.googleapis.com/auth/gmail.readonly`
4. **Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `https://management.corevityusedgym.com/api/integrations/gmail/callback`
5. Copy the **Client ID** and **Client secret** and store them as Worker secrets:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID --env production
   npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
   ```
6. If the Workspace Admin console restricts third-party apps (Security → Access and data control →
   API controls), mark this OAuth client as **Trusted**.

Already in place: `GMAIL_MAILBOX=info@corevityusedgym.com` (wrangler vars), `APP_URL`, and the refresh
token is encrypted with the existing `META_TOKEN_ENCRYPTION_KEY` / `META_TOKEN_ENCRYPTION_KEY_VERSION`.

## Deploy and connect

1. Back up D1, apply migration `0037_gmail_inbox.sql`, deploy the CRM Worker (from clean `main`).
2. The workspace admin (`AUTH_ADMIN_EMAIL`) signs in to the CRM **with a password**, opens
   **Settings → Integrations → Gmail inbox → Connect Gmail**, signs in to Google as
   `info@corevityusedgym.com` and allows read access. Signing in with any other Google account is
   rejected and the token revoked.
3. Open **Email inbox** → **Check now** to run the first sync immediately.

If Google later revokes access (password change, admin removal), the card shows **Reconnect
required**; polling stops until the admin reconnects.
