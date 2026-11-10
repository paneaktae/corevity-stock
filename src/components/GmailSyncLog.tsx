import { RefreshCw } from 'lucide-react';
import { getLanguage, t } from '../i18n';
import { useData } from '../lib';

type SyncRun = {
  id: string;
  startedAt: string;
  durationMs: number;
  trigger: 'cron' | 'manual';
  status: 'ok' | 'error' | 'reconnect';
  imported: number;
  customers: number;
  alertsQueued: number;
  dropped: number;
  error: string | null;
};
type SyncLog = {
  runs: SyncRun[];
  alerts: {
    recipients: number;
    sent: number;
    lastSentAt: string | null;
    pending: number;
    failed: number;
    problems: { messageId: string; status: string; attempts: number; lastError: string | null; createdAt: string }[];
  };
};

const time = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(getLanguage() === 'th' ? 'th-TH-u-nu-latn' : 'en-GB', {
        timeZone: 'Asia/Bangkok',
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(new Date(value))
    : '—';

export function GmailSyncLog() {
  const { data, error, reload } = useData<SyncLog>('/email/sync-log');
  return (
    <details className="gmail-sync-log">
      <summary>{t('Gmail check history')}</summary>
      <p className="field-hint">{t('Each automatic or manual check is recorded here (counts only, never email content).')}</p>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <p>
            <strong>{t('LINE alerts')}</strong>: {t('sent')} {data.alerts.sent} · {t('waiting')} {data.alerts.pending} · {t('failed')}{' '}
            {data.alerts.failed} · {t('recipients')} {data.alerts.recipients} · {t('Last sent')} {time(data.alerts.lastSentAt)}
          </p>
          {data.alerts.problems.length > 0 && (
            <>
              <p>{t('Alerts with a problem')}</p>
              <ul>
                {data.alerts.problems.map((item) => (
                  <li key={item.messageId}>
                    {time(item.createdAt)} · {item.status} · {t('attempts')} {item.attempts} · {item.lastError}
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.runs.length === 0 ? (
            <p className="field-hint">{t('No checks recorded yet. The next automatic check appears within 5 minutes.')}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Time')}</th>
                    <th>{t('How')}</th>
                    <th>{t('Result')}</th>
                    <th>{t('Found')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.id}>
                      <td>{time(run.startedAt)}</td>
                      <td>{t(run.trigger === 'manual' ? 'Manual' : 'Automatic')}</td>
                      <td>{run.status === 'ok' ? t('OK') : `${t('Problem')}: ${run.error ?? run.status}`}</td>
                      <td>
                        {run.imported} {t('new emails')} · {run.alertsQueued} {t('LINE alerts queued')} · {run.dropped}{' '}
                        {t('ads/notifications skipped')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <button type="button" onClick={reload}>
        <RefreshCw size={15} /> {t('Refresh')}
      </button>
    </details>
  );
}
