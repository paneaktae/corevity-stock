import {
  quotationCompanyNames,
  quotationItemTitle,
  type Quotation,
  type QuotationItem,
} from '../shared/quotations';

export type QuotationFonts = {
  latinRegular: string;
  latinBold: string;
  thaiRegular: string;
  thaiBold: string;
};
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
const image = (value: string | undefined, className: string) =>
  value && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value)
    ? `<img class="${className}" src="${escape(value)}" alt="">`
    : '';

/** Fields the print layout reads; quotations and invoices both provide them. */
export type PrintableDocument = Pick<
  Quotation,
  | 'quotationNumber'
  | 'issueDate'
  | 'validUntil'
  | 'currency'
  | 'customer'
  | 'company'
  | 'salesContactName'
  | 'subtotal'
  | 'discount'
  | 'deliveryFee'
  | 'installationFee'
  | 'otherCharges'
  | 'vatEnabled'
  | 'vatRate'
  | 'vatAmount'
  | 'grandTotal'
  | 'beforeTax'
  | 'paymentTerms'
  | 'deliveryTerms'
  | 'warrantyTerms'
  | 'notes'
> & {
  items: Pick<
    QuotationItem,
    | 'id'
    | 'productName'
    | 'specification'
    | 'sku'
    | 'description'
    | 'productStatus'
    | 'quantity'
    | 'unitPrice'
    | 'discount'
    | 'lineTotal'
  >[];
};
/** What differs between a printed quotation and a printed invoice. */
export type PrintOptions = {
  /** English UI key for the document title, translated with `t`. */
  title: string;
  /** Upper-case English title shown under the Thai title. */
  englishTitle: string;
  /** English UI key for the second date (valid until / due date). */
  secondDateLabel: string;
  /** Extra fact row, e.g. the quotation an invoice came from. */
  reference?: [label: string, value: string];
  /** Rows printed after the grand total, e.g. deposit and balance. */
  afterTotal?: [label: string, value: number][];
  /** Hide the "this product is sold/reserved" notes (expected on invoices). */
  hideStockNotes?: boolean;
};
export const quotationPrintOptions: PrintOptions = {
  title: 'Quotation',
  englishTitle: 'QUOTATION',
  secondDateLabel: 'Valid until',
};

/** Shared, self-contained print layout. All commercial values come from the saved snapshot. */
export function quotationPrintHtml(
  quote: PrintableDocument,
  assets: Record<string, string>,
  fonts: QuotationFonts,
  language: 'th' | 'en',
  t: (value: string) => string,
  options: PrintOptions = quotationPrintOptions,
) {
  const company = quote.company;
  const { title: companyName, subtitle: companySubtitle } =
    quotationCompanyNames(company, language);
  const amount = (value: number) =>
    new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-GB', {
      style: 'currency',
      currency: quote.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  const date = (value: string) =>
    new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(`${value.slice(0, 10)}T12:00:00+07:00`));
  const fontFace = (url: string, weight: number, thai: boolean) =>
    `@font-face{font-family:CorevityQuote;src:url(${JSON.stringify(url)}) format('woff');font-weight:${weight};font-style:normal;${thai ? 'unicode-range:U+0E00-0E7F;' : 'unicode-range:U+0000-024F,U+2000-206F,U+20A0-20CF;'}}`;
  const totalRows: [string, number][] = [
    ['Subtotal', quote.subtotal],
    ['Quotation discount', -quote.discount],
    ['Delivery fee', quote.deliveryFee],
    ['Installation fee', quote.installationFee],
    ['Other charges', quote.otherCharges],
  ];
  if (quote.vatEnabled)
    totalRows.push(
      ['Before tax', quote.beforeTax],
      [`${t('VAT')} (${quote.vatRate}%)`, quote.vatAmount],
    );
  const terms = [
    ['Payment terms', quote.paymentTerms],
    ['Delivery terms', quote.deliveryTerms],
    ['Warranty terms', quote.warrantyTerms],
    ['Bank details', company.bankDetails],
    ['Additional notes', quote.notes],
  ].filter(([, value]) => value);
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(quote.quotationNumber)}</title><style>
${fontFace(fonts.latinRegular, 400, false)}${fontFace(fonts.latinBold, 700, false)}${fontFace(fonts.thaiRegular, 400, true)}${fontFace(fonts.thaiBold, 700, true)}
@page{size:A4;margin:14mm 14mm 15mm}*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:#f1f1ef;color:#292a28;font-family:CorevityQuote,sans-serif;font-size:10pt;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}.paper{width:210mm;min-height:297mm;margin:24px auto;padding:14mm;background:#fff;box-shadow:0 12px 36px #1e1e1c14}p,h1,h2,h3{margin:0}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding-bottom:12px;border-bottom:1.5px solid #165db7}.company{display:flex;gap:13px;align-items:flex-start;min-width:0;max-width:70%}.company-copy{min-width:0}.logo{width:60px;height:60px;object-fit:contain;flex-shrink:0}.company h1{font-size:14pt;line-height:1.4;font-weight:700;color:#1e1e1c;margin-bottom:3px}.company-meta{font-size:8pt;color:#696c68;line-height:1.65;overflow-wrap:anywhere}.company-english{font-size:8.5pt;letter-spacing:.04em;margin-bottom:3px}.document-code{text-align:right;flex-shrink:0;padding-top:2px}.eyebrow{font-size:7.5pt;letter-spacing:.12em;color:#747772;font-weight:400}.document-code strong{display:block;font-size:12pt;color:#1e1e1c;letter-spacing:.015em;margin-top:4px}.document-title{margin:14px 0 12px}.document-title h2{font-size:23pt;line-height:1.35;font-weight:700;color:#1e1e1c;letter-spacing:-.02em}.document-title p{font-size:8pt;letter-spacing:.16em;color:#797c76;margin-top:3px}.facts{display:grid;grid-template-columns:1.3fr 1fr;gap:25px;padding:12px 0 14px;border-top:1px solid #dedfd9;border-bottom:1px solid #dedfd9;margin-bottom:16px;break-inside:avoid}.field-label{font-size:8pt;color:#696c66;font-weight:400;margin-bottom:4px}.customer-name{font-size:12pt;font-weight:700;margin-bottom:5px}.customer-details{font-size:9pt;line-height:1.75;overflow-wrap:anywhere;white-space:pre-line}.document-facts{margin:0;display:grid;grid-template-columns:auto minmax(0,1fr);align-content:start;column-gap:14px;row-gap:7px;font-size:8.5pt}.document-facts dt{color:#696c66}.document-facts dd{margin:0;font-weight:400;overflow-wrap:anywhere}.section-title{font-size:10pt;font-weight:700;color:#1e1e1c;margin:16px 0 9px}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.5pt}thead{display:table-header-group}th{padding:9px 6px;background:#f3f4f1;color:#353633;font-weight:700;font-size:7.5pt;text-align:left;border-top:1px solid #d3d5ce;border-bottom:1px solid #d3d5ce}td{padding:13px 6px;border-bottom:1px solid #e2e3dd;vertical-align:top;overflow-wrap:anywhere}tr{break-inside:avoid}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.product{font-size:9pt;font-weight:700;line-height:1.5;margin-bottom:4px}.product-meta{font-size:7.5pt;color:#777a73}.description{font-size:8pt;line-height:1.6;color:#565a53;white-space:pre-line;margin-top:4px}.product-image{display:block;width:49px;height:56px;object-fit:contain}.line-total{font-weight:700}.totals{width:55%;margin:15px 0 0 auto;break-inside:avoid}.total-line{display:flex;justify-content:space-between;gap:12px;padding:4px 0;color:#656a61;font-size:8.5pt}.total-line span:last-child{color:#292c27;font-variant-numeric:tabular-nums;white-space:nowrap}.total-line.before-tax{border-top:1px solid #e2e3dd;margin-top:5px;padding-top:9px}.grand{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1.5px solid #165db7;border-bottom:1px solid #cfd3da;padding:12px 0 10px;margin-top:8px;color:#165db7}.grand span{font-size:10pt;font-weight:700}.total-line.after-total{font-weight:700;color:#292c27}.grand strong{font-size:16pt;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}.terms{margin-top:16px;border-top:1px solid #dedfd9;padding-top:12px}.terms-title{font-size:10pt;color:#1e1e1c;font-weight:700;margin-bottom:10px}.terms-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:28px;row-gap:13px}.term{break-inside:avoid}.term strong{display:block;font-size:8pt;font-weight:700;color:#4e534a;margin-bottom:3px}.term p{font-size:8.5pt;color:#666c60;line-height:1.7;white-space:pre-line;overflow-wrap:anywhere}.document-footer{margin-top:14px;padding-top:10px;border-top:1px solid #dedfd9;display:flex;justify-content:space-between;gap:15px;color:#7b8075;font-size:7pt;break-inside:avoid;overflow-wrap:anywhere}@media screen and (max-width:800px){.paper{width:100%;margin:0;min-height:100vh;padding:22px}.company{max-width:68%}.logo{width:48px;height:48px}}@media screen and (max-width:760px){.paper{padding:18px 16px}header{flex-wrap:wrap;gap:10px}.company{max-width:100%}.document-code{text-align:left}.document-title h2{font-size:19pt}.facts{grid-template-columns:1fr;gap:14px}table,tbody,tr,td{display:block;width:100%}colgroup,thead{display:none}tr{display:grid;grid-template-columns:auto minmax(0,1fr);padding:12px 0;border-bottom:1px solid #e2e3dd}td{grid-column:2;padding:0;border:0}td.photo{grid-column:1;grid-row:1/span 5;margin-right:12px}td.photo:empty{display:none;margin:0}td.item{margin-bottom:8px}td.num{display:flex;justify-content:space-between;gap:12px;padding:3px 0;font-size:9pt}td.num::before{content:attr(data-label);color:#696c66;font-weight:400}td.line-total{border-top:1px solid #eeefea;margin-top:4px;padding-top:7px}.totals{width:100%}.grand strong{font-size:14pt}.terms-grid{grid-template-columns:1fr}.document-footer{flex-direction:column;gap:4px}}@media print{body{background:white}.paper{width:auto;min-height:0;padding:0;margin:0;box-shadow:none}.facts{grid-template-columns:1.3fr 1fr}.company{max-width:70%}header{break-inside:avoid}h2,h3{break-after:avoid}}
</style></head><body><main class="paper"><header><div class="company">${image(assets.companyLogo, 'logo')}<div class="company-copy"><h1>${escape(companyName)}</h1>${companySubtitle ? `<div class="company-meta company-english">${escape(companySubtitle)}</div>` : ''}${company.address ? `<div class="company-meta">${escape(company.address)}</div>` : ''}<div class="company-meta">${escape([company.phone, company.email].filter(Boolean).join(' · '))}</div>${company.taxId ? `<div class="company-meta">${escape(t('Tax ID'))}: ${escape(company.taxId)}</div>` : ''}</div></div><div class="document-code"><div class="eyebrow">${language === 'th' ? 'เลขที่เอกสาร' : 'DOCUMENT NO.'}</div><strong>${escape(quote.quotationNumber)}</strong></div></header>
<section class="document-title"><h2>${escape(t(options.title))}</h2>${language === 'th' ? `<p>${escape(options.englishTitle)}</p>` : ''}</section>
<section class="facts"><div><div class="field-label">${escape(t('Customer'))}</div><div class="customer-name">${escape(quote.customer.companyName || quote.customer.name)}</div><div class="customer-details">${[quote.customer.contactName, quote.customer.billingAddress, [quote.customer.phone, quote.customer.email].filter(Boolean).join(' · ')].filter(Boolean).map(escape).join('<br>')}</div></div><dl class="document-facts"><dt>${escape(t('Issue date'))}</dt><dd>${escape(date(quote.issueDate))}</dd><dt>${escape(t(options.secondDateLabel))}</dt><dd>${escape(date(quote.validUntil))}</dd>${options.reference ? `<dt>${escape(t(options.reference[0]))}</dt><dd>${escape(options.reference[1])}</dd>` : ''}<dt>${escape(t('Sales contact'))}</dt><dd>${escape(quote.salesContactName)}</dd></dl></section>
<h3 class="section-title">${escape(t('Products'))}</h3><table><colgroup><col style="width:12%"><col style="width:32%"><col style="width:7%"><col style="width:17%"><col style="width:13%"><col style="width:19%"></colgroup><thead><tr><th>${escape(t('Photo'))}</th><th>${escape(t('Description'))}</th><th class="num">${escape(t('Qty'))}</th><th class="num">${escape(t('Unit price'))}</th><th class="num">${escape(t('Discount'))}</th><th class="num">${escape(t('Line total'))}</th></tr></thead><tbody>${quote.items.map((item) => `<tr><td class="photo">${image(assets[item.id], 'product-image')}</td><td class="item"><div class="product">${escape(quotationItemTitle(item.productName, item.specification))}</div><div class="product-meta">${escape(item.sku)}</div>${item.description ? `<div class="description">${escape(item.description)}</div>` : ''}${!options.hideStockNotes && (item.productStatus === 'SOLD' || item.productStatus === 'RESERVED') ? `<div class="description">${escape(t(item.productStatus === 'SOLD' ? 'This product is sold.' : 'This product is reserved.'))}</div>` : ''}</td><td class="num" data-label="${escape(t('Qty'))}">${escape(item.quantity)}</td><td class="num" data-label="${escape(t('Unit price'))}">${escape(amount(item.unitPrice))}</td><td class="num" data-label="${escape(t('Discount'))}">${escape(amount(item.discount))}</td><td class="num line-total" data-label="${escape(t('Line total'))}">${escape(amount(item.lineTotal))}</td></tr>`).join('')}</tbody></table>
<section class="totals">${totalRows.map(([label, value]) => `<div class="total-line${label === 'Before tax' ? ' before-tax' : ''}"><span>${escape(t(label))}</span><span>${escape(amount(value))}</span></div>`).join('')}<div class="grand"><span>${escape(t('Grand total'))}</span><strong>${escape(amount(quote.grandTotal))}</strong></div>${(options.afterTotal ?? []).map(([label, value]) => `<div class="total-line after-total"><span>${escape(t(label))}</span><span>${escape(amount(value))}</span></div>`).join('')}</section>
${terms.length ? `<section class="terms"><h3 class="terms-title">${escape(t('Terms'))}</h3><div class="terms-grid">${terms.map(([label, value]) => `<div class="term"><strong>${escape(t(label))}</strong><p>${escape(value)}</p></div>`).join('')}</div></section>` : ''}
<footer class="document-footer"><span>${escape(companyName)}</span><span>${escape(quote.quotationNumber)}</span></footer></main></body></html>`;
}
