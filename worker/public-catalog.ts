import { Hono } from "hono";

type PublicBindings = Pick<Env, "DB" | "PRODUCT_IMAGES"> & {
  PUBLIC_CATALOG_BASE_URL?: string;
  PUBLIC_STOREFRONT_ORIGINS?: string;
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
  id: string;
  product_id: string;
  product_slug: string | null;
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
app.use("/api/public/*", async (c, next) => {
  const origin = c.req.header("Origin") ?? "";
  const allowedOrigins = (c.env.PUBLIC_STOREFRONT_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (c.req.method === "OPTIONS") {
    if (origin && !allowedOrigins.includes(origin)) return c.body(null, 403);
    if (origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Methods", "GET, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type");
      c.header("Access-Control-Max-Age", "86400");
    }
    return c.body(null, 204);
  }
  await next();
  if (origin && allowedOrigins.includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }
});
const htmlEscape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
const attr = htmlEscape;
const baseUrl = (request: Request, env: PublicBindings) =>
  (env.PUBLIC_CATALOG_BASE_URL || new URL(request.url).origin).replace(
    /\/$/,
    "",
  );
const isExpired = (value: string | null) =>
  value ? Date.parse(value) < Date.now() : false;
const activeCatalog = (catalog: CatalogRow | null): catalog is CatalogRow =>
  !!catalog && catalog.status === "ACTIVE" && !isExpired(catalog.expires_at);
const localeOf = (request: Request) =>
  new URL(request.url).searchParams.get("lang") === "th" ||
  (!new URL(request.url).searchParams.has("lang") &&
    request.headers.get("Accept-Language")?.toLowerCase().startsWith("th"))
    ? "th"
    : "en";
const text = (language: string, en: string, th: string) =>
  language === "th" ? th : en;
const statusLabel = (status: string, language: string) => {
  const values: Record<string, [string, string]> = {
    AVAILABLE: ["Available", "พร้อมขาย"],
    RESERVED: ["Reserved", "จองแล้ว"],
    SOLD: ["Sold", "ขายแล้ว"],
    NOT_AVAILABLE: ["Not available", "ไม่พร้อมขาย"],
  };
  return text(
    language,
    ...(values[status] ?? ["Unavailable", "ไม่พร้อมใช้งาน"]),
  );
};
const money = (value: number, language: string) =>
  new Intl.NumberFormat(language === "th" ? "th-TH" : "en-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2,
  }).format(value);
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
    return allowed.includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
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
    : "";
  const logo = `<span class="brand"><span class="brand-mark">C</span><span>COREVITY<small>${htmlEscape(text(args.language ?? "en", "FITNESS EQUIPMENT", "อุปกรณ์ฟิตเนส"))}</small></span></span>`;
  const html = `<!doctype html><html lang="${args.language ?? "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0d1b2e"><title>${title}</title><meta name="description" content="${description}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${attr(`${base}${url.pathname}${url.search}`)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}">${image}<style>
*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#202a39;font:15px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration:none}button,input,select{font:inherit}.shell{max-width:1180px;margin:auto;padding:0 22px}.top{background:#fff;border-bottom:1px solid #dce5ef}.top-inner{min-height:74px;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{display:flex;align-items:center;gap:10px;color:#172a45;font-weight:800;letter-spacing:1.4px}.brand small{display:block;font-size:9px;letter-spacing:1.5px;color:#73859d}.brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:#1769d2;color:white;font-size:20px;font-weight:800}.top-actions,.actions,.share-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.top-actions a,.button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:40px;padding:8px 13px;border:1px solid #dce5ef;border-radius:9px;background:#fff;font-size:13px;font-weight:650}.button.primary{background:#1769d2;border-color:#1769d2;color:white}.hero{padding:42px 0 22px}.eyebrow{margin:0 0 6px;color:#1769d2;font-size:11px;font-weight:750;letter-spacing:1.5px;text-transform:uppercase}.hero h1{margin:0;color:#172a45;font-size:clamp(28px,5vw,44px);line-height:1.15;letter-spacing:-1.2px}.hero p{max-width:700px;margin:12px 0 0;color:#657993}.filters{display:grid;grid-template-columns:minmax(220px,2fr) repeat(3,minmax(140px,1fr)) auto;gap:9px;padding:14px;border:1px solid #dce5ef;border-radius:14px;background:#fff}.filters input,.filters select{width:100%;min-width:0;min-height:42px;padding:9px 11px;border:1px solid #dce5ef;border-radius:8px;background:#fff;color:#202a39}.filters button{min-height:42px;padding:8px 15px;border:0;border-radius:8px;background:#1769d2;color:#fff;font-weight:700}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:18px 0 32px}.card{overflow:hidden;border:1px solid #dce5ef;border-radius:13px;background:#fff;box-shadow:0 4px 15px #1422380b;transition:transform .15s,box-shadow .15s}.card:hover{transform:translateY(-2px);box-shadow:0 8px 24px #14223818}.photo{position:relative;display:grid;place-items:center;aspect-ratio:4/3;background:#e8eef6;color:#71839b}.photo img{width:100%;height:100%;object-fit:cover}.card-body{padding:15px}.meta{display:flex;gap:7px;flex-wrap:wrap;color:#657993;font-size:11px}.pill{display:inline-flex;padding:4px 9px;border-radius:999px;background:#eaf2fc;color:#245b9f;font-size:11px;font-weight:700}.pill.available{background:#dcfce8;color:#17673c}.pill.reserved{background:#fff1cb;color:#8e5b00}.pill.sold{background:#fee2e2;color:#a22b2b}.pill.not_available{background:#fee2e2;color:#a22b2b}.card h2{margin:8px 0 4px;font-size:17px;line-height:1.35}.price{margin:11px 0;color:#1458ad;font-size:20px;font-weight:800}.muted{color:#6d7e93;font-size:13px}.detail{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:25px;margin:27px 0 42px}.gallery-main{overflow:hidden;aspect-ratio:4/3;border-radius:14px;background:#e8eef6}.gallery-main img{width:100%;height:100%;object-fit:contain}.thumbs{display:flex;gap:9px;margin-top:9px;overflow:auto}.thumbs img{width:75px;height:62px;object-fit:cover;border:1px solid #dce5ef;border-radius:8px}.detail-copy{padding:8px 0}.detail-copy h1{margin:8px 0;font-size:clamp(27px,4vw,38px);line-height:1.2}.detail-copy .price{font-size:25px}.description{white-space:pre-wrap;color:#52677f}.facts{display:flex;gap:8px;flex-wrap:wrap;margin:17px 0}.contact{display:flex;gap:9px;flex-wrap:wrap;margin:20px 0}.contact a,.contact button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:10px 14px;border:0;border-radius:9px;background:#1769d2;color:#fff;font-weight:700;cursor:pointer}.contact a.secondary,.contact button.secondary{border:1px solid #dce5ef;background:#fff;color:#24415f}.share-row{margin-top:13px}.share-row a,.share-row button{border:0;background:transparent;color:#2463a9;font-weight:650;cursor:pointer}.notice{margin-top:10px;color:#17673c;font-size:13px}.empty{padding:40px;border:1px dashed #b9c8da;border-radius:13px;text-align:center;color:#6d7e93}.pagination{display:flex;justify-content:center;gap:12px;margin:25px 0 40px}.pagination a{padding:9px 13px;border:1px solid #dce5ef;border-radius:8px;background:#fff}.catalog-info{padding:20px;border:1px solid #dce5ef;border-radius:13px;background:#fff}.footer{margin-top:36px;padding:24px 0;border-top:1px solid #dce5ef;color:#71839b;font-size:12px}.footer-inner{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.hidden{display:none!important}@media(max-width:900px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.filters input{grid-column:1/-1}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.shell{padding:0 14px}.top-inner{min-height:62px}.brand-mark{width:34px;height:34px}.top-actions .optional{display:none}.hero{padding:29px 0 18px}.filters{grid-template-columns:minmax(0,1fr);padding:11px}.filters input{grid-column:auto}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}.card-body{padding:10px}.card h2{font-size:14px}.price{font-size:16px}.pill{font-size:10px;padding:3px 7px}.detail{grid-template-columns:1fr;gap:12px;margin-top:18px}.detail-copy{padding:0}.detail-copy h1{font-size:28px}.contact>*{flex:1}.catalog-info{padding:15px}}
</style></head><body><header class="top"><div class="shell top-inner">${logo}<nav class="top-actions"><a class="optional" href="${attr(`${url.pathname}?lang=th`)}">ไทย</a><a class="optional" href="${attr(`${url.pathname}?lang=en`)}">EN</a></nav></div></header><main class="shell">${args.content}</main><footer class="footer"><div class="shell footer-inner"><span>${htmlEscape(text(args.language ?? "en", "Corevity · Commercial fitness equipment", "Corevity · อุปกรณ์ฟิตเนสเชิงพาณิชย์"))}</span><span>${htmlEscape(text(args.language ?? "en", "Availability may change. Contact our team to confirm.", "สถานะสินค้าอาจเปลี่ยนแปลง กรุณาติดต่อทีมงานเพื่อยืนยัน"))}</span></div></footer><script>
document.querySelectorAll('[data-share]').forEach(b=>b.addEventListener('click',async()=>{const d={title:document.title,text:b.dataset.share,url:location.href};try{if(navigator.share)await navigator.share(d);else{await navigator.clipboard.writeText(location.href);b.textContent='Copied'}}catch{}}));document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='Copied'}catch{}}));
</script></body></html>`;
  return new Response(html, {
    status: args.status ?? 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control":
        "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}
async function logEvent(
  database: D1Database,
  entityType: "CATALOG" | "PRODUCT" | "PUBLIC",
  entitySlug: string,
  eventType: "PAGE_VIEW" | "PRODUCT_VIEW" | "CONTACT_CLICK",
) {
  const hour = new Date().toISOString().slice(0, 13) + ":00:00Z";
  await database
    .prepare(
      `INSERT INTO catalog_events(entity_type,entity_slug,event_type,hour,count) VALUES(?,?,?,?,1)
       ON CONFLICT(entity_type,entity_slug,event_type,hour) DO UPDATE SET count=count+1`,
    )
    .bind(entityType, entitySlug, eventType, hour)
    .run();
}
const slugPart = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 54) || "equipment";
const publicProductSlug = (item: CatalogItemRow) =>
  `${slugPart(item.product_name_snapshot)}-${item.id}`;
const catalogImagePath = (slug: string, itemId: string, position: number) =>
  `/media/catalogs/${encodeURIComponent(slug)}/items/${encodeURIComponent(itemId)}/${position}`;

async function getCatalog(database: D1Database, slug: string) {
  const catalog = await database
    .prepare(
      "SELECT id,title,description,slug,status,show_prices,show_sold,expires_at FROM catalogs WHERE slug=?",
    )
    .bind(slug)
    .first<CatalogRow>();
  return activeCatalog(catalog) ? catalog : null;
}
async function catalogItems(database: D1Database, catalog: CatalogRow) {
  const { results } = await database
    .prepare(
      `SELECT i.id,i.product_id,i.product_name_snapshot,i.brand_snapshot,i.model_snapshot,i.category_snapshot,
        i.condition_snapshot,i.description_snapshot,i.image_key_snapshot,i.image_mime_snapshot,i.display_price,
        p.public_slug AS product_slug,p.status,p.sku
       FROM catalog_items i JOIN products p ON p.id=i.product_id
       WHERE i.catalog_id=? AND p.archived_at IS NULL
         AND (?=1 OR p.status!='SOLD')
       ORDER BY i.sort_order LIMIT 100`,
    )
    .bind(catalog.id, catalog.show_sold)
    .all<CatalogItemRow>();
  return results;
}
function contactLinks(
  companyInfo: Company | null,
  slug: string,
  name: string,
  sku: string,
  language: string,
  base: string,
  productSlug?: string,
) {
  const url = productSlug
    ? `${base}/s/${slug}/p/${productSlug}`
    : `${base}/s/${slug}`;
  const productLine = sku ? `${name}\nSKU: ${sku}\n` : `${name}\n`;
  const message = `${productLine}\n${url}`;
  const phone = companyInfo?.phone.replace(/[^+\d]/g, "") ?? "";
  const contactBase = `/contact/catalog/${encodeURIComponent(slug)}`;
  const contactHref = (channel: string) =>
    `${contactBase}/${channel}${productSlug ? `?product=${encodeURIComponent(productSlug)}` : ""}`;
  const trackedLinks = [
    companyInfo?.line_url
      ? `<a href="${contactHref("line")}">${htmlEscape(text(language, "Contact via LINE", "ติดต่อทาง LINE"))}</a>`
      : "",
    companyInfo?.facebook_url
      ? `<a href="${contactHref("facebook")}" class="secondary">${htmlEscape(text(language, "Message on Facebook", "ส่งข้อความทาง Facebook"))}</a>`
      : "",
    phone
      ? `<a href="${contactHref("phone")}" class="secondary">${htmlEscape(text(language, "Call us", "โทรหาเรา"))}</a>`
      : "",
    companyInfo?.email
      ? `<a href="${contactHref("email")}" class="secondary">${htmlEscape(text(language, "Email", "อีเมล"))}</a>`
      : "",
  ].filter(Boolean);
  return `<div class="contact">${trackedLinks.join("") || `<span class="muted">${htmlEscape(text(language, "Contact details are being updated.", "กำลังอัปเดตข้อมูลติดต่อ"))}</span>`}</div><div class="share-row"><button data-share="${attr(message)}">${htmlEscape(text(language, "Share", "แชร์"))}</button><a href="https://line.me/R/share?text=${encodeURIComponent(`${name} ${url}`)}" target="_blank" rel="noopener noreferrer">${htmlEscape(text(language, "Share to LINE", "แชร์ไป LINE"))}</a><a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">Facebook</a><button data-copy="${attr(message)}">${htmlEscape(text(language, "Copy inquiry details", "คัดลอกรายละเอียดสอบถาม"))}</button></div>`;
}

app.get("/s/:slug/p/:itemSlug", async (c) => {
  const slug = c.req.param("slug");
  const itemSlug = c.req.param("itemSlug");
  const language = localeOf(c.req.raw);
  const catalog = await getCatalog(c.env.DB, slug);
  if (!catalog) return c.notFound();
  const items = await catalogItems(c.env.DB, catalog);
  const item = items.find(
    (row) =>
      publicProductSlug(row) === itemSlug || row.product_slug === itemSlug,
  );
  if (!item) return c.redirect(`/s/${encodeURIComponent(slug)}`, 302);
  await logEvent(c.env.DB, "CATALOG", slug, "PRODUCT_VIEW");
  const companyInfo = await company(c.env.DB);
  const base = baseUrl(c.req.raw, c.env);
  const photo = item.image_key_snapshot
    ? catalogImagePath(slug, item.id, 0)
    : "";
  const description = item.description_snapshot;
  const price = catalog.show_prices
    ? `<div class="price">${htmlEscape(money(item.display_price ?? 0, language))}</div>`
    : `<div class="price muted">${htmlEscape(text(language, "Contact for price", "สอบถามราคา"))}</div>`;
  const content = `<a class="button" href="/s/${encodeURIComponent(slug)}">← ${htmlEscape(text(language, "Back to collection", "กลับไปแคตตาล็อกนี้"))}</a><section class="detail"><div class="gallery-main">${photo ? `<img src="${photo}" alt="${attr(item.product_name_snapshot)}">` : ""}</div><div class="detail-copy"><p class="eyebrow">${htmlEscape(item.brand_snapshot)}</p><h1>${htmlEscape(item.product_name_snapshot)}</h1><div class="muted">${htmlEscape(text(language, `SKU: ${item.sku}`, `รหัสสินค้า: ${item.sku}`))}</div><div class="facts"><span class="pill">${htmlEscape(item.category_snapshot)}</span><span class="pill">${htmlEscape(item.condition_snapshot)}</span><span class="pill ${item.status.toLowerCase()}">${htmlEscape(statusLabel(item.status, language))}</span></div>${price}${description ? `<div class="description">${htmlEscape(description)}</div>` : ""}${contactLinks(companyInfo, slug, item.product_name_snapshot, item.sku, language, base, publicProductSlug(item))}</div></section>`;
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

app.get("/s/:slug/p/:itemSlug/contact", (c) =>
  c.redirect(
    `/s/${encodeURIComponent(c.req.param("slug"))}/p/${encodeURIComponent(c.req.param("itemSlug"))}`,
    302,
  ),
);
app.get("/s/:slug", async (c) => {
  const slug = c.req.param("slug");
  const language = localeOf(c.req.raw);
  const catalog = await getCatalog(c.env.DB, slug);
  if (!catalog)
    return pageHtml({
      request: c.req.raw,
      env: c.env,
      title: "Collection unavailable",
      description: "This collection is unavailable.",
      content: `<div class="empty"><h1>${htmlEscape(text(language, "Collection unavailable", "ไม่พบแคตตาล็อก"))}</h1><p>${htmlEscape(text(language, "This link may have expired or been archived.", "ลิงก์นี้อาจหมดอายุหรือถูกเก็บถาวรแล้ว"))}</p></div>`,
      language,
      status: 404,
    });
  const items = await catalogItems(c.env.DB, catalog);
  const companyInfo = await company(c.env.DB);
  await logEvent(c.env.DB, "CATALOG", slug, "PAGE_VIEW");
  const base = baseUrl(c.req.raw, c.env);
  const cards = items
    .map((item) => {
      const imageUrl = item.image_key_snapshot
        ? catalogImagePath(slug, item.id, 0)
        : "";
      const price = catalog.show_prices
        ? `<div class="price">${htmlEscape(money(item.display_price ?? 0, language))}</div>`
        : `<div class="price muted">${htmlEscape(text(language, "Contact for price", "สอบถามราคา"))}</div>`;
      const target = `/s/${encodeURIComponent(slug)}/p/${encodeURIComponent(publicProductSlug(item))}`;
      return `<article class="card"><a href="${target}"><div class="photo">${imageUrl ? `<img src="${imageUrl}" alt="${attr(item.product_name_snapshot)}" loading="lazy">` : `<span>${htmlEscape(text(language, "Photo coming soon", "ยังไม่มีรูปสินค้า"))}</span>`}</div><div class="card-body"><div class="meta"><span class="pill">${htmlEscape(item.category_snapshot)}</span><span class="pill ${item.status.toLowerCase()}">${htmlEscape(statusLabel(item.status, language))}</span></div><h2>${htmlEscape(item.product_name_snapshot)}</h2><div class="muted">${htmlEscape(item.condition_snapshot)}</div>${price}<span class="button primary">${htmlEscape(text(language, "View details", "ดูรายละเอียด"))}</span></div></a></article>`;
    })
    .join("");
  const companyName =
    language === "th"
      ? companyInfo?.company_name_th ||
        companyInfo?.company_name_en ||
        "Corevity"
      : companyInfo?.company_name_en ||
        companyInfo?.company_name_th ||
        "Corevity";
  const logo = companyInfo?.logo_key
    ? `<img src="/media/company-logo" alt="${attr(companyName)}" style="max-width:110px;max-height:64px;object-fit:contain">`
    : "";
  const content = `<section class="hero"><p class="eyebrow">${htmlEscape(companyName)}</p><h1>${htmlEscape(catalog.title)}</h1>${catalog.description ? `<p>${htmlEscape(catalog.description)}</p>` : ""}<div>${logo}</div></section>${items.length ? `<section class="grid">${cards}</section>` : `<div class="empty">${htmlEscape(text(language, "No products are currently available in this collection.", "ไม่มีสินค้าในแคตตาล็อกนี้ในขณะนี้"))}</div>`}${contactLinks(companyInfo, slug, catalog.title, "", language, base)}`;
  const featured = items[0]?.image_key_snapshot
    ? `${base}${catalogImagePath(slug, items[0].id, 0)}`
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

app.get("/contact/:kind/:slug/:channel", async (c) => {
  const kind = c.req.param("kind");
  const slug = c.req.param("slug");
  const channel = c.req.param("channel");
  if (
    kind !== "catalog" ||
    !["line", "facebook", "phone", "email"].includes(channel)
  )
    return c.text("Not found", 404);
  const catalog = await getCatalog(c.env.DB, slug);
  if (!catalog) return c.text("Not found", 404);
  const requestedItem = c.req.query("product");
  const items = requestedItem ? await catalogItems(c.env.DB, catalog) : [];
  const item = items.find(
    (entry) =>
      publicProductSlug(entry) === requestedItem ||
      entry.product_slug === requestedItem,
  );
  if (requestedItem && !item) return c.text("Not found", 404);
  await logEvent(c.env.DB, "CATALOG", slug, "CONTACT_CLICK");
  const companyInfo = await company(c.env.DB);
  const base = baseUrl(c.req.raw, c.env);
  const recordName = item?.product_name_snapshot ?? catalog.title;
  const recordSku = item?.sku ?? "";
  const recordLink = item
    ? `${base}/s/${encodeURIComponent(slug)}/p/${encodeURIComponent(publicProductSlug(item))}`
    : `${base}/s/${encodeURIComponent(slug)}`;
  const contactMessage = `${recordName}${recordSku ? `\nSKU: ${recordSku}` : ""}\n${recordLink}`;
  let target = "";
  if (channel === "line" && companyInfo?.line_url) {
    target = safeExternalUrl(companyInfo.line_url, ["https:"]);
    if (target && /line\.me\/r\/oamessage\//i.test(target)) {
      const destination = new URL(target);
      destination.searchParams.set("text", contactMessage);
      target = destination.toString();
    }
  } else if (channel === "facebook" && companyInfo?.facebook_url)
    target = safeExternalUrl(companyInfo.facebook_url, ["https:"]);
  else if (channel === "phone" && companyInfo?.phone)
    target = `tel:${companyInfo.phone.replace(/[^+\d]/g, "")}`;
  else if (channel === "email" && companyInfo?.email)
    target = `mailto:${companyInfo.email}?subject=${encodeURIComponent(recordName)}&body=${encodeURIComponent(contactMessage)}`;
  return target ? c.redirect(target, 302) : c.redirect(recordLink, 302);
});

app.get("/media/company-logo", async (c) => {
  const companyInfo = await company(c.env.DB);
  if (!companyInfo?.logo_key) return c.notFound();
  const object = await c.env.PRODUCT_IMAGES.get(companyInfo.logo_key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/png",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
app.get("/media/catalogs/:slug/items/:itemId/:position", async (c) => {
  const catalog = await getCatalog(c.env.DB, c.req.param("slug"));
  if (!catalog) return c.notFound();
  const position = Number(c.req.param("position"));
  if (!Number.isInteger(position) || position !== 0) return c.notFound();
  const item = await c.env.DB.prepare(
    `SELECT i.image_key_snapshot AS r2_key,i.image_mime_snapshot AS mime_type
     FROM catalog_items i JOIN products p ON p.id=i.product_id
     WHERE i.catalog_id=? AND i.id=? AND p.archived_at IS NULL
       AND (?=1 OR p.status!='SOLD')`,
  )
    .bind(catalog.id, c.req.param("itemId"), catalog.show_sold)
    .first<{ r2_key: string; mime_type: string }>();
  if (!item?.r2_key) return c.notFound();
  const object = await c.env.PRODUCT_IMAGES.get(item.r2_key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      "Content-Type":
        item.mime_type || object.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
app.get("/media/catalogs/:slug/:position", async (c) => {
  const catalog = await getCatalog(c.env.DB, c.req.param("slug"));
  if (!catalog) return c.notFound();
  const position = Number(c.req.param("position"));
  if (!Number.isInteger(position) || position < 0 || position > 99)
    return c.notFound();
  const item = await c.env.DB.prepare(
    `SELECT i.image_key_snapshot AS r2_key,i.image_mime_snapshot AS mime_type
     FROM catalog_items i JOIN products p ON p.id=i.product_id
     WHERE i.catalog_id=? AND p.archived_at IS NULL AND (?=1 OR p.status!='SOLD')
     ORDER BY i.sort_order LIMIT 1 OFFSET ?`,
  )
    .bind(catalog.id, catalog.show_sold, position)
    .first<{ r2_key: string; mime_type: string }>();
  if (!item?.r2_key) return c.notFound();
  const object = await c.env.PRODUCT_IMAGES.get(item.r2_key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      "Content-Type":
        item.mime_type || object.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

app.get("/api/public/catalogs/:slug", async (c) => {
  const catalog = await getCatalog(c.env.DB, c.req.param("slug"));
  if (!catalog) return c.json({ error: "Catalog not found." }, 404);
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
        itemId: item.id,
        slug: publicProductSlug(item),
        brand: item.brand_snapshot,
        model: item.model_snapshot,
        category: item.category_snapshot,
        condition: item.condition_snapshot,
        availability: item.status,
        description: item.description_snapshot,
        imageUrl: item.image_key_snapshot
          ? catalogImagePath(c.req.param("slug"), item.id, 0)
          : null,
        ...(catalog.show_prices ? { price: item.display_price } : {}),
      })),
    },
    200,
    {
      "Cache-Control":
        "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
    },
  );
});
app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));
app.notFound((c) =>
  c.text("Not found", 404, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }),
);
app.onError((error) => {
  console.error(
    JSON.stringify({ event: "public_catalog_error", type: error.name }),
  );
  return new Response("The catalog is temporarily unavailable.", {
    status: 500,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
});

export default {
  fetch(request: Request, env: PublicBindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
};
