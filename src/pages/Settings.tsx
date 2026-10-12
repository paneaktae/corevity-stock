import { SalespeopleSettings } from '../components/SalespeopleSettings';
import { BrandSettings } from '../components/BrandSettings';
import { CategorySettings } from '../components/CategorySettings';
import { QuotationSettingsPanel } from '../components/QuotationSettingsPanel';
import { LineSettings } from '../components/LineSettings';
import { t } from '../i18n';
import { useEffect, useState } from 'react';
import {
  BellRing,
  Box,
  MoreHorizontal,
  UsersRound,
  ShieldCheck,
  Sparkles,
  FileText,
} from 'lucide-react';
import type { Settings } from '../../shared/schemas';
import { api, useData } from '../lib';
import { ErrorBox, Field, Header, Loading } from '../components/ui';
export function SettingsPage() {
  const { data, error: loadError, reload } = useData<Settings>('/settings');
  const [conditions, setConditions] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<
    'sales' | 'products' | 'line' | 'quotation' | 'other'
  >(
    'sales',
  );
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
      <div
        className="settings-tabs"
        role="tablist"
        aria-label={t('Settings sections')}
      >
        {(
          [
            ['sales', 'Sales', UsersRound],
            ['products', 'Products', Box],
            ['line', 'LINE alerts', BellRing],
            ['quotation', 'Quotations', FileText],
            ['other', 'Other', MoreHorizontal],
          ] as const
        ).map(([key, title, Icon]) => (
          <button
            key={key}
            id={`settings-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`settings-panel-${key}`}
            className={`settings-tab${tab === key ? ' active' : ''}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
          >
            <Icon size={17} />
            <span className="settings-tab-title">{t(title)}</span>
            <span className="settings-tab-state" aria-hidden="true">
              {t(tab === key ? 'Active' : 'Inactive')}
            </span>
          </button>
        ))}
      </div>
      {tab === 'sales' && (
        <section
          id="settings-panel-sales"
          role="tabpanel"
          aria-labelledby="settings-tab-sales"
          className="settings-panel"
        >
          <SalespeopleSettings />
        </section>
      )}
      {tab === 'products' && (
        <section
          id="settings-panel-products"
          role="tabpanel"
          aria-labelledby="settings-tab-products"
          className="settings-panel settings-products-grid"
        >
          <BrandSettings brands={data.brands} />
          <CategorySettings categories={data.categories} />
          <section className="panel">
            {saved && <div className="success">{t('Conditions saved.')}</div>}
            <ErrorBox message={error} />
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
        </section>
      )}
      {tab === 'line' && (
        <section
          id="settings-panel-line"
          role="tabpanel"
          aria-labelledby="settings-tab-line"
          className="settings-panel"
        >
          <LineSettings />
        </section>
      )}
      {tab === 'quotation' && (
        <section
          id="settings-panel-quotation"
          role="tabpanel"
          aria-labelledby="settings-tab-quotation"
          className="settings-panel"
        >
          <QuotationSettingsPanel />
        </section>
      )}
      {tab === 'other' && (
        <section
          id="settings-panel-other"
          role="tabpanel"
          aria-labelledby="settings-tab-other"
          className="settings-panel detail-grid"
        >
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
        </section>
      )}
    </>
  );
}
