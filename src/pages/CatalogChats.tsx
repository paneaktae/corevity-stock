import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCheck, Inbox, Paperclip, Search, Send, X } from 'lucide-react';
import { api } from '../lib';
import { localized, t } from '../i18n';
import { ErrorBox, Header, Loading } from '../components/ui';
import { markCatalogChatRead } from '../catalogChatRead';

type CatalogThread = {
  id: string;
  catalogSlug: string;
  catalogTitle: string;
  visitorName: string;
  visitorPhone: string;
  visitorEmail: string;
  source: 'CATALOG' | 'WEBSITE';
  status: 'OPEN' | 'CLOSED';
  lastMessageAt: string;
  lastMessageId: number;
  lastMessage: string;
  lastSender: 'VISITOR' | 'SALESPERSON';
};
type CatalogChatMessage = {
  id: number;
  senderType: 'VISITOR' | 'SALESPERSON';
  senderEmail: string;
  body: string;
  products: { slug: string; label: string; category: string }[];
  createdAt: string;
};
function timestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
export function CatalogChatsPage() {
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('thread') ?? '';
  const [threads, setThreads] = useState<CatalogThread[]>([]);
  const [activeId, setActiveId] = useState(focusId);
  const [messages, setMessages] = useState<CatalogChatMessage[]>([]);
  const [body, setBody] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [productOptions, setProductOptions] = useState<CatalogChatMessage['products']>([]);
  const [selectedProducts, setSelectedProducts] = useState<CatalogChatMessage['products']>([]);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'WEBSITE' | 'CATALOG'>('ALL');
  const feed = useRef<HTMLDivElement>(null);

  const refreshThreads = useCallback(async () => {
    try {
      const result = await api<{ threads: CatalogThread[] }>('/catalog-chats');
      setThreads(result.threads);
      setError('');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  const refreshMessages = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const result = await api<{ messages: CatalogChatMessage[] }>(`/catalog-chats/${encodeURIComponent(id)}`);
      setMessages(result.messages);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);
  const activeThread = threads.find((thread) => thread.id === activeId);
  const visibleThreads = threads.filter((thread) => sourceFilter === 'ALL' || thread.source === sourceFilter);
  useEffect(() => {
    setSelectedProducts([]);
    setProductOptions([]);
    setProductQuery('');
    setProductPickerOpen(false);
  }, [activeId]);
  useEffect(() => { void refreshThreads(); const timer = window.setInterval(refreshThreads, 5000); return () => window.clearInterval(timer); }, [refreshThreads]);
  useEffect(() => { if (activeId) void refreshMessages(activeId); else setMessages([]); const timer = window.setInterval(() => { if (activeId) void refreshMessages(activeId); }, 3000); return () => window.clearInterval(timer); }, [activeId, refreshMessages]);
  useEffect(() => {
    if (messages.length && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
    if (activeId && document.visibilityState === 'visible') {
      const latestId = messages.reduce((latest, message) => Math.max(latest, message.id), 0);
      if (latestId) markCatalogChatRead(activeId, latestId);
    }
  }, [activeId, messages]);
  useEffect(() => { if (focusId) setActiveId(focusId); }, [focusId]);
  useEffect(() => {
    if (!productPickerOpen || activeThread?.source !== 'WEBSITE') return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await api<{ products: CatalogChatMessage['products'] }>(`/catalog-chats/products?q=${encodeURIComponent(productQuery)}`);
        if (!cancelled) setProductOptions(result.products);
      } catch (reason) {
        if (!cancelled) setError((reason as Error).message);
      }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeThread?.source, productPickerOpen, productQuery]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!activeId || !body.trim() || sending) return;
    setSending(true);
    setError('');
    const message = body.trim();
    try {
      await api(`/catalog-chats/${encodeURIComponent(activeId)}/messages`, { method: 'POST', body: JSON.stringify({ body: message, productSlugs: selectedProducts.map((product) => product.slug) }) });
      setBody('');
      setSelectedProducts([]);
      setProductQuery('');
      setProductPickerOpen(false);
      await Promise.all([refreshMessages(activeId), refreshThreads()]);
    } catch (reason) { setError((reason as Error).message); }
    finally { setSending(false); }
  }
  function sendOnEnter(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
  async function toggleStatus() {
    if (!activeThread) return;
    const status = activeThread.status === 'OPEN' ? 'CLOSED' : 'OPEN';
    try {
      await api(`/catalog-chats/${encodeURIComponent(activeId)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await refreshThreads();
    } catch (reason) { setError((reason as Error).message); }
  }

  return <>
    <Header eyebrow={t('CUSTOMER SERVICE')} title={localized('Customer messages', 'กล่องข้อความลูกค้า')} subtitle={localized('Reply to messages from the website and public catalogs.', 'ตอบข้อความจากเว็บไซต์และแคตตาล็อกสาธารณะ')} action={<Link className="button" to="/chat"><ArrowLeft size={16} />{t('Team chat')}</Link>} />
    <ErrorBox message={error} />
    <section className="panel catalog-chat-inbox">
      <aside className="catalog-chat-thread-list" aria-label={t('Conversations')}>
        <div className="section-heading"><h2><Inbox size={19} />{t('Conversations')}</h2><span>{threads.filter((thread) => thread.status === 'OPEN').length}</span></div>
        <div className="catalog-chat-filters" aria-label={localized('Message source', 'แหล่งที่มาของข้อความ')}>
          {(['ALL', 'WEBSITE', 'CATALOG'] as const).map((source) => <button type="button" key={source} className={sourceFilter === source ? 'active' : ''} aria-pressed={sourceFilter === source} onClick={() => { setSourceFilter(source); setActiveId(threads.find((thread) => source === 'ALL' || thread.source === source)?.id ?? ''); }}>{source === 'ALL' ? localized('All', 'ทั้งหมด') : source === 'WEBSITE' ? localized('Website', 'เว็บไซต์') : localized('Catalog', 'แคตตาล็อก')}</button>)}
        </div>
        {loading ? <Loading /> : visibleThreads.length ? visibleThreads.map((thread) => <button type="button" key={thread.id} className={`catalog-chat-thread${activeId === thread.id ? ' active' : ''}`} onClick={() => setActiveId(thread.id)}>
          <span className="catalog-chat-thread-top"><strong>{thread.visitorName || t('Catalog visitor')}</strong><small>{timestamp(thread.lastMessageAt)}</small></span>
          <span className={`catalog-chat-source ${thread.source === 'WEBSITE' ? 'website' : ''}`}>{thread.source === 'WEBSITE' ? localized('Website', 'เว็บไซต์') : localized('Catalog', 'แคตตาล็อก')}</span>
          <span className="catalog-chat-thread-catalog">{thread.visitorPhone || t('Phone not provided')}{thread.visitorEmail ? ` · ${thread.visitorEmail}` : ''}</span>
          <span className="catalog-chat-thread-catalog">{thread.source === 'WEBSITE' ? localized('Homepage chat', 'แชทหน้าเว็บไซต์') : thread.catalogTitle || t('Corevity catalog')} · {thread.status === 'OPEN' ? t('Open') : t('Closed')}</span>
          <span className="catalog-chat-thread-preview">{thread.lastSender === 'VISITOR' ? '' : `${t('You')}: `}{thread.lastMessage || ''}</span>
        </button>) : <p className="catalog-chat-inbox-empty">{t('No customer conversations yet.')}</p>}
      </aside>
      <section className="catalog-chat-conversation">
        {activeThread ? <>
          <header className="catalog-chat-conversation-head"><div><h2>{activeThread.visitorName || t('Catalog visitor')} <span className={`catalog-chat-source ${activeThread.source === 'WEBSITE' ? 'website' : ''}`}>{activeThread.source === 'WEBSITE' ? localized('Website', 'เว็บไซต์') : localized('Catalog', 'แคตตาล็อก')}</span></h2><p>{t('Phone')}: {activeThread.visitorPhone || t('Phone not provided')}{activeThread.visitorEmail ? ` · ${activeThread.visitorEmail}` : ''} · {activeThread.source === 'WEBSITE' ? localized('Homepage chat', 'แชทหน้าเว็บไซต์') : activeThread.catalogTitle || t('Corevity catalog')}</p></div><button type="button" className="button" onClick={toggleStatus}><CheckCheck size={16} />{activeThread.status === 'OPEN' ? t('Close conversation') : t('Reopen conversation')}</button></header>
          <div className="catalog-chat-inbox-feed" ref={feed}>
            {messages.map((message) => <article className={`catalog-chat-inbox-message ${message.senderType === 'SALESPERSON' ? 'mine' : ''}`} key={message.id}>
              <div className="catalog-chat-inbox-bubble"><p>{message.body}</p>{message.products.length > 0 && <div className="catalog-chat-inbox-products">{message.products.map((product) => <a href={`https://catalog.corevityusedgym.com/catalog/products/${encodeURIComponent(product.slug)}`} target="_blank" rel="noreferrer" key={product.slug}>{product.label}</a>)}</div>}<small>{message.senderType === 'SALESPERSON' ? t('Sales') : activeThread.visitorName || t('Customer')} · {timestamp(message.createdAt)}</small></div>
            </article>)}
          </div>
          <form className="catalog-chat-inbox-compose" onSubmit={send}>
            {activeThread.source === 'WEBSITE' && <div className="catalog-chat-attach-area">
              {selectedProducts.length > 0 && <div className="catalog-chat-selected-products">{selectedProducts.map((product) => <span className="catalog-chat-product-chip" key={product.slug}>{product.label}<button type="button" onClick={() => setSelectedProducts((current) => current.filter((item) => item.slug !== product.slug))} aria-label={`${t('Remove')} ${product.label}`}><X size={13} /></button></span>)}</div>}
              <button type="button" className="button catalog-chat-attach-trigger" aria-expanded={productPickerOpen} onClick={() => setProductPickerOpen((open) => !open)}><Paperclip size={15} />{localized('Attach product', 'แนบสินค้า')}</button>
              {productPickerOpen && <div className="catalog-chat-product-picker"><label><Search size={15} /><input autoFocus value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder={localized('Search published products', 'ค้นหาสินค้าที่เผยแพร่')} /></label><div className="catalog-chat-product-options">{productOptions.filter((product) => !selectedProducts.some((selected) => selected.slug === product.slug)).map((product) => <button type="button" key={product.slug} disabled={selectedProducts.length >= 3} onClick={() => setSelectedProducts((current) => [...current, product])}><span>{product.label}<small>{product.category}</small></span><span>{localized('Add', 'เพิ่ม')}</span></button>)}{productOptions.length === 0 && <p>{localized('No published products found.', 'ไม่พบสินค้าที่เผยแพร่')}</p>}</div></div>}
            </div>}
            <div className="catalog-chat-compose-row"><textarea value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={sendOnEnter} maxLength={2000} placeholder={t('Write a reply…')} disabled={activeThread.status !== 'OPEN'} /><button className="primary" disabled={sending || activeThread.status !== 'OPEN' || !body.trim()}><Send size={16} />{t('Send')}</button></div>
          </form>
        </> : <div className="catalog-chat-select-empty"><Inbox size={34} /><strong>{t('Choose a conversation')}</strong><span>{t('Select a customer message to view and reply.')}</span></div>}
      </section>
    </section>
  </>;
}
