import { LineSettings } from '../components/LineSettings';
import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';
import type { Settings } from '../../shared/schemas';
import { api, useData } from '../lib';
import { ErrorBox, Field, Header, Loading } from '../components/ui';
export function SettingsPage() {
  const { data, error: loadError, reload } = useData<Settings>('/settings');
  const [conditions, setConditions] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setConditions(data.conditions.join('\n'));
  }, [data]);
  if (!data)
    return (
      <>
        <ErrorBox message={loadError} />
        {!loadError && <Loading />}
      </>
    );
  return (
    <>
      <Header
        title={t('Workspace settings')}
        subtitle={t('The essentials for a small, focused team.')}
      />
      <ErrorBox message={error} />
      {saved && <div className="success">{t('Conditions saved.')}</div>}
      <LineSettings />
      <div className="detail-grid">
        <section className="panel">
          <h2>{t('Equipment conditions')}</h2>
          <p className="muted">
            {t(
              'One condition per line. Existing equipment keeps its saved condition.',
            )}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              setSaved(false);
              try {
                await api('/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({
                    conditions: conditions
                      .split('\n')
                      .map((v) => v.trim())
                      .filter(Boolean),
                  }),
                });
                reload();
                setSaved(true);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label={t('Available conditions')}>
              <textarea
                rows={8}
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
              />
            </Field>
            <button disabled={busy} className="primary">
              {t('Save conditions')}
            </button>
          </form>
        </section>
        <div>
          <section className="panel">
            <h2>
              <ShieldCheck size={20} /> {t('Access & identity')}
            </h2>
            <p>
              {t('Signed in as')}
              <strong>{data.userEmail}</strong>
            </p>
            <p>
              {data.environment === 'development'
                ? t('Local development workspace')
                : t('Protected company workspace')}
            </p>
            <small>
              {t(
                'Authorized accounts are managed in Cloudflare Access. No passwords are stored here.',
              )}
            </small>
          </section>
          <section className="panel">
            <h2>
              <Sparkles size={20} /> {t('AI descriptions')}
            </h2>
            <p>
              {data.aiConfigured
                ? t('AI is configured and ready.')
                : t('AI provider configuration is needed.')}
            </p>
            <small>
              {t(
                'Your administrator manages the provider and secret on the Worker. Generated text is always reviewed before saving.',
              )}
            </small>
          </section>
          <section className="panel">
            <h2>{t('Workspace defaults')}</h2>
            <p>{t('Currency: THB')}</p>
            <p>
              {t('Business timezone:')}
              {data.timezone}
            </p>
            <p>
              {t('Maximum photo size:')}
              {data.maxUploadMB} {t('MB')}
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
