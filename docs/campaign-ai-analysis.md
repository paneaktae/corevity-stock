# Campaign AI analysis

Open **Meta / Facebook → Ads dashboard**, choose dates and optionally enter a target cost per lead in the ad account currency. Choose **Analyze each campaign**.

Each campaign on the current reporting page has its own calculated spend, impressions, all clicks, lead actions, CTR, CPC, CPM, CPL, and lead actions divided by all clicks. AI supplies an explanation and suggested experiments with an action and a metric to monitor, grouped under creative, audience, landing page, budget, or tracking. More reporting pages must be analyzed separately; requests include the selected cursor and date range. Up to 50 campaigns are analyzed per request.

CPL assessment compares only the observed CPL with the optional user target. Apply a target only to campaigns whose success is measured by lead generation. No target means no target-based verdict. Missing metrics remain unavailable; missing lead actions are not assumed to be zero. These are attributed action counts, not deduplicated CRM customers. CTR uses all clicks rather than link clicks.

The available report does not include objectives, creative content, targeting, frequency, revenue, or attributed closed sales. Advice about those areas is an experiment or a request for more data. The report cannot establish profitability, ROAS, causal effects, or whether budget should move between campaigns. Campaign names are treated as untrusted data. AI output is schema-validated and only matched to campaign IDs returned by the scoped report. Numeric claims in advice and suggested tests are checked against that campaign’s supplied numbers, allowing rounding to two decimal places. This check does not prove the factual accuracy of prose. Missing or rejected AI advice is explicitly indicated for that campaign.

Changing dates, reporting page, or the CPL target clears prior analysis. Responses from older requests cannot overwrite the new selection. The report records its dates, source fetch time, currency, timezone, pagination coverage, and target. Demo data and advice are explicitly labeled and never call Meta or the AI provider.

The existing server-side `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` configuration is used. The key is stored in ignored `.dev.vars` for local development. Production uses its existing Worker secret configuration and must be configured separately if needed. No database migration is required. Analysis saves an audit-backed draft and does not edit ads or budgets.

Validated with TypeScript, ESLint, the application build, 34 campaign and Meta workflow tests, a browser demo including invalid-target rejection and clearing stale results, and a successful live AI request using a synthetic campaign. The browser demo is not evidence of actual campaign results. Deployed to production on 2026-11-01 (Asia/Bangkok); see `campaign-ai-deployment-2026-11-01.md`.
