# Meta integration — Phases 4–13

Implemented 2026-10-18 in the existing Corevity CRM. Subsequent authorized production deployment is recorded in [the deployment report](meta-production-deployment-2026-10-18.md); statements below about no deployment describe the implementation acceptance boundary. The user's latest request authorizes completing all remaining phases together. Earlier one-phase stopping points are historical.

**สถานะ:** พัฒนาระบบและ Demo สำหรับ Phase 4–13 แล้ว การเปิดใช้กับ Facebook จริงยังเป็น **READY FOR META CONFIGURATION** จนกว่าจะตั้งค่าแอป สิทธิ์ API และทดสอบกับบัญชีจริง ไม่มีการ deploy หรือแก้ฐานข้อมูล production ในงานนี้

## Delivery map

| Phase | Delivered | Main implementation |
| --- | --- | --- |
| 4 | Session-bound, expiring, one-use OAuth state; code exchange, token inspection, encrypted User/Page tokens; Page/account selection; validation, reconnect, disconnect/revoke, signed deauthorization | `worker/services/meta/oauth.ts`, `deauthorization.ts`, `store.ts`, `graph.ts` |
| 5 | Raw-body HMAC webhook; exact public endpoints; normalized durable events, leases and retry/backoff; Messenger inbox, polling, search/status/assignment/notes/unread; manual text send and receipts | `webhooks.ts`, `inbox.ts`, `worker/meta-domain.ts`, `src/pages/Meta.tsx` |
| 6 | Page-scoped customer identities; explicit linking to existing customers; existing customer creation screen; one lead per conversation with products, owner and next follow-up; published inventory projection | `inbox.ts` and existing CRM routes |
| 7 | AI intent, quoted conversation summary, Thai/English translation, public-inventory reply suggestions and follow-up guidance; editable human approval before explicit send | `ai.ts` and Inbox composer |
| 8 | Authorized form listing and mappings; webhook/manual cursor sync; bounded leased imports; stable provider-lead deduplication; owner and import/retry history | `leads.ts` |
| 9 | Account/campaign insights, date presets/custom range, current-page metrics, null-safe CTR/CPC/CPM/CPL, currency/timezone/attribution notice, scoped cache and pagination | `reports.ts`, `provider.ts` |
| 10 | Campaign/ad set/ad inspection; new paused campaign drafts; supported name/status edits; ordered validation, review and confirmation; exact revision approval, single publisher, audit | `drafts.ts` |
| 11 | Campaign CPL comparison/high-cost candidate; observed facts versus calculated metrics versus tentative suggestions; inventory-based copy/creative/audience ideas and conditional budget-reallocation guidance; campaign draft handoff | `ai.ts` and Ads dashboard |
| 12 | Configured supported Page metrics and trend rows; published posts and post insights; reviewed text/product-photo drafts and gated scheduling | `reports.ts`, `provider.ts`, `drafts.ts` |
| 13 | Capability/admin/member checks, encryption, bounded inputs/provider responses, no redirect following, replay/race protection, synthetic integration tests, isolated Demo launcher and this runbook | `access.ts`, `maintenance.ts`, tests and documentation |

All Meta workspace pages retain a mode banner. Existing password authentication, CRM routes, inventory sale/reservation triggers, LINE jobs, calendar and exchange-rate jobs remain in place. Meta is a lazy-loaded frontend module. Messenger history is separate from team and website chats.

## Database and deployment boundary

Apply the forward migrations in order, after reviewing a backup and the existing migration history:

- `0030_meta_foundation.sql`: connection/assets/permissions/token metadata/encrypted secrets/settings/audit.
- `0031_meta_workflows.sql`: OAuth state and generation guard, conversations/messages/receipts/notes/identity/lead links, durable webhook/import jobs and mappings, drafts/approval, reporting cache, Demo state, AI drafts and rate limits.

There are 27 Meta tables after both migrations. The matching Drizzle definitions are in `worker/db/meta-schema.ts` and `meta-workflow-schema.ts`. Migration tests use fresh databases and an upgrade from the existing CRM migrations. No existing CRM table or row is deleted by these migrations. Apply all pending older CRM migrations too; this workspace contains other unfinished work predating this delivery.

Do not deploy the new settings/domain code without its migrations. Test on a preview environment before production. No remote migration or deployment was executed here.

## Run the isolated Demo

From `crm/`:

```sh
node scripts/meta-demo-preview.mjs
```

Open `http://localhost:4178/meta/inbox`. The launcher bundles the actual Worker, applies the actual migrations to a new in-memory D1 database, starts the actual React app, enables Demo features and blocks every outbound Worker request. It does not read `.dev.vars` into the Worker or reuse the local/production CRM database. Stop with Ctrl+C; all preview records are disposable. It binds only to loopback and must never be deployed as an authentication configuration.

Try Inbox → visitor → generate reply → edit → approve → simulate send; simulate a new incoming message/read receipt; create a Demo lead; inspect Ads/Lead forms/Page content; create and review a campaign/post draft before simulated publication. Demo AI is deterministic and does not contact the configured AI provider. Empty public inventory is shown honestly. Existing local/production Demo mode can read eligible public inventory, but every simulated write stays in the Demo namespace and creates no real customer/lead.

For the regular Worker, `.dev.vars.example` lists the eight flags. Each requires the exact value `true`. All missing flags are off. To exercise features in Demo, enable the integration, `META_DEMO_MODE` and the desired feature flags. The UI Demo preference cannot exceed the environment's Demo flag. Disabling integration leaves setup accessible. Admin can simulate connection/disconnection. No Meta credentials are required.

## Live configuration

Keep secrets server-side. Never use `VITE_` variables for credentials or enter token values into the settings screen.

| Setting | Storage / purpose |
| --- | --- |
| `META_APP_ID` | Worker configuration; app ID from your Meta app |
| `META_LOGIN_CONFIG_ID` | Optional Facebook Login for Business configuration ID; when set, its configured permissions replace the legacy scope query |
| `META_APP_SECRET` | Worker secret; server token proof and callback verification |
| `META_WEBHOOK_VERIFY_TOKEN` | Worker secret; independently generated challenge secret |
| `META_GRAPH_API_VERSION` | Explicit supported version verified for this app/use case; no default version is guessed |
| `META_OAUTH_REDIRECT_URL` | Exact HTTPS CRM origin plus `/api/integrations/meta/callback`; no query or fragment |
| `META_TOKEN_ENCRYPTION_KEY` | Worker secret; base64-encoded random 32-byte AES key |
| `META_TOKEN_ENCRYPTION_KEY_VERSION` | Key identifier; must match the active key |
| `META_LIVE_ACTIVATION_CONFIRMED` | Defaults false. Set true only after checking current app/use-case/API configuration; this permits connecting and authorized API calls |
| `META_PAGE_INSIGHT_METRICS` | Comma-separated metric names verified for the configured version/Page; blank disables unknown metrics |
| `META_POST_INSIGHT_METRICS` | Separately verified post metric names; blank returns no post metrics |
| `META_PAGE_SCHEDULING_SUPPORTED` | Defaults false; enable only after verifying the exact text/photo scheduling operation for the selected version |
| `META_DATA_RETENTION_DAYS` | Message/note retention, integer 30–365, default 90 |
| `PUBLIC_CATALOG_BASE_URL` | Existing HTTPS catalog origin; required for public product links/photos |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | Existing server AI configuration; reused for Responses API requests. No new AI account/key is created |

`META_LIVE_ACTIVATION_CONFIRMED` is a configuration acknowledgement, not evidence that production was tested. A connection becomes usable only with fresh, nonexpired encrypted token metadata and relevant permission grants. Ads additionally require a healthy User token and selected account. Secrets alone do not establish a connection.

Use the deployed CRM origin, for example the currently configured `https://management.corevityusedgym.com`, and register:

- OAuth callback: `/api/integrations/meta/callback` — requires the initiating CRM password session.
- Webhook: `/api/webhooks/meta` — GET challenge and signed POST events; no CRM cookie.
- Deauthorization callback: `/api/integrations/meta/deauthorize` — signed form POST; no CRM cookie. Signature, algorithm, user identity and reconnect time are checked; repeated requests are harmless and encrypted credentials are removed.

If Cloudflare Access protects the hostname, permit Meta to reach only the exact webhook and deauthorization paths. Keep all other CRM APIs protected; these public handlers verify Meta signatures themselves. Do not broaden a bypass to `/api/meta/*` or the whole integration prefix.

The public privacy policy/data-deletion instructions and actual business/app review configuration must be supplied for your Meta app. Deauthorization destroys credentials and disables the connection; it does not silently erase CRM customers, leads or business records. Data-deletion requests require a reviewed business retention/deletion process. A separate automatic data-deletion callback is not supplied by this implementation.

## Permissions and Meta review

Request only features enabled for the intended app. Check Meta's current use-case and access-level requirements; Business Verification, Advanced Access, asset tasks and App Review may be required. A stored permission string is not an approval or a guarantee the selected asset is accessible.

| Feature | Scopes requested / checked |
| --- | --- |
| Discover/select Pages | `pages_show_list`, `pages_read_engagement` |
| Subscribe Page webhooks | `pages_manage_metadata` plus the enabled feature scopes |
| Messenger | `pages_messaging`; selected Page and Page token |
| Lead Ads | `leads_retrieval`, `pages_manage_ads`; selected Page/form, business Leads Access and eligible Page tasks must also be granted by Meta |
| Ads reports | `ads_read` or `ads_management`; selected ad account and User token |
| Campaign mutations | `ads_management`; workspace administrator and write flag |
| Page posts/photos | `pages_manage_posts`; workspace administrator and content flag |
| Page/post insights | `read_insights`; selected Page. Content list additionally checks `pages_read_engagement` |

OAuth scope requests adapt to the enabled features. The callback inspects returned app/user identity, scopes, granular assets and expiration. Pagination follows cursors at a fixed Graph host; returned paging URLs are never fetched. New campaign creation always sends PAUSED and has no budget fields. Supported campaign mutations are name and ACTIVE/PAUSED status; ad set/creative/budget editing is intentionally unavailable.

Short-lived User tokens are exchanged during connection; this is not a generic refresh-token implementation. The five-minute cron validates due tokens (six-hour interval); requests fail closed after 24 hours without validation or after expiration/revocation. Expired credentials require reconnect. Refresh validates current tokens; it does not promise to extend their lifetime or reacquire assets. Reconnect to discover new Page/account grants.

## Operation and recovery

**Messages:** explicit human approval, client request ID, matching actor/body, current conversation/Page and standard 24-hour incoming-message window. Reply is text only; product sharing uses actual public links. Delivery/read receipts update monotonically; IDs and watermarks are treated separately. Unknown attachment types appear as attachment placeholders. No policy tags, outside-window bypass, automated send or automatic external write retry is implemented.

**AI:** latest 20 stored conversation messages plus at most 50 public available products are supplied to the configured provider. Treat customer/catalog strings as untrusted. Replies/captions use validated inventory projections; summaries quote supplied messages; translations reject introduced numeric facts. Human review remains necessary for translation accuracy and model suggestions. Approved replies recheck current inventory before sending. Missing AI configuration disables AI capability and does not disable Inbox or reporting. Ad analysis uses the first reporting page, clearly scoped; pagination/attribution and lead-quality limitations apply. Budget suggestions do not change money or provide an approved allocation amount.

**CRM:** staff explicitly links identities by Page + sender ID. Creating a customer reuses the existing CRM form; then link it from Inbox. Display names/emails do not auto-merge contacts. A conversation converts once to a lead. Lead Ads create one customer/lead per Page + provider lead ID, using only mapped submitted fields. Missing/invalid budget has CRM numeric fallback zero with an explicit submission note; it is not inferred demand. Import assignments must reference active workspace salespeople. Messenger next follow-up uses existing lead fields and existing follow-up/LINE handling.

**Durable jobs:** webhook acknowledgement follows persistence; background processing and the existing cron claim leases, retry with capped backoff (eight attempts) and expose sanitized failures. Fix the underlying permission/mapping/owner issue before retrying a failed event/import from the UI. Processed events are idempotent. Manual sync pages through authorized form leads, without enumerating unrelated forms/assets.

**Publishing:** save → validate → review → confirm → publish the exact revision. Approval tokens are hashed at rest, expire after ten minutes and are consumed on the publishing claim. Edits reset approval. Concurrent publication claims cannot both call Meta. A confirmed new campaign is still PAUSED. Text and one public product photo are supported; video/carousel/arbitrary uploads are not. Product photos must exist and still be published/available at validation/publication. Scheduling is gated and restricted to 10 minutes–75 days in the future; the operator must verify support before enabling it.

**UNKNOWN outcomes:** timeouts/provider 5xx can occur after Meta accepts a write. Such messages/drafts are never automatically resent. Stale pending/publishing operations become UNKNOWN after five minutes. Inspect Meta Business Suite/Ads Manager and audit references, confirm the actual result, and reconcile deliberately before preparing a replacement. This release has no automatic UNKNOWN-resolution action. Local idempotency does not imply Meta supports an external idempotency key for every operation.

**Rate limits/errors:** fixed-host calls have bounded response bodies and timeouts; redirects are rejected without following them. Missing permissions/token failures are mapped to safe errors; provider 429 asks staff to wait. Reporting uses a five-minute cache scoped to mode/assets/parameters/version/metric configuration. CTR/CPC/CPM/CPL remain null if any input is missing or denominator is zero. Totals apply to the displayed reporting page, not all campaigns. Post performance uses separately configured lifetime metrics, not a fabricated custom date range.

## Privacy, retention and key recovery

Meta audit logs contain actor/action/entity/outcome; no token, private message body or raw provider errors are logged. Settings return configuration presence and token health only. Public product data excludes cost, margin, serial numbers, internal notes and hidden prices. Do not add raw provider responses to UI/logs.

The existing cron retains messages and internal notes for the configured 30–365 days (default 90), AI drafts for 30 days, processed webhook payloads for seven days, event metadata for 30 days and operation audits for 365 days. UNKNOWN messages are preserved for reconciliation. Connection/assets, explicit customer identity links, business lead references, mappings, drafts and Demo entities are not automatically erased; administer them under the business retention policy. Customer/lead CRM records are not deleted by Meta maintenance. Foundation connection audit entries are retained separately. Disabling integration suspends Meta maintenance as well as jobs; account for that when retiring the feature.

Back up the encryption key securely outside the database. AES-GCM uses random nonce, key version and connection/token/type/asset-bound additional data. This release accepts one active encryption key. For rotation, disconnect (destroy saved token secrets), replace key and key version securely, then reconnect; keep a database backup and prior key under your approved retention procedure. Do not merely change the key version on existing ciphertext. Losing the key requires reconnect; no plaintext recovery endpoint exists.

## Verification record

- Local regression suite: 11 test files, **128 tests passed**.
- TypeScript, ESLint and default Vite production build passed. Existing large client/PDF chunk warnings remain. Meta is a separate lazy chunk.
- Tests run the actual bundled Worker with isolated D1/R2/DO and synthetic provider responses; no real Meta or AI request. They cover OAuth session binding/replay/expiry, encrypted secret storage, asset scoping, invalid signatures, duplicate/out-of-order events, explicit sends/24-hour window, CRM identity/conversion/import deduplication, cache/metrics, admin/partial grants/token expiry, draft revision/concurrency/unknown outcomes, Page publishing, public inventory/stale AI snapshots, deauthorization, redirects, missing AI configuration and Demo zero-egress/zero real CRM writes.
- Browser: isolated Demo Inbox rendered; generated AI reply was approved and simulated send visibly became SENT; mobile 390×844 showed usable conversation/composer with back navigation; campaign DRAFT → VALIDATION → REVIEW → CONFIRMATION → simulated PUBLISHED was exercised end to end. Other screens were verified by type/build and API tests, not a claim of exhaustive visual testing on every device.
- No production credentials, Page subscription, Meta webhook delivery, real Lead Ad, actual message delivery, real campaign/post publication or live AI response was verified. Record these results separately during activation.

## Official sources and verification limits

Reviewed 2026-10-18. Meta developer reference pages were rate-limited (HTTP 429) during implementation. Official Meta SDK source and Meta-owned Postman examples informed the adapters. These are evidence of operation shapes, not approval that every metric/version/use case is currently available for your app. No default Graph version or metric name was invented. Recheck the current official reference and App Dashboard before live activation, especially scheduling and Page/post metrics.

- [Meta Python Business SDK Page operations](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py)
- [Meta Python Business SDK Ad Account operations](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py)
- [Meta Python Business SDK Post Insights](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/post.py)
- [Meta Marketing API examples](https://www.postman.com/meta/facebook-marketing-api/overview)
- [Meta Messenger sample](https://github.com/fbsamples/messenger-platform-samples/blob/main/node/app.js)
- [Meta archived SDK signed-request verification](https://github.com/facebookarchive/facebook-php-sdk/blob/master/src/base_facebook.php) — cryptographic format reference; archived, not current app-review guidance.
- [Facebook Login manual flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/)
- [Messenger Platform policy](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview/)
- [Meta permissions reference](https://developers.facebook.com/docs/permissions/)

Live activation remains a separate acceptance gate: preview backup/migrations → supported-version/metric check → app/privacy/review configuration → secrets and read flags → explicit activation acknowledgement → OAuth/assets → signed webhook/read-only imports → approved write flags → one controlled manual send/paused campaign/post → record outcomes and recovery steps. Stop if permission or API support differs from the configured contract.
