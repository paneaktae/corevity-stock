import { useState } from 'react';
import { api, date, useData } from '../lib';
import { t } from '../i18n';
import { ErrorBox } from './ui';
type LineStatus = {
  configured: boolean;
  providerError: string;
  webhookActive: boolean;
  linked: boolean;
  enabled: boolean;
  botId: string | null;
  recent: {
    status: string;
    sent_at: string | null;
    appointment_at: string;
    last_error: string | null;
  }[];
};
export function LineSettings() {
  const {
    data,
    error: loadError,
    reload,
  } = useData<LineStatus>('/line/status');
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function action(path: string, method: string, body?: object) {
    setBusy(true);
    setError('');
    try {
      await api(`/line/${path}`, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>{t('Personal LINE reminders')}</h2>
      <ErrorBox message={error || loadError} />
      <p>
        {t(
          'Receive reminders on your own LINE for appointments assigned to you. Checks run every 5 minutes, starting 24 hours before the appointment.',
        )}
      </p>
      <small>
        {t(
          'Messages contain the appointment time and a protected link, without customer notes or prices. Connecting enables reminders; you can pause or disconnect anytime.',
        )}
      </small>
      {!data ? (
        <p>{t('Loading your workspace…')}</p>
      ) : !data.configured ? (
        <p>{t('LINE is not configured.')}</p>
      ) : (
        <>
          <ErrorBox message={data.providerError} />
          {!data.webhookActive && (
            <p className="attention">
              {t(
                'LINE webhook must be enabled by your administrator before linking.',
              )}
            </p>
          )}
          <p>{t(data.linked ? 'LINE connected' : 'LINE not connected')}</p>
          {data.botId && (
            <a
              className="text-link"
              href={`https://line.me/R/ti/p/${encodeURIComponent(data.botId)}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('Add our LINE Official Account')}
            </a>
          )}
          {!data.linked && (
            <>
              <p>
                {t(
                  'Add the Official Account as a friend, then send the connection code to it in a private chat. Never share this code with anyone.',
                )}
              </p>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    setCode(await api('/line/link', { method: 'POST' }));
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('Create connection code')}
              </button>
              {code && (
                <div className="line-code">
                  <label className="field">
                    <span>{t('Send this code in LINE')}</span>
                    <input
                      readOnly
                      value={code.code}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <small>
                    {t('Expires:')} {date(code.expiresAt)}
                  </small>
                  <button
                    onClick={() => {
                      reload();
                    }}
                  >
                    {t('I sent the code — check connection')}
                  </button>
                </div>
              )}
            </>
          )}
          {data.linked && (
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() =>
                  void action('preferences', 'PATCH', {
                    enabled: !data.enabled,
                  })
                }
              >
                {t(
                  data.enabled
                    ? 'Pause LINE reminders'
                    : 'Enable LINE reminders',
                )}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      t('Disconnect your LINE account and stop reminders?'),
                    )
                  )
                    void action('link', 'DELETE');
                }}
              >
                {t('Disconnect LINE')}
              </button>
            </div>
          )}
          {data.linked && (
            <p>{t(data.enabled ? 'Reminders enabled' : 'Reminders paused')}</p>
          )}
          {!!data.recent.length && (
            <>
              <h3>{t('Recent reminder delivery')}</h3>
              {data.recent.map((r, i) => (
                <p key={i}>
                  {date(r.appointment_at)} ·{' '}
                  {t(
                    {
                      sent: 'Accepted by LINE',
                      pending: 'Waiting to send',
                      failed: 'Delivery failed',
                      cancelled: 'Cancelled',
                    }[r.status] ?? r.status,
                  )}
                  {r.last_error && <small>{r.last_error}</small>}
                </p>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
