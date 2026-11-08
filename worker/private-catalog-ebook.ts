// Progressive enhancement: without JavaScript every product remains readable.
export const privateCatalogEbookStyles = `
.ebook-toolbar[hidden]{display:none}
.ebook-toolbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:24px 0 20px;padding:12px 16px;background:#fff;border:1px solid #dce0e5;border-radius:10px;box-shadow:0 4px 18px #14223808}
.ebook-nav{display:flex;align-items:center;gap:12px}.ebook-toolbar button{min-height:40px;min-width:40px;border:1px solid #d8dee6;border-radius:6px;background:white;color:#214a78;padding:7px 13px;cursor:pointer;font-weight:600}
.ebook-toolbar button:hover:not(:disabled){background:#eef4fb;border-color:#2164ad}.ebook-toolbar button:disabled{opacity:.35;cursor:default}
.ebook-toolbar button:focus-visible,.ebook-toolbar select:focus-visible{outline:3px solid #81b4ef;outline-offset:3px}
.ebook-toolbar output{min-width:54px;text-align:center;font-size:13px;color:#536176;font-variant-numeric:tabular-nums;white-space:nowrap}
.ebook-controls{display:flex;align-items:center;gap:10px;min-width:0}.ebook-contents{display:flex;align-items:center;gap:9px;font-size:12px;color:#657185;min-width:0}
.ebook-contents select{width:220px;max-width:100%;min-width:0;min-height:40px;padding:8px 26px 8px 10px;border:1px solid #d8dee6;border-radius:6px;background:#fff;color:#333;font:inherit}
.ebook-progress{flex-basis:100%;width:100%;height:3px;border:0;appearance:none;background:#e7edf4;color:#2164ad}.ebook-progress::-webkit-progress-bar{background:#e7edf4}.ebook-progress::-webkit-progress-value{background:#2164ad}.ebook-progress::-moz-progress-bar{background:#2164ad}
body.private-catalog.ebook-active{background:#e9ecf0}.ebook-active .editorial-intro{padding-top:26px}.ebook-active .editorial-intro h1{font-size:clamp(27px,3.3vw,39px)}
.ebook-active .editorial-products{background:#fff;border:1px solid #d6dce3;box-shadow:0 12px 30px #14223812,4px 4px 0 #fff,5px 5px 0 #d6dce3;border-radius:2px;position:relative;isolation:isolate;margin-bottom:28px}
.ebook-active .editorial-products:before{content:'';position:absolute;top:0;bottom:0;left:0;width:12px;background:linear-gradient(90deg,#0000000b,transparent);pointer-events:none;z-index:1}
.ebook-active .editorial-product{padding:34px;min-height:0;border:0;border-bottom:1px solid #e1e4e8;gap:32px;animation:ebook-arrive .18s ease-out}.ebook-active .editorial-product[hidden]{display:none}
.ebook-active .editorial-photo{min-height:240px}.ebook-active .editorial-copy h2{font-size:clamp(26px,3vw,36px)}
.ebook-active .editorial-contact{padding-top:8px}.ebook-active .footer{background:transparent}
.ebook-stage,.ebook-page-frame,.ebook-paper{display:contents}.ebook-paper-header,.ebook-paper-title,.ebook-paper-footer,.ebook-zoom,.ebook-details-link{display:none}
body.ebook-active .editorial-masthead,body.ebook-active .editorial-intro,body.ebook-active .editorial-contact,body.ebook-active>.footer{display:none}
body.ebook-active>main.shell{max-width:none;padding:0 20px}
.ebook-active .ebook-toolbar{max-width:1100px;margin:14px auto 10px;position:relative;top:auto}
.ebook-active .ebook-stage{display:block;overflow:auto;overscroll-behavior:contain;padding:12px;touch-action:pan-x pan-y;}
.ebook-active .ebook-page-frame{display:block;position:relative;margin:0 auto}
.ebook-active .ebook-paper{display:block;position:absolute;top:0;left:0;width:794px;height:1123px;transform-origin:top left;background:#fff;box-shadow:0 8px 30px #14223826,4px 4px 0 #fff,5px 5px 0 #cbd1d9;overflow:hidden}
.ebook-active .ebook-paper-header{display:flex;justify-content:space-between;align-items:center;height:104px;padding:22px 42px;background:#20201e;color:#eee;border-bottom:4px solid #2164ad}
.ebook-paper-wordmark{font-size:34px;letter-spacing:3px;font-weight:300;line-height:1.2}.ebook-paper-wordmark span{color:#2164ad}.ebook-paper-wordmark small{display:block;font-size:8px;letter-spacing:1.2px;text-align:center;margin-top:8px;color:#c7c7c4}
.ebook-paper-heading{text-align:right;max-width:300px;font-size:10px;line-height:1.5}.ebook-paper-heading strong{display:block;font-size:14px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ebook-active .ebook-paper-title{display:block;height:76px;padding:16px 42px 10px}.ebook-paper-title h1{font-size:25px;line-height:1.2;margin:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.ebook-paper-title p{font-size:11px;color:#777;margin:5px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ebook-active .editorial-products{display:grid;grid-template-rows:repeat(5,minmax(0,1fr));height:880px;padding:0 42px;margin:0;border:0;border-radius:0;box-shadow:none;isolation:auto;position:static}
.ebook-active .editorial-products:before{display:none}
.ebook-active .editorial-product{display:grid;grid-template-columns:270px minmax(0,1fr);gap:24px;min-height:0;padding:9px 0;border-bottom:1px solid #dededb;overflow:hidden;animation:none}
.ebook-active .editorial-product[hidden]{display:none}
.ebook-active .editorial-visual{min-height:0;position:relative;display:block;padding-top:19px}
.ebook-active .editorial-availability{position:absolute;top:1px;left:0;font-size:9px;line-height:12px;border-left-width:3px;padding-left:7px;margin:0}
.ebook-active .editorial-photo{width:100%;height:120px;min-height:0;aspect-ratio:auto}
.ebook-active .editorial-photo img{height:100%;max-height:120px;width:100%;object-fit:contain}
.ebook-active .editorial-category{font-size:9px;line-height:12px;margin:4px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ebook-active .editorial-copy{display:flex;gap:0;min-height:0;overflow:hidden}
.ebook-active .editorial-brand{font-size:9px;line-height:12px;margin:0 0 2px}
.ebook-active .editorial-copy h2{font-size:18px;line-height:21px;letter-spacing:-.3px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
.ebook-active .editorial-specification{font-size:10px;line-height:13px;margin:1px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;flex-shrink:0}
.ebook-active .editorial-price{margin:2px 0 4px;gap:5px;flex-shrink:0}.ebook-active .editorial-price strong{font-size:24px;line-height:27px;letter-spacing:-.4px}.ebook-active .editorial-price>span{font-size:8px}.ebook-active .editorial-price small{font-size:8px;margin-left:6px}
.ebook-active .editorial-price-request{font-size:12px;line-height:20px;margin:3px 0}
.ebook-active .editorial-description{font-size:10px;line-height:13px;margin:0 0 4px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;flex-shrink:1}
.ebook-active .editorial-description p{margin:0 0 3px}.ebook-active .editorial-description ul{margin:0 0 3px;padding-left:12px}.ebook-active .editorial-description li{margin:0}
.ebook-active .editorial-description:empty{display:none}
.ebook-active .editorial-facts{font-size:8px;line-height:11px;padding-top:4px;gap:4px 12px;flex-wrap:nowrap;margin-top:auto;flex-shrink:0}.ebook-active .editorial-facts dt{font-size:7px}.ebook-active .editorial-facts>div{gap:6px;white-space:nowrap;overflow:hidden}.ebook-active .editorial-facts dd{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.ebook-active .ebook-details-link{display:block;font-size:8px;line-height:12px;color:#2164ad;margin-top:3px;flex-shrink:0}
.ebook-active .ebook-paper-footer{display:flex;justify-content:space-between;align-items:center;height:63px;padding:12px 42px;font-size:9px;line-height:1.5;color:#777}.ebook-paper-footer strong{color:#333;display:block;font-size:10px}.ebook-paper-footer output{white-space:nowrap;margin-left:15px;color:#2164ad;font-size:11px}
.ebook-active .ebook-zoom{display:flex;align-items:center;gap:5px}.ebook-zoom output{min-width:40px;font-size:11px}.ebook-controls{flex-wrap:wrap}.ebook-active .catalog-chat-fab{width:46px;height:46px;min-width:46px;padding:0;justify-content:center}.ebook-active .catalog-chat-fab>span:not(.catalog-chat-badge){position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@media(max-width:560px){body.ebook-active>main.shell{padding:0 8px}.ebook-active .ebook-toolbar{margin:8px auto 4px;padding:8px}.ebook-active .ebook-controls{flex-wrap:wrap;gap:6px}.ebook-active .ebook-contents{flex:1;min-width:130px}.ebook-zoom{flex:1;justify-content:center}.ebook-active .ebook-stage{padding:8px}.ebook-active .ebook-toolbar button{min-height:34px}.ebook-active .ebook-contents select{min-height:34px}.ebook-active .editorial-product{grid-template-columns:270px minmax(0,1fr);padding:9px 0;gap:24px}.ebook-active .editorial-photo{height:120px;min-height:0}.ebook-active .editorial-copy h2{font-size:18px}.ebook-active .editorial-price strong{font-size:24px}}
@keyframes ebook-arrive{from{opacity:.4;transform:translateX(7px)}to{opacity:1;transform:translateX(0)}}
@media(prefers-reduced-motion:reduce){.ebook-active .editorial-product{animation:none}}
@media print{.ebook-stage,.ebook-page-frame,.ebook-paper{display:contents!important}.ebook-paper-header,.ebook-paper-title,.ebook-paper-footer,.ebook-zoom,.ebook-details-link{display:none!important}.ebook-active .editorial-products{height:auto;display:block;padding:0}.ebook-toolbar{display:none!important}body.private-catalog.ebook-active{background:white}.ebook-active .editorial-products{border:0;box-shadow:none}.ebook-active .editorial-products:before{display:none}.ebook-active .editorial-product,.ebook-active .editorial-product[hidden]{display:grid!important;min-height:0;animation:none;break-after:page;padding:9mm 0}.ebook-active .editorial-product:last-child{break-after:auto}}
`;

export function privateCatalogEbookToolbar(language: string) {
  const th = language === 'th';
  return `<nav class="ebook-toolbar" aria-label="${th ? 'เครื่องมืออ่าน ebook' : 'Ebook reader'}" hidden>
    <div class="ebook-nav"><button type="button" data-book-prev aria-label="${th ? 'หน้าก่อนหน้า' : 'Previous page'}">← ${th ? 'ก่อนหน้า' : 'Previous'}</button><output data-book-count aria-live="polite" aria-atomic="true"></output><button type="button" data-book-next aria-label="${th ? 'หน้าถัดไป' : 'Next page'}">${th ? 'ถัดไป' : 'Next'} →</button></div>
    <div class="ebook-controls"><label class="ebook-contents"><span>${th ? 'สารบัญ' : 'Contents'}</span><select data-book-contents aria-label="${th ? 'สารบัญ' : 'Contents'}"></select></label><button type="button" data-book-toggle aria-pressed="false" data-all-label="${th ? 'ดูทั้งหมด' : 'View all'}" data-book-label="${th ? 'อ่านแบบ ebook' : 'Read as ebook'}">${th ? 'ดูทั้งหมด' : 'View all'}</button></div>
    <div class="ebook-zoom"><button type="button" data-book-zoom-out aria-label="${th ? 'ย่อหน้ากระดาษ' : 'Zoom out'}">−</button><output data-book-zoom-label></output><button type="button" data-book-zoom-in aria-label="${th ? 'ขยายหน้ากระดาษ' : 'Zoom in'}">+</button><button type="button" data-book-fit>${th ? 'พอดีหน้า' : 'Fit page'}</button></div>
    <progress class="ebook-progress" data-book-progress aria-label="${th ? 'ความคืบหน้าการอ่าน' : 'Reading progress'}"></progress>
  </nav>`;
}

const escapeBookText = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
);
export function privateCatalogEbookPaperStart(title: string, description: string, language: string) {
  return `<div class="ebook-stage"><div class="ebook-page-frame"><section class="ebook-paper" aria-label="${language === 'th' ? 'หน้ากระดาษ Catalog' : 'Catalog page'}"><header class="ebook-paper-header"><div class="ebook-paper-wordmark">COR<span>E</span>VITY<small>USED GYM EQUIPMENT</small></div><div class="ebook-paper-heading">EQUIPMENT CATALOGUE<strong>${escapeBookText(title)}</strong></div></header><div class="ebook-paper-title"><h1>${escapeBookText(title)}</h1>${description ? `<p>${escapeBookText(description)}</p>` : ''}</div>`;
}
export function privateCatalogEbookPaperEnd(language: string) {
  return `<footer class="ebook-paper-footer"><div><strong>${language === 'th' ? 'ติดต่อ Corevity เพื่อขอภาพสินค้าจริงและรายละเอียดการจัดส่ง' : 'Message Corevity for actual-unit photos and delivery details'}</strong>${language === 'th' ? 'ราคาสกุลเงินบาทต่อเครื่อง · กรุณายืนยันสถานะสินค้าก่อนสั่งซื้อ' : 'All prices are THB per unit · Contact our team to confirm availability'}</div><output data-book-paper-count></output></footer></section></div></div>`;
}

export const privateCatalogEbookScript = `
(function(){
  const book=document.querySelector('.editorial-products');
  const toolbar=document.querySelector('.ebook-toolbar');
  if(!book||!toolbar)return;
  const products=Array.from(book.querySelectorAll('.editorial-product'));
  if(!products.length)return;
  const pageSize=5;
  const pages=[];
  for(let index=0;index<products.length;index+=pageSize)pages.push(products.slice(index,index+pageSize));
  const previous=toolbar.querySelector('[data-book-prev]');
  const next=toolbar.querySelector('[data-book-next]');
  const count=toolbar.querySelector('[data-book-count]');
  const contents=toolbar.querySelector('[data-book-contents]');
  const toggle=toolbar.querySelector('[data-book-toggle]');
  const progress=toolbar.querySelector('[data-book-progress]');
  const stage=document.querySelector('.ebook-stage');
  const frame=document.querySelector('.ebook-page-frame');
  const paper=document.querySelector('.ebook-paper');
  const zoomLabel=toolbar.querySelector('[data-book-zoom-label]');
  const paperCount=document.querySelector('[data-book-paper-count]');
  let current=0,all=false,zoom=1;
  function sizePaper(){
    if(all||!stage||!frame||!paper)return;
    const availableHeight=Math.max(240,window.innerHeight-toolbar.getBoundingClientRect().bottom-18);
    stage.style.height=availableHeight+'px';
    const fit=Math.min((stage.clientWidth-24)/794,(availableHeight-24)/1123);
    const scale=Math.max(.1,fit)*zoom;
    frame.style.width=(794*scale)+'px';
    frame.style.height=(1123*scale)+'px';
    paper.style.transform='scale('+scale+')';
    zoomLabel.textContent=Math.round(zoom*100)+'%';
  }
  products.forEach(function(product){
    const source=product.querySelector('h2 a');
    if(!source)return;
    const link=document.createElement('a');
    link.className='ebook-details-link';
    link.href=source.getAttribute('href');
    link.textContent=document.documentElement.lang==='th'?'อ่านรายละเอียดทั้งหมด ↗':'Read full details ↗';
    product.querySelector('.editorial-copy').append(link);
  });
  toolbar.querySelector('[data-book-zoom-in]').addEventListener('click',function(){zoom=Math.min(4,zoom+.5);sizePaper();});
  toolbar.querySelector('[data-book-zoom-out]').addEventListener('click',function(){zoom=Math.max(1,zoom-.5);sizePaper();});
  toolbar.querySelector('[data-book-fit]').addEventListener('click',function(){zoom=1;sizePaper();stage.scrollTo(0,0);});
  window.addEventListener('resize',sizePaper);
  pages.forEach(function(page,index){
    const option=document.createElement('option');
    option.value=String(index);
    option.textContent=(document.documentElement.lang==='th'?'หน้า ':'Page ')+(index+1)+' · '+(index*pageSize+1)+'–'+Math.min((index+1)*pageSize,products.length);
    contents.append(option);
  });
  progress.max=pages.length;
  function pageFromHash(){
    const match=location.hash.match(/^#page=(\\d+)$/);
    return match?Math.min(pages.length-1,Math.max(0,Number(match[1])-1)):0;
  }
  function render(index,updateUrl){
    current=Math.min(pages.length-1,Math.max(0,index));
    document.body.classList.toggle('ebook-active',!all);
    pages.forEach(function(page,i){page.forEach(function(product){product.hidden=!all&&i!==current;});});
    previous.disabled=all||current===0;
    next.disabled=all||current===pages.length-1;
    count.textContent=(current+1)+' / '+pages.length;
    if(paperCount)paperCount.textContent=String(current+1).padStart(2,'0')+' / '+String(pages.length).padStart(2,'0');
    contents.value=String(current);
    progress.value=current+1;
    toggle.textContent=toggle.dataset[all?'bookLabel':'allLabel'];
    toggle.setAttribute('aria-pressed',String(all));
    if(updateUrl)history.replaceState(null,'','#page='+(current+1));
    sizePaper();
  }
  function go(index){
    render(index,true);
    if(!all&&stage)stage.scrollTo(0,0);
  }
  previous.addEventListener('click',function(){go(current-1);});
  next.addEventListener('click',function(){go(current+1);});
  contents.addEventListener('change',function(){all=false;go(Number(contents.value));});
  toggle.addEventListener('click',function(){all=!all;render(current,false);});
  window.addEventListener('hashchange',function(){render(pageFromHash(),false);});
  document.addEventListener('keydown',function(event){
    if(all||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    if(event.target.closest('input,textarea,select,[contenteditable],#catalog-chat-root'))return;
    if(event.key==='ArrowRight'){event.preventDefault();go(current+1);}
    if(event.key==='ArrowLeft'){event.preventDefault();go(current-1);}
  });
  let start=null;
  book.addEventListener('touchstart',function(event){
    start=event.touches.length===1&&!event.target.closest('button,input,select,textarea')?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;
  },{passive:true});
  book.addEventListener('touchend',function(event){
    if(!start||all||zoom>1||!event.changedTouches.length)return;
    const dx=event.changedTouches[0].clientX-start.x,dy=event.changedTouches[0].clientY-start.y;
    start=null;
    if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5)go(current+(dx<0?1:-1));
  },{passive:true});
  book.addEventListener('touchcancel',function(){start=null;},{passive:true});
  toolbar.hidden=false;
  render(pageFromHash(),false);
})();
`;
