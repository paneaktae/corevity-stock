import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Package, Send, Sparkles } from 'lucide-react';
import type { ChatProduct } from '../../shared/schemas';
import { api, date, money } from '../lib';
import { getLanguage, t } from '../i18n';
import { Badge, ErrorBox, Header, Loading } from '../components/ui';

type AssistantMessage = {
  id: number;
  role: 'user' | 'assistant';
  body: string;
  createdAt: string;
  products: ChatProduct[];
};

function EquipmentCard({ product }: { product: ChatProduct }) {
  return (
    <a className="chat-product" href={`/inventory/${product.id}`}>
      {product.primaryImageId && !product.archivedAt ? (
        <img src={`/api/images/${product.primaryImageId}`} alt="" loading="lazy" />
      ) : (
        <Package size={24} />
      )}
      <div>
        <strong>{product.brand} {product.model}</strong>
        <small>{product.sku} · {money(product.sellingPrice)}</small>
        <Badge value={product.status} />
      </div>
    </a>
  );
}

export function InventoryAssistantPage() {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const feed = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void api<{ messages: AssistantMessage[] }>('/chat/assistant', {
      signal: controller.signal,
    })
      .then((result) => setMessages(result.messages))
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setReady(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [messages, busy]);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const message = query.trim();
    if (!message || busy) return;
    setBusy(true);
    setError('');
    setQuery('');
    try {
      const result = await api<{ messages: AssistantMessage[] }>(
        '/chat/assistant',
        {
          method: 'POST',
          body: JSON.stringify({ message, history: [], language: getLanguage() }),
        },
      );
      setMessages((current) => [...current, ...result.messages]);
    } catch (e) {
      setQuery(message);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header
        title={t('AI product search')}
        subtitle={t('A private AI conversation to find products in your inventory.')}
      />
      <section className="panel assistant-page">
        <div className="chat-assistant-heading">
          <div>
            <h3>{t('AI inventory assistant')}</h3>
            <p>{t('Ask about products in your inventory. AI will use saved product details.')}</p>
            <small>{t('This conversation and its history are private to your account.')}</small>
          </div>
          <Sparkles size={20} />
        </div>
        <ErrorBox message={error} />
        {!ready && !error && <Loading />}
        <div className="chat-assistant-feed assistant-page-feed" ref={feed} aria-live="polite">
          {ready && !messages.length && (
            <p className="muted">{t('Try asking for a product by type, brand, or price.')}</p>
          )}
          {messages.map((message) => (
            <article className={`assistant-turn ${message.role}`} key={message.id}>
              <p>{message.body}</p>
              {message.products.map((product) => (
                <EquipmentCard product={product} key={product.id} />
              ))}
              <time dateTime={message.createdAt}>{date(message.createdAt)}</time>
            </article>
          ))}
          {busy && (
            <div className="assistant-thinking" role="status">
              <span className="ai-generating-spinner" />
              {t('Searching inventory with AI…')}
            </div>
          )}
        </div>
        <form className="assistant-composer" onSubmit={(e) => void ask(e)}>
          <input
            autoFocus
            value={query}
            disabled={busy || !ready}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Ask about your equipment…')}
            aria-label={t('Ask about your equipment…')}
            maxLength={1000}
          />
          <button className="primary" disabled={busy || !ready || !query.trim()}>
            <Send size={16} />
            {t('Ask AI')}
          </button>
        </form>
      </section>
    </>
  );
}
