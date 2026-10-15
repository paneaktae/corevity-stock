import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, RefreshCw, Send } from 'lucide-react';
import { api } from '../lib';
import { t } from '../i18n';
import { ErrorBox, Header, Loading } from '../components/ui';

type Thread = {
  id: string;
  catalogSlug: string;
  catalogTitle: string;
  visitorName: string;
  visitorPhone: string;
  assignedEmail: string;
  status: 'OPEN' | 'CLOSED';
  lastMessageAt: string;
  lastMessage: string | null;
  lastSender: 'VISITOR' | 'SALESPERSON' | null;
};
type Message = {
  id: number;
  senderType: 'VISITOR' | 'SALESPERSON';
  senderEmail: string;
  body: string;
  products: Array<{ itemId: string; label: string }>;
  createdAt: string;
};
type Detail = { thread: Thread & { createdAt: string }; messages: Message[] };

const dateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

export function CatalogChatsPage() {
  const location = useLocation();
  const requestedThread = new URLSearchParams(location.search).get('thread');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedId, setSelectedId] = useState(requestedThread ?? '');
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadThreads = useCallback(async () => {
    const response = await api<{ threads: Thread[] }>('/catalog-chats');
    setThreads(response.threads);
    if (!selectedId && response.threads[0])
      setSelectedId(response.threads[0].id);
  }, [selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      return;
    }
    const response = await api<Detail>(
      `/catalog-chats/${encodeURIComponent(id)}`,
    );
    setDetail(response);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        await loadThreads();
        if (active && selectedId) await loadDetail(selectedId);
        if (active) setError('');
      } catch (cause) {
        if (active) setError((cause as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loadDetail, loadThreads, selectedId]);

  useEffect(() => {
    setSelectedId(requestedThread ?? '');
  }, [requestedThread]);

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !reply.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api(`/catalog-chats/${encodeURIComponent(selectedId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: reply.trim() }),
      });
      setReply('');
      await Promise.all([loadDetail(selectedId), loadThreads()]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: 'OPEN' | 'CLOSED') {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    try {
      await api(`/catalog-chats/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await Promise.all([loadDetail(selectedId), loadThreads()]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header
        title={t('Catalog inquiries')}
        subtitle={t(
          'Review visitor questions and follow up from the assigned salesperson inbox.',
        )}
        action={
          <button
            className="secondary"
            type="button"
            onClick={() => void loadThreads()}
          >
            <RefreshCw size={16} /> {t('Refresh')}
          </button>
        }
      />
      <ErrorBox message={error} />
      {loading ? <Loading /> : null}
      {!loading && (
        <section className="catalog-chat-manager">
          <aside className="catalog-chat-inbox panel">
            <h2>
              {t('Conversations')} <span>{threads.length}</span>
            </h2>
            {!threads.length ? (
              <p className="muted">{t('No catalog inquiries yet.')}</p>
            ) : null}
            {threads.map((thread) => (
              <button
                className={`catalog-chat-thread${thread.id === selectedId ? ' selected' : ''}`}
                key={thread.id}
                type="button"
                onClick={() => setSelectedId(thread.id)}
              >
                <span className="catalog-chat-thread-top">
                  <strong>{thread.visitorName || t('Catalog visitor')}</strong>
                  <span
                    className={`status-pill ${thread.status.toLowerCase()}`}
                  >
                    {t(thread.status)}
                  </span>
                </span>
                <span className="catalog-chat-thread-catalog">
                  {thread.catalogTitle}
                </span>
                <span className="catalog-chat-thread-preview">
                  {thread.lastMessage || t('No messages')}
                </span>
                <time>{dateTime(thread.lastMessageAt)}</time>
              </button>
            ))}
          </aside>
          <section className="catalog-chat-conversation panel">
            {!detail ? (
              <div className="catalog-chat-empty">
                {t('Choose a conversation to review.')}
              </div>
            ) : (
              <>
                <header className="catalog-chat-detail-header">
                  <div>
                    <h2>{detail.thread.visitorName || t('Catalog visitor')}</h2>
                    <p>
                      {detail.thread.catalogTitle} ·{' '}
                      {detail.thread.visitorPhone || t('No phone provided')}
                    </p>
                    <small>
                      {t('Assigned to')}:{' '}
                      {detail.thread.assignedEmail || t('Unassigned')}
                    </small>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void setStatus(
                        detail.thread.status === 'OPEN' ? 'CLOSED' : 'OPEN',
                      )
                    }
                  >
                    {detail.thread.status === 'OPEN'
                      ? t('Close conversation')
                      : t('Reopen conversation')}
                  </button>
                </header>
                <div className="catalog-chat-history">
                  {detail.messages.map((message) => (
                    <article
                      className={`catalog-chat-message ${message.senderType.toLowerCase()}`}
                      key={message.id}
                    >
                      <div className="catalog-chat-message-meta">
                        <strong>
                          {message.senderType === 'VISITOR'
                            ? detail.thread.visitorName
                            : message.senderEmail}
                        </strong>
                        <time>{dateTime(message.createdAt)}</time>
                      </div>
                      <p>{message.body}</p>
                      {message.products.length ? (
                        <div className="catalog-chat-message-products">
                          {message.products.map((product) => (
                            <span key={product.itemId}>{product.label}</span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
                <form
                  className="catalog-chat-reply"
                  onSubmit={(event) => void sendReply(event)}
                >
                  <textarea
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder={t('Write a reply…')}
                    disabled={busy || detail.thread.status !== 'OPEN'}
                  />
                  <button
                    className="primary"
                    type="submit"
                    disabled={
                      busy || !reply.trim() || detail.thread.status !== 'OPEN'
                    }
                  >
                    {busy ? <Check size={16} /> : <Send size={16} />}{' '}
                    {t('Send reply')}
                  </button>
                  {detail.thread.status !== 'OPEN' ? (
                    <small>{t('Reopen this conversation to reply.')}</small>
                  ) : null}
                </form>
              </>
            )}
          </section>
        </section>
      )}
    </>
  );
}
