import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv, Bindings } from '../../auth';
import { digest } from '../../auth';
import type { MetaConversation } from '../../../shared/meta-domain';
import {
  conversationPatch,
  messageInput,
  leadConversionInput,
} from '../../../shared/meta-domain';
import { metaContext, type MetaContext } from './context';
import { metaAccess } from './access';
import { operationAudit, rateLimit, timestamp, uuid } from './store';
import { workspaceSalesEmails } from '../line';
import { string, object, MetaAPIError } from './graph';

export async function ensureDemoInbox(env: Bindings) {
  const now = timestamp(),
    incoming = new Date(Date.now() - 3600_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO meta_conversations(id,mode,page_id,sender_id,display_name,last_incoming_at,last_message_at,unread_count,created_at,updated_at) VALUES('demo:conversation','DEMO','demo:page','demo:visitor','Demo visitor',?,?,1,?,?)",
    ).bind(incoming, incoming, now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO meta_messages(id,conversation_id,provider_message_id,direction,body,status,created_at) VALUES('demo:incoming','demo:conversation','demo:mid','INBOUND','Do you have a used treadmill?','RECEIVED',?)",
    ).bind(incoming),
  ]);
}
export async function findConversation(
  env: Bindings,
  ctx: MetaContext,
  id: string,
) {
  const row = await env.DB.prepare(
    'SELECT * FROM meta_conversations WHERE id=? AND mode=? AND page_id=?',
  )
    .bind(id, ctx.mode, ctx.pageId)
    .first<MetaConversation>();
  if (!row)
    throw new HTTPException(404, { message: 'Conversation not found.' });
  return row;
}
export async function publicProducts(
  env: Bindings,
  query = '',
  brand = '',
  category = '',
  availability = '',
  productId = '',
) {
  let base: URL;
  try {
    base = new URL(env.PUBLIC_CATALOG_BASE_URL ?? '');
    if (base.protocol !== 'https:' || base.username || base.password)
      throw new Error();
  } catch {
    return [];
  }
  const rows = await env.DB.prepare(
    "SELECT p.id,p.brand,p.model,p.category,p.condition,p.status,p.public_slug,p.selling_price,p.show_price,(SELECT id FROM product_images WHERE product_id=p.id ORDER BY is_primary DESC,sort_order LIMIT 1) AS image_id FROM products p WHERE p.archived_at IS NULL AND p.is_published=1 AND p.public_slug IS NOT NULL AND (p.brand LIKE ? OR p.model LIKE ? OR p.sku LIKE ?) AND (?='' OR p.brand=?) AND (?='' OR p.category=?) AND (?='' OR p.status=?) AND (?='' OR p.id=?) ORDER BY p.brand,p.model LIMIT 50",
  )
    .bind(
      '%' + query + '%',
      '%' + query + '%',
      '%' + query + '%',
      brand,
      brand,
      category,
      category,
      availability,
      availability,
      productId,
      productId,
    )
    .all<{
      id: string;
      brand: string;
      model: string;
      category: string;
      condition: string;
      status: string;
      public_slug: string;
      selling_price: number;
      show_price: number;
      image_id: string | null;
    }>();
  return rows.results.map((p) => ({
    id: p.id,
    brand: p.brand,
    model: p.model,
    category: p.category,
    condition: p.condition,
    status: p.status,
    price: p.show_price === 1 ? p.selling_price : null,
    currency: 'THB',
    url: new URL('/catalog/products/' + encodeURIComponent(p.public_slug), base)
      .href,
    imageUrl: p.image_id
      ? new URL(
          '/media/products/' +
            encodeURIComponent(p.public_slug) +
            '/image/' +
            encodeURIComponent(p.image_id),
          base,
        ).href
      : null,
  }));
}
const textInput = z
  .object({ body: z.string().trim().min(1).max(4000) })
  .strict();
const limitedQuery = z.string().max(100).default('');
export const metaInboxRoutes = new Hono<AppEnv>();
// Use the authenticated CRM origin for previews; public image URLs remain suitable
// for sharing with Meta, while the CRM's self-only image policy stays intact.
metaInboxRoutes.get('/products/:id/thumbnail', async (c) => {
  await metaAccess(c);
  const image = await c.env.DB.prepare(
    `SELECT i.r2_key,i.mime_type FROM products p JOIN product_images i ON i.product_id=p.id
     WHERE p.id=? AND p.is_published=1 AND p.archived_at IS NULL
     ORDER BY i.is_primary DESC,i.sort_order LIMIT 1`,
  )
    .bind(c.req.param('id'))
    .first<{ r2_key: string; mime_type: string }>();
  if (!image) return c.notFound();
  const stored = await c.env.PRODUCT_IMAGES.get(image.r2_key);
  if (!stored) return c.notFound();
  return new Response(stored.body, {
    headers: {
      'Content-Type':
        image.mime_type || stored.httpMetadata?.contentType || 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
});
metaInboxRoutes.get('/products', async (c) => {
  const ctx = await metaContext(c);
  if (
    !ctx.status.capabilities.readMessenger &&
    !ctx.status.capabilities.publishContent &&
    !ctx.status.capabilities.useAI
  )
    throw new HTTPException(403, {
      message:
        'Product sharing requires an enabled Messenger, Page content or AI feature.',
    });
  return c.json({
    products: await publicProducts(
      c.env,
      limitedQuery.parse(c.req.query('q')),
      limitedQuery.parse(c.req.query('brand')),
      limitedQuery.parse(c.req.query('category')),
      limitedQuery.parse(c.req.query('status')),
    ),
  });
});
metaInboxRoutes.get('/conversations', async (c) => {
  const ctx = await metaContext(c, 'readMessenger');
  if (ctx.mode === 'DEMO') await ensureDemoInbox(c.env);
  const input = z
    .object({
      q: limitedQuery,
      status: z.string().max(30).default(''),
      assigned: z.string().max(254).default(''),
      before: z.iso.datetime().optional(),
      beforeId: z.string().max(100).default(''),
    })
    .parse(c.req.query());
  const rows = await c.env.DB.prepare(
    "SELECT * FROM meta_conversations WHERE mode=? AND page_id=? AND (display_name LIKE ? OR sender_id LIKE ?) AND (?='' OR status=?) AND (?='' OR assigned_to=?) AND (? IS NULL OR last_message_at<? OR (last_message_at=? AND id<?)) ORDER BY last_message_at DESC,id DESC LIMIT 50",
  )
    .bind(
      ctx.mode,
      ctx.pageId,
      '%' + input.q + '%',
      '%' + input.q + '%',
      input.status,
      input.status,
      input.assigned,
      input.assigned,
      input.before ?? null,
      input.before ?? null,
      input.before ?? null,
      input.beforeId,
    )
    .all<MetaConversation>();
  const last = rows.results.at(-1);
  return c.json({
    mode: ctx.mode,
    conversations: rows.results,
    next:
      rows.results.length === 50 && last
        ? { before: last.last_message_at, beforeId: last.id }
        : null,
  });
});
metaInboxRoutes.get('/conversations/:id', async (c) => {
  const ctx = await metaContext(c, 'readMessenger'),
    conversation = await findConversation(c.env, ctx, c.req.param('id'));
  const before = z.iso.datetime().optional().parse(c.req.query('before'));
  const beforeId = z
    .string()
    .max(100)
    .default('')
    .parse(c.req.query('beforeId'));
  const [messages, notes] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id,body,direction,kind,status,created_at FROM meta_messages WHERE conversation_id=? AND status<>'SUPERSEDED' AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 50",
    )
      .bind(
        conversation.id,
        before ?? null,
        before ?? null,
        before ?? null,
        beforeId,
      )
      .all(),
    c.env.DB.prepare(
      'SELECT id,body,actor_email,created_at FROM meta_conversation_notes WHERE conversation_id=? ORDER BY created_at DESC LIMIT 50',
    )
      .bind(conversation.id)
      .all(),
  ]);
  const customer = conversation.customer_id
    ? await c.env.DB.prepare(
        'SELECT id,name,company_name,contact_name,phone,email,budget,interested_in FROM customers WHERE id=?',
      )
        .bind(conversation.customer_id)
        .first()
    : null;
  const last = messages.results.at(-1);
  return c.json({
    mode: ctx.mode,
    conversation,
    customer,
    messages: messages.results.reverse(),
    notes: notes.results,
    next:
      messages.results.length === 50 && last
        ? { before: last.created_at, beforeId: last.id }
        : null,
    messagingWindowOpen: Boolean(
      conversation.last_incoming_at &&
      Date.now() - Date.parse(conversation.last_incoming_at) < 86_400_000,
    ),
    lead:
      ctx.mode === 'LIVE'
        ? await c.env.DB.prepare(
            'SELECT l.id,l.title,l.status,l.assigned_to,l.estimated_value,l.next_follow_up_at,l.viewing_at FROM leads l JOIN meta_lead_links ml ON ml.lead_id=l.id WHERE ml.conversation_id=?',
          )
            .bind(conversation.id)
            .first()
        : await c.env.DB.prepare(
            "SELECT id FROM meta_demo_entities WHERE id=? AND kind='LEAD'",
          )
            .bind('demo:lead:' + conversation.id)
            .first(),
  });
});
metaInboxRoutes.patch('/conversations/:id', async (c) => {
  const ctx = await metaContext(c, 'readMessenger'),
    conversation = await findConversation(c.env, ctx, c.req.param('id'));
  const input = conversationPatch.parse(await c.req.json());
  if (
    input.assignedTo &&
    !(await workspaceSalesEmails(c.env)).includes(input.assignedTo)
  )
    throw new HTTPException(422, { message: 'Choose an active salesperson.' });
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE meta_conversations SET status=?,assigned_to=?,unread_count=CASE WHEN ?=1 THEN 0 ELSE unread_count END,updated_at=? WHERE id=?',
    ).bind(
      input.status ?? conversation.status,
      input.assignedTo ?? conversation.assigned_to,
      input.markRead ? 1 : 0,
      timestamp(),
      conversation.id,
    ),
    operationAudit(
      c.env,
      ctx.mode,
      ctx.email,
      'CONVERSATION_UPDATED',
      conversation.id,
    ),
  ]);
  return c.json({ updated: true });
});
metaInboxRoutes.post('/conversations/:id/notes', async (c) => {
  const ctx = await metaContext(c, 'readMessenger'),
    conversation = await findConversation(c.env, ctx, c.req.param('id'));
  const input = textInput.parse(await c.req.json()),
    id = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO meta_conversation_notes(id,conversation_id,body,actor_email,created_at) VALUES(?,?,?,?,?)',
    ).bind(id, conversation.id, input.body, ctx.email, timestamp()),
    operationAudit(c.env, ctx.mode, ctx.email, 'NOTE_CREATED', id),
  ]);
  return c.json({ id }, 201);
});
export function messagingWindowOpen(
  lastIncomingAt: string | null,
  now = Date.now(),
) {
  const incoming = Date.parse(lastIncomingAt ?? '');
  return (
    Number.isFinite(incoming) && incoming <= now && now - incoming < 86_400_000
  );
}
metaInboxRoutes.post('/conversations/:id/messages', async (c) => {
  const ctx = await metaContext(c, 'sendMessage'),
    conversation = await findConversation(c.env, ctx, c.req.param('id'));
  const input = messageInput.parse(await c.req.json());
  const previous = await c.env.DB.prepare(
    'SELECT id,body,actor_email,status FROM meta_messages WHERE conversation_id=? AND client_request_id=?',
  )
    .bind(conversation.id, input.clientRequestId)
    .first<{ id: string; body: string; actor_email: string; status: string }>();
  if (previous) {
    if (previous.body !== input.text || previous.actor_email !== ctx.email)
      throw new HTTPException(409, {
        message:
          'This message request ID was already used for a different message.',
      });
    return c.json({
      id: previous.id,
      status: previous.status,
      replayed: true,
      mode: ctx.mode,
    });
  }
  if (!messagingWindowOpen(conversation.last_incoming_at))
    throw new HTTPException(409, {
      message:
        'The standard 24-hour messaging window has closed. Wait for a new customer message.',
    });
  if (input.aiDraftId) {
    const draft = await c.env.DB.prepare(
      "SELECT content FROM meta_ai_drafts WHERE id=? AND mode=? AND conversation_id=? AND status='APPROVED' AND approved_by=?",
    )
      .bind(input.aiDraftId, ctx.mode, conversation.id, ctx.email)
      .first<{ content: string }>();
    if (!draft || string(object(JSON.parse(draft.content)).text) !== input.text)
      throw new HTTPException(409, {
        message: 'Review and approve the exact AI draft before sending.',
      });
    const content = object(JSON.parse(draft.content));
    for (const snapshot of Array.isArray(content.productsSnapshot)
      ? content.productsSnapshot.map(object)
      : []) {
      const fresh = (
        await publicProducts(
          c.env,
          '',
          '',
          '',
          'AVAILABLE',
          string(snapshot.id),
        )
      )[0];
      if (!fresh || JSON.stringify(fresh) !== JSON.stringify(snapshot))
        throw new HTTPException(409, {
          message:
            'Inventory changed. Generate and approve a fresh reply before sending.',
        });
    }
  }
  await rateLimit(c.env, ctx.email, 'message', 20);
  const id = uuid(),
    now = timestamp();
  const inserted = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO meta_messages(id,conversation_id,client_request_id,actor_email,direction,body,status,created_at) VALUES(?,?,?,?,'OUTBOUND',?,'PENDING',?)",
  )
    .bind(
      id,
      conversation.id,
      input.clientRequestId,
      ctx.email,
      input.text,
      now,
    )
    .run();
  if (!inserted.meta.changes) {
    const winner = await c.env.DB.prepare(
      'SELECT id,body,actor_email,status FROM meta_messages WHERE conversation_id=? AND client_request_id=?',
    )
      .bind(conversation.id, input.clientRequestId)
      .first<{
        id: string;
        body: string;
        actor_email: string;
        status: string;
      }>();
    if (
      !winner ||
      winner.body !== input.text ||
      winner.actor_email !== ctx.email
    )
      throw new HTTPException(409, { message: 'Message request conflict.' });
    return c.json({ id: winner.id, status: winner.status, replayed: true });
  }
  try {
    const result = await ctx.provider.write('message', {
      recipient: conversation.sender_id,
      text: input.text,
      clientRequestId: id,
    });
    const mid = string(result.message_id);
    if (!mid) throw new MetaAPIError(0, true, true);
    const echo = await c.env.DB.prepare(
      'SELECT id FROM meta_messages WHERE conversation_id=? AND provider_message_id=? AND id<>?',
    )
      .bind(conversation.id, mid, id)
      .first<{ id: string }>();
    await c.env.DB.batch([
      echo
        ? c.env.DB.prepare(
            "UPDATE meta_messages SET status='SUPERSEDED' WHERE id=?",
          ).bind(id)
        : c.env.DB.prepare(
            "UPDATE meta_messages SET status=CASE WHEN status IN ('READ','DELIVERED') THEN status ELSE 'SENT' END,provider_message_id=? WHERE id=?",
          ).bind(mid, id),
      c.env.DB.prepare(
        "UPDATE meta_conversations SET status='WAITING_CUSTOMER',last_message_at=MAX(last_message_at,?),updated_at=? WHERE id=?",
      ).bind(now, now, conversation.id),
      c.env.DB.prepare(
        `UPDATE meta_messages SET status=CASE
        WHEN status='READ' OR EXISTS(SELECT 1 FROM meta_receipt_watermarks r WHERE r.page_id=? AND r.sender_id=? AND r.read_at>=meta_messages.created_at) THEN 'READ'
        WHEN status='DELIVERED' OR EXISTS(SELECT 1 FROM meta_receipt_watermarks r WHERE r.page_id=? AND r.sender_id=? AND r.delivered_at>=meta_messages.created_at)
        OR EXISTS(SELECT 1 FROM meta_webhook_events e,json_each(e.payload,'$.mids') mid WHERE e.page_id=? AND e.kind='DELIVERY' AND json_extract(e.payload,'$.senderId')=? AND mid.value=?) THEN 'DELIVERED'
        ELSE status END WHERE id=? AND status IN ('SENT','DELIVERED','READ')`,
      ).bind(
        conversation.page_id,
        conversation.sender_id,
        conversation.page_id,
        conversation.sender_id,
        conversation.page_id,
        conversation.sender_id,
        mid,
        echo?.id ?? id,
      ),
      operationAudit(c.env, ctx.mode, ctx.email, 'MESSAGE_SEND', id),
    ]);
    return c.json({ id, status: 'SENT', mode: ctx.mode }, 201);
  } catch (error) {
    const unknown = !(error instanceof MetaAPIError) || error.ambiguous;
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE meta_messages SET status=? WHERE id=? AND status='PENDING'",
      ).bind(unknown ? 'UNKNOWN' : 'FAILED', id),
      operationAudit(
        c.env,
        ctx.mode,
        ctx.email,
        'MESSAGE_SEND',
        id,
        unknown ? 'UNKNOWN' : 'FAILED',
      ),
    ]);
    throw new HTTPException(502, {
      message: unknown
        ? 'Message outcome is unknown. Check Facebook before sending again.'
        : 'Message could not be sent. Check connection and permissions.',
    });
  }
});
// Deterministic IDs and one D1 transaction make retries safe after a lost response.
metaInboxRoutes.post('/conversations/:id/customer/new', async (c) => {
  const ctx = await metaContext(c, 'readMessenger');
  const conversation = await findConversation(c.env, ctx, c.req.param('id'));
  const input = z
    .object({
      name: z.string().trim().min(1).max(200),
      phone: z.string().trim().max(100).default(''),
    })
    .strict()
    .parse(await c.req.json());
  if (ctx.mode !== 'LIVE')
    throw new HTTPException(409, {
      message: 'Customer creation is available in live mode only.',
    });
  const linked = await c.env.DB.prepare(
    'SELECT customer_id FROM meta_customer_identities WHERE page_id=? AND provider_user_id=?',
  )
    .bind(ctx.pageId, conversation.sender_id)
    .first<{ customer_id: string }>();
  if (conversation.customer_id || linked)
    return c.json({
      id: conversation.customer_id || linked!.customer_id,
      replayed: true,
    });
  const id = await digest(
    'meta-customer:' + ctx.pageId + ':' + conversation.sender_id,
  );
  const now = timestamp();
  const guard = uuid();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO meta_atomic_guards(id,valid) VALUES(?,NOT EXISTS(SELECT 1 FROM meta_customer_identities WHERE page_id=? AND provider_user_id=? AND customer_id<>?))',
      ).bind(guard, ctx.pageId, conversation.sender_id, id),
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO customers(id,name,company_name,contact_name,phone,line_id,email,billing_address,budget,interested_in,notes,created_at,updated_at) VALUES(?,?,'',?,?,'','','',0,'','',?,?)",
      ).bind(id, input.name, input.name, input.phone, now, now),
      c.env.DB.prepare(
        'INSERT OR IGNORE INTO meta_customer_identities(id,page_id,provider_user_id,customer_id,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      ).bind(uuid(), ctx.pageId, conversation.sender_id, id, now, now),
      c.env.DB.prepare(
        'UPDATE meta_conversations SET customer_id=?,updated_at=? WHERE id=?',
      ).bind(id, now, conversation.id),
      c.env.DB.prepare(
        "INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) VALUES(?,'customer',?,'created','Created from Facebook Messenger',?,?)",
      ).bind(uuid(), id, ctx.email, now),
      c.env.DB.prepare('DELETE FROM meta_atomic_guards WHERE id=?').bind(guard),
      operationAudit(
        c.env,
        ctx.mode,
        ctx.email,
        'CUSTOMER_LINKED',
        conversation.id,
      ),
    ]);
  } catch (error) {
    const winner = await c.env.DB.prepare(
      'SELECT customer_id FROM meta_customer_identities WHERE page_id=? AND provider_user_id=?',
    )
      .bind(ctx.pageId, conversation.sender_id)
      .first<{ customer_id: string }>();
    if (winner) return c.json({ id: winner.customer_id, replayed: true });
    throw error;
  }
  return c.json({ id }, 201);
});
metaInboxRoutes.post('/conversations/:id/customer', async (c) => {
  const ctx = await metaContext(c, 'readMessenger'),
    conversation = await findConversation(c.env, ctx, c.req.param('id'));
  if (ctx.mode === 'DEMO')
    return c.json({
      mode: 'DEMO',
      simulated: true,
      customer: { id: 'demo:customer', name: 'Demo customer' },
    });
  const input = z
    .object({ customerId: z.string().min(1).max(100) })
    .strict()
    .parse(await c.req.json());
  if (
    !(await c.env.DB.prepare('SELECT id FROM customers WHERE id=?')
      .bind(input.customerId)
      .first())
  )
    throw new HTTPException(404, { message: 'Customer not found.' });
  const existing = await c.env.DB.prepare(
    'SELECT customer_id FROM meta_customer_identities WHERE page_id=? AND provider_user_id=?',
  )
    .bind(ctx.pageId, conversation.sender_id)
    .first<{ customer_id: string }>();
  if (existing && existing.customer_id !== input.customerId)
    throw new HTTPException(409, {
      message: 'This Page identity is already linked to another customer.',
    });
  const guard = uuid(),
    now = timestamp();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO meta_atomic_guards(id,valid) VALUES(?,NOT EXISTS(SELECT 1 FROM meta_customer_identities WHERE page_id=? AND provider_user_id=? AND customer_id<>?))',
    ).bind(guard, ctx.pageId, conversation.sender_id, input.customerId),
    c.env.DB.prepare(
      'INSERT OR IGNORE INTO meta_customer_identities(id,page_id,provider_user_id,customer_id,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    ).bind(
      uuid(),
      ctx.pageId,
      conversation.sender_id,
      input.customerId,
      now,
      now,
    ),
    c.env.DB.prepare(
      'UPDATE meta_conversations SET customer_id=?,updated_at=? WHERE id=?',
    ).bind(input.customerId, now, conversation.id),
    c.env.DB.prepare('DELETE FROM meta_atomic_guards WHERE id=?').bind(guard),
    operationAudit(
      c.env,
      ctx.mode,
      ctx.email,
      'CUSTOMER_LINKED',
      conversation.id,
    ),
  ]);
  return c.json({ linked: true });
});
metaInboxRoutes.post('/conversations/:id/lead', async (c) => {
  const ctx = await metaContext(c, 'readMessenger'),
    conversation = await findConversation(c.env, ctx, c.req.param('id'));
  const input = leadConversionInput.parse(await c.req.json());
  if (
    input.assignedTo &&
    !(await workspaceSalesEmails(c.env)).includes(input.assignedTo)
  )
    throw new HTTPException(422, { message: 'Choose an active salesperson.' });
  const id =
      ctx.mode === 'DEMO'
        ? 'demo:lead:' + conversation.id
        : await digest('meta-lead:' + conversation.id),
    now = timestamp();
  if (ctx.mode === 'DEMO') {
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO meta_demo_entities(id,kind,data,created_at) VALUES(?,'LEAD',?,?)",
    )
      .bind(
        id,
        JSON.stringify({
          ...input,
          source: 'FACEBOOK_MESSENGER',
          simulated: true,
        }),
        now,
      )
      .run();
    return c.json({ id, mode: 'DEMO', simulated: true }, 201);
  }
  const previous = await c.env.DB.prepare(
    'SELECT lead_id FROM meta_lead_links WHERE conversation_id=?',
  )
    .bind(conversation.id)
    .first<{ lead_id: string }>();
  if (previous) return c.json({ id: previous.lead_id, replayed: true });
  if (
    !conversation.customer_id ||
    conversation.customer_id !== input.customerId
  )
    throw new HTTPException(409, {
      message: 'Link this conversation to the selected CRM customer first.',
    });
  for (const productId of new Set(input.productIds))
    if (
      !(await c.env.DB.prepare(
        'SELECT id FROM products WHERE id=? AND archived_at IS NULL',
      )
        .bind(productId)
        .first())
    )
      throw new HTTPException(422, {
        message: 'An interested product is unavailable.',
      });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO leads(id,customer_id,title,status,assigned_to,estimated_value,last_contact_at,next_follow_up_at,viewing_at,notes,created_at,updated_at) VALUES(?,?,?,'NEW',?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        input.customerId,
        input.title,
        input.assignedTo,
        input.estimatedValue,
        conversation.last_incoming_at,
        input.nextFollowUpAt ?? input.viewingAt,
        input.viewingAt,
        input.notes,
        now,
        now,
      ),
      ...[...new Set(input.productIds)].map((productId) =>
        c.env.DB.prepare(
          'INSERT INTO lead_products(lead_id,product_id) VALUES(?,?)',
        ).bind(id, productId),
      ),
      c.env.DB.prepare(
        "INSERT INTO meta_lead_links(conversation_id,lead_id,source,created_at) VALUES(?,?,'FACEBOOK_MESSENGER',?)",
      ).bind(conversation.id, id, now),
      c.env.DB.prepare(
        "INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) VALUES(?,'lead',?,'created','Created from Facebook Messenger',?,?)",
      ).bind(uuid(), id, ctx.email, now),
      operationAudit(c.env, 'LIVE', ctx.email, 'LEAD_CREATED', id),
    ]);
  } catch (error) {
    const winner = await c.env.DB.prepare(
      'SELECT lead_id FROM meta_lead_links WHERE conversation_id=?',
    )
      .bind(conversation.id)
      .first<{ lead_id: string }>();
    if (winner) return c.json({ id: winner.lead_id, replayed: true });
    throw error;
  }
  return c.json({ id, mode: 'LIVE' }, 201);
});
