import { useState, type FormEvent } from 'react';
import {
  type Salesperson,
  type SalespersonInput,
  salespersonName,
} from '../../shared/schemas';
import { api, ApiError, useData } from '../lib';
import { t } from '../i18n';
import { ErrorBox, Field, Loading } from './ui';

function ProfileForm({
  sale,
  onSaved,
  onCancel,
}: {
  sale: Salesperson;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SalespersonInput>({
    firstName: sale.firstName,
    lastName: sale.lastName,
    phone: sale.phone,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      await api(`/salespeople/${encodeURIComponent(sale.email)}`, {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) setFields(e.fields);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void save(e)}>
      <h3>{sale.email}</h3>
      <ErrorBox message={error} />
      <div className="form-grid">
        <Field label={t('First name *')} error={fields.firstName}>
          <input
            autoComplete="off"
            required
            maxLength={100}
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
        </Field>
        <Field label={t('Last name *')} error={fields.lastName}>
          <input
            autoComplete="off"
            required
            maxLength={100}
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </Field>
        <Field label={t('Phone')} error={fields.phone}>
          <input
            type="tel"
            maxLength={50}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>
      </div>
      <div className="button-row">
        <button className="primary" disabled={busy}>
          {busy ? t('Saving…') : t('Save salesperson')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}
export function SalespeopleSettings({ canManageUsers }: { canManageUsers: boolean }) {
  const { data, error, reload } = useData<Salesperson[]>('/salespeople');
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', firstName: '', lastName: '', phone: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [copiedPassword, setCopiedPassword] = useState(false);
  async function createUser(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError('');
    setTemporaryPassword('');
    setCopiedPassword(false);
    try {
      const result = await api<{ email: string; temporaryPassword: string }>('/auth/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });
      setTemporaryPassword(result.temporaryPassword);
      setNewUser({ email: '', firstName: '', lastName: '', phone: '' });
      reload();
    } catch (error) {
      setCreateError((error as Error).message);
    } finally {
      setCreating(false);
    }
  }
  return (
    <section className="panel">
      <h2>{t('Sales team')}</h2>
      <p className="muted">
        {t(
          'Manage names and contact details for your authorized sales accounts. Select these people when assigning leads and follow-ups.',
        )}
      </p>
      <ErrorBox message={error} />
      {canManageUsers && <div className="salesperson-create-user">
        <h3>{t('Add user')}</h3>
        <p className="muted">{t('Create a login for a teammate. A temporary password will be shown once after creation.')}</p>
        <ErrorBox message={createError} />
        <form onSubmit={(event) => void createUser(event)}>
          <div className="form-grid">
            <Field label={t('Username (email)')}><input type="email" autoComplete="email" required maxLength={254} value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} /></Field>
            <Field label={t('First name *')}><input required maxLength={100} value={newUser.firstName} onChange={(event) => setNewUser({ ...newUser, firstName: event.target.value })} /></Field>
            <Field label={t('Last name *')}><input required maxLength={100} value={newUser.lastName} onChange={(event) => setNewUser({ ...newUser, lastName: event.target.value })} /></Field>
            <Field label={t('Phone')}><input type="tel" maxLength={50} value={newUser.phone} onChange={(event) => setNewUser({ ...newUser, phone: event.target.value })} /></Field>
          </div>
          <button className="primary" disabled={creating}>{creating ? t('Creating user…') : t('Add user')}</button>
        </form>
        {temporaryPassword && <div className="salesperson-temp-password" role="status">
          <div><strong>{t('Temporary password')}</strong><p>{t('Share this temporary password with the teammate. They can change it in Settings.')}</p><code>{temporaryPassword}</code></div>
          <button type="button" onClick={() => { void navigator.clipboard.writeText(temporaryPassword).then(() => setCopiedPassword(true)).catch(() => setCopiedPassword(false)); }}>{copiedPassword ? t('Password copied') : t('Copy password')}</button>
        </div>}
      </div>}
      {saved && (
        <div className="success" role="status">
          {t('Salesperson saved.')}
        </div>
      )}
      {!data && !error && <Loading />}
      {data?.map((sale) =>
        editing === sale.email ? (
          <ProfileForm
            key={sale.email}
            sale={sale}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setSaved(true);
              reload();
            }}
          />
        ) : (
          <div className="list-row" key={sale.email}>
            <div className="grow">
              <strong>{salespersonName(sale)}</strong>
              <small>{sale.firstName ? sale.email : t('Name not set')}</small>
              {sale.phone && <small>{sale.phone}</small>}
              <small>
                {t(sale.lineReady ? 'LINE ready' : 'LINE not connected')}
              </small>
            </div>
            <button
              onClick={() => {
                setEditing(sale.email);
                setSaved(false);
              }}
            >
              {t('Edit profile')}
            </button>
          </div>
        ),
      )}
      {!canManageUsers && <small>{t('Ask the workspace administrator to add new user accounts.')}</small>}
    </section>
  );
}
