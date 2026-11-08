# Meta integration — Phase 3 settings and Demo Mode

Delivered 2026-10-18 (Asia/Bangkok). This adds a Thai/English settings experience to the existing CRM. It uses the Phase 2 backend and makes no Meta network requests. OAuth, webhook delivery, real inbox data and live analytics are scheduled for their later phases.

## Where to find it

Open **Settings → Integrations**. The panel shows the current connection state, selected Page and ad account, token health, last sync, saved permission metadata, sanitized integration errors and recent safe audit events. It includes the eight Meta feature flags and distinguishes a flag enabled in Worker settings from a capability implemented in the current phase. Connect, reconnect, disconnect and test-connection actions stay visibly disabled until OAuth is implemented in Phase 4.

The guided setup has all ten requested steps. It reports missing or invalid configuration by variable name without displaying any value. It shows the planned OAuth and webhook URLs, and says when each handler is scheduled. A displayed callback URL does not mean that the corresponding handler has been deployed.

## Demo Mode

The administrator can switch between Demo and live setup when the Worker flags permit it. Demo selection requires both `META_INTEGRATION_ENABLED=true` and `META_DEMO_MODE=true`. An administrator may keep Demo off with the saved preference. Other staff can read the setup/status but cannot change the preference or read audit logs.

Demo shows a clearly labeled simulated Page, sample conversations and messages, three sample Lead Ads inquiries, illustrative campaign/report figures, example Page reach/follower/engagement figures and a sample webhook event. The copy explains that the data is not sourced from Meta. The fixtures exist in the browser component only; they do not create D1 records, customers, CRM leads or inventory changes. No simulated send, post publish, campaign mutation or lead import button is exposed. All CRM-side action capabilities in the status response remain disabled.

When Meta is unavailable, the setup page still explains that credentials are missing and remains accessible to signed-in workspace members. To see Demo locally, first apply the additive migration from Phase 2 with `npm run db:migrate`, then set the two flags in ignored `.dev.vars` and restart the development server. Leave all other feature flags false.

## Files and checks

- `src/components/MetaIntegrationSettings.tsx` contains the setup steps, status view, feature access list and Demo fixtures.
- `src/pages/Settings.tsx` adds the existing Settings section tab. `src/th.json` supplies Thai labels; the app's existing language selector chooses Thai or English. `src/style.css` adds responsive desktop, tablet and phone layouts and dark-theme colors.
- `docs/meta-integration-plan.md` now records Phase 3 complete and identifies Phase 4 as next.
- Strict TypeScript and ESLint passed after this phase's changes. `git diff --check` passed. Automated tests and live browser inspection were not run in this phase.
- Existing large client bundle warnings remain. The Meta screen was not deployed and was not validated against Meta or production credentials.
