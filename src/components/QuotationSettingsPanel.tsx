import { useEffect, useState, type FormEvent } from 'react';
import { api, useData } from '../lib';
import { t } from '../i18n';
import { ErrorBox, Field, Loading } from './ui';
import { BilingualTermField } from './BilingualTerms';
import { Languages } from 'lucide-react';

type CompanyProfile = {
  companyNameTh: string;
  companyNameEn: string;
  address: string;
  phone: string;
  email: string;
  taxId: string;
  lineUrl: string;
  facebookUrl: string;
  bankDetails: string;
  paymentTerms: string;
  deliveryTerms: string;
  warrantyTerms: string;
  paymentTermsEn: string;
  deliveryTermsEn: string;
  warrantyTermsEn: string;
  bankDetailsEn: string;
  defaultVatRate: number;
  hasLogo: boolean;
};
const empty: CompanyProfile = {
  companyNameTh: '', companyNameEn: '', address: '', phone: '', email: '',
  taxId: '', lineUrl: '', facebookUrl: '', bankDetails: '', paymentTerms: '', deliveryTerms: '',
  warrantyTerms: '', paymentTermsEn: '', deliveryTermsEn: '', warrantyTermsEn: '', bankDetailsEn: '',
  defaultVatRate: 7, hasLogo: false,
};

const bilingualTerms = [
  ['bankDetails', 'bankDetailsEn', 'Bank details'],
  ['paymentTerms', 'paymentTermsEn', 'Default payment terms'],
  ['deliveryTerms', 'deliveryTermsEn', 'Default delivery terms'],
  ['warrantyTerms', 'warrantyTermsEn', 'Default warranty terms'],
] as const;

export function QuotationSettingsPanel() {
  const { data, error: loadError, reload } = useData<CompanyProfile>(
    '/quotation-settings',
  );
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const [translating, setTranslating] = useState<string | null>(null);
  const [translated, setTranslated] = useState(false);
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
  /** Fills English boxes from the Thai text. Only changes the form; Save stores it. */
  async function autoEnglish(only?: (typeof bilingualTerms)[number]) {
    const targets = (only ? [only] : bilingualTerms).filter(([thKey]) => form[thKey].trim());
    if (!targets.length) {
      setError(t('Write the Thai text first.'));
      return;
    }
    let chosen = targets;
    if (!only && targets.some(([, enKey]) => form[enKey].trim())) {
      const overwrite = window.confirm(
        t('Some English boxes already have text. Replace them with new translations? Choose Cancel to fill only the empty ones.'),
      );
      if (!overwrite) chosen = targets.filter(([, enKey]) => !form[enKey].trim());
    }
    if (!chosen.length) return;
    setTranslating(only ? only[0] : 'all');
    setError('');
    setSaved(false);
    setTranslated(false);
    try {
      const { translations } = await api<{ translations: Record<string, string> }>(
        '/quotation-settings/translate',
        {
          method: 'POST',
          body: JSON.stringify({ texts: Object.fromEntries(chosen.map(([thKey]) => [thKey, form[thKey]])) }),
        },
      );
      setForm((current) => {
        const next = { ...current };
        for (const [thKey, enKey] of chosen)
          if (translations[thKey]) next[enKey] = translations[thKey];
        return next;
      });
      setTranslated(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTranslating(null);
    }
  }
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
            className="quotation-logo-preview"
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
          <Field label={t('LINE contact URL')}>
            <input type="url" placeholder="https://line.me/…" value={form.lineUrl} onChange={(e) => update('lineUrl', e.target.value)} />
          </Field>
          <Field label={t('Facebook Messenger URL')}>
            <input type="url" placeholder="https://m.me/…" value={form.facebookUrl} onChange={(e) => update('facebookUrl', e.target.value)} />
          </Field>
          <Field label={t('Default VAT rate (%)')}>
            <input type="number" min="0" max="100" step="0.01" inputMode="decimal" value={form.defaultVatRate} onChange={(e) => update('defaultVatRate', Number(e.target.value))} />
          </Field>
        </div>
        <Field label={t('Company address')}>
          <textarea rows={3} value={form.address} onChange={(e) => update('address', e.target.value)} />
        </Field>
        <div className="auto-english">
          <p className="muted">
            {t('Write each term in Thai and English. Thai documents print the Thai text, English documents the English text.')}
          </p>
          <button type="button" disabled={!!translating} onClick={() => void autoEnglish()}>
            <Languages size={16} />
            {translating === 'all' ? t('Translating…') : t('Auto English (translate from Thai)')}
          </button>
        </div>
        {translated && <p className="success-note">{t('English filled in from the Thai text. Check it, then save.')}</p>}
        {bilingualTerms.map((term) => {
          const [thKey, enKey, label] = term;
          return (
            <BilingualTermField
              key={thKey}
              label={label}
              thai={form[thKey]}
              english={form[enKey]}
              onThai={(value) => update(thKey, value)}
              onEnglish={(value) => update(enKey, value)}
              translating={translating === thKey}
              onTranslate={translating ? undefined : () => void autoEnglish(term)}
            />
          );
        })}
        <button className="primary" disabled={busy}>
          {busy ? t('Saving…') : t('Save quotation settings')}
        </button>
      </form>
    </section>
  );
}
