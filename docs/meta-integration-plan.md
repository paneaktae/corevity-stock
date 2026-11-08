# Meta / Facebook integration — Phase 1 review and implementation plan

Reviewed: 2026-10-18 (Asia/Bangkok). Scope: extend the existing CRM, one phase per delivery. Phase 1 delivers this repository review and implementation plan; runtime implementation starts in Phase 2. No Meta credentials are needed for Phases 1–3. No production resource, secret, or database was changed during this review.

The original requirements are preserved in `meta-integration-requirements.txt` beside this document. Treat those requirements as the full specification; this document translates them into repository-specific work and acceptance gates.

## Verified repository architecture

These findings come from the current working files, including existing uncommitted changes. The workspace parent is not a Git repository; `crm/` is its own repository. There are many pre-existing modified and untracked CRM files. Preserve them and add changes incrementally. No applicable AGENTS.md was found in the inspected workspace/ancestor locations.

| Area | Verified implementation | Integration decision |
| --- | --- | --- |
| CRM frontend | React 19, TypeScript, React Router 7; `src/main.tsx`; Vite 8 | Extend the existing app and navigation |
| UI | Tailwind 4 plus `src/style.css`, Lucide, `src/components/ui.tsx` | Reuse Header, Field, Loading, ErrorBox, panels, tables and responsive conventions |
| Language | `src/i18n.ts`, English source strings, Thai `src/th.json` | Add Thai/English strings using the existing mechanism |
| Client requests/state | `src/lib.ts`: `api`, ApiError, useData, local React state | Use the existing `/api` client and errors; no new state framework |
| API | Hono in `worker/index.ts`; domain route files such as `worker/catalogs.ts` | Add a Meta route module rather than expanding unrelated handlers |
| Persistence | D1 binding `DB`; Drizzle `worker/db/schema.ts`; SQL in `drizzle/migrations` | Add forward-only SQL migrations and matching schema declarations |
| Migration sequence | 29 SQL files, `0001_initial.sql` through `0029_website_chats.sql` | Reserve `0030_meta_foundation.sql` for Phase 2; recheck numbering before writing |
| Authentication | `worker/auth.ts`, `worker/password-auth.ts`; D1 auth sessions with hashed tokens; HttpOnly SameSite=Lax cookie | Reuse authenticated email; do not replace sign-in |
| Membership/admin | `ALLOWED_EMAILS` plus active `workspace_users` at login; `AUTH_ADMIN_EMAIL` with first allowed-email fallback | Reuse admin identity for configuration; add a shared Meta authorization guard |
| API safety | security headers, same-origin mutation checks, body limits, Zod validation and structured errors | Keep these protections for Meta CRM routes; add narrower payload limits |
| Inventory/CRM | products, customers, leads, lead_products, reservations, product_sales; quotations; finance; calendar/follow-ups | Link to existing records; preserve sales and reservation constraints |
| Product sharing | catalogs/catalog_items; public slugs; separate `worker/public-catalog.ts`, `wrangler.catalog.jsonc` | Reuse eligible public links and explicit public field projections |
| Existing chat | Team chat and catalog/website customer chat; D1 persistence | Keep Messenger records separate from internal and website chat |
| Realtime | `CHAT_ROOM` SQLite Durable Object; event types tied to team chat | Start Messenger with authenticated cursor polling; do not broadcast customer messages to team chat |
| Background work | Existing five-minute production cron handles LINE, mentions, calendar and exchange rate | Extend with bounded Meta job processing; preserve existing jobs |
| Async infrastructure | No Queue binding in the reviewed CRM configuration | Use D1 durable jobs/leases first; add Queues only if justified later |
| AI | DescriptionProvider in `worker/services/ai.ts`; structured inventory search in `inventory-assistant.ts`; server configuration | Reuse configuration and factual lookup patterns, with a dedicated Messenger/Ads contract |
| Deployment | Cloudflare Vite plugin, one Worker with SPA assets; production D1/R2/DO bindings | Keep current build/deploy flow; no new CRM deployment |
| Public website | Separate Next.js 16 app in `website/`, intended for Vercel, existing public catalog integration | No website rebuild or Meta credentials in the website |
| CI/tests | Vitest, esbuild, Miniflare D1/R2/DO; GitHub workflow checks and production build | Extend existing tests and run regression checks at each phase |

The README contains historical snapshots (for example, “four migrations” and 63 tests). Current files and actual check results take precedence.

## Gaps and decisions to carry into implementation

1. No Meta integration module or general feature-flag service was found. Existing Facebook captions and outbound Facebook contact links are not API integration. Use Worker configuration booleans, parsed strictly with safe defaults, rather than introducing a flag service.
2. No general role model exists. Current administration is an email-based rule, not a complete RBAC system. Meta connection/configuration and grants must require the workspace administrator; staff reads and writes must have explicit capability checks on the server. Recheck active membership for protected Meta operations: current session middleware reads valid session rows but does not itself recheck account membership on every request. Do not claim global membership enforcement already exists.
3. No encrypted Meta token storage or OAuth state store exists. Store operator-managed App Secret, verify token and encryption key as Worker secrets. OAuth-acquired access tokens require authenticated encryption before D1 persistence, with random nonce, key version and identity-bound additional data. Never persist plaintext secrets in settings or return token values to clients. Token health metadata is separate.
4. Existing leads require a customer and have NEW/CONTACTED/INTERESTED/QUOTED/WON/LOST stages. Unlinked Messenger contacts stay in Meta conversations until staff explicitly links or creates a customer. Do not change existing pipeline stages or merge people by display name. Add provider/source references without duplicating leads.
5. Generic internal product/chat models can contain private data. Product sharing and AI context need explicit safe field lists; never serialize full inventory rows into customer-facing output. Respect catalog status, expiry, publication and price visibility. If no shareable public link exists, explain that rather than exposing an authenticated CRM link.
6. Demo is a separate provider and data namespace, not an extra live connection state. A mock connection may display CONNECTED only alongside a persistent DEMO label. Demo records must not create real customers/leads, alter inventory, trigger LINE reminders, call Meta, or mix into live analytics. Initially use deterministic fixtures; isolate any persisted demo writes explicitly.
7. OAuth callback needs the existing session plus one-time, expiring state bound to the initiating user/session and configured callback. Webhook verification/POST need narrowly scoped public handlers that authenticate Meta rather than a CRM cookie. Do not exempt a broad `/api/meta/*` path from authentication. The LINE webhook dispatch in `worker/index.ts` is a structural reference, not a substitute for Meta-specific verification.
8. No Graph API version, permission list, token refresh behavior, metric availability or publishing capability is assumed verified. Before Phase 4 and each provider-specific module, retrieve current official Meta documentation, record verification date/version/use case and gate unsupported operations. Never default an unknown API version or capability to “working”.

## Proposed module boundaries

Use `shared/meta.ts` for validated public contracts and status/capability types. Keep secrets and provider responses in `worker/services/meta/`. Add a Hono route module `worker/meta.ts`, frontend pages under `src/pages/meta/`, and focused components under `src/components/meta/` as each phase needs them. These are planned paths, not implemented modules.

Flow: existing React UI → authenticated Hono routes → MetaIntegrationService and capability checks → MockMetaProvider or GraphAPIMetaProvider → explicit safe response mapping.

The mock provider has no HTTP dependency. The live provider takes a bounded HTTP client with timeouts, safe error mapping, cursor pagination and rate-limit handling. Provider selection happens only on the backend; credential presence alone never establishes a connected/authorized state. Configuration failures return actionable status and do not crash unrelated CRM requests.

Group services by need: configuration/status/provider/audit first; OAuth/token/Page next; webhook/Messenger/jobs next; leads/ads/insights/campaign/content/AI in their own phases. Avoid creating empty services merely to match the suggested names.

### State and feature contracts

Support NOT_CONFIGURED, CONFIGURATION_INCOMPLETE, READY_TO_CONNECT, CONNECTING, CONNECTED, TOKEN_EXPIRED, PERMISSION_REQUIRED, RECONNECT_REQUIRED, ERROR and DISCONNECTED. Represent mode, disabled state, permissions and per-feature capabilities separately. Define precedence and recovery actions in Phase 2 tests; a stored status cannot override expired/revoked credentials.

Use all requested flags: META_INTEGRATION_ENABLED, META_DEMO_MODE, META_MESSENGER_ENABLED, META_LEADS_ENABLED, META_ADS_READ_ENABLED, META_ADS_WRITE_ENABLED, META_AI_ENABLED, META_PAGE_CONTENT_ENABLED. Default integration/features off; the local example can enable Demo explicitly. External writes additionally require live connection health, operation-specific permission and explicit staff action. Sending messages/publishing ads/posts must never follow automatically from enabling a flag. AI drafts always require human review.

### Database evolution

Phase 2 should create only foundation tables needed immediately: meta_connections, meta_pages, meta_ad_accounts, meta_permissions, meta_token_metadata, encrypted token storage, meta_integration_settings and meta_audit_logs. Add OAuth state storage in Phase 4. Add domain tables with their owning phase rather than deploying all speculative tables at once.

Later entities: meta_conversations, meta_messages, meta_customer_identities, meta_webhook_events, meta_sync_jobs, meta_lead_form_mappings, meta_lead_sync_events, meta_campaign_cache, meta_insights_cache and approval/draft records. Keep CRM foreign keys pointed at customers, leads and products. Use a uniqueness constraint on `(provider, page_id, provider_user_id)` for customer identity. Scope message/event/lead import deduplication to appropriate provider identities and page/account; scope caches by account, date range, API version and attribution/reporting parameters.

Jobs need durable status, attempts, next-attempt time, lease, sanitized failure code and provider idempotency reference where supported. Audit logs record actor, action, entity and safe outcome, excluding token values and customer message bodies. Webhook payload retention and customer data retention must be bounded; do not store unnecessary raw payloads forever. D1 batches/constraints must protect message persistence, lead conversion and approval transitions from retries/races.

## Phased delivery and acceptance gates

| Phase | Concrete scope | Acceptance gate |
| --- | --- | --- |
| 1 — repository review | This document, saved requirements, current architecture and baseline checks | Existing architecture and risks mapped; no runtime or database changes |
| 2 — foundation | Forward SQL migration, Drizzle declarations, shared states/config/capabilities, provider contract, minimal mock and fail-closed live boundary, safe status API, admin guard and audit primitives | Fresh database and upgrade from migrations 0001–0029 both work; existing rows preserved; missing config/partial config/flags/authorization tested; no Meta requests |
| 3 — settings and Demo | Settings → Integrations → Meta, 10-step wizard, connection detail, permissions/logs/actions, Thai/English states; fixtures for Page, inbox, inquiries, leads, campaigns, analytics, Page insights and webhook events | Clearly labeled DEMO throughout; zero Meta HTTP calls; isolated demo state; disabled live actions; usable mobile/tablet/desktop; no secrets in responses/build |
| 4 — OAuth and Page connection | Current official flow, one-time state, callback/code exchange, encrypted tokens, validation/permissions, Page selection, ad-account selection, reconnect/disconnect/revocation | Tests cover replay, expiry, wrong session, malformed/error callbacks, token expiry and missing permissions; no token logging; live status READY FOR META CONFIGURATION until actually tested |
| 5 — webhooks and Messenger | Exact public webhook path, challenge/signature/body validation, durable dedupe/retry jobs, inbox/search/filters/unread/assignment/status/notes, text send with eligibility checks | Forged/repeated/out-of-order events and job retries tested; persistence precedes acknowledgement; messaging-window checks; manual sends only; mobile inbox and polling verified |
| 6 — CRM and inventory | Page-scoped identity mapping, staff customer association, idempotent conversation→existing lead flow, follow-up and safe inventory sharing | No name-based auto-merge; no duplicate conversion on retries; existing stage/sale/reservation behavior unchanged; private fields excluded; Demo cannot create live leads |
| 7 — Messenger AI | Intent, summary, Thai/English translation, inventory-backed suggested replies and qualification/follow-up suggestions | Missing AI config disables gracefully; supplied inventory facts only; prompt content treated as untrusted; draft edit/review/send stays explicit; no automatic send |
| 8 — Lead Ads | Supported forms, authorized fields, form mappings, webhook retrieval, source references, import history/status/retry, assignment and follow-up | Duplicate provider leads imported once; partial form data preserved honestly; permissions and transient failures tested; retention rules documented |
| 9 — Ads reporting | Accounts/campaign list/details, insights/date filters, currency/timezone/attribution/cache/pagination | Missing metrics shown unavailable; zero denominators handled; derived metrics tested; API rate-limit and delayed-reporting behavior visible; no writes |
| 10 — campaigns | Ad sets/ads, draft→validation→review→confirmation→publish, supported edits, pause/resume, permission guard and audit | ads_management absent means read-only; approval bound to exact draft revision; replay/concurrent publish tested; no silent budget changes or automatic publishing |
| 11 — Ads AI | Observed data vs calculated metrics vs recommendations; copy/creative/audience/budget suggestions; approved draft handoff | No unsupported causal claims; no direct mutations by AI; existing approval and budget guards remain required |
| 12 — Page insights/content | Verified supported metrics, trend/post data, drafts, inventory images/captions and supported approved publishing/scheduling | Unsupported metrics/actions disabled explicitly; media requirements validated; explicit approval and audit for writes; mobile review |
| 13 — integration review | Complete regression/security review, automated tests, environment/setup/troubleshooting docs, permission/App Review matrix, activation checklist | End-to-end Demo verification plus honest live verification record; no claim of Meta production verification without real tests |

Run meaningful tests within each phase; do not defer authentication, signature, encryption, idempotency or approval tests until Phase 13. Each delivery should list files, migrations, checks, Demo verification, credentials/review dependencies and limitations. The latest user request authorizes all remaining phases together; the earlier phase stopping rule no longer applies.

## Configuration and activation plan

Extend `Bindings` server-side with optional Meta configuration; no build-time required values and no `VITE_` secrets. Extend `.dev.vars.example` with empty placeholders and safe flags during Phase 2. Keep secret inputs out of admin UI initially; the wizard reports only whether server configuration is present. Wrangler vars hold non-secret configuration; Worker secrets hold secrets. Mirror non-inherited environment settings deliberately when production configuration is eventually prepared.

Later setup documentation must cover App/use-case preparation, exact callback/webhook URLs for the actual deployment, least-privilege permissions per feature, business verification/App Review where applicable, token type/lifecycle, test users/assets, encryption-key backup/rotation, retention, revocation and recovery. No Meta app/account/page ID is hardcoded. Production credentials and remote migrations are never changed automatically as part of this review.

Activation sequence after implementation: review migrations and backup → apply approved forward migrations → deploy with live writes disabled → configure actual secrets/API version → run OAuth and validate selected assets/permissions → verify signed webhook and read-only sync → explicitly enable approved write features → perform human-approved live checks → record actual results. Keep Demo available independently. Detailed provider commands/capabilities must be verified against official documentation in the owning phase.

## Phase 1 validation record

- `npm exec tsc -- --noEmit`: passed.
- `npm run lint`: passed.
- `npm test`: 9 files, 81 tests passed against local isolated fixtures/storage. Initial sandbox run could not open a loopback listener (`listen EPERM`); rerunning with local listener permission passed. No production database or external Meta operation was used.
- `npm run build`: passed (exit 0), Worker and client bundles generated. Existing bundle-size warnings remain. Wrangler also reported an EPERM writing its diagnostic log outside the workspace; this did not prevent bundle generation. This was the default-config build, not deployment or live production verification.
- No migration, application code, feature flag or production secret has been added in Phase 1. Meta functionality and mobile Meta screens do not exist yet; no live Meta capability or App Review status is verified.

Phase 2 delivered: see [foundation implementation and validation](meta-phase-2.md). Phase 3 delivered: see [settings and Demo Mode](meta-phase-3.md). Phases 4–13 implemented: see [delivery, verification and live activation runbook](meta-phases-4-13.md). Live provider acceptance remains pending real configuration and verification.
