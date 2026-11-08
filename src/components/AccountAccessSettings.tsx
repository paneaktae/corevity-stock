import { useState } from 'react';
import { api, useData } from '../lib';
import { t } from '../i18n';
import { ErrorBox, Field } from './ui';
import { KeyRound, ShieldCheck } from 'lucide-react';

type Session = { authenticated: boolean; email: string; method: 'password' | 'access'; hasPassword: boolean };

export function AccountAccessSettings({ email }: { email: string }) {
  const { data: session, reload: reloadSession } = useData<Session>('/auth/session');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasPassword = Boolean(session?.hasPassword);
  return <section className="panel">
    <h2>{t('Account security')}</h2>
    <p>{t('Your username is your existing company email:')} <strong>{email}</strong></p>
    <div className="account-security-status">
      <span className="account-security-icon"><ShieldCheck size={19} /></span>
      <div>
        <strong>{t('Password sign-in is active')}</strong>
        <small>{t('Sign in directly with your company email and password.')}</small>
      </div>
      <span className={hasPassword ? 'account-password-badge active' : 'account-password-badge pending'}>
        <KeyRound size={14} /> {t(hasPassword ? 'Password is set.' : 'Password is not set yet.')}
      </span>
    </div>
    <ErrorBox message={error} />
    {saved && <div className="success">{t('Password saved. This browser is now signed in with your password account.')}</div>}
    <form className="account-password-form" onSubmit={async (event) => {
      event.preventDefault(); setError(''); setSaved(false);
      if (password !== confirmPassword) { setError(t('Passwords do not match.')); return; }
      setBusy(true);
      try {
        await api('/auth/password', { method: 'POST', body: JSON.stringify({ password, ...(session?.method === 'password' ? { currentPassword } : {}) }) });
        setPassword(''); setCurrentPassword(''); setConfirmPassword(''); setSaved(true);
        reloadSession();
      } catch (reason) { setError((reason as Error).message); }
      finally { setBusy(false); }
    }}>
      {hasPassword && session?.method === 'password' && <Field label={t('Current password')}><input autoComplete="current-password" type="password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>}
      <Field label={t(hasPassword ? 'New password' : 'Create password')}><input autoComplete="new-password" type="password" minLength={6} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /><small>{t('Use 6–128 characters.')}</small></Field>
      <Field label={t('Confirm password')}><input autoComplete="new-password" type="password" minLength={6} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></Field>
      <button className="primary" disabled={busy}>{busy ? t('Saving…') : t(hasPassword ? 'Change password' : 'Set password')}</button>
    </form>
  </section>;
}
