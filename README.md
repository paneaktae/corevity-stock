# Fitness Equipment Manager

A small internal backoffice for Corevity: receive equipment, upload photos, prepare Thai/English sales copy, track customers and leads, reserve equipment, follow up, and record selected items sold. Built for two people, desktop and phone. No ERP, accounting, password database, or public shop.

## Current deployment

Live app: https://fitness-equipment-manager.analyziie.workers.dev

Cloudflare resources and all four migrations have already been provisioned for this workspace. Do **not** run the resource-creation commands again for this account. Production starts empty; fake seed data is local only.

- D1: `fitness-equipment-manager` (`de34955b-5a97-47a9-9169-3dbed136cb75`).
- Private R2: `fitness-equipment-manager-images`.
- Access team: `noisy-night-ad63.cloudflareaccess.com`.
- Access application: `Fitness Equipment Manager`, covering the complete workers.dev hostname.
- Email-code sign-in: only `analyziie@gmail.com` is allowed initially. No second user has been supplied. Add the second address to both the Access policy and `ALLOWED_EMAILS`, then redeploy.
- Preview URLs are disabled. The production workers.dev URL is intentionally enabled **after** the Access application was created.
- AI uses OpenAI `gpt-4.1-mini` at `https://api.openai.com/v1`. The owner supplies `AI_API_KEY` as a Cloudflare Worker secret; never commit it.
- Source is published on the `main` branch of [paneaktae/corevity-stock](https://github.com/paneaktae/corevity-stock). The initial GitHub Actions checks passed. Deployment remains manual.

Verified: strict TypeScript, ESLint, 26 isolated backend/static-asset/language/LINE tests, production build, all remote schema migrations, and the live browser redirect to the Access sign-in screen. A signed-in production session and live AI generation have not yet been tested. Local visual/mobile browser testing was blocked by client permissions.

## Architecture

- React + TypeScript + React Router, Vite, Tailwind, Lucide icons and small reusable UI components.
- Cloudflare Vite Plugin builds one Workers deployment with static SPA assets and a Hono API under `/api/*`.
- D1 via its `DB` binding and Drizzle ORM; versioned SQL migrations include constraints, indexes and transactional triggers.
- Private R2 via `PRODUCT_IMAGES`; authenticated Worker endpoints handle uploads and image reads. No public bucket or browser write credentials.
- Cloudflare Access in front of the entire hostname. The Worker independently verifies the Access JWT signature, issuer, audience, expiry and explicit email allowlist for every request, including images and SPA routes.
- AI is an interchangeable `DescriptionProvider` service. The supplied adapter uses an HTTPS OpenAI-compatible chat-completions API, configured entirely on the Worker. There is no chosen provider, bundled key, or simulated AI response.

The single deployment follows Cloudflare's [React SPA + API guide](https://developers.cloudflare.com/workers/vite-plugin/tutorial/) and [JWT validation guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Language

Use the language selector in the top bar to switch between Thai and English. The choice is saved in browser local storage and defaults to the browser language. Switching preserves in-progress forms and leaves product/customer data unchanged. Dates and THB amounts follow the selected locale; database status codes stay unchanged. Custom notes, descriptions, condition names and historical activity records are not automatically translated. UI translations are maintained in `src/th.json`.

## What works

- Dashboard counts, inventory cost value, recent equipment, recent sales, overdue/today/upcoming follow-ups.
- Search SKU/brand/model/serial, filter brand/category/status/condition, sort inventory; desktop table and phone cards.
- Product create/edit, readable annual SKUs, profit and margin, descriptions, notes and soft archive.
- Multiple JPEG/PNG/WEBP photos, primary photo, reorder, preview and delete. Maximum 5 files per request, 30 per product; configurable per-file limit (10 MB default), 52 MB request ceiling. MIME type and file signature are checked server-side.
- Customers with contact details, budgets, interests, lead history and next follow-up.
- Six-stage sales board and list, product associations, quick status actions, contact and follow-up tracking.
- Customer-linked reservations, optional expiry and notes, release and visible reserved customer.
- Winning a lead explicitly selects sold products. D1 batches and sale constraints prevent partial wins, duplicate sales and selling a product held for another customer. Unselected products remain unchanged.
- Reviewed AI drafts for Thai, English, short description and Facebook copy. Saving requires confirmation before replacing matching text. Copy buttons support manual publishing.
- Configurable equipment conditions and an activity log with authenticated email.

## Local development

Use Node.js 22.12+ (Node 24 LTS recommended) and npm. Commands run from the repository root.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run types
npm run db:migrate
npm run db:seed
npm run dev
```

Open the URL printed by Vite (usually `http://127.0.0.1:5173`; it selects another port if occupied). D1 and R2 are emulated by Cloudflare locally and persisted under `.wrangler/state`; no Cloudflare account or production data is needed. The seed script generates current relative follow-up dates and fake equipment/customers/leads from Life Fitness, Cybex, Matrix, Technogym, Precor and Hammer Strength. Seed photos are intentionally absent: upload real photos to test R2, rather than dummy URLs.

`LOCAL_MOCK_EMAIL=demo@example.test` in the ignored `.dev.vars` enables the local identity only when all three checks pass: a Vite development build, `ENVIRONMENT=development`, and a loopback request hostname. Production builds remove that bypass. Do not use a public tunnel for mock-auth development.

For a real AI test, configure the provider's `AI_API_KEY`, `AI_MODEL` and `AI_BASE_URL` in ignored `.dev.vars`. Never paste keys into UI fields, use `VITE_` secret variables, or commit this file. Without AI configuration, the rest of the app works and generation returns a clear configuration error.

```sh
npm run check          # binding types, strict TS, lint, backend integration tests
npm run build          # production-optimized app with default config
npm run build:production
npm run format
```

Tests bundle the actual Hono Worker and run it with isolated Miniflare D1/R2 storage. They cover CRUD, patch preservation, reservation conflicts, sale atomicity and concurrency, dashboard calculations, follow-ups, cross-origin writes, authentication bypass boundaries, R2 storage and AI output validation. No production resource is modified.

## Database schema

| Table            | Purpose                                                                     |
| ---------------- | --------------------------------------------------------------------------- |
| `products`       | Equipment, descriptions, prices, availability, sale/archive timestamps      |
| `product_images` | R2 key, original filename, MIME/size, ordering and primary flag             |
| `customers`      | Basic contact, budget, interests and notes                                  |
| `leads`          | Customer, stage, estimated value, contact and follow-up timestamps          |
| `lead_products`  | Many-to-many equipment interests                                            |
| `reservations`   | One active reservation per product, customer, optional lead/expiry          |
| `product_sales`  | One completed sale per product, optional lead/customer, price/cost snapshot |
| `activities`     | Lightweight event history and authenticated actor                           |
| `settings`       | Configurable condition list                                                 |
| `sku_sequences`  | Atomic annual readable SKU sequence                                         |

Timestamps are UTC ISO strings. Follow-up/day/month groupings use `BUSINESS_TIMEZONE`, default `Asia/Bangkok`. The UI displays Bangkok time; datetime inputs use the browser's local timezone before conversion to UTC. Money is THB with at most two decimal places, bounded and validated; this is an inventory tool, not an accounting ledger. Inventory cost value includes available and reserved unarchived items. Monthly sales count sold timestamps, including archived sales. Prices on sold items are retained.

Reservations remain active until explicitly released or sold, even after their expiry date. This avoids silently making equipment available while a customer still expects a hold. Closing a lead does not release its unselected reservations; review them on the relevant product pages.

## Cloudflare resources and setup

Required: one Worker, one D1 database, one private R2 bucket, and one Access self-hosted application covering the complete app hostname. Enable R2 in the Cloudflare dashboard first if the account has not activated it.

```sh
npx wrangler login
npx wrangler whoami
npx wrangler d1 create fitness-equipment-manager --location apac
npx wrangler r2 bucket create fitness-equipment-manager-images --location apac
```

Copy the returned database ID into `wrangler.jsonc` under `env.production.d1_databases[0].database_id`. The top-level zero ID is an intentional local-only binding. Match the production R2 bucket name under `env.production.r2_buckets`. Bindings must be named `DB` and `PRODUCT_IMAGES`.

Do not enable the R2 public development URL or a public bucket domain. The Worker authenticates all photo access.

### Cloudflare Access — required before going live

1. In Cloudflare Zero Trust, complete the organization/team setup and note the team domain, for example `your-team.cloudflareaccess.com`.
2. Configure an identity provider, or enable One-time PIN email login. Do not build an app password flow.
3. Under Access → Applications, add a **Self-hosted** application named `Fitness Equipment Manager`.
4. Add your chosen hostname, e.g. `equipment.your-company.example`, covering **all paths**. Do not protect only `/api`; the SPA and photo endpoints need the same protection.
5. Add one **Allow** policy with Include → **Emails** containing the two exact authorized email addresses. Avoid Everyone, broad email domains, Bypass policies and service-token identities for this human-only app. Access denies identities that do not match an Allow policy.
6. Choose a suitable session duration, such as 8 hours. Copy the application's AUD tag from its settings.
7. Configure `env.production.vars` in `wrangler.jsonc`:
   - `ACCESS_TEAM_DOMAIN`: team hostname only, no scheme or trailing slash.
   - `ACCESS_AUD`: this application's AUD tag.
   - `ALLOWED_EMAILS`: the same two emails, comma-separated.
   - `ENVIRONMENT`: keep `production`.
8. Add a Worker custom domain under `env.production.routes`:
   ```json
   "routes": [{"pattern":"equipment.your-company.example","custom_domain":true}]
   ```
   Replace the example with a real domain in your Cloudflare account. For a custom-domain deployment, change `workers_dev` to `false` and keep `preview_urls:false`, so an alternate hostname cannot bypass the intended Access entry point.
9. Deploy only after the Access application and policy exist. Verify an incognito browser is sent to Access, both allowed users can sign in, and an unlisted account is denied. Verify deep links and images as well as the dashboard.

The Worker refuses requests with missing Access configuration (503), missing/invalid JWTs (401), or an email outside its own allowlist (403). It never trusts frontend identity or the unverified email header. The app's Settings page shows the verified identity.

For a workers.dev hostname instead of a custom domain, first enable Cloudflare's managed Access protection for that Worker hostname in Workers → Settings → Domains & Routes, obtain that Access application's AUD, and set the same strict email policy and Worker allowlist. Only then deliberately enable `workers_dev`. The current account is configured for the Access-protected workers.dev hostname above. If moving to a custom domain, update Access first, add the route and disable workers.dev.

### Variables and secrets

| Name                 | Where                     | Value                                                                                             |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| `AI_API_KEY`         | Wrangler secret           | Provider API key; never frontend-visible                                                          |
| `AI_MODEL`           | Production vars or secret | Exact model ID supported by chosen provider                                                       |
| `AI_BASE_URL`        | Production vars or secret | HTTPS API base URL ending in `/v1` for a compatible provider; adapter appends `/chat/completions` |
| `ACCESS_TEAM_DOMAIN` | Production vars           | Access team hostname                                                                              |
| `ACCESS_AUD`         | Production vars           | Access application audience                                                                       |
| `ALLOWED_EMAILS`     | Production vars           | Two comma-separated allowlisted emails                                                            |
| `MAX_UPLOAD_MB`      | Vars                      | Default `10`; keep <=10 with current batch size/request ceiling                                   |
| `BUSINESS_TIMEZONE`  | Vars                      | Default `Asia/Bangkok`                                                                            |
| `LOCAL_MOCK_EMAIL`   | `.dev.vars` only          | Local development identity                                                                        |

```sh
npx wrangler secret put AI_API_KEY --env production
```

Use the interactive prompt. Configure model/base URL as non-secret production vars; a compatible Cloudflare AI Gateway URL may be used as `AI_BASE_URL` if it supports the same endpoint and bearer-key format. No extra gateway-specific integration is assumed. AI generation has a 45-second timeout, bounded response size and Zod validation. Calls include brand/model/category/condition/notes; do not put sensitive customer data into product notes if it should not reach your selected provider.

### Migrations and deployment

Do not seed production.

```sh
npm ci
npm run check
npm run db:migrate:production
npm run deploy
```

Expanded commands:

```sh
npx wrangler d1 migrations apply DB --remote --env production
CLOUDFLARE_ENV=production npx vite build
npx wrangler deploy --env production
```

`CLOUDFLARE_ENV=production` selects the production bindings during the Vite build. The Vite plugin generates Wrangler's deployment config and the SPA assets; deploy the generated build through Wrangler, not legacy Pages.

When deploying to a different account, complete every production config field and replace the database ID. This workspace already contains its provisioned production identifiers. No AI key is necessary to use inventory/CRM; it is required to verify generation end-to-end.

For local migrations:

```sh
npx wrangler d1 migrations apply DB --local
npm run db:seed
```

Migrations are reviewed SQL in `drizzle/migrations`; Drizzle's TypeScript schema supports application queries. Triggers and partial indexes are intentionally hand-authored. Do not replace existing SQL with an ORM-generated schema diff. Add numbered forward migrations for future changes.

## GitHub and CI

Target repository: [paneaktae/corevity-stock](https://github.com/paneaktae/corevity-stock).

The included GitHub Actions workflow installs the lockfile, checks types/lint/tests, and builds the production bundle. It does not automatically deploy or apply remote migrations. Configure Workers Builds or a separate explicitly enabled deployment workflow after Access and Cloudflare resources are ready.

For a local checkout already containing these files:

```sh
git init -b main
git remote add origin https://github.com/paneaktae/corevity-stock.git
git add .
git commit -m "Build Fitness Equipment Manager"
git push -u origin main
```

Use normal GitHub authentication. `.gitignore` excludes local secrets, generated build artifacts, dependencies and local database/photo storage. Do not force-push over unrelated repository work.

## Backup, operations and recovery

- Export D1 before migrations and periodically according to your tolerance for data loss:
  ```sh
  npx wrangler d1 export DB --remote --env production --output corevity-backup.sql
  ```
  Protect exported files as business data and store them outside this repository. Use D1 Time Travel recovery when available; check your plan's current retention in Cloudflare.
- D1 exports do **not** contain R2 photos. Maintain a separate R2 object backup through an S3-compatible backup tool and keep object keys consistent with the database. Test a restore into a separate D1 database and bucket before an incident.
- Product deletion is archive-only. Sold records and customer/lead history are retained. Customers have no delete endpoint. An administrator can restore an archived product by clearing its archive timestamp after reviewing linked records.
- A photo deletion is permanent. Uploads compensate for a failed database insert by removing the just-uploaded objects. A failure during R2 deletion after metadata deletion can leave an inaccessible orphan object; reconcile these with a bucket/database comparison during maintenance.
- `npx wrangler tail --env production` shows sanitized request errors. Production logs omit SQL bodies, credentials and customer notes.

## Troubleshooting

- **R2 error 10042**: activate R2 in the Cloudflare dashboard, then create the bucket.
- **503 Access configuration**: fill team domain, AUD and email allowlist. Do not disable authentication as a workaround.
- **401**: use the protected hostname; confirm team domain and application AUD agree with the Access app. Verify the Access session has not expired.
- **403**: check the signed-in email against both allowlists. Cross-site mutating requests are rejected.
- **No such table**: apply migrations to the correct local or production environment. Do not accidentally point local dev at remote storage.
- **AI not configured / failed**: check the three AI variables, provider billing/model permissions, JSON-mode support and HTTPS base URL. Existing text remains unchanged on failures.
- **Photo rejected**: select an actual JPEG/PNG/WEBP within the size limit. HEIC must be exported/converted before upload.
- **Conflict**: refresh; another user may have reserved/sold the item, or a manual SKU may already exist.
- **Local preview port occupied**: use Vite's printed URL. It may be 5174 or another free port.
- **Local runtime cannot listen**: allow loopback ports and the Wrangler local log directory in your development environment.

## Deliberate MVP limits and possible Phase 2

No accounting, payments/deposits, invoices, delivery, warranty, auto-posting or multi-company support. Manual sales-copy publishing, reliable stage buttons instead of drag-and-drop, and explicit reservation release keep the workflow simple. Inventory and customer list endpoints currently cap results at 1,000 rows; add pagination before inventory/CRM approaches that scale. Lead-based dashboard/follow-up totals include all leads. Image uploads do not transcode/compress or generate thumbnails. No automatic reservation-expiry job. Last-writer-wins detail editing for two users; stock transitions have stronger database guards.

Logical later improvements: pagination, thumbnail generation, CSV export, reservation-expiry reminders, and a restore screen. Do not add those until the team needs them.

## Personal LINE follow-up reminders

Apply `0004_line_reminders.sql` before deploying this feature. Leads have `assignedTo` (an allowed Access email); existing leads remain unassigned until edited. Each salesperson must be in both Cloudflare Access and `ALLOWED_EMAILS`.

1. Store `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_CHANNEL_SECRET` as Worker secrets. The token is a Messaging API channel access token, not the numeric channel ID. Keep secrets out of Git and chat.
2. Set the Messaging API webhook to `https://fitness-equipment-manager.analyziie.workers.dev/api/line/webhook`, press Verify, and enable **Use webhook** in LINE Developers. If the OA already has another webhook integration, coordinate a shared receiver first; do not silently replace it.
3. Cloudflare Access has a dedicated path application for `fitness-equipment-manager.analyziie.workers.dev/api/line/webhook` with a bypass policy. This path has no app data APIs and accepts only POST requests authenticated by LINE HMAC-SHA256. All other routes still require Access JWT validation; descendants of the webhook path are not handled as webhooks.
4. Set `APP_URL` to the production HTTPS origin. Configure the Worker cron `*/5 * * * *` (UTC). The handler checks every five minutes; reminders become eligible 24 hours before a future appointment. An appointment created with less than 24 hours left is eligible on the next run. Past and WON/LOST appointments are skipped.
5. In Settings, each salesperson adds the OA as a friend, creates a connection code, and sends it privately to the OA. The code expires after 10 minutes, is stored hashed, and is single-use. Group chat codes are ignored. One LINE user can belong to only one app email. Connecting opts in; pause/disconnect controls are available. Unfollow events disable delivery.
6. Choose **Responsible salesperson** in the lead form and set the next follow-up. Only that salesperson is notified. Messages include appointment time and a protected app link, without customer names, notes, lead titles, or prices.

Delivery jobs are stored in D1 with a unique key for appointment/lead/recipient. Concurrent cron invocations acquire a lease; LINE retries reuse a UUID retry key. Transient network/429/5xx failures back off (5–60 minutes, maximum 12 attempts and 23 hours). Rescheduling/reassignment/cancellation invalidates stale jobs, with a final live check before each send. A change after the final check can race a message already in flight. LINE acceptance is not a delivery/read receipt; a blocked OA, quota or provider outage can prevent delivery. See the recipient's Settings for recent status. Failed jobs do not automatically restart after the retry window. Cron changes may take up to 15 minutes to propagate.

Local tests use signed synthetic webhooks and an injected sender: no real LINE messages. Production end-to-end delivery requires an actual salesperson to link their own LINE and opt in. Do not simulate a real user's linking signature or change real appointments for a test.

### Sales team profiles

Settings → Sales team lists authorized accounts and stores first name, last name, and optional phone in D1. Any authorized workspace member can edit these shared profiles, consistent with this app's shared workspace settings; edits record the actor in the activity log. This screen does not grant login access or change email identities. New accounts must be added to both Cloudflare Access and `ALLOWED_EMAILS`; they appear automatically with blank names. No names are inferred from emails.

Apply `0005_salespeople.sql` before deploying this version. The lead form and follow-up detail form use the same database-backed salesperson selector. Pipeline and follow-up cards display saved names; email remains the stable identity used by existing lead assignments and LINE links. Accounts removed from `ALLOWED_EMAILS` are excluded from selectors while their profile records and historical assignments remain intact. Customer names and contact names remain free-text customer information.

### Team chat

Apply `0006_team_chat.sql` before deploying. `/chat` is a single shared internal room for authorized workspace users. Messages are stored in D1 with server-assigned sender identity and time; first/last names come from salesperson profiles. A message contains up to 2,000 characters and up to three distinct existing inventory items, or attachments alone. Product cards show current name, SKU, price, status and a protected image/detail link. Archived items remain visible in history but cannot be newly attached or opened. Text is rendered as plain React text, never HTML.

The visible chat receives new messages immediately over an authenticated WebSocket coordinated by the `ChatRoom` Durable Object. D1 remains the source of truth. The client reconnects with exponential backoff, catches up from an ordered numeric cursor after reconnecting, and polls only as a fallback while the socket is unavailable. The Hibernation API allows idle connections to sleep. History loads 50 messages at a time; reading older messages does not force a jump to the bottom. A unique client request ID scoped to the signed-in sender prevents duplicate sends on retries, with changed-content retries rejected. Failed sends preserve the draft. Existing Access/JWT and same-origin protections apply to all chat endpoints. This is an in-app team room; there are no external LINE notifications, private rooms, read receipts, file uploads, editing or deletion in this minimal version.

Wrangler binds `CHAT_ROOM` to the SQLite-backed `ChatRoom` class and applies the `chat-realtime-v1` Durable Object migration. Every WebSocket upgrade is authenticated by the Worker before it reaches the room. Browsers can only receive events; attempted client frames are closed with a policy violation. Messages are persisted to D1 before broadcast, so a broadcast failure or disconnected client recovers from history without losing the message.
