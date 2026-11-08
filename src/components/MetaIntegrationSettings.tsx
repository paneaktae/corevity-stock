import { useState } from 'react';
import { MetaMessengerAutomationSettings } from './MetaMessengerAutomationSettings';
import { Link } from 'react-router-dom';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Globe2,
  RefreshCw,
  ShieldCheck,
  PlugZap,
} from 'lucide-react';
import { metaFlagNames, type MetaStatus } from '../../shared/meta';
import { api, date } from '../lib';
import { useLanguage } from '../i18n';
import { ErrorBox, Field, Loading } from './ui';
import { metaCopy as copy, useMetaData } from '../meta';
const steps = [
  [
    'Meta app preparation',
    'เตรียม Meta App',
    'Create a business app with the Facebook Login, Messenger, Pages and Marketing use cases you intend to use. Confirm business verification, App Review and asset access requirements in Meta before activation.',
    'เตรียมแอปธุรกิจและกรณีใช้งาน Facebook Login, Messenger, Pages และ Marketing ที่ต้องใช้ ตรวจการยืนยันธุรกิจ App Review และสิทธิ์เข้าถึงทรัพยากรใน Meta ก่อนเปิดจริง',
  ],
  [
    'Server configuration',
    'ตั้งค่าฝั่งเซิร์ฟเวอร์',
    'Set the listed variables in the Worker environment. Store app secrets, verify tokens and the encryption key as Worker secrets. No secret values are entered or shown here.',
    'กำหนดตัวแปรใน Worker เก็บ App Secret, Verify Token และกุญแจเข้ารหัสเป็น Worker secrets หน้านี้ไม่รับหรือแสดงค่าความลับ',
  ],
  [
    'OAuth redirect',
    'OAuth Redirect',
    'Register the exact HTTPS callback URL below in the selected Facebook Login use case. Use this configured CRM hostname for sign-in.',
    'ลงทะเบียน HTTPS callback ด้านล่างให้ตรงกับกรณีใช้งาน Facebook Login และใช้ชื่อโฮสต์ CRM ที่ตั้งค่าไว้เข้าสู่ระบบ',
  ],
  [
    'Webhook callback',
    'Webhook Callback',
    'Register the webhook callback and verify token in Meta. Requests are authenticated with the app-secret signature. Subscribe the selected Page after connecting it.',
    'ลงทะเบียน Webhook Callback และ Verify Token ใน Meta คำขอจะถูกตรวจลายเซ็นด้วย App Secret แล้วจึงเปิด subscription ของเพจหลังเชื่อมต่อ',
  ],
  [
    'Account authorization',
    'อนุญาตบัญชี',
    'Connect Facebook using a current password session. The authorization state is one-time, expires in ten minutes and is tied to your session.',
    'เชื่อม Facebook ด้วยเซสชันรหัสผ่านปัจจุบัน Authorization state ใช้ได้ครั้งเดียว หมดอายุในสิบนาที และผูกกับเซสชันของคุณ',
  ],
  [
    'Select Page',
    'เลือกเพจ',
    'Select a Page returned by the authorized account. Page-scoped customer identities are kept separate for every Page.',
    'เลือกเพจที่บัญชีได้รับอนุญาต ข้อมูลตัวตนลูกค้าจะถูกแยกตามแต่ละเพจ',
  ],
  [
    'Permissions',
    'สิทธิ์',
    'Only granted, current permissions and enabled feature flags permit an operation. Reconnect to request missing permissions.',
    'ระบบอนุญาตการทำงานเฉพาะเมื่อมีสิทธิ์ปัจจุบันและเปิด Feature Flag แล้ว หากสิทธิ์ไม่ครบให้เชื่อมใหม่เพื่อขอสิทธิ์',
  ],
  [
    'Ad account',
    'บัญชีโฆษณา',
    'Select an authorized ad account. Reports use its currency, timezone and attribution settings.',
    'เลือกบัญชีโฆษณาที่ได้รับอนุญาต รายงานจะใช้สกุลเงิน เขตเวลา และการตั้งค่า Attribution ของบัญชีนั้น',
  ],
  [
    'Connection check',
    'ตรวจการเชื่อมต่อ',
    'Refresh token validation, subscribe the Page and verify signed webhook events. A successful synthetic test does not verify a live Meta connection.',
    'ตรวจ Token เปิด subscription ของเพจ และตรวจเหตุการณ์ Webhook ที่ลงลายเซ็น การทดสอบจำลองที่ผ่านไม่ได้ยืนยันการเชื่อม Meta จริง',
  ],
  [
    'Activate reviewed features',
    'เปิดใช้ฟีเจอร์ที่ตรวจแล้ว',
    'Enable features gradually in Worker configuration. External writes default off. Staff must approve every outbound message, campaign mutation and Page publication.',
    'เปิดฟีเจอร์ทีละส่วนใน Worker การเขียนข้อมูลภายนอกปิดเป็นค่าเริ่มต้น ทุกข้อความ การแก้โฆษณา และการเผยแพร่เพจต้องมีคนอนุมัติ',
  ],
] as const;
type Asset = {
  id: string;
  name: string;
  selected: number;
  currency?: string;
  timezone?: string;
};
export function MetaIntegrationSettings() {
  useLanguage();
  const status = useMetaData<MetaStatus>('/integrations/meta/status');
  const logs = useMetaData<{
    logs: {
      id: string;
      mode: string;
      action: string;
      outcome: string;
      actorEmail: string;
      createdAt: string;
    }[];
  }>(
    status.data?.capabilities.manageIntegration
      ? '/integrations/meta/logs'
      : null,
  );
  const pages = useMetaData<{ pages: Asset[] }>(
    status.data?.capabilities.manageIntegration && status.data.mode === 'LIVE'
      ? '/integrations/meta/pages'
      : null,
  );
  const accounts = useMetaData<{ accounts: Asset[] }>(
    status.data?.capabilities.manageIntegration && status.data.mode === 'LIVE'
      ? '/integrations/meta/accounts'
      : null,
  );
  const [step, setStep] = useState(0),
    [pageId, setPageId] = useState(''),
    [accountId, setAccountId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const act = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
      status.reload();
      logs.reload();
      pages.reload();
      accounts.reload();
      setNotice(
        copy(
          'Operation completed. Refresh the status to review it.',
          'ดำเนินการแล้ว ตรวจสถานะล่าสุดเพื่อทบทวนผล',
        ),
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const data = status.data;
  if (!data)
    return (
      <>
        <ErrorBox message={status.error} />
        {!status.error && <Loading />}
      </>
    );
  const admin = data.capabilities.manageIntegration,
    demo = data.mode === 'DEMO';
  const current = steps[step],
    origin = window.location.origin;
  const oauthUrl = origin + '/api/integrations/meta/callback',
    webhookUrl = origin + '/api/webhooks/meta';
  return (
    <div className="meta-settings">
      <section className="panel meta-overview">
        <div className="meta-overview-heading">
          <div className="meta-facebook-mark">
            <Globe2 size={22} />
          </div>
          <div>
            <span className={'meta-mode-badge ' + (demo ? 'demo' : 'live')}>
              {demo ? 'DEMO MODE' : 'LIVE MODE'}
            </span>
            <h2>
              {copy(
                'Meta / Facebook integration',
                'การเชื่อมต่อ Meta / Facebook',
              )}
            </h2>
            <p>
              {copy(
                'Connect business assets and review every customer-facing action.',
                'เชื่อมทรัพยากรธุรกิจและตรวจทานทุกการทำงานที่ส่งถึงลูกค้า',
              )}
            </p>
          </div>
          <button
            aria-label={copy('Refresh status', 'รีเฟรชสถานะ')}
            disabled={busy}
            onClick={status.reload}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="meta-status-message neutral" role="status">
          <ShieldCheck size={18} />
          <span>
            <strong>{data.state}</strong>
            {demo
              ? copy(
                  'Simulated assets and operations. No Meta requests are made.',
                  'ทรัพยากรและการทำงานจำลอง ไม่มีการเรียก Meta',
                )
              : data.message}
          </span>
        </div>
        <ErrorBox message={error || status.error} />
        {notice && (
          <div className="meta-save-success" role="status">
            <Check size={16} />
            {notice}
          </div>
        )}
        <div className="meta-status-details">
          <div>
            <span>{copy('Facebook Page', 'เพจ Facebook')}</span>
            <strong>{data.page?.name ?? '—'}</strong>
            <small>
              {data.page?.id ?? copy('Not selected', 'ยังไม่ได้เลือก')}
            </small>
          </div>
          <div>
            <span>{copy('Ad account', 'บัญชีโฆษณา')}</span>
            <strong>{data.adAccount?.name ?? '—'}</strong>
            <small>
              {data.adAccount?.currency} · {data.adAccount?.timezone}
            </small>
          </div>
          <div>
            <span>{copy('Token health', 'สถานะ Token')}</span>
            <strong>{data.tokenHealth}</strong>
            <small>
              {copy('Last sync', 'ซิงก์ล่าสุด')}:{' '}
              {data.lastSyncedAt ? date(data.lastSyncedAt) : '—'}
            </small>
          </div>
          <div>
            <span>{copy('Last webhook', 'Webhook ล่าสุด')}</span>
            <strong>
              {data.lastWebhookAt ? date(data.lastWebhookAt) : '—'}
            </strong>
            <small>
              {copy('Validated server-side', 'ตรวจสอบฝั่งเซิร์ฟเวอร์')}
            </small>
          </div>
        </div>
        <div className="meta-actions">
          {data.capabilities.connect ? (
            <a className="button primary" href="/api/integrations/meta/connect">
              {copy(
                'Connect / reconnect Facebook',
                'เชื่อม / เชื่อม Facebook ใหม่',
              )}
            </a>
          ) : (
            <button disabled>
              {copy('Connect Facebook', 'เชื่อม Facebook')}
            </button>
          )}
          <button
            disabled={!admin || busy || demo || !data.enabled}
            onClick={() =>
              void act(() =>
                api('/integrations/meta/refresh', {
                  method: 'POST',
                  body: '{}',
                }),
              )
            }
          >
            {copy('Validate tokens', 'ตรวจสอบ Token')}
          </button>
          <button
            disabled={!admin || busy || demo || !data.page}
            onClick={() => {
              if (
                window.confirm(
                  copy(
                    'Disconnect and remove encrypted tokens from this CRM?',
                    'ยกเลิกการเชื่อมต่อและนำ Token เข้ารหัสออกจาก CRM หรือไม่?',
                  ),
                )
              )
                void act(() =>
                  api('/integrations/meta/disconnect', {
                    method: 'POST',
                    body: '{}',
                  }),
                );
            }}
          >
            {copy('Disconnect locally', 'ยกเลิกการเชื่อมต่อใน CRM')}
          </button>
          <button
            disabled={!admin || busy || demo || !data.page}
            onClick={() => {
              if (
                window.confirm(
                  copy(
                    'Revoke the app permissions at Meta and disconnect?',
                    'เพิกถอนสิทธิ์แอปที่ Meta และยกเลิกการเชื่อมต่อหรือไม่?',
                  ),
                )
              )
                void act(() =>
                  api('/integrations/meta/disconnect', {
                    method: 'POST',
                    body: JSON.stringify({ revoke: true }),
                  }),
                );
            }}
          >
            {copy('Revoke and disconnect', 'เพิกถอนสิทธิ์และยกเลิก')}
          </button>
          <Link className="button primary" to="/meta/inbox">
            {copy('Open Meta workspace', 'เปิดพื้นที่ทำงาน Meta')}
          </Link>
        </div>
        {!data.configuration.ready && (
          <p className="meta-actions-note">
            {copy(
              'Setup remains accessible while credentials are missing. Live access requires reviewed configuration.',
              'คู่มือตั้งค่ายังเปิดได้ขณะข้อมูลไม่ครบ การใช้ Live ต้องตั้งค่าที่ตรวจสอบแล้ว',
            )}
          </p>
        )}
        {data.integrationError && (
          <ErrorBox message={data.integrationError.message} />
        )}
      </section>
      {admin && !demo && data.page && (
        <MetaMessengerAutomationSettings
          key={data.page.id}
          pageName={data.page.name}
        />
      )}
      <section className="panel meta-demo-controls">
        <div>
          <h2>{copy('Demo Mode', 'โหมดทดลอง')}</h2>
          <p>
            {copy(
              'Enable the master and Demo flags in Worker configuration, then choose Demo here. Enable each feature flag to practice that feature.',
              'เปิด Master และ Demo Flag ใน Worker แล้วเลือก Demo ที่นี่ เปิด Feature Flag ของแต่ละส่วนเพื่อฝึกใช้งาน',
            )}
          </p>
          <small>
            {copy(
              'Demo messages, leads, reports and publications stay isolated from real CRM customers and sales.',
              'ข้อความ ลีด รายงาน และการเผยแพร่ใน Demo แยกจากลูกค้าและการขายจริง',
            )}
          </small>
        </div>
        <div className="meta-demo-switch-wrap">
          <button
            type="button"
            className={'meta-switch' + (demo ? ' on' : '')}
            role="switch"
            aria-label={copy('Demo Mode', 'โหมดทดลอง')}
            aria-checked={demo}
            disabled={!admin || busy || !data.flags.META_DEMO_MODE}
            onClick={() =>
              void act(() =>
                api('/integrations/meta/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ demoEnabled: !demo }),
                }),
              )
            }
          >
            <span />
          </button>
          {demo && (
            <button
              disabled={!admin || busy || !data.enabled}
              onClick={() =>
                void act(() =>
                  api('/meta/demo/connection', {
                    method: 'POST',
                    body: JSON.stringify({
                      connected: data.state !== 'CONNECTED',
                    }),
                  }),
                )
              }
            >
              {data.state === 'CONNECTED'
                ? copy('Simulate disconnect', 'จำลองตัดการเชื่อมต่อ')
                : copy('Simulate connect', 'จำลองเชื่อมต่อ')}
            </button>
          )}
        </div>
      </section>
      <section className="panel meta-wizard">
        <div className="meta-wizard-heading">
          <div>
            <h2>{copy('Setup guide', 'คู่มือตั้งค่า')}</h2>
            <p className="muted">
              {copy(
                'Review configuration before production activation.',
                'ทบทวนการตั้งค่าก่อนเปิดใช้งานจริง',
              )}
            </p>
          </div>
          <span className="meta-step-count">{step + 1} / 10</span>
        </div>
        <div
          className="meta-step-track"
          role="group"
          aria-label={copy('Setup steps', 'ขั้นตอนตั้งค่า')}
        >
          {steps.map((entry, index) => (
            <button
              key={entry[0]}
              className={'meta-step-dot' + (step === index ? ' current' : '')}
              aria-current={step === index ? 'step' : undefined}
              aria-label={copy(entry[0], entry[1])}
              onClick={() => setStep(index)}
            >
              {index + 1}
            </button>
          ))}
        </div>
        <article className="meta-current-step">
          <div className="meta-step-icon">
            <PlugZap size={22} />
          </div>
          <div className="meta-current-copy">
            <h3>{copy(current[0], current[1])}</h3>
            <p>{copy(current[2], current[3])}</p>
            {step === 1 && (
              <div className="meta-config-list">
                {data.configuration.missing.map((name) => (
                  <div key={name}>
                    <span>{name}</span>
                    <small>{copy('Missing', 'ยังไม่มี')}</small>
                  </div>
                ))}
                {data.configuration.invalid.map((name) => (
                  <div className="invalid" key={name}>
                    <span>{name}</span>
                    <small>{copy('Invalid format', 'รูปแบบผิด')}</small>
                  </div>
                ))}
                {data.configuration.ready && (
                  <p>
                    {copy(
                      'Configuration format is complete. Actual account access still needs validation.',
                      'รูปแบบค่าตั้งต้นครบแล้ว ยังต้องตรวจสิทธิ์เข้าถึงบัญชีจริง',
                    )}
                  </p>
                )}
              </div>
            )}
            {(step === 2 || step === 3) && (
              <div className="meta-url-box">
                <span>
                  {copy(
                    'Register the production HTTPS origin; the URL below reflects this browser hostname.',
                    'ลงทะเบียน HTTPS ของ Production URL ด้านล่างอ้างอิงโฮสต์ในเบราว์เซอร์นี้',
                  )}
                </span>
                <code>{step === 2 ? oauthUrl : webhookUrl}</code>
              </div>
            )}
            {(step === 5 || step === 7) && (
              <div className="meta-form-grid">
                <Field label={copy('Facebook Page', 'เพจ Facebook')}>
                  <select
                    value={pageId || data.page?.id || ''}
                    disabled={!admin || busy || demo}
                    onChange={(e) => setPageId(e.target.value)}
                  >
                    <option value="">{copy('Choose Page', 'เลือกเพจ')}</option>
                    {pages.data?.pages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={copy('Ad account (optional)', 'บัญชีโฆษณา (ถ้ามี)')}
                >
                  <select
                    value={accountId ?? data.adAccount?.id ?? ''}
                    disabled={!admin || busy || demo}
                    onChange={(e) => setAccountId(e.target.value)}
                  >
                    <option value="">
                      {copy('Choose account', 'เลือกบัญชี')}
                    </option>
                    {accounts.data?.accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {account.currency}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  disabled={
                    !admin || busy || demo || !(pageId || data.page?.id)
                  }
                  onClick={() =>
                    void act(() =>
                      api('/integrations/meta/assets', {
                        method: 'POST',
                        body: JSON.stringify({
                          pageId: pageId || data.page!.id,
                          ...((accountId ?? data.adAccount?.id)
                            ? { accountId: accountId ?? data.adAccount!.id }
                            : {}),
                        }),
                      }),
                    )
                  }
                >
                  {copy('Save selected assets', 'บันทึกทรัพยากรที่เลือก')}
                </button>
                <ErrorBox message={pages.error || accounts.error} />
              </div>
            )}
            {step === 6 && (
              <div className="meta-permission-chips">
                {data.permissions.granted.map((permission) => (
                  <span className="granted" key={permission}>
                    <Check size={13} />
                    {permission}
                  </span>
                ))}
                {data.permissions.missing.map((permission) => (
                  <span className="missing" key={permission}>
                    {permission}
                  </span>
                ))}
                {!data.permissions.granted.length &&
                  !data.permissions.missing.length && (
                    <p>
                      {copy(
                        'No permission records yet.',
                        'ยังไม่มีบันทึกสิทธิ์',
                      )}
                    </p>
                  )}
              </div>
            )}
            {step === 8 && (
              <div className="meta-actions">
                <button
                  disabled={!admin || busy || !data.page}
                  onClick={() => {
                    if (
                      window.confirm(
                        copy(
                          'Subscribe this Page to the enabled webhook events?',
                          'เปิดรับ Webhook ที่เปิดใช้งานสำหรับเพจนี้หรือไม่?',
                        ),
                      )
                    )
                      void act(() =>
                        api('/integrations/meta/subscribe', {
                          method: 'POST',
                          body: JSON.stringify({ approvedByHuman: true }),
                        }),
                      );
                  }}
                >
                  {copy(
                    'Subscribe selected Page',
                    'เปิด Webhook ของเพจที่เลือก',
                  )}
                </button>
                <Link to="/meta/webhooks">
                  {copy('View event processing', 'ดูการประมวลผลเหตุการณ์')}
                </Link>
              </div>
            )}
          </div>
        </article>
        <div className="meta-wizard-footer">
          <button disabled={step === 0} onClick={() => setStep((v) => v - 1)}>
            <ChevronLeft size={16} />
            {copy('Previous', 'ก่อนหน้า')}
          </button>
          <button disabled={step === 9} onClick={() => setStep((v) => v + 1)}>
            {copy('Next', 'ถัดไป')}
            <ChevronRight size={16} />
          </button>
        </div>
      </section>
      <section className="panel meta-feature-panel">
        <h2>{copy('Feature flags', 'Feature Flags')}</h2>
        <p className="muted">
          {copy(
            'These are deployment settings. A flag alone never bypasses permissions or human approval.',
            'ค่าเหล่านี้ตั้งใน Deployment การเปิด Flag ไม่ข้ามสิทธิ์หรือการอนุมัติของคน',
          )}
        </p>
        <div className="meta-feature-grid">
          {metaFlagNames.map((name) => (
            <div className="meta-feature-row" key={name}>
              <span
                className={
                  'meta-feature-dot' + (data.flags[name] ? ' configured' : '')
                }
              />
              <div>
                <strong>{name}</strong>
                <small>
                  {data.flags[name]
                    ? copy('Enabled', 'เปิด')
                    : copy('Disabled', 'ปิด')}
                </small>
              </div>
            </div>
          ))}
        </div>
      </section>
      {admin && (
        <section className="panel meta-logs">
          <h2>{copy('Integration audit logs', 'บันทึกการเชื่อมต่อ')}</h2>
          <ErrorBox message={logs.error} />
          <div className="meta-log-list">
            {logs.data?.logs.map((entry) => (
              <div key={entry.id}>
                <span className="meta-log-outcome">
                  {entry.outcome === 'SUCCESS' ? (
                    <Check size={14} />
                  ) : (
                    entry.outcome
                  )}
                </span>
                <strong>{entry.action}</strong>
                <small>
                  {entry.mode} · {entry.actorEmail}
                </small>
                <time>{date(entry.createdAt)}</time>
              </div>
            ))}
          </div>
          {logs.data?.logs.length === 0 && (
            <p className="muted">
              {copy('No events yet.', 'ยังไม่มีเหตุการณ์')}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
