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
