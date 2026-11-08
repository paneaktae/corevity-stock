# Website chat LINE notification hotfix

Deployed with user approval on 2026-11-06 at approximately 21:35 Asia/Bangkok.

## Behavior

- The first website chat message now calls the CRM notification service.
- Website messages notify enabled LINE accounts belonging to authorized workspace members. Catalog messages still notify the assigned salesperson.
- Failed internal notification requests and failed LINE requests log status or error type without message contents.

## Production rollout

Updated the existing deployed JavaScript modules through the Cloudflare API with exact, single-occurrence replacements corresponding to the source changes. This avoids deploying other pending workspace changes. Existing assets, bindings, secrets, compatibility settings, and observability settings were retained. No database migration or data mutation was required.

| Worker | Previous version | New version |
| --- | --- | --- |
| fitness-equipment-manager | 6eeefffc-ec89-4589-a626-bbb43af828e3 | d7abb3fe-4d3a-4e74-b961-f50b9a16bada |
| fitness-equipment-catalog | a61b7623-5155-4456-9581-b69baab54824 | 2b1c422f-875a-48d6-99dc-6e319764309c |

Both versions were confirmed active at 100% traffic. Downloaded deployed code contains the notification fixes; settings retain all existing bindings. CRM root and public storefront catalogs returned HTTP 200 with expected HTML/JSON. A read-only production query confirmed three enabled, authorized LINE recipients.

## Validation and limits

Local tests: 14 files, 145 tests passed, including first and subsequent website messages, recipient filtering, and assigned-only catalog notifications. Type checking and lint of changed files passed; production build succeeded. Full-project lint remains blocked by pre-existing errors in `tmp/pdfs/print.cjs`.

No live customer conversation or LINE push was generated during verification. Actual LINE delivery remains to be confirmed by a real website message.
