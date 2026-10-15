import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Bindings, AppEnv } from './auth';
import {
  quotationInput,
  quotationSettingsInput,
  quotationStatuses,
  type Quotation,
  type QuotationCustomerSnapshot,
  type QuotationInput,
  type QuotationItem,
  type QuotationSettingsInput,
  type QuotationStatus,
} from '../shared/quotations';
import {
  calculateQuotationTotals,
  fromMinor,
  toMinor,
} from '../shared/quotation-money';

function fail(status: 400 | 404 | 409 | 422, message: string): never {
  throw new HTTPException(status, { message });
}
const id = () => crypto.randomUUID();
const timestamp = () => new Date().toISOString();
const authEmail = (c: { get: (key: 'email') => string }) => c.get('email');
type CompanyRow = {
  company_name_th: string;
  company_name_en: string;
  address: string;
  phone: string;
  email: string;
  tax_id: string;
  line_url: string;
  facebook_url: string;
  logo_key: string;
  bank_details: string;
  payment_terms: string;
  delivery_terms: string;
  warranty_terms: string;
  default_vat_rate_bps: number;
};
type QuoteRow = {
  id: string;
  quotation_number: string;
  customer_id: string;
  lead_id: string | null;
  status: QuotationStatus;
  issue_date: string;
  valid_until: string;
  currency: 'THB' | 'USD';
  customer_snapshot: string;
  company_snapshot: string;
  sales_contact_email: string;
  sales_contact_name: string;
  subtotal_minor: number;
  discount_minor: number;
  delivery_fee_minor: number;
  installation_fee_minor: number;
  other_charges_minor: number;
  vat_enabled: number;
  vat_rate_bps: number;
  tax_mode: 'EXCLUSIVE' | 'INCLUSIVE';
  vat_minor: number;
  grand_total_minor: number;
  payment_terms: string;
  delivery_terms: string;
  warranty_terms: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type ItemRow = {
  id: string;
  quotation_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  brand_snapshot: string;
  model_snapshot: string;
  sku_snapshot: string;
  description_snapshot: string;
  condition_snapshot: string;
  image_key_snapshot: string;
  image_mime_snapshot: string;
  image_id_snapshot: string;
  quantity: number;
  unit_price_minor: number;
  discount_minor: number;
  line_total_minor: number;
  sort_order: number;
  product_status?: string | null;
};
type CustomerRow = {
  id: string;
  name: string;
  company_name: string;
  contact_name: string;
  phone: string;
  email: string;
  billing_address: string;
};
type ProductRow = {
  id: string;
  sku: string;
  brand: string;
  model: string;
  category: string;
  condition: string;
  selling_price: number;
  status: string;
  short_description: string;
  description_th: string;
  description_en: string;
  primary_image_id: string | null;
};
type ProductImageRow = {
  id: string;
  r2_key: string;
  mime_type: string;
};
type StoredCompanySnapshot = QuotationSettingsInput & { logoKey: string };

const defaultCompany = (): QuotationSettingsInput => ({
  companyNameTh: '',
  companyNameEn: '',
  address: '',
  phone: '',
  email: '',
  taxId: '',
  lineUrl: '',
  facebookUrl: '',
  bankDetails: '',
  paymentTerms: '',
  deliveryTerms: '',
  warrantyTerms: '',
  defaultVatRate: 7,
});
async function companyRow(database: D1Database) {
  return database
    .prepare("SELECT * FROM quotation_settings WHERE id='default'")
    .first<CompanyRow>();
}
function companyInput(row: CompanyRow | null): QuotationSettingsInput {
  return row
    ? {
        companyNameTh: row.company_name_th,
        companyNameEn: row.company_name_en,
        address: row.address,
        phone: row.phone,
        email: row.email,
        taxId: row.tax_id,
        lineUrl: row.line_url,
        facebookUrl: row.facebook_url,
        bankDetails: row.bank_details,
        paymentTerms: row.payment_terms,
        deliveryTerms: row.delivery_terms,
        warrantyTerms: row.warranty_terms,
        defaultVatRate: row.default_vat_rate_bps / 100,
      }
    : defaultCompany();
}
function parse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
function todayBangkok() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function effectiveStatus(row: Pick<QuoteRow, 'status' | 'valid_until'>) {
  return row.status === 'SENT' && row.valid_until < todayBangkok()
    ? 'EXPIRED'
    : row.status;
}
function toItem(row: ItemRow): QuotationItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name_snapshot,
    brand: row.brand_snapshot,
    model: row.model_snapshot,
    sku: row.sku_snapshot,
    description: row.description_snapshot,
    condition: row.condition_snapshot,
    imageAvailable: !!row.image_key_snapshot,
    imageId: row.image_id_snapshot,
    quantity: row.quantity,
    unitPrice: fromMinor(row.unit_price_minor),
    discount: fromMinor(row.discount_minor),
    lineTotal: fromMinor(row.line_total_minor),
    sortOrder: row.sort_order,
    productStatus: row.product_status ?? null,
  };
}
function toQuote(row: QuoteRow, items: ItemRow[], history: Quotation['history']): Quotation {
  const storedCompany = parse<StoredCompanySnapshot>(row.company_snapshot, {
    ...defaultCompany(),
    logoKey: '',
  });
  const { logoKey, ...company } = storedCompany;
  return {
    id: row.id,
    quotationNumber: row.quotation_number,
    customerId: row.customer_id,
    leadId: row.lead_id,
    status: effectiveStatus(row),
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    currency: row.currency,
    customer: parse<QuotationCustomerSnapshot>(row.customer_snapshot, {
      name: '',
      companyName: '',
      contactName: '',
      phone: '',
      email: '',
      billingAddress: '',
    }),
    company: { ...company, logoAvailable: !!logoKey },
    salesContactEmail: row.sales_contact_email,
    salesContactName: row.sales_contact_name,
    items: items.map(toItem),
    subtotal: fromMinor(row.subtotal_minor),
    discount: fromMinor(row.discount_minor),
    deliveryFee: fromMinor(row.delivery_fee_minor),
    installationFee: fromMinor(row.installation_fee_minor),
    otherCharges: fromMinor(row.other_charges_minor),
    vatEnabled: !!row.vat_enabled,
    vatRate: row.vat_rate_bps / 100,
    taxMode: row.tax_mode,
    vatAmount: fromMinor(row.vat_minor),
    grandTotal: fromMinor(row.grand_total_minor),
    beforeTax: fromMinor(
      row.subtotal_minor -
        row.discount_minor +
        row.delivery_fee_minor +
        row.installation_fee_minor +
        row.other_charges_minor,
    ),
    paymentTerms: row.payment_terms,
    deliveryTerms: row.delivery_terms,
    warrantyTerms: row.warranty_terms,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history,
  };
}
async function getQuote(database: D1Database, quoteId: string) {
  const row = await database
    .prepare('SELECT * FROM quotations WHERE id=?')
    .bind(quoteId)
    .first<QuoteRow>();
  if (!row) fail(404, 'Quotation not found.');
  const [items, history] = await Promise.all([
    database
      .prepare(
        'SELECT i.*,p.status AS product_status FROM quotation_items i LEFT JOIN products p ON p.id=i.product_id WHERE i.quotation_id=? ORDER BY i.sort_order,i.rowid',
      )
      .bind(quoteId)
      .all<ItemRow>(),
    database
      .prepare(
        'SELECT id,from_status AS fromStatus,to_status AS toStatus,changed_by AS changedBy,created_at AS createdAt FROM quotation_status_history WHERE quotation_id=? ORDER BY created_at,id',
      )
      .bind(quoteId)
      .all<Quotation['history'][number]>(),
  ]);
  return { row, items: items.results, quote: toQuote(row, items.results, history.results) };
}
async function getCustomer(database: D1Database, customerId: string) {
  const customer = await database
    .prepare(
      'SELECT id,name,company_name,contact_name,phone,email,billing_address FROM customers WHERE id=?',
    )
    .bind(customerId)
    .first<CustomerRow>();
  if (!customer) fail(404, 'Customer not found.');
  return customer;
}
function customerSnapshot(customer: CustomerRow): QuotationCustomerSnapshot {
  return {
    name: customer.name,
    companyName: customer.company_name,
    contactName: customer.contact_name,
    phone: customer.phone,
    email: customer.email,
    billingAddress: customer.billing_address,
  };
}
function itemStatement(
  database: D1Database,
  quoteId: string,
  item: ItemRow,
) {
  return database
    .prepare(
      'INSERT INTO quotation_items(id,quotation_id,product_id,product_name_snapshot,brand_snapshot,model_snapshot,sku_snapshot,description_snapshot,condition_snapshot,image_key_snapshot,image_mime_snapshot,image_id_snapshot,quantity,unit_price_minor,discount_minor,line_total_minor,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      item.id,
      quoteId,
      item.product_id,
      item.product_name_snapshot,
      item.brand_snapshot,
      item.model_snapshot,
      item.sku_snapshot,
      item.description_snapshot,
      item.condition_snapshot,
      item.image_key_snapshot,
      item.image_mime_snapshot,
      item.image_id_snapshot,
      item.quantity,
      item.unit_price_minor,
      item.discount_minor,
      item.line_total_minor,
      item.sort_order,
    );
}
async function reserveNumber(database: D1Database, year: number) {
  const row = await database
    .prepare(
      'INSERT INTO quotation_number_sequences(year,last_number) VALUES(?,1) ON CONFLICT(year) DO UPDATE SET last_number=last_number+1 RETURNING last_number',
    )
    .bind(year)
    .first<{ last_number: number }>();
  if (!row) throw new Error('Could not reserve a quotation number.');
  return `QT-${year}-${String(row.last_number).padStart(4, '0')}`;
}
async function copyObject(
  bucket: R2Bucket,
  from: string,
  to: string,
  contentType?: string,
) {
  if (!from) return false;
  const object = await bucket.get(from);
  if (!object) return false;
  await bucket.put(to, object.body, {
    httpMetadata: { contentType: contentType ?? object.httpMetadata?.contentType },
  });
  return true;
}
async function resolveItems(
  env: Bindings,
  database: D1Database,
  quoteId: string,
  inputs: QuotationInput['items'],
) {
  const uploads: string[] = [];
  const resolved: ItemRow[] = [];
  try {
    const lines = inputs.map((item) => ({
      quantity: item.quantity,
      unitPriceMinor: toMinor(item.unitPrice),
      discountMinor: toMinor(item.discount),
    }));
    const totals = calculateQuotationTotals({
      lines,
      discountMinor: 0,
      deliveryFeeMinor: 0,
      installationFeeMinor: 0,
      otherChargesMinor: 0,
      vatEnabled: false,
      vatRateBps: 0,
      taxMode: 'EXCLUSIVE',
    });
    for (let index = 0; index < inputs.length; index += 1) {
      const item = inputs[index];
      const product = await database
        .prepare(
          "SELECT id,sku,brand,model,category,condition,selling_price,status,short_description,description_th,description_en,(SELECT id FROM product_images WHERE product_id=products.id ORDER BY is_primary DESC,sort_order LIMIT 1) AS primary_image_id FROM products WHERE id=? AND archived_at IS NULL",
        )
        .bind(item.productId)
        .first<ProductRow>();
      if (!product) fail(404, 'A selected product is no longer available.');
      const selectedImageId = item.imageId || product.primary_image_id || '';
      let image: ProductImageRow | null = null;
      if (selectedImageId) {
        image = await database
          .prepare(
            'SELECT id,r2_key,mime_type FROM product_images WHERE id=? AND product_id=?',
          )
          .bind(selectedImageId, product.id)
          .first<ProductImageRow>();
        if (!image) fail(422, 'Choose a photo from the selected product.');
      }
      const itemId = id();
      const snapshotKey = image
        ? `quotations/${quoteId}/items/${itemId}`
        : '';
      if (image && (await copyObject(env.PRODUCT_IMAGES, image.r2_key, snapshotKey, image.mime_type)))
        uploads.push(snapshotKey);
      const name = item.displayName.trim() || `${product.brand} ${product.model}`;
      resolved.push({
        id: itemId,
        quotation_id: quoteId,
        product_id: product.id,
        product_name_snapshot: name,
        brand_snapshot: product.brand,
        model_snapshot: product.model,
        sku_snapshot: product.sku,
        description_snapshot:
          item.description ||
          product.short_description ||
          product.description_th ||
          product.description_en,
        condition_snapshot: product.condition,
        image_key_snapshot: uploads.includes(snapshotKey) ? snapshotKey : '',
        image_mime_snapshot: uploads.includes(snapshotKey) ? image?.mime_type ?? '' : '',
        image_id_snapshot: selectedImageId,
        quantity: item.quantity,
        unit_price_minor: lines[index].unitPriceMinor,
        discount_minor: lines[index].discountMinor,
        line_total_minor: totals.lineTotalsMinor[index],
        sort_order: index,
        product_status: product.status,
      });
    }
    return { items: resolved, uploads };
  } catch (error) {
    await Promise.all(uploads.map((key) => env.PRODUCT_IMAGES.delete(key)));
    throw error;
  }
}
function totalsFor(input: QuotationInput) {
  const lines = input.items.map((item) => ({
    quantity: item.quantity,
    unitPriceMinor: toMinor(item.unitPrice),
    discountMinor: toMinor(item.discount),
  }));
  try {
    return calculateQuotationTotals({
      lines,
      discountMinor: toMinor(input.discount),
      deliveryFeeMinor: toMinor(input.deliveryFee),
      installationFeeMinor: toMinor(input.installationFee),
      otherChargesMinor: toMinor(input.otherCharges),
      vatEnabled: input.vatEnabled,
      vatRateBps: Math.round(input.vatRate * 100),
      taxMode: input.taxMode,
    });
  } catch (error) {
    fail(422, error instanceof Error ? error.message : 'Invalid quotation totals.');
  }
}
function quoteWriteStatement(
  database: D1Database,
  args: {
    id: string;
    number: string;
    input: QuotationInput;
    customer: QuotationCustomerSnapshot;
    company: StoredCompanySnapshot;
    contactEmail: string;
    contactName: string;
    totals: ReturnType<typeof totalsFor>;
    userEmail: string;
    createdAt: string;
  },
) {
  const { input, totals } = args;
  return database
    .prepare(
      'INSERT INTO quotations(id,quotation_number,customer_id,lead_id,status,issue_date,valid_until,currency,customer_snapshot,company_snapshot,sales_contact_email,sales_contact_name,subtotal_minor,discount_minor,delivery_fee_minor,installation_fee_minor,other_charges_minor,vat_enabled,vat_rate_bps,tax_mode,vat_minor,grand_total_minor,payment_terms,delivery_terms,warranty_terms,notes,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      args.id,
      args.number,
      input.customerId,
      input.leadId,
      'DRAFT',
      input.issueDate,
      input.validUntil,
      input.currency,
      JSON.stringify(args.customer),
      JSON.stringify(args.company),
      args.contactEmail,
      args.contactName,
      totals.subtotalMinor,
      toMinor(input.discount),
      toMinor(input.deliveryFee),
      toMinor(input.installationFee),
      toMinor(input.otherCharges),
      input.vatEnabled ? 1 : 0,
      Math.round(input.vatRate * 100),
      input.taxMode,
      totals.vatMinor,
      totals.grandTotalMinor,
      input.paymentTerms,
      input.deliveryTerms,
      input.warrantyTerms,
      input.notes,
      args.userEmail,
      args.createdAt,
      args.createdAt,
    );
}
async function salespersonName(database: D1Database, email: string) {
  const row = await database
    .prepare(
      "SELECT trim(first_name || ' ' || last_name) AS name FROM salespeople WHERE email=?",
    )
    .bind(email)
    .first<{ name: string }>();
  return row?.name || email;
}

export const quotationRoutes = new Hono<AppEnv>();
export const quotationSettingsRoutes = new Hono<AppEnv>();

quotationSettingsRoutes.get('/', async (c) => {
  const row = await companyRow(c.env.DB);
  return c.json({ ...companyInput(row), hasLogo: !!row?.logo_key });
});
quotationSettingsRoutes.patch('/', async (c) => {
  const values = quotationSettingsInput.parse(await c.req.json());
  const dbNow = timestamp();
  await c.env.DB.prepare(
    'UPDATE quotation_settings SET company_name_th=?,company_name_en=?,address=?,phone=?,email=?,tax_id=?,line_url=?,facebook_url=?,bank_details=?,payment_terms=?,delivery_terms=?,warranty_terms=?,default_vat_rate_bps=?,updated_at=? WHERE id=\'default\'',
  )
    .bind(
      values.companyNameTh,
      values.companyNameEn,
      values.address,
      values.phone,
      values.email,
      values.taxId,
      values.lineUrl,
      values.facebookUrl,
      values.bankDetails,
      values.paymentTerms,
      values.deliveryTerms,
      values.warrantyTerms,
      Math.round(values.defaultVatRate * 100),
      dbNow,
    )
    .run();
  return c.json({ ...values, hasLogo: !!(await companyRow(c.env.DB))?.logo_key });
});
quotationSettingsRoutes.post('/logo', async (c) => {
  const form = await c.req.formData();
  const value = form.get('file');
  if (!value || typeof value === 'string') fail(422, 'Choose a logo image.');
  const file = value as File;
  if (file.size > 2 * 1024 * 1024) fail(422, 'Logo must be 2 MB or smaller.');
  const mime = file.type.toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime))
    fail(422, 'Logo must be JPEG, PNG, or WebP.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const valid =
    (mime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (mime === 'image/png' && bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10') ||
    (mime === 'image/webp' && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP');
  if (!valid) fail(422, 'The uploaded file is not a valid image.');
  const key = `quotation-company/${id()}`;
  await c.env.PRODUCT_IMAGES.put(key, bytes, {
    httpMetadata: { contentType: mime },
  });
  const previous = await companyRow(c.env.DB);
  try {
    await c.env.DB.prepare(
      "UPDATE quotation_settings SET logo_key=?,updated_at=? WHERE id='default'",
    )
      .bind(key, timestamp())
      .run();
  } catch (error) {
    await c.env.PRODUCT_IMAGES.delete(key);
    throw error;
  }
  if (previous?.logo_key) await c.env.PRODUCT_IMAGES.delete(previous.logo_key);
  return c.json({ hasLogo: true });
});
quotationSettingsRoutes.get('/logo', async (c) => {
  const row = await companyRow(c.env.DB);
  if (!row?.logo_key) fail(404, 'Company logo not found.');
  const object = await c.env.PRODUCT_IMAGES.get(row.logo_key);
  if (!object) fail(404, 'Company logo not found.');
  c.header('Content-Type', object.httpMetadata?.contentType ?? 'image/png');
  c.header('Content-Disposition', 'inline');
  return c.body(object.body);
});

quotationRoutes.get('/products', async (c) => {
  const q = c.req.query('q')?.trim().slice(0, 150);
  const rows = await c.env.DB.prepare(
    `SELECT id,sku,brand,model,category,condition,selling_price AS sellingPrice,status,short_description AS shortDescription,description_th AS descriptionTh,description_en AS descriptionEn,(SELECT id FROM product_images WHERE product_id=products.id ORDER BY is_primary DESC,sort_order LIMIT 1) AS primaryImageId FROM products WHERE archived_at IS NULL${q ? ' AND (sku LIKE ? OR brand LIKE ? OR model LIKE ? OR category LIKE ?)' : ''} ORDER BY created_at DESC LIMIT 80`,
  )
    .bind(...(q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : []))
    .all();
  return c.json(rows.results);
});
quotationRoutes.get('/customers', async (c) => {
  const q = c.req.query('q')?.trim().slice(0, 150);
  const rows = await c.env.DB.prepare(
    `SELECT id,name,company_name AS companyName,contact_name AS contactName,phone,email,billing_address AS billingAddress FROM customers${q ? ' WHERE name LIKE ? OR company_name LIKE ? OR phone LIKE ? OR email LIKE ?' : ''} ORDER BY name LIMIT 100`,
  )
    .bind(...(q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : []))
    .all();
  return c.json(rows.results);
});
quotationRoutes.get('/', async (c) => {
  const q = c.req.query('q')?.trim().slice(0, 150);
  const status = c.req.query('status');
  const sort = c.req.query('sort') === 'oldest' ? 'ASC' : 'DESC';
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q) {
    where.push('(q.quotation_number LIKE ? OR q.customer_snapshot LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (status && quotationStatuses.includes(status as QuotationStatus)) {
    if (status === 'EXPIRED') {
      where.push("(q.status='EXPIRED' OR (q.status='SENT' AND q.valid_until<?))");
      params.push(todayBangkok());
    } else {
      where.push('q.status=?');
      params.push(status);
    }
  }
  const rows = await c.env.DB.prepare(
    `SELECT q.* FROM quotations q${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY q.issue_date ${sort},q.created_at ${sort} LIMIT 500`,
  )
    .bind(...params)
    .all<QuoteRow>();
  return c.json(
    rows.results.map((row) => ({
      id: row.id,
      quotationNumber: row.quotation_number,
      customerId: row.customer_id,
      customer: parse<QuotationCustomerSnapshot>(row.customer_snapshot, {
        name: '', companyName: '', contactName: '', phone: '', email: '', billingAddress: '',
      }),
      issueDate: row.issue_date,
      validUntil: row.valid_until,
      total: fromMinor(row.grand_total_minor),
      currency: row.currency,
      status: effectiveStatus(row),
      createdAt: row.created_at,
    })),
  );
});
quotationRoutes.post('/', async (c) => {
  const input = quotationInput.parse(await c.req.json());
  const database = c.env.DB;
  const totals = totalsFor(input);
  const customer = customerSnapshot(await getCustomer(database, input.customerId));
  if (input.leadId) {
    const lead = await database
      .prepare('SELECT customer_id FROM leads WHERE id=?')
      .bind(input.leadId)
      .first<{ customer_id: string }>();
    if (!lead || lead.customer_id !== input.customerId)
      fail(422, 'Choose a lead belonging to the selected customer.');
  }
  const profile = await companyRow(database);
  const company: StoredCompanySnapshot = {
    ...companyInput(profile),
    logoKey: profile?.logo_key ?? '',
  };
  const email = authEmail(c);
  const contactName = await salespersonName(database, email);
  const quoteId = id();
  const number = await reserveNumber(database, Number(input.issueDate.slice(0, 4)));
  const createdAt = timestamp();
  const { items, uploads } = await resolveItems(c.env, database, quoteId, input.items);
  const logoCopy = company.logoKey
    ? `quotations/${quoteId}/company-logo`
    : '';
  try {
    if (logoCopy && (await copyObject(c.env.PRODUCT_IMAGES, company.logoKey, logoCopy)))
      uploads.push(logoCopy);
    const storedCompany = { ...company, logoKey: uploads.includes(logoCopy) ? logoCopy : '' };
    const statements = [
      quoteWriteStatement(database, {
        id: quoteId,
        number,
        input,
        customer,
        company: storedCompany,
        contactEmail: email,
        contactName,
        totals,
        userEmail: email,
        createdAt,
      }),
      ...items.map((item) => itemStatement(database, quoteId, item)),
      database
        .prepare(
          "INSERT INTO quotation_status_history(id,quotation_id,from_status,to_status,changed_by,created_at) VALUES(?,?,NULL,'DRAFT',?,?)",
        )
        .bind(id(), quoteId, email, createdAt),
      database
        .prepare(
          'INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(id(), 'quotation', quoteId, 'created', `Quotation ${number} created`, email, createdAt),
    ];
    await database.batch(statements);
  } catch (error) {
    await Promise.all(uploads.map((key) => c.env.PRODUCT_IMAGES.delete(key)));
    throw error;
  }
  return c.json((await getQuote(database, quoteId)).quote, 201);
});
quotationRoutes.get('/:id/items/:itemId/image', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT image_key_snapshot,image_mime_snapshot FROM quotation_items WHERE quotation_id=? AND id=?',
  )
    .bind(c.req.param('id'), c.req.param('itemId'))
    .first<{ image_key_snapshot: string; image_mime_snapshot: string }>();
  if (!row?.image_key_snapshot) fail(404, 'Quotation photo not found.');
  const object = await c.env.PRODUCT_IMAGES.get(row.image_key_snapshot);
  if (!object) fail(404, 'Quotation photo is unavailable.');
  c.header('Content-Type', row.image_mime_snapshot || 'application/octet-stream');
  c.header('Content-Disposition', 'inline');
  return c.body(object.body);
});
quotationRoutes.get('/:id/company-logo', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT company_snapshot FROM quotations WHERE id=?',
  )
    .bind(c.req.param('id'))
    .first<{ company_snapshot: string }>();
  if (!row) fail(404, 'Quotation not found.');
  const snapshot = parse<StoredCompanySnapshot>(row.company_snapshot, {
    ...defaultCompany(), logoKey: '',
  });
  if (!snapshot.logoKey) fail(404, 'Quotation logo not found.');
  const object = await c.env.PRODUCT_IMAGES.get(snapshot.logoKey);
  if (!object) fail(404, 'Quotation logo is unavailable.');
  c.header('Content-Type', object.httpMetadata?.contentType ?? 'image/png');
  c.header('Content-Disposition', 'inline');
  return c.body(object.body);
});
quotationRoutes.get('/:id', async (c) => {
  return c.json((await getQuote(c.env.DB, c.req.param('id'))).quote);
});
quotationRoutes.patch('/:id', async (c) => {
  const input = quotationInput.parse(await c.req.json());
  const database = c.env.DB;
  const quoteId = c.req.param('id');
  const { row: current } = await getQuote(database, quoteId);
  if (current.status !== 'DRAFT') fail(409, 'Only draft quotations can be edited.');
  const customer = customerSnapshot(await getCustomer(database, input.customerId));
  if (input.leadId) {
    const lead = await database
      .prepare('SELECT customer_id FROM leads WHERE id=?')
      .bind(input.leadId)
      .first<{ customer_id: string }>();
    if (!lead || lead.customer_id !== input.customerId)
      fail(422, 'Choose a lead belonging to the selected customer.');
  }
  const totals = totalsFor(input);
  const { items, uploads } = await resolveItems(c.env, database, quoteId, input.items);
  const oldKeys = (await database
    .prepare('SELECT image_key_snapshot AS key FROM quotation_items WHERE quotation_id=?')
    .bind(quoteId)
    .all<{ key: string }>()).results.map((v) => v.key).filter(Boolean);
  const email = authEmail(c);
  const now = timestamp();
  const statements = [
    database
      .prepare(
        "UPDATE quotations SET customer_id=?,lead_id=?,issue_date=?,valid_until=?,currency=?,customer_snapshot=?,sales_contact_email=?,sales_contact_name=?,subtotal_minor=?,discount_minor=?,delivery_fee_minor=?,installation_fee_minor=?,other_charges_minor=?,vat_enabled=?,vat_rate_bps=?,tax_mode=?,vat_minor=?,grand_total_minor=?,payment_terms=?,delivery_terms=?,warranty_terms=?,notes=?,updated_at=? WHERE id=? AND status='DRAFT'",
      )
      .bind(
        input.customerId,input.leadId,input.issueDate,input.validUntil,input.currency,
        JSON.stringify(customer),email,await salespersonName(database,email),totals.subtotalMinor,
        toMinor(input.discount),toMinor(input.deliveryFee),toMinor(input.installationFee),
        toMinor(input.otherCharges),input.vatEnabled ? 1 : 0,Math.round(input.vatRate * 100),
        input.taxMode,totals.vatMinor,totals.grandTotalMinor,input.paymentTerms,
        input.deliveryTerms,input.warrantyTerms,input.notes,now,quoteId,
      ),
    database
      .prepare("DELETE FROM quotation_items WHERE quotation_id=? AND EXISTS(SELECT 1 FROM quotations WHERE id=? AND status='DRAFT')")
      .bind(quoteId,quoteId),
    ...items.map((item) =>
      database
        .prepare("INSERT INTO quotation_items SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quotations WHERE id=? AND status='DRAFT')")
        .bind(item.id,item.quotation_id,item.product_id,item.product_name_snapshot,item.brand_snapshot,item.model_snapshot,item.sku_snapshot,item.description_snapshot,item.condition_snapshot,item.image_key_snapshot,item.image_mime_snapshot,item.image_id_snapshot,item.quantity,item.unit_price_minor,item.discount_minor,item.line_total_minor,item.sort_order,quoteId),
    ),
  ];
  try {
    const result = await database.batch(statements);
    if (!result[0]?.meta.changes) fail(409, 'This quotation is no longer a draft.');
  } catch (error) {
    await Promise.all(uploads.map((key) => c.env.PRODUCT_IMAGES.delete(key)));
    throw error;
  }
  await Promise.all(oldKeys.map((key) => c.env.PRODUCT_IMAGES.delete(key)));
  return c.json((await getQuote(database, quoteId)).quote);
});
quotationRoutes.post('/:id/status', async (c) => {
  const { status } = zStatus(await c.req.json());
  const database = c.env.DB;
  const quoteId = c.req.param('id');
  const current = await database
    .prepare('SELECT status FROM quotations WHERE id=?')
    .bind(quoteId)
    .first<{ status: QuotationStatus }>();
  if (!current) fail(404, 'Quotation not found.');
  if (current.status === status) return c.json((await getQuote(database, quoteId)).quote);
  const email = authEmail(c);
  const now = timestamp();
  const results = await database.batch([
    database
      .prepare(
        'INSERT INTO quotation_status_history(id,quotation_id,from_status,to_status,changed_by,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quotations WHERE id=? AND status=?)',
      )
      .bind(id(),quoteId,current.status,status,email,now,quoteId,current.status),
    database
      .prepare('UPDATE quotations SET status=?,updated_at=? WHERE id=? AND status=?')
      .bind(status,now,quoteId,current.status),
  ]);
  if (!results[1]?.meta.changes) fail(409, 'The quotation status changed. Refresh and try again.');
  return c.json((await getQuote(database, quoteId)).quote);
});
quotationRoutes.post('/:id/duplicate', async (c) => {
  const { row, items: oldItems } = await getQuote(c.env.DB, c.req.param('id'));
  const newId = id();
  const today = todayBangkok();
  const validUntil = new Date(`${today}T12:00:00+07:00`);
  validUntil.setDate(validUntil.getDate() + 30);
  const due = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(validUntil);
  const newNumber = await reserveNumber(c.env.DB, Number(today.slice(0, 4)));
  const email = authEmail(c);
  const newItems: ItemRow[] = [];
  const uploads: string[] = [];
  try {
    for (const item of oldItems) {
      const itemId = id();
      const imageKey = item.image_key_snapshot ? `quotations/${newId}/items/${itemId}` : '';
      if (imageKey && (await copyObject(c.env.PRODUCT_IMAGES,item.image_key_snapshot,imageKey,item.image_mime_snapshot))) uploads.push(imageKey);
      newItems.push({ ...item,id:itemId,quotation_id:newId,image_key_snapshot:uploads.includes(imageKey) ? imageKey : '',sort_order:newItems.length });
    }
    const oldCompany = parse<StoredCompanySnapshot>(row.company_snapshot,{...defaultCompany(),logoKey:''});
    const logoKey = oldCompany.logoKey ? `quotations/${newId}/company-logo` : '';
    if (logoKey && (await copyObject(c.env.PRODUCT_IMAGES,oldCompany.logoKey,logoKey))) uploads.push(logoKey);
    const newCompany = {...oldCompany,logoKey:uploads.includes(logoKey) ? logoKey : ''};
    const createdAt = timestamp();
    const insertQuote = c.env.DB.prepare(
      'INSERT INTO quotations(id,quotation_number,customer_id,lead_id,status,issue_date,valid_until,currency,customer_snapshot,company_snapshot,sales_contact_email,sales_contact_name,subtotal_minor,discount_minor,delivery_fee_minor,installation_fee_minor,other_charges_minor,vat_enabled,vat_rate_bps,tax_mode,vat_minor,grand_total_minor,payment_terms,delivery_terms,warranty_terms,notes,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(newId,newNumber,row.customer_id,row.lead_id,'DRAFT',today,due,row.currency,row.customer_snapshot,JSON.stringify(newCompany),email,await salespersonName(c.env.DB,email),row.subtotal_minor,row.discount_minor,row.delivery_fee_minor,row.installation_fee_minor,row.other_charges_minor,row.vat_enabled,row.vat_rate_bps,row.tax_mode,row.vat_minor,row.grand_total_minor,row.payment_terms,row.delivery_terms,row.warranty_terms,row.notes,email,createdAt,createdAt);
    await c.env.DB.batch([
      insertQuote,
      ...newItems.map((item)=>itemStatement(c.env.DB,newId,item)),
      c.env.DB.prepare("INSERT INTO quotation_status_history(id,quotation_id,from_status,to_status,changed_by,created_at) VALUES(?,?,NULL,'DRAFT',?,?)").bind(id(),newId,email,createdAt),
      c.env.DB.prepare('INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) VALUES(?,?,?,?,?,?,?)').bind(id(),'quotation',newId,'duplicated',`Quotation ${newNumber} duplicated`,email,createdAt),
    ]);
  } catch(error) {
    await Promise.all(uploads.map((key)=>c.env.PRODUCT_IMAGES.delete(key)));
    throw error;
  }
  return c.json((await getQuote(c.env.DB,newId)).quote,201);
});

function zStatus(value: unknown) {
  const result = z.object({ status: z.enum(quotationStatuses) }).safeParse(value);
  if (!result.success) fail(422,'Choose a valid quotation status.');
  return result.data;
}
