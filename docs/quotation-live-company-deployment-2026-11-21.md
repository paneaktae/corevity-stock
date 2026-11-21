# Quotations use current company settings — production deployment 2026-11-21

User explicitly requested "Commit and deploy".

- Commit: `9ff3056` on `main` (clean tree). Checks: `npm run check` (types, TypeScript, lint,
  194 tests incl. new "shows the current company settings on existing quotations").
- Change: a quotation's company block (names, address, phone, email, tax ID, LINE/Facebook, bank
  details, logo) is now read from `quotation_settings` when shown or printed, instead of the
  `company_snapshot` frozen at creation. Applies to all quotations, including SENT/ACCEPTED.
  Customer, item, price and terms snapshots are unchanged. `company_snapshot` is still written.
- Pre-deploy check: previous production version `30db79c2` (2026-11-10 17:28 UTC) matched `448b387`,
  the parent commit. No migration, no secret or var changes. Catalog Worker unchanged.
- Management Worker `fitness-equipment-manager`: `30db79c2` → `88db2e25-b737-4773-b179-5810e97d6a51`.
- Verified live: custom domain serves `index-DDr61NWl.js` (matches `dist/client`); anonymous
  `/api/quotations` returns 401.

## Follow-up 2026-11-21: COREVITY on English quotations (9d53c69)

User requested "Commit and deploy".

- English quotations (print view and PDF) show `COREVITY` as the company title and footer, with
  `companyNameEn` underneath unless it is just "Corevity". Thai quotations unchanged. Front-end only.
- Checks: `npm run check`, 197 tests (new `tests/quotation-company-names.test.ts`).
- Worker `88db2e25` → `9ef3724c-9f00-4b87-b550-f12d50acd683`; no migration, secret or var changes.
- Verified live: custom domain serves `index-CiZamq6c.js` (matches `dist/client`, contains
  `COREVITY`); anonymous `/api/quotations` returns 401.

## Follow-up 2026-11-21: phone layout for downloaded quotation HTML (e38b73e)

User requested "Commit and deploy".

- Downloaded quotation HTML at screen widths up to 760px shows each item as a card with labelled
  Qty / Unit price / Discount / Line total rows (prices previously overflowed and overlapped).
  Print and desktop layouts unchanged. Front-end only.
- Checked locally with sample TH/EN quotes at 375, 645, 700, 765px and desktop: no overflowing cells.
  `npm run check`: 197 tests.
- Worker `9ef3724c` → `c88fd45c-39c3-44e0-b271-145f69abe174`; no migration, secret or var changes.
- Verified live: custom domain serves `index-DLxm9nfX.js` (matches `dist/client`);
  `QuotationPdf-8E5ChEuk.js` contains the new 760px rules; anonymous `/api/quotations` returns 401.

## Follow-up 2026-11-21: specification instead of condition (9bc6878)

User requested "Commit and deploy".

- Quotation items (detail page, PDF, downloaded HTML) show `SKU · <specification>` instead of the
  condition; no "Specification" label, per the user. Spec = `products.target_body_part`, read live via
  the existing `LEFT JOIN products` (no migration), so existing quotations show it too.
- `/api/quotations/products?q=` also matches `target_body_part` and returns `targetBodyPart`; the
  picker lists it under each result. Placeholder: "ค้นหาแบรนด์ รุ่น SKU หมวดหมู่ หรือสเปก".
- Checks: `npm run check`, 199 tests; checked search, picker and detail page in the local app.
- Worker `c88fd45c` → `c4e8585d-7c47-4311-b327-a314183ca820`; no migration, secret or var changes.
- Verified live: custom domain serves `index-D6N3SfV1.js` (matches `dist/client`, has the new
  placeholder) and `QuotationPdf-DuRFNZ1u.js`; anonymous `/api/quotations/products` returns 401.
