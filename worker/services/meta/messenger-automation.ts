import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Bindings } from '../../auth';
import { digest } from '../../auth';
import {
  messengerActions,
  messengerAutomationInput,
  messengerDefaults,
  type MessengerAutomationSettings,
} from '../../../shared/meta-messenger';
import { metaAccess } from './access';
import { metaIntegrationStatus } from './integration';
import { isDemo } from './oauth';
import { MetaAPIError, MetaGraphClient, string } from './graph';
import { loadToken, operationAudit, timestamp, uuid } from './store';
import { lineConfigured, lineRequest, workspaceSalesEmails } from '../line';
import type { NormalizedMetaEvent } from './webhooks';

type SettingsRow = {
  enabled: number;
  welcome_text: string;
  contact_label: string;
  acknowledgment_text: string;
  default_salesperson_email: string;
};
async function settingsFor(
  env: Bindings,
  pageId: string,
): Promise<MessengerAutomationSettings> {
  const row = await env.DB.prepare(
    'SELECT * FROM meta_messenger_automation_settings WHERE page_id=?',
  )
    .bind(pageId)
    .first<SettingsRow>();
  return row
    ? {
        enabled: row.enabled === 1,
        welcomeText: row.welcome_text,
        contactLabel: row.contact_label,
        acknowledgmentText: row.acknowledgment_text,
        defaultSalespersonEmail: row.default_salesperson_email,
      }
    : { ...messengerDefaults };
}
async function linkedSalesperson(env: Bindings, email: string) {
  if (!email || !(await workspaceSalesEmails(env)).includes(email)) return null;
  return env.DB.prepare(
    'SELECT email,line_user_id FROM line_accounts WHERE email=? AND enabled=1',
  )
    .bind(email)
    .first<{ email: string; line_user_id: string }>();
}
function buttonMessage(settings: MessengerAutomationSettings) {
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: settings.welcomeText,
        buttons: [
          {
            type: 'postback',
            title: settings.contactLabel,
            payload: messengerActions.contact,
          },
        ],
      },
    },
  };
}
export const messengerAutomationRoutes = new Hono<AppEnv>();
messengerAutomationRoutes.get('/messenger-automation', async (c) => {
  await metaAccess(c, true);
  const status = await metaIntegrationStatus(c.env, true);
  const pageId = status.page?.id ?? '';
  const settings = await settingsFor(c.env, pageId);
  const { results: jobs } = await c.env.DB.prepare(
    'SELECT id,kind,status,recipient_email AS recipientEmail,error_code AS errorCode,created_at AS createdAt FROM meta_messenger_automation_jobs WHERE page_id=? ORDER BY created_at DESC LIMIT 20',
  )
    .bind(pageId)
    .all();
  return c.json({
    settings,
    pageId,
    lineConfigured: lineConfigured(c.env),
    jobs,
  });
});
messengerAutomationRoutes.put('/messenger-automation', async (c) => {
  const actor = await metaAccess(c, true);
  const input = messengerAutomationInput.parse(await c.req.json());
  const status = await metaIntegrationStatus(c.env, true);
  if (status.mode !== 'LIVE' || !status.page)
    throw new HTTPException(409, {
      message: 'Select a live Facebook Page first.',
    });
  if (
    input.enabled &&
    (!status.capabilities.sendMessage ||
      !status.permissions.granted.includes('pages_manage_metadata') ||
      status.permissions.missing.includes('pages_manage_metadata') ||
      !lineConfigured(c.env) ||
      !(await linkedSalesperson(c.env, input.defaultSalespersonEmail)))
  )
    throw new HTTPException(422, {
      message:
        'Choose an active salesperson with LINE connected and validate Messenger access first.',
    });
  const pageId = status.page.id;
  // Profile configuration is idempotent. Activating it does not send a message
  // to an existing visitor: only a new inbound event can queue a reply.
  let profileCleanupPending = false;
  if (input.enabled) {
    const loaded = await loadToken(c.env, 'PAGE', pageId);
    const client = new MetaGraphClient(c.env, loaded.token);
    await client.request(
      'me/messenger_profile',
      {
        get_started: JSON.stringify({ payload: messengerActions.start }),
        greeting: JSON.stringify([
          { locale: 'default', text: input.welcomeText.slice(0, 160) },
        ]),
      },
      'POST',
    );
  } else {
    // Stop locally before removing the entry point, even if Meta is unavailable.
    await c.env.DB.prepare(
      'UPDATE meta_messenger_automation_settings SET enabled=0 WHERE page_id=?',
    )
      .bind(pageId)
      .run();
    try {
      const loaded = await loadToken(c.env, 'PAGE', pageId);
      await new MetaGraphClient(c.env, loaded.token).request(
        'me/messenger_profile',
        { fields: JSON.stringify(['get_started', 'greeting']) },
        'DELETE',
      );
    } catch {
      profileCleanupPending = true;
    }
  }
  const now = timestamp();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO meta_messenger_automation_settings(page_id,enabled,welcome_text,contact_label,acknowledgment_text,default_salesperson_email,updated_by,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET enabled=excluded.enabled,welcome_text=excluded.welcome_text,contact_label=excluded.contact_label,
      acknowledgment_text=excluded.acknowledgment_text,default_salesperson_email=excluded.default_salesperson_email,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    ).bind(
      pageId,
      input.enabled ? 1 : 0,
      input.welcomeText,
      input.contactLabel,
      input.acknowledgmentText,
      input.defaultSalespersonEmail,
      actor.email,
      now,
    ),
    operationAudit(
      c.env,
      'LIVE',
      actor.email,
      'MESSENGER_AUTOMATION_CONFIGURED',
      pageId,
    ),
  ]);
  return c.json({
    saved: true,
    profileCleanupPending,
    settings: await settingsFor(c.env, pageId),
  });
});

type Conversation = {
  id: string;
  sender_id: string;
  assigned_to: string;
  display_name: string;
  last_incoming_at: string | null;
};
export async function enqueueMessengerAutomation(
  env: Bindings,
  event: NormalizedMetaEvent,
) {
  if (
    event.echo ||
    !['MESSAGE', 'POSTBACK'].includes(event.kind) ||
    Date.parse(event.at) < Date.now() - 24 * 3600_000 ||
    (await isDemo(env))
  )
    return;
  const settings = await settingsFor(env, event.pageId);
  if (!settings.enabled) return;
  const conversationId = await digest(
    'LIVE:' + event.pageId + ':' + event.senderId,
  );
  const conversation = await env.DB.prepare(
    "SELECT id,sender_id,assigned_to,display_name,last_incoming_at FROM meta_conversations WHERE id=? AND mode='LIVE'",
  )
    .bind(conversationId)
    .first<Conversation>();
  if (!conversation) return;
  const now = timestamp();
  if (event.kind === 'MESSAGE' || event.payload === messengerActions.start) {
    await queueMessage(
      env,
      event.pageId,
      conversation,
      'WELCOME',
      'welcome:' + conversationId,
      settings.welcomeText,
      buttonMessage(settings),
    );
  }
  if (event.kind !== 'POSTBACK' || event.payload !== messengerActions.contact)
    return;
  // An assigned owner is authoritative. If their LINE is disconnected, surface
  // a failure rather than silently alerting a different salesperson.
  const email = conversation.assigned_to || settings.defaultSalespersonEmail;
  const recipient = await linkedSalesperson(env, email);
  const slot = Math.floor(Date.now() / 900_000);
  const key = `contact:${conversationId}:${slot}`;
  const jobId = uuid();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO meta_messenger_automation_jobs
    (id,dedupe_key,page_id,conversation_id,kind,recipient_email,line_user_id,status,error_code,next_attempt_at,created_at,updated_at)
    VALUES(?,?,?,?,'SALES_LINE',?,?,?,?,?,?,?)`,
    ).bind(
      jobId,
      key,
      event.pageId,
      conversationId,
      email,
      recipient?.line_user_id ?? '',
      recipient ? 'PENDING' : 'FAILED',
      recipient ? null : 'LINE_RECIPIENT_UNAVAILABLE',
      now,
      now,
      now,
    ),
    env.DB.prepare(
      "UPDATE meta_conversations SET status='OPEN',assigned_to=CASE WHEN assigned_to='' THEN ? ELSE assigned_to END,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM meta_messenger_automation_jobs WHERE id=?)",
    ).bind(recipient?.email ?? '', now, conversationId, jobId),
    ...(recipient
      ? messageStatements(
          env,
          event.pageId,
          conversation,
          'CONTACT_ACK',
          key + ':ack',
          settings.acknowledgmentText,
          { text: settings.acknowledgmentText },
          jobId,
        )
      : []),
  ]);
}
async function queueMessage(
  env: Bindings,
  pageId: string,
  conversation: Conversation,
  kind: 'WELCOME' | 'CONTACT_ACK',
  dedupe: string,
  body: string,
  message: object,
) {
  await env.DB.batch(
    messageStatements(env, pageId, conversation, kind, dedupe, body, message),
  );
}
function messageStatements(
  env: Bindings,
  pageId: string,
  conversation: Conversation,
  kind: 'WELCOME' | 'CONTACT_ACK',
  dedupe: string,
  body: string,
  message: object,
  parentJobId?: string,
) {
  const jobId = uuid(),
    messageId = uuid(),
    now = timestamp();
  return [
    env.DB.prepare(
      `INSERT OR IGNORE INTO meta_messenger_automation_jobs(id,dedupe_key,page_id,conversation_id,kind,message_id,payload,next_attempt_at,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM meta_messenger_automation_jobs WHERE id=?)`,
    ).bind(
      jobId,
      dedupe,
      pageId,
      conversation.id,
      kind,
      null,
      JSON.stringify(message),
      now,
      now,
      now,
      parentJobId ?? null,
      parentJobId ?? null,
    ),
    env.DB.prepare(
      `INSERT INTO meta_messages(id,conversation_id,client_request_id,actor_email,direction,body,status,created_at)
      SELECT ?,?,?, 'automation','OUTBOUND',?,'PENDING',? WHERE EXISTS(SELECT 1 FROM meta_messenger_automation_jobs WHERE id=?)`,
    ).bind(messageId, conversation.id, jobId, body, now, jobId),
    env.DB.prepare(
      'UPDATE meta_messenger_automation_jobs SET message_id=? WHERE id=?',
    ).bind(messageId, jobId),
  ];
}
type Job = {
  id: string;
  page_id: string;
  conversation_id: string;
  kind: 'WELCOME' | 'CONTACT_ACK' | 'SALES_LINE';
  message_id: string | null;
  recipient_email: string;
  line_user_id: string;
  payload: string;
  attempts: number;
  created_at: string;
};
export async function processMessengerAutomationJobs(env: Bindings) {
  if (
    env.META_INTEGRATION_ENABLED !== 'true' ||
    env.META_MESSENGER_ENABLED !== 'true' ||
    (await isDemo(env))
  )
    return;
  const now = timestamp();
  // An echo or receipt can settle a send even when the sending worker crashed.
  await env.DB.prepare(
    "UPDATE meta_messenger_automation_jobs SET status='SENT',error_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE status IN ('PROCESSING','UNKNOWN') AND message_id IN (SELECT id FROM meta_messages WHERE status IN ('SENT','DELIVERED','READ'))",
  )
    .bind(now)
    .run();
  // A crashed Meta send has an unknown outcome: never retry it automatically.
  await env.DB.prepare(
    "UPDATE meta_messenger_automation_jobs SET status=CASE WHEN kind='SALES_LINE' THEN CASE WHEN attempts<8 THEN 'PENDING' ELSE 'FAILED' END ELSE 'UNKNOWN' END,error_code='WORKER_INTERRUPTED',lease_token=NULL,lease_until=NULL,updated_at=? WHERE status='PROCESSING' AND lease_until<?",
  )
    .bind(now, now)
    .run();
  await env.DB.prepare(
    "UPDATE meta_messages SET status='UNKNOWN' WHERE status='PENDING' AND id IN (SELECT message_id FROM meta_messenger_automation_jobs WHERE status='UNKNOWN')",
  ).run();
  const { results } = await env.DB.prepare(
    "SELECT id FROM meta_messenger_automation_jobs WHERE status='PENDING' AND next_attempt_at<=? AND attempts<8 ORDER BY created_at,id LIMIT 20",
  )
    .bind(now)
    .all<{ id: string }>();
  for (const row of results) {
    const lease = uuid();
    const job = await env.DB.prepare(
      "UPDATE meta_messenger_automation_jobs SET status='PROCESSING',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=? AND status='PENDING' RETURNING *",
    )
      .bind(lease, new Date(Date.now() + 120_000).toISOString(), now, row.id)
      .first<Job>();
    if (!job) continue;
    let outcome: 'SENT' | 'FAILED' | 'UNKNOWN' | 'CANCELLED' | 'PENDING';
    let errorCode: string | null = null;
    let metaSendAttempted = false;
    try {
      const settings = await settingsFor(env, job.page_id);
      const status = await metaIntegrationStatus(env, true);
      const conversation = await env.DB.prepare(
        'SELECT id,sender_id,assigned_to,display_name,last_incoming_at FROM meta_conversations WHERE id=?',
      )
        .bind(job.conversation_id)
        .first<Conversation>();
      if (
        !settings.enabled ||
        !status.capabilities.sendMessage ||
        status.page?.id !== job.page_id ||
        !conversation ||
        Date.parse(job.created_at) < Date.now() - 24 * 3600_000
      ) {
        outcome = 'CANCELLED';
        errorCode = 'AUTOMATION_OR_PAGE_UNAVAILABLE';
      } else if (job.kind === 'SALES_LINE') {
        const account = await linkedSalesperson(env, job.recipient_email);
        const currentOwner =
          conversation.assigned_to || settings.defaultSalespersonEmail;
        if (
          !lineConfigured(env) ||
          !account ||
          account.line_user_id !== job.line_user_id ||
          currentOwner !== job.recipient_email
        ) {
          outcome = 'CANCELLED';
          errorCode = 'LINE_RECIPIENT_CHANGED';
        } else {
          const origin = new URL(env.APP_URL ?? '');
          if (
            origin.protocol !== 'https:' ||
            origin.username ||
            origin.password
          )
            throw new Error('INVALID_CRM_ORIGIN');
          const response = await lineRequest(env, 'message/push', {
            method: 'POST',
            redirect: 'manual',
            headers: { 'X-Line-Retry-Key': job.id },
            body: JSON.stringify({
              to: account.line_user_id,
              messages: [
                {
                  type: 'text',
                  text: `Corevity · ลูกค้าจาก Facebook ขอคุยกับเซล\nเพจ: ${status.page.name}\nลูกค้า: ${conversation.display_name.slice(0, 100)}\nเปิดบทสนทนา: ${origin.origin}/meta/inbox?conversation=${encodeURIComponent(conversation.id)}`,
                },
              ],
            }),
          });
          const accepted =
            response.ok ||
            (response.status === 409 &&
              Boolean(response.headers.get('x-line-accepted-request-id')));
          outcome = accepted
            ? 'SENT'
            : (response.status === 429 || response.status >= 500) &&
                job.attempts < 8
              ? 'PENDING'
              : 'FAILED';
          errorCode = accepted ? null : `LINE_HTTP_${response.status}`;
        }
      } else if (
        !conversation.last_incoming_at ||
        Date.parse(conversation.last_incoming_at) < Date.now() - 24 * 3600_000
      ) {
        outcome = 'CANCELLED';
        errorCode = 'MESSAGING_WINDOW_CLOSED';
      } else {
        const loaded = await loadToken(env, 'PAGE', job.page_id);
        const message = {
          ...JSON.parse(job.payload),
          metadata: job.message_id,
        };
        metaSendAttempted = true;
        const result = await new MetaGraphClient(env, loaded.token).request(
          job.page_id + '/messages',
          {
            recipient: JSON.stringify({ id: conversation.sender_id }),
            messaging_type: 'RESPONSE',
            message: JSON.stringify(message),
          },
          'POST',
        );
        const mid = string(result.message_id);
        if (!mid) throw new MetaAPIError(0, true, true);
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE meta_messages SET provider_message_id=?,status=CASE WHEN status IN ('READ','DELIVERED') THEN status ELSE 'SENT' END WHERE id=?",
          ).bind(mid, job.message_id),
          env.DB.prepare(
            'UPDATE meta_conversations SET last_message_at=MAX(last_message_at,?),updated_at=? WHERE id=?',
          ).bind(now, now, conversation.id),
        ]);
        outcome = 'SENT';
      }
    } catch (error) {
      if (job.kind === 'SALES_LINE')
        outcome = job.attempts < 8 ? 'PENDING' : 'FAILED';
      else
        outcome =
          error instanceof MetaAPIError
            ? error.ambiguous
              ? 'UNKNOWN'
              : 'FAILED'
            : metaSendAttempted
              ? 'UNKNOWN'
              : 'FAILED';
      errorCode =
        error instanceof MetaAPIError
          ? 'META_' + error.providerCode
          : 'AUTOMATION_REQUEST_FAILED';
    }
    await env.DB.prepare(
      'UPDATE meta_messenger_automation_jobs SET status=?,error_code=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?',
    )
      .bind(
        outcome,
        errorCode,
        new Date(
          Date.now() + Math.min(3600, 30 * 2 ** job.attempts) * 1000,
        ).toISOString(),
        timestamp(),
        job.id,
        lease,
      )
      .run();
    if (job.message_id && outcome !== 'SENT')
      await env.DB.prepare(
        "UPDATE meta_messages SET status=? WHERE id=? AND status='PENDING'",
      )
        .bind(outcome === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED', job.message_id)
        .run();
  }
}
