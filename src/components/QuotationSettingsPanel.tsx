import { useEffect, useState, type FormEvent } from 'react';
import { api, useData } from '../lib';
import { t } from '../i18n';
import { ErrorBox, Field, Loading } from './ui';

type CompanyProfile = {
  companyNameTh: string;
  companyNameEn: string;
  address: string;
  phone: string;
  email: string;
  taxId: string;
  bankDetails: string;
  paymentTerms: string;
  deliveryTerms: string;
  warrantyTerms: string;
  defaultVatRate: number;
  hasLogo: boolean;
};
const empty: CompanyProfile = {
  companyNameTh: '', companyNameEn: '', address: '', phone: '', email: '',
  taxId: '', bankDetails: '', paymentTerms: '', deliveryTerms: '',
  warrantyTerms: '', defaultVatRate: 7, hasLogo: false,
};

export function QuotationSettingsPanel() {
  const { data, error: loadError, reload } = useData<CompanyProfile>(
    '/quotation-settings',
  );
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);
  if (!data)
    return (
      <>
        <ErrorBox message={loadError} />
        {!loadError && <Loading />}
      </>
    );
  const update = (key: keyof CompanyProfile, value: string | number) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const { hasLogo: _hasLogo, ...values } = form;
      await api('/quotation-settings', {
        method: 'PATCH',
        body: JSON.stringify(values),
      });
      reload();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadLogo(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      await api('/quotation-settings/logo', { method: 'POST', body });
      reload();
      setLogoVersion((current) => current + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel quotation-settings-panel">
      <div>
        <h2>{t('Quotation company profile')}</h2>
        <p className="muted">
          {t('These details are saved as a snapshot on each new quotation.')}
        </p>
      </div>
      <ErrorBox message={error} />
      {saved && <div className="success">{t('Quotation settings saved.')}</div>}
      <div className="quotation-logo-setting">
        {form.hasLogo ? (
          <img
            src={`/api/quotation-settings/logo?v=${logoVersion}`}
            alt={t('Company logo')}
          />
        ) : (
          <div className="quotation-logo-placeholder">{t('Company logo')}</div>
        )}
        <Field label={t('Company logo')}>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => void uploadLogo(e.target.files?.[0])}
          />
          <small>{t('JPEG, PNG, or WebP. Maximum 2 MB.')}</small>
        </Field>
      </div>
      <form onSubmit={(e) => void save(e)}>
        <div className="form-grid">
          <Field label={t('Company name (Thai)')}>
            <input value={form.companyNameTh} onChange={(e) => update('companyNameTh', e.target.value)} />
          </Field>
          <Field label={t('Company name (English)')}>
            <input value={form.companyNameEn} onChange={(e) => update('companyNameEn', e.target.value)} />
          </Field>
          <Field label={t('Phone')}>
            <input value={form.phone} onChange={(e) => update('phone', e.target.value)} />
          </Field>
          <Field label={t('Email')}>
            <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} />
          </Field>
          <Field label={t('Tax ID')}>
            <input value={form.taxId} onChange={(e) => update('taxId', e.target.value)} />
          </Field>
          <Field label={t('Default VAT rate (%)')}>
            <input type="number" min="0" max="100" step="0.01" inputMode="decimal" value={form.defaultVatRate} onChange={(e) => update('defaultVatRate', Number(e.target.value))} />
          </Field>
        </div>
        <Field label={t('Company address')}>
          <textarea rows={3} value={form.address} onChange={(e) => update('address', e.target.value)} />
        </Field>
        <Field label={t('Bank details')}>
          <textarea rows={3} value={form.bankDetails} onChange={(e) => update('bankDetails', e.target.value)} />
        </Field>
        <div className="form-grid">
          {([
            ['paymentTerms', 'Default payment terms'],
            ['deliveryTerms', 'Default delivery terms'],
            ['warrantyTerms', 'Default warranty terms'],
          ] as const).map(([key, label]) => (
            <Field key={key} label={t(label)}>
              <textarea rows={3} value={form[key]} onChange={(e) => update(key, e.target.value)} />
            </Field>
          ))}
        </div>
        <button className="primary" disabled={busy}>
          {busy ? t('Saving…') : t('Save quotation settings')}
        </button>
      </form>
    </section>
  );
}
