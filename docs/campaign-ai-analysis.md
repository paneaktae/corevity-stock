# Campaign AI analysis

Open **Meta / Facebook → Ads dashboard**, choose dates and optionally enter a target cost per lead in the ad account currency. Choose **Analyze each campaign**.

Each campaign on the current reporting page has its own calculated spend, impressions, all clicks, lead actions, CTR, CPC, CPM, CPL, and lead actions divided by all clicks. AI supplies an explanation and suggested experiments with an action and a metric to monitor, grouped under creative, audience, landing page, budget, or tracking. More reporting pages must be analyzed separately; requests include the selected cursor and date range. Up to 50 campaigns are analyzed per request.

CPL assessment compares only the observed CPL with the optional user target. Apply a target only to campaigns whose success is measured by lead generation. No target means no target-based verdict. Missing metrics remain unavailable; missing lead actions are not assumed to be zero. These are attributed action counts, not deduplicated CRM customers. CTR uses all clicks rather than link clicks.

The available report does not include objectives, creative content, targeting, frequency, revenue, or attributed closed sales. Advice about those areas is an experiment or a request for more data. The report cannot establish profitability, ROAS, causal effects, or whether budget should move between campaigns. Campaign names are treated as untrusted data. AI output is schema-validated and only matched to campaign IDs returned by the scoped report. Numeric claims in advice and suggested tests are checked against that campaign’s supplied numbers, allowing rounding to two decimal places. This check does not prove the factual accuracy of prose. Missing or rejected AI advice is explicitly indicated for that campaign.

Changing dates, reporting page, or the CPL target clears prior analysis. Responses from older requests cannot overwrite the new selection. The report records its dates, source fetch time, currency, timezone, pagination coverage, and target. Demo data and advice are explicitly labeled and never call Meta or the AI provider.

The existing server-side `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` configuration is used. The key is stored in ignored `.dev.vars` for local development. Production uses its existing Worker secret configuration and must be configured separately if needed. No database migration is required. Analysis saves an audit-backed draft and does not edit ads or budgets.

Validated with TypeScript, ESLint, the application build, 34 campaign and Meta workflow tests, a browser demo including invalid-target rejection and clearing stale results, and a successful live AI request using a synthetic campaign. The browser demo is not evidence of actual campaign results. Deployed to production on 2026-11-01 (Asia/Bangkok); see `campaign-ai-deployment-2026-11-01.md`.

## Ads analysis v2 (deployed 2026-11-08, see `ads-analysis-deployment-2026-11-08.md`)

`GET /api/meta/ads/analysis` and `GET /api/meta/ads/breakdown` power the Ads dashboard.

- **Objective-aware results.** Each campaign's result follows its Meta `objective`: Messenger conversations started (`onsite_conversion.messaging_conversation_started_7d`), lead-form leads (`lead`), link clicks (traffic) or reach (awareness). The cost per result and the optional target use that result. Traffic and awareness campaigns are `NOT_APPLICABLE` to a lead/chat target. Account cost per lead/chat only uses spend from campaigns optimised for that result.
- **More fields.** `reach`, `frequency`, `inline_link_clicks` (link CTR, cost per link click) and `objective` are requested. Reach is never added across rows.
- **Period comparison.** The same campaigns are fetched for the previous range of equal length (filtered by campaign ID), with percent changes.
- **Daily trend.** Account-level `time_increment=1` for the selected range (first reporting page only).
- **Rule-based alerts** (`shared/ads-analytics.ts`, thresholds in `ADS_THRESHOLDS`): low data, spend or clicks without results, creative fatigue, high frequency, link CTR drop, CPM rise, cost-per-result rise, low link CTR or click-to-result rate vs peers in the same report, above target, top performer. Rules point to tests; they do not prove causes.
- **Drill-down** per campaign by ad set, ad, age, gender, platform, placement (`publisher_platform,platform_position`) or region. Up to 100 rows.
- The AI receives results, previous period, changes, alerts and thresholds; numeric claims are still checked against them.

Each dashboard load costs up to 3 Graph insight calls (cached 5 minutes). Demo mode uses deterministic simulated data (`worker/services/meta/demo-insights.ts`). Live Meta data has not been checked with this version.
