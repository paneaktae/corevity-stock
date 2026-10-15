const escapeAttribute = (value: string) =>
  value.replace(
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

export function renderCatalogChatWidget(args: {
  slug: string;
  language: string;
  itemId?: string;
}) {
  const thai = args.language === 'th';
  const copy = thai
    ? {
        launch: 'สอบถามทีมงาน',
        title: 'แชตกับฝ่ายขาย',
        name: 'ชื่อของคุณ',
        phone: 'เบอร์โทรศัพท์ / WhatsApp',
        first: 'ส่งข้อความแรกเพื่อเริ่มแชต ทีมงานจะติดต่อกลับโดยเร็ว',
        message: 'พิมพ์ข้อความสอบถาม…',
        send: 'ส่งข้อความ',
        sending: 'กำลังส่ง…',
        products: 'แนบสินค้าในแคตตาล็อก',
        waiting: 'ยังไม่มีข้อความตอบกลับ',
        unavailable: 'ส่งข้อความไม่ได้ กรุณาลองอีกครั้ง',
        closed: 'การสนทนานี้ปิดแล้ว',
      }
    : {
        launch: 'Ask our team',
        title: 'Chat with sales',
        name: 'Your name',
        phone: 'Phone / WhatsApp',
        first: 'Send a message to start. Our team will get back to you.',
        message: 'Type your question…',
        send: 'Send message',
        sending: 'Sending…',
        products: 'Attach catalog products',
        waiting: 'No reply yet',
        unavailable: 'Could not send your message. Please retry.',
        closed: 'This conversation is closed.',
      };
  const labels = JSON.stringify(copy).replace(/</g, '\\u003c');
  return `<aside class="catalog-chat" id="catalog-chat" data-catalog="${escapeAttribute(args.slug)}" data-item="${escapeAttribute(args.itemId ?? '')}" data-language="${thai ? 'th' : 'en'}">
  <button class="catalog-chat-launch" type="button" data-toggle>${copy.launch}</button>
  <section class="catalog-chat-panel" data-panel hidden aria-label="${copy.title}">
    <header><strong>${copy.title}</strong><button class="catalog-chat-close" type="button" data-close aria-label="Close">×</button></header>
    <p class="catalog-chat-hint" data-hint>${copy.first}</p>
    <div class="catalog-chat-log" data-log aria-live="polite"></div>
    <form class="catalog-chat-profile" data-profile>
      <label>${copy.name}<input name="name" autocomplete="name" maxlength="80" required></label>
      <label>${copy.phone}<input name="phone" autocomplete="tel" inputmode="tel" maxlength="32" required></label>
    </form>
    <div class="catalog-chat-picker" data-picker hidden>
      <input type="search" data-search placeholder="${copy.products}" aria-label="${copy.products}">
      <div data-options></div>
    </div>
    <div class="catalog-chat-selected" data-selected></div>
    <form class="catalog-chat-compose" data-compose>
      <input class="catalog-chat-honeypot" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="catalog-chat-attach" type="button" data-attach>${copy.products}</button>
      <textarea name="message" data-message required maxlength="2000" rows="3" placeholder="${copy.message}"></textarea>
      <button class="catalog-chat-send" data-send type="submit">${copy.send}</button>
    </form>
    <p class="catalog-chat-error" data-error role="status"></p>
  </section>
</aside>
<style>
.catalog-chat{position:fixed;z-index:30;right:20px;bottom:20px;font:14px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202a39}.catalog-chat-launch,.catalog-chat-send{border:0;border-radius:999px;background:#1769d2;color:white;padding:13px 18px;font-weight:700;box-shadow:0 8px 25px #12365b33;cursor:pointer}.catalog-chat-panel{position:absolute;right:0;bottom:62px;width:min(370px,calc(100vw - 28px));max-height:min(620px,calc(100dvh - 110px));overflow:auto;border:1px solid #dce5ef;border-radius:16px;background:#fff;box-shadow:0 18px 55px #14223830;padding:15px}.catalog-chat-panel[hidden],.catalog-chat-picker[hidden]{display:none}.catalog-chat-panel>header{display:flex;align-items:center;justify-content:space-between;color:#172a45}.catalog-chat-close{width:32px;height:32px;border:0;border-radius:50%;background:#f1f5f9;font-size:21px;cursor:pointer}.catalog-chat-hint{margin:4px 0 10px;color:#6d7e93;font-size:12px}.catalog-chat-log{display:grid;gap:8px;max-height:220px;overflow:auto}.catalog-chat-bubble{max-width:90%;padding:9px 11px;border-radius:12px;background:#f1f5f9;white-space:pre-wrap;overflow-wrap:anywhere}.catalog-chat-bubble.visitor{justify-self:end;background:#e6f0ff}.catalog-chat-bubble time{display:block;margin-top:3px;color:#708098;font-size:10px}.catalog-chat-profile,.catalog-chat-compose{display:grid;gap:8px;margin-top:9px}.catalog-chat-profile label{display:grid;gap:3px;font-size:12px;color:#51647b}.catalog-chat-profile input,.catalog-chat-compose textarea,.catalog-chat-picker input{width:100%;border:1px solid #dce5ef;border-radius:9px;padding:9px;background:#fff;color:#202a39}.catalog-chat-compose textarea{resize:vertical;min-height:72px}.catalog-chat-attach{justify-self:start;border:0;background:none;padding:2px 0;color:#1769d2;font-size:12px;cursor:pointer}.catalog-chat-send{justify-self:stretch;border-radius:9px;padding:10px}.catalog-chat-send:disabled{opacity:.55;cursor:wait}.catalog-chat-picker{margin-top:7px;padding:8px;border:1px solid #dce5ef;border-radius:10px}.catalog-chat-picker [data-options]{display:grid;max-height:125px;overflow:auto}.catalog-chat-option{display:flex;justify-content:space-between;gap:10px;padding:7px 2px;border:0;border-bottom:1px solid #edf1f6;background:#fff;text-align:left;color:#243952;cursor:pointer}.catalog-chat-option small{display:block;color:#71839b}.catalog-chat-selected{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.catalog-chat-chip{border-radius:99px;background:#eaf2fc;color:#245b9f;padding:4px 8px;font-size:11px}.catalog-chat-error{min-height:18px;margin:4px 0 0;color:#b42318;font-size:12px}.catalog-chat-honeypot{position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;opacity:0!important}@media(max-width:600px){.catalog-chat{right:12px;bottom:12px}.catalog-chat-panel{right:-2px;bottom:58px}}
</style>
<script>
(function(){var root=document.getElementById('catalog-chat');if(!root)return;var labels=${labels};var slug=root.dataset.catalog;var itemId=root.dataset.item||'';var key='corevity-catalog-chat:'+slug;var panel=root.querySelector('[data-panel]');var profile=root.querySelector('[data-profile]');var compose=root.querySelector('[data-compose]');var log=root.querySelector('[data-log]');var error=root.querySelector('[data-error]');var hint=root.querySelector('[data-hint]');var picker=root.querySelector('[data-picker]');var options=root.querySelector('[data-options]');var search=root.querySelector('[data-search]');var selectedNode=root.querySelector('[data-selected]');var selected=itemId?[itemId]:[];var session=null;var products=[];function read(){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}function save(){try{if(session)localStorage.setItem(key,JSON.stringify(session));else localStorage.removeItem(key)}catch{}}function auth(){return session?{Authorization:'Bearer '+session.token}: {}}function productLabel(id){var found=products.find(function(p){return p.itemId===id});return found?found.label:(id===itemId?labels.products:'')}function drawSelected(){selectedNode.textContent='';selected.forEach(function(id){var chip=document.createElement('span');chip.className='catalog-chat-chip';chip.textContent=productLabel(id);selectedNode.append(chip)})}function drawMessages(messages){log.textContent='';messages.forEach(function(m){var bubble=document.createElement('div');bubble.className='catalog-chat-bubble '+(m.senderType==='VISITOR'?'visitor':'sales');bubble.textContent=m.body;(m.products||[]).forEach(function(p){var chip=document.createElement('div');chip.className='catalog-chat-chip';chip.textContent=p.label;bubble.append(chip)});var time=document.createElement('time');time.textContent=new Intl.DateTimeFormat(document.documentElement.lang==='th'?'th-TH':'en-US',{hour:'2-digit',minute:'2-digit'}).format(new Date(m.createdAt));bubble.append(time);log.append(bubble)});log.scrollTop=log.scrollHeight}async function load(){if(!session)return;try{var r=await fetch('/api/public/chat/'+encodeURIComponent(session.id),{headers:auth(),cache:'no-store'});if(r.status===404){session=null;save();showSession();return}if(r.ok){var d=await r.json();drawMessages(d.messages||[]);if(d.status==='CLOSED'){hint.textContent=labels.closed;compose.querySelector('[data-send]').disabled=true}}}catch{}}function showSession(){profile.hidden=!!session;hint.hidden=!!session;log.hidden=!session;compose.querySelector('[data-send]').textContent=session?labels.send:labels.send}function open(){panel.hidden=false;load()}root.querySelector('[data-toggle]').addEventListener('click',function(){panel.hidden?open():panel.hidden=true});root.querySelector('[data-close]').addEventListener('click',function(){panel.hidden=true});session=read();showSession();drawSelected();var timer=setInterval(function(){if(!panel.hidden)load()},5000);window.addEventListener('pagehide',function(){clearInterval(timer)});async function loadProducts(){try{var r=await fetch('/api/public/chat/products?catalog='+encodeURIComponent(slug)+'&q='+encodeURIComponent(search.value||''));if(!r.ok)return;var d=await r.json();products=d.products||[];options.textContent='';products.forEach(function(p){var b=document.createElement('button');b.type='button';b.className='catalog-chat-option';var label=document.createElement('span');label.textContent=p.label;var cat=document.createElement('small');cat.textContent=p.category||'';label.append(cat);var action=document.createElement('strong');action.textContent=selected.includes(p.itemId)?'✓':'+';b.append(label,action);b.disabled=selected.includes(p.itemId)||selected.length>=3;b.addEventListener('click',function(){selected.push(p.itemId);drawSelected();loadProducts()});options.append(b)});drawSelected()}catch{}}var debounce;search.addEventListener('input',function(){clearTimeout(debounce);debounce=setTimeout(loadProducts,250)});root.querySelector('[data-attach]').addEventListener('click',function(){picker.hidden=!picker.hidden;if(!picker.hidden)loadProducts()});compose.addEventListener('submit',async function(e){e.preventDefault();var input=root.querySelector('[data-message]');var body=input.value.trim();if(!body)return;var button=compose.querySelector('[data-send]');button.disabled=true;button.textContent=labels.sending;error.textContent='';try{var payload={body:body,itemIds:selected,website:compose.elements.website.value};var response;if(!session){var name=profile.elements.name.value.trim();var phone=profile.elements.phone.value.trim();response=await fetch('/api/public/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign(payload,{visitorName:name,visitorPhone:phone,catalogSlug:slug}))})}else{response=await fetch('/api/public/chat/'+encodeURIComponent(session.id)+'/messages',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},auth()),body:JSON.stringify(payload)})}var result=await response.json().catch(function(){return {}});if(!response.ok)throw new Error(result.error||labels.unavailable);if(result.session){session=result.session;save();showSession()}input.value='';await load()}catch(err){error.textContent=err.message||labels.unavailable}finally{button.disabled=false;button.textContent=labels.send}});})();
</script>`;
}
