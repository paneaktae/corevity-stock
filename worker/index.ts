import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { drizzle } from 'drizzle-orm/d1';
import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  like,
  or,
  sql,
} from 'drizzle-orm';
import { z, ZodError } from 'zod';
import { auth, type AppEnv } from './auth';
import * as s from './db/schema';
import {
  productInput,
  customerInput,
  leadInput,
  generateInput,
  type Lead,
  type Product,
} from '../shared/schemas';
import { createDescriptionProvider } from './services/ai';
const app = new Hono<AppEnv>();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
function provided<T extends object>(parsed: T, raw: object): T {
  for (const key of Object.keys(parsed) as (keyof T)[]) {
    if (!Object.hasOwn(raw, key)) delete parsed[key];
  }
  return parsed;
}
const fail = (status: 400 | 404 | 409 | 422, message: string): never => {
  throw new HTTPException(status, { message });
};
const db = (c: Parameters<typeof auth>[0]) => drizzle(c.env.DB);
const activity = (
  c: Parameters<typeof auth>[0],
  entityType: string,
  entityId: string,
  action: string,
  description: string,
) =>
  db(c)
    .insert(s.activities)
    .values({
      id: id(),
      entityType,
      entityId,
      action,
      description,
      userEmail: c.get('email'),
      createdAt: now(),
    });
const getProduct = async (c: Parameters<typeof auth>[0], productId: string) => {
  const [p] = await db(c)
    .select()
    .from(s.products)
    .where(and(eq(s.products.id, productId), isNull(s.products.archivedAt)));
  if (!p) fail(404, 'Equipment not found.');
  return p;
};
const getLead = async (c: Parameters<typeof auth>[0], leadId: string) => {
  const [l] = await db(c).select().from(s.leads).where(eq(s.leads.id, leadId));
  if (!l) fail(404, 'Lead not found.');
  return l;
};
const getCustomer = async (
  c: Parameters<typeof auth>[0],
  customerId: string,
) => {
  const [v] = await db(c)
    .select()
    .from(s.customers)
    .where(eq(s.customers.id, customerId));
  if (!v) fail(404, 'Customer not found.');
  return v;
};
const activities = async (
  c: Parameters<typeof auth>[0],
  entityType: string,
  entityId: string,
) =>
  db(c)
    .select()
    .from(s.activities)
    .where(
      and(
        eq(s.activities.entityType, entityType),
        eq(s.activities.entityId, entityId),
      ),
    )
    .orderBy(desc(s.activities.createdAt))
    .limit(50);
app.use('*', secureHeaders());
app.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  if (!import.meta.env.DEV)
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  return next();
});
app.use('*', auth);
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (
      (origin && origin !== new URL(c.req.url).origin) ||
      c.req.header('Sec-Fetch-Site') === 'cross-site'
    )
      return c.json(
        {
          error: { code: 'FORBIDDEN', message: 'Cross-site request blocked.' },
        },
        403,
      );
  }
  return next();
});
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 52 * 1024 * 1024,
    onError: (c) =>
      c.json(
        {
          error: { message: 'Upload is too large.', code: 'PAYLOAD_TOO_LARGE' },
        },
        413,
      ),
  }),
);
app.onError((error, c) => {
  if (error instanceof ZodError)
    return c.json(
      {
        error: {
          code: 'VALIDATION',
          message: 'Please check the highlighted fields.',
          fields: error.flatten().fieldErrors,
        },
      },
      422,
    );
  if (error instanceof HTTPException)
    return c.json(
      { error: { code: 'REQUEST_ERROR', message: error.message } },
      error.status,
    );
  if (error instanceof SyntaxError)
    return c.json(
      { error: { code: 'INVALID_JSON', message: 'Invalid JSON body.' } },
      400,
    );
  const message =
    error.cause instanceof Error ? error.cause.message : error.message;
  if (
    /UNIQUE constraint|Product is not available|Reservation does not match|Sold products cannot|Reserve this product|Release the reservation|Lead is already won|Product has an active|Sale does not match|Product is reserved|CHECK constraint|FOREIGN KEY constraint/i.test(
      message,
    )
  )
    return c.json(
      {
        error: {
          code: 'CONFLICT',
          message:
            'This change conflicts with the current data. Refresh and try again; check SKU uniqueness and reservation status.',
        },
      },
      409,
    );
  console.error(
    JSON.stringify({
      event: 'request_error',
      path: c.req.path,
      type: error.name,
      ...(import.meta.env.DEV
        ? { message: error.message, cause: message }
        : {}),
    }),
  );
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The request could not be completed. Please retry.',
      },
    },
    500,
  );
});
app.get('/api/settings', async (c) => {
  const [row] = await db(c)
    .select()
    .from(s.settings)
    .where(eq(s.settings.key, 'conditions'));
  return c.json({
    conditions: JSON.parse(row.value),
    userEmail: c.get('email'),
    environment: c.env.ENVIRONMENT,
    aiConfigured: !!(c.env.AI_API_KEY && c.env.AI_MODEL && c.env.AI_BASE_URL),
    maxUploadMB: Number(c.env.MAX_UPLOAD_MB),
    timezone: c.env.BUSINESS_TIMEZONE,
  });
});
app.patch('/api/settings', async (c) => {
  const data = z
    .object({
      conditions: z
        .array(z.string().trim().min(1).max(80))
        .min(1)
        .max(30)
        .refine(
          (v) => new Set(v).size === v.length,
          'Conditions must be unique',
        ),
    })
    .parse(await c.req.json());
  await db(c).batch([
    db(c)
      .update(s.settings)
      .set({ value: JSON.stringify(data.conditions) })
      .where(eq(s.settings.key, 'conditions')),
    activity(
      c,
      'settings',
      'conditions',
      'updated',
      'Equipment conditions updated',
    ),
  ]);
  return c.json(data);
});
async function productList(c: Parameters<typeof auth>[0]) {
  const q = c.req.query('q')?.slice(0, 200);
  const clauses = [isNull(s.products.archivedAt)];
  if (q)
    clauses.push(
      or(
        ...[
          s.products.sku,
          s.products.brand,
          s.products.model,
          s.products.serialNumber,
        ].map((col) => like(col, `%${q}%`)),
      )!,
    );
  for (const key of ['brand', 'category', 'status', 'condition'] as const) {
    const v = c.req.query(key);
    if (v) clauses.push(eq(s.products[key], v));
  }
  const sort = c.req.query('sort');
  const order =
    sort === 'price-asc'
      ? s.products.sellingPrice
      : sort === 'price-desc'
        ? desc(s.products.sellingPrice)
        : sort === 'brand'
          ? s.products.brand
          : desc(s.products.createdAt);
  return db(c)
    .select({
      ...getTableColumns(s.products),
      primaryImageId: sql<
        string | null
      >`(SELECT id FROM product_images WHERE product_id=products.id ORDER BY is_primary DESC,sort_order LIMIT 1)`,
      reservedCustomerName: sql<
        string | null
      >`(SELECT customers.name FROM reservations JOIN customers ON customers.id=reservations.customer_id WHERE reservations.product_id=products.id)`,
    })
    .from(s.products)
    .where(and(...clauses))
    .orderBy(order)
    .limit(1000);
}
app.get('/api/products', async (c) => c.json(await productList(c)));
app.post('/api/products', async (c) => {
  const data = productInput.parse(await c.req.json());
  if (data.status === 'RESERVED')
    fail(422, 'Save the equipment first, then reserve it for a customer.');
  const productId = id(),
    time = now();
  const year = new Date().getFullYear();
  const seq = await c.env.DB.prepare(
    'INSERT INTO sku_sequences(year,value) VALUES (?,1) ON CONFLICT(year) DO UPDATE SET value=value+1 RETURNING value',
  )
    .bind(year)
    .first<{ value: number }>();
  const sku = data.sku || `EQ-${year}-${String(seq!.value).padStart(4, '0')}`;
  await db(c).batch([
    db(c)
      .insert(s.products)
      .values({
        ...data,
        sku,
        id: productId,
        createdAt: time,
        updatedAt: time,
        soldAt: data.status === 'SOLD' ? time : null,
      }),
    activity(
      c,
      'product',
      productId,
      'created',
      `${data.brand} ${data.model} added`,
    ),
  ]);
  return c.json(await getProduct(c, productId), 201);
});
app.get('/api/products/:id', async (c) => {
  const product = await getProduct(c, c.req.param('id'));
  const images = await db(c)
    .select()
    .from(s.images)
    .where(eq(s.images.productId, product.id))
    .orderBy(s.images.sortOrder);
  const [reservation] = await db(c)
    .select({
      ...getTableColumns(s.reservations),
      customerName: s.customers.name,
    })
    .from(s.reservations)
    .innerJoin(s.customers, eq(s.reservations.customerId, s.customers.id))
    .where(eq(s.reservations.productId, product.id));
  return c.json({
    product,
    images,
    reservation: reservation ?? null,
    activities: await activities(c, 'product', product.id),
  });
});
app.patch('/api/products/:id', async (c) => {
  const p = await getProduct(c, c.req.param('id'));
  const raw = await c.req.json();
  const data = provided(productInput.partial().parse(raw), raw);
  if (data.status && data.status !== p.status)
    fail(
      422,
      'Use Reserve, Release reservation, or Mark sold to change status.',
    );
  if (
    p.status === 'SOLD' &&
    ((data.purchaseCost !== undefined &&
      data.purchaseCost !== p.purchaseCost) ||
      (data.sellingPrice !== undefined && data.sellingPrice !== p.sellingPrice))
  )
    fail(422, 'Prices on sold equipment are retained as sale history.');
  if (data.sku === '') fail(422, 'SKU cannot be empty.');
  await db(c).batch([
    db(c)
      .update(s.products)
      .set({ ...data, updatedAt: now() })
      .where(eq(s.products.id, p.id)),
    activity(c, 'product', p.id, 'updated', 'Equipment details updated'),
  ]);
  return c.json(await getProduct(c, p.id));
});
app.delete('/api/products/:id', async (c) => {
  const p = await getProduct(c, c.req.param('id'));
  if (p.status === 'RESERVED')
    fail(409, 'Release the reservation before archiving.');
  const linked = await db(c)
    .select()
    .from(s.leadProducts)
    .innerJoin(s.leads, eq(s.leads.id, s.leadProducts.leadId))
    .where(
      and(
        eq(s.leadProducts.productId, p.id),
        inArray(s.leads.status, ['NEW', 'CONTACTED', 'INTERESTED', 'QUOTED']),
      ),
    );
  if (linked.length)
    fail(409, 'Remove this equipment from active leads before archiving.');
  await db(c).batch([
    db(c)
      .update(s.products)
      .set({ archivedAt: now(), updatedAt: now() })
      .where(eq(s.products.id, p.id)),
    activity(
      c,
      'product',
      p.id,
      'archived',
      'Equipment archived; historical record retained',
    ),
  ]);
  return c.json({ ok: true });
});
app.post('/api/products/:id/reserve', async (c) => {
  const p = await getProduct(c, c.req.param('id'));
  const data = z
    .object({
      customerId: z.string().min(1),
      leadId: z.string().nullable().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      notes: z.string().max(10000).default(''),
    })
    .parse(await c.req.json());
  if (data.expiresAt && data.expiresAt <= now())
    fail(422, 'Reservation expiry must be in the future.');
  await getCustomer(c, data.customerId);
  await db(c).batch([
    db(c)
      .insert(s.reservations)
      .values({ ...data, id: id(), productId: p.id, reservedAt: now() }),
    activity(c, 'product', p.id, 'reserved', 'Equipment reserved for customer'),
  ]);
  return c.json(await getProduct(c, p.id));
});
app.post('/api/products/:id/release-reservation', async (c) => {
  const p = await getProduct(c, c.req.param('id'));
  if (p.status !== 'RESERVED') fail(409, 'Equipment is not reserved.');
  await db(c).batch([
    db(c).delete(s.reservations).where(eq(s.reservations.productId, p.id)),
    activity(c, 'product', p.id, 'released', 'Reservation released'),
  ]);
  return c.json(await getProduct(c, p.id));
});
app.post('/api/products/:id/mark-sold', async (c) => {
  const p = await getProduct(c, c.req.param('id'));
  if (p.status === 'SOLD') return c.json(p);
  await db(c).batch([
    db(c).insert(s.productSales).values({
      productId: p.id,
      soldAt: now(),
      sellingPrice: p.sellingPrice,
      purchaseCost: p.purchaseCost,
    }),
    activity(c, 'product', p.id, 'sold', 'Equipment marked sold'),
  ]);
  return c.json(await getProduct(c, p.id));
});
app.get('/api/customers', async (c) => {
  const q = c.req.query('q')?.slice(0, 200);
  return c.json(
    await db(c)
      .select()
      .from(s.customers)
      .where(
        q
          ? or(
              like(s.customers.name, `%${q}%`),
              like(s.customers.companyName, `%${q}%`),
              like(s.customers.phone, `%${q}%`),
            )
          : undefined,
      )
      .orderBy(s.customers.name)
      .limit(1000),
  );
});
app.post('/api/customers', async (c) => {
  const data = customerInput.parse(await c.req.json());
  const customerId = id();
  await db(c).batch([
    db(c)
      .insert(s.customers)
      .values({ ...data, id: customerId, createdAt: now(), updatedAt: now() }),
    activity(c, 'customer', customerId, 'created', `${data.name} added`),
  ]);
  return c.json(await getCustomer(c, customerId), 201);
});
app.patch('/api/customers/:id', async (c) => {
  const customer = await getCustomer(c, c.req.param('id'));
  const raw = await c.req.json();
  const data = provided(customerInput.partial().parse(raw), raw);
  await db(c).batch([
    db(c)
      .update(s.customers)
      .set({ ...data, updatedAt: now() })
      .where(eq(s.customers.id, customer.id)),
    activity(c, 'customer', customer.id, 'updated', 'Customer details updated'),
  ]);
  return c.json(await getCustomer(c, customer.id));
});
async function leadList(c: Parameters<typeof auth>[0]): Promise<Lead[]> {
  const rows = await db(c)
    .select({ ...getTableColumns(s.leads), customerName: s.customers.name })
    .from(s.leads)
    .innerJoin(s.customers, eq(s.customers.id, s.leads.customerId))
    .orderBy(desc(s.leads.updatedAt));
  const links = await db(c)
    .select({ leadId: s.leadProducts.leadId, product: s.products })
    .from(s.leadProducts)
    .innerJoin(s.products, eq(s.products.id, s.leadProducts.productId));
  return rows.map((l) => ({
    ...l,
    productIds: links.filter((p) => p.leadId === l.id).map((p) => p.product.id),
    products: links.filter((p) => p.leadId === l.id).map((p) => p.product),
  }));
}
app.get('/api/customers/:id', async (c) => {
  const customer = await getCustomer(c, c.req.param('id'));
  return c.json({
    customer,
    leads: (await leadList(c)).filter((l) => l.customerId === customer.id),
    activities: await activities(c, 'customer', customer.id),
  });
});
app.get('/api/leads', async (c) => c.json(await leadList(c)));
async function validateProducts(c: Parameters<typeof auth>[0], ids: string[]) {
  if (new Set(ids).size !== ids.length)
    fail(422, 'Choose each product only once.');
  for (const productId of ids) await getProduct(c, productId);
}
app.post('/api/leads', async (c) => {
  const { productIds, ...data } = leadInput.parse(await c.req.json());
  if (data.status === 'WON')
    fail(422, 'Create the lead first, then choose the items sold.');
  await getCustomer(c, data.customerId);
  await validateProducts(c, productIds);
  const leadId = id();
  const d = db(c);
  await d.batch([
    d
      .insert(s.leads)
      .values({ ...data, id: leadId, createdAt: now(), updatedAt: now() }),
    ...productIds.map((productId) =>
      d.insert(s.leadProducts).values({ leadId, productId }),
    ),
    activity(c, 'lead', leadId, 'created', data.title),
  ]);
  return c.json({ ...(await getLead(c, leadId)), productIds }, 201);
});
app.get('/api/leads/:id', async (c) => {
  const lead = await getLead(c, c.req.param('id'));
  const linked = await db(c)
    .select({ product: s.products })
    .from(s.leadProducts)
    .innerJoin(s.products, eq(s.products.id, s.leadProducts.productId))
    .where(eq(s.leadProducts.leadId, lead.id));
  return c.json({
    lead: { ...lead, productIds: linked.map((p) => p.product.id) },
    customer: await getCustomer(c, lead.customerId),
    products: linked.map((p) => p.product),
    activities: await activities(c, 'lead', lead.id),
  });
});
app.patch('/api/leads/:id', async (c) => {
  const lead = await getLead(c, c.req.param('id'));
  const raw = await c.req.json();
  const { productIds, ...data } = provided(leadInput.partial().parse(raw), raw);
  if (data.status === 'WON' && lead.status !== 'WON')
    fail(422, 'Use the win action to select sold equipment.');
  if (lead.status === 'WON' && data.status && data.status !== 'WON')
    fail(409, 'Won deals cannot be reopened; inventory has already been sold.');
  if (data.status === lead.status) delete data.status;
  if (data.customerId && data.customerId !== lead.customerId)
    fail(422, 'Create a new lead to change the customer.');
  if (productIds) {
    await validateProducts(c, productIds);
    const reserved = await db(c)
      .select()
      .from(s.reservations)
      .where(eq(s.reservations.leadId, lead.id));
    if (reserved.some((r) => !productIds.includes(r.productId)))
      fail(409, 'Release reservations before removing their equipment.');
  }
  const d = db(c);
  await d.batch([
    d
      .update(s.leads)
      .set({ ...data, updatedAt: now() })
      .where(eq(s.leads.id, lead.id)),
    ...(productIds
      ? [
          d.delete(s.leadProducts).where(eq(s.leadProducts.leadId, lead.id)),
          ...productIds.map((productId) =>
            d.insert(s.leadProducts).values({ leadId: lead.id, productId }),
          ),
        ]
      : []),
    activity(
      c,
      'lead',
      lead.id,
      data.nextFollowUpAt !== undefined
        ? 'followup_changed'
        : data.status
          ? 'status_changed'
          : 'updated',
      data.status ? `Lead moved to ${data.status}` : 'Lead details updated',
    ),
  ]);
  return c.json(await getLead(c, lead.id));
});
app.post('/api/leads/:id/win', async (c) => {
  const lead = await getLead(c, c.req.param('id'));
  if (lead.status === 'WON') fail(409, 'This lead is already won.');
  const { productIds } = z
    .object({ productIds: z.array(z.string()).max(100) })
    .parse(await c.req.json());
  await validateProducts(c, productIds);
  const linked = await db(c)
    .select()
    .from(s.leadProducts)
    .where(eq(s.leadProducts.leadId, lead.id));
  if (productIds.some((v) => !linked.some((p) => p.productId === v)))
    fail(422, 'Only select products attached to this lead.');
  const d = db(c);
  const selected = await Promise.all(
    productIds.map((productId) => getProduct(c, productId)),
  );
  await d.batch([
    activity(
      c,
      'lead',
      lead.id,
      'win_started',
      'Selected equipment sale recorded',
    ),
    ...selected.map((p) =>
      d.insert(s.productSales).values({
        productId: p.id,
        leadId: lead.id,
        customerId: lead.customerId,
        soldAt: now(),
        sellingPrice: p.sellingPrice,
        purchaseCost: p.purchaseCost,
      }),
    ),
    d
      .update(s.leads)
      .set({ status: 'WON', nextFollowUpAt: null, updatedAt: now() })
      .where(eq(s.leads.id, lead.id)),
    ...productIds.map((productId) =>
      activity(c, 'product', productId, 'sold', `Sold through ${lead.title}`),
    ),
    activity(
      c,
      'lead',
      lead.id,
      'status_changed',
      `Lead won; ${productIds.length} selected product(s) sold`,
    ),
  ]);
  return c.json(await getLead(c, lead.id));
});
const day = (value: string, tz: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
app.get('/api/followups', async (c) => {
  const today = day(now(), c.env.BUSINESS_TIMEZONE);
  const rows = (await leadList(c))
    .filter((l) => l.nextFollowUpAt && !['WON', 'LOST'].includes(l.status))
    .sort((a, b) => a.nextFollowUpAt!.localeCompare(b.nextFollowUpAt!));
  return c.json({
    overdue: rows.filter(
      (l) => day(l.nextFollowUpAt!, c.env.BUSINESS_TIMEZONE) < today,
    ),
    today: rows.filter(
      (l) => day(l.nextFollowUpAt!, c.env.BUSINESS_TIMEZONE) === today,
    ),
    upcoming: rows.filter(
      (l) => day(l.nextFollowUpAt!, c.env.BUSINESS_TIMEZONE) > today,
    ),
  });
});
app.get('/api/dashboard', async (c) => {
  const all = await db(c).select().from(s.products);
  const products = all.filter((p) => !p.archivedAt);
  const leads = await leadList(c);
  const active = leads.filter((l) => !['WON', 'LOST'].includes(l.status));
  const today = day(now(), c.env.BUSINESS_TIMEZONE);
  const sales = all.filter((p) => p.status === 'SOLD' && p.soldAt);
  const followups = active
    .filter((l) => l.nextFollowUpAt)
    .sort((a, b) => a.nextFollowUpAt!.localeCompare(b.nextFollowUpAt!));
  return c.json({
    available: products.filter((p) => p.status === 'AVAILABLE').length,
    reserved: products.filter((p) => p.status === 'RESERVED').length,
    soldThisMonth: sales.filter(
      (p) =>
        day(p.soldAt!, c.env.BUSINESS_TIMEZONE).slice(0, 7) ===
        today.slice(0, 7),
    ).length,
    inventoryCostValue:
      Math.round(
        products
          .filter((p) => p.status !== 'SOLD')
          .reduce((sum, p) => sum + p.purchaseCost, 0) * 100,
      ) / 100,
    activeLeads: active.length,
    dueToday: followups.filter(
      (l) => day(l.nextFollowUpAt!, c.env.BUSINESS_TIMEZONE) === today,
    ).length,
    overdue: followups.filter(
      (l) => day(l.nextFollowUpAt!, c.env.BUSINESS_TIMEZONE) < today,
    ).length,
    recentProducts: products
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5),
    followups: followups.slice(0, 6),
    recentSales: sales
      .sort((a, b) => b.soldAt!.localeCompare(a.soldAt!))
      .slice(0, 5),
  });
});
app.post('/api/products/:id/generate-description', async (c) => {
  const product = await getProduct(c, c.req.param('id'));
  const { target } = generateInput.parse(await c.req.json());
  try {
    const output = await createDescriptionProvider(c.env).generate(
      product as Product,
    );
    await activity(
      c,
      'product',
      product.id,
      'ai_generated',
      'AI draft generated for review; not saved',
    );
    return c.json(target === 'all' ? output : { [target]: output[target] });
  } catch (error) {
    const unconfigured =
      error instanceof Error && error.message === 'AI_NOT_CONFIGURED';
    return c.json(
      {
        error: {
          code: unconfigured ? 'AI_NOT_CONFIGURED' : 'AI_FAILED',
          message: unconfigured
            ? 'Configure AI_API_KEY, AI_MODEL and AI_BASE_URL on the Worker.'
            : 'AI could not produce valid text. Please retry; existing descriptions are unchanged.',
        },
      },
      unconfigured ? 503 : 502,
    );
  }
});
function imageMime(bytes: Uint8Array) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return 'image/png';
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}
app.post('/api/products/:id/images', async (c) => {
  const p = await getProduct(c, c.req.param('id'));
  const form = await c.req.formData();
  const files = form.getAll('files');
  if (!files.length || files.length > 5)
    fail(422, 'Upload between one and five images at a time.');
  const validated: { file: File; bytes: ArrayBuffer }[] = [];
  for (const f of files) {
    if (typeof f === 'string') fail(422, 'Choose image files.');
    const file = f as File;
    if (
      file.size === 0 ||
      file.size > Number(c.env.MAX_UPLOAD_MB) * 1024 * 1024
    )
      fail(422, `Each photo must be under ${c.env.MAX_UPLOAD_MB} MB.`);
    const bytes = await file.arrayBuffer();
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      imageMime(new Uint8Array(bytes)) !== file.type
    )
      fail(422, 'Only valid JPEG, PNG, and WEBP images are supported.');
    validated.push({ file, bytes });
  }
  const old = await db(c)
    .select()
    .from(s.images)
    .where(eq(s.images.productId, p.id));
  if (old.length + files.length > 30)
    fail(422, 'Maximum 30 photos per product.');
  const uploaded: string[] = [];
  try {
    const records = [];
    for (const [i, { file, bytes }] of validated.entries()) {
      const imageId = id(),
        key = `products/${p.id}/${imageId}`;
      await c.env.PRODUCT_IMAGES.put(key, bytes, {
        httpMetadata: { contentType: file.type },
      });
      uploaded.push(key);
      records.push({
        id: imageId,
        productId: p.id,
        r2Key: key,
        fileName: file.name.slice(0, 250),
        mimeType: file.type,
        fileSize: file.size,
        sortOrder: Math.max(-1, ...old.map((v) => v.sortOrder)) + 1 + i,
        isPrimary: old.length === 0 && i === 0,
        createdAt: now(),
      });
    }
    await db(c).batch([
      db(c).insert(s.images).values(records),
      activity(
        c,
        'product',
        p.id,
        'images_uploaded',
        `${records.length} photo(s) uploaded`,
      ),
    ]);
    return c.json(records, 201);
  } catch (e) {
    await Promise.all(uploaded.map((key) => c.env.PRODUCT_IMAGES.delete(key)));
    throw e;
  }
});
app.get('/api/images/:id', async (c) => {
  const [img] = await db(c)
    .select()
    .from(s.images)
    .where(eq(s.images.id, c.req.param('id')));
  if (!img) fail(404, 'Photo not found.');
  const object = await c.env.PRODUCT_IMAGES.get(img.r2Key);
  if (!object) fail(404, 'Photo not found in storage.');
  c.header('Content-Type', img.mimeType);
  c.header('Content-Disposition', 'inline');
  return c.body(object!.body);
});
app.patch('/api/products/:id/images', async (c) => {
  const p = await getProduct(c, c.req.param('id'));
  const { imageIds, primaryId } = z
    .object({ imageIds: z.array(z.string()).max(30), primaryId: z.string() })
    .parse(await c.req.json());
  const old = await db(c)
    .select()
    .from(s.images)
    .where(eq(s.images.productId, p.id));
  if (
    imageIds.length !== old.length ||
    new Set(imageIds).size !== old.length ||
    !imageIds.includes(primaryId) ||
    imageIds.some((v) => !old.some((i) => i.id === v))
  )
    fail(422, 'Provide each product photo exactly once.');
  await db(c).batch([
    db(c)
      .update(s.images)
      .set({ isPrimary: false })
      .where(eq(s.images.productId, p.id)),
    ...imageIds.map((imageId, i) =>
      db(c)
        .update(s.images)
        .set({ sortOrder: i, isPrimary: imageId === primaryId })
        .where(and(eq(s.images.id, imageId), eq(s.images.productId, p.id))),
    ),
  ]);
  return c.json({ ok: true });
});
app.delete('/api/products/:id/images/:imageId', async (c) => {
  const p = await getProduct(c, c.req.param('id'));
  const rows = await db(c)
    .select()
    .from(s.images)
    .where(eq(s.images.productId, p.id))
    .orderBy(s.images.sortOrder);
  const img = rows.find((v) => v.id === c.req.param('imageId'));
  if (!img) fail(404, 'Photo not found.');
  const next = rows.find((v) => v.id !== img!.id);
  await db(c).batch([
    db(c).delete(s.images).where(eq(s.images.id, img!.id)),
    ...(img!.isPrimary && next
      ? [
          db(c)
            .update(s.images)
            .set({ isPrimary: true })
            .where(eq(s.images.id, next.id)),
        ]
      : []),
    activity(c, 'product', p.id, 'image_deleted', 'Photo deleted'),
  ]);
  await c.env.PRODUCT_IMAGES.delete(img!.r2Key);
  return c.json({ ok: true });
});
app.all('/api/*', (c) =>
  c.json(
    { error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } },
    404,
  ),
);
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));
export default app;
