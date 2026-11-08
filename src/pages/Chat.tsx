import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  MessageCircle,
  Paperclip,
  Send,
  X,
  ExternalLink,
  Package,
  RadioTower,
  Smile,
  SmilePlus,
} from 'lucide-react';
import type {
  ChatMessage,
  ChatPage as ChatResult,
  ChatProduct,
  ChatReadCursor,
  ChatReaction,
  Product,
  Salesperson,
} from '../../shared/schemas';
import { salespersonName } from '../../shared/schemas';
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
  selected: Pick<ChatProduct, 'id'>[];
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
type ConnectionState = 'connecting' | 'live' | 'reconnecting';
type OnlineUser = { email: string; name: string };
type Mention = { email: string; token: string };
const CHAT_EMOJIS = ['👍', '❤️', '😂', '😮', '🙏', '🎉'] as const;
function asChatProduct(p: Product): ChatProduct {
  return {
    id: p.id,
    sku: p.sku,
    brand: p.brand,
    model: p.model,
    status: p.status,
    sellingPrice: p.sellingPrice,
    primaryImageId: p.primaryImageId,
    archivedAt: p.archivedAt,
  };
}
export function ChatPage({
  compact = false,
  onClose,
}: {
  compact?: boolean;
  onClose?: () => void;
} = {}) {
  const routeLocation = useLocation();
  const requestedMessageId = Number(new URLSearchParams(routeLocation.search).get('message'));
  const targetMessageId = Number.isSafeInteger(requestedMessageId) && requestedMessageId > 0 ? requestedMessageId : 0;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [readCursors, setReadCursors] = useState<Record<string, number>>({});
  const [userEmail, setUserEmail] = useState('');
  const [ready, setReady] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [sendError, setSendError] = useState('');
  const [body, setBody] = useState('');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState(0);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; end: number; query: string } | null>(null);
  const [focusedMessageId, setFocusedMessageId] = useState(0);
  const [selected, setSelected] = useState<ChatProduct[]>([]);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [readSignal, setReadSignal] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const { data: salespeople } = useData<Salesperson[]>('/salespeople');
  const latest = useRef(0);
  const lastMarkedRead = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const focusDone = useRef(false);
  const nearBottom = useRef(!targetMessageId);
  const scrollNext = useRef(false);
  const sendingRef = useRef(false);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const pendingReactions = useRef(new Set<string>());
  useEffect(() => {
    const controller = new AbortController();
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectAttempts = 0;
    let syncing = false;
    let initialLoaded = false;
    let stopped = false;

    function addMessages(incoming: ChatMessage[]) {
      if (!incoming.length) return;
      latest.current = Math.max(
        latest.current,
        ...incoming.map((message) => message.id),
      );
      if (nearBottom.current && !targetMessageId) scrollNext.current = true;
      else if (!nearBottom.current) setUnseen(true);
      setMessages((current) => merge(current, incoming));
    }

    async function sync(initial = false) {
      if (syncing || document.hidden) return;
      syncing = true;
      const loadLatest = initial || !initialLoaded;
      try {
        for (let batch = 0; batch < 20; batch += 1) {
          const page = await api<ChatResult>(
            loadLatest
              ? targetMessageId ? `/chat?around=${targetMessageId}` : '/chat'
              : `/chat?after=${latest.current}`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          setUserEmail(page.userEmail);
          const cursors = page.readCursors ?? [];
          setReadCursors((current) => {
            const next = { ...current };
            for (const cursor of cursors as ChatReadCursor[]) {
              const email = cursor.email.toLowerCase();
              next[email] = Math.max(next[email] ?? 0, cursor.lastReadMessageId);
            }
            return next;
          });
          lastMarkedRead.current = Math.max(
            lastMarkedRead.current,
            cursors.find((cursor) => cursor.email.toLowerCase() === page.userEmail.toLowerCase())?.lastReadMessageId ?? 0,
          );
          setSyncError('');
          setReady(true);
          if (loadLatest) {
            setHasOlder(page.hasMore);
            scrollNext.current = !targetMessageId;
          }
          addMessages(page.messages);
          initialLoaded = true;
          if (loadLatest || !page.hasMore) break;
        }
      } catch (e) {
        if (!controller.signal.aborted) setSyncError((e as Error).message);
      } finally {
        syncing = false;
      }
    }

    function connect() {
      if (stopped || document.hidden) return;
      setConnection(reconnectAttempts ? 'reconnecting' : 'connecting');
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${location.host}/api/chat/socket`);
      socket.addEventListener('open', () => {
        reconnectAttempts = 0;
        setConnection('live');
        void sync();
      });
      socket.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(String(event.data)) as {
            type?: unknown;
            message?: Partial<ChatMessage>;
            users?: unknown;
            readerEmail?: unknown;
            lastReadMessageId?: unknown;
            messageId?: unknown;
            reactions?: unknown;
          };
          if (
            data.type === 'chat.presence' &&
            Array.isArray(data.users) &&
            data.users.every(
              (user) =>
                user &&
                typeof user === 'object' &&
                'email' in user &&
                typeof user.email === 'string' &&
                'name' in user &&
                typeof user.name === 'string',
            )
          )
            setOnlineUsers(data.users as OnlineUser[]);
          if (
            data.type === 'chat.message' &&
            typeof data.message?.id === 'number' &&
            typeof data.message.senderEmail === 'string' &&
            typeof data.message.body === 'string' &&
            Array.isArray(data.message.products)
          )
            addMessages([data.message as ChatMessage]);
          if (
            data.type === 'chat.read' &&
            typeof data.readerEmail === 'string' &&
            typeof data.lastReadMessageId === 'number' &&
            Number.isSafeInteger(data.lastReadMessageId)
          ) {
            const readerEmail = data.readerEmail.toLowerCase();
            setReadCursors((current) =>
              data.lastReadMessageId as number <= (current[readerEmail] ?? 0)
                ? current
                : { ...current, [readerEmail]: data.lastReadMessageId as number },
            );
          }
          if (
            data.type === 'chat.reaction' &&
            typeof data.messageId === 'number' &&
            Array.isArray(data.reactions)
          ) {
            setMessages((current) => current.map((message) =>
              message.id === data.messageId
                ? { ...message, reactions: data.reactions as ChatReaction[] }
                : message,
            ));
          }
        } catch {
          // Ignore malformed frames and keep the authenticated connection open.
        }
      });
      socket.addEventListener('close', () => {
        setOnlineUsers([]);
        if (stopped || document.hidden) return;
        setConnection('reconnecting');
        const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempts);
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(connect, delay);
      });
      socket.addEventListener('error', () => socket?.close());
    }

    function handleVisibility() {
      if (document.hidden) {
        socket?.close(1000, 'Page hidden');
        clearTimeout(reconnectTimer);
        return;
      }
      void sync();
      if (!socket || socket.readyState >= WebSocket.CLOSING) connect();
    }

    void sync(true).then(connect);
    const fallbackTimer = setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN) void sync();
    }, 5_000);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(reconnectTimer);
      clearInterval(fallbackTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      socket?.close(1000, 'Page closed');
    };
  }, [targetMessageId]);
  useEffect(() => { focusDone.current = false; }, [targetMessageId]);
  useEffect(() => {
    if (!targetMessageId || focusDone.current || !messages.some((message) => message.id === targetMessageId)) return;
    const target = document.getElementById(`chat-message-${targetMessageId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFocusedMessageId(targetMessageId);
    focusDone.current = true;
    const timer = window.setTimeout(() => setFocusedMessageId(0), 6000);
    return () => window.clearTimeout(timer);
  }, [targetMessageId, messages]);
  useLayoutEffect(() => {
    if (pendingCaret.current === null || !textarea.current) return;
    const position = pendingCaret.current;
    pendingCaret.current = null;
    textarea.current.focus();
    textarea.current.setSelectionRange(position, position);
  }, [body]);
  useEffect(() => {
    if (scrollNext.current && scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
      nearBottom.current = true;
      scrollNext.current = false;
      setUnseen(false);
    }
  }, [messages]);
  useEffect(() => {
    const messageId = messages.at(-1)?.id ?? 0;
    if (
      !ready || !messageId || messageId <= lastMarkedRead.current ||
      !nearBottom.current || document.hidden || !document.hasFocus()
    ) return;
    lastMarkedRead.current = messageId;
    void api<{ lastReadMessageId: number }>('/chat/read', {
      method: 'POST',
      body: JSON.stringify({ messageId }),
    }).then((result) => {
      const email = userEmail.toLowerCase();
      setReadCursors((current) => ({
        ...current,
        [email]: Math.max(current[email] ?? 0, result.lastReadMessageId),
      }));
    }).catch(() => {
      lastMarkedRead.current = Math.min(lastMarkedRead.current, messageId - 1);
      window.setTimeout(() => setReadSignal((value) => value + 1), 3000);
    });
  }, [messages, readSignal, ready, userEmail]);
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
      mentions: mentions.filter((mention) => body.includes(mention.token)),
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
      setMentions([]);
      setMentionQuery(null);
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
  function updateBody(value: string, cursor: number) {
    setBody(value);
    const match = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, cursor));
    setMentionQuery(match ? {
      start: cursor - match[2].length - 1,
      end: cursor,
      query: match[2],
    } : null);
    setMentions((current) => {
      const uses = new Map<string, number>();
      return current.filter((mention) => {
        const available = value.split(mention.token).length - 1;
        const used = uses.get(mention.token) ?? 0;
        if (used >= available) return false;
        uses.set(mention.token, used + 1);
        return true;
      });
    });
  }
  function insertEmoji(emoji: string) {
    const input = textarea.current;
    const start = input?.selectionStart ?? body.length;
    const end = input?.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${emoji}${body.slice(end)}`;
    if (next.length > 2000) return;
    const caret = start + emoji.length;
    pendingCaret.current = caret;
    updateBody(next, caret);
    setEmojiPickerOpen(false);
  }
  async function toggleReaction(messageId: number, emoji: string) {
    const key = `${messageId}:${emoji}`;
    if (pendingReactions.current.has(key)) return;
    pendingReactions.current.add(key);
    setSyncError('');
    try {
      const result = await api<{ reactions: ChatReaction[] }>(
        `/chat/${messageId}/reactions`,
        { method: 'POST', body: JSON.stringify({ emoji }) },
      );
      setMessages((current) => current.map((message) =>
        message.id === messageId ? { ...message, reactions: result.reactions } : message,
      ));
    } catch (error) {
      setSyncError((error as Error).message);
    } finally {
      pendingReactions.current.delete(key);
    }
  }
  function chooseMention(person: Salesperson) {
    if (!mentionQuery) return;
    const token = `@${salespersonName(person)}`;
    const next = `${body.slice(0, mentionQuery.start)}${token} ${body.slice(mentionQuery.end)}`;
    const caret = mentionQuery.start + token.length + 1;
    pendingCaret.current = caret;
    setBody(next);
    setMentions((current) => [...current, { email: person.email, token }]);
    setMentionQuery(null);
  }
  const mentionMatches = mentionQuery
    ? (salespeople ?? []).filter((person) => person.lineReady &&
      `${salespersonName(person)} ${person.email}`.toLowerCase().includes(mentionQuery.query.toLowerCase()))
        .slice(0, 8)
    : [];
  function messageText(message: ChatMessage) {
    const tokens = [...new Set(message.mentions.map((mention) => mention.token))].sort((a, b) => b.length - a.length);
    if (!tokens.length) return message.body;
    const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const tokenSet = new Set(tokens);
    return message.body.split(new RegExp(`(${escaped.join('|')})`, 'g')).map((part, index) =>
      tokenSet.has(part) ? <span className="chat-mention-token" key={`${index}-${part}`}>{part}</span> : part,
    );
  }
  return (
    <>
      {!compact && (
        <Header
          title={t('Team chat')}
          subtitle={t('One shared conversation for everyone in your workspace.')}
        />
      )}
      <section className={`panel chat-panel${compact ? ' chat-panel-popup' : ''}`}>
        <div className="chat-heading">
          <div className="chat-heading-main">
            <MessageCircle size={20} />
            <strong>{t('Corevity team')}</strong>
            <span className={`chat-connection ${connection}`}>
              <RadioTower size={16} aria-hidden="true" />
              <span>
                {t(
                  connection === 'live'
                    ? 'Live'
                    : connection === 'connecting'
                      ? 'Connecting…'
                      : 'Reconnecting…',
                )}
              </span>
            </span>
            {compact && (
              <div className="chat-popup-heading-actions">
                <Link
                  to="/chat"
                  className="chat-popup-action"
                  aria-label={t('Open full chat')}
                  title={t('Open full chat')}
                  onClick={onClose}
                >
                  <ExternalLink size={17} />
                </Link>
                <button
                  type="button"
                  className="chat-popup-action"
                  aria-label={t('Close')}
                  title={t('Close')}
                  onClick={onClose}
                >
                  <X size={18} />
                </button>
              </div>
            )}
          </div>
          <div className="chat-presence" aria-label={t('Online now')}>
            <span className="chat-presence-label">
              <span className="status-dot" />
              {t('Online now')} · {onlineUsers.length}
            </span>
            <div className="chat-presence-users">
              {onlineUsers.map((user) => (
                <span
                  className="chat-presence-user"
                  key={user.email}
                  title={user.email}
                >
                  {user.name}
                </span>
              ))}
            </div>
          </div>
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
              if (nearBottom.current) {
                setUnseen(false);
                setReadSignal((value) => value + 1);
              }
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
          {messages.map((m) => {
            const readCount = Object.entries(readCursors).filter(
              ([email, lastReadMessageId]) =>
                email !== m.senderEmail.toLowerCase() && lastReadMessageId >= m.id,
            ).length;
            return (
            <article
              id={`chat-message-${m.id}`}
              className={`chat-message ${m.senderEmail === userEmail ? 'mine' : ''}${focusedMessageId === m.id ? ' is-focused' : ''}`}
              data-message-id={m.id}
              key={m.id}
            >
              <div className="chat-message-meta">
                <strong title={m.senderEmail}>{m.senderName}</strong>
                <time dateTime={m.createdAt}>{date(m.createdAt)}</time>
              </div>
              <div className="chat-bubble">
                {m.body && <p>{messageText(m)}</p>}
                {m.products.map((p) => (
                  <EquipmentCard product={p} key={p.id} />
                ))}
              </div>
              <div className={`chat-reactions${m.senderEmail.toLowerCase() === userEmail.toLowerCase() ? ' mine' : ''}`}>
                {m.reactions.map((reaction) => (
                  <button
                    type="button"
                    className={`chat-reaction${reaction.reactedByMe ? ' selected' : ''}`}
                    key={reaction.emoji}
                    aria-label={`${t('React')} ${reaction.emoji}: ${reaction.count}`}
                    aria-pressed={reaction.reactedByMe}
                    onClick={() => void toggleReaction(m.id, reaction.emoji)}
                  >
                    <span aria-hidden="true">{reaction.emoji}</span>
                    <span>{reaction.count}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="chat-reaction-add"
                  aria-label={t('Add a reaction')}
                  title={t('Add a reaction')}
                  aria-expanded={reactionPickerMessageId === m.id}
                  onClick={() => setReactionPickerMessageId((current) => current === m.id ? 0 : m.id)}
                >
                  <SmilePlus size={16} />
                </button>
                {reactionPickerMessageId === m.id && (
                  <div className="chat-reaction-picker" aria-label={t('Choose a reaction')}>
                    {CHAT_EMOJIS.map((emoji) => (
                      <button type="button" key={emoji} aria-label={emoji} onClick={() => {
                        void toggleReaction(m.id, emoji);
                        setReactionPickerMessageId(0);
                      }}>{emoji}</button>
                    ))}
                  </div>
                )}
              </div>
              {m.senderEmail.toLowerCase() === userEmail.toLowerCase() && (
                <small className="chat-read-receipt">
                  {t('Read by')} {readCount} {t(readCount === 1 ? 'person' : 'people')}
                </small>
              )}
            </article>
            );
          })}
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
                setSelected((current) => {
                  const product = asChatProduct(p);
                  return current.length >= 3 ||
                    current.some((item) => item.id === product.id)
                    ? current
                    : [...current, product];
                })
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
              ref={textarea}
              onChange={(e) => updateBody(e.target.value, e.target.selectionStart)}
              onKeyDown={(e) => {
                if (
                  e.key !== 'Enter' ||
                  e.shiftKey ||
                  e.nativeEvent.isComposing ||
                  e.keyCode === 229
                )
                  return;
                e.preventDefault();
                if (ready && !sending && !e.repeat)
                  e.currentTarget.form?.requestSubmit();
              }}
              placeholder={t('Write to your team…')}
            />
          </label>
          {mentionQuery && (
            <div className="chat-mention-suggestions" role="listbox" aria-label={t('Mention a teammate')}>
              {mentionMatches.map((person) => (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  key={person.email}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseMention(person)}
                >
                  <span className="chat-mention-avatar">{salespersonName(person).slice(0, 1).toUpperCase()}</span>
                  <span className="chat-mention-person"><strong>{salespersonName(person)}</strong><small>{person.email}</small></span>
                  <span className="chat-mention-line">{t('LINE connected')}</span>
                </button>
              ))}
              {salespeople && !mentionMatches.length && <p>{t('No LINE-connected teammates found.')}</p>}
              {!salespeople && <p>{t('Loading sales team…')}</p>}
            </div>
          )}
          {emojiPickerOpen && (
            <div className="chat-emoji-picker" aria-label={t('Choose an emoji')}>
              {CHAT_EMOJIS.map((emoji) => (
                <button type="button" key={emoji} aria-label={emoji} onClick={() => insertEmoji(emoji)}>{emoji}</button>
              ))}
            </div>
          )}
          <small>{t('Type @ to mention a teammate. Only teammates connected to LINE appear.')}</small>
          <small>{t('Enter to send · Shift+Enter for a new line')}</small>
          <div className="chat-actions">
            <button
              type="button"
              aria-label={t('Add emoji')}
              title={t('Add emoji')}
              aria-expanded={emojiPickerOpen}
              disabled={sending}
              onClick={() => setEmojiPickerOpen((open) => !open)}
            >
              <Smile size={17} />
            </button>
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
