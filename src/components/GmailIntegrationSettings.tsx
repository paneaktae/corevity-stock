import { useState } from 'react';
import { Mail } from 'lucide-react';
import { api, useData } from '../lib';
import { getLanguage, t } from '../i18n';
import { ErrorBox } from './ui';
import { GmailSyncLog } from './GmailSyncLog';

type GmailStatus = {
  configured: boolean;
  missing: string[];
  mailbox: string;
  connected: boolean;
  status: 'CONNECTED' | 'RECONNECT_REQUIRED' | 'NOT_CONNECTED';
  email: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  aiClassify: boolean;
  aiAvailable: boolean;
  isAdmin: boolean;
};

const outcomes: Record<string, [string, boolean]> = {
  connected: ['Gmail connected. New emails are checked every 5 minutes.', true],
  cancelled: ['Gmail connection was cancelled.', false],
  'wrong-mailbox': ['Sign in with the company mailbox shown below, not a personal account.', false],
  'missing-permission': ['Google did not grant read access. Please connect again and allow access.', false],
  'not-configured': ['Gmail is not configured on the server yet.', false],
  'password-session-required': ['Sign in with your CRM password before connecting Gmail.', false],
  'invalid-state': ['The connection link expired. Please try again.', false],
};

const when = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(getLanguage() === 'th' ? 'th-TH-u-nu-latn' : 'en-GB', {
        timeZone: 'Asia/Bangkok',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : '—';

export function GmailIntegrationSettings() {
  const { data, error, reload } = useData<GmailStatus>('/email/status');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const outcome = new URLSearchParams(window.location.search).get('gmail') ?? '';
  const [result] = useState(() => outcomes[outcome] ?? (outcome ? ['Gmail could not be connected. Please try again.', false] : null));

  async function update(path: string, init: RequestInit) {
    setBusy(true);
    setMessage('');
    try {
      await api(path, init);
      reload();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <ErrorBox message={error} />;
  return (
    <section className="panel gmail-settings">
      <div className="section-heading">
        <h2>
          <Mail size={18} /> {t('Gmail inbox')}
        </h2>
        <span className={`badge ${data.connected ? 'available' : ''}`}>
          {t(data.connected ? 'Connected' : data.status === 'RECONNECT_REQUIRED' ? 'Reconnect required' : 'Not connected')}
        </span>
      </div>
      <p className="muted">
        {t('Read-only access to the company mailbox. New emails that look like customers are sent to every salesperson with LINE connected.')}
      </p>
      <ul className="gmail-safety">
        <li>{t('Checks Inbox and Junk/Spam automatically every 5 minutes.')}</li>
        <li>{t('Re-checks the last 2 days every hour in case an email was missed.')}</li>
        <li>{t('If the mailbox cannot be read for 30 minutes, the administrator gets a LINE alert.')}</li>
      </ul>
      {result && <div className={result[1] ? 'success' : 'error'} role="status">{t(result[0])}</div>}
      <ErrorBox message={message} />
      <dl className="gmail-facts">
        <dt>{t('Mailbox')}</dt>
        <dd>{data.email ?? data.mailbox ?? '—'}</dd>
        <dt>{t('Last checked')}</dt>
        <dd>{when(data.lastSyncAt)}</dd>
        {data.lastError && (
          <>
            <dt>{t('Last problem')}</dt>
            <dd>{data.lastError}</dd>
          </>
        )}
      </dl>
      {data.connected && <GmailSyncLog />}
      {!data.configured ? (
        <p className="field-hint">
          {t('Server setup is incomplete.')}
          {data.missing.length > 0 && ` ${t('Missing')}: ${data.missing.join(', ')}`}
        </p>
      ) : data.isAdmin ? (
        <div className="button-row">
          <a className="button primary" href="/api/integrations/gmail/connect">
            {t(data.connected ? 'Reconnect Gmail' : data.status === 'RECONNECT_REQUIRED' ? 'Reconnect Gmail' : 'Connect Gmail')}
          </a>
          {data.status !== 'NOT_CONNECTED' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t('Disconnect Gmail? The CRM will stop checking the mailbox.')))
                  void update('/integrations/gmail/disconnect', { method: 'POST' });
              }}
            >
              {t('Disconnect')}
            </button>
          )}
        </div>
      ) : (
        <p className="field-hint">{t('Only the workspace administrator can connect Gmail.')}</p>
      )}
      {data.status !== 'NOT_CONNECTED' && data.isAdmin && (
        <label className="quotation-check gmail-ai-toggle">
          <input
            type="checkbox"
            checked={data.aiClassify}
            disabled={busy || !data.aiAvailable}
            onChange={(e) => void update('/email/settings', { method: 'PATCH', body: JSON.stringify({ aiClassify: e.target.checked }) })}
          />
          <span>
            {t('Use AI to decide which emails are customers')}
            <small className="field-hint">
              {t(
                data.aiAvailable
                  ? 'Sends the sender, subject and the first 2,000 characters of personal-looking emails to the configured AI provider. Off: every personal email from outside the company is treated as a possible customer.'
                  : 'AI is not configured on the server.',
              )}
            </small>
          </span>
        </label>
      )}
    </section>
  );
}
