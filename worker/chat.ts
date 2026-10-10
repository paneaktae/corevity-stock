import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv, Bindings } from './auth';
import {
  chatInput,
  type ChatMessage,
  type ChatProduct,
} from '../shared/schemas';

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
  })
  .refine((v) => v.after === undefined || v.before === undefined);
type MessageRow = Omit<ChatMessage, 'products'>;
const columns = `m.id,m.sender_email AS senderEmail,COALESCE(NULLIF(trim(s.first_name || ' ' || s.last_name),''),m.sender_email) AS senderName,m.body,m.created_at AS createdAt`;
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
  return rows.map((r) => ({
    ...r,
    products: attachments.results
      .filter((p) => p.messageId === r.id)
      .map(({ messageId: _messageId, ...p }) => p),
  }));
}
export const chatRoutes = new Hono<AppEnv>();
chatRoutes.get('/', async (c) => {
  const { after, before } = pageInput.parse(c.req.query());
  const condition =
    after !== undefined
      ? 'WHERE m.id>?'
      : before !== undefined
        ? 'WHERE m.id<?'
        : '';
  const query = c.env.DB.prepare(
    `SELECT ${columns} FROM chat_messages m LEFT JOIN salespeople s ON s.email=m.sender_email ${condition} ORDER BY m.id ${after !== undefined ? 'ASC' : 'DESC'} LIMIT 51`,
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
    messages: await attachProducts(c.env, rows),
    hasMore: page.results.length > 50,
    userEmail: c.get('email'),
  });
});
chatRoutes.post('/', async (c) => {
  const data = chatInput.parse(await c.req.json());
  const email = c.get('email');
  const productIds = JSON.stringify(data.productIds);
  const existing = await c.env.DB.prepare(
    'SELECT body,product_ids FROM chat_messages WHERE sender_email=? AND request_id=?',
  )
    .bind(email, data.requestId)
    .first<{ body: string; product_ids: string }>();
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
    'INSERT INTO chat_messages(request_id,sender_email,body,product_ids,created_at) VALUES(?,?,?,?,?) ON CONFLICT(sender_email,request_id) DO NOTHING',
  )
    .bind(
      data.requestId,
      email,
      data.body,
      productIds,
      new Date().toISOString(),
    )
    .run();
  const row = await c.env.DB.prepare(
    `SELECT ${columns},m.product_ids AS productIds FROM chat_messages m LEFT JOIN salespeople s ON s.email=m.sender_email WHERE m.sender_email=? AND m.request_id=?`,
  )
    .bind(email, data.requestId)
    .first<MessageRow & { productIds: string }>();
  if (!row)
    throw new HTTPException(500, {
      message: 'The request could not be completed. Please retry.',
    });
  if (row.body !== data.body || row.productIds !== productIds)
    throw new HTTPException(409, {
      message:
        'This message was already sent with different content. Refresh the chat.',
    });
  const { productIds: _productIds, ...message } = row;
  return c.json(
    (await attachProducts(c.env, [message]))[0],
    existing ? 200 : 201,
  );
});
