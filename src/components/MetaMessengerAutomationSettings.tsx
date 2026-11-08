import { useState } from 'react';
import { api, useData } from '../lib';
import { metaCopy as copy, useMetaData } from '../meta';
import {
  messengerDefaults,
  type MessengerAutomationSettings,
} from '../../shared/meta-messenger';
import type { Salesperson } from '../../shared/schemas';
import { ErrorBox, Field } from './ui';
import { SalespersonSelect } from './SalespersonSelect';

type AutomationData = {
  settings: MessengerAutomationSettings;
  pageId: string;
  lineConfigured: boolean;
  jobs: {
    id: string;
    kind: string;
    status: string;
    recipientEmail: string;
    errorCode: string | null;
    createdAt: string;
  }[];
};
export function MetaMessengerAutomationSettings({
  pageName,
}: {
  pageName: string;
}) {
  const result = useMetaData<AutomationData>(
    '/integrations/meta/messenger-automation',
    10000,
  );
  const team = useData<Salesperson[]>('/salespeople');
  const [draft, setDraft] = useState<MessengerAutomationSettings | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const value = draft ?? result.data?.settings ?? messengerDefaults;
  const update = (patch: Partial<MessengerAutomationSettings>) => {
    setDraft({ ...value, ...patch });
    setSaved(false);
  };
  const save = async () => {
    if (
      !confirm(
        copy(
          `Save these automatic replies and LINE routing for ${pageName}? New incoming messages can receive the welcome reply; Contact sales alerts the conversation owner or the default salesperson.`,
          `บันทึกข้อความตอบกลับอัตโนมัติสำหรับเพจ ${pageName} หรือไม่? ข้อความเข้าใหม่จะได้รับคำต้อนรับ และปุ่มติดต่อเซลจะแจ้ง LINE หาเจ้าของบทสนทนาหรือเซลเริ่มต้นที่เลือก`,
        ),
      )
    )
      return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const response = await api<{ profileCleanupPending: boolean }>(
        '/integrations/meta/messenger-automation',
        {
          method: 'PUT',
          body: JSON.stringify({ ...value, approvedByHuman: true }),
        },
      );
      if (response.profileCleanupPending)
        setError(
          copy(
            'Automatic replies stopped. Reconnect Meta to remove the welcome entry point.',
            'หยุดตอบอัตโนมัติแล้ว แต่ต้องเชื่อม Meta ใหม่เพื่อลบปุ่มเริ่มต้นใน Messenger',
          ),
        );
      setDraft(value);
      result.reload();
      setSaved(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel meta-automation-settings">
      <h2>
        {copy(
          'Messenger welcome & contact sales',
          'ข้อความต้อนรับและติดต่อเซลผ่าน Messenger',
        )}
      </h2>
      <p>
        {copy(
          'One welcome per conversation. Alerts go to its assigned salesperson, or the default below. Repeated contact clicks are grouped into 15-minute windows.',
          'ต้อนรับครั้งเดียวต่อบทสนทนา แจ้ง LINE หาเซลผู้รับผิดชอบ หากยังไม่มีจะใช้เซลเริ่มต้นด้านล่าง การกดติดต่อซ้ำในรอบ 15 นาทีจะแจ้งครั้งเดียว',
        )}
      </p>
      <ErrorBox message={error || result.error || team.error} />
      {saved && (
        <p role="status">{copy('Settings saved.', 'บันทึกการตั้งค่าแล้ว')}</p>
      )}
      {result.data && !result.data.lineConfigured && (
        <p role="alert">
          {copy(
            'Configure LINE before enabling this feature.',
            'กรุณาเชื่อม LINE ก่อนเปิดใช้งาน',
          )}
        </p>
      )}
      <label className="meta-automation-toggle">
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={busy || !result.data}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        {copy(
          'Enable welcome reply and Contact sales',
          'เปิดข้อความต้อนรับและปุ่มติดต่อเซล',
        )}
      </label>
      <div className="meta-form-grid">
        <Field label={copy('Welcome reply', 'ข้อความต้อนรับ')}>
          <textarea
            rows={3}
            maxLength={640}
            value={value.welcomeText}
            disabled={busy}
            onChange={(e) => update({ welcomeText: e.target.value })}
          />
        </Field>
        <Field label={copy('Contact button title', 'ชื่อปุ่มติดต่อเซล')}>
          <input
            maxLength={20}
            value={value.contactLabel}
            disabled={busy}
            onChange={(e) => update({ contactLabel: e.target.value })}
          />
        </Field>
        <Field
          label={copy(
            'Reply after requesting sales',
            'ข้อความตอบรับคำขอติดต่อเซล',
          )}
        >
          <textarea
            rows={2}
            maxLength={640}
            value={value.acknowledgmentText}
            disabled={busy}
            onChange={(e) => update({ acknowledgmentText: e.target.value })}
          />
        </Field>
        <Field
          label={copy(
            'Default salesperson for LINE alerts',
            'เซลเริ่มต้นสำหรับแจ้ง LINE',
          )}
        >
          <SalespersonSelect
            value={value.defaultSalespersonEmail}
            onChange={(email) => update({ defaultSalespersonEmail: email })}
            salespeople={team.data}
            disabled={busy}
          />
        </Field>
      </div>
      <div
        className="meta-message-preview"
        aria-label={copy('Message preview', 'ตัวอย่างข้อความ')}
      >
        <p>{value.welcomeText}</p>
        <span className="badge">{value.contactLabel}</span>
      </div>
      <button
        disabled={
          busy ||
          !result.data ||
          (value.enabled &&
            (!value.defaultSalespersonEmail || !result.data.lineConfigured))
        }
        onClick={() => void save()}
      >
        {busy
          ? copy('Saving…', 'กำลังบันทึก…')
          : copy('Save welcome settings', 'บันทึกข้อความต้อนรับ')}
      </button>
      <p className="muted">
        {copy(
          'No backfill to old chats. Disable here to stop pending automatic replies. Uncertain Meta sends are never automatically retried. App review is still required for public customer access.',
          'ไม่ส่งย้อนหลังไปแชทเก่า ปิดสวิตช์เพื่อหยุดคำตอบที่รอส่ง หากไม่ทราบผลการส่งจาก Meta จะไม่ส่งซ้ำอัตโนมัติ การใช้กับลูกค้าทั่วไปยังขึ้นกับสิทธิ์และการตรวจสอบของ Meta',
        )}
      </p>
      <h3>{copy('Recent automatic actions', 'สถานะการทำงานล่าสุด')}</h3>
      {!result.data?.jobs.length && (
        <p className="muted">
          {copy('No automatic actions yet.', 'ยังไม่มีการทำงานอัตโนมัติ')}
        </p>
      )}
      <ul>
        {result.data?.jobs.map((job) => (
          <li key={job.id}>
            {copy(
              job.kind,
              (
                {
                  WELCOME: 'ข้อความต้อนรับ',
                  CONTACT_ACK: 'ตอบรับติดต่อเซล',
                  SALES_LINE: 'แจ้ง LINE',
                } as Record<string, string>
              )[job.kind] ?? job.kind,
            )}{' '}
            ·{' '}
            {copy(
              job.status,
              (
                {
                  PENDING: 'รอส่ง',
                  PROCESSING: 'กำลังส่ง',
                  SENT: 'ส่งสำเร็จ',
                  FAILED: 'ส่งไม่สำเร็จ',
                  UNKNOWN: 'รอยืนยันผลจาก Meta',
                  CANCELLED: 'ยกเลิกแล้ว',
                } as Record<string, string>
              )[job.status] ?? job.status,
            )}
            {job.recipientEmail ? ' · ' + job.recipientEmail : ''}
            {job.errorCode ? ' · ' + job.errorCode : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}
