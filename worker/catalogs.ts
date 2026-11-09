import { Hono, type Context as HonoContext } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from './auth';
import { secretsEqual } from './auth';
import { lineConfigured, lineRequest, workspaceSalesEmails } from './services/line';

export const catalogsRoutes = new Hono<AppEnv>();
const stamp = () => new Date().toISOString();
const catalogChatMessageInput = z.object({
  body: z.string().trim().min(1).max(2000),
  productSlugs: z.array(z.string().trim().min(1).max(120)).max(3).default([]),
}).strict();
const randomToken = () => crypto.randomUUID().replaceAll('-', '').slice(0, 8);
const slugPart = (value: string) =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 54) || 'equipment';
const productPublishInput = z
  .object({
    showPrice: z.boolean().default(false),
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
    description: z.string().trim().max(5000).default(''),
    customerId: z.string().nullable().default(null),
    assignedSalespersonEmail: z.string().email().optional(),
    showPrices: z.boolean().default(false),
    showSold: z.boolean().default(false),
    expiresAt: z.string().datetime().nullable().default(null),
    items: z
      .array(
        z
          .object({
            productId: z.string().min(1),
            displayPrice: z.number().finite().min(0).nullable().optional(),
            description: z.string().trim().max(10000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

type Context = HonoContext<AppEnv>;
async function writeActivity(
  c: Context,
  entityType: string,
  entityId: string,
  action: string,
  description: string,
) {
  await c.env.DB.prepare(
    'INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) VALUES(?,?,?,?,?,?,?)',
  )
    .bind(
      crypto.randomUUID(),
      entityType,
      entityId,
      action,
      description,
      c.get('email'),
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
  catalog_detail: string;
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
  items: z.infer<typeof catalogInput>['items'],
): Promise<ResolvedSnapshots | { error: string }> {
  const snapshots: ProductSnapshotItem[] = [];
  for (const [index, item] of items.entries()) {
    const product = await c.env.DB.prepare(
      `SELECT p.id,p.sku,p.brand,p.model,p.category,p.condition,p.selling_price,p.status,
        p.public_description_th,p.public_description_en,p.description_th,p.description_en,
        p.short_description,p.catalog_detail,p.public_slug,p.is_published,p.archived_at,
        i.r2_key AS image_key,i.mime_type AS image_mime
       FROM products p
       LEFT JOIN product_images i ON i.id=(SELECT id FROM product_images WHERE product_id=p.id ORDER BY is_primary DESC,sort_order LIMIT 1)
       WHERE p.id=?`,
    )
      .bind(item.productId)
      .first<ProductSnapshot>();
    if (!product || product.archived_at)
      return { error: 'A selected product is no longer available.' as const };
    if (!product.is_published || !product.public_slug)
      return {
        error:
          `${product.brand} ${product.model} must be published before it can be added to a shareable catalog.` as const,
      };
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
        item.description ||
        product.catalog_detail ||
        product.description_en ||
        product.description_th ||
        product.short_description,
      imageKey: product.image_key ?? '',
      imageMime: product.image_mime ?? '',
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
        'INSERT INTO catalog_items(id,catalog_id,product_id,sort_order,product_name_snapshot,brand_snapshot,model_snapshot,category_snapshot,condition_snapshot,description_snapshot,image_key_snapshot,image_mime_snapshot,display_price) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
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

catalogsRoutes.get('/catalogs', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.id,c.title,c.description,c.slug,c.status,c.customer_id AS customerId,
      0 AS showPrices,c.show_sold AS showSold,c.expires_at AS expiresAt,
      c.publish_to_web AS publishToWeb,c.published_to_web_at AS publishedToWebAt,c.web_sort_order AS webSortOrder,
      c.created_by AS createdBy,c.assigned_salesperson_email AS assignedSalespersonEmail,
      COALESCE(NULLIF(trim(s.first_name || ' ' || s.last_name),''),c.assigned_salesperson_email) AS assignedSalespersonName,
      CASE WHEN la.email IS NULL THEN 0 ELSE 1 END AS assignedSalespersonLineReady,c.created_at AS createdAt,c.updated_at AS updatedAt,
      customers.name AS customerName,
      (SELECT COUNT(*) FROM catalog_items i JOIN products p ON p.id=i.product_id AND p.is_published=1 AND p.archived_at IS NULL WHERE i.catalog_id=c.id) AS productCount,
      COALESCE((SELECT SUM(count) FROM catalog_events e WHERE e.entity_type='CATALOG' AND e.entity_slug=c.slug AND e.event_type='PAGE_VIEW'),0) AS pageViews,
      COALESCE((SELECT SUM(count) FROM catalog_events e WHERE e.entity_type='CATALOG' AND e.entity_slug=c.slug AND e.event_type='PRODUCT_VIEW'),0) AS productViews,
      COALESCE((SELECT SUM(count) FROM catalog_events e WHERE e.entity_type='CATALOG' AND e.entity_slug=c.slug AND e.event_type='CONTACT_CLICK'),0) AS contactClicks
     FROM catalogs c LEFT JOIN customers ON customers.id=c.customer_id
     LEFT JOIN salespeople s ON s.email=c.assigned_salesperson_email
     LEFT JOIN line_accounts la ON la.email=c.assigned_salesperson_email AND la.enabled=1
     ORDER BY c.updated_at DESC LIMIT 200`,
  ).all();
  return c.json({
    catalogs: results,
    publicBaseUrl: c.env.PUBLIC_CATALOG_BASE_URL ?? '',
  });
});
catalogsRoutes.get('/catalogs/config', (c) =>
  c.json({ publicBaseUrl: c.env.PUBLIC_CATALOG_BASE_URL ?? '' }),
);

catalogsRoutes.get('/customers/:customerId/catalogs', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id,title,description,slug,status,expires_at AS expiresAt,updated_at AS updatedAt,
      COALESCE((SELECT SUM(count) FROM catalog_events e WHERE e.entity_type='CATALOG' AND e.entity_slug=catalogs.slug AND e.event_type='PAGE_VIEW'),0) AS pageViews
     FROM catalogs WHERE customer_id=? ORDER BY updated_at DESC LIMIT 100`,
  )
    .bind(c.req.param('customerId'))
    .all();
  return c.json({
    catalogs: results,
    publicBaseUrl: c.env.PUBLIC_CATALOG_BASE_URL ?? '',
  });
});

catalogsRoutes.get('/catalogs/analytics', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT entity_type AS entityType,entity_slug AS entitySlug,event_type AS eventType,SUM(count) AS count
     FROM catalog_events GROUP BY entity_type,entity_slug,event_type ORDER BY entity_slug LIMIT 1000`,
  ).all();
  return c.json(results);
});

catalogsRoutes.get('/catalogs/:id', async (c) => {
  const catalog = await c.env.DB.prepare(
    `SELECT catalogs.id,title,description,slug,status,customer_id AS customerId,0 AS showPrices,
      publish_to_web AS publishToWeb,published_to_web_at AS publishedToWebAt,
      show_sold AS showSold,expires_at AS expiresAt,created_by AS createdBy,
      assigned_salesperson_email AS assignedSalespersonEmail,
      COALESCE(NULLIF(trim(s.first_name || ' ' || s.last_name),''),catalogs.assigned_salesperson_email) AS assignedSalespersonName,
      CASE WHEN la.email IS NULL THEN 0 ELSE 1 END AS assignedSalespersonLineReady,
      catalogs.created_at AS createdAt,catalogs.updated_at AS updatedAt
     FROM catalogs LEFT JOIN salespeople s ON s.email=catalogs.assigned_salesperson_email
     LEFT JOIN line_accounts la ON la.email=catalogs.assigned_salesperson_email AND la.enabled=1 WHERE catalogs.id=?`,
  )
    .bind(c.req.param('id'))
    .first();
  if (!catalog)
    return c.json({ error: { message: 'Catalog not found.' } }, 404);
  const { results: items } = await c.env.DB.prepare(
    `SELECT i.id,i.product_id AS productId,i.sort_order AS sortOrder,
      i.product_name_snapshot AS productName,i.brand_snapshot AS brand,i.model_snapshot AS model,
      i.category_snapshot AS category,i.condition_snapshot AS condition,
      i.description_snapshot AS description,i.display_price AS displayPrice,
      p.public_slug AS publicSlug,p.status AS currentStatus,p.is_published AS isPublished
     FROM catalog_items i JOIN products p ON p.id=i.product_id
     WHERE i.catalog_id=? ORDER BY i.sort_order`,
  )
    .bind(c.req.param('id'))
    .all();
  return c.json({ catalog, items });
});

catalogsRoutes.post('/catalogs', async (c) => {
  const input = catalogInput.parse(await c.req.json());
  const assignedEmail = (input.assignedSalespersonEmail || c.get('email')).toLowerCase();
  if (!(await workspaceSalesEmails(c.env)).includes(assignedEmail))
    return c.json({ error: { message: 'Choose a salesperson with workspace access.' } }, 422);
  if (input.customerId) {
    const customer = await c.env.DB.prepare(
      'SELECT id FROM customers WHERE id=?',
    )
      .bind(input.customerId)
      .first();
    if (!customer)
      return c.json({ error: { message: 'Customer not found.' } }, 404);
  }
  const resolved = await snapshotProducts(c, input.items);
  if ('error' in resolved)
    return c.json({ error: { message: resolved.error } }, 422);
  const id = crypto.randomUUID();
  const slug = `${slugPart(input.title)}-${randomToken()}`;
  const time = stamp();
  const operations = [
    c.env.DB.prepare(
      `INSERT INTO catalogs(id,title,description,slug,status,customer_id,show_prices,show_sold,expires_at,created_by,assigned_salesperson_email,created_at,updated_at)
       VALUES(?,?,?,?,'ACTIVE',?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      input.title,
      input.description,
      slug,
      input.customerId,
      0,
      Number(input.showSold),
      input.expiresAt,
      c.get('email'),
      assignedEmail,
      time,
      time,
    ),
    ...itemStatements(c.env.DB, id, resolved),
  ];
  await c.env.DB.batch(operations);
  await writeActivity(
    c,
    'catalog',
    id,
    'created',
    `Shareable catalog created: ${input.title}`,
  );
  return c.json({ id, slug, title: input.title }, 201);
});

catalogsRoutes.patch('/catalogs/:id', async (c) => {
  const input = catalogInput.parse(await c.req.json());
  const assignedEmail = (input.assignedSalespersonEmail || c.get('email')).toLowerCase();
  if (!(await workspaceSalesEmails(c.env)).includes(assignedEmail))
    return c.json({ error: { message: 'Choose a salesperson with workspace access.' } }, 422);
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    "SELECT id,slug FROM catalogs WHERE id=? AND status='ACTIVE'",
  )
    .bind(id)
    .first<{ id: string; slug: string }>();
  if (!existing)
    return c.json({ error: { message: 'Catalog not found.' } }, 404);
  if (input.customerId) {
    const customer = await c.env.DB.prepare(
      'SELECT id FROM customers WHERE id=?',
    )
      .bind(input.customerId)
      .first();
    if (!customer)
      return c.json({ error: { message: 'Customer not found.' } }, 404);
  }
  const resolved = await snapshotProducts(c, input.items);
  if ('error' in resolved)
    return c.json({ error: { message: resolved.error } }, 422);
  const { results: oldItems } = await c.env.DB.prepare(
    'SELECT * FROM catalog_items WHERE catalog_id=?',
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
            inputItemsByProduct.get(item.productId)?.description ||
            oldItem.description_snapshot,
        }
      : item;
  });
  const statements = [
    c.env.DB.prepare(
      `UPDATE catalogs SET title=?,description=?,customer_id=?,assigned_salesperson_email=?,show_prices=?,show_sold=?,expires_at=?,updated_at=? WHERE id=?`,
    ).bind(
      input.title,
      input.description,
      input.customerId,
      assignedEmail,
      0,
      Number(input.showSold),
      input.expiresAt,
      stamp(),
      id,
    ),
    c.env.DB.prepare('DELETE FROM catalog_items WHERE catalog_id=?').bind(id),
    ...itemStatements(c.env.DB, id, resolved),
  ];
  await c.env.DB.batch(statements);
  await writeActivity(
    c,
    'catalog',
    id,
    'updated',
    `Shareable catalog updated: ${input.title}`,
  );
  return c.json({ ok: true, id, slug: existing.slug });
});

catalogsRoutes.post('/catalogs/:id/duplicate', async (c) => {
  const source = await c.env.DB.prepare(
    "SELECT title,description,show_prices,show_sold,assigned_salesperson_email FROM catalogs WHERE id=? AND status='ACTIVE'",
  )
    .bind(c.req.param('id'))
    .first<{
      title: string;
      description: string;
      show_prices: number;
      show_sold: number;
      assigned_salesperson_email: string;
    }>();
  if (!source) return c.json({ error: { message: 'Catalog not found.' } }, 404);
  const id = crypto.randomUUID();
  const time = stamp();
  const slug = `${slugPart(source.title)}-${randomToken()}`;
  const { results: sourceItems } = await c.env.DB.prepare(
    'SELECT * FROM catalog_items WHERE catalog_id=? ORDER BY sort_order',
  )
    .bind(c.req.param('id'))
    .all<Record<string, unknown>>();
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO catalogs(id,title,description,slug,status,customer_id,show_prices,show_sold,expires_at,created_by,assigned_salesperson_email,created_at,updated_at)
       VALUES(?,?,?,?,'ACTIVE',NULL,?,?,NULL,?,?,?,?)`,
    ).bind(
      id,
      `${source.title} (copy)`.slice(0, 160),
      source.description,
      slug,
      0,
      source.show_sold,
      c.get('email'),
      source.assigned_salesperson_email,
      time,
      time,
    ),
    ...sourceItems.map((item, index) =>
      c.env.DB.prepare(
        `INSERT INTO catalog_items(id,catalog_id,product_id,sort_order,product_name_snapshot,brand_snapshot,model_snapshot,category_snapshot,condition_snapshot,description_snapshot,image_key_snapshot,image_mime_snapshot,display_price)
         SELECT ?,?,i.product_id,?,i.product_name_snapshot,i.brand_snapshot,i.model_snapshot,i.category_snapshot,i.condition_snapshot,i.description_snapshot,i.image_key_snapshot,i.image_mime_snapshot,i.display_price
         FROM catalog_items i JOIN products p ON p.id=i.product_id AND p.is_published=1 AND p.archived_at IS NULL WHERE i.id=?`,
      ).bind(crypto.randomUUID(), id, index, item.id),
    ),
  ];
  await c.env.DB.batch(statements);
  await writeActivity(
    c,
    'catalog',
    id,
    'duplicated',
    `Catalog duplicated from ${source.title}`,
  );
  return c.json({ id, slug, title: `${source.title} (copy)` }, 201);
});

catalogsRoutes.post('/catalogs/:id/archive', async (c) => {
  const result = await c.env.DB.prepare(
    `UPDATE catalogs SET status='ARCHIVED',publish_to_web=0,published_to_web_at=NULL,web_sort_order=NULL,updated_at=? WHERE id=? AND status='ACTIVE'`,
  )
    .bind(stamp(), c.req.param('id'))
    .run();
  if (!result.meta.changes)
    return c.json({ error: { message: 'Catalog not found.' } }, 404);
  await writeActivity(
    c,
    'catalog',
    c.req.param('id'),
    'archived',
    'Shareable catalog archived',
  );
  return c.json({ ok: true });
});

catalogsRoutes.post('/catalogs/:id/publish-to-web', async (c) => {
  const id = c.req.param('id');
  const catalog = await c.env.DB.prepare(
    'SELECT status,expires_at,publish_to_web FROM catalogs WHERE id=?',
  ).bind(id).first<{status: string; expires_at: string | null; publish_to_web: number}>();
  if (!catalog) return c.json({error: {message: 'Catalog not found.'}}, 404);
  if (catalog.status !== 'ACTIVE' || (catalog.expires_at && Date.parse(catalog.expires_at) <= Date.now()))
    return c.json({error: {message: 'Only an active, unexpired catalog can be published.'}}, 409);
  if (!catalog.publish_to_web) {
    const now = stamp();
    // A newly published Catalog goes to the top of the website order.
    await c.env.DB.prepare(
      `UPDATE catalogs SET publish_to_web=1,published_to_web_at=?,updated_at=?,
        web_sort_order=COALESCE((SELECT MIN(web_sort_order) FROM catalogs WHERE publish_to_web=1),0)-1
       WHERE id=?`,
    ).bind(now,now,id).run();
    await writeActivity(c,'catalog',id,'published_to_web','Catalog published to website');
  }
  return c.json({ok: true});
});

catalogsRoutes.post('/catalogs/:id/unpublish-from-web', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare('UPDATE catalogs SET publish_to_web=0,published_to_web_at=NULL,web_sort_order=NULL,updated_at=? WHERE id=? AND publish_to_web=1').bind(stamp(),id).run();
  if (!result.meta.changes) return c.json({error: {message: 'Published catalog not found.'}}, 404);
  await writeActivity(c,'catalog',id,'unpublished_from_web','Catalog removed from website');
  return c.json({ok: true});
});

const webOrderInput = z
  .object({ ids: z.array(z.string().min(1)).min(1).max(200) })
  .strict();
catalogsRoutes.put('/catalogs/web-order', async (c) => {
  const { ids } = webOrderInput.parse(await c.req.json());
  const { results } = await c.env.DB.prepare(
    "SELECT id FROM catalogs WHERE publish_to_web=1 AND status='ACTIVE'",
  ).all<{ id: string }>();
  const published = new Set(results.map((row) => row.id));
  if (new Set(ids).size !== ids.length || ids.length !== published.size || ids.some((id) => !published.has(id)))
    return c.json({ error: { message: 'The website Catalog list changed. Reload and try again.' } }, 409);
  await c.env.DB.batch(
    ids.map((id, index) =>
      c.env.DB.prepare('UPDATE catalogs SET web_sort_order=? WHERE id=? AND publish_to_web=1').bind(index, id),
    ),
  );
  await writeActivity(c, 'catalog', ids[0], 'web_reordered', 'Website Catalog order updated');
  return c.json({ ok: true });
});

catalogsRoutes.delete('/catalogs/:id', async (c) => {
  const id = c.req.param('id');
  const catalog = await c.env.DB.prepare('SELECT title,slug FROM catalogs WHERE id=?')
    .bind(id)
    .first<{ title: string; slug: string }>();
  if (!catalog) return c.json({ error: { message: 'Catalog not found.' } }, 404);
  // Catalog chats keep their own title/slug snapshot, so conversation history is retained.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM catalog_items WHERE catalog_id=?').bind(id),
    c.env.DB.prepare("DELETE FROM catalog_events WHERE entity_type='CATALOG' AND entity_slug=?").bind(catalog.slug),
    c.env.DB.prepare('DELETE FROM catalogs WHERE id=?').bind(id),
  ]);
  await writeActivity(c, 'catalog', id, 'deleted', `Shareable catalog deleted: ${catalog.title}`);
  return c.json({ ok: true });
});

catalogsRoutes.post('/products/publish-all', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id,brand,model,public_slug,description_th,description_en FROM products WHERE archived_at IS NULL ORDER BY sku',
  ).all<{
    id: string;
    brand: string;
    model: string;
    public_slug: string | null;
    description_th: string;
    description_en: string;
  }>();
  const time = stamp();
  const statements = [];
  for (const product of results) {
    const slug =
      product.public_slug ??
      `${slugPart(`${product.brand} ${product.model}`)}-${randomToken()}`;
    statements.push(
      c.env.DB.prepare(
        `UPDATE products SET is_published=1,show_price=0,public_slug=?,
          public_description_th=description_th,public_description_en=description_en,
          published_at=COALESCE(published_at,?),updated_at=? WHERE id=? AND archived_at IS NULL`,
      ).bind(slug, time, time, product.id),
    );
  }
  for (let index = 0; index < statements.length; index += 100)
    await c.env.DB.batch(statements.slice(index, index + 100));
  await writeActivity(
    c,
    'catalog',
    'public-catalog',
    'published_all',
    `Published ${results.length} products without prices to the public catalog`,
  );
  return c.json({ published: results.length, showPrices: false });
});

catalogsRoutes.post('/products/:id/publish', async (c) => {
  const input = productPublishInput.parse(await c.req.json());
  const id = c.req.param('id');
  const product = await c.env.DB.prepare(
    'SELECT id,brand,model,public_slug,archived_at FROM products WHERE id=?',
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
    return c.json({ error: { message: 'Product not found.' } }, 404);
  const slug =
    input.publicSlug ??
    product.public_slug ??
    `${slugPart(`${product.brand} ${product.model}`)}-${randomToken()}`;
  const conflictingSlug = await c.env.DB.prepare(
    'SELECT id FROM products WHERE public_slug=? AND id!=?',
  )
    .bind(slug, id)
    .first();
  if (conflictingSlug)
    return c.json(
      { error: { message: 'This public link is already in use.' } },
      409,
    );
  await c.env.DB.prepare(
    `UPDATE products SET is_published=1,show_price=?,public_slug=?,public_description_th=description_th,public_description_en=description_en,published_at=COALESCE(published_at,?),updated_at=? WHERE id=?`,
  )
    .bind(
      0,
      slug,
      stamp(),
      stamp(),
      id,
    )
    .run();
  await writeActivity(
    c,
    'product',
    id,
    'catalog_published',
    'Product published to the public catalog',
  );
  return c.json({ ok: true, slug });
});

catalogsRoutes.post('/products/:id/unpublish', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    'UPDATE products SET is_published=0,published_at=NULL,updated_at=? WHERE id=? AND is_published=1',
  )
    .bind(stamp(), id)
    .run();
  if (!result.meta.changes)
    return c.json({ error: { message: 'Published product not found.' } }, 404);
  await writeActivity(
    c,
    'product',
    id,
    'catalog_unpublished',
    'Product removed from the public catalog',
  );
  return c.json({ ok: true });
});

async function canAccessCatalogChat(c: Context, assignedEmail: string, source: string) {
  if (source === 'WEBSITE') return true;
  const email = c.get('email').toLowerCase();
  const admin = (c.env.AUTH_ADMIN_EMAIL ?? '').toLowerCase();
  return email === assignedEmail.toLowerCase() || (!!admin && email === admin);
}

catalogsRoutes.get('/catalog-chats', async (c) => {
  const threadId = c.req.query('thread') ?? '';
  const email = c.get('email').toLowerCase();
  const admin = (c.env.AUTH_ADMIN_EMAIL ?? '').toLowerCase();
  const { results } = await c.env.DB.prepare(
    `SELECT t.id,t.catalog_slug AS catalogSlug,t.catalog_title AS catalogTitle,t.visitor_name AS visitorName,t.visitor_phone AS visitorPhone,t.visitor_email AS visitorEmail,t.source,
      t.status,t.last_message_at AS lastMessageAt,
      (SELECT id FROM catalog_chat_messages m WHERE m.chat_id=t.id ORDER BY m.id DESC LIMIT 1) AS lastMessageId,
      (SELECT body FROM catalog_chat_messages m WHERE m.chat_id=t.id ORDER BY m.id DESC LIMIT 1) AS lastMessage,
      (SELECT sender_type FROM catalog_chat_messages m WHERE m.chat_id=t.id ORDER BY m.id DESC LIMIT 1) AS lastSender
     FROM catalog_chats t WHERE (t.source='WEBSITE' OR (?<>'' AND lower(t.assigned_email)=?) OR (?<>'' AND lower(t.assigned_email)=?))
       AND (?='' OR t.id=?)
       ORDER BY t.last_message_at DESC LIMIT 100`,
  ).bind(email, email, admin, admin, threadId, threadId).all();
  return c.json({ threads: results });
});

catalogsRoutes.get('/catalog-chats/products', async (c) => {
  const query = (c.req.query('q') ?? '').trim().slice(0, 80);
  const like = `%${query}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT public_slug AS slug,brand || ' ' || model AS label,category
     FROM products WHERE is_published=1 AND archived_at IS NULL AND public_slug IS NOT NULL
       AND (?='' OR brand LIKE ? OR model LIKE ? OR category LIKE ?)
     ORDER BY created_at DESC LIMIT 60`,
  ).bind(query, like, like, like).all<{ slug: string; label: string; category: string }>();
  return c.json({ products: results });
});

catalogsRoutes.get('/catalog-chats/:id', async (c) => {
  const id = c.req.param('id');
  const thread = await c.env.DB.prepare(
    `SELECT id,catalog_slug AS catalogSlug,catalog_title AS catalogTitle,visitor_name AS visitorName,visitor_phone AS visitorPhone,visitor_email AS visitorEmail,source,status,
      assigned_email AS assignedEmail,created_at AS createdAt,last_message_at AS lastMessageAt FROM catalog_chats WHERE id=?`,
  ).bind(id).first<{ assignedEmail: string; source: string } & Record<string, unknown>>();
  if (!thread) throw new HTTPException(404, { message: 'Conversation not found.' });
  if (!(await canAccessCatalogChat(c, thread.assignedEmail, thread.source))) throw new HTTPException(404, { message: 'Conversation not found.' });
  const messages = await c.env.DB.prepare(
    'SELECT id,sender_type AS senderType,sender_email AS senderEmail,body,products,created_at AS createdAt FROM catalog_chat_messages WHERE chat_id=? ORDER BY id ASC LIMIT 200',
  ).bind(id).all();
  return c.json({ thread, messages: messages.results.map((row) => ({ ...row, products: JSON.parse(String(row.products || '[]')) })) });
});

catalogsRoutes.post('/catalog-chats/:id/messages', async (c) => {
  const { body, productSlugs } = catalogChatMessageInput.parse(await c.req.json());
  const id = c.req.param('id');
  const thread = await c.env.DB.prepare('SELECT status,assigned_email AS assignedEmail,source FROM catalog_chats WHERE id=?').bind(id).first<{ status: string; assignedEmail: string; source: string }>();
  if (!thread) throw new HTTPException(404, { message: 'Conversation not found.' });
  if (!(await canAccessCatalogChat(c, thread.assignedEmail, thread.source))) throw new HTTPException(404, { message: 'Conversation not found.' });
  if (thread.status !== 'OPEN') throw new HTTPException(409, { message: 'This conversation is closed.' });
  const uniqueSlugs = [...new Set(productSlugs)];
  let products: { slug: string; label: string; category: string }[] = [];
  if (uniqueSlugs.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT public_slug AS slug,brand || ' ' || model AS label,category FROM products
       WHERE is_published=1 AND archived_at IS NULL AND public_slug IN (${uniqueSlugs.map(() => '?').join(',')})`,
    ).bind(...uniqueSlugs).all<{ slug: string; label: string; category: string }>();
    if (results.length !== uniqueSlugs.length) throw new HTTPException(400, { message: 'One or more selected products are no longer available to share.' });
    products = results;
  }
  const createdAt = stamp();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO catalog_chat_messages(chat_id,sender_type,sender_email,body,products,created_at) VALUES(?,'SALESPERSON',?,?,?,?)").bind(id, c.get('email'), body, JSON.stringify(products), createdAt),
    c.env.DB.prepare('UPDATE catalog_chats SET updated_at=?,last_message_at=? WHERE id=?').bind(createdAt, createdAt, id),
  ]);
  return c.json({ ok: true, createdAt }, 201);
});

catalogsRoutes.patch('/catalog-chats/:id', async (c) => {
  const { status } = z.object({ status: z.enum(['OPEN', 'CLOSED']) }).strict().parse(await c.req.json());
  const thread = await c.env.DB.prepare('SELECT assigned_email AS assignedEmail,source FROM catalog_chats WHERE id=?').bind(c.req.param('id')).first<{ assignedEmail: string; source: string }>();
  if (!thread) throw new HTTPException(404, { message: 'Conversation not found.' });
  if (!(await canAccessCatalogChat(c, thread.assignedEmail, thread.source))) throw new HTTPException(404, { message: 'Conversation not found.' });
  const result = await c.env.DB.prepare('UPDATE catalog_chats SET status=?,updated_at=? WHERE id=?').bind(status, stamp(), c.req.param('id')).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Conversation not found.' });
  return c.json({ ok: true, status });
});

export async function notifyCatalogChat(env: AppEnv['Bindings'], request: Request) {
  if (!env.CATALOG_CHAT_INTERNAL_SECRET || !(await secretsEqual(request.headers.get('x-catalog-chat-secret') ?? '', env.CATALOG_CHAT_INTERNAL_SECRET)))
    return new Response('Unauthorized', { status: 401 });
  if (!lineConfigured(env)) return Response.json({ sent: 0, configured: false });
  const payload = z.object({ threadId: z.string().uuid(), body: z.string().max(2000), products: z.array(z.string().max(120)).max(3) }).strict().safeParse(await request.json().catch(() => null));
  if (!payload.success) return Response.json({ error: 'Invalid message.' }, { status: 400 });
  const thread = await env.DB.prepare('SELECT catalog_title,visitor_name,visitor_phone,assigned_email,source FROM catalog_chats WHERE id=?').bind(payload.data.threadId).first<{ catalog_title: string; visitor_name: string; visitor_phone: string; assigned_email: string; source: string }>();
  if (!thread) return Response.json({ error: 'Conversation not found.' }, { status: 404 });
  const allowed = new Set(await workspaceSalesEmails(env));
  const accounts = await env.DB.prepare("SELECT email,line_user_id FROM line_accounts WHERE enabled=1 AND (?='WEBSITE' OR lower(email)=lower(?))").bind(thread.source, thread.assigned_email).all<{ email: string; line_user_id: string }>();
  const recipients = accounts.results.filter((account) => allowed.has(account.email.toLowerCase()));
  if (!recipients.length) return Response.json({ sent: 0, configured: true });
  const origin = env.APP_URL || 'https://management.corevityusedgym.com';
  const productText = payload.data.products.length ? `\nProducts: ${payload.data.products.join(', ')}` : '';
  const title = thread.source === 'WEBSITE' ? 'Website inquiry · Corevity' : `Catalog inquiry · ${thread.catalog_title || 'Corevity catalog'}`;
  const message = `${title}\nFrom: ${thread.visitor_name || 'Visitor'}\nPhone: ${thread.visitor_phone || 'Not provided'}\n${payload.data.body.slice(0, 700)}${payload.data.body.length > 700 ? '…' : ''}${productText}\n\nReply in workspace: ${origin}/catalog-chats?thread=${encodeURIComponent(payload.data.threadId)}`;
  const results = await Promise.all(recipients.map(async (account) => {
    try {
      const response = await lineRequest(env, 'message/push', { method: 'POST', body: JSON.stringify({ to: account.line_user_id, messages: [{ type: 'text', text: message }] }) });
      if (!response.ok) console.error(JSON.stringify({ event: 'catalog_chat_line_failed', status: response.status }));
      return response.ok;
    } catch (error) {
      console.error(JSON.stringify({ event: 'catalog_chat_line_failed', type: error instanceof Error ? error.name : 'Error' }));
      return false;
    }
  }));
  return Response.json({ sent: results.filter(Boolean).length, configured: true });
}
