import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { PublicBindings } from './public-catalog';

type ChatEnv = { Bindings: PublicBindings };
type CatalogRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  show_sold: number;
  expires_at: string | null;
  assigned_salesperson_email: string;
};
type ChatRow = {
  id: string;
  token_hash: string;
  catalog_slug: string;
  catalog_title: string;
  assigned_email: string;
  status: string;
};
const api = new Hono<ChatEnv>();
const encoder = new TextEncoder();
const startInput = z
  .object({
    body: z.string().trim().min(1).max(2000),
    visitorName: z.string().trim().min(1).max(80),
    visitorPhone: z
      .string()
      .trim()
      .min(6)
      .max(32)
      .regex(/^[+0-9()\-\s.]+$/)
      .refine((value) => {
        const digits = value.replace(/\D/g, '').length;
        return digits >= 7 && digits <= 15;
      }),
    catalogSlug: z.string().trim().min(1).max(100),
    itemIds: z.array(z.string().uuid()).max(3).default([]),
    website: z.string().max(200).default(''),
  })
  .strict();
const messageInput = z
  .object({
    body: z.string().trim().min(1).max(2000),
    itemIds: z.array(z.string().uuid()).max(3).default([]),
    website: z.string().max(200).default(''),
  })
  .strict();

async function digest(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(hash)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}

async function constantTimeTextEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return timingSafeEqual(leftHash, rightHash);
}

async function jsonBody(request: Request) {
  const text = await request.text();
  if (encoder.encode(text).byteLength > 16_384) return { tooLarge: true };
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return { value: null };
  }
}

async function activeCatalog(database: D1Database, slug: string) {
  const catalog = await database
    .prepare(
      'SELECT id,slug,title,status,show_sold,expires_at,assigned_salesperson_email FROM catalogs WHERE slug=?',
    )
    .bind(slug)
    .first<CatalogRow>();
  return catalog &&
    catalog.status === 'ACTIVE' &&
    (!catalog.expires_at || Date.parse(catalog.expires_at) >= Date.now())
    ? catalog
    : null;
}

async function rateAllowed(
  env: PublicBindings,
  request: Request,
  scope: 'thread' | 'message',
  limit: number,
  windowMs: number,
) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const salt =
    env.CATALOG_CHAT_INTERNAL_SECRET ||
    env.PUBLIC_CATALOG_BASE_URL ||
    'catalog-chat';
  const visitorHash = await digest(`${salt}:${ip}`);
  const windowStart = new Date(
    Math.floor(Date.now() / windowMs) * windowMs,
  ).toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO catalog_chat_rate_limits(visitor_hash,scope,window_start,request_count)
     VALUES(?,?,?,1) ON CONFLICT(visitor_hash,scope,window_start)
     DO UPDATE SET request_count=request_count+1 WHERE request_count<?`,
  )
    .bind(visitorHash, scope, windowStart, limit)
    .run();
  return result.meta.changes > 0;
}

async function attachedProducts(
  database: D1Database,
  catalog: CatalogRow,
  itemIds: string[],
) {
  const ids = [...new Set(itemIds)];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await database
    .prepare(
      `SELECT i.id AS itemId,i.brand_snapshot AS brand,i.model_snapshot AS model
       FROM catalog_items i JOIN products p ON p.id=i.product_id
       WHERE i.catalog_id=? AND i.id IN (${placeholders}) AND p.archived_at IS NULL
         AND (?=1 OR p.status!='SOLD')`,
    )
    .bind(catalog.id, ...ids, catalog.show_sold)
    .all<{ itemId: string; brand: string; model: string }>();
  if (results.length !== ids.length) return null;
  const byId = new Map(results.map((item) => [item.itemId, item]));
  return ids.map((id) => {
    const item = byId.get(id)!;
    return {
      itemId: id,
      label: `${item.brand} ${item.model}`.trim().slice(0, 180),
    };
  });
}

async function saveMessage(
  database: D1Database,
  chatId: string,
  sender: 'VISITOR' | 'SALESPERSON',
  senderEmail: string,
  body: string,
  products: { itemId: string; label: string }[],
) {
  const createdAt = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        'INSERT INTO catalog_chat_messages(chat_id,sender_type,sender_email,body,products,created_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        chatId,
        sender,
        senderEmail,
        body,
        JSON.stringify(products),
        createdAt,
      ),
    database
      .prepare(
        'UPDATE catalog_chats SET updated_at=?,last_message_at=? WHERE id=?',
      )
      .bind(createdAt, createdAt, chatId),
  ]);
}

async function ownedThread(c: Context<ChatEnv>, id: string) {
  const token = c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || token.length > 200) return null;
  const thread = await c.env.DB.prepare(
    'SELECT id,token_hash,catalog_slug,catalog_title,assigned_email,status FROM catalog_chats WHERE id=?',
  )
    .bind(id)
    .first<ChatRow>();
  if (
    !thread ||
    !(await constantTimeTextEqual(await digest(token), thread.token_hash))
  )
    return null;
  return thread;
}

function notifyManager(
  env: PublicBindings,
  schedule: (promise: Promise<unknown>) => void,
  payload: { threadId: string; body: string; products: string[] },
) {
  if (!env.MANAGEMENT || !env.CATALOG_CHAT_INTERNAL_SECRET) return;
  const task = env.MANAGEMENT.fetch(
    'https://management.internal/internal/catalog-chat-notify',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-catalog-chat-secret': env.CATALOG_CHAT_INTERNAL_SECRET,
      },
      body: JSON.stringify(payload),
    },
  );
  schedule(task.then(() => undefined).catch(() => undefined));
}

api.get('/api/public/chat/products', async (c) => {
  const catalog = await activeCatalog(
    c.env.DB,
    c.req.query('catalog')?.trim() ?? '',
  );
  if (!catalog) return c.json({ error: 'Catalog not found.' }, 404);
  const query = (c.req.query('q') ?? '').trim().slice(0, 80);
  const { results } = await c.env.DB.prepare(
    `SELECT i.id AS itemId,i.brand_snapshot AS brand,i.model_snapshot AS model,
      i.category_snapshot AS category FROM catalog_items i JOIN products p ON p.id=i.product_id
     WHERE i.catalog_id=? AND p.archived_at IS NULL AND (?=1 OR p.status!='SOLD')
       AND (?='' OR i.brand_snapshot LIKE ? OR i.model_snapshot LIKE ? OR i.category_snapshot LIKE ?)
     ORDER BY i.sort_order LIMIT 60`,
  )
    .bind(
      catalog.id,
      catalog.show_sold,
      query,
      `%${query}%`,
      `%${query}%`,
      `%${query}%`,
    )
    .all<{ itemId: string; brand: string; model: string; category: string }>();
  return c.json(
    {
      products: results.map((item) => ({
        itemId: item.itemId,
        label: `${item.brand} ${item.model}`.trim(),
        category: item.category,
      })),
    },
    200,
    { 'Cache-Control': 'public, max-age=15, s-maxage=30' },
  );
});

api.post('/api/public/chat', async (c) => {
  const parsedBody = await jsonBody(c.req.raw);
  if ('tooLarge' in parsedBody)
    return c.json({ error: 'Message is too large.' }, 413);
  const parsed = startInput.safeParse(parsedBody.value);
  if (!parsed.success)
    return c.json(
      { error: 'Enter your name, a valid phone number, and a message.' },
      400,
    );
  const input = parsed.data;
  if (input.website) return c.json({ error: 'Message rejected.' }, 400);
  if (!(await rateAllowed(c.env, c.req.raw, 'thread', 4, 10 * 60_000)))
    return c.json(
      { error: 'Please wait before starting another conversation.' },
      429,
    );
  const catalog = await activeCatalog(c.env.DB, input.catalogSlug);
  if (!catalog)
    return c.json({ error: 'Catalog is no longer available.' }, 404);
  const products = await attachedProducts(c.env.DB, catalog, input.itemIds);
  if (!products)
    return c.json(
      { error: 'One or more selected products are unavailable.' },
      422,
    );
  const id = crypto.randomUUID();
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO catalog_chats(id,token_hash,catalog_slug,catalog_title,assigned_email,visitor_name,visitor_phone,status,created_at,updated_at,last_message_at)
       VALUES(?,?,?,?,?,?,?,'OPEN',?,?,?)`,
    ).bind(
      id,
      await digest(token),
      catalog.slug,
      catalog.title,
      catalog.assigned_salesperson_email,
      input.visitorName,
      input.visitorPhone,
      now,
      now,
      now,
    ),
    c.env.DB.prepare(
      "INSERT INTO catalog_chat_messages(chat_id,sender_type,sender_email,body,products,created_at) VALUES(?,'VISITOR','',?,?,?)",
    ).bind(id, input.body, JSON.stringify(products), now),
  ]);
  notifyManager(c.env, (promise) => c.executionCtx.waitUntil(promise), {
    threadId: id,
    body: input.body,
    products: products.map((product) => product.label),
  });
  return c.json({ session: { id, token }, ok: true }, 201, {
    'Cache-Control': 'no-store',
  });
});

api.get('/api/public/chat/:id', async (c) => {
  const thread = await ownedThread(c, c.req.param('id'));
  if (!thread) return c.json({ error: 'Conversation not found.' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT id,sender_type AS senderType,body,products,created_at AS createdAt
     FROM catalog_chat_messages WHERE chat_id=? ORDER BY id ASC LIMIT 200`,
  )
    .bind(thread.id)
    .all<{ products: string } & Record<string, unknown>>();
  return c.json(
    {
      status: thread.status,
      messages: results.map(({ products, ...message }) => ({
        ...message,
        products: JSON.parse(products || '[]'),
      })),
    },
    200,
    { 'Cache-Control': 'no-store' },
  );
});

api.post('/api/public/chat/:id/messages', async (c) => {
  const parsedBody = await jsonBody(c.req.raw);
  if ('tooLarge' in parsedBody)
    return c.json({ error: 'Message is too large.' }, 413);
  const thread = await ownedThread(c, c.req.param('id'));
  if (!thread) return c.json({ error: 'Conversation not found.' }, 404);
  if (thread.status !== 'OPEN')
    return c.json({ error: 'This conversation is closed.' }, 409);
  const parsed = messageInput.safeParse(parsedBody.value);
  if (!parsed.success)
    return c.json({ error: 'Enter a message up to 2,000 characters.' }, 400);
  if (parsed.data.website) return c.json({ error: 'Message rejected.' }, 400);
  if (!(await rateAllowed(c.env, c.req.raw, 'message', 20, 60_000)))
    return c.json(
      { error: 'Please wait before sending another message.' },
      429,
    );
  const catalog = await activeCatalog(c.env.DB, thread.catalog_slug);
  if (!catalog)
    return c.json({ error: 'Catalog is no longer available.' }, 404);
  const products = await attachedProducts(
    c.env.DB,
    catalog,
    parsed.data.itemIds,
  );
  if (!products)
    return c.json(
      { error: 'One or more selected products are unavailable.' },
      422,
    );
  await saveMessage(
    c.env.DB,
    thread.id,
    'VISITOR',
    '',
    parsed.data.body,
    products,
  );
  notifyManager(c.env, (promise) => c.executionCtx.waitUntil(promise), {
    threadId: thread.id,
    body: parsed.data.body,
    products: products.map((product) => product.label),
  });
  return c.json({ ok: true }, 201, { 'Cache-Control': 'no-store' });
});

export { api as catalogChatApi };
