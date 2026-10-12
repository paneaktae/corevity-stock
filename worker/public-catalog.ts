import { Hono } from 'hono';

type PublicBindings = Pick<Env, 'DB' | 'PRODUCT_IMAGES'> & {
  PUBLIC_CATALOG_BASE_URL?: string;
};
type PublicEnv = { Bindings: PublicBindings };
type Company = {
  company_name_th: string;
  company_name_en: string;
  phone: string;
  email: string;
  line_url: string;
  facebook_url: string;
  logo_key: string;
};
type ProductRow = {
  id: string;
  sku: string;
  brand: string;
  model: string;
  category: string;
  condition: string;
  status: string;
  selling_price: number;
  show_price: number;
  public_slug: string;
  public_description_th: string;
  public_description_en: string;
  description_th: string;
  description_en: string;
  short_description: string;
  created_at: string;
};
type CatalogRow = {
  id: string;
  title: string;
  description: string;
  slug: string;
  status: string;
  show_prices: number;
  show_sold: number;
  expires_at: string | null;
};
type CatalogItemRow = {
  product_id: string;
  product_slug: string;
  product_name_snapshot: string;
  brand_snapshot: string;
  model_snapshot: string;
  category_snapshot: string;
  condition_snapshot: string;
  description_snapshot: string;
  image_key_snapshot: string;
  image_mime_snapshot: string;
  display_price: number | null;
  status: string;
  sku: string;
};
const app = new Hono<PublicEnv>();
const pageSize = 18;
const htmlEscape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
const attr = htmlEscape;
const baseUrl = (request: Request, env: PublicBindings) =>
  (env.PUBLIC_CATALOG_BASE_URL || new URL(request.url).origin).replace(
    /\/$/,
    '',
  );
const isExpired = (value: string | null) =>
  value ? Date.parse(value) < Date.now() : false;
const activeCatalog = (catalog: CatalogRow | null): catalog is CatalogRow =>
  !!catalog && catalog.status === 'ACTIVE' && !isExpired(catalog.expires_at);
const localeOf = (request: Request) =>
  new URL(request.url).searchParams.get('lang') === 'th' ||
  (!new URL(request.url).searchParams.has('lang') &&
    request.headers.get('Accept-Language')?.toLowerCase().startsWith('th'))
    ? 'th'
    : 'en';
const text = (language: string, en: string, th: string) =>
  language === 'th' ? th : en;
const statusLabel = (status: string, language: string) => {
  const values: Record<string, [string, string]> = {
    AVAILABLE: ['Available', 'พร้อมขาย'],
    RESERVED: ['Reserved', 'จองแล้ว'],
    SOLD: ['Sold', 'ขายแล้ว'],
    NOT_AVAILABLE: ['Not available', 'ไม่พร้อมขาย'],
  };
  return text(
    language,
    ...(values[status] ?? ['Unavailable', 'ไม่พร้อมใช้งาน']),
  );
};
const money = (value: number, language: string) =>
  new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  }).format(value);
const publicDescription = (product: ProductRow, language: string) =>
  (language === 'th'
    ? product.public_description_th || product.description_th
    : product.public_description_en || product.description_en) ||
  product.short_description ||
  '';
async function company(database: D1Database) {
  return database
    .prepare(
      "SELECT company_name_th,company_name_en,phone,email,line_url,facebook_url,logo_key FROM quotation_settings WHERE id='default'",
    )
    .first<Company>();
}
function safeExternalUrl(value: string, allowed: string[]) {
  try {
    const url = new URL(value);
    return allowed.includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}
function pageHtml(args: {
  request: Request;
  env: PublicBindings;
  title: string;
  description: string;
  image?: string;
  content: string;
  language?: string;
  status?: number;
}) {
  const { request, env } = args;
  const base = baseUrl(request, env);
  const url = new URL(request.url);
  const title = htmlEscape(args.title);
  const description = htmlEscape(args.description.slice(0, 300));
  const image = args.image
    ? `\n<meta property="og:image" content="${attr(args.image)}">\n<meta name="twitter:image" content="${attr(args.image)}">`
    : '';
  const logo = `<a class="brand" href="/catalog"><span class="brand-mark">C</span><span>COREVITY<small>${htmlEscape(text(args.language ?? 'en', 'FITNESS EQUIPMENT', 'อุปกรณ์ฟิตเนส'))}</small></span></a>`;
  const html = `<!doctype html><html lang="${args.language ?? 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0d1b2e"><title>${title}</title><meta name="description" content="${description}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${attr(`${base}${url.pathname}${url.search}`)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}">${image}<style>
*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#202a39;font:15px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration:none}button,input,select{font:inherit}.shell{max-width:1180px;margin:auto;padding:0 22px}.top{background:#fff;border-bottom:1px solid #dce5ef}.top-inner{min-height:74px;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{display:flex;align-items:center;gap:10px;color:#172a45;font-weight:800;letter-spacing:1.4px}.brand small{display:block;font-size:9px;letter-spacing:1.5px;color:#73859d}.brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:#1769d2;color:white;font-size:20px;font-weight:800}.top-actions,.actions,.share-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.top-actions a,.button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:40px;padding:8px 13px;border:1px solid #dce5ef;border-radius:9px;background:#fff;font-size:13px;font-weight:650}.button.primary{background:#1769d2;border-color:#1769d2;color:white}.hero{padding:42px 0 22px}.eyebrow{margin:0 0 6px;color:#1769d2;font-size:11px;font-weight:750;letter-spacing:1.5px;text-transform:uppercase}.hero h1{margin:0;color:#172a45;font-size:clamp(28px,5vw,44px);line-height:1.15;letter-spacing:-1.2px}.hero p{max-width:700px;margin:12px 0 0;color:#657993}.filters{display:grid;grid-template-columns:minmax(220px,2fr) repeat(3,minmax(140px,1fr)) auto;gap:9px;padding:14px;border:1px solid #dce5ef;border-radius:14px;background:#fff}.filters input,.filters select{width:100%;min-width:0;min-height:42px;padding:9px 11px;border:1px solid #dce5ef;border-radius:8px;background:#fff;color:#202a39}.filters button{min-height:42px;padding:8px 15px;border:0;border-radius:8px;background:#1769d2;color:#fff;font-weight:700}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:18px 0 32px}.card{overflow:hidden;border:1px solid #dce5ef;border-radius:13px;background:#fff;box-shadow:0 4px 15px #1422380b;transition:transform .15s,box-shadow .15s}.card:hover{transform:translateY(-2px);box-shadow:0 8px 24px #14223818}.photo{position:relative;display:grid;place-items:center;aspect-ratio:4/3;background:#e8eef6;color:#71839b}.photo img{width:100%;height:100%;object-fit:cover}.card-body{padding:15px}.meta{display:flex;gap:7px;flex-wrap:wrap;color:#657993;font-size:11px}.pill{display:inline-flex;padding:4px 9px;border-radius:999px;background:#eaf2fc;color:#245b9f;font-size:11px;font-weight:700}.pill.available{background:#dcfce8;color:#17673c}.pill.reserved{background:#fff1cb;color:#8e5b00}.pill.sold{background:#fee2e2;color:#a22b2b}.pill.not_available{background:#fee2e2;color:#a22b2b}.card h2{margin:8px 0 4px;font-size:17px;line-height:1.35}.price{margin:11px 0;color:#1458ad;font-size:20px;font-weight:800}.muted{color:#6d7e93;font-size:13px}.detail{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:25px;margin:27px 0 42px}.gallery-main{overflow:hidden;aspect-ratio:4/3;border-radius:14px;background:#e8eef6}.gallery-main img{width:100%;height:100%;object-fit:contain}.thumbs{display:flex;gap:9px;margin-top:9px;overflow:auto}.thumbs img{width:75px;height:62px;object-fit:cover;border:1px solid #dce5ef;border-radius:8px}.detail-copy{padding:8px 0}.detail-copy h1{margin:8px 0;font-size:clamp(27px,4vw,38px);line-height:1.2}.detail-copy .price{font-size:25px}.description{white-space:pre-wrap;color:#52677f}.facts{display:flex;gap:8px;flex-wrap:wrap;margin:17px 0}.contact{display:flex;gap:9px;flex-wrap:wrap;margin:20px 0}.contact a,.contact button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:10px 14px;border:0;border-radius:9px;background:#1769d2;color:#fff;font-weight:700;cursor:pointer}.contact a.secondary,.contact button.secondary{border:1px solid #dce5ef;background:#fff;color:#24415f}.share-row{margin-top:13px}.share-row a,.share-row button{border:0;background:transparent;color:#2463a9;font-weight:650;cursor:pointer}.notice{margin-top:10px;color:#17673c;font-size:13px}.empty{padding:40px;border:1px dashed #b9c8da;border-radius:13px;text-align:center;color:#6d7e93}.pagination{display:flex;justify-content:center;gap:12px;margin:25px 0 40px}.pagination a{padding:9px 13px;border:1px solid #dce5ef;border-radius:8px;background:#fff}.catalog-info{padding:20px;border:1px solid #dce5ef;border-radius:13px;background:#fff}.footer{margin-top:36px;padding:24px 0;border-top:1px solid #dce5ef;color:#71839b;font-size:12px}.footer-inner{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.hidden{display:none!important}@media(max-width:900px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.filters input{grid-column:1/-1}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.shell{padding:0 14px}.top-inner{min-height:62px}.brand-mark{width:34px;height:34px}.top-actions .optional{display:none}.hero{padding:29px 0 18px}.filters{grid-template-columns:minmax(0,1fr);padding:11px}.filters input{grid-column:auto}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}.card-body{padding:10px}.card h2{font-size:14px}.price{font-size:16px}.pill{font-size:10px;padding:3px 7px}.detail{grid-template-columns:1fr;gap:12px;margin-top:18px}.detail-copy{padding:0}.detail-copy h1{font-size:28px}.contact>*{flex:1}.catalog-info{padding:15px}}
</style></head><body><header class="top"><div class="shell top-inner">${logo}<nav class="top-actions"><a href="/catalog">${htmlEscape(text(args.language ?? 'en', 'Equipment catalog', 'แคตตาล็อกสินค้า'))}</a><a class="optional" href="/catalog?lang=th">ไทย</a><a class="optional" href="/catalog?lang=en">EN</a></nav></div></header><main class="shell">${args.content}</main><footer class="footer"><div class="shell footer-inner"><span>${htmlEscape(text(args.language ?? 'en', 'Corevity · Commercial fitness equipment', 'Corevity · อุปกรณ์ฟิตเนสเชิงพาณิชย์'))}</span><span>${htmlEscape(text(args.language ?? 'en', 'Availability may change. Contact our team to confirm.', 'สถานะสินค้าอาจเปลี่ยนแปลง กรุณาติดต่อทีมงานเพื่อยืนยัน'))}</span></div></footer><script>
document.querySelectorAll('[data-share]').forEach(b=>b.addEventListener('click',async()=>{const d={title:document.title,text:b.dataset.share,url:location.href};try{if(navigator.share)await navigator.share(d);else{await navigator.clipboard.writeText(location.href);b.textContent='Copied'}}catch{}}));document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='Copied'}catch{}}));
</script></body></html>`;
  return new Response(html, {
    status: args.status ?? 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control':
        'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}
async function logEvent(
  database: D1Database,
  entityType: 'CATALOG' | 'PRODUCT' | 'PUBLIC',
  entitySlug: string,
  eventType: 'PAGE_VIEW' | 'PRODUCT_VIEW' | 'CONTACT_CLICK',
) {
  const hour = new Date().toISOString().slice(0, 13) + ':00:00Z';
  await database
    .prepare(
      `INSERT INTO catalog_events(entity_type,entity_slug,event_type,hour,count) VALUES(?,?,?,?,1)
       ON CONFLICT(entity_type,entity_slug,event_type,hour) DO UPDATE SET count=count+1`,
    )
    .bind(entityType, entitySlug, eventType, hour)
    .run();
}
async function getProduct(
  database: D1Database,
  slug: string,
  allowSold = false,
) {
  return database
    .prepare(
      `SELECT id,sku,brand,model,category,condition,status,selling_price,show_price,public_slug,
        public_description_th,public_description_en,description_th,description_en,short_description,created_at
       FROM products WHERE public_slug=? AND is_published=1 AND archived_at IS NULL
         AND (?=1 OR status!='SOLD')`,
    )
    .bind(slug, Number(allowSold))
    .first<ProductRow>();
}
async function getCatalog(database: D1Database, slug: string) {
  const catalog = await database
    .prepare(
      'SELECT id,title,description,slug,status,show_prices,show_sold,expires_at FROM catalogs WHERE slug=?',
    )
    .bind(slug)
    .first<CatalogRow>();
  return activeCatalog(catalog) ? catalog : null;
}
async function catalogItems(database: D1Database, catalog: CatalogRow) {
  const { results } = await database
    .prepare(
      `SELECT i.product_id,i.product_name_snapshot,i.brand_snapshot,i.model_snapshot,i.category_snapshot,
        i.condition_snapshot,i.description_snapshot,i.image_key_snapshot,i.image_mime_snapshot,i.display_price,
        p.public_slug AS product_slug,p.status,p.sku
       FROM catalog_items i JOIN products p ON p.id=i.product_id
       WHERE i.catalog_id=? AND p.is_published=1 AND p.archived_at IS NULL
         AND (?=1 OR p.status!='SOLD')
       ORDER BY i.sort_order LIMIT 100`,
    )
    .bind(catalog.id, catalog.show_sold)
    .all<CatalogItemRow>();
  return results;
}
function contactLinks(
  companyInfo: Company | null,
  kind: 'product' | 'catalog',
  slug: string,
  name: string,
  sku: string,
  language: string,
  base: string,
  catalogSlug?: string,
  productSlug?: string,
) {
  const url = catalogSlug
    ? productSlug
      ? `${base}/s/${catalogSlug}/p/${productSlug}`
      : `${base}/s/${catalogSlug}`
    : `${base}/catalog/products/${slug}`;
  const productLine = sku ? `${name}\nSKU: ${sku}\n` : `${name}\n`;
  const message = `${productLine}\n${url}`;
  const phone = companyInfo?.phone.replace(/[^+\d]/g, '') ?? '';
  const contactBase = `/contact/${kind}/${encodeURIComponent(slug)}`;
  const contactHref = (channel: string) =>
    `${contactBase}/${channel}${productSlug ? `?product=${encodeURIComponent(productSlug)}` : ''}`;
  const trackedLinks = [
    companyInfo?.line_url
      ? `<a href="${contactHref('line')}">${htmlEscape(text(language, 'Contact via LINE', 'ติดต่อทาง LINE'))}</a>`
      : '',
    companyInfo?.facebook_url
      ? `<a href="${contactHref('facebook')}" class="secondary">${htmlEscape(text(language, 'Message on Facebook', 'ส่งข้อความทาง Facebook'))}</a>`
      : '',
    phone
      ? `<a href="${contactHref('phone')}" class="secondary">${htmlEscape(text(language, 'Call us', 'โทรหาเรา'))}</a>`
      : '',
    companyInfo?.email
      ? `<a href="${contactHref('email')}" class="secondary">${htmlEscape(text(language, 'Email', 'อีเมล'))}</a>`
      : '',
  ].filter(Boolean);
  return `<div class="contact">${trackedLinks.join('') || `<span class="muted">${htmlEscape(text(language, 'Contact details are being updated.', 'กำลังอัปเดตข้อมูลติดต่อ'))}</span>`}</div><div class="share-row"><button data-share="${attr(message)}">${htmlEscape(text(language, 'Share', 'แชร์'))}</button><a href="https://line.me/R/share?text=${encodeURIComponent(`${name} ${url}`)}" target="_blank" rel="noopener noreferrer">${htmlEscape(text(language, 'Share to LINE', 'แชร์ไป LINE'))}</a><a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">Facebook</a><button data-copy="${attr(message)}">${htmlEscape(text(language, 'Copy inquiry details', 'คัดลอกรายละเอียดสอบถาม'))}</button></div>`;
}

app.get('/', (c) => c.redirect('/catalog'));
app.get('/catalog', async (c) => {
  const language = localeOf(c.req.raw);
  const url = new URL(c.req.url);
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const brand = (url.searchParams.get('brand') ?? '').slice(0, 100);
  const category = (url.searchParams.get('category') ?? '').slice(0, 100);
  const condition = (url.searchParams.get('condition') ?? '').slice(0, 100);
  const availability = (url.searchParams.get('availability') ?? '').slice(
    0,
    30,
  );
  const sort = url.searchParams.get('sort') === 'price' ? 'price' : 'newest';
  const page = Math.max(
    1,
    Math.min(1000, Number(url.searchParams.get('page')) || 1),
  );
  const filters = ['is_published=1', 'archived_at IS NULL', "status!='SOLD'"];
  const values: (string | number)[] = [];
  if (query) {
    filters.push('(brand LIKE ? OR model LIKE ?)');
    values.push(`%${query}%`, `%${query}%`);
  }
  if (brand) {
    filters.push('brand=?');
    values.push(brand);
  }
  if (category) {
    filters.push('category=?');
    values.push(category);
  }
  if (condition) {
    filters.push('condition=?');
    values.push(condition);
  }
  if (['AVAILABLE', 'RESERVED', 'NOT_AVAILABLE'].includes(availability)) {
    filters.push('status=?');
    values.push(availability);
  }
  const where = filters.join(' AND ');
  const order =
    sort === 'price'
      ? 'show_price DESC,selling_price ASC,created_at DESC'
      : 'created_at DESC';
  const [rowsResult, countRow, filtersRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id,sku,brand,model,category,condition,status,selling_price,show_price,public_slug,
        (SELECT COUNT(*) FROM product_images WHERE product_id=products.id) AS image_count
       FROM products WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
      .bind(...values, pageSize, (page - 1) * pageSize)
      .all<ProductRow & { image_count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM products WHERE ${where}`)
      .bind(...values)
      .first<{ total: number }>(),
    c.env.DB.prepare(
      `SELECT DISTINCT brand,category,condition FROM products WHERE is_published=1 AND archived_at IS NULL AND status!='SOLD' ORDER BY brand,category,condition`,
    ).all<{ brand: string; category: string; condition: string }>(),
  ]);
  await logEvent(c.env.DB, 'PUBLIC', 'catalog', 'PAGE_VIEW');
  const labels = {
    search: text(language, 'Search brand or model', 'ค้นหาแบรนด์หรือรุ่น'),
    brand: text(language, 'All brands', 'ทุกแบรนด์'),
    category: text(language, 'All categories', 'ทุกหมวดหมู่'),
    condition: text(language, 'All conditions', 'ทุกสภาพ'),
    availability: text(language, 'All availability', 'ทุกสถานะ'),
    newest: text(language, 'Newest first', 'ใหม่ล่าสุด'),
    price: text(language, 'Price: low to high', 'ราคาต่ำไปสูง'),
    apply: text(language, 'Search', 'ค้นหา'),
  };
  const products = rowsResult.results;
  const brandOptions = [...new Set(filtersRow.results.map((r) => r.brand))];
  const categoryOptions = [
    ...new Set(filtersRow.results.map((r) => r.category)),
  ];
  const conditionOptions = [
    ...new Set(filtersRow.results.map((r) => r.condition).filter(Boolean)),
  ];
  const selectOptions = (
    current: string,
    allLabel: string,
    values: string[],
    name: string,
  ) =>
    `<select name="${name}"><option value="">${htmlEscape(allLabel)}</option>${values.map((value) => `<option value="${attr(value)}"${value === current ? ' selected' : ''}>${htmlEscape(value)}</option>`).join('')}</select>`;
  const options = `<option value="">${htmlEscape(labels.availability)}</option><option value="AVAILABLE"${availability === 'AVAILABLE' ? ' selected' : ''}>${htmlEscape(statusLabel('AVAILABLE', language))}</option><option value="RESERVED"${availability === 'RESERVED' ? ' selected' : ''}>${htmlEscape(statusLabel('RESERVED', language))}</option><option value="NOT_AVAILABLE"${availability === 'NOT_AVAILABLE' ? ' selected' : ''}>${htmlEscape(statusLabel('NOT_AVAILABLE', language))}</option>`;
  const form = `<form class="filters" method="get"><input name="q" value="${attr(query)}" placeholder="${attr(labels.search)}">${selectOptions(brand, labels.brand, brandOptions, 'brand')}${selectOptions(category, labels.category, categoryOptions, 'category')}${selectOptions(condition, labels.condition, conditionOptions, 'condition')}<select name="availability">${options}</select><select name="sort"><option value="newest">${htmlEscape(labels.newest)}</option><option value="price"${sort === 'price' ? ' selected' : ''}>${htmlEscape(labels.price)}</option></select><button>${htmlEscape(labels.apply)}</button></form>`;
  const cards = products
    .map((product) => {
      const slug = product.public_slug;
      const photo = product.image_count
        ? `<img src="/media/products/${encodeURIComponent(slug)}/0" alt="${attr(`${product.brand} ${product.model}`)}" loading="lazy">`
        : `<span>${htmlEscape(text(language, 'Photo coming soon', 'ยังไม่มีรูปสินค้า'))}</span>`;
      const price = product.show_price
        ? `<div class="price">${htmlEscape(money(product.selling_price, language))}</div>`
        : `<div class="price muted">${htmlEscape(text(language, 'Contact for price', 'สอบถามราคา'))}</div>`;
      return `<article class="card"><a href="/catalog/products/${encodeURIComponent(slug)}"><div class="photo">${photo}</div><div class="card-body"><div class="meta"><span class="pill">${htmlEscape(product.category)}</span><span class="pill ${product.status.toLowerCase()}">${htmlEscape(statusLabel(product.status, language))}</span></div><h2>${htmlEscape(product.brand)} ${htmlEscape(product.model)}</h2><div class="muted">${htmlEscape(product.condition || text(language, 'Condition not specified', 'ไม่ระบุสภาพ'))}</div>${price}<span class="button primary">${htmlEscape(text(language, 'View details', 'ดูรายละเอียด'))}</span></div></a></article>`;
    })
    .join('');
  const totalPages = Math.max(1, Math.ceil((countRow?.total ?? 0) / pageSize));
  const pagination =
    totalPages > 1
      ? `<nav class="pagination">${page > 1 ? `<a href="${attr(`?${new URLSearchParams({ q: query, brand, category, condition, availability, sort, page: String(page - 1) })}`)}">${htmlEscape(text(language, 'Previous', 'ก่อนหน้า'))}</a>` : ''}<span>${page} / ${totalPages}</span>${page < totalPages ? `<a href="${attr(`?${new URLSearchParams({ q: query, brand, category, condition, availability, sort, page: String(page + 1) })}`)}">${htmlEscape(text(language, 'Next', 'ถัดไป'))}</a>` : ''}</nav>`
      : '';
  const content = `<section class="hero"><p class="eyebrow">${htmlEscape(text(language, 'Commercial fitness equipment', 'อุปกรณ์ฟิตเนสเชิงพาณิชย์'))}</p><h1>${htmlEscape(text(language, 'Equipment catalog', 'แคตตาล็อกสินค้า'))}</h1><p>${htmlEscape(text(language, 'Explore our current selection of new and pre-owned equipment. Contact our team to confirm availability.', 'เลือกชมอุปกรณ์ใหม่และมือสองที่มีในปัจจุบัน ติดต่อทีมงานเพื่อยืนยันสถานะสินค้า'))}</p></section>${form}<div class="meta" style="margin-top:16px">${htmlEscape(text(language, `${countRow?.total ?? 0} products`, `สินค้า ${countRow?.total ?? 0} รายการ`))}</div>${products.length ? `<section class="grid">${cards}</section>` : `<div class="empty">${htmlEscape(text(language, 'No products match those filters.', 'ไม่พบสินค้าที่ตรงกับตัวกรอง'))}</div>`}${pagination}`;
  return pageHtml({
    request: c.req.raw,
    env: c.env,
    title: text(
      language,
      'Corevity Equipment Catalog',
      'แคตตาล็อกอุปกรณ์ Corevity',
    ),
    description: text(
      language,
      'Browse published commercial fitness equipment from Corevity.',
      'เลือกชมอุปกรณ์ฟิตเนสเชิงพาณิชย์ที่เผยแพร่จาก Corevity',
    ),
    content,
    language,
  });
});

app.get('/catalog/products/:slug', async (c) => {
  const slug = c.req.param('slug');
  const language = localeOf(c.req.raw);
  const product = await getProduct(c.env.DB, slug);
  if (!product)
    return pageHtml({
      request: c.req.raw,
      env: c.env,
      title: 'Product not found',
      description: 'This product is not available.',
      content: `<div class="empty"><h1>${htmlEscape(text(language, 'Product unavailable', 'ไม่พบสินค้า'))}</h1><p>${htmlEscape(text(language, 'This product is no longer published.', 'สินค้านี้ไม่ได้เผยแพร่แล้ว'))}</p><a class="button primary" href="/catalog">${htmlEscape(text(language, 'Back to catalog', 'กลับไปแคตตาล็อก'))}</a></div>`,
      language,
      status: 404,
    });
  const companyInfo = await company(c.env.DB);
  await logEvent(c.env.DB, 'PRODUCT', slug, 'PAGE_VIEW');
  const from = c.req.query('from');
  if (from) {
    const catalog = await getCatalog(c.env.DB, from);
    if (catalog) await logEvent(c.env.DB, 'CATALOG', from, 'PRODUCT_VIEW');
  }
  const { results: photos } = await c.env.DB.prepare(
    'SELECT id FROM product_images WHERE product_id=? ORDER BY is_primary DESC,sort_order LIMIT 5',
  )
    .bind(product.id)
    .all<{ id: string }>();
  const description = publicDescription(product, language);
  const name = `${product.brand} ${product.model}`;
  const base = baseUrl(c.req.raw, c.env);
  const photo = photos.length
    ? `/media/products/${encodeURIComponent(slug)}/0`
    : '';
  const status = `<span class="pill ${product.status.toLowerCase()}">${htmlEscape(statusLabel(product.status, language))}</span>`;
  const price = product.show_price
    ? `<div class="price">${htmlEscape(money(product.selling_price, language))}</div>`
    : `<div class="price muted">${htmlEscape(text(language, 'Contact for price', 'สอบถามราคา'))}</div>`;
  const gallery = photo
    ? `<div><div class="gallery-main"><img src="${photo}" alt="${attr(name)}"></div>${photos.length > 1 ? `<div class="thumbs">${photos.map((_, index) => `<img src="/media/products/${encodeURIComponent(slug)}/${index}" alt="${attr(`${name} ${index + 1}`)}" loading="lazy">`).join('')}</div>` : ''}</div>`
    : `<div class="gallery-main"></div>`;
  const facts = `<div class="facts"><span class="pill">${htmlEscape(product.category)}</span>${product.condition ? `<span class="pill">${htmlEscape(product.condition)}</span>` : ''}${status}</div>`;
  const links = contactLinks(
    companyInfo,
    'product',
    slug,
    name,
    product.sku,
    language,
    base,
  );
  const content = `<a class="button" href="/catalog">← ${htmlEscape(text(language, 'All equipment', 'สินค้าทั้งหมด'))}</a><section class="detail">${gallery}<div class="detail-copy"><p class="eyebrow">${htmlEscape(product.brand)}</p><h1>${htmlEscape(name)}</h1><div class="muted">${htmlEscape(text(language, `SKU: ${product.sku}`, `รหัสสินค้า: ${product.sku}`))}</div>${facts}${price}${description ? `<div class="description">${htmlEscape(description)}</div>` : ''}<h2>${htmlEscape(text(language, 'Product details', 'รายละเอียดสินค้า'))}</h2><div class="muted">${htmlEscape(product.category)}${product.condition ? ` · ${htmlEscape(product.condition)}` : ''}</div>${links}</div></section>`;
  return pageHtml({
    request: c.req.raw,
    env: c.env,
    title: `${name} | Corevity`,
    description: description || `${name} · ${product.category}`,
    image: photo ? `${base}${photo}` : undefined,
    content,
    language,
  });
});

app.get('/s/:slug/p/:productSlug', async (c) => {
  const slug = c.req.param('slug');
  const productSlug = c.req.param('productSlug');
  const language = localeOf(c.req.raw);
  const catalog = await getCatalog(c.env.DB, slug);
  if (!catalog) return c.redirect('/catalog', 302);
  const items = await catalogItems(c.env.DB, catalog);
  const item = items.find((row) => row.product_slug === productSlug);
  if (!item) return c.redirect(`/s/${encodeURIComponent(slug)}`, 302);
  await logEvent(c.env.DB, 'CATALOG', slug, 'PRODUCT_VIEW');
  const companyInfo = await company(c.env.DB);
  const base = baseUrl(c.req.raw, c.env);
  const itemPosition = items.indexOf(item);
  const photo = item.image_key_snapshot
    ? `/media/catalogs/${encodeURIComponent(slug)}/${itemPosition}`
    : '';
  const description = item.description_snapshot;
  const price = catalog.show_prices
    ? `<div class="price">${htmlEscape(money(item.display_price ?? 0, language))}</div>`
    : `<div class="price muted">${htmlEscape(text(language, 'Contact for price', 'สอบถามราคา'))}</div>`;
  const content = `<a class="button" href="/s/${encodeURIComponent(slug)}">← ${htmlEscape(text(language, 'Back to collection', 'กลับไปแคตตาล็อกนี้'))}</a><section class="detail"><div class="gallery-main">${photo ? `<img src="${photo}" alt="${attr(item.product_name_snapshot)}">` : ''}</div><div class="detail-copy"><p class="eyebrow">${htmlEscape(item.brand_snapshot)}</p><h1>${htmlEscape(item.product_name_snapshot)}</h1><div class="muted">${htmlEscape(text(language, `SKU: ${item.sku}`, `รหัสสินค้า: ${item.sku}`))}</div><div class="facts"><span class="pill">${htmlEscape(item.category_snapshot)}</span><span class="pill">${htmlEscape(item.condition_snapshot)}</span><span class="pill ${item.status.toLowerCase()}">${htmlEscape(statusLabel(item.status, language))}</span></div>${price}${description ? `<div class="description">${htmlEscape(description)}</div>` : ''}${contactLinks(companyInfo, 'catalog', slug, item.product_name_snapshot, item.sku, language, base, slug, item.product_slug)}</div></section>`;
  return pageHtml({
    request: c.req.raw,
    env: c.env,
    title: `${item.product_name_snapshot} | ${catalog.title}`,
    description:
      description || catalog.description || item.product_name_snapshot,
    image: photo ? `${base}${photo}` : undefined,
    content,
    language,
  });
});

app.get('/s/:slug/p/:productSlug/contact', (c) =>
  c.redirect(
    `/s/${encodeURIComponent(c.req.param('slug'))}/p/${encodeURIComponent(c.req.param('productSlug'))}`,
    302,
  ),
);
app.get('/s/:slug', async (c) => {
  const slug = c.req.param('slug');
  const language = localeOf(c.req.raw);
  const catalog = await getCatalog(c.env.DB, slug);
  if (!catalog)
    return pageHtml({
      request: c.req.raw,
      env: c.env,
      title: 'Collection unavailable',
      description: 'This collection is unavailable.',
      content: `<div class="empty"><h1>${htmlEscape(text(language, 'Collection unavailable', 'ไม่พบแคตตาล็อก'))}</h1><p>${htmlEscape(text(language, 'This link may have expired or been archived.', 'ลิงก์นี้อาจหมดอายุหรือถูกเก็บถาวรแล้ว'))}</p><a class="button primary" href="/catalog">${htmlEscape(text(language, 'Browse catalog', 'ดูแคตตาล็อกสินค้า'))}</a></div>`,
      language,
      status: 404,
    });
  const items = await catalogItems(c.env.DB, catalog);
  const companyInfo = await company(c.env.DB);
  await logEvent(c.env.DB, 'CATALOG', slug, 'PAGE_VIEW');
  const base = baseUrl(c.req.raw, c.env);
  const cards = items
    .map((item, index) => {
      const imageUrl = item.image_key_snapshot
        ? `/media/catalogs/${encodeURIComponent(slug)}/${index}`
        : '';
      const price = catalog.show_prices
        ? `<div class="price">${htmlEscape(money(item.display_price ?? 0, language))}</div>`
        : `<div class="price muted">${htmlEscape(text(language, 'Contact for price', 'สอบถามราคา'))}</div>`;
      const target = `/s/${encodeURIComponent(slug)}/p/${encodeURIComponent(item.product_slug)}`;
      return `<article class="card"><a href="${target}"><div class="photo">${imageUrl ? `<img src="${imageUrl}" alt="${attr(item.product_name_snapshot)}" loading="lazy">` : `<span>${htmlEscape(text(language, 'Photo coming soon', 'ยังไม่มีรูปสินค้า'))}</span>`}</div><div class="card-body"><div class="meta"><span class="pill">${htmlEscape(item.category_snapshot)}</span><span class="pill ${item.status.toLowerCase()}">${htmlEscape(statusLabel(item.status, language))}</span></div><h2>${htmlEscape(item.product_name_snapshot)}</h2><div class="muted">${htmlEscape(item.condition_snapshot)}</div>${price}<span class="button primary">${htmlEscape(text(language, 'View details', 'ดูรายละเอียด'))}</span></div></a></article>`;
    })
    .join('');
  const companyName =
    language === 'th'
      ? companyInfo?.company_name_th ||
        companyInfo?.company_name_en ||
        'Corevity'
      : companyInfo?.company_name_en ||
        companyInfo?.company_name_th ||
        'Corevity';
  const logo = companyInfo?.logo_key
    ? `<img src="/media/company-logo" alt="${attr(companyName)}" style="max-width:110px;max-height:64px;object-fit:contain">`
    : '';
  const content = `<section class="hero"><p class="eyebrow">${htmlEscape(companyName)}</p><h1>${htmlEscape(catalog.title)}</h1>${catalog.description ? `<p>${htmlEscape(catalog.description)}</p>` : ''}<div>${logo}</div></section>${items.length ? `<section class="grid">${cards}</section>` : `<div class="empty">${htmlEscape(text(language, 'No published products are currently available in this collection.', 'ไม่มีสินค้าที่เผยแพร่ในแคตตาล็อกนี้ในขณะนี้'))}</div>`}${contactLinks(companyInfo, 'catalog', slug, catalog.title, '', language, base)}`;
  const featured = items[0]?.image_key_snapshot
    ? `${base}/media/catalogs/${encodeURIComponent(slug)}/0`
    : undefined;
  return pageHtml({
    request: c.req.raw,
    env: c.env,
    title: `${catalog.title} | ${companyName}`,
    description:
      catalog.description ||
      text(
        language,
        `A curated equipment collection from ${companyName}.`,
        `ชุดสินค้าคัดสรรจาก ${companyName}`,
      ),
    image: featured,
    content,
    language,
  });
});

app.get('/contact/:kind/:slug/:channel', async (c) => {
  const kind = c.req.param('kind');
  const slug = c.req.param('slug');
  const channel = c.req.param('channel');
  if (
    !['product', 'catalog'].includes(kind) ||
    !['line', 'facebook', 'phone', 'email'].includes(channel)
  )
    return c.text('Not found', 404);
  let product: ProductRow | null = null;
  let catalog: CatalogRow | null = null;
  if (kind === 'product') product = await getProduct(c.env.DB, slug);
  else catalog = await getCatalog(c.env.DB, slug);
  let catalogProduct: ProductRow | null = null;
  const requestedProduct = c.req.query('product');
  if (catalog && requestedProduct) {
    const items = await catalogItems(c.env.DB, catalog);
    if (items.some((item) => item.product_slug === requestedProduct))
      catalogProduct = await getProduct(
        c.env.DB,
        requestedProduct,
        catalog.show_sold === 1,
      );
  }
  if ((kind === 'product' && !product) || (kind === 'catalog' && !catalog))
    return c.text('Not found', 404);
  await logEvent(
    c.env.DB,
    kind === 'product' ? 'PRODUCT' : 'CATALOG',
    slug,
    'CONTACT_CLICK',
  );
  const companyInfo = await company(c.env.DB);
  const base = baseUrl(c.req.raw, c.env);
  const record = product ?? catalogProduct;
  const recordName = record
    ? `${record.brand} ${record.model}`
    : catalog!.title;
  const recordSku = record?.sku ?? '';
  const recordLink = product
    ? `${base}/catalog/products/${encodeURIComponent(slug)}`
    : catalogProduct
      ? `${base}/s/${encodeURIComponent(slug)}/p/${encodeURIComponent(catalogProduct.public_slug)}`
      : `${base}/s/${encodeURIComponent(slug)}`;
  const contactMessage = `${recordName}${recordSku ? `\nSKU: ${recordSku}` : ''}\n${recordLink}`;
  let target = '';
  if (channel === 'line' && companyInfo?.line_url) {
    target = safeExternalUrl(companyInfo.line_url, ['https:']);
    if (target && /line\.me\/r\/oamessage\//i.test(target)) {
      const destination = new URL(target);
      destination.searchParams.set('text', contactMessage);
      target = destination.toString();
    }
  } else if (channel === 'facebook' && companyInfo?.facebook_url)
    target = safeExternalUrl(companyInfo.facebook_url, ['https:']);
  else if (channel === 'phone' && companyInfo?.phone)
    target = `tel:${companyInfo.phone.replace(/[^+\d]/g, '')}`;
  else if (channel === 'email' && companyInfo?.email)
    target = `mailto:${companyInfo.email}?subject=${encodeURIComponent(recordName)}&body=${encodeURIComponent(contactMessage)}`;
  return target ? c.redirect(target, 302) : c.redirect(recordLink, 302);
});

app.get('/media/company-logo', async (c) => {
  const companyInfo = await company(c.env.DB);
  if (!companyInfo?.logo_key) return c.notFound();
  const object = await c.env.PRODUCT_IMAGES.get(companyInfo.logo_key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'image/png',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
app.get('/media/products/:slug/:position', async (c) => {
  const product = await getProduct(c.env.DB, c.req.param('slug'));
  if (!product) return c.notFound();
  const position = Number(c.req.param('position'));
  if (!Number.isInteger(position) || position < 0 || position > 4)
    return c.notFound();
  const image = await c.env.DB.prepare(
    'SELECT r2_key,mime_type FROM product_images WHERE product_id=? ORDER BY is_primary DESC,sort_order LIMIT 1 OFFSET ?',
  )
    .bind(product.id, position)
    .first<{ r2_key: string; mime_type: string }>();
  if (!image) return c.notFound();
  const object = await c.env.PRODUCT_IMAGES.get(image.r2_key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': image.mime_type,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
app.get('/media/catalogs/:slug/:position', async (c) => {
  const catalog = await getCatalog(c.env.DB, c.req.param('slug'));
  if (!catalog) return c.notFound();
  const position = Number(c.req.param('position'));
  if (!Number.isInteger(position) || position < 0 || position > 99)
    return c.notFound();
  const item = await c.env.DB.prepare(
    `SELECT i.image_key_snapshot AS r2_key,i.image_mime_snapshot AS mime_type
     FROM catalog_items i JOIN products p ON p.id=i.product_id
     WHERE i.catalog_id=? AND p.is_published=1 AND p.archived_at IS NULL AND (?=1 OR p.status!='SOLD')
     ORDER BY i.sort_order LIMIT 1 OFFSET ?`,
  )
    .bind(catalog.id, catalog.show_sold, position)
    .first<{ r2_key: string; mime_type: string }>();
  if (!item?.r2_key) return c.notFound();
  const object = await c.env.PRODUCT_IMAGES.get(item.r2_key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type':
        item.mime_type || object.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

app.get('/api/public/catalog', async (c) => {
  const search = (c.req.query('q') ?? '').slice(0, 100);
  const page = Math.max(1, Math.min(1000, Number(c.req.query('page')) || 1));
  const { results } = await c.env.DB.prepare(
    `SELECT brand,model,category,condition,status,public_slug AS slug,
      CASE WHEN show_price=1 THEN selling_price ELSE NULL END AS price,
      (SELECT COUNT(*) FROM product_images WHERE product_id=products.id) AS imageCount
     FROM products WHERE is_published=1 AND archived_at IS NULL AND status!='SOLD'
       AND (?='' OR brand LIKE ? OR model LIKE ?)
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(search, `%${search}%`, `%${search}%`, pageSize, (page - 1) * pageSize)
    .all();
  return c.json({ products: results, page, pageSize }, 200, {
    'Cache-Control':
      'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
  });
});
app.get('/api/public/products/:slug', async (c) => {
  const product = await getProduct(c.env.DB, c.req.param('slug'));
  if (!product) return c.json({ error: 'Product not found.' }, 404);
  const { results: photos } = await c.env.DB.prepare(
    'SELECT 1 AS available FROM product_images WHERE product_id=? ORDER BY is_primary DESC,sort_order LIMIT 5',
  )
    .bind(product.id)
    .all();
  const language = localeOf(c.req.raw);
  return c.json(
    {
      product: {
        slug: product.public_slug,
        sku: product.sku,
        brand: product.brand,
        model: product.model,
        category: product.category,
        condition: product.condition,
        availability: product.status,
        showPrice: !!product.show_price,
        ...(product.show_price ? { price: product.selling_price } : {}),
        description: publicDescription(product, language),
        imageCount: photos.length,
      },
    },
    200,
    {
      'Cache-Control':
        'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
    },
  );
});
app.get('/api/public/catalogs/:slug', async (c) => {
  const catalog = await getCatalog(c.env.DB, c.req.param('slug'));
  if (!catalog) return c.json({ error: 'Catalog not found.' }, 404);
  const items = await catalogItems(c.env.DB, catalog);
  return c.json(
    {
      catalog: {
        title: catalog.title,
        description: catalog.description,
        showPrices: !!catalog.show_prices,
        expiresAt: catalog.expires_at,
      },
      products: items.map((item) => ({
        slug: item.product_slug,
        brand: item.brand_snapshot,
        model: item.model_snapshot,
        category: item.category_snapshot,
        condition: item.condition_snapshot,
        availability: item.status,
        description: item.description_snapshot,
        ...(catalog.show_prices ? { price: item.display_price } : {}),
      })),
    },
    200,
    {
      'Cache-Control':
        'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
    },
  );
});
app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
app.notFound((c) =>
  c.text('Not found', 404, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }),
);
app.onError((error) => {
  console.error(
    JSON.stringify({ event: 'public_catalog_error', type: error.name }),
  );
  return new Response('The catalog is temporarily unavailable.', {
    status: 500,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
});

export default {
  fetch(request: Request, env: PublicBindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
};
