# Messenger → CRM sales workflow

Extends the existing CRM sales pipeline; no parallel sales ledger.

- Create a customer within a Messenger conversation, with name and optional phone, or link an existing customer. The UI asks staff to check existing customers first.
- Page-scoped identity + deterministic customer ID + an atomic D1 batch protect retries and conflicting customer links. No outbound customer message is sent by conversion.
- Create one sales opportunity per conversation with an editable title, estimated value, responsible salesperson, next follow-up and optional equipment viewing time. Existing conversion deduplication is preserved.
- A viewing without an explicit follow-up becomes the follow-up time, using the existing reminder system.
- Show the linked opportunity's stage, value, follow-up and viewing within the chat. Stage changes use the existing authenticated CRM lead endpoint and activity history.
- Open the opportunity for products, quotation creation, follow-up, closing won/lost. Won still requires the existing sold-item confirmation flow.
- CRM opportunity detail links back to the original Messenger conversation.

Migration: `0033_lead_viewing.sql` adds nullable `leads.viewing_at`; existing records and stages are preserved. A viewing is an appointment field, not a new sales status. No new calendar event is automatically created.

Verification: 134 tests across 12 files passed; TypeScript, ESLint and production build passed. Added a synthetic live integration test for customer retry, identity linking, conversion with value/viewing/follow-up, stage updates, chat round trip and rejecting direct won transitions. No synthetic customer data was created in production.

Production: migration applied successfully; deployed Worker version `5dbf2001-ee6b-4ff3-a43f-f3c88bdf22f6`. Authenticated live Messenger conversation visibly showed create/link customer, opportunity title/value/owner, viewing and follow-up fields. Existing data rendered without errors. Proof: `messenger-sales-live-2026-10-19.png`.
