# Invoices — production deployment 2026-11-22

User explicitly requested "Back up and deploy".

- Commit: `7ca510a` on `main` (clean tree). Checks: `npm run check`, 211 tests (invoice workflow +
  print layout). Full flow tried locally: QT → INV → deposit complete (RESERVED) → payment complete
  (SOLD, sale recorded, reservation cleared).
- D1 backup: `output/d1-backup-2026-11-22-pre-0044.sql` (local, gitignored; 2.7 MB, 188 products).
- Remote D1: applied `0044_invoices.sql` only — new tables `invoices`, `invoice_items`,
  `invoice_status_history`, `invoice_number_sequences`; nullable `invoice_id` on `reservations` and
  `product_sales`. No existing data changed (188 products, 0 reservations before and after).
- Management Worker `fitness-equipment-manager`: `ec129703` → `91a1988e-4e63-4c2e-a848-9c5930866feb`.
  No secret or var changes. Catalog Worker unchanged.
- Verified live: custom domain serves `index-19iDqRJE.js` (matches `dist/client`, contains the
  `/invoices` routes); `/invoices` page 200; anonymous `/api/invoices` and `/api/quotations` 401.

## Behaviour

- Invoice created from a quotation (one non-cancelled invoice per quotation); quotation → ACCEPTED.
- DEPOSIT_COMPLETE reserves every invoice product for the invoice customer (`reservations.invoice_id`);
  PAYMENT_COMPLETE inserts `product_sales` (`invoice_id`, selling price = line total) so products
  become SOLD. All-or-nothing; 409 lists SKUs that are sold, unavailable or reserved for someone else.
- Cancelling after the deposit deletes the invoice's reservations; paid invoices cannot be cancelled.

## Rollback

Code: redeploy `ec129703` (`wrangler rollback`). The new tables/columns are additive and unused by
older code; drop them only if invoices must be removed entirely (restore from the backup above).

## Follow-up 2026-11-22: delete, create page, Thai/English documents (ea35b06)

User requested "Commit and deploy".

- `DELETE /api/invoices/:id` (not for PAYMENT_COMPLETE; deposit-complete invoices release their
  reservations in the same status-guarded batch). `/invoices/new` finds a quotation by number or
  customer and creates the draft. Quotation and invoice documents get a ไทย/English switch with an
  inline preview; print/PDF and HTML download use the chosen language (`-TH`/`-EN` file names).
- Checks: `npm run check`, 214 tests; create page, TH/EN preview (quotation and invoice) and delete
  tried in the local app.
- Worker `91a1988e` → `421f54ae-2c0a-4194-bf10-36d43364dcdb`; no migration, secret or var changes.
- Verified live: custom domain serves `index-CColghLu.js` (matches `dist/client`, has `/invoices/new`)
  and `QuotationPdf-BrF9JAEK.js` (has the preview); `/invoices/new` 200; anonymous
  `DELETE /api/invoices/:id` 401.

## Follow-up 2026-11-22: Thai/English terms, no delivery terms on invoices (a4efb3b)

User requested "Back up and deploy".

- D1 backup: `output/d1-backup-2026-11-22-pre-0045.sql` (local, gitignored; 2.7 MB, 4 quotations,
  2 invoices).
- Remote D1: applied `0045_bilingual_terms.sql` only — empty `*_en` term columns on
  `quotation_settings` (incl. `bank_details_en`), `quotations` and `invoices` (payment/warranty).
  Existing rows unchanged (4 quotations, 2 invoices, Thai default terms intact).
- Forms take each term in Thai and English; documents print the term in their language and fall back
  to the other. Invoices no longer copy, show or print delivery terms.
- Checks: `npm run check`, 217 tests; settings, quotation form, invoice form and TH/EN invoice preview
  tried locally.
- Worker `421f54ae` → `e6a5ccf0-77e7-4d0c-8a41-4bc76b14f25b`; no secret or var changes.
- Verified live: custom domain serves `index-DKEl7bzc.js` (matches `dist/client`, has the bilingual
  term fields); anonymous `/api/quotation-settings`, `/api/invoices`, `/api/quotations` 401.
- To do by the user: fill in the English default terms in Settings › Quotations.
