import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv, Bindings } from './auth';
import {
  chatInput,
  inventoryAssistantInput,
  type ChatReaction,
  type ChatMessage,
  type ChatProduct,
} from '../shared/schemas';
import {
  answerInventoryQuestion,
  createInventorySearchPlan,
} from './services/inventory-assistant';
import {
  lineConfigured,
  processChatMentionNotifications,
  workspaceSalesEmails,
} from './services/line';

const pageInput = z
  .object({
    after: z.coerce
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    before: z.coerce
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    around: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .refine((v) => [v.after, v.before, v.around].filter((value) => value !== undefined).length <= 1);
type MessageRow = Omit<ChatMessage, 'products' | 'mentions'> & { mentionsJson: string };
const columns = `m.id,m.sender_email AS senderEmail,COALESCE(NULLIF(trim(s.first_name || ' ' || s.last_name),''),m.sender_email) AS senderName,m.body,m.mentions AS mentionsJson,m.created_at AS createdAt`;
const messageColumns = `${columns},(SELECT COUNT(*) FROM chat_read_cursors r WHERE r.last_read_message_id>=m.id AND lower(r.email)<>lower(m.sender_email)) AS readCount`;
const chatReadInput = z.object({ messageId: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();
const chatReactionEmoji = ['👍', '❤️', '😂', '😮', '🙏', '🎉'] as const;
const chatReactionInput = z.object({ emoji: z.enum(chatReactionEmoji) }).strict();
async function currentReadCursors(db: D1Database) {
  const result = await db
    .prepare('SELECT lower(email) AS email,last_read_message_id AS lastReadMessageId FROM chat_read_cursors')
    .all<{ email: string; lastReadMessageId: number }>();
  return result.results;
}
function parseMentions(value: string): ChatMessage['mentions'] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((mention): mention is { email: string; token: string } =>
      !!mention && typeof mention === 'object' &&
      typeof (mention as { email?: unknown }).email === 'string' &&
      typeof (mention as { token?: unknown }).token === 'string',
    );
  } catch {
    return [];
  }
}
async function attachProducts(
  env: Bindings,
  rows: MessageRow[],
): Promise<ChatMessage[]> {
  if (!rows.length) return [];
  const attachments = await env.DB.prepare(
    `SELECT m.id AS messageId,p.id,p.sku,p.brand,p.model,p.status,p.selling_price AS sellingPrice,p.archived_at AS archivedAt,
    (SELECT id FROM product_images WHERE product_id=p.id ORDER BY is_primary DESC,sort_order LIMIT 1) AS primaryImageId
    FROM chat_messages m JOIN json_each(m.product_ids) j JOIN products p ON p.id=j.value
    WHERE m.id IN (${rows.map(() => '?').join(',')}) ORDER BY m.id,j.key`,
  )
    .bind(...rows.map((r) => r.id))
    .all<ChatProduct & { messageId: number }>();
  return rows.map((r) => {
    const { mentionsJson, ...message } = r;
    return {
    ...message,
    mentions: parseMentions(mentionsJson),
    reactions: [],
    products: attachments.results
      .filter((p) => p.messageId === r.id)
      .map(({ messageId: _messageId, ...p }) => p),
    };
  });
}
async function loadReactions(
  env: Bindings,
  messageIds: number[],
  email: string,
): Promise<Map<number, ChatReaction[]>> {
  if (!messageIds.length) return new Map();
  const result = await env.DB.prepare(
    `SELECT message_id AS messageId,emoji,COUNT(*) AS count,
      MAX(CASE WHEN lower(email)=lower(?) THEN 1 ELSE 0 END) AS reactedByMe
     FROM chat_reactions WHERE message_id IN (${messageIds.map(() => '?').join(',')})
     GROUP BY message_id,emoji`,
  )
    .bind(email, ...messageIds)
    .all<{ messageId: number; emoji: string; count: number; reactedByMe: number }>();
  const byMessage = new Map<number, ChatReaction[]>();
  for (const row of result.results) {
    const reactions = byMessage.get(row.messageId) ?? [];
    reactions.push({ emoji: row.emoji, count: row.count, reactedByMe: row.reactedByMe === 1 });
    byMessage.set(row.messageId, reactions);
  }
  return byMessage;
}
async function attachReactions(
  env: Bindings,
  messages: ChatMessage[],
  email: string,
): Promise<ChatMessage[]> {
  const reactions = await loadReactions(env, messages.map((message) => message.id), email);
  return messages.map((message) => ({
    ...message,
    reactions: reactions.get(message.id) ?? [],
  }));
}
export const chatRoutes = new Hono<AppEnv>();
type AssistantMessageRow = {
  id: number;
  role: 'user' | 'assistant';
  body: string;
  createdAt: string;
  productIds: string;
};
async function attachAssistantProducts(
  env: Bindings,
  userEmail: string,
  rows: AssistantMessageRow[],
) {
  if (!rows.length) return [];
  const attachments = await env.DB.prepare(
    `SELECT m.id AS messageId,p.id,p.sku,p.brand,p.model,p.status,p.selling_price AS sellingPrice,p.archived_at AS archivedAt,
    (SELECT id FROM product_images WHERE product_id=p.id ORDER BY is_primary DESC,sort_order LIMIT 1) AS primaryImageId
    FROM assistant_messages m JOIN json_each(m.product_ids) j JOIN products p ON p.id=j.value
    WHERE m.user_email=? AND m.id IN (${rows.map(() => '?').join(',')}) ORDER BY m.id,j.key`,
  )
    .bind(userEmail, ...rows.map((row) => row.id))
    .all<ChatProduct & { messageId: number }>();
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    body: row.body,
    createdAt: row.createdAt,
    products: attachments.results
      .filter((product) => product.messageId === row.id)
      .map(({ messageId: _messageId, ...product }) => product),
  }));
}
chatRoutes.get('/assistant', async (c) => {
  const email = c.get('email');
  const result = await c.env.DB.prepare(
    'SELECT id,role,body,created_at AS createdAt,product_ids AS productIds FROM assistant_messages WHERE user_email=? ORDER BY id DESC LIMIT 100',
  )
    .bind(email)
    .all<AssistantMessageRow>();
  const rows = result.results.reverse();
  const messages = await attachAssistantProducts(c.env, email, rows);
  return c.json({ messages });
});
chatRoutes.post('/assistant', async (c) => {
  const input = inventoryAssistantInput.parse(await c.req.json());
  const email = c.get('email');
  const previous = await c.env.DB.prepare(
    `SELECT role,substr(body,1,300) AS content FROM (SELECT role,body,id FROM assistant_messages WHERE user_email=? ORDER BY id DESC LIMIT 4) ORDER BY id ASC`,
  )
    .bind(email)
    .all<{ role: 'user' | 'assistant'; content: string }>();
  const privateHistory = previous.results.map(({ role, content }) => ({
    role,
    content,
  }));
  let plan: Awaited<ReturnType<typeof createInventorySearchPlan>>;
  try {
    plan = await createInventorySearchPlan(input.message, privateHistory, c.env);
  } catch (error) {
    const notConfigured =
      error instanceof Error && error.message === 'AI_NOT_CONFIGURED';
    throw new HTTPException(notConfigured ? 503 : 502, {
      message: notConfigured
        ? 'Configure AI_API_KEY, AI_MODEL and AI_BASE_URL on the Worker.'
        : 'AI could not answer this inventory search. Please retry.',
    });
  }
  const clauses = ['archived_at IS NULL'];
  const bindings: (string | number)[] = [];
  if (plan.brand) {
    clauses.push('brand LIKE ?');
    bindings.push(`%${plan.brand}%`);
  }
  if (plan.model) {
    clauses.push('model LIKE ?');
    bindings.push(`%${plan.model}%`);
  }
  if (plan.category) {
    clauses.push('category LIKE ?');
    bindings.push(`%${plan.category}%`);
  }
  if (plan.minPrice !== null) {
    clauses.push('selling_price>=?');
    bindings.push(plan.minPrice);
  }
  if (plan.maxPrice !== null) {
    clauses.push('selling_price<=?');
    bindings.push(plan.maxPrice);
  }
  if (plan.statuses.length) {
    clauses.push(`status IN (${plan.statuses.map(() => '?').join(',')})`);
    bindings.push(...plan.statuses);
  } else {
    clauses.push("status!='SOLD'");
  }
  const terms = plan.terms
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (terms.length) {
    clauses.push(
      `(${terms
        .flatMap(() =>
          [
            'sku',
            'brand',
            'model',
            'category',
            'description_th',
            'description_en',
            'short_description',
          ].map((column) => `${column} LIKE ?`),
        )
        .join(' OR ')})`,
    );
    for (const term of terms)
      for (let i = 0; i < 7; i++) bindings.push(`%${term}%`);
  }
  const inventory = await c.env.DB.prepare(
    `SELECT id,sku,brand,model,status,selling_price AS sellingPrice,
    (SELECT id FROM product_images WHERE product_id=products.id ORDER BY is_primary DESC,sort_order LIMIT 1) AS primaryImageId,
    archived_at AS archivedAt,category,condition,substr(description_th,1,240) AS descriptionTh,
    substr(description_en,1,240) AS descriptionEn
    FROM products WHERE ${clauses.join(' AND ')}
    ORDER BY CASE status WHEN 'AVAILABLE' THEN 0 WHEN 'RESERVED' THEN 1 WHEN 'NOT_AVAILABLE' THEN 2 ELSE 3 END,
    selling_price ASC LIMIT 20`,
  )
    .bind(...bindings)
    .all<
      ChatProduct & {
        category: string;
        condition: string;
        descriptionTh: string;
        descriptionEn: string;
      }
    >();
  try {
    const answer = await answerInventoryQuestion(
      { ...input, history: privateHistory },
      plan,
      inventory.results,
      c.env,
    );
    const createdAt = new Date().toISOString();
    const userTurn = c.env.DB.prepare(
      "INSERT INTO assistant_messages(user_email,role,body,product_ids,created_at) VALUES(?,'user',?,'[]',?)",
    ).bind(email, input.message, createdAt);
    const assistantTurn = c.env.DB.prepare(
      "INSERT INTO assistant_messages(user_email,role,body,product_ids,created_at) VALUES(?,'assistant',?,?,?)",
    ).bind(
      email,
      answer.reply,
      JSON.stringify(answer.products.map((product) => product.id)),
      createdAt,
    );
    await c.env.DB.batch([userTurn, assistantTurn]);
    const saved = await c.env.DB.prepare(
      'SELECT id,role,body,created_at AS createdAt,product_ids AS productIds FROM assistant_messages WHERE user_email=? ORDER BY id DESC LIMIT 2',
    )
      .bind(email)
      .all<AssistantMessageRow>();
    return c.json({
      messages: await attachAssistantProducts(
        c.env,
        email,
        saved.results.reverse(),
      ),
    });
  } catch (error) {
    const notConfigured =
      error instanceof Error && error.message === 'AI_NOT_CONFIGURED';
    throw new HTTPException(notConfigured ? 503 : 502, {
      message: notConfigured
        ? 'Configure AI_API_KEY, AI_MODEL and AI_BASE_URL on the Worker.'
        : 'AI could not answer this inventory search. Please retry.',
    });
  }
});
chatRoutes.get('/socket', async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket')
    return c.body('Expected WebSocket upgrade', 426);
  const email = c.get('email');
  const salesperson = await c.env.DB.prepare(
    'SELECT first_name AS firstName,last_name AS lastName FROM salespeople WHERE email=?',
  )
    .bind(email)
    .first<{ firstName: string; lastName: string }>();
  const displayName =
    [salesperson?.firstName, salesperson?.lastName]
      .filter((part) => part?.trim())
      .join(' ') || email;
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Chat-User-Email', email);
  headers.set('X-Chat-User-Name', displayName);
  return c.env.CHAT_ROOM.getByName('corevity-team', {
    locationHint: 'apac',
  }).fetch(new Request(c.req.raw, { headers }));
});
chatRoutes.get('/', async (c) => {
  const { after, before, around } = pageInput.parse(c.req.query());
  if (around !== undefined) {
    const [preceding, following] = await Promise.all([
      c.env.DB.prepare(
        `SELECT ${messageColumns} FROM chat_messages m LEFT JOIN salespeople s ON s.email=m.sender_email WHERE m.id<=? ORDER BY m.id DESC LIMIT 27`,
      ).bind(around).all<MessageRow>(),
      c.env.DB.prepare(
        `SELECT ${messageColumns} FROM chat_messages m LEFT JOIN salespeople s ON s.email=m.sender_email WHERE m.id>? ORDER BY m.id ASC LIMIT 24`,
      ).bind(around).all<MessageRow>(),
    ]);
    if (!preceding.results.some((message) => message.id === around))
      return c.json({ messages: [], hasMore: false, userEmail: c.get('email'), readCursors: await currentReadCursors(c.env.DB) });
    const messages = [
      ...preceding.results.slice(0, 26).reverse(),
      ...following.results,
    ];
    return c.json({
      messages: await attachReactions(c.env, await attachProducts(c.env, messages), c.get('email')),
      hasMore: preceding.results.length > 26,
      userEmail: c.get('email'),
      readCursors: await currentReadCursors(c.env.DB),
    });
  }
  const condition =
    after !== undefined
      ? 'WHERE m.id>?'
      : before !== undefined
        ? 'WHERE m.id<?'
        : '';
  const query = c.env.DB.prepare(
    `SELECT ${messageColumns} FROM chat_messages m LEFT JOIN salespeople s ON s.email=m.sender_email ${condition} ORDER BY m.id ${after !== undefined ? 'ASC' : 'DESC'} LIMIT 51`,
  );
  const page = await (
    after !== undefined
      ? query.bind(after)
      : before !== undefined
        ? query.bind(before)
        : query
  ).all<MessageRow>();
  const rows = page.results.slice(0, 50);
  if (after === undefined) rows.reverse();
  return c.json({
    messages: await attachReactions(c.env, await attachProducts(c.env, rows), c.get('email')),
    hasMore: page.results.length > 50,
    userEmail: c.get('email'),
    readCursors: await currentReadCursors(c.env.DB),
  });
});
chatRoutes.post('/read', async (c) => {
  const { messageId } = chatReadInput.parse(await c.req.json());
  const email = c.get('email').trim().toLowerCase();
  const message = await c.env.DB.prepare('SELECT id FROM chat_messages WHERE id=?')
    .bind(messageId)
    .first<{ id: number }>();
  if (!message) throw new HTTPException(404, { message: 'Chat message not found.' });
  const cursor = await c.env.DB.prepare(
    `INSERT INTO chat_read_cursors(email,last_read_message_id,updated_at) VALUES(?,?,?)
     ON CONFLICT(email) DO UPDATE SET last_read_message_id=excluded.last_read_message_id,updated_at=excluded.updated_at
     WHERE excluded.last_read_message_id>chat_read_cursors.last_read_message_id
     RETURNING last_read_message_id AS lastReadMessageId`,
  )
    .bind(email, messageId, new Date().toISOString())
    .first<{ lastReadMessageId: number }>();
  if (cursor) {
    c.executionCtx.waitUntil(
      c.env.CHAT_ROOM.getByName('corevity-team', { locationHint: 'apac' })
        .broadcastRead(email, cursor.lastReadMessageId)
        .catch((error: unknown) =>
          console.error(JSON.stringify({
            event: 'chat_read_broadcast_failed',
            messageId: cursor.lastReadMessageId,
            type: error instanceof Error ? error.name : 'UnknownError',
          })),
        ),
    );
  }
  return c.json({ lastReadMessageId: cursor?.lastReadMessageId ?? messageId });
});
chatRoutes.post('/:messageId/reactions', async (c) => {
  const messageId = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).parse(c.req.param('messageId'));
  const { emoji } = chatReactionInput.parse(await c.req.json());
  const email = c.get('email').trim().toLowerCase();
  const message = await c.env.DB.prepare('SELECT id FROM chat_messages WHERE id=?')
    .bind(messageId)
    .first<{ id: number }>();
  if (!message) throw new HTTPException(404, { message: 'Chat message not found.' });
  const existing = await c.env.DB.prepare(
    'SELECT 1 AS found FROM chat_reactions WHERE message_id=? AND email=? AND emoji=?',
  ).bind(messageId, email, emoji).first<{ found: number }>();
  if (existing) {
    await c.env.DB.prepare(
      'DELETE FROM chat_reactions WHERE message_id=? AND email=? AND emoji=?',
    ).bind(messageId, email, emoji).run();
  } else {
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO chat_reactions(message_id,email,emoji,created_at) VALUES(?,?,?,?)',
    ).bind(messageId, email, emoji, new Date().toISOString()).run();
  }
  const reactions = await loadReactions(c.env, [messageId], email);
  const updated = reactions.get(messageId) ?? [];
  c.executionCtx.waitUntil(
    c.env.CHAT_ROOM.getByName('corevity-team', { locationHint: 'apac' })
      .broadcastReaction(messageId, updated)
      .catch((error: unknown) => console.error(JSON.stringify({
        event: 'chat_reaction_broadcast_failed',
        messageId,
        type: error instanceof Error ? error.name : 'UnknownError',
      }))),
  );
  return c.json({ messageId, reactions: updated });
});
chatRoutes.post('/', async (c) => {
  const data = chatInput.parse(await c.req.json());
  const email = c.get('email');
  const productIds = JSON.stringify(data.productIds);
  const mentions = data.mentions.map((mention) => ({
    email: mention.email.trim().toLowerCase(),
    token: mention.token,
  }));
  const allowedMentions = new Set(await workspaceSalesEmails(c.env));
  if (mentions.some((mention) => !allowedMentions.has(mention.email) || !data.body.includes(mention.token)))
    throw new HTTPException(422, { message: 'Choose a team member from the mention list.' });
  const mentionsJson = JSON.stringify(mentions);
  const existing = await c.env.DB.prepare(
    'SELECT body,product_ids,mentions FROM chat_messages WHERE sender_email=? AND request_id=?',
  )
    .bind(email, data.requestId)
    .first<{ body: string; product_ids: string; mentions: string }>();
  if (!existing && data.productIds.length) {
    const products = await c.env.DB.prepare(
      `SELECT id FROM products WHERE archived_at IS NULL AND id IN (${data.productIds.map(() => '?').join(',')})`,
    )
      .bind(...data.productIds)
      .all();
    if (products.results.length !== data.productIds.length)
      throw new HTTPException(422, {
        message:
          'An attached item is no longer available. Remove it and try again.',
      });
  }
  await c.env.DB.prepare(
    'INSERT INTO chat_messages(request_id,sender_email,body,mentions,product_ids,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(sender_email,request_id) DO NOTHING',
  )
    .bind(
      data.requestId,
      email,
      data.body,
      mentionsJson,
      productIds,
      new Date().toISOString(),
    )
    .run();
  const row = await c.env.DB.prepare(
    `SELECT ${messageColumns},m.product_ids AS productIds FROM chat_messages m LEFT JOIN salespeople s ON s.email=m.sender_email WHERE m.sender_email=? AND m.request_id=?`,
  )
    .bind(email, data.requestId)
    .first<MessageRow & { productIds: string }>();
  if (!row)
    throw new HTTPException(500, {
      message: 'The request could not be completed. Please retry.',
    });
  if (row.body !== data.body || row.productIds !== productIds || row.mentionsJson !== mentionsJson)
    throw new HTTPException(409, {
      message:
        'This message was already sent with different content. Refresh the chat.',
    });
  const { productIds: _productIds, ...message } = row;
  const result = (await attachReactions(c.env, await attachProducts(c.env, [message]), email))[0];
  let hasNotificationJobs = false;
  if (lineConfigured(c.env) && c.env.APP_URL) {
    const mentionedEmails = [...new Set(mentions.map((mention) => mention.email))]
      .filter((mentionedEmail) => mentionedEmail !== email.toLowerCase());
    if (mentionedEmails.length) {
      const linked = await c.env.DB.prepare(
        `SELECT a.email,a.line_user_id AS lineUserId FROM line_accounts a WHERE a.enabled=1 AND a.email IN (${mentionedEmails.map(() => '?').join(',')})`,
      ).bind(...mentionedEmails).all<{ email: string; lineUserId: string }>();
      if (linked.results.length) {
        const now = new Date().toISOString();
        await c.env.DB.batch(linked.results.map((recipient) =>
          c.env.DB.prepare(
            `INSERT OR IGNORE INTO chat_mention_notifications(id,message_id,email,line_user_id,status,attempts,created_at,next_attempt_at)
             VALUES(?,?,?,?,'pending',0,?,?)`,
          ).bind(crypto.randomUUID(), result.id, recipient.email, recipient.lineUserId, now, now),
        ));
        hasNotificationJobs = true;
      }
    }
  }
  if (hasNotificationJobs) {
    c.executionCtx.waitUntil(
      processChatMentionNotifications(c.env).catch((error: unknown) =>
        console.error(JSON.stringify({
          event: 'chat_mention_delivery_failed',
          messageId: result.id,
          type: error instanceof Error ? error.name : 'UnknownError',
        })),
      ),
    );
  }
  c.executionCtx.waitUntil(
    c.env.CHAT_ROOM.getByName('corevity-team', { locationHint: 'apac' })
      .broadcast(result)
      .catch((error: unknown) =>
        console.error(
          JSON.stringify({
            event: 'chat_broadcast_failed',
            messageId: result.id,
            type: error instanceof Error ? error.name : 'UnknownError',
          }),
        ),
      ),
  );
  return c.json(result, existing ? 200 : 201);
});
