# Meta integration — Phase 2 foundation

Delivered 2026-10-18 (Asia/Bangkok). This extends the existing CRM Worker and authentication. No Meta calls, new dependencies, production deployment, remote migration or production secrets were used. Settings UI and interactive Demo workflows belong to Phase 3; OAuth belongs to Phase 4.

## What is implemented

- `0030_meta_foundation.sql`: eight additive tables for connections, Pages, ad accounts, scoped permissions, token metadata, encrypted token envelopes, workspace Demo preference and audit logs. No existing tables are altered; no fake connections/credentials are seeded. Mode uniqueness, selected asset uniqueness, foreign keys, status checks and scoped token/permission uniqueness are enforced in SQL. Drizzle declarations live in `worker/db/meta-schema.ts`, re-exported by the existing schema. Handwritten SQL is authoritative for database CHECK constraints, following existing migration conventions.
- `shared/meta.ts`: all ten requested connection states, eight flags, safe status contract and strict settings input. Flags are server-side strings; only the exact `true` enables a flag. Missing values default false.
- `worker/services/meta/`: configuration validation, status/health precedence, current membership/admin guards, fixed-vocabulary audit statements, mock/live provider boundaries and AES-256-GCM encryption helpers. Credentials are optional during build and request handling. A syntactically complete configuration means READY_TO_CONNECT, never proof that credentials are valid.
- A simulated Page and ad account use `demo:` IDs. The mock adapter has no HTTP, database or credential dependency. Status reads do not insert Demo records or modify customers/leads/inventory. The live adapter rejects operations until implemented. No external operation can be enabled by flags in this phase.
- Encryption uses a fresh random 96-bit nonce, a 128-bit authentication tag and additional authenticated data binding the connection, token ID, token type, asset and key version. Plaintext tokens are not stored in the envelope. Metadata and encrypted values have separate tables. Helpers reject wrong keys, identity swaps, tampering and key-version mismatch. OAuth persistence and lifecycle orchestration come in Phase 4.

## Authenticated endpoints

All routes inherit the existing session middleware, same-origin mutation checks, safe errors, security headers and private/no-store response caching. Every Meta operation additionally checks current active membership (environment accounts plus active workspace users). Administration uses AUTH_ADMIN_EMAIL or the first allowed account, matching the current application rule. There is no new general-purpose role system.

| Route | Access | Behavior |
| --- | --- | --- |
| GET `/api/integrations/meta/status` | Active workspace member | Safe configuration diagnostics, mode/label, status, stored permission metadata, health and effective capabilities |
| PATCH `/api/integrations/meta/settings` | Workspace administrator | Strict `{ "demoEnabled": true/false }` input, 2 KiB limit, atomic preference + audit write |
| GET `/api/integrations/meta/logs` | Workspace administrator | Latest 50 audit entries; fixed fields and vocabulary, no provider payloads/messages/secrets |
| GET `/api/integrations/meta/connect` | Workspace administrator | Explicit 501 META_NOT_IMPLEMENTED; no redirect or external request |

Secret values, encrypted values, nonces, provider error bodies and internal stack traces are not returned. Configuration diagnostics expose variable names only. The settings endpoint cannot accept credentials, feature flags, permissions, Page IDs or connection state.

Demo requires both META_INTEGRATION_ENABLED=true and META_DEMO_MODE=true. With no saved preference the environment controls Demo selection; an administrator may save demoEnabled=false to select live setup. The saved preference cannot override a false environment Demo flag. The flag alone never creates a live connection. All unfinished feature capabilities, including connect/send/sync/publish/AI, remain false even if their requested flags are true. A demo CONNECTED state is always accompanied by DEMO MODE, DEMO token health and FOUNDATION_ONLY implementation.

Live status reads stored health metadata only, without contacting Meta. Revocation, expiry (including malformed expiry timestamps) and missing permissions take precedence over a stored CONNECTED state. A stored healthy CONNECTED status still becomes RECONNECT_REQUIRED because live verification is not implemented. Stored permissions are historical metadata and do not authorize operations; per-asset permission verification is Phase 4. No VALID live token health or verified live Page is claimed.

## Local setup and future deployment

Run from `crm/` using the existing local migration workflow:

```sh
npm run db:migrate
```

Phase 2 tests apply migrations to disposable Miniflare databases only. This delivery has not migrated the persistent local or production database. Apply migration 0030 before running the new endpoints on either target. Existing tests automatically discover all numbered migrations.

The updated `.dev.vars.example` lists optional fields and defaults every Meta flag to false. Copy only the new lines into an existing ignored `.dev.vars`; preserve existing local configuration. For simulated status set META_INTEGRATION_ENABLED=true and META_DEMO_MODE=true, then restart the local dev server. Meta credentials can remain empty.

For future live setup, the foundation checks these variables: META_APP_ID, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN, META_GRAPH_API_VERSION, META_OAUTH_REDIRECT_URL, META_TOKEN_ENCRYPTION_KEY and META_TOKEN_ENCRYPTION_KEY_VERSION. The redirect must be an HTTPS URL at `/api/integrations/meta/callback` without embedded credentials, query or fragment. Actual configured-origin matching, OAuth state/code validation, Meta API version/use-case verification and token verification are Phase 4 requirements. A version matching `vN.N` is only a syntax check, not an endorsement of that version.

META_TOKEN_ENCRYPTION_KEY must be base64 for 32 cryptographically random bytes. META_TOKEN_ENCRYPTION_KEY_VERSION is a non-secret 1–32 character identifier using letters, digits, underscore or hyphen. Keep App Secret, verify token and encryption key server-side in ignored local vars or Cloudflare Worker secrets. Do not paste them into the UI, use VITE_ variables or put them in D1 settings. Page/user/system tokens will be acquired and encrypted by later server workflows; they are not required for this phase.

Only one encryption key version is supported by these primitives. Rotation/re-encryption is not automated. Preserve the original key securely before changing configuration; decryption with a changed key/version fails closed. Do not treat a key change as token refresh. Production activation still requires the later OAuth, permissions, webhook, security and provider verification phases.

## Verification and limits

- 105 tests across 10 files passed, including 24 new Meta tests and all 81 existing tests.
- Fresh installation and upgrade from migrations 0001–0029 were exercised in isolated databases; a pre-existing customer was compared before/after migration.
- Tested absent/partial/invalid configuration; strict flags; expired/revoked/missing-permission health; synthetic providers; encryption; authentication; stale session membership; staff/admin separation; same-origin writes; oversized/unknown inputs; no secret response fields; database uniqueness/foreign keys; atomic rollback if audit fails.
- No Meta credentials or App Review were needed. No real Meta capability, OAuth connection, message sending, API version or production behavior has been verified. Full Messenger/Ads/Lead/Page fixtures and mobile UI testing remain in their owning phases.
- Strict TypeScript, ESLint, `git diff --check` and `npm run build` passed. The build still has existing large client bundle warnings. Wrangler diagnostic logs were directed to a permitted temporary path; no deployment was performed.

For model choice, this phase combines authorization, encryption and migration correctness, so use a stronger coding model for implementation/review. Phase 3's translation, visual states and fixture work can use GPT-6-Luna once these contracts are fixed, with the completed changes checked against the same checks. This is a task-specific engineering assessment, not a guarantee of model performance.
