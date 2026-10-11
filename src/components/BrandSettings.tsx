import { useEffect, useState } from 'react';
import { api } from '../lib';
import { t } from '../i18n';
import { ErrorBox, Field } from './ui';

export function BrandSettings({ brands }: { brands: string[] }) {
  const [value, setValue] = useState(brands.join('\n'));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(brands.join('\n')), [brands]);
  return (
    <section className="panel">
      <h2>{t('Equipment brands')}</h2>
      <p className="muted">
        {t('One brand per line. Existing equipment keeps its saved brand.')}
      </p>
      <ErrorBox message={error} />
      {saved && <div className="success">{t('Brands saved.')}</div>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setSaved(false);
          try {
            const result = await api<{ brands: string[] }>('/settings', {
              method: 'PATCH',
              body: JSON.stringify({
                brands: value
                  .split('\n')
                  .map((v) => v.trim())
                  .filter(Boolean),
              }),
            });
            setValue(result.brands.join('\n'));
            setSaved(true);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t('Available brands')}>
          <textarea
            rows={8}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <button className="primary" disabled={busy}>
          {t('Save brands')}
        </button>
      </form>
    </section>
  );
}
