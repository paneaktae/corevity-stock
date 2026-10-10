import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Paperclip, Send, X, Package } from 'lucide-react';
import type {
  ChatMessage,
  ChatPage as ChatResult,
  ChatProduct,
  Product,
} from '../../shared/schemas';
import { api, date, money, useData, useDebounce } from '../lib';
import { t } from '../i18n';
import { Badge, ErrorBox, Header, Loading } from '../components/ui';

function EquipmentCard({ product: p }: { product: ChatProduct }) {
  const content = (
    <>
      {p.primaryImageId && !p.archivedAt ? (
        <img src={`/api/images/${p.primaryImageId}`} alt="" loading="lazy" />
      ) : (
        <Package size={24} />
      )}
      <div>
        <strong>
          {p.brand} {p.model}
        </strong>
        <small>
          {p.sku} · {money(p.sellingPrice)}
        </small>
        <Badge value={p.status} />
        {p.archivedAt && <small>{t('Equipment archived')}</small>}
      </div>
    </>
  );
  return p.archivedAt ? (
    <div className="chat-product">{content}</div>
  ) : (
    <Link className="chat-product" to={`/inventory/${p.id}`}>
      {content}
    </Link>
  );
}
function ProductPicker({
  selected,
  onSelect,
  onClose,
}: {
  selected: Product[];
  onSelect: (p: Product) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const search = useDebounce(query);
  const { data, error } = useData<Product[]>(
    `/products?q=${encodeURIComponent(search)}`,
  );
  return (
    <section className="chat-picker" aria-label={t('Attach equipment')}>
      <div className="section-heading">
        <h3>{t('Attach equipment')}</h3>
        <button type="button" onClick={onClose} aria-label={t('Close')}>
          <X size={16} />
        </button>
      </div>
      <input
        autoFocus
        type="search"
        aria-label={t('Search equipment by brand, model or SKU')}
        placeholder={t('Search equipment by brand, model or SKU')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ErrorBox message={error} />
      {!data && !error && <Loading />}
      <div className="chat-picker-results">
        {data?.slice(0, 30).map((p) => (
          <button
            type="button"
            key={p.id}
            disabled={
              selected.length >= 3 || selected.some((s) => s.id === p.id)
            }
            onClick={() => onSelect(p)}
          >
            <span>
              <strong>
                {p.brand} {p.model}
              </strong>
              <small>
                {p.sku} · {money(p.sellingPrice)}
              </small>
            </span>
            <Badge value={p.status} />
          </button>
        ))}
      </div>
      {data?.length === 0 && <p>{t('No equipment found.')}</p>}
      {!!data && data.length > 30 && (
        <small>{t('Type more to narrow your search.')}</small>
      )}
    </section>
  );
}
function merge(current: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map(current.map((m) => [m.id, m]));
  incoming.forEach((m) => map.set(m.id, m));
  return [...map.values()].sort((a, b) => a.id - b.id);
}
export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userEmail, setUserEmail] = useState('');
  const [ready, setReady] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [sendError, setSendError] = useState('');
  const [body, setBody] = useState('');
  const [selected, setSelected] = useState<Product[]>([]);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const latest = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const scrollNext = useRef(false);
  const sendingRef = useRef(false);
  const request = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let initialized = false;
    async function poll() {
      let more = false;
      try {
        if (!document.hidden) {
          const page = await api<ChatResult>(
            initialized ? `/chat?after=${latest.current}` : '/chat',
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          setUserEmail(page.userEmail);
          setSyncError('');
          setReady(true);
          if (!initialized) {
            setHasOlder(page.hasMore);
            scrollNext.current = true;
          } else more = page.hasMore;
          if (page.messages.length) {
            latest.current = Math.max(
              latest.current,
              ...page.messages.map((m) => m.id),
            );
            if (nearBottom.current) scrollNext.current = true;
            else setUnseen(true);
            setMessages((current) => merge(current, page.messages));
          }
          initialized = true;
        }
      } catch (e) {
        if (!controller.signal.aborted) setSyncError((e as Error).message);
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void poll(), more ? 250 : 5000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (scrollNext.current && scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
      scrollNext.current = false;
      setUnseen(false);
    }
  }, [messages]);
  async function older() {
    if (!messages.length || loadingOlder) return;
    setLoadingOlder(true);
    const el = scroll.current,
      height = el?.scrollHeight ?? 0,
      top = el?.scrollTop ?? 0;
    try {
      const page = await api<ChatResult>(`/chat?before=${messages[0].id}`);
      setHasOlder(page.hasMore);
      setMessages((current) => merge(current, page.messages));
      setSyncError('');
      requestAnimationFrame(() => {
        if (el) el.scrollTop = top + el.scrollHeight - height;
      });
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (sendingRef.current || (!body.trim() && !selected.length)) return;
    sendingRef.current = true;
    setSending(true);
    setSendError('');
    const payload = {
      body: body.trim(),
      productIds: selected.map((p) => p.id),
    };
    const signature = JSON.stringify(payload);
    if (request.current?.signature !== signature)
      request.current = { signature, id: crypto.randomUUID() };
    try {
      const message = await api<ChatMessage>('/chat', {
        method: 'POST',
        body: JSON.stringify({ ...payload, requestId: request.current.id }),
      });
      // Leave the polling cursor unchanged so messages sent by teammates meanwhile aren't skipped.
      scrollNext.current = true;
      setMessages((current) => merge(current, [message]));
      setBody('');
      setSelected([]);
      setPicking(false);
      request.current = null;
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  return (
    <>
      <Header
        title={t('Team chat')}
        subtitle={t('One shared conversation for everyone in your workspace.')}
      />
      <section className="panel chat-panel">
        <div className="chat-heading">
          <MessageCircle size={18} />
          <strong>{t('Corevity team')}</strong>
          <small>{t('Updates automatically every 5 seconds')}</small>
        </div>
        <ErrorBox message={syncError} />
        {!ready && !syncError && <Loading />}
        <div
          className="chat-feed"
          ref={scroll}
          role="region"
          aria-label={t('Chat messages')}
          tabIndex={0}
          onScroll={() => {
            const el = scroll.current;
            if (el) {
              nearBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              if (nearBottom.current) setUnseen(false);
            }
          }}
        >
          {hasOlder && (
            <button
              className="chat-older"
              disabled={loadingOlder}
              onClick={() => void older()}
            >
              {t(loadingOlder ? 'Loading…' : 'Load older messages')}
            </button>
          )}
          {ready && !messages.length && (
            <div className="empty">
              <MessageCircle size={30} />
              <h3>{t('Start the conversation')}</h3>
              <p>{t('Send a message or share equipment with your team.')}</p>
            </div>
          )}
          {messages.map((m) => (
            <article
              className={`chat-message ${m.senderEmail === userEmail ? 'mine' : ''}`}
              key={m.id}
            >
              <div className="chat-message-meta">
                <strong title={m.senderEmail}>{m.senderName}</strong>
                <time dateTime={m.createdAt}>{date(m.createdAt)}</time>
              </div>
              <div className="chat-bubble">
                {m.body && <p>{m.body}</p>}
                {m.products.map((p) => (
                  <EquipmentCard product={p} key={p.id} />
                ))}
              </div>
            </article>
          ))}
        </div>
        {unseen && (
          <button
            className="chat-new"
            onClick={() => {
              if (scroll.current)
                scroll.current.scrollTop = scroll.current.scrollHeight;
              setUnseen(false);
            }}
          >
            {t('New messages ↓')}
          </button>
        )}
        <form className="chat-composer" onSubmit={(e) => void send(e)}>
          <ErrorBox message={sendError} />
          {selected.length > 0 && (
            <div className="chat-selected">
              {selected.map((p) => (
                <div key={p.id}>
                  <span>
                    {p.brand} {p.model} · {p.sku}
                  </span>
                  <button
                    type="button"
                    disabled={sending}
                    aria-label={`${t('Remove attachment')}: ${p.sku}`}
                    onClick={() =>
                      setSelected((current) =>
                        current.filter((item) => item.id !== p.id),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {picking && !sending && (
            <ProductPicker
              selected={selected}
              onSelect={(p) =>
                setSelected((current) =>
                  current.length >= 3 ||
                  current.some((item) => item.id === p.id)
                    ? current
                    : [...current, p],
                )
              }
              onClose={() => setPicking(false)}
            />
          )}
          <label className="field">
            <span>{t('Message')}</span>
            <textarea
              rows={3}
              maxLength={2000}
              disabled={sending}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('Write to your team…')}
            />
          </label>
          <div className="chat-actions">
            <button
              type="button"
              disabled={sending || selected.length >= 3}
              onClick={() => setPicking(!picking)}
            >
              <Paperclip size={17} />
              {t('Attach equipment')} ({selected.length}/3)
            </button>
            <small>{body.length}/2000</small>
            <button
              className="primary"
              disabled={!ready || sending || (!body.trim() && !selected.length)}
            >
              <Send size={17} />
              {t(sending ? 'Sending…' : 'Send')}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
