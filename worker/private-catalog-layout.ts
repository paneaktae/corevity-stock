// Presentation for link-only catalogs. Content stays manual and escaped as text.
export type PrivateCatalogProduct = {
  id: string;
  sku: string;
  product_slug: string;
  brand_snapshot: string;
  model_snapshot: string;
  product_name_snapshot: string;
  target_body_part: string;
  category_snapshot: string;
  condition_snapshot: string;
  status: string;
  description_snapshot: string;
  catalog_detail: string;
  description_th: string;
  description_en: string;
  short_description: string;
  image_key_snapshot: string;
  display_price: number | null;
};
const escape = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
);
const local = (language: string, en: string, th: string) => language === 'th' ? th : en;

export function privateCatalogDescription(item: PrivateCatalogProduct, language: string) {
  return item.description_snapshot || item.catalog_detail ||
    (language === 'th' ? item.description_th : item.description_en) ||
    item.description_en || item.description_th || item.short_description;
}

function manualCopy(value: string) {
  return value.split(/\n\s*\n/).filter((part) => part.trim()).map((part) => {
    const lines = part.split('\n');
    if (lines.every((line) => /^\s*(?:[•▪●*-]|\d+[.)])\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${escape(line.replace(/^\s*(?:[•▪●*-]|\d+[.)])\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p>${escape(part)}</p>`;
  }).join('');
}

export function privateCatalogProduct(item: PrivateCatalogProduct, options: {
  slug: string; language: string; detail?: boolean;
}) {
  const { slug, language, detail } = options;
  const href = `/s/${encodeURIComponent(slug)}/p/${encodeURIComponent(item.product_slug)}?lang=${language}`;
  const photo = item.image_key_snapshot
    ? `/media/catalogs/${encodeURIComponent(slug)}/item/${encodeURIComponent(item.id)}` : '';
  const availability: Record<string, string> = {
    AVAILABLE: local(language, '1 UNIT AVAILABLE', 'พร้อมขาย 1 เครื่อง'),
    RESERVED: local(language, 'RESERVED', 'จองแล้ว'),
    SOLD: local(language, 'SOLD OUT', 'ขายแล้ว'),
    NOT_AVAILABLE: local(language, 'NOT AVAILABLE', 'ไม่พร้อมขาย'),
  };
  const name = item.model_snapshot || item.product_name_snapshot;
  const heading = detail ? 'h1' : 'h2';
  const description = privateCatalogDescription(item, language);
  const price = typeof item.display_price === 'number' && Number.isFinite(item.display_price)
    ? `<div class="editorial-price"><span>THB</span> <strong>${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(item.display_price)}</strong> <small>${local(language, '/ unit', '/ เครื่อง')}</small></div>`
    : `<p class="editorial-price-request">${local(language, 'Contact us for pricing', 'ติดต่อสอบถามราคา')}</p>`;
  const photoContent = photo
    ? `<img src="${photo}" alt="${escape(item.product_name_snapshot)}" loading="lazy" decoding="async">`
    : `<span class="editorial-no-photo">${local(language, 'Photo coming soon', 'ยังไม่มีรูปสินค้า')}</span>`;
  return `<article class="editorial-product ${item.status.toLowerCase()}">
    <div class="editorial-visual">
      <p class="editorial-availability">${escape(availability[item.status] || local(language, 'UNAVAILABLE', 'ไม่พร้อมขาย'))}</p>
      ${detail ? `<div class="editorial-photo">${photoContent}</div>` : `<a class="editorial-photo" href="${href}" aria-label="${escape(item.product_name_snapshot)}">${photoContent}</a>`}
      ${item.category_snapshot ? `<p class="editorial-category">${escape(item.category_snapshot)}</p>` : ''}
    </div>
    <div class="editorial-copy">
      <p class="editorial-brand">${escape(item.brand_snapshot)}</p>
      <${heading}>${detail ? escape(name) : `<a href="${href}">${escape(name)}</a>`}</${heading}>
      ${item.target_body_part ? `<p class="editorial-specification">${escape(item.target_body_part)}</p>` : ''}
      ${price}
      <div class="editorial-description">${description ? manualCopy(description) : ''}</div>
      <dl class="editorial-facts"><div><dt>SKU</dt><dd>${escape(item.sku)}</dd></div>${item.condition_snapshot ? `<div><dt>${local(language, 'CONDITION', 'สภาพสินค้า')}</dt><dd>${escape(item.condition_snapshot)}</dd></div>` : ''}</dl>
    </div>
  </article>`;
}

export function privateCatalogMasthead(title: string, thUrl: string, enUrl: string) {
  return `<header class="top editorial-masthead"><div class="shell top-inner">
    <div class="editorial-wordmark" aria-label="Corevity"><div>COR<span>E</span>VITY</div><small>USED GYM EQUIPMENT</small></div>
    <div class="editorial-header-copy"><p>EQUIPMENT CATALOGUE</p><p>${escape(title)}</p><nav aria-label="Language"><a href="${escape(thUrl)}" lang="th">ไทย</a><span>/</span><a href="${escape(enUrl)}" lang="en">EN</a></nav></div>
  </div></header>`;
}

export const privateCatalogStyles = `
body.private-catalog{background:#fff;color:#222;font-family:Arial,"Noto Sans Thai",sans-serif;line-height:1.6}
.private-catalog .shell{max-width:1180px;padding:0 58px}
.private-catalog .editorial-masthead{background:#20201e;border-bottom:5px solid #2164ad;color:#f4f4f2}
.private-catalog .top-inner{min-height:168px;gap:40px}
.editorial-wordmark>div{font-size:clamp(30px,4.5vw,52px);font-weight:300;letter-spacing:5px;line-height:1.15}
.editorial-wordmark>div>span{color:#2467b3}
.editorial-wordmark small{display:block;text-align:center;margin-top:14px;font-size:12px;letter-spacing:1px;color:#c8c8c5}
.editorial-header-copy{text-align:right;max-width:45%;overflow-wrap:anywhere}
.editorial-header-copy p{margin:0;font-size:15px;line-height:1.6}
.editorial-header-copy p+p{font-size:19px;font-weight:400}
.editorial-header-copy nav{display:flex;justify-content:flex-end;gap:9px;margin-top:12px;font-size:11px;color:#c6c6c3}
.editorial-header-copy a:hover{text-decoration:underline;color:#fff}
.editorial-intro{padding:36px 0 10px}
.editorial-intro h1{margin:0;font-size:clamp(30px,4.4vw,52px);line-height:1.16;letter-spacing:-1.2px;overflow-wrap:anywhere}
.editorial-intro>p{margin:12px 0 0;max-width:850px;color:#777;font-size:19px;white-space:pre-wrap;overflow-wrap:anywhere}
.editorial-product{display:grid;grid-template-columns:minmax(0,.92fr) minmax(0,1.08fr);gap:52px;padding:42px 0 36px;border-bottom:1px solid #d9d9d6;break-inside:avoid}
.editorial-visual{display:flex;flex-direction:column;min-width:0}
.editorial-availability{border-left:5px solid #2164ad;padding-left:13px;margin:0 0 22px;color:#2164ad;font-size:14px;font-weight:700;line-height:1.3}
.editorial-product.sold .editorial-availability,.editorial-product.not_available .editorial-availability{color:#777;border-color:#777}
.editorial-product.reserved .editorial-availability{color:#9a6d20;border-color:#9a6d20}
.editorial-photo{display:flex;align-items:center;justify-content:center;width:100%;min-height:280px;aspect-ratio:4/3;background:white}
.editorial-photo img{display:block;width:100%;height:100%;max-height:380px;object-fit:contain;mix-blend-mode:multiply}
.editorial-no-photo{color:#888;font-size:14px}
.editorial-category{margin:20px 0 0;color:#777;font-size:14px}
.editorial-copy{min-width:0;display:flex;flex-direction:column;align-items:flex-start;overflow-wrap:anywhere}
.editorial-brand{margin:0 0 5px;color:#666;font-size:14px;font-weight:600;text-transform:uppercase}
.editorial-copy h1,.editorial-copy h2{margin:0;font-size:clamp(27px,3.3vw,40px);line-height:1.2;letter-spacing:-.7px}
.editorial-copy h2 a:hover{color:#2164ad}
.editorial-specification{margin:5px 0 0;font-size:19px;color:#70706e}
.editorial-price{display:flex;align-items:baseline;flex-wrap:wrap;gap:9px;margin:0 0 15px;color:#2164ad}
.editorial-price>span{font-size:13px;font-weight:600}.editorial-price strong{font-size:clamp(34px,4.2vw,48px);line-height:1.4;font-weight:600;letter-spacing:-1px;font-variant-numeric:tabular-nums}
.editorial-price small{margin-left:15px;color:#80807d;font-size:13px}.editorial-product.sold .editorial-price,.editorial-product.not_available .editorial-price{color:#777}
.editorial-price-request{color:#2164ad;font-size:18px;margin:16px 0}
.editorial-description{width:100%;margin:0 0 32px;font-size:16px;line-height:1.65;color:#444}
.editorial-description p{margin:0 0 12px;white-space:pre-wrap}.editorial-description ul{padding-left:19px;list-style-type:square;margin:0 0 14px}.editorial-description li{padding-left:2px;margin:5px 0}.editorial-description li::marker{color:#2164ad}
.editorial-description:empty{display:none}
.editorial-facts{display:flex;flex-wrap:wrap;gap:10px 28px;width:100%;margin:auto 0 0;padding-top:13px;border-top:1px solid #ddd;font-size:13px}
.editorial-facts>div{display:flex;align-items:baseline;gap:12px;min-width:0}.editorial-facts dt{font-size:11px;color:#777}.editorial-facts dd{margin:0;color:#333}
.editorial-contact{padding:24px 0 32px}.editorial-contact>p{font-size:16px;font-weight:600;margin:0 0 8px}.editorial-contact>small{display:block;color:#888;line-height:1.8}
.private-catalog .contact{margin:18px 0 0}.private-catalog .contact a{min-height:40px;border-radius:2px;padding:9px 16px;background:#2164ad}.private-catalog .contact a.secondary{background:white}
.private-catalog .footer{margin-top:0;background:white;border-top:1px solid #e3e3e0;padding:20px 0;color:#888;font-size:11px}
.editorial-back{display:inline-flex;margin-top:23px;font-size:13px;color:#2164ad}
.private-catalog .empty{margin:30px 0}
@media(max-width:760px){.private-catalog .shell{padding:0 24px}.private-catalog .top-inner{min-height:128px;gap:20px}.editorial-wordmark>div{font-size:32px;letter-spacing:2px}.editorial-wordmark small{font-size:9px;margin-top:10px}.editorial-header-copy p{font-size:10px}.editorial-header-copy p+p{font-size:14px}.editorial-intro{padding-top:28px}.editorial-intro>p{font-size:16px}.editorial-product{gap:28px;padding:30px 0}.editorial-photo{min-height:210px}.editorial-description{font-size:14px}.editorial-copy h1,.editorial-copy h2{font-size:28px}}
@media(max-width:560px){.private-catalog .shell{padding:0 20px}.private-catalog .top-inner{min-height:116px;gap:14px}.editorial-wordmark>div{font-size:26px}.editorial-wordmark small{font-size:8px;letter-spacing:.5px}.editorial-header-copy{max-width:44%}.editorial-header-copy p+p{font-size:12px}.editorial-intro h1{font-size:32px}.editorial-product{grid-template-columns:minmax(0,1fr);gap:22px;padding:29px 0}.editorial-photo{min-height:0;aspect-ratio:4/3}.editorial-photo img{max-height:310px}.editorial-availability{margin-bottom:12px;font-size:12px}.editorial-category{margin-top:10px;font-size:12px}.editorial-copy h1,.editorial-copy h2{font-size:30px}.editorial-brand{font-size:12px}.editorial-description{font-size:15px}.editorial-price strong{font-size:40px}.editorial-facts{margin-top:4px}.private-catalog .footer-inner{display:block}}
@media print{.private-catalog .shell{max-width:none;padding:0 12mm}.private-catalog .top-inner{min-height:36mm}.editorial-product{grid-template-columns:minmax(0,.92fr) minmax(0,1.08fr);gap:10mm;padding:9mm 0}.editorial-photo{min-height:0}.editorial-header-copy nav,.catalog-chat-fab,#catalog-chat-root,.contact,.editorial-back{display:none!important}.private-catalog{print-color-adjust:exact;-webkit-print-color-adjust:exact}.editorial-description{font-size:11pt}.editorial-price strong{font-size:30pt}}
`;
