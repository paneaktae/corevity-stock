import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, Mail, RefreshCw, UserCheck } from 'lucide-react';
import { api, useData, useDebounce } from '../lib';
import { getLanguage, t } from '../i18n';
import { ErrorBox, Header, Loading } from '../components/ui';

type GmailStatus = {
  configured: boolean;
  mailbox: string;
  email: string | null;
  connected: boolean;
  status: 'CONNECTED' | 'RECONNECT_REQUIRED' | 'NOT_CONNECTED';
  lastSyncAt: string | null;
  lastError: string | null;
  isAdmin: boolean;
  backfillDone: boolean;
};
type EmailRow = {
  id: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  classification: 'CUSTOMER' | 'NOT_CUSTOMER';
  reason: string;
  customerId: string | null;
  customerName: string | null;
  inSpam: number;
};
type EmailDetail = EmailRow & { toText: string; bodyText: string; bodyHtml: string | null };
type EmailList = { messages: EmailRow[]; total: number; customers: number; inbox: number; junk: number };
type View = 'inbox' | 'customer' | 'junk';
const views: [View, string, keyof Pick<EmailList, 'inbox' | 'customers' | 'junk'>][] = [
  ['inbox', 'Inbox', 'inbox'],
  ['customer', 'Possible customers', 'customers'],
  ['junk', 'Junk', 'junk'],
];
// Email HTML is shown in a sandboxed frame: no scripts, no same-origin access, links open in a new
// tab. The page CSP (img-src 'self' data: blob:) also applies, so remote images/trackers don't load.
function emailDocument(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
html,body{margin:0;background:#fff;color:#202a39}body{padding:16px;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Thai",sans-serif;overflow-wrap:anywhere}
img{max-width:100%;height:auto}table{max-width:100%!important}pre{white-space:pre-wrap}
</style></head><body>${html}</body></html>`;
}

const when = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(getLanguage() === 'th' ? 'th-TH-u-nu-latn' : 'en-GB', {
        timeZone: 'Asia/Bangkok',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : '—';

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('message');
  const [view, setView] = useState<View>('inbox');
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query);
  const { data: status, reload: reloadStatus } = useData<GmailStatus>('/email/status');
  const { data, error, reload } = useData<EmailList>(
    `/email/messages?view=${view}&q=${encodeURIComponent(debounced)}`,
  );
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    api<EmailDetail>(`/email/messages/${encodeURIComponent(selectedId)}`)
      .then((value) => active && setDetail(value))
      .catch((e: Error) => active && setMessage(e.message));
    return () => {
      active = false;
    };
  }, [selectedId]);

  async function syncNow() {
    setSyncing(true);
    setMessage('');
    setNotice('');
    try {
      const result = await api<{ imported: number; customers: number }>('/email/sync', { method: 'POST' });
      setNotice(
        result.imported
          ? `${t('New emails')}: ${result.imported} · ${t('Possible customers')}: ${result.customers}`
          : t('No new emails.'),
      );
      reload();
      reloadStatus();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }
  async function reclassify(id: string, classification: EmailRow['classification']) {
    try {
      await api(`/email/messages/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ classification }),
      });
      setDetail((current) => (current && current.id === id ? { ...current, classification } : current));
      reload();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('message', id);
    else next.delete('message');
    setParams(next, { replace: true });
  };
  const gmailLink = (row: EmailRow) =>
    `https://mail.google.com/mail/?authuser=${encodeURIComponent(status?.email || status?.mailbox || '')}#${row.inSpam ? 'spam' : 'all'}/${encodeURIComponent(row.threadId)}`;

  return (
    <>
      <Header
        title={t('Email inbox')}
        subtitle={
          status?.mailbox
            ? `${status.email || status.mailbox} · ${t('Checked every 5 minutes')}${status.connected && !status.backfillDone ? ` · ${t('Loading the last 90 days…')}` : ''}`
            : t('Company Gmail inbox')
        }
        action={
          status?.connected ? (
            <button type="button" disabled={syncing} onClick={() => void syncNow()}>
              <RefreshCw size={15} className={syncing ? 'spin' : ''} /> {syncing ? t('Checking…') : t('Check now')}
            </button>
          ) : undefined
        }
      />
      <ErrorBox message={message || error} />
      {notice && (
        <div className="success" role="status">
          {notice}
        </div>
      )}
      {!status ? (
        <Loading />
      ) : !status.connected ? (
        <section className="panel empty">
          <Mail size={28} />
          <h2>{t(status.status === 'RECONNECT_REQUIRED' ? 'Gmail needs to be reconnected' : 'Gmail is not connected yet')}</h2>
          <p>
            {status.isAdmin
              ? t('Connect the company mailbox in Settings → Integrations.')
              : t('Ask the workspace administrator to connect the company mailbox.')}
          </p>
          {status.isAdmin && (
            <Link className="button primary" to="/settings?tab=integrations">
              {t('Open Integrations')}
            </Link>
          )}
        </section>
      ) : (
        <section className={`panel email-inbox${detail ? ' has-detail' : ''}`}>
          <div className="email-list-pane">
            <div className="email-filters">
              <div className="email-view-toggle" role="tablist" aria-label={t('Email filter')}>
                {views.map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={view === key}
                    className={`${view === key ? 'active' : ''}${key === 'junk' ? ' junk' : ''}`}
                    onClick={() => setView(key)}
                  >
                    {t(label)} {data ? `(${data[count]})` : ''}
                  </button>
                ))}
              </div>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Search sender or subject')}
                aria-label={t('Search sender or subject')}
              />
            </div>
            {status.lastError && (
              <p className="field-hint">
                {t('Last check had a problem')}: {status.lastError} · {when(status.lastSyncAt)}
              </p>
            )}
            {!data ? (
              <Loading />
            ) : data.messages.length === 0 ? (
              <p className="muted email-empty">{t(view === 'customer' ? 'No customer emails yet.' : view === 'junk' ? 'No junk emails.' : 'No emails yet.')}</p>
            ) : (
              <ul className="email-list">
                {data.messages.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={`email-row${row.id === selectedId ? ' active' : ''}`}
                      onClick={() => select(row.id)}
                    >
                      <span className="email-row-top">
                        <strong>{row.fromName || row.fromEmail}</strong>
                        <time dateTime={row.receivedAt}>{when(row.receivedAt)}</time>
                      </span>
                      <span className="email-row-subject">{row.subject || t('(no subject)')}</span>
                      <span className="email-row-snippet">{row.snippet}</span>
                      {row.customerName ? (
                        <span className="email-tag known">
                          <UserCheck size={12} /> {row.customerName}
                        </span>
                      ) : row.classification === 'CUSTOMER' ? (
                        <span className="email-tag">{t('Possible customer')}</span>
                      ) : null}
                      {Boolean(row.inSpam) && <span className="email-tag junk">{t('Junk')}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="email-detail-pane">
            {detail ? (
              <article className="email-detail">
                <button type="button" className="email-back" onClick={() => select(null)}>
                  ← {t('Back to list')}
                </button>
                <h2>{detail.subject || t('(no subject)')}</h2>
                <p className="email-meta">
                  <strong>{detail.fromName || detail.fromEmail}</strong> &lt;{detail.fromEmail}&gt;
                  <br />
                  <span className="muted">
                    {when(detail.receivedAt)} · {t('To')}: {detail.toText || status.mailbox}
                  </span>
                </p>
                <div className="button-row">
                  <a className="button primary" href={gmailLink(detail)} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> {t('Reply in Gmail')}
                  </a>
                  {detail.customerId ? (
                    <Link className="button" to={`/customers/${detail.customerId}`}>
                      <UserCheck size={14} /> {detail.customerName}
                    </Link>
                  ) : (
                    <Link
                      className="button"
                      to={`/customers/new?name=${encodeURIComponent(detail.fromName || detail.fromEmail)}&email=${encodeURIComponent(detail.fromEmail)}`}
                    >
                      {t('Add as customer')}
                    </Link>
                  )}
                  {detail.classification === 'CUSTOMER' ? (
                    <button type="button" onClick={() => void reclassify(detail.id, 'NOT_CUSTOMER')}>
                      {t('Not a customer')}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void reclassify(detail.id, 'CUSTOMER')}>
                      {t('Mark as customer')}
                    </button>
                  )}
                </div>
                {Boolean(detail.inSpam) && (
                  <div className="email-junk-note" role="note">
                    {t('Gmail put this email in Junk/Spam. If it is a real customer, open it in Gmail and choose "Not spam" so future replies reach the inbox.')}
                  </div>
                )}
                <small className="field-hint">
                  {t('Why')}: {t(detail.reason)}
                </small>
                {detail.bodyHtml ? (
                  <>
                    <iframe
                      className="email-html"
                      title={detail.subject || t('Email content')}
                      sandbox="allow-popups allow-popups-to-escape-sandbox"
                      referrerPolicy="no-referrer"
                      srcDoc={emailDocument(detail.bodyHtml)}
                    />
                    <small className="field-hint">{t('Images from outside are hidden for safety. Open in Gmail to see them.')}</small>
                  </>
                ) : (
                  <pre className="email-body">{detail.bodyText || detail.snippet}</pre>
                )}
              </article>
            ) : (
              <p className="muted email-placeholder">{t('Select an email to read it.')}</p>
            )}
          </div>
        </section>
      )}
    </>
  );
}
