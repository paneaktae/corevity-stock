import { Hono, type Context as HonoContext } from "hono";
import { z } from "zod";
import type { AppEnv } from "./auth";
import { allowedSales, lineConfigured, lineRequest } from "./services/line";

export const catalogsRoutes = new Hono<AppEnv>();
const stamp = () => new Date().toISOString();
const randomToken = () => crypto.randomUUID().replaceAll("-", "").slice(0, 8);
const slugPart = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 54) || "equipment";
const productPublishInput = z
  .object({
    showPrice: z.boolean().default(false),
    publicDescriptionTh: z.string().trim().max(5000).default(""),
    publicDescriptionEn: z.string().trim().max(5000).default(""),
    publicSlug: z
      .string()
      .trim()
      .max(90)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
  })
  .strict();
const catalogInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(5000).default(""),
    customerId: z.string().nullable().default(null),
    showPrices: z.boolean().default(true),
    showSold: z.boolean().default(false),
    expiresAt: z.string().datetime().nullable().default(null),
    assignedSalespersonEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .email()
      .or(z.literal(""))
      .default(""),
    items: z
      .array(
        z
          .object({
            productId: z.string().min(1),
            displayPrice: z.number().finite().min(0).nullable().optional(),
            description: z.string().trim().max(3000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

type Context = HonoContext<AppEnv>;
const catalogChatMessageInput = z
  .object({ body: z.string().trim().min(1).max(2000) })
  .strict();
async function writeActivity(
  c: Context,
  entityType: string,
  entityId: string,
  action: string,
  description: string,
) {
  await c.env.DB.prepare(
    "INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      entityType,
      entityId,
      action,
      description,
      c.get("email"),
      stamp(),
    )
    .run();
}

type ProductSnapshot = {
  id: string;
  sku: string;
  brand: string;
  model: string;
  category: string;
  condition: string;
  selling_price: number;
  status: string;
  public_description_th: string;
  public_description_en: string;
  description_th: string;
  description_en: string;
  short_description: string;
  public_slug: string | null;
  is_published: number;
  archived_at: string | null;
  image_key: string | null;
  image_mime: string | null;
};
type ProductSnapshotItem = {
  id: string;
  productId: string;
  sortOrder: number;
  productName: string;
  brand: string;
  model: string;
  category: string;
  condition: string;
  description: string;
  imageKey: string;
  imageMime: string;
  displayPrice: number | null;
};
type ResolvedSnapshots = { snapshots: ProductSnapshotItem[] };
async function snapshotProducts(
  c: Context,
  items: z.infer<typeof catalogInput>["items"],
): Promise<ResolvedSnapshots | { error: string }> {
  const snapshots: ProductSnapshotItem[] = [];
  for (const [index, item] of items.entries()) {
    const product = await c.env.DB.prepare(
      `SELECT p.id,p.sku,p.brand,p.model,p.category,p.condition,p.selling_price,p.status,
        p.public_description_th,p.public_description_en,p.description_th,p.description_en,
        p.short_description,p.public_slug,p.is_published,p.archived_at,
        i.r2_key AS image_key,i.mime_type AS image_mime
       FROM products p
       LEFT JOIN product_images i ON i.id=(SELECT id FROM product_images WHERE product_id=p.id ORDER BY is_primary DESC,sort_order LIMIT 1)
       WHERE p.id=?`,
    )
      .bind(item.productId)
      .first<ProductSnapshot>();
    if (!product || product.archived_at)
      return { error: "A selected product is no longer available." as const };
    snapshots.push({
      id: crypto.randomUUID(),
      productId: product.id,
      sortOrder: index,
      productName: `${product.brand} ${product.model}`,
      brand: product.brand,
      model: product.model,
      category: product.category,
      condition: product.condition,
      description:
        item.description ??
        product.public_description_en ??
        product.public_description_th ??
        "",
      imageKey: product.image_key ?? "",
      imageMime: product.image_mime ?? "",
      displayPrice: item.displayPrice ?? product.selling_price,
    });
  }
  return { snapshots };
}
function itemStatements(
  database: D1Database,
  catalogId: string,
  items: ResolvedSnapshots,
) {
  if (!items.snapshots.length) return [];
  return items.snapshots.map((item) =>
    database
      .prepare(
        "INSERT INTO catalog_items(id,catalog_id,product_id,sort_order,product_name_snapshot,brand_snapshot,model_snapshot,category_snapshot,condition_snapshot,description_snapshot,image_key_snapshot,image_mime_snapshot,display_price) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        item.id,
        catalogId,
        item.productId,
        item.sortOrder,
        item.productName,
        item.brand,
        item.model,
        item.category,
        item.condition,
        item.description,
        item.imageKey,
        item.imageMime,
        item.displayPrice,
      ),
  );
}

catalogsRoutes.get("/catalogs", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.id,c.title,c.description,c.slug,c.status,c.customer_id AS customerId,
      c.show_prices AS showPrices,c.show_sold AS showSold,c.expires_at AS expiresAt,
      c.assigned_salesperson_email AS assignedSalespersonEmail,
      c.created_by AS createdBy,c.created_at AS createdAt,c.updated_at AS updatedAt,
      customers.name AS customerName,
      (SELECT COUNT(*) FROM catalog_items i JOIN products p ON p.id=i.product_id AND p.archived_at IS NULL WHERE i.catalog_id=c.id) AS productCount,
      COALESCE((SELECT SUM(count) FROM catalog_events e WHERE e.entity_type='CATALOG' AND e.entity_slug=c.slug AND e.event_type='PAGE_VIEW'),0) AS pageViews,
      COALESCE((SELECT SUM(count) FROM catalog_events e WHERE e.entity_type='CATALOG' AND e.entity_slug=c.slug AND e.event_type='PRODUCT_VIEW'),0) AS productViews,
      COALESCE((SELECT SUM(count) FROM catalog_events e WHERE e.entity_type='CATALOG' AND e.entity_slug=c.slug AND e.event_type='CONTACT_CLICK'),0) AS contactClicks
     FROM catalogs c LEFT JOIN customers ON customers.id=c.customer_id
     ORDER BY c.updated_at DESC LIMIT 200`,
  ).all();
  return c.json({
    catalogs: results,
    publicBaseUrl: c.env.PUBLIC_CATALOG_BASE_URL ?? "",
  });
});
catalogsRoutes.get("/catalogs/config", (c) =>
  c.json({ publicBaseUrl: c.env.PUBLIC_CATALOG_BASE_URL ?? "" }),
);

catalogsRoutes.get("/customers/:customerId/catalogs", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id,title,description,slug,status,expires_at AS expiresAt,updated_at AS updatedAt,
      COALESCE((SELECT SUM(count) FROM catalog_events e WHERE e.entity_type='CATALOG' AND e.entity_slug=catalogs.slug AND e.event_type='PAGE_VIEW'),0) AS pageViews
     FROM catalogs WHERE customer_id=? ORDER BY updated_at DESC LIMIT 100`,
  )
    .bind(c.req.param("customerId"))
    .all();
  return c.json({
    catalogs: results,
    publicBaseUrl: c.env.PUBLIC_CATALOG_BASE_URL ?? "",
  });
});

catalogsRoutes.get("/catalogs/analytics", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT entity_type AS entityType,entity_slug AS entitySlug,event_type AS eventType,SUM(count) AS count
     FROM catalog_events GROUP BY entity_type,entity_slug,event_type ORDER BY entity_slug LIMIT 1000`,
  ).all();
  return c.json(results);
});

catalogsRoutes.get("/catalogs/:id", async (c) => {
  const catalog = await c.env.DB.prepare(
    `SELECT id,title,description,slug,status,customer_id AS customerId,show_prices AS showPrices,
      show_sold AS showSold,expires_at AS expiresAt,assigned_salesperson_email AS assignedSalespersonEmail,
      created_by AS createdBy,created_at AS createdAt,updated_at AS updatedAt
     FROM catalogs WHERE id=?`,
  )
    .bind(c.req.param("id"))
    .first();
  if (!catalog)
    return c.json({ error: { message: "Catalog not found." } }, 404);
  const { results: items } = await c.env.DB.prepare(
    `SELECT i.id,i.product_id AS productId,i.sort_order AS sortOrder,
      i.product_name_snapshot AS productName,i.brand_snapshot AS brand,i.model_snapshot AS model,
      i.category_snapshot AS category,i.condition_snapshot AS condition,
      i.description_snapshot AS description,i.display_price AS displayPrice,
      p.public_slug AS publicSlug,p.status AS currentStatus,p.is_published AS isPublished
     FROM catalog_items i JOIN products p ON p.id=i.product_id
     WHERE i.catalog_id=? ORDER BY i.sort_order`,
  )
    .bind(c.req.param("id"))
    .all();
  return c.json({ catalog, items });
});

catalogsRoutes.post("/catalogs", async (c) => {
  const input = catalogInput.parse(await c.req.json());
  if (
    input.assignedSalespersonEmail &&
    !allowedSales(c.env).includes(input.assignedSalespersonEmail)
  )
    return c.json(
      { error: { message: "Choose a salesperson with workspace access." } },
      422,
    );
  if (input.customerId) {
    const customer = await c.env.DB.prepare(
      "SELECT id FROM customers WHERE id=?",
    )
      .bind(input.customerId)
      .first();
    if (!customer)
      return c.json({ error: { message: "Customer not found." } }, 404);
  }
  const resolved = await snapshotProducts(c, input.items);
  if ("error" in resolved)
    return c.json({ error: { message: resolved.error } }, 422);
  const id = crypto.randomUUID();
  const slug = `${slugPart(input.title)}-${randomToken()}`;
  const time = stamp();
  const operations = [
    c.env.DB.prepare(
      `INSERT INTO catalogs(id,title,description,slug,status,customer_id,show_prices,show_sold,expires_at,created_by,created_at,updated_at,assigned_salesperson_email)
       VALUES(?,?,?,?,'ACTIVE',?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      input.title,
      input.description,
      slug,
      input.customerId,
      Number(input.showPrices),
      Number(input.showSold),
      input.expiresAt,
      c.get("email"),
      time,
      time,
      input.assignedSalespersonEmail,
    ),
    ...itemStatements(c.env.DB, id, resolved),
  ];
  await c.env.DB.batch(operations);
  await writeActivity(
    c,
    "catalog",
    id,
    "created",
    `Shareable catalog created: ${input.title}`,
  );
  return c.json({ id, slug, title: input.title }, 201);
});

catalogsRoutes.patch("/catalogs/:id", async (c) => {
  const rawInput = await c.req.json();
  const input = catalogInput.parse(rawInput);
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(
    "SELECT id,slug,assigned_salesperson_email AS assignedSalespersonEmail FROM catalogs WHERE id=? AND status='ACTIVE'",
  )
    .bind(id)
    .first<{
      id: string;
      slug: string;
      assignedSalespersonEmail: string;
    }>();
  if (!existing)
    return c.json({ error: { message: "Catalog not found." } }, 404);
  const assignedSalespersonEmail = Object.hasOwn(
    rawInput,
    "assignedSalespersonEmail",
  )
    ? input.assignedSalespersonEmail
    : existing.assignedSalespersonEmail;
  if (
    assignedSalespersonEmail &&
    !allowedSales(c.env).includes(assignedSalespersonEmail)
  )
    return c.json(
      { error: { message: "Choose a salesperson with workspace access." } },
      422,
    );
  if (input.customerId) {
    const customer = await c.env.DB.prepare(
      "SELECT id FROM customers WHERE id=?",
    )
      .bind(input.customerId)
      .first();
    if (!customer)
      return c.json({ error: { message: "Customer not found." } }, 404);
  }
  const resolved = await snapshotProducts(c, input.items);
  if ("error" in resolved)
    return c.json({ error: { message: resolved.error } }, 422);
  const { results: oldItems } = await c.env.DB.prepare(
    "SELECT * FROM catalog_items WHERE catalog_id=?",
  )
    .bind(id)
    .all<{
      product_id: string;
      product_name_snapshot: string;
      brand_snapshot: string;
      model_snapshot: string;
      category_snapshot: string;
      condition_snapshot: string;
      description_snapshot: string;
      image_key_snapshot: string;
      image_mime_snapshot: string;
      display_price: number | null;
    }>();
  const oldItemsByProduct = new Map(
    oldItems.map((item) => [item.product_id, item]),
  );
  const inputItemsByProduct = new Map(
    input.items.map((item) => [item.productId, item]),
  );
  resolved.snapshots = resolved.snapshots.map((item) => {
    const oldItem = oldItemsByProduct.get(item.productId);
    return oldItem
      ? {
          ...item,
          productName: oldItem.product_name_snapshot,
          brand: oldItem.brand_snapshot,
          model: oldItem.model_snapshot,
          category: oldItem.category_snapshot,
          condition: oldItem.condition_snapshot,
          imageKey: oldItem.image_key_snapshot,
          imageMime: oldItem.image_mime_snapshot,
          displayPrice:
            inputItemsByProduct.get(item.productId)?.displayPrice ??
            oldItem.display_price,
          description:
            inputItemsByProduct.get(item.productId)?.description ??
            oldItem.description_snapshot,
        }
      : item;
  });
  const statements = [
    c.env.DB.prepare(
      `UPDATE catalogs SET title=?,description=?,customer_id=?,show_prices=?,show_sold=?,expires_at=?,assigned_salesperson_email=?,updated_at=? WHERE id=?`,
    ).bind(
      input.title,
      input.description,
      input.customerId,
      Number(input.showPrices),
      Number(input.showSold),
      input.expiresAt,
      assignedSalespersonEmail,
      stamp(),
      id,
    ),
    c.env.DB.prepare("DELETE FROM catalog_items WHERE catalog_id=?").bind(id),
    ...itemStatements(c.env.DB, id, resolved),
  ];
  await c.env.DB.batch(statements);
  await writeActivity(
    c,
    "catalog",
    id,
    "updated",
    `Shareable catalog updated: ${input.title}`,
  );
  return c.json({ ok: true, id, slug: existing.slug });
});

catalogsRoutes.post("/catalogs/:id/duplicate", async (c) => {
  const source = await c.env.DB.prepare(
    "SELECT title,description,show_prices,show_sold,assigned_salesperson_email FROM catalogs WHERE id=? AND status='ACTIVE'",
  )
    .bind(c.req.param("id"))
    .first<{
      title: string;
      description: string;
      show_prices: number;
      show_sold: number;
      assigned_salesperson_email: string;
    }>();
  if (!source) return c.json({ error: { message: "Catalog not found." } }, 404);
  const id = crypto.randomUUID();
  const time = stamp();
  const slug = `${slugPart(source.title)}-${randomToken()}`;
  const { results: sourceItems } = await c.env.DB.prepare(
    "SELECT * FROM catalog_items WHERE catalog_id=? ORDER BY sort_order",
  )
    .bind(c.req.param("id"))
    .all<Record<string, unknown>>();
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO catalogs(id,title,description,slug,status,customer_id,show_prices,show_sold,expires_at,created_by,created_at,updated_at,assigned_salesperson_email)
       VALUES(?,?,?,?,'ACTIVE',NULL,?,?,NULL,?,?,?,?)`,
    ).bind(
      id,
      `${source.title} (copy)`.slice(0, 160),
      source.description,
      slug,
      source.show_prices,
      source.show_sold,
      c.get("email"),
      time,
      time,
      source.assigned_salesperson_email,
    ),
    ...sourceItems.map((item, index) =>
      c.env.DB.prepare(
        `INSERT INTO catalog_items(id,catalog_id,product_id,sort_order,product_name_snapshot,brand_snapshot,model_snapshot,category_snapshot,condition_snapshot,description_snapshot,image_key_snapshot,image_mime_snapshot,display_price)
         SELECT ?,?,i.product_id,?,i.product_name_snapshot,i.brand_snapshot,i.model_snapshot,i.category_snapshot,i.condition_snapshot,i.description_snapshot,i.image_key_snapshot,i.image_mime_snapshot,i.display_price
         FROM catalog_items i JOIN products p ON p.id=i.product_id AND p.archived_at IS NULL WHERE i.id=?`,
      ).bind(crypto.randomUUID(), id, index, item.id),
    ),
  ];
  await c.env.DB.batch(statements);
  await writeActivity(
    c,
    "catalog",
    id,
    "duplicated",
    `Catalog duplicated from ${source.title}`,
  );
  return c.json({ id, slug, title: `${source.title} (copy)` }, 201);
});

catalogsRoutes.post("/catalogs/:id/archive", async (c) => {
  const result = await c.env.DB.prepare(
    `UPDATE catalogs SET status='ARCHIVED',updated_at=? WHERE id=? AND status='ACTIVE'`,
  )
    .bind(stamp(), c.req.param("id"))
    .run();
  if (!result.meta.changes)
    return c.json({ error: { message: "Catalog not found." } }, 404);
  await writeActivity(
    c,
    "catalog",
    c.req.param("id"),
    "archived",
    "Shareable catalog archived",
  );
  return c.json({ ok: true });
});

catalogsRoutes.post("/products/:id/publish", async (c) => {
  const input = productPublishInput.parse(await c.req.json());
  const id = c.req.param("id");
  const product = await c.env.DB.prepare(
    "SELECT id,brand,model,public_slug,archived_at FROM products WHERE id=?",
  )
    .bind(id)
    .first<{
      id: string;
      brand: string;
      model: string;
      public_slug: string | null;
      archived_at: string | null;
    }>();
  if (!product || product.archived_at)
    return c.json({ error: { message: "Product not found." } }, 404);
  const slug =
    input.publicSlug ??
    product.public_slug ??
    `${slugPart(`${product.brand} ${product.model}`)}-${randomToken()}`;
  const conflictingSlug = await c.env.DB.prepare(
    "SELECT id FROM products WHERE public_slug=? AND id!=?",
  )
    .bind(slug, id)
    .first();
  if (conflictingSlug)
    return c.json(
      { error: { message: "This public link is already in use." } },
      409,
    );
  await c.env.DB.prepare(
    `UPDATE products SET is_published=1,show_price=?,public_slug=?,public_description_th=?,public_description_en=?,published_at=COALESCE(published_at,?),updated_at=? WHERE id=?`,
  )
    .bind(
      Number(input.showPrice),
      slug,
      input.publicDescriptionTh,
      input.publicDescriptionEn,
      stamp(),
      stamp(),
      id,
    )
    .run();
  await writeActivity(
    c,
    "product",
    id,
    "catalog_published",
    "Product published to the public catalog",
  );
  return c.json({ ok: true, slug });
});

catalogsRoutes.post("/products/:id/unpublish", async (c) => {
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    "UPDATE products SET is_published=0,published_at=NULL,updated_at=? WHERE id=? AND is_published=1",
  )
    .bind(stamp(), id)
    .run();
  if (!result.meta.changes)
    return c.json({ error: { message: "Published product not found." } }, 404);
  await writeActivity(
    c,
    "product",
    id,
    "catalog_unpublished",
    "Product removed from the public catalog",
  );
  return c.json({ ok: true });
});

async function constantTimeTextEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

async function canAccessCatalogChat(c: Context, assignedEmail: string) {
  const email = c.get("email").toLowerCase();
  const admin = (c.env.AUTH_ADMIN_EMAIL ?? allowedSales(c.env)[0] ?? "")
    .trim()
    .toLowerCase();
  return (!!admin && email === admin) || email === assignedEmail.toLowerCase();
}

catalogsRoutes.get("/catalog-chats", async (c) => {
  const email = c.get("email").toLowerCase();
  const admin = (c.env.AUTH_ADMIN_EMAIL ?? allowedSales(c.env)[0] ?? "")
    .trim()
    .toLowerCase();
  const threadId = c.req.query("thread") ?? "";
  const canViewAll = !!admin && email === admin;
  const filter = canViewAll ? "1=1" : "lower(t.assigned_email)=?";
  const statement = c.env.DB.prepare(
    `SELECT t.id,t.catalog_slug AS catalogSlug,t.catalog_title AS catalogTitle,
      t.visitor_name AS visitorName,t.visitor_phone AS visitorPhone,t.status,
      t.assigned_email AS assignedEmail,t.last_message_at AS lastMessageAt,
      (SELECT body FROM catalog_chat_messages m WHERE m.chat_id=t.id ORDER BY m.id DESC LIMIT 1) AS lastMessage,
      (SELECT sender_type FROM catalog_chat_messages m WHERE m.chat_id=t.id ORDER BY m.id DESC LIMIT 1) AS lastSender
     FROM catalog_chats t WHERE ${filter} AND (?='' OR t.id=?)
     ORDER BY t.last_message_at DESC LIMIT 100`,
  );
  const { results } = await (
    canViewAll
      ? statement.bind(threadId, threadId)
      : statement.bind(email, threadId, threadId)
  ).all();
  return c.json({ threads: results });
});

catalogsRoutes.get("/catalog-chats/:id", async (c) => {
  const id = c.req.param("id");
  const thread = await c.env.DB.prepare(
    `SELECT id,catalog_slug AS catalogSlug,catalog_title AS catalogTitle,
      visitor_name AS visitorName,visitor_phone AS visitorPhone,status,
      assigned_email AS assignedEmail,created_at AS createdAt,last_message_at AS lastMessageAt
     FROM catalog_chats WHERE id=?`,
  )
    .bind(id)
    .first<{ assignedEmail: string } & Record<string, unknown>>();
  if (!thread || !(await canAccessCatalogChat(c, thread.assignedEmail)))
    return c.json({ error: { message: "Conversation not found." } }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT id,sender_type AS senderType,sender_email AS senderEmail,body,
      products,created_at AS createdAt FROM catalog_chat_messages
     WHERE chat_id=? ORDER BY id ASC LIMIT 200`,
  )
    .bind(id)
    .all<{ products: string } & Record<string, unknown>>();
  return c.json({
    thread,
    messages: results.map(({ products, ...message }) => ({
      ...message,
      products: JSON.parse(products || "[]"),
    })),
  });
});

catalogsRoutes.post("/catalog-chats/:id/messages", async (c) => {
  const { body } = catalogChatMessageInput.parse(await c.req.json());
  const id = c.req.param("id");
  const thread = await c.env.DB.prepare(
    "SELECT status,assigned_email AS assignedEmail FROM catalog_chats WHERE id=?",
  )
    .bind(id)
    .first<{ status: string; assignedEmail: string }>();
  if (!thread || !(await canAccessCatalogChat(c, thread.assignedEmail)))
    return c.json({ error: { message: "Conversation not found." } }, 404);
  if (thread.status !== "OPEN")
    return c.json({ error: { message: "Conversation is closed." } }, 409);
  const createdAt = stamp();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO catalog_chat_messages(chat_id,sender_type,sender_email,body,products,created_at) VALUES(?,'SALESPERSON',?,?,'[]',?)",
    ).bind(id, c.get("email"), body, createdAt),
    c.env.DB.prepare(
      "UPDATE catalog_chats SET updated_at=?,last_message_at=? WHERE id=?",
    ).bind(createdAt, createdAt, id),
  ]);
  return c.json({ ok: true, createdAt }, 201);
});

catalogsRoutes.patch("/catalog-chats/:id", async (c) => {
  const { status } = z
    .object({ status: z.enum(["OPEN", "CLOSED"]) })
    .strict()
    .parse(await c.req.json());
  const id = c.req.param("id");
  const thread = await c.env.DB.prepare(
    "SELECT assigned_email AS assignedEmail FROM catalog_chats WHERE id=?",
  )
    .bind(id)
    .first<{ assignedEmail: string }>();
  if (!thread || !(await canAccessCatalogChat(c, thread.assignedEmail)))
    return c.json({ error: { message: "Conversation not found." } }, 404);
  await c.env.DB.prepare(
    "UPDATE catalog_chats SET status=?,updated_at=? WHERE id=?",
  )
    .bind(status, stamp(), id)
    .run();
  return c.json({ ok: true, status });
});

export async function notifyCatalogChat(
  env: AppEnv["Bindings"],
  request: Request,
) {
  const providedSecret =
    request.headers.get("x-catalog-chat-secret") ?? "";
  if (
    !env.CATALOG_CHAT_INTERNAL_SECRET ||
    !(await constantTimeTextEqual(
      providedSecret,
      env.CATALOG_CHAT_INTERNAL_SECRET,
    ))
  )
    return new Response("Unauthorized", { status: 401 });
  if (!lineConfigured(env))
    return Response.json({ sent: 0, configured: false });
  if (Number(request.headers.get("content-length")) > 12000)
    return Response.json({ error: "Invalid message." }, { status: 413 });
  const value = (await request.json().catch(() => null)) as {
    threadId?: unknown;
    body?: unknown;
    products?: unknown;
  } | null;
  if (
    !value ||
    typeof value.threadId !== "string" ||
    typeof value.body !== "string" ||
    value.body.length > 2000 ||
    !Array.isArray(value.products) ||
    value.products.length > 3 ||
    value.products.some((product) => typeof product !== "string")
  )
    return Response.json({ error: "Invalid message." }, { status: 400 });
  const thread = await env.DB.prepare(
    "SELECT catalog_title,visitor_name,visitor_phone,assigned_email FROM catalog_chats WHERE id=?",
  )
    .bind(value.threadId)
    .first<{
      catalog_title: string;
      visitor_name: string;
      visitor_phone: string;
      assigned_email: string;
    }>();
  if (!thread)
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  const account = await env.DB.prepare(
    "SELECT line_user_id FROM line_accounts WHERE enabled=1 AND lower(email)=lower(?) LIMIT 1",
  )
    .bind(thread.assigned_email)
    .first<{ line_user_id: string }>();
  if (!account) return Response.json({ sent: 0, configured: true });
  const origin = env.APP_URL || "https://management.corevityusedgym.com";
  const products = value.products.length
    ? `\nProducts: ${value.products.map((product) => String(product).slice(0, 120)).join(", ")}`
    : "";
  const message = `Catalog inquiry · ${thread.catalog_title || "Corevity catalog"}\nFrom: ${thread.visitor_name || "Catalog visitor"}\nPhone: ${thread.visitor_phone || "Not provided"}\n${value.body.slice(0, 700)}${value.body.length > 700 ? "…" : ""}${products}\n\nReply in workspace: ${origin}/catalog-chats?thread=${encodeURIComponent(value.threadId)}`;
  try {
    const response = await lineRequest(env, "message/push", {
      method: "POST",
      body: JSON.stringify({
        to: account.line_user_id,
        messages: [{ type: "text", text: message }],
      }),
    });
    return Response.json({ sent: response.ok ? 1 : 0, configured: true });
  } catch {
    return Response.json({ sent: 0, configured: true });
  }
}
