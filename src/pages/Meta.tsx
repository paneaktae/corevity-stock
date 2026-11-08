import { useEffect, useState } from 'react';
import { Link, NavLink, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  PackagePlus,
  ShieldCheck,
  Check,
  Plus,
  Settings,
} from 'lucide-react';
import type { MetaStatus } from '../../shared/meta';
import {
  conversationStatuses,
  type MetaConversation,
  type MetaMessage,
  type MetaReport,
  type MetaDraft,
} from '../../shared/meta-domain';
import type { Customer, Salesperson } from '../../shared/schemas';
import { api, date, money, label, useData, useDebounce } from '../lib';
import { Header, ErrorBox, Loading, Field, Empty } from '../components/ui';
import { SalespersonSelect } from '../components/SalespersonSelect';
import { DateFilters, dateDefaults } from '../components/MetaDateFilters';
import { AdsDashboard } from '../components/AdsDashboard';
import { useLanguage } from '../i18n';
import {
  metaCopy as copy,
  useMetaData,
  type SharedProduct,
  type AiDraftResponse,
} from '../meta';
const tabs = [
  ['inbox', 'Inbox', 'กล่องข้อความ'],
  ['leads', 'Leads', 'ลีด'],
  ['ads', 'Ads dashboard', 'รายงานโฆษณา'],
  ['campaigns', 'Campaigns', 'แคมเปญ'],
  ['insights', 'Page insights', 'ข้อมูลเชิงลึกเพจ'],
  ['content', 'Content', 'เนื้อหาเพจ'],
  ['webhooks', 'Webhooks', 'Webhook'],
] as const;
const json = (value: unknown) => JSON.stringify(value, null, 2);
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
function ModeBanner({ status }: { status: MetaStatus }) {
  return (
    <div
      className={
        'meta-workspace-mode ' + (status.mode === 'DEMO' ? 'demo' : 'live')
      }
      role="status"
    >
      <ShieldCheck size={19} />
      <div>
        <strong>
          {status.mode === 'DEMO'
            ? 'DEMO MODE'
            : copy('LIVE MODE', 'โหมด Live')}
        </strong>
        <span>
          {status.mode === 'DEMO'
            ? copy(
                'All data and actions are simulated. No requests are sent to Meta.',
                'ข้อมูลและการทำงานจำลองทั้งหมด ไม่มีการเรียก Meta',
              )
            : copy(
                'Real Meta assets. Sending and publishing always require staff confirmation.',
                'ใช้ข้อมูล Meta จริง การส่งและเผยแพร่ต้องมีคนยืนยัน',
              )}
        </span>
      </div>
      <Link to="/settings?tab=integrations">
        <Settings size={16} />
        {copy('Setup', 'ตั้งค่า')}
      </Link>
    </div>
  );
}
export function MetaPage() {
  useLanguage();
  const { section = 'inbox' } = useParams();
  const {
    data: status,
    error,
    reload,
  } = useMetaData<MetaStatus>('/integrations/meta/status');
  const selected = tabs.find((v) => v[0] === section);
  return (
    <>
      <Header
        title={
          'Meta · ' +
          (selected
            ? copy(selected[1], selected[2])
            : copy('Workspace', 'พื้นที่ทำงาน'))
        }
        subtitle={copy(
          'Facebook conversations, leads and reviewed business actions.',
          'ดูแลข้อความ ลีด และงานที่ผ่านการตรวจทานก่อนส่งไป Facebook',
        )}
        action={
          <button onClick={reload} aria-label={copy('Refresh', 'รีเฟรช')}>
            <RefreshCw size={16} />
          </button>
        }
      />
      <ErrorBox message={error} />
      {!status && !error && <Loading />}
      {status && (
        <>
          <ModeBanner status={status} />
          <nav
            className="meta-workspace-tabs"
            aria-label={copy('Meta sections', 'หมวด Meta')}
          >
            {tabs.map(([path, en, th]) => (
              <NavLink key={path} to={'/meta/' + path}>
                {copy(en, th)}
              </NavLink>
            ))}
          </nav>
          {!status.enabled ? (
            <SetupNotice />
          ) : section === 'inbox' ? (
            status.capabilities.readMessenger ? (
              <MetaInbox status={status} />
            ) : (
              <SetupNotice />
            )
          ) : section === 'leads' ? (
            status.capabilities.syncLeads ? (
              <MetaLeads status={status} />
            ) : (
              <SetupNotice />
            )
          ) : section === 'ads' || section === 'insights' ? (
            status.capabilities[
              section === 'ads' ? 'readAds' : 'readPageInsights'
            ] ? (
              <MetaAnalytics
                key={section}
                page={section === 'insights'}
                status={status}
              />
            ) : (
              <SetupNotice />
            )
          ) : section === 'campaigns' || section === 'content' ? (
            status.capabilities[
              section === 'campaigns' ? 'readAds' : 'readContent'
            ] ? (
              <MetaPublishing
                key={section}
                posts={section === 'content'}
                status={status}
              />
            ) : (
              <SetupNotice />
            )
          ) : section === 'webhooks' ? (
            status.capabilities.manageIntegration ? (
              <MetaWebhooks />
            ) : (
              <SetupNotice />
            )
          ) : (
            <Empty title="Page not found" />
          )}
        </>
      )}
    </>
  );
}
function SetupNotice() {
  return (
    <section className="panel meta-setup-notice">
      <Settings size={28} />
      <h2>
        {copy(
          'This feature needs configuration or permissions',
          'ฟีเจอร์นี้ต้องตั้งค่าหรือได้รับสิทธิ์ก่อน',
        )}
      </h2>
      <p>
        {copy(
          'The setup guide stays available. For Demo, enable the integration and the feature flags in Worker configuration.',
          'เปิดดูคู่มือตั้งค่าได้เสมอ หากต้องการทดลอง ให้เปิดการเชื่อมต่อและ Feature Flags ที่ต้องใช้ใน Worker',
        )}
      </p>
      <Link className="button primary" to="/settings?tab=integrations">
        {copy('Open Meta settings', 'เปิดการตั้งค่า Meta')}
      </Link>
    </section>
  );
}
function MetaInbox({ status }: { status: MetaStatus }) {
  const [inboxParams, setInboxParams] = useSearchParams();
  const selected = inboxParams.get('conversation');
  const setSelected = (id: string | null) => {
    const next = new URLSearchParams(inboxParams);
    if (id) next.set('conversation', id);
    else next.delete('conversation');
    setInboxParams(next);
  };
  const [q, setQ] = useState(''),
    [filter, setFilter] = useState(''),
    [older, setOlder] = useState<MetaConversation[]>([]);
  const [olderNext, setOlderNext] = useState<
      { before: string; beforeId: string } | null | undefined
    >(undefined),
    [listError, setListError] = useState('');
  const search = useDebounce(q),
    query = new URLSearchParams({ q: search, status: filter });
  const list = useMetaData<{
    conversations: MetaConversation[];
    next: { before: string; beforeId: string } | null;
  }>('/meta/conversations?' + query, 5000);
  const conversations = [...(list.data?.conversations ?? []), ...older].filter(
    (v, index, all) => all.findIndex((x) => x.id === v.id) === index,
  );
  const loadMore = async () => {
    const cursor = olderNext === undefined ? list.data?.next : olderNext;
    if (!cursor) return;
    try {
      const next = await api<{
        conversations: MetaConversation[];
        next: { before: string; beforeId: string } | null;
      }>(
        '/meta/conversations?' +
          new URLSearchParams({ ...Object.fromEntries(query), ...cursor }),
      );
      setOlder((v) => [...v, ...next.conversations]);
      setOlderNext(next.next);
    } catch (reason) {
      setListError((reason as Error).message);
    }
  };
  return (
    <div className={'meta-inbox-layout' + (selected ? ' has-selection' : '')}>
      <aside className="panel meta-conversation-list">
        <label className="field">
          <span>{copy('Search conversations', 'ค้นหาบทสนทนา')}</span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOlder([]);
              setOlderNext(undefined);
            }}
            placeholder={copy('Name or sender ID', 'ชื่อหรือรหัสผู้ส่ง')}
          />
        </label>
        <label className="field">
          <span>{copy('Conversation status', 'สถานะบทสนทนา')}</span>
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setOlder([]);
              setOlderNext(undefined);
            }}
          >
            <option value="">{copy('All statuses', 'ทุกสถานะ')}</option>
            {conversationStatuses.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <ErrorBox message={listError || list.error} />
        {!list.data && !list.error && <Loading />}
        {list.data && !conversations.length && (
          <p className="muted">
            {copy(
              'No conversations yet. New authorized webhook messages will appear here.',
              'ยังไม่มีบทสนทนา ข้อความจาก Webhook ที่ได้รับอนุญาตจะแสดงที่นี่',
            )}
          </p>
        )}
        {conversations.map((conversation) => (
          <button
            className={
              'meta-conversation-option' +
              (selected === conversation.id ? ' selected' : '')
            }
            key={conversation.id}
            onClick={() => setSelected(conversation.id)}
          >
            <span className="meta-demo-avatar">
              {conversation.display_name.slice(0, 1)}
            </span>
            <span>
              <strong>{conversation.display_name}</strong>
              <small>
                {conversation.status} · {date(conversation.last_message_at)}
              </small>
            </span>
            {conversation.unread_count > 0 && (
              <b>{conversation.unread_count}</b>
            )}
          </button>
        ))}
        {(olderNext === undefined ? list.data?.next : olderNext) && (
          <button onClick={() => void loadMore()}>
            {copy('Load older conversations', 'โหลดบทสนทนาเก่า')}
          </button>
        )}
      </aside>
      {selected ? (
        <ConversationDetail
          key={selected}
          id={selected}
          status={status}
          onBack={() => setSelected(null)}
          onChange={list.reload}
        />
      ) : (
        <section className="panel meta-conversation-placeholder">
          <MessageCircle size={32} />
          <p>{copy('Select a conversation', 'เลือกบทสนทนา')}</p>
        </section>
      )}
    </div>
  );
}
type ConversationDetailData = {
  conversation: MetaConversation;
  customer: Record<string, unknown> | null;
  messages: MetaMessage[];
  notes: {
    id: string;
    body: string;
    actor_email: string;
    created_at: string;
  }[];
  lead: {
    id: string;
    title?: string;
    status?: string;
    estimated_value?: number;
    next_follow_up_at?: string | null;
    viewing_at?: string | null;
  } | null;
  messagingWindowOpen: boolean;
  next: { before: string; beforeId: string } | null;
};
function ConversationDetail({
  id,
  status,
  onBack,
  onChange,
}: {
  id: string;
  status: MetaStatus;
  onBack: () => void;
  onChange: () => void;
}) {
  const path = '/meta/conversations/' + encodeURIComponent(id),
    detail = useMetaData<ConversationDetailData>(path, 5000);
  const [draft, setDraft] = useState(''),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [productsOpen, setProductsOpen] = useState(false),
    [customerId, setCustomerId] = useState(''),
    [newCustomerName, setNewCustomerName] = useState(''),
    [newCustomerPhone, setNewCustomerPhone] = useState(''),
    [leadTitle, setLeadTitle] = useState(''),
    [leadValue, setLeadValue] = useState(''),
    [older, setOlder] = useState<MetaMessage[]>([]);
  const [ai, setAi] = useState<AiDraftResponse | null>(null),
    [aiApproved, setAiApproved] = useState(false),
    [language, setLanguage] = useState<'th' | 'en'>('en'),
    [followUp, setFollowUp] = useState(''),
    [viewingAt, setViewingAt] = useState(''),
    [assigned, setAssigned] = useState('');
  const [historyNext, setHistoryNext] = useState<
      { before: string; beforeId: string } | null | undefined
    >(undefined),
    [summary, setSummary] = useState('');
  const [sendRequest, setSendRequest] = useState<{
    text: string;
    id: string;
  } | null>(null);
  const customers = useData<Customer[]>(
      status.mode === 'LIVE' ? '/customers' : null,
    ),
    team = useData<Salesperson[]>('/salespeople');
  useEffect(() => {
    void api(path, { method: 'PATCH', body: json({ markRead: true }) })
      .then(onChange)
      .catch(() => undefined);
  }, [path, onChange]);
  const act = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await task();
      detail.reload();
      onChange();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!detail.data)
    return (
      <section className="panel">
        <button onClick={onBack}>
          <ArrowLeft size={16} />
          {copy('Back', 'กลับ')}
        </button>
        <ErrorBox message={detail.error} />
        {!detail.error && <Loading />}
      </section>
    );
  const { conversation, messages, notes } = detail.data;
  const allMessages = [...older, ...messages].filter(
    (v, index, all) => all.findIndex((x) => x.id === v.id) === index,
  );
  const generate = async (kind: 'REPLY' | 'SUMMARY' | 'TRANSLATION') => {
    const result = await api<AiDraftResponse>('/meta/ai/suggest-reply', {
      method: 'POST',
      body: json({ conversationId: id, kind, language }),
    });
    if (kind === 'SUMMARY') {
      setSummary(result.content.text);
      return;
    }
    setAi(result);
    setAiApproved(false);
    setDraft(result.content.text);
  };
  const send = async () => {
    if (
      !window.confirm(
        status.mode === 'DEMO'
          ? copy(
              'Simulate sending this message?',
              'จำลองการส่งข้อความนี้หรือไม่?',
            )
          : copy(
              'Send this exact message to the customer now?',
              'ส่งข้อความนี้ให้ลูกค้าตอนนี้หรือไม่?',
            ),
      )
    )
      return;
    const request =
      sendRequest?.text === draft
        ? sendRequest
        : { text: draft, id: crypto.randomUUID() };
    setSendRequest(request);
    await api(path + '/messages', {
      method: 'POST',
      body: json({
        text: draft,
        clientRequestId: request.id,
        approvedByHuman: true,
        ...(ai && aiApproved ? { aiDraftId: ai.id } : {}),
      }),
    });
    setDraft('');
    setAi(null);
    setAiApproved(false);
    setSendRequest(null);
  };
  return (
    <div className="meta-conversation-work">
      <section className="panel meta-message-panel">
        <div className="meta-message-heading">
          <button onClick={onBack} className="meta-mobile-back">
            <ArrowLeft size={17} />
            {copy('Back', 'กลับ')}
          </button>
          <div>
            <strong>{conversation.display_name}</strong>
            <small>
              {conversation.page_id} · {conversation.sender_id}
            </small>
          </div>
          <select
            aria-label={copy('Status', 'สถานะ')}
            value={conversation.status}
            disabled={busy}
            onChange={(e) =>
              void act(() =>
                api(path, {
                  method: 'PATCH',
                  body: json({ status: e.target.value }),
                }),
              )
            }
          >
            {conversationStatuses.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
        <ErrorBox message={error || detail.error} />
        <div className="meta-message-feed" aria-live="polite">
          {(historyNext === undefined ? detail.data.next : historyNext) && (
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const result = await api<ConversationDetailData>(
                    path +
                      '?' +
                      new URLSearchParams(
                        (historyNext === undefined
                          ? detail.data!.next
                          : historyNext)!,
                      ),
                  );
                  setOlder((v) => [...result.messages, ...v]);
                  setHistoryNext(result.next);
                })
              }
            >
              {copy('Load earlier messages', 'โหลดข้อความก่อนหน้า')}
            </button>
          )}
          {allMessages.map((message) => (
            <article
              className={
                'meta-live-message ' +
                (message.direction === 'OUTBOUND' ? 'outgoing' : 'incoming')
              }
              key={message.id}
            >
              <div>{message.body}</div>
              <small>
                {date(message.created_at)} · {message.status}
                {status.mode === 'DEMO' ? ' · DEMO' : ''}
              </small>
            </article>
          ))}
        </div>
        <div className="meta-message-compose">
          {status.mode === 'DEMO' && (
            <div className="meta-actions">
              {(['MESSAGE', 'READ'] as const).map((kind) => (
                <button
                  key={kind}
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      api('/meta/demo/events', {
                        method: 'POST',
                        body: json({ kind }),
                      }),
                    )
                  }
                >
                  {kind === 'MESSAGE'
                    ? copy('Simulate incoming message', 'จำลองข้อความเข้า')
                    : copy('Simulate read receipt', 'จำลองอ่านแล้ว')}
                </button>
              ))}
            </div>
          )}
          {summary && (
            <div className="meta-ai-review">
              <strong>{copy('Conversation summary', 'สรุปบทสนทนา')}</strong>
              <p>{summary}</p>
              <button onClick={() => setSummary('')}>
                {copy('Close', 'ปิด')}
              </button>
            </div>
          )}
          {!detail.data.messagingWindowOpen && (
            <p className="meta-window-warning">
              {copy(
                'The standard 24-hour messaging window is closed. Wait for a new customer message.',
                'พ้นช่วงตอบข้อความมาตรฐาน 24 ชั่วโมงแล้ว กรุณารอข้อความใหม่จากลูกค้า',
              )}
            </p>
          )}
          <div className="meta-compose-tools">
            <button disabled={busy} onClick={() => setProductsOpen((v) => !v)}>
              <PackagePlus size={16} />
              {copy('Attach product', 'แนบสินค้า')}
            </button>
            <select
              aria-label={copy('Reply language', 'ภาษาคำตอบ')}
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'th' | 'en')}
            >
              <option value="th">ไทย</option>
              <option value="en">English</option>
            </select>
            {(['REPLY', 'SUMMARY', 'TRANSLATION'] as const).map((kind) => (
              <button
                key={kind}
                disabled={busy || !status.capabilities.useAI}
                onClick={() => void act(() => generate(kind))}
              >
                <Sparkles size={14} />
                {kind === 'REPLY'
                  ? copy('Generate reply', 'ร่างคำตอบ')
                  : kind === 'SUMMARY'
                    ? copy('Summarize', 'สรุป')
                    : copy('Translate', 'แปล')}
              </button>
            ))}
          </div>
          {productsOpen && (
            <ProductPicker
              onPick={(product) => {
                setDraft((v) =>
                  [
                    v,
                    [
                      product.brand + ' ' + product.model,
                      product.condition,
                      product.price !== null ? product.price + ' THB' : '',
                      product.url,
                    ]
                      .filter(Boolean)
                      .join('\n'),
                  ]
                    .filter(Boolean)
                    .join('\n\n'),
                );
                setAi(null);
                setAiApproved(false);
                setProductsOpen(false);
              }}
            />
          )}
          {ai && (
            <div className="meta-ai-review">
              <strong>
                {ai.simulated ? 'DEMO · ' : ''}
                {copy('AI draft · review required', 'ร่าง AI · ต้องตรวจทาน')}
              </strong>
              {ai.content.intent && <small>{ai.content.intent}</small>}
              <p>{ai.content.text}</p>
              <small>{ai.content.followUp}</small>
              {!aiApproved && (
                <button
                  disabled={busy || !draft.trim()}
                  onClick={() =>
                    void act(async () => {
                      await api('/meta/ai/drafts/' + ai.id + '/approve', {
                        method: 'POST',
                        body: json({ text: draft, approvedByHuman: true }),
                      });
                      setAiApproved(true);
                    })
                  }
                >
                  <Check size={14} />
                  {copy('Approve this edited draft', 'อนุมัติร่างที่แก้ไขแล้ว')}
                </button>
              )}
            </div>
          )}
          <label className="field">
            <span>{copy('Message draft', 'ร่างข้อความ')}</span>
            <textarea
              rows={4}
              maxLength={2000}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setAiApproved(false);
              }}
            />
          </label>
          <div className="meta-send-footer">
            <small>
              {draft.length}/2000 ·{' '}
              {status.mode === 'DEMO'
                ? copy('Simulated send', 'ส่งจำลอง')
                : copy('Text messages only', 'ข้อความตัวอักษร')}
            </small>
            <button
              className="primary"
              disabled={
                busy ||
                !draft.trim() ||
                !detail.data.messagingWindowOpen ||
                !status.capabilities.sendMessage ||
                Boolean(ai && !aiApproved)
              }
              onClick={() => void act(send)}
            >
              <Send size={16} />
              {status.mode === 'DEMO'
                ? copy('Simulate send', 'จำลองส่ง')
                : copy('Send', 'ส่ง')}
            </button>
          </div>
        </div>
      </section>
      <aside className="panel meta-customer-panel">
        <details open>
          <summary>
            {copy('Customer and sales opportunity', 'ลูกค้าและโอกาสขาย')}
          </summary>
          <p>
            {detail.data.customer
              ? text(detail.data.customer.name)
              : copy('Unlinked conversation', 'ยังไม่ผูกกับลูกค้า')}
          </p>
          {detail.data.customer && (
            <Link to={'/customers/' + text(detail.data.customer.id)}>
              {copy('Open CRM customer', 'เปิดข้อมูลลูกค้า')}
            </Link>
          )}
          {status.mode === 'LIVE' && (
            <>
              <Field
                label={copy(
                  'Link to existing customer',
                  'ผูกกับลูกค้าที่มีอยู่',
                )}
              >
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">
                    {copy('Choose customer', 'เลือกลูกค้า')}
                  </option>
                  {customers.data?.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                disabled={busy || !customerId}
                onClick={() =>
                  void act(() =>
                    api(path + '/customer', {
                      method: 'POST',
                      body: json({ customerId }),
                    }),
                  )
                }
              >
                {copy('Link customer', 'ผูกลูกค้า')}
              </button>
              {!conversation.customer_id && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(async () => {
                      await api(path + '/customer/new', {
                        method: 'POST',
                        body: json({
                          name: newCustomerName.trim(),
                          phone: newCustomerPhone.trim(),
                        }),
                      });
                      customers.reload();
                    });
                  }}
                >
                  <h3>
                    {copy('Create customer from chat', 'สร้างลูกค้าจากแชทนี้')}
                  </h3>
                  <Field label={copy('Customer name', 'ชื่อลูกค้า')}>
                    <input
                      required
                      maxLength={200}
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      placeholder={conversation.display_name}
                    />
                  </Field>
                  <Field label={copy('Phone (optional)', 'เบอร์โทร (ถ้ามี)')}>
                    <input
                      type="tel"
                      maxLength={100}
                      value={newCustomerPhone}
                      onChange={(e) => setNewCustomerPhone(e.target.value)}
                    />
                  </Field>
                  <p className="muted">
                    {copy(
                      'Check existing customers first to avoid duplicates.',
                      'ตรวจรายชื่อลูกค้าเดิมก่อนสร้าง เพื่อหลีกเลี่ยงข้อมูลซ้ำ',
                    )}
                  </p>
                  <button disabled={busy || !newCustomerName.trim()}>
                    {copy('Create and link customer', 'สร้างและผูกลูกค้า')}
                  </button>
                </form>
              )}
            </>
          )}
          <Field label={copy('Assign conversation', 'ผู้รับผิดชอบบทสนทนา')}>
            <SalespersonSelect
              value={conversation.assigned_to}
              salespeople={team.data}
              disabled={busy}
              onChange={(value) =>
                void act(() =>
                  api(path, {
                    method: 'PATCH',
                    body: json({ assignedTo: value }),
                  }),
                )
              }
            />
          </Field>
          {detail.data.lead ? (
            <div className="meta-sales-progress">
              <h3>
                {detail.data.lead.title ||
                  copy('Sales opportunity', 'โอกาสขาย')}
              </h3>
              <strong>
                {detail.data.lead.status
                  ? label(detail.data.lead.status)
                  : copy('Created', 'สร้างแล้ว')}
              </strong>
              {detail.data.lead.estimated_value !== undefined && (
                <p>{money(detail.data.lead.estimated_value)}</p>
              )}
              {detail.data.lead.viewing_at && (
                <p>
                  {copy('Equipment viewing', 'นัดดูสินค้า')}:{' '}
                  {date(detail.data.lead.viewing_at)}
                </p>
              )}
              {detail.data.lead.next_follow_up_at && (
                <p>
                  {copy('Next follow-up', 'ติดตามครั้งถัดไป')}:{' '}
                  {date(detail.data.lead.next_follow_up_at)}
                </p>
              )}
              {status.mode === 'LIVE' &&
                !['WON', 'LOST'].includes(detail.data.lead.status ?? '') && (
                  <Field label={copy('Sales stage', 'ขั้นตอนการขาย')}>
                    <select
                      disabled={busy}
                      value={detail.data.lead.status}
                      onChange={(e) =>
                        void act(() =>
                          api('/leads/' + detail.data!.lead!.id, {
                            method: 'PATCH',
                            body: json({ status: e.target.value }),
                          }),
                        )
                      }
                    >
                      {['NEW', 'CONTACTED', 'INTERESTED', 'QUOTED'].map(
                        (stage) => (
                          <option key={stage} value={stage}>
                            {label(stage)}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                )}
              {status.mode === 'LIVE' && (
                <Link className="button" to={'/sales/' + detail.data.lead.id}>
                  {copy(
                    'Manage quotation, follow-up and close sale',
                    'จัดการใบเสนอราคา ติดตาม และปิดการขาย',
                  )}
                </Link>
              )}
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act(() =>
                  api(path + '/lead', {
                    method: 'POST',
                    body: json({
                      customerId: conversation.customer_id ?? 'demo:customer',
                      title: leadTitle.trim(),
                      estimatedValue: Number(leadValue || 0),
                      assignedTo: assigned || conversation.assigned_to,
                      nextFollowUpAt: followUp
                        ? new Date(followUp).toISOString()
                        : null,
                      viewingAt: viewingAt
                        ? new Date(viewingAt).toISOString()
                        : null,
                    }),
                  }),
                );
              }}
            >
              <h3>{copy('Create sales opportunity', 'สร้างโอกาสขาย')}</h3>
              <Field label={copy('Opportunity title', 'ชื่อโอกาสขาย')}>
                <input
                  required
                  maxLength={200}
                  value={leadTitle}
                  onChange={(e) => setLeadTitle(e.target.value)}
                  placeholder={copy(
                    'e.g. Treadmill for home gym',
                    'เช่น ลู่วิ่งสำหรับยิมที่บ้าน',
                  )}
                />
              </Field>
              <Field
                label={copy('Estimated value (THB)', 'มูลค่าที่คาดไว้ (บาท)')}
              >
                <input
                  type="number"
                  min="0"
                  max="999999999"
                  step="0.01"
                  value={leadValue}
                  onChange={(e) => setLeadValue(e.target.value)}
                />
              </Field>
              <Field label={copy('Lead owner', 'ผู้รับผิดชอบโอกาสขาย')}>
                <SalespersonSelect
                  value={assigned || conversation.assigned_to}
                  onChange={setAssigned}
                  salespeople={team.data}
                />
              </Field>
              <Field
                label={copy(
                  'Equipment viewing (optional)',
                  'วันนัดดูสินค้า (ถ้ามี)',
                )}
              >
                <input
                  type="datetime-local"
                  value={viewingAt}
                  onChange={(e) => setViewingAt(e.target.value)}
                />
              </Field>
              <Field label={copy('Next follow-up', 'ติดตามครั้งถัดไป')}>
                <input
                  type="datetime-local"
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                />
              </Field>
              <button
                disabled={
                  busy ||
                  !leadTitle.trim() ||
                  (status.mode === 'LIVE' && !conversation.customer_id)
                }
              >
                <Plus size={14} />
                {copy('Create sales opportunity', 'สร้างโอกาสขาย')}
              </button>
              {!conversation.customer_id && status.mode === 'LIVE' && (
                <p className="muted">
                  {copy(
                    'Link a customer above first.',
                    'ผูกลูกค้าด้านบนก่อนสร้างโอกาสขาย',
                  )}
                </p>
              )}
            </form>
          )}
          <h3>{copy('Internal notes', 'บันทึกภายใน')}</h3>
          <label className="field">
            <span>{copy('Private note', 'บันทึกสำหรับทีม')}</span>
            <textarea
              rows={3}
              value={note}
              maxLength={4000}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !note.trim()}
            onClick={() =>
              void act(async () => {
                await api(path + '/notes', {
                  method: 'POST',
                  body: json({ body: note }),
                });
                setNote('');
              })
            }
          >
            {copy('Save note', 'บันทึก')}
          </button>
          {notes.map((entry) => (
            <article className="meta-note" key={entry.id}>
              <p>{entry.body}</p>
              <small>
                {entry.actor_email} · {date(entry.created_at)}
              </small>
            </article>
          ))}
        </details>
      </aside>
    </div>
  );
}
function ProductPicker({
  onPick,
}: {
  onPick: (product: SharedProduct) => void;
}) {
  const [q, setQ] = useState(''),
    [brand, setBrand] = useState(''),
    [category, setCategory] = useState(''),
    [availability, setAvailability] = useState('');
  const query = new URLSearchParams({
    q: useDebounce(q),
    brand,
    category,
    status: availability,
  });
  const result = useMetaData<{ products: SharedProduct[] }>(
    '/meta/products?' + query,
  );
  return (
    <div className="meta-product-picker">
      <div className="meta-picker-filters">
        <input
          aria-label={copy('Search product', 'ค้นหาสินค้า')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={copy('Brand, model or SKU', 'แบรนด์ รุ่น หรือ SKU')}
        />
        <input
          aria-label={copy('Brand', 'แบรนด์')}
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder={copy('Brand', 'แบรนด์')}
        />
        <input
          aria-label={copy('Category', 'หมวดหมู่')}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={copy('Category', 'หมวดหมู่')}
        />
        <select
          aria-label={copy('Availability', 'สถานะสินค้า')}
          value={availability}
          onChange={(e) => setAvailability(e.target.value)}
        >
          <option value="">{copy('All availability', 'ทุกสถานะ')}</option>
          {['AVAILABLE', 'RESERVED', 'NOT_AVAILABLE', 'SOLD'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </div>
      <ErrorBox message={result.error} />
      {result.data?.products.length === 0 && (
        <p className="muted">
          {copy(
            'No publicly shareable products. Publish a product to the existing catalog first.',
            'ไม่มีสินค้าที่แชร์สาธารณะได้ กรุณาเผยแพร่สินค้าในแคตตาล็อกเดิมก่อน',
          )}
        </p>
      )}
      {result.data?.products.map((product) => (
        <button
          key={product.id}
          className="meta-product-option"
          onClick={() => onPick(product)}
        >
          {product.imageUrl && (
            <img
              src={
                '/api/meta/products/' +
                encodeURIComponent(product.id) +
                '/thumbnail'
              }
              alt={product.brand + ' ' + product.model}
              loading="lazy"
            />
          )}
          <span>
            <strong>
              {product.brand} {product.model}
            </strong>
            <small>
              {product.condition} · {product.status}
              {product.price !== null ? ' · ' + product.price + ' THB' : ''}
            </small>
          </span>
          <Plus size={16} />
        </button>
      ))}
    </div>
  );
}
function MetaLeads({ status }: { status: MetaStatus }) {
  const [formsAfter, setFormsAfter] = useState<string | null>(null);
  const result = useMetaData<{
    forms: {
      id: string;
      name: string;
      questions?: { key: string; label: string }[];
    }[];
    mappings: {
      form_id: string;
      field_mapping: string;
      assigned_to: string;
      enabled: number;
    }[];
    events: Record<string, unknown>[];
    after: string | null;
  }>(
    '/meta/leads' +
      (formsAfter ? '?after=' + encodeURIComponent(formsAfter) : ''),
  );
  const team = useData<Salesperson[]>('/salespeople'),
    [formId, setFormId] = useState(''),
    [fields, setFields] = useState<Record<string, string>>({}),
    [assigned, setAssigned] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [next, setNext] = useState<string | null>(null);
  const act = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await task();
      result.reload();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const form = result.data?.forms.find((v) => v.id === formId);
  return (
    <section className="panel meta-leads-page">
      <h2>
        {copy('Lead forms and CRM mappings', 'ฟอร์ม Lead และการผูกข้อมูล CRM')}
      </h2>
      <p className="muted">
        {copy(
          'Map only fields supplied by the authorized form. A live import creates a new customer and lead without name-based merging.',
          'ผูกเฉพาะฟิลด์ที่ฟอร์มได้รับอนุญาตให้ส่งมา การนำเข้าจริงสร้างลูกค้าและลีดใหม่ ไม่รวมข้อมูลด้วยชื่อ',
        )}
      </p>
      <ErrorBox message={result.error || error} />
      {!result.data && !result.error && <Loading />}
      <div className="meta-form-grid">
        <Field label={copy('Lead form', 'ฟอร์ม Lead')}>
          <select
            value={formId}
            onChange={(e) => {
              setFormId(e.target.value);
              const existing = result.data?.mappings.find(
                (v) => v.form_id === e.target.value,
              );
              setFields(existing ? JSON.parse(existing.field_mapping) : {});
              setAssigned(existing?.assigned_to ?? '');
              setNext(null);
            }}
          >
            <option value="">{copy('Select form', 'เลือกฟอร์ม')}</option>
            {result.data?.forms.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={copy('Lead owner', 'ผู้รับผิดชอบลีด')}>
          <SalespersonSelect
            value={assigned}
            onChange={setAssigned}
            salespeople={team.data}
          />
        </Field>
      </div>
      {result.data?.after && (
        <button
          onClick={() => {
            setFormsAfter(result.data!.after);
            setFormId('');
          }}
        >
          {copy('More forms', 'ฟอร์มเพิ่มเติม')}
        </button>
      )}
      {formsAfter && (
        <button
          onClick={() => {
            setFormsAfter(null);
            setFormId('');
          }}
        >
          {copy('First form page', 'ฟอร์มหน้าแรก')}
        </button>
      )}
      <div className="meta-form-grid">
        {form?.questions?.map((question) => (
          <Field key={question.key} label={question.label || question.key}>
            <select
              value={fields[question.key] ?? ''}
              onChange={(e) =>
                setFields((v) => {
                  const next = { ...v };
                  if (e.target.value) next[question.key] = e.target.value;
                  else delete next[question.key];
                  return next;
                })
              }
            >
              <option value="">{copy('Do not map', 'ไม่ผูกฟิลด์')}</option>
              {[
                'name',
                'email',
                'phone',
                'country',
                'interest',
                'budget',
                'notes',
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      <div className="meta-actions">
        <button
          className="primary"
          disabled={busy || !formId || !status.capabilities.manageIntegration}
          onClick={() =>
            void act(() =>
              api('/meta/leads/mappings', {
                method: 'POST',
                body: json({
                  formId,
                  fields,
                  assignedTo: assigned,
                  enabled: true,
                }),
              }),
            )
          }
        >
          {copy('Save and enable mapping', 'บันทึกและเปิดใช้การผูกฟิลด์')}
        </button>
        <button
          disabled={busy || !formId}
          onClick={() =>
            void act(async () => {
              const sync = await api<{ after: string | null }>(
                '/meta/leads/sync',
                {
                  method: 'POST',
                  body: json({ formId, ...(next ? { after: next } : {}) }),
                },
              );
              setNext(sync.after);
            })
          }
        >
          {next
            ? copy('Sync next page', 'ซิงก์หน้าถัดไป')
            : copy('Sync authorized leads', 'ซิงก์ Lead ที่อนุญาต')}
        </button>
      </div>
      <h3>{copy('Synchronization history', 'ประวัติการซิงก์')}</h3>
      <div className="meta-table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>{copy('Status', 'สถานะ')}</th>
              <th>{copy('CRM lead', 'ลีดใน CRM')}</th>
              <th>{copy('Action', 'การดำเนินการ')}</th>
            </tr>
          </thead>
          <tbody>
            {result.data?.events.map((event) => (
              <tr key={text(event.id)}>
                <td>{text(event.provider_lead_id ?? event.id)}</td>
                <td>{text(event.status ?? 'DEMO')}</td>
                <td>
                  {event.lead_id ? (
                    <Link to={'/sales/' + text(event.lead_id)}>
                      {copy('Open', 'เปิด')}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {event.status === 'FAILED' &&
                    status.capabilities.manageIntegration && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(() =>
                            api(
                              '/meta/leads/' +
                                encodeURIComponent(text(event.id)) +
                                '/retry',
                              { method: 'POST', body: '{}' },
                            ),
                          )
                        }
                      >
                        {copy('Retry failed job', 'ลองงานที่ล้มเหลวอีกครั้ง')}
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.data?.events.length === 0 && (
        <p className="muted">{copy('No imports yet.', 'ยังไม่มีการนำเข้า')}</p>
      )}
    </section>
  );
}
function MetaAnalytics({
  page,
  status,
}: {
  page: boolean;
  status: MetaStatus;
}) {
  if (!page) return <AdsDashboard status={status} />;
  return <PageInsights />;
}
function PageInsights() {
  const [range, setRange] = useState(dateDefaults),
    [after, setAfter] = useState<string | null>(null);
  const query = new URLSearchParams({ ...range, ...(after ? { after } : {}) }),
    result = useMetaData<MetaReport>('/meta/page/insights?' + query);
  return (
    <section className="panel">
      <DateFilters
        {...range}
        onChange={(since, until) => {
          setRange({ since, until });
          setAfter(null);
        }}
      />
      <ErrorBox message={result.error} />
      {!result.data && !result.error && <Loading />}
      {result.data && (
        <>
          <p className="muted">{result.data.notice}</p>
          <small>
            {copy('Current page · fetched', 'ข้อมูลหน้านี้ · ดึงเมื่อ')}:{' '}
            {date(result.data.fetchedAt)} ·{' '}
            {result.data.timezone ?? copy('Page timezone', 'เวลาเพจ')}
          </small>
          <div className="meta-page-metrics">
            {result.data.data.map((row, index) => (
              <article key={text(row.name) + index}>
                <h3>{text(row.name)}</h3>
                {Array.isArray(row.values) &&
                  row.values.map((item: unknown, i: number) => {
                    const value =
                      item && typeof item === 'object'
                        ? (item as Record<string, unknown>)
                        : {};
                    return (
                      <div key={i} className="meta-trend-row">
                        <span>{text(value.end_time)}</span>
                        <meter
                          aria-label={text(row.name)}
                          min={0}
                          max={Math.max(
                            1,
                            ...(row.values as Record<string, unknown>[]).map(
                              (v) => Number(v.value) || 0,
                            ),
                          )}
                          value={Number(value.value) || 0}
                        />
                        <strong>{text(value.value)}</strong>
                      </div>
                    );
                  })}
              </article>
            ))}
            {result.data.data.length === 0 && (
              <p>
                {copy(
                  'No supported metrics are configured or available. Configure verified metric names for the selected API version.',
                  'ยังไม่มี Metric ที่รองรับหรือพร้อมใช้งาน กรุณาตั้งชื่อ Metric ที่ตรวจแล้วสำหรับ API version ที่เลือก',
                )}
              </p>
            )}
          </div>
          {result.data.after && (
            <button onClick={() => setAfter(result.data!.after)}>
              {copy('Next reporting page', 'หน้ารายงานถัดไป')}
            </button>
          )}
          {after && (
            <button onClick={() => setAfter(null)}>
              {copy('First reporting page', 'หน้ารายงานแรก')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
function MetaPublishing({
  posts,
  status,
}: {
  posts: boolean;
  status: MetaStatus;
}) {
  const [searchParams] = useSearchParams();
  const drafts = useMetaData<{ drafts: MetaDraft[] }>(
    '/meta/drafts?kind=' + (posts ? 'POST' : 'CAMPAIGN'),
  );
  const [remoteAfter, setRemoteAfter] = useState<string | null>(null);
  const remote = useMetaData<MetaReport>(
    (posts ? '/meta/page/posts' : '/meta/ads/campaigns') +
      (remoteAfter ? '?after=' + encodeURIComponent(remoteAfter) : ''),
  );
  const [name, setName] = useState(
      () => searchParams.get('name')?.slice(0, 200) ?? '',
    ),
    [objective, setObjective] = useState('OUTCOME_LEADS'),
    [category, setCategory] = useState(''),
    [body, setBody] = useState(''),
    [scheduled, setScheduled] = useState(''),
    [product, setProduct] = useState<SharedProduct | null>(null),
    [picker, setPicker] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [tokens, setTokens] = useState<Record<string, string>>({}),
    [detail, setDetail] = useState<string | null>(null);
  const canWrite = status.capabilities[posts ? 'publishContent' : 'writeAds'];
  const act = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await task();
      drafts.reload();
      remote.reload();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    api('/meta/drafts', {
      method: 'POST',
      body: json(
        posts
          ? {
              kind: 'POST',
              payload: {
                message: body,
                ...(product ? { productId: product.id } : {}),
                ...(scheduled
                  ? { scheduledAt: new Date(scheduled).toISOString() }
                  : {}),
              },
            }
          : {
              kind: 'CAMPAIGN',
              payload: {
                name,
                objective,
                special_ad_categories: category ? [category] : [],
              },
            },
      ),
    });
  const transition = async (
    draft: MetaDraft,
    action: 'VALIDATE' | 'REVIEW' | 'CONFIRM' | 'PUBLISH',
  ) => {
    if (
      (action === 'REVIEW' || action === 'CONFIRM' || action === 'PUBLISH') &&
      !window.confirm(
        copy(
          'Review this exact revision and confirm this action?',
          'ตรวจร่างเวอร์ชันนี้และยืนยันการดำเนินการหรือไม่?',
        ),
      )
    )
      return;
    const result = await api<{ approvalToken?: string }>(
      '/meta/drafts/' + draft.id + '/transition',
      {
        method: 'POST',
        body: json({
          revision: draft.revision,
          action,
          approvedByHuman: true,
          confirmation:
            (action === 'PUBLISH' ? 'PUBLISH ' : 'APPROVE ') + draft.id,
          ...(tokens[draft.id] ? { approvalToken: tokens[draft.id] } : {}),
        }),
      },
    );
    if (result.approvalToken)
      setTokens((v) => ({ ...v, [draft.id]: result.approvalToken! }));
  };
  return (
    <div className="meta-publishing">
      <section className="panel">
        <h2>
          {posts
            ? copy('Create a Page post draft', 'สร้างร่างโพสต์เพจ')
            : copy('Create a campaign draft', 'สร้างร่างแคมเปญ')}
        </h2>
        <p className="muted">
          {posts
            ? copy(
                'Review content and product image before publishing. Scheduling requires a verified API capability.',
                'ตรวจเนื้อหาและภาพสินค้าก่อนเผยแพร่ การตั้งเวลาต้องใช้ความสามารถ API ที่ตรวจแล้ว',
              )
            : copy(
                'New campaigns are always created PAUSED. This tool never changes or increases budgets.',
                'แคมเปญใหม่สร้างแบบ PAUSED เสมอ เครื่องมือนี้ไม่แก้หรือเพิ่มงบประมาณ',
              )}
        </p>
        <ErrorBox message={error} />
        {!canWrite && (
          <p className="meta-window-warning">
            {copy(
              'Read-only access. Publishing requires the administrator, feature flag and Meta permissions.',
              'ดูได้อย่างเดียว การเผยแพร่ต้องมีสิทธิ์ผู้ดูแล Feature Flag และสิทธิ์จาก Meta',
            )}
          </p>
        )}
        {posts ? (
          <>
            <Field label={copy('Post text', 'ข้อความโพสต์')}>
              <textarea
                rows={5}
                maxLength={5000}
                value={body}
                disabled={!canWrite}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
            <button disabled={!canWrite} onClick={() => setPicker((v) => !v)}>
              <PackagePlus size={16} />
              {copy('Select product image', 'เลือกภาพสินค้า')}
            </button>
            {picker && (
              <ProductPicker
                onPick={(value) => {
                  setProduct(value);
                  setPicker(false);
                }}
              />
            )}
            {product && (
              <p>
                {product.brand} {product.model}{' '}
                <button onClick={() => setProduct(null)}>
                  {copy('Remove', 'นำออก')}
                </button>
              </p>
            )}
            <Field
              label={copy(
                'Schedule (optional; supported API only)',
                'ตั้งเวลา (ถ้ามี API รองรับ)',
              )}
            >
              <input
                type="datetime-local"
                value={scheduled}
                disabled={!canWrite}
                onChange={(e) => setScheduled(e.target.value)}
              />
            </Field>
            <button
              disabled={busy || !product || !status.capabilities.useAI}
              onClick={() =>
                void act(async () => {
                  const result = await api<AiDraftResponse>(
                    '/meta/ai/caption',
                    {
                      method: 'POST',
                      body: json({ productId: product!.id, language: 'th' }),
                    },
                  );
                  setBody(result.content.text);
                })
              }
            >
              <Sparkles size={15} />
              {copy('Suggest caption', 'แนะนำคำบรรยาย')}
            </button>
          </>
        ) : (
          <div className="meta-form-grid">
            <Field label={copy('Campaign name', 'ชื่อแคมเปญ')}>
              <input
                value={name}
                maxLength={200}
                disabled={!canWrite}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label={copy('Objective', 'วัตถุประสงค์')}>
              <select
                value={objective}
                disabled={!canWrite}
                onChange={(e) => setObjective(e.target.value)}
              >
                {[
                  'OUTCOME_LEADS',
                  'OUTCOME_TRAFFIC',
                  'OUTCOME_ENGAGEMENT',
                  'OUTCOME_AWARENESS',
                  'OUTCOME_SALES',
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label={copy('Special ad category', 'หมวดโฆษณาพิเศษ')}>
              <select
                value={category}
                disabled={!canWrite}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">
                  {copy('None / not applicable', 'ไม่มี / ไม่เกี่ยวข้อง')}
                </option>
                {[
                  'HOUSING',
                  'EMPLOYMENT',
                  'CREDIT',
                  'ISSUES_ELECTIONS_POLITICS',
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <button
          className="primary"
          disabled={busy || !canWrite || !(posts ? body.trim() : name.trim())}
          onClick={() => void act(create)}
        >
          <Plus size={16} />
          {copy('Save draft', 'บันทึกร่าง')}
        </button>
      </section>
      <section className="panel">
        <h2>{copy('Review and approval', 'ตรวจทานและอนุมัติ')}</h2>
        <p className="muted">
          DRAFT → VALIDATION → REVIEW → CONFIRMATION → PUBLISH
        </p>
        <ErrorBox message={drafts.error} />
        {drafts.data?.drafts.length === 0 && (
          <p>{copy('No drafts yet.', 'ยังไม่มีร่าง')}</p>
        )}
        {drafts.data?.drafts.map((draft) => (
          <article className="meta-publish-draft" key={draft.id}>
            <div className="meta-draft-heading">
              <strong>
                {draft.kind} · {draft.status}
              </strong>
              <small>
                v{draft.revision} · {draft.mode}
              </small>
            </div>
            <pre>{json(JSON.parse(draft.payload))}</pre>
            {draft.provider_id && (
              <p>
                {copy('Provider reference', 'รหัสอ้างอิงจากผู้ให้บริการ')}:{' '}
                {draft.provider_id}
              </p>
            )}
            {draft.error_code && <ErrorBox message={draft.error_code} />}
            <div className="meta-actions">
              {[
                'DRAFT',
                'VALIDATION',
                'REVIEW',
                'CONFIRMATION',
                'FAILED',
              ].includes(draft.status) && (
                <button
                  disabled={busy || !canWrite}
                  onClick={() =>
                    void act(async () => {
                      const raw = JSON.parse(draft.payload) as Record<
                        string,
                        unknown
                      >;
                      delete raw.productSnapshot;
                      const field = draft.kind === 'POST' ? 'message' : 'name';
                      if (draft.kind === 'CAMPAIGN_STATUS') return;
                      const changed = window.prompt(
                        copy(
                          'Edit draft text/name; this resets all approvals.',
                          'แก้ข้อความหรือชื่อร่าง การอนุมัติเดิมจะถูกยกเลิก',
                        ),
                        text(raw[field]),
                      );
                      if (changed === null) return;
                      raw[field] = changed;
                      await api('/meta/drafts/' + draft.id, {
                        method: 'PATCH',
                        body: json({
                          revision: draft.revision,
                          draft: { kind: draft.kind, payload: raw },
                        }),
                      });
                    })
                  }
                >
                  {copy('Edit and restart review', 'แก้ไขและตรวจใหม่')}
                </button>
              )}
              {draft.status === 'DRAFT' && (
                <button
                  disabled={busy || !canWrite}
                  onClick={() => void act(() => transition(draft, 'VALIDATE'))}
                >
                  {copy('Validate', 'ตรวจข้อมูล')}
                </button>
              )}
              {draft.status === 'VALIDATION' && (
                <button
                  disabled={busy || !canWrite}
                  onClick={() => void act(() => transition(draft, 'REVIEW'))}
                >
                  {copy('Review revision', 'ตรวจร่างเวอร์ชันนี้')}
                </button>
              )}
              {(draft.status === 'REVIEW' ||
                (draft.status === 'CONFIRMATION' && !tokens[draft.id])) && (
                <button
                  disabled={busy || !canWrite}
                  onClick={() => void act(() => transition(draft, 'CONFIRM'))}
                >
                  {copy('Confirm approval', 'ยืนยันอนุมัติ')}
                </button>
              )}
              {draft.status === 'CONFIRMATION' && tokens[draft.id] && (
                <button
                  className="primary"
                  disabled={busy || !canWrite}
                  onClick={() => void act(() => transition(draft, 'PUBLISH'))}
                >
                  {status.mode === 'DEMO'
                    ? copy('Simulate publication', 'จำลองเผยแพร่')
                    : copy(
                        'Publish approved revision',
                        'เผยแพร่เวอร์ชันที่อนุมัติ',
                      )}
                </button>
              )}
              {['PUBLISHING', 'UNKNOWN'].includes(draft.status) && (
                <p className="meta-window-warning">
                  {copy(
                    'Do not retry. Check the actual provider outcome first.',
                    'อย่าลองส่งซ้ำ กรุณาตรวจผลที่ผู้ให้บริการก่อน',
                  )}
                </p>
              )}
            </div>
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>
          {posts
            ? copy('Published Page posts', 'โพสต์ที่เผยแพร่แล้ว')
            : copy('Campaigns and settings', 'แคมเปญและการตั้งค่า')}
        </h2>
        <ErrorBox message={remote.error} />
        <div className="meta-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{copy('Name / content', 'ชื่อ / เนื้อหา')}</th>
                <th>{copy('Status', 'สถานะ')}</th>
                <th>{copy('Actions', 'การดำเนินการ')}</th>
              </tr>
            </thead>
            <tbody>
              {remote.data?.data.map((row, index) => (
                <tr key={text(row.id) + index}>
                  <td>
                    {text(row.name ?? row.message)}
                    <small className="muted">{text(row.id)}</small>
                  </td>
                  <td>{text(row.status ?? row.created_time)}</td>
                  <td>
                    {posts && status.capabilities.readPageInsights && (
                      <button onClick={() => setDetail(text(row.id))}>
                        {copy('Post performance', 'ผลการทำงานของโพสต์')}
                      </button>
                    )}
                    {!posts && (
                      <>
                        <button onClick={() => setDetail(text(row.id))}>
                          {copy(
                            'Inspect ad sets and ads',
                            'ดูชุดโฆษณาและโฆษณา',
                          )}
                        </button>
                        {canWrite && (
                          <>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act(() =>
                                  api('/meta/drafts', {
                                    method: 'POST',
                                    body: json({
                                      kind: 'CAMPAIGN_STATUS',
                                      payload: {
                                        campaignId: row.id,
                                        status:
                                          row.status === 'ACTIVE'
                                            ? 'PAUSED'
                                            : 'ACTIVE',
                                      },
                                    }),
                                  }),
                                )
                              }
                            >
                              {row.status === 'ACTIVE'
                                ? copy('Draft pause', 'ร่างหยุดแคมเปญ')
                                : copy('Draft resume', 'ร่างเปิดแคมเปญ')}
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  const updated = window.prompt(
                                    copy('New campaign name', 'ชื่อแคมเปญใหม่'),
                                    text(row.name),
                                  );
                                  if (updated)
                                    await api('/meta/drafts', {
                                      method: 'POST',
                                      body: json({
                                        kind: 'CAMPAIGN_UPDATE',
                                        payload: {
                                          campaignId: row.id,
                                          name: updated,
                                        },
                                      }),
                                    });
                                })
                              }
                            >
                              {copy('Draft name change', 'ร่างเปลี่ยนชื่อ')}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {remote.data?.after && (
          <button onClick={() => setRemoteAfter(remote.data!.after)}>
            {copy('Next page', 'หน้าถัดไป')}
          </button>
        )}
        {remoteAfter && (
          <button onClick={() => setRemoteAfter(null)}>
            {copy('First page', 'หน้าแรก')}
          </button>
        )}
        {detail &&
          (posts ? (
            <PostInspection id={detail} onClose={() => setDetail(null)} />
          ) : (
            <CampaignInspection id={detail} onClose={() => setDetail(null)} />
          ))}
      </section>
    </div>
  );
}
function CampaignInspection({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  return (
    <div className="meta-ai-review">
      <button onClick={onClose}>
        {copy('Close details', 'ปิดรายละเอียด')}
      </button>
      <h3>{id}</h3>
      <CampaignRecords key={id + 'adsets'} id={id} resource="adsets" />
      <CampaignRecords key={id + 'ads'} id={id} resource="ads" />
    </div>
  );
}
function CampaignRecords({
  id,
  resource,
}: {
  id: string;
  resource: 'adsets' | 'ads';
}) {
  const [after, setAfter] = useState<string | null>(null);
  const report = useMetaData<MetaReport>(
    '/meta/ads/' +
      resource +
      (after ? '?after=' + encodeURIComponent(after) : ''),
  );
  return (
    <div>
      <h4>
        {resource === 'adsets'
          ? copy(
              'Ad sets, budgets and targeting',
              'ชุดโฆษณา งบประมาณ และกลุ่มเป้าหมาย',
            )
          : copy('Ads', 'โฆษณา')}
      </h4>
      <ErrorBox message={report.error} />
      <pre>
        {json(report.data?.data.filter((row) => row.campaign_id === id) ?? [])}
      </pre>
      {report.data?.after && (
        <button onClick={() => setAfter(report.data!.after)}>
          {copy('Next account page', 'หน้าบัญชีถัดไป')}
        </button>
      )}
      {after && (
        <button onClick={() => setAfter(null)}>
          {copy('First page', 'หน้าแรก')}
        </button>
      )}
    </div>
  );
}
function PostInspection({ id, onClose }: { id: string; onClose: () => void }) {
  const result = useMetaData<MetaReport>(
    '/meta/page/posts/' + encodeURIComponent(id) + '/insights',
  );
  return (
    <div className="meta-ai-review">
      <button onClick={onClose}>
        {copy('Close details', 'ปิดรายละเอียด')}
      </button>
      <h3>{copy('Post performance', 'ผลการทำงานของโพสต์')}</h3>
      <ErrorBox message={result.error} />
      <p>{result.data?.notice}</p>
      <pre>{json(result.data?.data ?? [])}</pre>
    </div>
  );
}
function MetaWebhooks() {
  const result = useMetaData<{
      events: Record<string, unknown>[];
      mode: 'DEMO' | 'LIVE';
    }>('/meta/webhooks', 5000),
    [error, setError] = useState('');
  return (
    <section className="panel">
      <h2>{copy('Webhook processing', 'การประมวลผล Webhook')}</h2>
      <p className="muted">
        {copy(
          'Only event metadata is shown. Payloads and customer messages are excluded.',
          'แสดงเฉพาะข้อมูลเหตุการณ์ ไม่แสดง Payload หรือข้อความลูกค้า',
        )}
      </p>
      <ErrorBox message={error || result.error} />
      <div className="meta-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{copy('Kind', 'ชนิด')}</th>
              <th>{copy('State', 'สถานะ')}</th>
              <th>{copy('Attempts', 'จำนวนครั้ง')}</th>
              <th>{copy('Received', 'รับเมื่อ')}</th>
              <th>{copy('Action', 'การดำเนินการ')}</th>
            </tr>
          </thead>
          <tbody>
            {result.data?.events.map((event) => (
              <tr key={text(event.id)}>
                <td>{text(event.kind)}</td>
                <td>{text(event.status)}</td>
                <td>{text(event.attempts)}</td>
                <td>{date(text(event.created_at))}</td>
                <td>
                  {event.status === 'FAILED' && (
                    <button
                      onClick={async () => {
                        try {
                          await api(
                            '/meta/webhooks/' + text(event.id) + '/retry',
                            {
                              method: 'POST',
                              body: json({ approvedByHuman: true }),
                            },
                          );
                          result.reload();
                        } catch (reason) {
                          setError((reason as Error).message);
                        }
                      }}
                    >
                      {copy('Retry processing', 'ประมวลผลอีกครั้ง')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
