import { useEffect, useState } from 'react';
import { api } from '../lib';
import { t } from '../i18n';
import { ErrorBox, Field } from './ui';

export function CategorySettings({ categories }: { categories: string[] }) {
  const [value, setValue] = useState(categories.join('\n'));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(categories.join('\n')), [categories]);
  return (
    <section className="panel">
      <h2>{t('Equipment categories')}</h2>
      <p className="muted">
        {t(
          'One category per line. Existing equipment keeps its saved category.',
        )}
      </p>
      <ErrorBox message={error} />
      {saved && <div className="success">{t('Categories saved.')}</div>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setSaved(false);
          try {
            const result = await api<{ categories: string[] }>('/settings', {
              method: 'PATCH',
              body: JSON.stringify({
                categories: value
                  .split('\n')
                  .map((v) => v.trim())
                  .filter(Boolean),
              }),
            });
            setValue(result.categories.join('\n'));
            setSaved(true);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t('Available categories')}>
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
          {t('Save categories')}
        </button>
      </form>
    </section>
  );
}
