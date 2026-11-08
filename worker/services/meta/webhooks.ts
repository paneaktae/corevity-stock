import { z } from 'zod';
import type { Bindings } from '../../auth';
import { digest } from '../../auth';
import { isDemo } from './oauth';
import { timestamp, uuid } from './store';
import {
  enqueueMessengerAutomation,
  processMessengerAutomationJobs,
} from './messenger-automation';
const encoder = new TextEncoder();
const idSchema = z.string().regex(/^\d+$/).max(100);
const eventSchema = z.object({
  sender: z.object({ id: idSchema }),
  recipient: z.object({ id: idSchema }),
  timestamp: z.number().finite().nonnegative().max(8.64e15).optional(),
  message: z
    .object({
      mid: z.string().min(1).max(512),
      text: z.string().max(10000).optional(),
      is_echo: z.boolean().optional(),
      metadata: z.string().max(512).optional(),
      attachments: z.array(z.unknown()).max(30).optional(),
    })
    .optional(),
  delivery: z
    .object({
      mids: z.array(z.string().max(512)).max(1000).optional(),
      watermark: z.number().nonnegative().max(8.64e15).optional(),
    })
    .optional(),
  read: z
    .object({ watermark: z.number().nonnegative().max(8.64e15) })
    .optional(),
  postback: z
    .object({
      mid: z.string().max(512).optional(),
      title: z.string().max(1000).optional(),
      payload: z.string().max(2000).optional(),
    })
    .optional(),
});
const webhookSchema = z.object({
  object: z.literal('page'),
  entry: z
    .array(
      z.object({
        id: idSchema,
        time: z.number().optional(),
        messaging: z.array(eventSchema).max(100).optional(),
        changes: z
          .array(
            z.object({
              field: z.string().max(100),
              value: z.object({
                leadgen_id: idSchema.optional(),
                page_id: idSchema.optional(),
                form_id: idSchema.optional(),
              }),
            }),
          )
          .max(100)
          .optional(),
      }),
    )
    .max(50),
});
export type NormalizedMetaEvent = {
  kind: 'MESSAGE' | 'DELIVERY' | 'READ' | 'POSTBACK' | 'LEAD';
  pageId: string;
  senderId: string;
  at: string;
  mid?: string;
  text?: string;
  payload?: string;
  echo?: boolean;
  clientId?: string;
  attachment?: boolean;
  mids?: string[];
  hasWatermark?: boolean;
  leadId?: string;
  formId?: string;
};
export async function verifyMetaSignature(
  body: Uint8Array,
  signature: string | null,
  secret: string,
) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature))
    return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const sig = Uint8Array.from(signature.slice(7).match(/../g)!, (v) =>
    parseInt(v, 16),
  );
  return crypto.subtle.verify('HMAC', key, sig, new Uint8Array(body));
}
export function normalizeMetaWebhook(
  input: unknown,
  now = new Date(),
): NormalizedMetaEvent[] {
  const payload = webhookSchema.parse(input);
  const events: NormalizedMetaEvent[] = [];
  const iso = (value?: number) =>
    new Date(Math.min(value ?? now.getTime(), now.getTime())).toISOString();
  for (const entry of payload.entry) {
    for (const event of entry.messaging ?? []) {
      const echo = event.message?.is_echo === true;
      if ((echo ? event.sender.id : event.recipient.id) !== entry.id) continue;
      const base = {
        pageId: entry.id,
        senderId: echo ? event.recipient.id : event.sender.id,
        at: iso(event.timestamp),
      };
      if (event.message)
        events.push({
          ...base,
          kind: 'MESSAGE',
          mid: event.message.mid,
          text: event.message.text?.slice(0, 4000) ?? '',
          echo,
          clientId: event.message.metadata,
          attachment: Boolean(event.message.attachments?.length),
        });
      else if (event.postback)
        events.push({
          ...base,
          kind: 'POSTBACK',
          mid: event.postback.mid,
          text: event.postback.title ?? '[Postback]',
          payload: event.postback.payload,
        });
      else if (event.read)
        events.push({ ...base, kind: 'READ', at: iso(event.read.watermark) });
      else if (event.delivery)
        events.push({
          ...base,
          kind: 'DELIVERY',
          at: iso(event.delivery.watermark),
          mids: event.delivery.mids,
          hasWatermark: event.delivery.watermark !== undefined,
        });
    }
    for (const change of entry.changes ?? [])
      if (
        change.field === 'leadgen' &&
        change.value.leadgen_id &&
        change.value.form_id &&
        (!change.value.page_id || change.value.page_id === entry.id)
      )
        events.push({
          kind: 'LEAD',
          pageId: entry.id,
          senderId: '',
          at: iso(),
          leadId: change.value.leadgen_id,
          formId: change.value.form_id,
        });
  }
  if (events.length > 500) throw new Error('META_PAYLOAD_TOO_LARGE');
  return events;
}
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1_048_576) {
      await reader.cancel();
      throw new Error('SIZE');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export async function handleMetaWebhook(
  request: Request,
  env: Bindings,
  ctx: ExecutionContext,
) {
  if (
    env.META_INTEGRATION_ENABLED !== 'true' ||
    !env.META_APP_SECRET ||
    !env.META_WEBHOOK_VERIFY_TOKEN
  )
    return new Response('Meta webhook is not configured', { status: 503 });
  if (request.method === 'GET') {
    const url = new URL(request.url),
      challenge = url.searchParams.get('hub.challenge') ?? '';
    const received = await digest(
        url.searchParams.get('hub.verify_token') ?? '',
      ),
      expected = await digest(env.META_WEBHOOK_VERIFY_TOKEN);
    let difference = 0;
    for (let i = 0; i < 64; i++)
      difference |= received.charCodeAt(i) ^ expected.charCodeAt(i);
    return url.searchParams.get('hub.mode') === 'subscribe' &&
      challenge.length > 0 &&
      challenge.length <= 1000 &&
      difference === 0
      ? new Response(challenge, {
          headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-store',
          },
        })
      : new Response('Forbidden', { status: 403 });
  }
  if (request.method !== 'POST')
    return new Response('Method not allowed', { status: 405 });
  let body: Uint8Array;
  try {
    body = await readBody(request);
  } catch {
    return new Response('Payload too large', { status: 413 });
  }
  if (
    !(await verifyMetaSignature(
      body,
      request.headers.get('X-Hub-Signature-256'),
      env.META_APP_SECRET,
    ))
  )
    return new Response('Invalid signature', { status: 403 });
  if (await isDemo(env))
    return new Response('Live processing is disabled in Demo Mode', {
      status: 503,
    });
  let events: NormalizedMetaEvent[];
  try {
    events = normalizeMetaWebhook(JSON.parse(new TextDecoder().decode(body)));
  } catch {
    return new Response('Invalid payload', { status: 400 });
  }
  const statements: D1PreparedStatement[] = [];
  const accepted = new Set<string>();
  for (const pageId of new Set(events.map((event) => event.pageId))) {
    const page = await env.DB.prepare(
      "SELECT p.id FROM meta_pages p JOIN meta_connections c ON c.id=p.connection_id WHERE c.mode='LIVE' AND c.status='CONNECTED' AND p.selected=1 AND p.provider_page_id=?",
    )
      .bind(pageId)
      .first();
    if (page) accepted.add(pageId);
  }
  for (const event of events.filter((v) => accepted.has(v.pageId))) {
    if (event.kind === 'LEAD' && env.META_LEADS_ENABLED !== 'true') continue;
    if (event.kind !== 'LEAD' && env.META_MESSENGER_ENABLED !== 'true')
      continue;
    const eventId = await digest(JSON.stringify(event));
    statements.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO meta_webhook_events(id,page_id,kind,payload,next_attempt_at,created_at) VALUES(?,?,?,?,?,?)',
      ).bind(
        eventId,
        event.pageId,
        event.kind,
        JSON.stringify(event),
        timestamp(),
        timestamp(),
      ),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  ctx.waitUntil(processMetaWebhooks(env).catch(() => undefined));
  return new Response('EVENT_RECEIVED', {
    headers: { 'Cache-Control': 'no-store' },
  });
}
export async function persistMetaEvent(
  env: Bindings,
  event: NormalizedMetaEvent,
) {
  const now = timestamp();
  if (event.kind === 'LEAD') {
    const id = await digest(event.pageId + ':' + event.leadId);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO meta_lead_sync_events(id,page_id,form_id,provider_lead_id,status,created_at,updated_at) VALUES(?,?,?,?,'PENDING',?,?)",
      ).bind(id, event.pageId, event.formId!, event.leadId!, now, now),
      env.DB.prepare(
        "INSERT OR IGNORE INTO meta_sync_jobs(id,mode,kind,asset_id,payload,next_attempt_at,created_at,updated_at) VALUES(?,'LIVE','LEAD_IMPORT',?,?,?,?,?)",
      ).bind(
        id,
        event.leadId!,
        JSON.stringify({ pageId: event.pageId, formId: event.formId }),
        now,
        now,
        now,
      ),
    ]);
    return;
  }
  const conversationId = await digest(
    'LIVE:' + event.pageId + ':' + event.senderId,
  );
  if (event.kind === 'READ' || event.kind === 'DELIVERY') {
    if (event.kind === 'DELIVERY' && !event.hasWatermark) {
      const mids = event.mids ?? [];
      if (mids.length)
        await env.DB.batch(
          mids.map((mid) =>
            env.DB.prepare(
              "UPDATE meta_messages SET status='DELIVERED' WHERE conversation_id=? AND provider_message_id=? AND direction='OUTBOUND' AND status IN ('PENDING','SENT')",
            ).bind(conversationId, mid),
          ),
        );
      return;
    }
    const field = event.kind === 'READ' ? 'read_at' : 'delivered_at';
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO meta_receipt_watermarks(page_id,sender_id,' +
          field +
          ') VALUES(?,?,?) ON CONFLICT(page_id,sender_id) DO UPDATE SET ' +
          field +
          '=MAX(COALESCE(' +
          field +
          ",''),excluded." +
          field +
          ')',
      ).bind(event.pageId, event.senderId, event.at),
      env.DB.prepare(
        "UPDATE meta_messages SET status=? WHERE conversation_id=? AND direction='OUTBOUND' AND status IN ('PENDING','SENT','DELIVERED') AND created_at<=?",
      ).bind(
        event.kind === 'READ' ? 'READ' : 'DELIVERED',
        conversationId,
        event.at,
      ),
    ]);
    return;
  }
  const messageId = uuid();
  const identity = await env.DB.prepare(
    "SELECT customer_id FROM meta_customer_identities WHERE provider='FACEBOOK' AND page_id=? AND provider_user_id=?",
  )
    .bind(event.pageId, event.senderId)
    .first<{ customer_id: string }>();
  const existingEcho =
    event.echo && event.clientId
      ? await env.DB.prepare(
          "SELECT id FROM meta_messages WHERE id=? AND conversation_id=? AND direction='OUTBOUND' AND status IN ('PENDING','UNKNOWN','SENT','DELIVERED','READ')",
        )
          .bind(event.clientId, conversationId)
          .first<{ id: string }>()
      : null;
  const receipt = event.echo
    ? await env.DB.prepare(
        'SELECT delivered_at,read_at FROM meta_receipt_watermarks WHERE page_id=? AND sender_id=?',
      )
        .bind(event.pageId, event.senderId)
        .first<{ delivered_at: string | null; read_at: string | null }>()
    : null;
  const messageStatus = event.echo
    ? receipt?.read_at && receipt.read_at >= event.at
      ? 'READ'
      : receipt?.delivered_at && receipt.delivered_at >= event.at
        ? 'DELIVERED'
        : 'SENT'
    : 'RECEIVED';
  if (existingEcho) {
    await env.DB.prepare(
      "UPDATE meta_messages SET status=CASE WHEN status='READ' THEN 'READ' WHEN status='DELIVERED' AND ?='SENT' THEN 'DELIVERED' ELSE ? END,provider_message_id=? WHERE id=? AND (provider_message_id IS NULL OR provider_message_id=?)",
    )
      .bind(
        messageStatus,
        messageStatus,
        event.mid!,
        existingEcho.id,
        event.mid!,
      )
      .run();
    return;
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO meta_conversations(id,mode,page_id,sender_id,display_name,customer_id,last_message_at,created_at,updated_at) VALUES(?,'LIVE',?,?,'Facebook visitor',?,?,?,?) ON CONFLICT(mode,page_id,sender_id) DO NOTHING",
    ).bind(
      conversationId,
      event.pageId,
      event.senderId,
      identity?.customer_id ?? null,
      event.at,
      now,
      now,
    ),
    env.DB.prepare(
      'INSERT OR IGNORE INTO meta_messages(id,conversation_id,provider_message_id,direction,body,kind,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
    ).bind(
      messageId,
      conversationId,
      event.mid ?? (await digest(JSON.stringify(event))),
      event.echo ? 'OUTBOUND' : 'INBOUND',
      event.text || '[Attachment]',
      event.kind === 'POSTBACK'
        ? 'POSTBACK'
        : event.attachment
          ? 'ATTACHMENT'
          : 'TEXT',
      messageStatus,
      event.at,
    ),
    env.DB.prepare(
      "UPDATE meta_conversations SET last_message_at=MAX(last_message_at,?),last_incoming_at=CASE WHEN ?=1 THEN MAX(COALESCE(last_incoming_at,''),?) ELSE last_incoming_at END,unread_count=unread_count+?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM meta_messages WHERE id=?)",
    ).bind(
      event.at,
      event.echo ? 0 : 1,
      event.at,
      event.echo ? 0 : 1,
      now,
      conversationId,
      messageId,
    ),
  ]);
}
export async function processMetaWebhooks(env: Bindings) {
  if (env.META_INTEGRATION_ENABLED !== 'true' || (await isDemo(env))) return;
  const now = timestamp();
  const rows = await env.DB.prepare(
    "SELECT id FROM meta_webhook_events WHERE attempts<8 AND ((status='PENDING' AND next_attempt_at<=?) OR (status='PROCESSING' AND lease_until<?)) ORDER BY created_at LIMIT 20",
  )
    .bind(now, now)
    .all<{ id: string }>();
  for (const row of rows.results) {
    const lease = uuid();
    const event = await env.DB.prepare(
      "UPDATE meta_webhook_events SET status='PROCESSING',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND attempts<8 AND ((status='PENDING' AND next_attempt_at<=?) OR (status='PROCESSING' AND lease_until<?)) RETURNING payload,attempts,page_id",
    )
      .bind(
        lease,
        new Date(Date.now() + 120_000).toISOString(),
        row.id,
        now,
        now,
      )
      .first<{ payload: string; attempts: number; page_id: string }>();
    if (!event) continue;
    try {
      const stillSelected = await env.DB.prepare(
        "SELECT p.id FROM meta_pages p JOIN meta_connections c ON c.id=p.connection_id WHERE p.provider_page_id=? AND p.selected=1 AND c.mode='LIVE' AND c.status='CONNECTED'",
      )
        .bind(event.page_id)
        .first();
      if (stillSelected) {
        await persistMetaEvent(
          env,
          JSON.parse(event.payload) as NormalizedMetaEvent,
        );
        await enqueueMessengerAutomation(
          env,
          JSON.parse(event.payload) as NormalizedMetaEvent,
        );
      }
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE meta_webhook_events SET status=?,processed_at=?,lease_token=NULL,lease_until=NULL,error_code=NULL WHERE id=? AND lease_token=?',
        ).bind(
          stillSelected ? 'PROCESSED' : 'IGNORED',
          timestamp(),
          row.id,
          lease,
        ),
        env.DB.prepare(
          "UPDATE meta_connections SET last_webhook_at=? WHERE mode='LIVE'",
        ).bind(timestamp()),
      ]);
    } catch {
      await env.DB.prepare(
        "UPDATE meta_webhook_events SET status=?,error_code='PROCESSING_FAILED',next_attempt_at=?,lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?",
      )
        .bind(
          event.attempts >= 8 ? 'FAILED' : 'PENDING',
          new Date(
            Date.now() + Math.min(3600, 30 * 2 ** event.attempts) * 1000,
          ).toISOString(),
          row.id,
          lease,
        )
        .run();
    }
  }
  await processMessengerAutomationJobs(env);
}
