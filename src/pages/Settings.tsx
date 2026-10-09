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
        title="Workspace settings"
        subtitle="The essentials for a small, focused team."
      />
      <ErrorBox message={error} />
      {saved && <div className="success">Conditions saved.</div>}
      <div className="detail-grid">
        <section className="panel">
          <h2>Equipment conditions</h2>
          <p className="muted">
            One condition per line. Existing equipment keeps its saved
            condition.
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
            <Field label="Available conditions">
              <textarea
                rows={8}
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
              />
            </Field>
            <button disabled={busy} className="primary">
              Save conditions
            </button>
          </form>
        </section>
        <div>
          <section className="panel">
            <h2>
              <ShieldCheck size={20} /> Access & identity
            </h2>
            <p>
              Signed in as <strong>{data.userEmail}</strong>
            </p>
            <p>
              {data.environment === 'development'
                ? 'Local development workspace'
                : 'Protected company workspace'}
            </p>
            <small>
              Authorized accounts are managed in Cloudflare Access. No passwords
              are stored here.
            </small>
          </section>
          <section className="panel">
            <h2>
              <Sparkles size={20} /> AI descriptions
            </h2>
            <p>
              {data.aiConfigured
                ? 'AI is configured and ready.'
                : 'AI provider configuration is needed.'}
            </p>
            <small>
              Your administrator manages the provider and secret on the Worker.
              Generated text is always reviewed before saving.
            </small>
          </section>
          <section className="panel">
            <h2>Workspace defaults</h2>
            <p>Currency: THB</p>
            <p>Business timezone: {data.timezone}</p>
            <p>Maximum photo size: {data.maxUploadMB} MB</p>
          </section>
        </div>
      </div>
    </>
  );
}
