# Quotation typography and print design

The browser print/HTML export path now uses one Noto Sans Thai family across Thai and Latin, embedded font weights 400 and 700, a clear title/label/body hierarchy, tabular money columns, a prominent grand total and a restrained green/grey palette. Company/customer/date metadata is separated with whitespace and hairline rules; terms use two columns.

- Shared pure HTML builder: `src/quotationPrint.ts`.
- Printing loads both regular/bold Thai + Latin faces and awaits font/image readiness before the print dialog. Uses same-origin font URLs under the existing CSP.
- Downloaded HTML embeds fonts and images for offline printing.
- Semantic repeated table headers; non-splitting rows/totals/individual terms. Responsive styles apply only to screens, not print.
- Saved commercial snapshot values are not recalculated by the presentation layer.
- Added Thai translations for Quotation and Subtotal.

Validation: TypeScript, ESLint and production build passed. Generated and visually inspected an A4 one-page example from the user's PDF, plus a synthetic 15-line/three-page document with repeated headers and intact rows. Checked customer identity and monetary values in extracted final PDF text. Font resources contain Noto Sans Thai, without Times or Arial fallback.

Example: `output/pdf/QT-2026-0001-redesigned.pdf`.

Production deployment: Worker version `d1921305-5424-4c4e-a52e-a797b10e0bc9`.

## Logo CI palette

Updated to the actual logo palette: charcoal `#1e1e1c`, silver/warm greys and blue `#165db7` sampled from the blue E. Charcoal headings/table header, light table labels and blue header rule/grand total. Both print HTML and React PDF styles use this palette. Inspected the new A4 one-page output (`output/pdf/QT-2026-0001-CI.pdf`), including the current special-discount label. TypeScript, targeted ESLint and production build passed.

User refinement: the table header now uses light silver `#f3f4f1`, dark type `#353633` and thin rules instead of a solid charcoal fill. Re-rendered and visually checked the one-page CI PDF; build passed.
