import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { privateCatalogEbookStyles, privateCatalogEbookToolbar, privateCatalogEbookScript, privateCatalogEbookPaperStart, privateCatalogEbookPaperEnd } from './private-catalog-ebook';
import { privateCatalogProduct, privateCatalogDescription, privateCatalogMasthead, privateCatalogStyles } from './private-catalog-layout';

type PublicBindings = Pick<Env, 'DB' | 'PRODUCT_IMAGES'> & {
  PUBLIC_CATALOG_BASE_URL?: string;
  CATALOG_CHAT_INTERNAL_SECRET?: string;
  MANAGEMENT?: Fetcher;
};
type PublicEnv = { Bindings: PublicBindings };
type PublicContext = Context<PublicEnv>;
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
  target_body_part: string;
  category: string;
  condition: string;
  status: string;
  public_slug: string;
  public_description_th: string;
  public_description_en: string;
  description_th: string;
  description_en: string;
  short_description: string;
  catalog_detail: string;
  created_at: string;
};
type CatalogRow = {
  id: string;
  title: string;
  description: string;
  slug: string;
  status: string;
  show_sold: number;
  show_price_private: number;
  show_price_web: number;
  expires_at: string | null;
  created_by: string;
  assigned_salesperson_email: string;
  publish_to_web: number;
  cover_image_key: string | null;
  cover_image_mime: string;
};
type CatalogItemRow = {
  id: string;
  product_id: string;
  product_slug: string;
  product_name_snapshot: string;
  brand_snapshot: string;
  model_snapshot: string;
  target_body_part: string;
  category_snapshot: string;
  condition_snapshot: string;
  description_snapshot: string;
  description_th: string;
  description_en: string;
  short_description: string;
  image_key_snapshot: string;
  image_mime_snapshot: string;
  image_revision: string | null;
  status: string;
  sku: string;
  catalog_detail: string;
  display_price: number | null;
};
const app = new Hono<PublicEnv>();
app.use('*', async (c, next) => {
  if (!c.req.path.startsWith('/api/public/chat')) return next();
  const origin = c.req.header('Origin');
  const allowed = origin === 'https://corevityusedgym.com' || origin === 'https://www.corevityusedgym.com' || origin === 'http://localhost:3000';
  if (origin && !allowed && origin !== new URL(c.req.url).origin)
    return c.json({error: 'Origin not allowed.'}, 403);
  if (allowed) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Max-Age', '600');
  }
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});
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
const digest = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
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
const publicDescription = (product: ProductRow, language: string) =>
  product.catalog_detail ||
  (language === 'th'
    ? product.description_th
    : product.description_en) ||
  product.short_description ||
  '';
function productMetadataMarkup(
  product: {
    brand: string;
    model: string;
    specification: string;
    status: string;
  },
  language: string,
  className: string,
) {
  const missing = text(language, 'Not specified', 'ไม่ระบุ');
  const fields: Array<[string, string]> = className === 'catalog-product-facts'
    ? [['Brand', [product.brand, product.model, product.specification].filter(Boolean).join(' · ')]]
    : [
        ['Brand', product.brand],
        ['Model', product.model],
        ['Specification', product.specification],
      ];
  const localizedLabels: Record<string, string> = {
    Brand: 'แบรนด์',
    Model: 'รุ่น',
    Specification: 'สเปก',
  };
  return `<dl class="${className}">${fields
    .map(
      ([label, value]) =>
        `<div><dt>${htmlEscape(text(language, label, localizedLabels[label] ?? label))}</dt><dd>${htmlEscape(value || missing)}</dd></div>`,
    )
    .join('')}<div><dt>${htmlEscape(text(language, 'Status', 'สถานะ'))}</dt><dd><span class="pill ${product.status.toLowerCase()}">${htmlEscape(statusLabel(product.status, language))}</span></dd></div></dl>`;
}
function productCardMarkup(args: {
  href: string;
  imageUrl: string;
  imageAlt: string;
  brand: string;
  model: string;
  specification: string;
  status: string;
  language: string;
}) {
  const photo = args.imageUrl
    ? `<img src="${attr(args.imageUrl)}" alt="${attr(args.imageAlt)}" loading="lazy">`
    : `<span>${htmlEscape(text(args.language, 'Photo coming soon', 'ยังไม่มีรูปสินค้า'))}</span>`;
  return `<article class="card catalog-product-card"><a class="catalog-product-link" href="${attr(args.href)}"><div class="catalog-product-photo">${photo}</div><div class="catalog-product-body">${productMetadataMarkup(args, args.language, 'catalog-product-facts')}<span class="button primary">${htmlEscape(text(args.language, 'View details', 'ดูรายละเอียด'))}</span></div></a></article>`;
}
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
function catalogChatWidget(language: string, context: { catalogSlug?: string; productSlug?: string } = {}) {
  const labels = language === 'th'
    ? { button: 'แชทกับเซล', title: 'สอบถามสินค้า', intro: 'กรอกชื่อและเบอร์โทรก่อนเริ่มแชท', name: 'ชื่อ-นามสกุล *', phone: 'เบอร์โทรศัพท์ *', placeholder: 'พิมพ์ข้อความที่ต้องการสอบถาม…', send: 'ส่งข้อความ', attach: 'แนบสินค้า', search: 'ค้นหาสินค้าในแคตตาล็อก', empty: 'ยังไม่มีข้อความ เริ่มสอบถามสินค้าได้เลย', failed: 'ส่งข้อความไม่สำเร็จ กรุณาลองอีกครั้ง', close: 'ปิดแชท', add: 'แนบ', sending: 'กำลังส่ง…', attached: 'สินค้าที่แนบ', newReplies: 'มีข้อความตอบกลับใหม่ {count} ข้อความ' }
    : { button: 'Chat with sales', title: 'Ask about equipment', intro: 'Enter your name and phone number to start', name: 'Full name *', phone: 'Phone number *', placeholder: 'Type your question…', send: 'Send message', attach: 'Attach equipment', search: 'Search this catalog', empty: 'No messages yet. Ask us about this equipment.', failed: 'Could not send. Please try again.', close: 'Close chat', add: 'Attach', sending: 'Sending…', attached: 'Attached equipment', newReplies: '{count} new replies' };
  return `<style>
.catalog-chat-fab{position:fixed;right:22px;bottom:22px;z-index:1000;display:flex;align-items:center;gap:9px;min-height:54px;padding:0 19px;border:0;border-radius:999px;background:#1769d2;color:#fff;box-shadow:0 10px 30px #0d274655;font-family:inherit;font-size:14px;font-weight:700;line-height:1.2;cursor:pointer}.catalog-chat-fab svg{width:21px;height:21px}.catalog-chat-badge{position:absolute;top:-5px;right:-5px;display:grid;min-width:21px;height:21px;place-items:center;padding:0 5px;border:2px solid #fff;border-radius:999px;background:#e11d48;color:#fff;font-size:10px;font-weight:800;line-height:1}.catalog-chat-badge[hidden]{display:none}.catalog-chat-window{position:fixed;right:22px;bottom:88px;z-index:1001;display:none;flex-direction:column;width:min(390px,calc(100vw - 28px));height:min(560px,calc(100dvh - 115px));overflow:hidden;border:1px solid #dce5ef;border-radius:18px;background:#fff;box-shadow:0 18px 55px #10243d38;color:#202a39}.catalog-chat-window.open{display:flex}.catalog-chat-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:15px 17px;background:#102b4b;color:#fff}.catalog-chat-head strong,.catalog-chat-head small{display:block}.catalog-chat-head small{margin-top:2px;color:#c1d2e8;font-size:12px}.catalog-chat-close{display:grid;place-items:center;width:35px;height:35px;border:0;border-radius:9px;background:#ffffff1c;color:#fff;font-size:22px;cursor:pointer}.catalog-chat-messages{display:flex;flex:1;flex-direction:column;gap:10px;overflow:auto;padding:15px;background:#f4f7fb}.catalog-chat-empty{margin:auto;color:#71839b;text-align:center;font-size:13px}.catalog-chat-message{max-width:88%;align-self:flex-start;padding:10px 12px;border-radius:14px 14px 14px 4px;background:#fff;box-shadow:0 1px 4px #14223812;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}.catalog-chat-message.visitor{align-self:flex-end;border-radius:14px 14px 4px 14px;background:#1769d2;color:#fff}.catalog-chat-message time{display:block;margin-top:5px;opacity:.65;font-size:10px}.catalog-chat-products{display:grid;gap:4px;margin-top:7px;font-size:12px}.catalog-chat-products a{color:#1769d2;text-decoration:underline}.catalog-chat-message.visitor .catalog-chat-products a{color:#fff}.catalog-chat-compose{padding:10px 12px;border-top:1px solid #e2e8f0;background:#fff}.catalog-chat-field{width:100%;margin-bottom:8px;padding:9px 10px;border:1px solid #dce5ef;border-radius:8px;color:#202a39;font-size:13px}.catalog-chat-compose textarea,.catalog-chat-search{width:100%;min-height:72px;resize:vertical;padding:10px;border:1px solid #dce5ef;border-radius:10px;background:#fff;color:#202a39;font-family:inherit;font-size:14px;line-height:1.45;outline-color:#1769d2}.catalog-chat-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}.catalog-chat-actions button,.catalog-chat-send{min-height:38px;padding:8px 11px;border:1px solid #dce5ef;border-radius:9px;background:#fff;color:#24415f;font-family:inherit;font-size:12px;font-weight:650;line-height:1.2;cursor:pointer}.catalog-chat-actions .catalog-chat-send{border-color:#1769d2;background:#1769d2;color:#fff}.catalog-chat-actions button:disabled{opacity:.55;cursor:default}.catalog-chat-error{margin:6px 0 0;color:#b42318;font-size:12px}.catalog-chat-picker{display:none;max-height:190px;overflow:auto;padding:10px 12px;border-top:1px solid #e2e8f0;background:#fff}.catalog-chat-picker.open{display:block}.catalog-chat-search{min-height:38px;resize:none}.catalog-chat-product-result{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;padding:8px;border:1px solid #e2e8f0;border-radius:8px;background:white;color:#202a39;text-align:left;font-size:12px;cursor:pointer}.catalog-chat-product-result small{display:block;color:#71839b}.catalog-chat-selected{display:flex;gap:6px;overflow:auto;margin-top:8px}.catalog-chat-chip{flex:none;padding:4px 8px;border-radius:99px;background:#eaf2fc;color:#245b9f;font-size:11px}@media(max-width:600px){.catalog-chat-fab{right:14px;bottom:14px;min-height:50px;padding:0 15px}.catalog-chat-window{right:10px;bottom:74px;width:calc(100vw - 20px);height:min(570px,calc(100dvh - 90px))}}
</style><div id="catalog-chat-root" data-catalog-slug="${attr(context.catalogSlug ?? '')}" data-product-slug="${attr(context.productSlug ?? '')}"><button type="button" class="catalog-chat-fab" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></svg><span>${htmlEscape(labels.button)}</span><span class="catalog-chat-badge" aria-live="polite" hidden></span></button><section class="catalog-chat-window" role="dialog" aria-label="${attr(labels.title)}" aria-modal="false"><header class="catalog-chat-head"><div><strong>${htmlEscape(labels.title)}</strong><small>${htmlEscape(labels.intro)}</small></div><button type="button" class="catalog-chat-close" aria-label="${attr(labels.close)}">×</button></header><div class="catalog-chat-messages" aria-live="polite"></div><div class="catalog-chat-picker"><input class="catalog-chat-search" type="search" placeholder="${attr(labels.search)}"><div class="catalog-chat-product-results"></div></div><form class="catalog-chat-compose"><input class="catalog-chat-field catalog-chat-name" name="visitorName" aria-label="${attr(labels.name)}" autocomplete="name" maxlength="80" placeholder="${attr(labels.name)}" required><input class="catalog-chat-field catalog-chat-phone" name="visitorPhone" aria-label="${attr(labels.phone)}" type="tel" inputmode="tel" autocomplete="tel" maxlength="32" placeholder="${attr(labels.phone)}" required><div class="catalog-chat-selected"></div><textarea maxlength="2000" placeholder="${attr(labels.placeholder)}" required></textarea><div class="catalog-chat-error" role="alert"></div><div class="catalog-chat-actions"><button type="button" class="catalog-chat-attach">＋ ${htmlEscape(labels.attach)}</button><button type="submit" class="catalog-chat-send">${htmlEscape(labels.send)}</button></div></form></section></div><script>
(function(){var root=document.getElementById('catalog-chat-root');if(!root)return;var labels=${JSON.stringify(labels)};var catalogSlug=root.dataset.catalogSlug||'';var productSlug=root.dataset.productSlug||'';var key='corevity-catalog-chat:'+((catalogSlug||location.pathname));var fab=root.querySelector('.catalog-chat-fab');var badge=root.querySelector('.catalog-chat-badge');var panel=root.querySelector('.catalog-chat-window');var close=root.querySelector('.catalog-chat-close');var list=root.querySelector('.catalog-chat-messages');var form=root.querySelector('.catalog-chat-compose');var nameField=root.querySelector('.catalog-chat-name');var phoneField=root.querySelector('.catalog-chat-phone');var textarea=root.querySelector('textarea');var error=root.querySelector('.catalog-chat-error');var picker=root.querySelector('.catalog-chat-picker');var search=root.querySelector('.catalog-chat-search');var results=root.querySelector('.catalog-chat-product-results');var selectedEl=root.querySelector('.catalog-chat-selected');var selected=[];var readKey=key+':read-cursor';var readCursor=0;try{readCursor=Number(localStorage.getItem(readKey)||'0')||0}catch{}var session=null;try{session=JSON.parse(localStorage.getItem(key)||'null');if(session&&!session.visitorPhone){localStorage.removeItem(key);session=null}}catch{}if(productSlug)selected.push({slug:productSlug,label:'Equipment'});function auth(){return session?{'Authorization':'Bearer '+session.token}:{};}function open(){panel.classList.add('open');fab.setAttribute('aria-expanded','true');if(!session&&productSlug)selected=[{slug:productSlug,label:'Equipment'}];drawSelected();loadMessages();}function shut(){panel.classList.remove('open');fab.setAttribute('aria-expanded','false');}fab.addEventListener('click',function(){panel.classList.contains('open')?shut():open()});close.addEventListener('click',shut);document.addEventListener('keydown',function(e){if(e.key==='Escape')shut()});function drawSelected(){selectedEl.textContent='';selected.slice(0,3).forEach(function(p){var chip=document.createElement('span');chip.className='catalog-chat-chip';chip.textContent=p.label;selectedEl.append(chip)})}function drawMessages(messages){list.textContent='';if(!messages.length){var empty=document.createElement('div');empty.className='catalog-chat-empty';empty.textContent=labels.empty;list.append(empty);return}messages.forEach(function(m){var bubble=document.createElement('article');bubble.className='catalog-chat-message '+(m.senderType==='VISITOR'?'visitor':'');var body=document.createElement('div');body.textContent=m.body;bubble.append(body);var products=Array.isArray(m.products)?m.products:[];if(products.length){var group=document.createElement('div');group.className='catalog-chat-products';products.forEach(function(p){var a=document.createElement('a');a.href='/catalog/products/'+encodeURIComponent(p.slug);a.textContent=p.label;group.append(a)});bubble.append(group)}var time=document.createElement('time');time.textContent=new Intl.DateTimeFormat(document.documentElement.lang==='th'?'th-TH':'en-US',{hour:'2-digit',minute:'2-digit'}).format(new Date(m.createdAt));bubble.append(time);list.append(bubble)});list.scrollTop=list.scrollHeight}function updateBadge(messages){var unread=messages.filter(function(m){return m.senderType==='SALESPERSON'&&Number(m.id)>readCursor}).length;if(panel.classList.contains('open')){var latest=messages.reduce(function(max,m){return m.senderType==='SALESPERSON'?Math.max(max,Number(m.id)||0):max},readCursor);if(latest>readCursor){readCursor=latest;try{localStorage.setItem(readKey,String(readCursor))}catch{}}unread=0}badge.hidden=unread===0;badge.textContent=unread>9?'9+':String(unread);badge.setAttribute('aria-label',labels.newReplies.replace('{count}',String(unread)));}async function loadMessages(){if(!session)return;try{var r=await fetch('/api/public/chat/'+encodeURIComponent(session.id),{headers:auth(),cache:'no-store'});if(r.ok){var d=await r.json();var messages=d.messages||[];updateBadge(messages);if(panel.classList.contains('open'))drawMessages(messages)}}catch{}}var poll=window.setInterval(loadMessages,3500);if(session)loadMessages();root.querySelector('.catalog-chat-attach').addEventListener('click',function(){picker.classList.toggle('open');if(picker.classList.contains('open')){search.focus();findProducts()}});var searchTimer;search.addEventListener('input',function(){clearTimeout(searchTimer);searchTimer=setTimeout(findProducts,250)});async function findProducts(){try{var url='/api/public/chat/products?catalog='+encodeURIComponent(catalogSlug)+'&q='+encodeURIComponent(search.value);var r=await fetch(url);if(!r.ok)return;var d=await r.json();results.textContent='';(d.products||[]).forEach(function(p){var b=document.createElement('button');b.type='button';b.className='catalog-chat-product-result';var text=document.createElement('span');text.textContent=p.label;var sub=document.createElement('small');sub.textContent=p.category||'';text.append(sub);var add=document.createElement('strong');add.textContent=labels.add;b.append(text,add);b.disabled=selected.some(function(x){return x.slug===p.slug})||selected.length>=3;b.addEventListener('click',function(){selected.push(p);drawSelected();b.disabled=true});results.append(b)})}catch{}}form.addEventListener('submit',async function(e){e.preventDefault();var body=textarea.value.trim();if(!body)return;var button=form.querySelector('.catalog-chat-send');button.disabled=true;button.textContent=labels.sending;error.textContent='';try{var payload={body:body,catalogSlug:catalogSlug,visitorName:nameField.value.trim(),visitorPhone:phoneField.value.trim(),productSlugs:selected.map(function(p){return p.slug})};var endpoint=session?'/api/public/chat/'+encodeURIComponent(session.id)+'/messages':'/api/public/chat';var response=await fetch(endpoint,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},auth()),body:JSON.stringify(payload)});if(!response.ok)throw new Error('send');var data=await response.json();if(data.session){session=Object.assign(data.session,{visitorName:nameField.value.trim(),visitorPhone:phoneField.value.trim()});try{localStorage.setItem(key,JSON.stringify(session))}catch{}nameField.hidden=true;phoneField.hidden=true}textarea.value='';selected=[];drawSelected();await loadMessages()}catch{error.textContent=labels.failed}finally{button.disabled=false;button.textContent=labels.send}});if(session){nameField.hidden=true;phoneField.hidden=true}})();
</script>`;
}
function pageHtml(args: {
  request: Request;
  env: PublicBindings;
  title: string;
  description: string;
  image?: string;
  content: string;
  language?: string;
  chat?: { catalogSlug?: string; productSlug?: string };
  status?: number;
  privateCatalogTitle?: string;
}) {
  const { request, env } = args;
  const base = baseUrl(request, env);
  const url = new URL(request.url);
  const languageUrl = (language: string) => {
    const target = new URL(url);
    target.searchParams.set('lang', language);
    return `${target.pathname}${target.search}`;
  };
  const title = htmlEscape(args.title);
  const description = htmlEscape(args.description.slice(0, 300));
  const image = args.image
    ? `\n<meta property="og:image" content="${attr(args.image)}">\n<meta name="twitter:image" content="${attr(args.image)}">`
    : '';
  const logo = `<a class="brand" href="/catalog"><span class="brand-mark">C</span><span>COREVITY<small>${htmlEscape(text(args.language ?? 'en', 'FITNESS EQUIPMENT', 'อุปกรณ์ฟิตเนส'))}</small></span></a>`;
  const html = `<!doctype html><html lang="${args.language ?? 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0d1b2e"><title>${title}</title><meta name="description" content="${description}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${attr(`${base}${url.pathname}${url.search}`)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}">${image}<style>
*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#202a39;font:15px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration:none}button,input,select{font:inherit}.shell{max-width:1180px;margin:auto;padding:0 22px}.top{background:#fff;border-bottom:1px solid #dce5ef}.top-inner{min-height:74px;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{display:flex;align-items:center;gap:10px;color:#172a45;font-weight:800;letter-spacing:1.4px}.brand small{display:block;font-size:9px;letter-spacing:1.5px;color:#73859d}.brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:#1769d2;color:white;font-size:20px;font-weight:800}.top-actions,.actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.top-actions a,.button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:40px;padding:8px 13px;border:1px solid #dce5ef;border-radius:9px;background:#fff;font-size:13px;font-weight:650}.button.primary{background:#1769d2;border-color:#1769d2;color:white}.hero{padding:42px 0 22px}.eyebrow{margin:0 0 6px;color:#1769d2;font-size:11px;font-weight:750;letter-spacing:1.5px;text-transform:uppercase}.hero h1{margin:0;color:#172a45;font-size:clamp(28px,5vw,44px);line-height:1.15;letter-spacing:-1.2px}.hero p{max-width:700px;margin:12px 0 0;color:#657993}.filters{display:grid;grid-template-columns:minmax(220px,2fr) repeat(3,minmax(140px,1fr)) auto;gap:9px;padding:14px;border:1px solid #dce5ef;border-radius:14px;background:#fff}.filters input,.filters select{width:100%;min-width:0;min-height:42px;padding:9px 11px;border:1px solid #dce5ef;border-radius:8px;background:#fff;color:#202a39}.filters button{min-height:42px;padding:8px 15px;border:0;border-radius:8px;background:#1769d2;color:#fff;font-weight:700}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:18px 0 32px}.card{overflow:hidden;border:1px solid #dce5ef;border-radius:13px;background:#fff;box-shadow:0 4px 15px #1422380b;transition:transform .15s,box-shadow .15s}.card:hover{transform:translateY(-2px);box-shadow:0 8px 24px #14223818}.photo{position:relative;display:grid;place-items:center;aspect-ratio:4/3;background:#e8eef6;color:#71839b}.photo img{width:100%;height:100%;object-fit:cover}.card-body{padding:15px}.meta{display:flex;gap:7px;flex-wrap:wrap;color:#657993;font-size:11px}.pill{display:inline-flex;padding:4px 9px;border-radius:999px;background:#eaf2fc;color:#245b9f;font-size:11px;font-weight:700}.pill.available{background:#dcfce8;color:#17673c}.pill.reserved{background:#fff1cb;color:#8e5b00}.pill.sold{background:#fee2e2;color:#a22b2b}.pill.not_available{background:#fee2e2;color:#a22b2b}.card h2{margin:8px 0 4px;font-size:17px;line-height:1.35}.price{margin:11px 0;color:#1458ad;font-size:20px;font-weight:800}.muted{color:#6d7e93;font-size:13px}.detail{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:25px;margin:27px 0 42px}.gallery-main{overflow:hidden;aspect-ratio:4/3;border-radius:14px;background:#e8eef6}.gallery-main img{display:block;width:100%;height:100%;object-fit:contain;object-position:center;padding:8px}.thumbs{display:flex;gap:9px;margin-top:9px;overflow:auto}.thumbs img{width:75px;height:62px;object-fit:contain;object-position:center;padding:4px;border:1px solid #dce5ef;border-radius:8px;background:#e8eef6}.detail-copy{padding:8px 0}.detail-copy h1{margin:8px 0;font-size:clamp(27px,4vw,38px);line-height:1.2}.detail-copy .price{font-size:25px}.description{white-space:pre-wrap;color:#52677f}.catalog-detail-identity{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:9px}.catalog-description-card{margin:20px 0 22px;padding:18px;border:1px solid #dce5ef;border-radius:12px;background:#fff}.catalog-description-card h2{margin:0 0 9px;color:#202a39;font-size:16px}.catalog-description-card .description{min-height:24px;line-height:1.7}.facts{display:flex;gap:8px;flex-wrap:wrap;margin:17px 0}.contact{display:flex;gap:9px;flex-wrap:wrap;margin:20px 0}.contact a,.contact button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:10px 14px;border:0;border-radius:9px;background:#1769d2;color:#fff;font-weight:700;cursor:pointer}.contact a.secondary,.contact button.secondary{border:1px solid #dce5ef;background:#fff;color:#24415f}.notice{margin-top:10px;color:#17673c;font-size:13px}.empty{padding:40px;border:1px dashed #b9c8da;border-radius:13px;text-align:center;color:#6d7e93}.pagination{display:flex;justify-content:center;gap:12px;margin:25px 0 40px}.pagination a{padding:9px 13px;border:1px solid #dce5ef;border-radius:8px;background:#fff}.catalog-info{padding:20px;border:1px solid #dce5ef;border-radius:13px;background:#fff}.footer{margin-top:36px;padding:24px 0;border-top:1px solid #dce5ef;color:#71839b;font-size:12px}.footer-inner{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.hidden{display:none!important}@media(max-width:900px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.filters input{grid-column:1/-1}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.shell{padding:0 14px}.top-inner{min-height:62px}.brand-mark{width:34px;height:34px}.top-actions .optional{display:none}.hero{padding:29px 0 18px}.filters{grid-template-columns:minmax(0,1fr);padding:11px}.filters input{grid-column:auto}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}.card-body{padding:10px}.card h2{font-size:14px}.price{font-size:16px}.pill{font-size:10px;padding:3px 7px}.detail{grid-template-columns:1fr;gap:12px;margin-top:18px}.detail-copy{padding:0}.detail-copy h1{font-size:28px}.catalog-description-card{margin:16px 0 19px;padding:14px}.contact>*{flex:1}.catalog-info{padding:15px}}
</style><style>.catalog-category{margin:26px 0 34px}.catalog-category>h2{display:flex;align-items:center;gap:10px;margin:0 0 12px;color:#172a45;font-size:22px}.catalog-category>h2 span{display:grid;place-items:center;min-width:27px;height:27px;padding:0 8px;border-radius:999px;background:#eaf2fc;color:#245b9f;font-size:12px}.catalog-category .card h3{margin:8px 0 4px;font-size:17px;line-height:1.35}.catalog-product-card{display:flex;height:100%;min-width:0}.catalog-product-link{display:flex;flex:1;flex-direction:column;min-width:0}.catalog-product-photo{display:grid;width:100%;aspect-ratio:4/3;place-items:center;overflow:hidden;background:#e8eef6;color:#71839b}.catalog-product-photo img{display:block;width:100%;height:100%;object-fit:contain;object-position:center;padding:8px}.catalog-product-body{display:flex;flex:1;flex-direction:column;row-gap:24px;padding:15px}.catalog-product-facts,.catalog-product-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;margin:0}.catalog-product-facts{grid-template-columns:minmax(0,1fr);gap:8px}.catalog-product-facts>div,.catalog-product-details>div{min-width:0}.catalog-product-facts dt,.catalog-product-details dt{margin-bottom:3px;color:#71839b;font-size:11px;font-weight:650;letter-spacing:.02em}.catalog-product-facts dd,.catalog-product-details dd{margin:0;color:#202a39;font-size:13px;font-weight:650;overflow-wrap:anywhere}.catalog-product-facts .pill,.catalog-product-details .pill{font-size:11px}.catalog-product-body>.button{width:100%;margin-top:auto}.catalog-product-details{margin:18px 0 22px;padding:16px;border:1px solid #dce5ef;border-radius:12px;background:#fff}.catalog-product-details dd{font-size:14px}.catalog-product-details .pill{vertical-align:middle}@media(max-width:600px){.catalog-category>h2{font-size:18px}.catalog-category .card h3{font-size:14px}.catalog-product-body{padding:11px}.catalog-product-facts{grid-template-columns:minmax(0,1fr);gap:8px}.catalog-product-details{gap:10px;padding:13px}.catalog-product-details dd{font-size:13px}}</style>${args.privateCatalogTitle ? `<style>${privateCatalogStyles}${privateCatalogEbookStyles}</style>` : ''}</head><body${args.privateCatalogTitle ? ' class="private-catalog"' : ''}>${args.privateCatalogTitle ? privateCatalogMasthead(args.privateCatalogTitle, languageUrl('th'), languageUrl('en')) : `<header class="top"><div class="shell top-inner">${logo}<nav class="top-actions"><a class="optional" href="${attr(languageUrl('th'))}">ไทย</a><a class="optional" href="${attr(languageUrl('en'))}">EN</a></nav></div></header>`}<main class="shell">${args.content}</main><footer class="footer"><div class="shell footer-inner"><span>${htmlEscape(text(args.language ?? 'en', 'Corevity · Commercial fitness equipment', 'Corevity · อุปกรณ์ฟิตเนสเชิงพาณิชย์'))}</span><span>${htmlEscape(text(args.language ?? 'en', 'Availability may change. Contact our team to confirm.', 'สถานะสินค้าอาจเปลี่ยนแปลง กรุณาติดต่อทีมงานเพื่อยืนยัน'))}</span></div></footer>${args.chat?.catalogSlug ? catalogChatWidget(args.language ?? 'en', args.chat) : ''}${args.privateCatalogTitle ? `<script>${privateCatalogEbookScript}</script>` : ''}<script>
const catalogForm=document.querySelector('#catalog-search-form');if(catalogForm){let searchTimer,searchRequest=0;const updateCatalog=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{const requestId=++searchRequest;const params=new URLSearchParams(new FormData(catalogForm));params.delete('page');const nextUrl='/catalog?'+params.toString();try{const response=await fetch(nextUrl);const parsed=new DOMParser().parseFromString(await response.text(),'text/html');if(requestId!==searchRequest)return;for(const id of ['catalog-result-count','catalog-results','catalog-empty','catalog-pagination']){const current=document.getElementById(id),next=parsed.getElementById(id);if(current&&next)current.replaceWith(next);else if(current)current.remove();else if(next)(document.querySelector('#catalog-results,#catalog-empty')||catalogForm).after(next)}history.replaceState(null,'',nextUrl)}catch{}} ,250)};catalogForm.querySelector('[name="q"]')?.addEventListener('input',updateCatalog);catalogForm.querySelectorAll('select').forEach(select=>select.addEventListener('change',updateCatalog))}
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
) {
  return database
    .prepare(
      `SELECT id,sku,brand,model,target_body_part,category,condition,status,public_slug,
        public_description_th,public_description_en,description_th,description_en,short_description,catalog_detail,created_at
       FROM products WHERE public_slug=? AND is_published=1 AND archived_at IS NULL`,
    )
    .bind(slug)
    .first<ProductRow>();
}
async function getCatalog(database: D1Database, slug: string) {
  const catalog = await database
    .prepare(
      'SELECT id,title,description,slug,status,show_sold,show_price_private,show_price_web,expires_at,created_by,assigned_salesperson_email,publish_to_web,cover_image_key,cover_image_mime FROM catalogs WHERE slug=?',
    )
    .bind(slug)
    .first<CatalogRow>();
  return activeCatalog(catalog) ? catalog : null;
}
async function getWebCatalog(database: D1Database, slug: string) {
  const catalog = await getCatalog(database, slug);
  return catalog?.publish_to_web === 1 ? catalog : null;
}
async function webCatalogs(database: D1Database) {
  const { results } = await database.prepare(
    `SELECT c.slug,c.title,c.description,c.published_to_web_at AS publishedAt,
       substr(c.cover_image_key,16) AS uploadedCoverId,
       cover.id AS coverItemId,cover_image.id AS coverImageRevision
     FROM catalogs c
     LEFT JOIN catalog_items cover ON cover.id=(
       SELECT i.id FROM catalog_items i JOIN products p ON p.id=i.product_id
        WHERE i.catalog_id=c.id AND p.is_published=1 AND p.archived_at IS NULL
          AND (i.image_key_snapshot!='' OR EXISTS(SELECT 1 FROM product_images WHERE product_id=p.id))
          AND (c.show_sold=1 OR p.status!='SOLD')
        ORDER BY i.sort_order LIMIT 1)
     LEFT JOIN product_images cover_image ON cover_image.id=(SELECT id FROM product_images WHERE product_id=cover.product_id ORDER BY is_primary DESC,sort_order LIMIT 1)
     WHERE c.publish_to_web=1 AND c.status='ACTIVE'
       AND (c.expires_at IS NULL OR c.expires_at>?)
     ORDER BY c.web_sort_order IS NULL,c.web_sort_order ASC,c.published_to_web_at DESC,c.slug ASC`,
  ).bind(new Date().toISOString()).all<{slug: string; title: string; description: string; publishedAt: string; uploadedCoverId: string | null; coverItemId: string | null; coverImageRevision: string | null}>();
  return results.map(({uploadedCoverId, coverItemId, coverImageRevision, ...catalog}) => ({
    ...catalog,
    coverImageUrl: uploadedCoverId
      ? `/media/catalogs/${encodeURIComponent(catalog.slug)}/cover?v=${encodeURIComponent(uploadedCoverId)}`
      : coverItemId ? `/media/catalogs/${encodeURIComponent(catalog.slug)}/item/${encodeURIComponent(coverItemId)}?v=${encodeURIComponent(coverImageRevision ?? coverItemId)}` : null,
  }));
}
async function webCatalogResponse(c: PublicContext, catalog: CatalogRow) {
  const items = await catalogItems(c.env.DB, catalog);
  return {
    slug: catalog.slug,
    catalog: { title: catalog.title, description: catalog.description, showPrices: Boolean(catalog.show_price_web), expiresAt: catalog.expires_at },
    products: items.map((item) => ({
      itemId: item.id,
      slug: `${item.product_slug}-catalog-item-${item.id}`,
      productSlug: item.product_slug,
      brand: item.brand_snapshot,
      model: item.model_snapshot,
      category: item.category_snapshot,
      condition: item.condition_snapshot,
      availability: item.status,
      description: item.description_snapshot,
      imageUrl: item.image_key_snapshot ? `/media/catalogs/${encodeURIComponent(catalog.slug)}/item/${encodeURIComponent(item.id)}?v=${encodeURIComponent(item.image_revision ?? item.id)}` : null,
      price: catalog.show_price_web && typeof item.display_price === 'number' ? item.display_price : null,
    })),
  };
}
async function catalogItems(database: D1Database, catalog: CatalogRow) {
  const { results } = await database
    .prepare(
      `SELECT i.id,i.product_id,i.product_name_snapshot,i.brand_snapshot,i.model_snapshot,p.target_body_part,
        i.category_snapshot,
        i.condition_snapshot,i.description_snapshot,i.display_price,p.catalog_detail,
        COALESCE(NULLIF(i.image_key_snapshot,''),current_image.r2_key,'') AS image_key_snapshot,
        CASE WHEN i.image_key_snapshot!='' THEN i.image_mime_snapshot ELSE COALESCE(current_image.mime_type,'') END AS image_mime_snapshot,
        current_image.id AS image_revision,
        p.public_slug AS product_slug,p.status,p.sku,
        p.description_th,p.description_en,p.short_description
       FROM catalog_items i JOIN products p ON p.id=i.product_id
       LEFT JOIN product_images current_image ON current_image.id=(SELECT id FROM product_images WHERE product_id=p.id ORDER BY is_primary DESC,sort_order LIMIT 1)
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
  language: string,
  productSlug?: string,
) {
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
  return trackedLinks.length ? `<div class="contact">${trackedLinks.join('')}</div>` : '';
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
  const sort = 'newest';
  const page = Math.max(
    1,
    Math.min(1000, Number(url.searchParams.get('page')) || 1),
  );
  const filters = ['is_published=1', 'archived_at IS NULL'];
  const values: (string | number)[] = [];
  if (query) {
    filters.push(
      '(brand LIKE ? OR model LIKE ? OR sku LIKE ? OR category LIKE ?)',
    );
    values.push(
      `%${query}%`,
      `%${query}%`,
      `%${query}%`,
      `%${query}%`,
    );
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
  if (['AVAILABLE', 'RESERVED', 'NOT_AVAILABLE', 'SOLD'].includes(availability)) {
    filters.push('status=?');
    values.push(availability);
  }
  const where = filters.join(' AND ');
  const order = 'category COLLATE NOCASE,created_at DESC';
  const [rowsResult, countRow, filtersRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id,sku,brand,model,target_body_part,category,condition,status,public_slug,
        (SELECT id FROM product_images WHERE product_id=products.id ORDER BY is_primary DESC,sort_order LIMIT 1) AS primary_image_id,
        (SELECT COUNT(*) FROM product_images WHERE product_id=products.id) AS image_count
       FROM products WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
      .bind(...values, pageSize, (page - 1) * pageSize)
      .all<ProductRow & { primary_image_id: string | null; image_count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM products WHERE ${where}`)
      .bind(...values)
      .first<{ total: number }>(),
    c.env.DB.prepare(
      `SELECT DISTINCT brand,category,condition FROM products WHERE is_published=1 AND archived_at IS NULL ORDER BY brand,category,condition`,
    ).all<{ brand: string; category: string; condition: string }>(),
  ]);
  await logEvent(c.env.DB, 'PUBLIC', 'catalog', 'PAGE_VIEW');
  const labels = {
    search: text(
      language,
      'Search brand, model, SKU, or category',
      'ค้นหาแบรนด์ รุ่น SKU หรือหมวดหมู่',
    ),
    brand: text(language, 'All brands', 'ทุกแบรนด์'),
    category: text(language, 'All categories', 'ทุกหมวดหมู่'),
    condition: text(language, 'All conditions', 'ทุกสภาพ'),
    availability: text(language, 'All availability', 'ทุกสถานะ'),
    newest: text(language, 'Newest first', 'ใหม่ล่าสุด'),
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
  const options = `<option value="">${htmlEscape(labels.availability)}</option><option value="AVAILABLE"${availability === 'AVAILABLE' ? ' selected' : ''}>${htmlEscape(statusLabel('AVAILABLE', language))}</option><option value="RESERVED"${availability === 'RESERVED' ? ' selected' : ''}>${htmlEscape(statusLabel('RESERVED', language))}</option><option value="NOT_AVAILABLE"${availability === 'NOT_AVAILABLE' ? ' selected' : ''}>${htmlEscape(statusLabel('NOT_AVAILABLE', language))}</option><option value="SOLD"${availability === 'SOLD' ? ' selected' : ''}>${htmlEscape(statusLabel('SOLD', language))}</option>`;
  const form = `<form id="catalog-search-form" class="filters" method="get"><input type="hidden" name="lang" value="${language}"><input name="q" value="${attr(query)}" placeholder="${attr(labels.search)}">${selectOptions(brand, labels.brand, brandOptions, 'brand')}${selectOptions(category, labels.category, categoryOptions, 'category')}${selectOptions(condition, labels.condition, conditionOptions, 'condition')}<select name="availability">${options}</select><button>${htmlEscape(labels.apply)}</button></form>`;
  const groupedProducts = [...new Set(products.map((product) => product.category))]
    .map((groupCategory) => {
      const categoryProducts = products.filter((product) => product.category === groupCategory);
      return `<section class="catalog-category"><h2>${htmlEscape(groupCategory || text(language, 'Uncategorized', 'ไม่ระบุหมวดหมู่'))}<span>${categoryProducts.length}</span></h2><div class="grid">${categoryProducts.map((product) => {
        const slug = product.public_slug;
        const imageUrl = product.primary_image_id
          ? `/media/products/${encodeURIComponent(slug)}/image/${encodeURIComponent(product.primary_image_id)}`
          : '';
        return productCardMarkup({
          href: `/catalog/products/${encodeURIComponent(slug)}?lang=${language}`,
          imageUrl,
          imageAlt: `${product.brand} ${product.model}`,
          brand: product.brand,
          model: product.model,
          specification: product.target_body_part,
          status: product.status,
          language,
        });
      }).join('')}</div></section>`;
    }).join('');
  const totalPages = Math.max(1, Math.ceil((countRow?.total ?? 0) / pageSize));
  const pagination =
    totalPages > 1
      ? `<nav class="pagination" id="catalog-pagination">${page > 1 ? `<a href="${attr(`?${new URLSearchParams({ q: query, brand, category, condition, availability, sort, page: String(page - 1), lang: language })}`)}">${htmlEscape(text(language, 'Previous', 'ก่อนหน้า'))}</a>` : ''}<span>${page} / ${totalPages}</span>${page < totalPages ? `<a href="${attr(`?${new URLSearchParams({ q: query, brand, category, condition, availability, sort, page: String(page + 1), lang: language })}`)}">${htmlEscape(text(language, 'Next', 'ถัดไป'))}</a>` : ''}</nav>`
      : '';
  const content = `<section class="hero"><p class="eyebrow">${htmlEscape(text(language, 'Commercial fitness equipment', 'อุปกรณ์ฟิตเนสเชิงพาณิชย์'))}</p><h1>${htmlEscape(text(language, 'Equipment catalog', 'แคตตาล็อกสินค้า'))}</h1><p>${htmlEscape(text(language, 'Explore our current selection of new and pre-owned equipment. Contact our team to confirm availability.', 'เลือกชมอุปกรณ์ใหม่และมือสองที่มีในปัจจุบัน ติดต่อทีมงานเพื่อยืนยันสถานะสินค้า'))}</p></section>${form}<div id="catalog-result-count" class="meta" style="margin-top:16px">${htmlEscape(text(language, `${countRow?.total ?? 0} products`, `สินค้า ${countRow?.total ?? 0} รายการ`))}</div>${products.length ? `<div id="catalog-results">${groupedProducts}</div>` : `<div id="catalog-empty" class="empty">${htmlEscape(text(language, 'No products match those filters.', 'ไม่พบสินค้าที่ตรงกับตัวกรอง'))}</div>`}${pagination}`;
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
    ? `/media/products/${encodeURIComponent(slug)}/image/${encodeURIComponent(photos[0].id)}`
    : '';
  const gallery = photo
    ? `<div><div class="gallery-main"><img src="${photo}" alt="${attr(name)}"></div>${photos.length > 1 ? `<div class="thumbs">${photos.slice(1).map((image, index) => `<img src="/media/products/${encodeURIComponent(slug)}/image/${encodeURIComponent(image.id)}" alt="${attr(`${name} ${index + 2}`)}" loading="lazy">`).join('')}</div>` : ''}</div>`
    : `<div class="gallery-main"></div>`;
  const facts = productMetadataMarkup({
    brand: product.brand,
    model: product.model,
    specification: product.target_body_part,
    status: product.status,
  }, language, 'catalog-product-details');
  const links = contactLinks(
    companyInfo,
    'product',
    slug,
    language,
  );
  const content = `<a class="button" href="/catalog?lang=${language}">← ${htmlEscape(text(language, 'All equipment', 'สินค้าทั้งหมด'))}</a><section class="detail">${gallery}<div class="detail-copy"><h1>${htmlEscape(name)}</h1><div class="muted">${htmlEscape(text(language, `SKU: ${product.sku}`, `รหัสสินค้า: ${product.sku}`))}</div>${facts}${description ? `<div class="description">${htmlEscape(description)}</div>` : ''}${links}</div></section>`;
  return pageHtml({
    request: c.req.raw,
    env: c.env,
    title: `${name} | Corevity`,
    description: description || `${name} · ${product.category}`,
    image: photo ? `${base}${photo}` : undefined,
    content,
    language,
    ...(from ? { chat: { catalogSlug: from, productSlug: slug } } : {}),
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
  const photo = item.image_key_snapshot
    ? `/media/catalogs/${encodeURIComponent(slug)}/item/${encodeURIComponent(item.id)}`
    : '';
  const description = privateCatalogDescription(item, language);
  const content = `<a class="editorial-back" href="/s/${encodeURIComponent(slug)}?lang=${language}">← ${htmlEscape(text(language, 'Back to collection', 'กลับไปแคตตาล็อกนี้'))}</a>${privateCatalogProduct(item, { slug, language, detail: true, showPrice: Boolean(catalog.show_price_private) })}<section class="editorial-contact"><p>${htmlEscape(text(language, 'Message Corevity for actual-unit photos and delivery details', 'ติดต่อ Corevity เพื่อขอภาพสินค้าจริงและรายละเอียดการจัดส่ง'))}</p>${contactLinks(companyInfo, 'catalog', slug, language, item.product_slug)}</section>`;
  return pageHtml({
    request: c.req.raw,
    env: c.env,
    title: `${item.product_name_snapshot} | ${catalog.title}`,
    description:
      description || catalog.description || item.product_name_snapshot,
    image: photo ? `${base}${photo}` : undefined,
    content,
    language,
    chat: { catalogSlug: slug, productSlug },
    privateCatalogTitle: catalog.title,
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
  const rows = items.map((item) => privateCatalogProduct(item, { slug, language, showPrice: Boolean(catalog.show_price_private) })).join('');
  const companyName =
    language === 'th'
      ? companyInfo?.company_name_th ||
        companyInfo?.company_name_en ||
        'Corevity'
      : companyInfo?.company_name_en ||
        companyInfo?.company_name_th ||
        'Corevity';
  const content = `<section class="editorial-intro"><h1>${htmlEscape(catalog.title)}</h1>${catalog.description ? `<p>${htmlEscape(catalog.description)}</p>` : ''}</section>${items.length ? `${privateCatalogEbookToolbar(language)}${privateCatalogEbookPaperStart(catalog.title, catalog.description, language)}<section class="editorial-products" aria-label="${attr(text(language, 'Equipment', 'รายการสินค้า'))}">${rows}</section>${privateCatalogEbookPaperEnd(language, Boolean(catalog.show_price_private))}` : `<div class="empty">${htmlEscape(text(language, 'No published products are currently available in this collection.', 'ไม่มีสินค้าที่เผยแพร่ในแคตตาล็อกนี้ในขณะนี้'))}</div>`}<section class="editorial-contact"><p>${htmlEscape(text(language, 'Message Corevity for actual-unit photos and delivery details', 'ติดต่อ Corevity เพื่อขอภาพสินค้าจริงและรายละเอียดการจัดส่ง'))}</p><small>${htmlEscape(text(language, 'Confirm unit condition, availability and configuration with our team.', 'กรุณายืนยันสภาพสินค้า สถานะ และอุปกรณ์ที่มาพร้อมเครื่องกับทีมงาน'))}</small>${catalog.show_price_private ? `<small>${htmlEscape(text(language, 'All prices are THB per unit.', 'ราคาทั้งหมดเป็นสกุลเงินบาทต่อเครื่อง'))}</small>` : ''}${contactLinks(companyInfo, 'catalog', slug, language)}</section>`;
  const featured = catalog.cover_image_key
    ? `${base}/media/catalogs/${encodeURIComponent(slug)}/cover?v=${encodeURIComponent(catalog.cover_image_key.slice(15))}`
    : items[0]?.image_key_snapshot
    ? `${base}/media/catalogs/${encodeURIComponent(slug)}/item/${encodeURIComponent(items[0].id)}`
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
    chat: { catalogSlug: slug },
    privateCatalogTitle: catalog.title,
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
      catalogProduct = await getProduct(c.env.DB, requestedProduct);
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
      // Legacy positional URLs can point to a different photo after image edits.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
app.get('/media/products/:slug/image/:imageId', async (c) => {
  const product = await getProduct(c.env.DB, c.req.param('slug'));
  if (!product) return c.notFound();
  const image = await c.env.DB.prepare(
    'SELECT r2_key,mime_type FROM product_images WHERE id=? AND product_id=?',
  )
    .bind(c.req.param('imageId'), product.id)
    .first<{ r2_key: string; mime_type: string }>();
  if (!image) return c.notFound();
  const object = await c.env.PRODUCT_IMAGES.get(image.r2_key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type':
        image.mime_type || object.httpMetadata?.contentType || 'image/jpeg',
      // Image IDs change when a photo is replaced, so long-lived caching is safe.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
type CatalogImage = { product_id: string; r2_key: string; mime_type: string };
async function serveCatalogImage(c: PublicContext, item: CatalogImage | null, positional = false) {
  if (!item) return c.notFound();
  let stored = item.r2_key ? await c.env.PRODUCT_IMAGES.get(item.r2_key) : null;
  let mime = item.mime_type;
  const fromSnapshot = Boolean(stored);
  // A saved catalog can outlive the product photo it captured. Keep an existing
  // snapshot, otherwise use a current photo of the SAME authorized product.
  if (!stored) {
    const { results } = await c.env.DB.prepare(
      'SELECT r2_key,mime_type FROM product_images WHERE product_id=? ORDER BY is_primary DESC,sort_order LIMIT 5',
    ).bind(item.product_id).all<{ r2_key: string; mime_type: string }>();
    for (const image of results) {
      if (image.r2_key === item.r2_key) continue;
      stored = await c.env.PRODUCT_IMAGES.get(image.r2_key);
      if (stored) { mime = image.mime_type; break; }
    }
  }
  if (!stored) return c.notFound();
  return new Response(stored.body, {
    headers: {
      'Content-Type': mime || stored.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': positional ? 'no-store' : fromSnapshot
        ? 'public, max-age=3600, s-maxage=86400'
        : 'public, max-age=60, s-maxage=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
// Registered before '/:position' so "cover" is not read as a position.
app.get('/media/catalogs/:slug/cover', async (c) => {
  const catalog = await getCatalog(c.env.DB, c.req.param('slug'));
  const stored = catalog?.cover_image_key ? await c.env.PRODUCT_IMAGES.get(catalog.cover_image_key) : null;
  if (!catalog || !stored) return c.notFound();
  return new Response(stored.body, {
    headers: {
      'Content-Type': catalog.cover_image_mime || stored.httpMetadata?.contentType || 'image/jpeg',
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
    `SELECT i.product_id,i.image_key_snapshot AS r2_key,i.image_mime_snapshot AS mime_type
     FROM catalog_items i JOIN products p ON p.id=i.product_id
     WHERE i.catalog_id=? AND p.is_published=1 AND p.archived_at IS NULL AND (?=1 OR p.status!='SOLD')
     ORDER BY i.sort_order LIMIT 1 OFFSET ?`,
  )
    .bind(catalog.id, catalog.show_sold, position)
    .first<CatalogImage>();
  return serveCatalogImage(c, item, true);
});

app.get('/media/catalogs/:slug/item/:itemId', async (c) => {
  const catalog = await getCatalog(c.env.DB, c.req.param('slug'));
  if (!catalog) return c.notFound();
  const item = await c.env.DB.prepare(
    `SELECT i.product_id,i.image_key_snapshot AS r2_key,i.image_mime_snapshot AS mime_type
     FROM catalog_items i JOIN products p ON p.id=i.product_id
     WHERE i.id=? AND i.catalog_id=? AND p.is_published=1 AND p.archived_at IS NULL
       AND (?=1 OR p.status!='SOLD')`,
  )
    .bind(c.req.param('itemId'), catalog.id, catalog.show_sold)
    .first<CatalogImage>();
  return serveCatalogImage(c, item);
});

app.get('/api/public/storefront/catalogs', async (c) =>
  c.json({catalogs: await webCatalogs(c.env.DB)}, 200, {'Cache-Control': 'public, max-age=0, s-maxage=30'}),
);
app.get('/api/public/storefront/catalogs/:slug', async (c) => {
  const catalog = await getWebCatalog(c.env.DB, c.req.param('slug'));
  if (!catalog) return c.json({error: 'Catalog not found.'}, 404);
  return c.json(await webCatalogResponse(c,catalog), 200, {'Cache-Control': 'public, max-age=0, s-maxage=30'});
});
app.get('/api/public/storefront', async (c) => {
  const [latest] = await webCatalogs(c.env.DB);
  if (!latest) return c.json({error: 'Catalog not found.'}, 404);
  const catalog = await getWebCatalog(c.env.DB, latest.slug);
  if (!catalog) return c.json({error: 'Catalog not found.'}, 404);
  return c.json(await webCatalogResponse(c,catalog), 200, {'Cache-Control': 'public, max-age=0, s-maxage=30'});
});
app.get('/api/public/catalog', async (c) => {
  const search = (c.req.query('q') ?? '').slice(0, 100);
  const page = Math.max(1, Math.min(1000, Number(c.req.query('page')) || 1));
  const { results } = await c.env.DB.prepare(
    `SELECT brand,model,category,condition,status,public_slug AS slug,
      (SELECT COUNT(*) FROM product_images WHERE product_id=products.id) AS imageCount
     FROM products WHERE is_published=1 AND archived_at IS NULL
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
        showPrice: false,
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
        showPrices: false,
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
      })),
    },
    200,
    {
      'Cache-Control':
        'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
    },
  );
});

const publicChatInput = z.object({
  body: z.string().trim().min(1).max(2000),
  visitorName: z.string().trim().max(80).optional().default(''),
  visitorPhone: z.string().trim().max(32).optional().default(''),
  catalogSlug: z.string().trim().max(100).optional().default(''),
  productSlugs: z.array(z.string().trim().min(1).max(120)).max(3).optional().default([]),
  website: z.string().max(200).optional().default(''),
}).strict();
const publicChatStartInput = publicChatInput.extend({
  visitorName: z.string().trim().min(1).max(80),
  visitorPhone: z.string().trim().min(6).max(32).regex(/^[+0-9()\-\s.]+$/).refine((value) => {
    const digits = value.replace(/\D/g, '').length;
    return digits >= 7 && digits <= 15;
  }),
});
const websiteChatStartInput = z.object({
  visitorName: z.string().trim().min(2).max(80),
  visitorPhone: z.string().trim().min(6).max(32).regex(/^[+0-9()\-\s.]+$/).refine((value) => {
    const digits = value.replace(/\D/g, '').length;
    return digits >= 7 && digits <= 15;
  }),
  visitorEmail: z.email().max(254),
  body: z.string().trim().min(1).max(2000),
  website: z.string().max(200).optional().default(''),
}).strict();
async function withinPublicChatRate(c: PublicContext, scope: 'thread' | 'message', limit: number, durationMs: number) {
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  const visitorHash = await digest(`${c.env.CATALOG_CHAT_INTERNAL_SECRET || 'catalog-chat-local'}:${ip}`);
  const bucket = new Date(Math.floor(Date.now() / durationMs) * durationMs).toISOString();
  const result = await c.env.DB.prepare(
    `INSERT INTO catalog_chat_rate_limits(visitor_hash,scope,window_start,request_count) VALUES(?,?,?,1)
     ON CONFLICT(visitor_hash,scope,window_start) DO UPDATE SET request_count=request_count+1
     WHERE request_count<?`,
  ).bind(visitorHash, scope, bucket, limit).run();
  return result.meta.changes > 0;
}
async function publicChatProducts(database: D1Database, catalogSlug: string, query: string) {
  if (catalogSlug) {
    const catalog = await getCatalog(database, catalogSlug);
    if (!catalog) return [];
    const { results } = await database.prepare(
      `SELECT p.public_slug AS slug,p.brand,p.model,p.category
       FROM catalog_items i JOIN products p ON p.id=i.product_id
       WHERE i.catalog_id=? AND p.is_published=1 AND p.archived_at IS NULL
         AND (?='' OR p.brand LIKE ? OR p.model LIKE ? OR p.category LIKE ?)
       ORDER BY i.sort_order LIMIT 60`,
    ).bind(catalog.id, query, `%${query}%`, `%${query}%`, `%${query}%`).all<{ slug: string; brand: string; model: string; category: string }>();
    return results.map((product) => ({ slug: product.slug, label: `${product.brand} ${product.model}`, category: product.category }));
  }
  const { results } = await database.prepare(
    `SELECT public_slug AS slug,brand,model,category FROM products
     WHERE is_published=1 AND archived_at IS NULL
       AND (?='' OR brand LIKE ? OR model LIKE ? OR category LIKE ?)
     ORDER BY created_at DESC LIMIT 60`,
  ).bind(query, `%${query}%`, `%${query}%`, `%${query}%`).all<{ slug: string; brand: string; model: string; category: string }>();
  return results.map((product) => ({ slug: product.slug, label: `${product.brand} ${product.model}`, category: product.category }));
}
async function notifyManagement(env: PublicBindings, payload: { threadId: string; body: string; products: string[] }) {
  if (!env.MANAGEMENT || !env.CATALOG_CHAT_INTERNAL_SECRET) return;
  try {
    const response = await env.MANAGEMENT.fetch(new Request('https://management.internal/internal/catalog-chat-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-catalog-chat-secret': env.CATALOG_CHAT_INTERNAL_SECRET },
      body: JSON.stringify(payload),
    }));
    if (!response.ok) {
      console.error(JSON.stringify({ event: 'catalog_chat_notify_failed', status: response.status }));
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'catalog_chat_notify_failed', type: error instanceof Error ? error.name : 'Error' }));
  }
}
async function attachPublicProducts(database: D1Database, catalogSlug: string, slugs: string[]) {
  if (!slugs.length) return [];
  let result: { results: { slug: string; label: string; category: string }[] };
  if (catalogSlug) {
    const catalog = await getCatalog(database, catalogSlug);
    if (!catalog) return [];
    result = await database.prepare(
      `SELECT p.public_slug AS slug,p.brand || ' ' || p.model AS label,p.category
       FROM catalog_items i JOIN products p ON p.id=i.product_id
       WHERE i.catalog_id=? AND p.is_published=1 AND p.archived_at IS NULL
       AND p.public_slug IN (${slugs.map(() => '?').join(',')})`,
    ).bind(catalog.id, ...slugs).all<{ slug: string; label: string; category: string }>();
  } else {
    result = await database.prepare(
      `SELECT public_slug AS slug,brand || ' ' || model AS label,category FROM products
       WHERE is_published=1 AND archived_at IS NULL AND public_slug IN (${slugs.map(() => '?').join(',')})`,
    ).bind(...slugs).all<{ slug: string; label: string; category: string }>();
  }
  if (result.results.length !== new Set(slugs).size) return null;
  return result.results;
}
async function bearerThread(c: PublicContext, id: string) {
  const token = c.req.header('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  if (!token) return null;
  return c.env.DB.prepare('SELECT id,catalog_slug,visitor_name,status FROM catalog_chats WHERE id=? AND token_hash=?')
    .bind(id, await digest(token)).first<{ id: string; catalog_slug: string; visitor_name: string; status: string }>();
}
app.post('/api/public/chat/website', async (c) => {
  if (Number(c.req.header('content-length')) > 16000) return c.json({ error: 'Message is too large.' }, 413);
  const parsed = websiteChatStartInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Enter your name, phone number, email, and message.' }, 400);
  if (parsed.data.website) return c.json({ error: 'Message rejected.' }, 400);
  if (!(await withinPublicChatRate(c, 'thread', 4, 10 * 60 * 1000))) return c.json({ error: 'Please wait before starting another conversation.' }, 429);
  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO catalog_chats(id,token_hash,catalog_slug,catalog_title,assigned_email,visitor_name,visitor_phone,visitor_email,source,status,created_at,updated_at,last_message_at) VALUES(?,?,'','','',?,?,?,'WEBSITE','OPEN',?,?,?)",
  ).bind(id, await digest(token), parsed.data.visitorName, parsed.data.visitorPhone, parsed.data.visitorEmail, now, now, now).run();
  await savePublicChatMessage(c.env.DB, id, 'VISITOR', '', parsed.data.body, []);
  await notifyManagement(c.env, { threadId: id, body: parsed.data.body, products: [] });
  return c.json({ session: { id, token }, ok: true }, 201, { 'Cache-Control': 'no-store' });
});
app.get('/api/public/chat/products', async (c) => {
  const products = await publicChatProducts(c.env.DB, (c.req.query('catalog') ?? '').slice(0, 100), (c.req.query('q') ?? '').slice(0, 80));
  return c.json({ products }, 200, { 'Cache-Control': 'no-store' });
});
app.get('/api/public/chat/:id', async (c) => {
  const thread = await bearerThread(c, c.req.param('id'));
  if (!thread) return c.json({ error: 'Conversation not found.' }, 404, { 'Cache-Control': 'no-store' });
  const messages = await c.env.DB.prepare(
    'SELECT id,sender_type AS senderType,body,products,created_at AS createdAt FROM catalog_chat_messages WHERE chat_id=? ORDER BY id DESC LIMIT 100',
  ).bind(thread.id).all<{ id: number; senderType: string; body: string; products: string; createdAt: string }>();
  return c.json({ messages: messages.results.reverse().map((message) => ({ ...message, products: JSON.parse(message.products || '[]') })) }, 200, { 'Cache-Control': 'no-store' });
});
async function savePublicChatMessage(database: D1Database, threadId: string, senderType: 'VISITOR' | 'SALESPERSON', senderEmail: string, body: string, products: { slug: string; label: string; category: string }[]) {
  const createdAt = new Date().toISOString();
  await database.batch([
    database.prepare('INSERT INTO catalog_chat_messages(chat_id,sender_type,sender_email,body,products,created_at) VALUES(?,?,?,?,?,?)').bind(threadId, senderType, senderEmail, body, JSON.stringify(products), createdAt),
    database.prepare('UPDATE catalog_chats SET updated_at=?,last_message_at=? WHERE id=?').bind(createdAt, createdAt, threadId),
  ]);
}
app.post('/api/public/chat', async (c) => {
  if (Number(c.req.header('content-length')) > 16000) return c.json({ error: 'Message is too large.' }, 413);
  const parsed = publicChatStartInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Enter your name, a valid phone number, and a message up to 2,000 characters.' }, 400);
  const input = parsed.data;
  if (input.website) return c.json({ error: 'Message rejected.' }, 400);
  if (!input.catalogSlug) return c.json({ error: 'Start this chat from a shared catalog.' }, 400);
  if (!(await withinPublicChatRate(c, 'thread', 4, 10 * 60 * 1000))) return c.json({ error: 'Please wait before starting another conversation.' }, 429);
  const catalog = await getCatalog(c.env.DB, input.catalogSlug);
  if (!catalog) return c.json({ error: 'Catalog is no longer available.' }, 404);
  const products = await attachPublicProducts(c.env.DB, input.catalogSlug, input.productSlugs);
  if (!products) return c.json({ error: 'One or more attached products are unavailable.' }, 422);
  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO catalog_chats(id,token_hash,catalog_slug,catalog_title,assigned_email,visitor_name,visitor_phone,status,created_at,updated_at,last_message_at) VALUES(?,?,?,?,?,?,?,'OPEN',?,?,?)",
  ).bind(id, await digest(token), catalog.slug, catalog.title, catalog.assigned_salesperson_email, input.visitorName, input.visitorPhone, now, now, now).run();
  await savePublicChatMessage(c.env.DB, id, 'VISITOR', '', input.body, products);
  await notifyManagement(c.env, { threadId: id, body: input.body, products: products.map((product) => product.label) });
  return c.json({ session: { id, token }, ok: true }, 201, { 'Cache-Control': 'no-store' });
});
app.post('/api/public/chat/:id/messages', async (c) => {
  if (Number(c.req.header('content-length')) > 16000) return c.json({ error: 'Message is too large.' }, 413);
  const thread = await bearerThread(c, c.req.param('id'));
  if (!thread) return c.json({ error: 'Conversation not found.' }, 404);
  if (thread.status !== 'OPEN') return c.json({ error: 'This conversation is closed.' }, 409);
  const parsed = publicChatInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Enter a message up to 2,000 characters.' }, 400);
  if (parsed.data.website) return c.json({ error: 'Message rejected.' }, 400);
  if (!(await withinPublicChatRate(c, 'message', 20, 60 * 1000))) return c.json({ error: 'Please wait before sending another message.' }, 429);
  const products = await attachPublicProducts(c.env.DB, thread.catalog_slug, parsed.data.productSlugs);
  if (!products) return c.json({ error: 'One or more attached products are unavailable.' }, 422);
  await savePublicChatMessage(c.env.DB, thread.id, 'VISITOR', '', parsed.data.body, products);
  await notifyManagement(c.env, { threadId: thread.id, body: parsed.data.body, products: products.map((product) => product.label) });
  return c.json({ ok: true }, 201, { 'Cache-Control': 'no-store' });
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
