# Messenger welcome and contact sales

Deployed 19 October 2026 to https://management.corevityusedgym.com.
Worker version: `814769d8-0d3e-4a66-a31a-0205305bba6c`.
Migration `0032_meta_messenger_automation.sql` applied to the existing production D1 database.

## Enabled configuration

- Page: Corevity Used Gym Equipment (`1423694094151407`).
- Welcome: สวัสดีครับ ยินดีต้อนรับสู่ Corevity สนใจอุปกรณ์ชิ้นไหน สอบถามได้เลยครับ
- Postback button: ติดต่อเซล (`COREVITY_CONTACT_SALES`).
- Acknowledgment: ได้รับคำขอติดต่อเซลแล้วครับ ทีมงานจะติดต่อกลับโดยเร็วครับ
- Alert the assigned conversation owner. If unassigned, assign and alert the selected default: Teravat Netpiyachat (`analyziie@gmail.com`).
- Configuration is editable at Settings → Integrations → Messenger welcome & contact sales.
- Meta accepted the profile configuration; CRM UI and a read-only database query confirmed enabled settings.

## Behavior

A signed incoming message or Get Started postback queues one welcome per conversation. Existing chats receive no backfill without a new inbound event. Echoes, receipts and events older than 24 hours do not initiate replies. Automatic Messenger sends respect the 24-hour messaging window.

Contact sales queues one LINE alert and one Messenger acknowledgment per conversation per fixed 15-minute window. Requests and acknowledgment records are committed atomically. An existing owner takes priority over the default; if that owner's LINE is unavailable, the system records a failure rather than contacting someone else. Queued alerts recheck current ownership, workspace membership and LINE linkage before delivery.

LINE alerts include the Page name, conversation display name and an authenticated CRM link that opens the matching conversation. Customer message content is not copied into LINE. The LINE request uses a stable UUID retry key, retries rate limits/transient errors and treats a documented accepted retry conflict as success.

Messenger transport failures with an uncertain outcome are marked UNKNOWN and never automatically retried. Echo metadata can reconcile the result. Expired processing leases become UNKNOWN for Messenger, or retry safely with the same key for LINE. Turning the feature off stops queued actions, even if Meta profile cleanup fails.

## Validation

- TypeScript and ESLint passed.
- Full test suite: 133 tests across 12 files passed.
- Synthetic provider tests cover administrator access, recipient eligibility, disabled behavior, welcome deduplication, postback payload preservation, owner/default routing, unavailable owner handling, repeated clicks, LINE retry keys and accepted conflicts, ambiguous Meta sends and echo reconciliation, stale events, and local disable during Meta failure.
- Migration tests cover fresh and upgraded databases without losing existing customer data.
- Production screenshot: `meta-welcome-enabled-2026-10-19.png`.

## Pending user test

The user chose to test later. No production visitor message or test LINE push was fabricated. Real Messenger rendering and LINE delivery to the salesperson's phone are still awaiting the user's test: send “ทดสอบ Welcome” to the Page, then press “ติดต่อเซล”. Check recent actions and delivery status afterward.

Public customer availability continues to depend on the Meta app's publication/access and App Review status; deployment does not itself grant those permissions.

## Live verification after user completed Meta setup

The earlier pending-test status is superseded by these observed results on 19 October 2026:

- Meta's live publishing page now displays “เผยแพร่แล้ว” (Published).
- A real incoming MESSAGE event was processed at 15:11 Bangkok time, followed by a CONTACT_SALES postback.
- The WELCOME job is SENT and its Messenger message is READ.
- The CONTACT_ACK job is SENT and its Messenger message is READ.
- The SALES_LINE job is SENT, addressed to `analyziie@gmail.com` (Teravat). This confirms LINE API acceptance; device notification visibility is not independently verified.
- No errors were recorded for these three automation jobs.
