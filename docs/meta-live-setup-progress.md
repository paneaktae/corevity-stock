# Meta live setup progress

2026-10-18: user completed Developer registration and personally created the app after reviewing Meta terms.

- App: Corevity CRM, ID `1056201947478275`.
- Business portfolio: Corevity | Used Gym Equipment, ID `1498550375441430`; Meta currently labels business unverified.
- App remains unpublished.
- Five use cases selected: Messenger, campaign management, Ads analytics, Lead Ads, Pages.
- Facebook Login for Business is present. Saved the exact CRM OAuth redirect URI and deauthorization callback; Meta displayed “Changes saved”. HTTPS and strict redirect matching remain enabled.
- App advanced settings showed `v26.0` for both all calls and app-role calls. Prepared matching non-secret Worker config locally; it has not been deployed in this setup step.
- Production Meta Live activation remains false and Demo remains enabled.
- Existing production secrets were checked by name only. No Meta secrets were present.
- A temporary loopback-only import form at `http://localhost:4180` lets the user submit App Secret directly to the existing Cloudflare Worker. The generated helper never prints or writes submitted secret values to disk. Import additionally creates a random webhook verify token and random encryption key. User submission is required; do not read the App Secret from the Meta screen or chat.
- Helper source: `/private/tmp/corevity-meta-setup/import.mjs`; running exec session `32097`. GET `/status` reports only PENDING/SAVING/SAVED/FAILED. Do not restart a successfully submitted helper: preserve its webhook verify token until webhook setup is complete.
- Next: after user submits, verify secret names, deploy matching non-secret config, validate supported Login for Business configuration/use case and permissions, prepare read/test access, user grants OAuth explicitly, select Page, then signed webhook test. Do not claim working live service until actual user-approved tests succeed. Do not enable campaign/content writes as part of initial Messenger testing.
- Still required before publishing: actual privacy/data deletion information and any Meta-required review/business checks. No policy text or business verification was fabricated.

## Local import fix

User reported failure saving the local form. Service state was PENDING: no secret import had started. A browser-only empty-form diagnostic proved that `Referrer-Policy: no-referrer` serialized POST Origin as `null`, triggering the strict origin check. Changed only the local helper policy to `strict-origin`, retaining exact Origin/Host and constant-time CSRF checks. Restarted while still PENDING; no Cloudflare credential changed. Tests confirmed corrected response policy and rejection of foreign-origin/invalid input. Browser tab 5 now has the fresh form at localhost:4180; user must submit there again. Old failed /save tabs are obsolete. Do not read the user's actual secret input.

## Import destination correction

The helper reported SAVED but inspection of actual CRM secrets showed no Meta keys. Wrangler's getLegacyScriptName appends the environment when both --name and --env are supplied; the first import created/used `fitness-equipment-manager-production`, a separate suffixed Worker, rather than `fitness-equipment-manager`. Corrected every helper command to an exact --name fitness-equipment-manager with no --env. Added startup preflight that refuses existing Meta keys, a second overwrite refusal before saving, a saving latch, post-write confirmation of secret names, and redirect on duplicate submits. A restart was initially denied by automatic review due to possible key rotation; read-only evidence proved the actual CRM had only the six existing non-Meta secrets, zero encrypted Meta token rows, zero live connections and zero webhook events. The guarded initial-setup restart then succeeded. The new form is PENDING and requires user to paste App Secret again; no active production Meta key has been rotated. Old suffixed draft cleanup remains pending review of its metadata. Do not treat old helper SAVED as success for production.

## 2026-10-19 — Business Login preparation

- Verified the actual `fitness-equipment-manager` secret list contains the six existing application secrets plus all three Meta secrets. No values retrieved. The corrected importer reports SAVED. Do not restart it or rotate its encryption key.
- Created Meta Login for Business configuration `Corevity CRM Connection`, ID `1391760923120497`, General variation, User access token, with only `pages_manage_metadata`, `pages_show_list`, `pages_messaging`, `pages_read_engagement`. Meta showed success and the configuration ID. User must still explicitly authorize the account/Page in OAuth.
- Added optional numeric `META_LOGIN_CONFIG_ID` support to the authorization URL: exact bound state/callback and authorization code flow are retained; configuration-based requests use config_id rather than legacy scope parameters. Legacy mode is preserved when no configuration ID is supplied.
- Prepared production config for initial Messenger-only live setup: Demo false, activation true, Messenger/AI true, Leads/Ads read/Ads writes/Page content writes false. These changes are LOCAL ONLY until the pending deployment succeeds; do not report production Live as activated.
- TypeScript, lint and production build passed. CPU-only login configuration test passed. Full isolated Worker regression command hit the automatic approval service deadline twice (initial plus allowed retry); no regression result from that run and no deployment yet. Previous implementation baseline had 128 tests passing; the new suite adds one test but must not be claimed as fully passing until run.
- Browser automation also encountered approval-review deadlines on read/navigation. CRM login page is open in browser tab 6 at `https://management.corevityusedgym.com/login`; user must sign in using their existing CRM administrator account. Never bypass CRM auth or create a synthetic production session.
- Next: complete Worker tests when command approval is available, deploy the prepared build preserving all secrets, confirm settings show READY_TO_CONNECT, user performs OAuth consent, then select Page and configure/test webhook. Meta app remains unpublished with standard permissions available to app roles only; public-customer acceptance still requires actual checks and any Meta review requirements.

## 2026-10-19 — Production Business Login deployed

- Full regression suite passed: 129 tests in 12 files. TypeScript, lint and production build had already passed for this prepared change.
- Cloudflare account verified as the expected CRM account. Deployed existing Worker `fitness-equipment-manager`, version `c2942799-9dd7-43a6-95e3-4b708956a4b0`, using production environment and the generated build config; no secret rotated.
- Production now has Demo false, live activation true, Messenger/AI true, Leads/Ads read/Ads writes/Page content writes false.
- User authenticated CRM UI refreshed and visibly showed LIVE MODE / READY_TO_CONNECT, no selected Page, token NOT_CONFIGURED. This is readiness only, not successful live connection.
- Opened CRM Connect link and confirmed Facebook Login for Business received app ID 1056201947478275, configuration ID 1391760923120497 and exact CRM callback. Facebook displays consent “Continue as Ketsalyn Vorada”, sharing name/profile photo and ongoing access. No consent action performed by assistant.
- Browser tab 8 is handed to user for explicit consent, then Page selection and subsequent webhook setup/test. OAuth state expires after ten minutes: if expired, restart Connect from CRM settings rather than reuse an old URL.

## 2026-10-19 — Consent succeeded; Page discovery empty

- User completed OAuth. CRM audit shows CONNECTION_COMPLETED LIVE. UI grants pages_manage_metadata, pages_messaging, pages_read_engagement, pages_show_list and public_profile. Page picker is empty; no Page token selected. Generic PERMISSION_REQUIRED currently conflates missing Page selection with permission failure. Do not ask user to repeat identical consent without addressing discovery.
- Meta Business Suite confirms Page Corevity Used Gym Equipment, ID 1423694094151407, owned by business 1498550375441430; current Ketsalyn Vorada has full access. No Page ownership or person access changed.
- Login configuration remains User token, General, four Page permissions. Facebook business-integration modal shows the four permissions enabled, no Page selector.
- Hypothesis for next controlled test: request business_management for portfolio-owned Page discovery. Official permission picker explicitly describes this as READ AND WRITE Business Manager API access; do not describe it as read-only. Official docs fetches returned429. This is not proven to fix discovery yet.
- Prepared fifth permission in existing config edit form, but SAVE WAS REJECTED by automatic approval review because user had not explicitly approved this specific broader scope. No saved change and no additional permission granted. Do not retry or bypass without explicit user approval.
- Tab10 contains pending unsaved selection; tab8 CRM remains authenticated. Ask user to authorize adding business_management specifically, then save config and user consent again. Ads/content feature flags remain disabled.

## 2026-10-19 — Business permission approved; Page CONNECTED

- Human explicitly authorized adding business_management. Saved existing configuration 1391760923120497 with the four Page scopes plus business_management. Completed OAuth for the authorized scope; selected ONLY current Page Corevity Used Gym Equipment (1423694094151407) and ONLY current business Corevity | Used Gym Equipment (1498550375441430), excluding future assets. Facebook showed connection success.
- Page discovery now returns Corevity Used Gym Equipment. Saved it in CRM; UI visibly shows CONNECTED and Token VALID. No ad account selected. No outgoing messages sent.
- Messenger API settings show blank callback and verification-token inputs, disabled Delete subscription. App still requires review for interaction with everyone; role-based development testing allowed by visible Meta notice.
- Prepared callback field https://management.corevityusedgym.com/api/webhooks/meta, UNSAVED.
- Old local import helper /status is unreachable; saved verification token was only in that process memory and no longer available through its masked UI. Do not restart original importer or rotate encryption/App Secret.
- Attempt to set ONLY a new webhook verify token was REJECTED by automatic approval review: existing production secret was not verified and user had not explicitly authorized replacing that token. Command NOT EXECUTED, no temp token file created, no secret changed. Do not bypass or retry without specific authorization or additional evidence. Ask user for permission to replace only META_WEBHOOK_VERIFY_TOKEN and register matching value at Meta; keep META_APP_SECRET and META_TOKEN_ENCRYPTION_KEY unchanged.
- Tab10 is Messenger API setup with callback prefilled; tab8 shows CRM CONNECTED. Next: authorized webhook verify-token replacement, verify/save Meta callback, subscribe chosen Page to messages, messaging_postbacks, message_deliveries and message_reads, then user-controlled actual incoming test.

## 2026-10-19 — Webhook configured and Meta synthetic test passed

- Human explicitly authorized replacing ONLY the webhook verification token and registering the same value at Meta. Updated META_WEBHOOK_VERIFY_TOKEN on exact Worker fitness-equipment-manager using --name without --env. Did not alter META_APP_SECRET or META_TOKEN_ENCRYPTION_KEY.
- Generated value was held in a private mode0600 temporary file, passed directly to the Meta form, redacted from all observations, and deleted locally after successful callback verification. No value logged in conversation.
- Meta Verify and Save succeeded: saved exact callback https://management.corevityusedgym.com/api/webhooks/meta, masked token field, enabled Delete subscription, no pending verify action.
- Subscribed app-level Page webhook fields messages, messaging_postbacks, message_deliveries and message_reads at v26.0. Meta displayed success for each. Other fields stayed off.
- CRM selected Page subscription succeeded through authorized administrator UI; operation log WEBHOOK_SUBSCRIBED LIVE at12:23.
- Meta developer synthetic messages test reported SUCCESS at12:24:13. This validates Meta delivery/endpoint acceptance but uses sample sender12334/recipient23245 and does NOT validate a real Corevity conversation. The CRM events view remained empty because sample Page is not selected/authorized; do not mistake it for a real incoming Page message.
- CRM inbox opened for actual test. User should send “ทดสอบ Corevity CRM” as their personal app-role account to Page1423694094151407, then confirm sent. No actual outgoing messages were sent by assistant. Meta app still unpublished; official visible Messenger notice requires review before interactions with everyone, while app-role development testing is supported.

## 2026-10-19 — Real incoming Messenger message verified

- User sent the requested test message from Facebook and confirmed sent. CRM refreshed and showed a new LIVE conversation at12:25 with one message. Opened conversation and verified exact text “ทดสอบ Corevity CRM”, status RECEIVED, selected Page1423694094151407. Real incoming flow Facebook → signed webhook → CRM persistence → inbox display is verified.
- Sender appears as Facebook visitor; profile name resolution is not yet verified. No false linking to an existing CRM customer.
- Prepared local unsent reply draft “ได้รับข้อความทดสอบแล้วครับ ส่งจากระบบ Corevity CRM”. Do not click Send without explicit user instruction approving this exact reply to the current test conversation. No outgoing message sent yet.
- Screenshot /private/tmp/corevity-meta-real-message-received.jpg. Tab8 holds the real test conversation with unsent draft. Next: user authorizes reply, send once through CRM and verify provider response and delivery/read status plus user receipt.

## 2026-10-19 — Real outgoing Messenger reply DELIVERED

- Human explicitly instructed sending the prepared exact test reply to their current incoming test conversation. Sent once via CRM UI and confirmed its send dialog.
- Reply text: “ได้รับข้อความทดสอบแล้วครับ ส่งจากระบบ Corevity CRM”. CRM showed SENT at12:26, cleared draft and moved conversation to WAITING_CUSTOMER.
- Refreshed once and observed provider delivery receipt: message status DELIVERED at12:26:59. Both real incoming message ingestion and real outgoing reply delivery are now verified for this app-role account and Page1423694094151407. Read receipt not yet observed; do not claim READ.
- Screenshot /private/tmp/corevity-meta-message-delivered.jpg. No additional message sent, no customer/lead linking or assignment changed.
- Remaining public-use blocker: Meta app unpublished/standard-access testing; actual App Review, any required verification, and real privacy/deletion information remain necessary before claiming service available to all customers. Ads, Leads and Page content features remain disabled.

## 2026-10-19 — Ads connection preparation

- User requested returning to Facebook setup and connecting Ads. Chosen initial scope is reports/campaign reading, with spending-changing operations disabled.
- Prepared existing Login for Business configuration1391760923120497 by selecting ads_read as sixth permission alongside business_management and four existing Page/Messenger permissions. UNSAVED: wait for specific user consent before saving this access expansion. Do not select ads_management.
- LOCAL ONLY wrangler production META_ADS_READ_ENABLED=true, META_ADS_WRITE_ENABLED=false. Production build passed; NOT DEPLOYED. Current remote CRM still has Ads read false from version5ed82202-0533-4f8b-849f-d2eaefcf989a. Generated dist now contains the prepared Ads-read flag; do not deploy accidentally without recording intent.
- Tab13 holds unsaved ads_read selection; screenshot/private/tmp/corevity-ads-read-permission.jpg. Need explicit approval of ads_read then save configuration, deploy prepared read flag preserving secrets, reauthorize same Page/business plus selected existing ad account, save assets and validate reports with a real GET.
- Potential issue to check during live validation: integration status currently includes grants with global asset_id or selected Page ID only. If Meta returns asset-scoped ads_read/ads_management for numeric account IDs, the status evaluator may drop them; test/fix matching selected ad account (strip act_ prefix), without accepting grants for another account. Existing synthetic provider fixture has global grants and does not exercise this case.

## 2026-10-19 — Ads read connected and real reports verified

- Human explicitly approved ads_read. Saved configuration1391760923120497 with six scopes: ads_read, business_management and four existing Page/Messenger scopes. ads_management not selected.
- Deployed prepared read-only flag: META_ADS_READ_ENABLED=true, META_ADS_WRITE_ENABLED=false. Worker version abe150c4-1d8c-45c9-83f4-2fe739208d46. Existing secrets, Page identity and webhook settings preserved. Production build had passed;129 regression tests passed immediately before this one-flag-only change. No new runtime code changes in this Ads activation step.
- Completed OAuth under existing Ketsalyn Vorada identity, keeping only current Corevity Page and current Corevity business. Meta consent explicitly included access to ads/statistics.
- CRM discovered one authorized ad account: Ketsalyn Vorada, act_1138943552411395, THB, Asia/Bangkok. Saved this account with Page1423694094151407; CRM shows CONNECTED and Token VALID.
- Opened live Ads reporting and queried last7 and last30 days. Real provider requests succeeded and produced LIVE report cache entries for act_1138943552411395, with0 returned rows. UI correctly displays unavailable metrics rather than fabricated zero spend. Campaign reading also returned no records; creation controls are disabled. Granular-grant concern did not manifest for this actual connection; no speculative permission evaluator code changed.
- Read-only Meta Business Suite check: business1498550375441430 Ad Accounts page explicitly says no ad account has been added. Do not automatically claim/transfer/create an account: user has authorized only reading/linking. If user expects existing ad performance, ask which other account was used and obtain its ID/authorized access.
- No ad campaign, budget, billing, financial transaction or ownership change performed. Next possible work: identify another existing account if desired, or separately plan creation/public app review; neither is implied by successful read-only setup.
