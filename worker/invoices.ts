import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from './auth';
import {
  invoiceStatuses,
  invoiceTransitions,
  invoiceUpdateInput,
  type Invoice,
  type InvoiceItem,
  type InvoiceListItem,
  type InvoiceStatus,
} from '../shared/invoices';
import type { QuotationCustomerSnapshot } from '../shared/quotations';
import {
  calculateQuotationTotals,
  fromMinor,
  toMinor,
} from '../shared/quotation-money';
import {
  companyInput,
  companyRow,
  copyObject,
  parse,
  salespersonName,
  todayBangkok,
  type CompanyRow,
} from './quotations';

function fail(status: 404 | 409 | 422, message: string): never {
  throw new HTTPException(status, { message });
}
const id = () => crypto.randomUUID();
const timestamp = () => new Date().toISOString();
const authEmail = (c: { get: (key: 'email') => string }) => c.get('email');
const emptyCustomer: QuotationCustomerSnapshot = {
  name: '',
  companyName: '',
  contactName: '',
  phone: '',
  email: '',
  billingAddress: '',
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  quotation_id: string;
  quotation_number: string;
  customer_id: string;
  lead_id: string | null;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  currency: 'THB' | 'USD';
  customer_snapshot: string;
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
  deposit_minor: number;
  payment_terms: string;
  delivery_terms: string;
  warranty_terms: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type InvoiceItemRow = {
  id: string;
  invoice_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  brand_snapshot: string;
  model_snapshot: string;
  sku_snapshot: string;
  description_snapshot: string;
  image_key_snapshot: string;
  image_mime_snapshot: string;
  quantity: number;
  unit_price_minor: number;
  discount_minor: number;
  line_total_minor: number;
  sort_order: number;
  product_status?: string | null;
  product_spec?: string | null;
  reserved_for?: string | null;
};
type QuoteSourceRow = {
  id: string;
  quotation_number: string;
  customer_id: string;
  lead_id: string | null;
  status: string;
  currency: 'THB' | 'USD';
  customer_snapshot: string;
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
};
type QuoteItemSourceRow = {
  product_id: string | null;
  product_name_snapshot: string;
  brand_snapshot: string;
  model_snapshot: string;
  sku_snapshot: string;
  description_snapshot: string;
  image_key_snapshot: string;
  image_mime_snapshot: string;
  quantity: number;
  unit_price_minor: number;
  discount_minor: number;
  line_total_minor: number;
  sort_order: number;
};
type StockRow = {
  id: string;
  sku: string;
  status: string;
  archived_at: string | null;
  purchase_cost: number;
  reserved_for: string | null;
};

function dateAfter(day: string, count: number) {
  const value = new Date(`${day}T12:00:00+07:00`);
  value.setDate(value.getDate() + count);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}
function toItem(row: InvoiceItemRow): InvoiceItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name_snapshot,
    brand: row.brand_snapshot,
    model: row.model_snapshot,
    sku: row.sku_snapshot,
    description: row.description_snapshot,
    specification: row.product_spec ?? '',
    imageAvailable: !!row.image_key_snapshot,
    quantity: row.quantity,
    unitPrice: fromMinor(row.unit_price_minor),
    discount: fromMinor(row.discount_minor),
    lineTotal: fromMinor(row.line_total_minor),
    sortOrder: row.sort_order,
    productStatus: row.product_status ?? null,
    reservedForCustomerId: row.reserved_for ?? null,
  };
}
function toInvoice(
  row: InvoiceRow,
  items: InvoiceItemRow[],
  history: Invoice['history'],
  profile: CompanyRow | null,
): Invoice {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    quotationId: row.quotation_id,
    quotationNumber: row.quotation_number,
    customerId: row.customer_id,
    leadId: row.lead_id,
    status: row.status,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    currency: row.currency,
    customer: parse(row.customer_snapshot, emptyCustomer),
    company: { ...companyInput(profile), logoAvailable: !!profile?.logo_key },
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
    depositAmount: fromMinor(row.deposit_minor),
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
async function getInvoice(database: D1Database, invoiceId: string) {
  const row = await database
    .prepare(
      'SELECT i.*,q.quotation_number FROM invoices i JOIN quotations q ON q.id=i.quotation_id WHERE i.id=?',
    )
    .bind(invoiceId)
    .first<InvoiceRow>();
  if (!row) fail(404, 'Invoice not found.');
  const [items, history, profile] = await Promise.all([
    database
      .prepare(
        'SELECT ii.*,p.status AS product_status,p.target_body_part AS product_spec,r.customer_id AS reserved_for FROM invoice_items ii LEFT JOIN products p ON p.id=ii.product_id LEFT JOIN reservations r ON r.product_id=ii.product_id WHERE ii.invoice_id=? ORDER BY ii.sort_order,ii.rowid',
      )
      .bind(invoiceId)
      .all<InvoiceItemRow>(),
    database
      .prepare(
        'SELECT id,from_status AS fromStatus,to_status AS toStatus,changed_by AS changedBy,created_at AS createdAt FROM invoice_status_history WHERE invoice_id=? ORDER BY created_at,id',
      )
      .bind(invoiceId)
      .all<Invoice['history'][number]>(),
    companyRow(database),
  ]);
  return {
    row,
    items: items.results,
    invoice: toInvoice(row, items.results, history.results, profile),
  };
}
async function reserveInvoiceNumber(database: D1Database, year: number) {
  const row = await database
    .prepare(
      'INSERT INTO invoice_number_sequences(year,last_number) VALUES(?,1) ON CONFLICT(year) DO UPDATE SET last_number=last_number+1 RETURNING last_number',
    )
    .bind(year)
    .first<{ last_number: number }>();
  if (!row) throw new Error('Could not reserve an invoice number.');
  return `INV-${year}-${String(row.last_number).padStart(4, '0')}`;
}
function activity(
  database: D1Database,
  entityType: string,
  entityId: string,
  action: string,
  description: string,
  email: string,
  at: string,
) {
  return database
    .prepare(
      'INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) VALUES(?,?,?,?,?,?,?)',
    )
    .bind(id(), entityType, entityId, action, description, email, at);
}

export const invoiceRoutes = new Hono<AppEnv>();

invoiceRoutes.get('/', async (c) => {
  const q = c.req.query('q')?.trim().slice(0, 150);
  const status = c.req.query('status');
  const sort = c.req.query('sort') === 'oldest' ? 'ASC' : 'DESC';
  const where: string[] = [];
  const params: string[] = [];
  if (q) {
    where.push(
      '(i.invoice_number LIKE ? OR q.quotation_number LIKE ? OR i.customer_snapshot LIKE ?)',
    );
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status && invoiceStatuses.includes(status as InvoiceStatus)) {
    where.push('i.status=?');
    params.push(status);
  }
  const rows = await c.env.DB.prepare(
    `SELECT i.*,q.quotation_number FROM invoices i JOIN quotations q ON q.id=i.quotation_id${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY i.issue_date ${sort},i.created_at ${sort} LIMIT 500`,
  )
    .bind(...params)
    .all<InvoiceRow>();
  return c.json(
    rows.results.map(
      (row): InvoiceListItem => ({
        id: row.id,
        invoiceNumber: row.invoice_number,
        quotationId: row.quotation_id,
        quotationNumber: row.quotation_number,
        customerId: row.customer_id,
        customer: parse(row.customer_snapshot, emptyCustomer),
        issueDate: row.issue_date,
        dueDate: row.due_date,
        currency: row.currency,
        status: row.status,
        createdAt: row.created_at,
        total: fromMinor(row.grand_total_minor),
      }),
    ),
  );
});

/** Creates a draft invoice from a quotation and marks the quotation accepted. */
invoiceRoutes.post('/', async (c) => {
  const { quotationId } = z
    .object({ quotationId: z.string().min(1) })
    .strict()
    .parse(await c.req.json());
  const database = c.env.DB;
  const quote = await database
    .prepare('SELECT * FROM quotations WHERE id=?')
    .bind(quotationId)
    .first<QuoteSourceRow>();
  if (!quote) fail(404, 'Quotation not found.');
  if (quote.status === 'CANCELLED' || quote.status === 'REJECTED')
    fail(409, 'Cancelled or rejected quotations cannot be invoiced.');
  const active = await database
    .prepare("SELECT 1 AS ok FROM invoices WHERE quotation_id=? AND status!='CANCELLED'")
    .bind(quotationId)
    .first<{ ok: number }>();
  if (active)
    fail(
      409,
      'This quotation already has an invoice. Cancel it before issuing a new one.',
    );
  const sourceItems = (
    await database
      .prepare(
        'SELECT * FROM quotation_items WHERE quotation_id=? ORDER BY sort_order,rowid',
      )
      .bind(quotationId)
      .all<QuoteItemSourceRow>()
  ).results;
  if (!sourceItems.length) fail(422, 'The quotation has no products.');
  const email = authEmail(c);
  const invoiceId = id();
  const issueDate = todayBangkok();
  const number = await reserveInvoiceNumber(
    database,
    Number(issueDate.slice(0, 4)),
  );
  const createdAt = timestamp();
  const uploads: string[] = [];
  try {
    const itemStatements: D1PreparedStatement[] = [];
    for (const [index, item] of sourceItems.entries()) {
      const itemId = id();
      const key = item.image_key_snapshot
        ? `invoices/${invoiceId}/items/${itemId}`
        : '';
      if (
        key &&
        (await copyObject(
          c.env.PRODUCT_IMAGES,
          item.image_key_snapshot,
          key,
          item.image_mime_snapshot,
        ))
      )
        uploads.push(key);
      const copied = uploads.includes(key);
      itemStatements.push(
        database
          .prepare(
            'INSERT INTO invoice_items(id,invoice_id,product_id,product_name_snapshot,brand_snapshot,model_snapshot,sku_snapshot,description_snapshot,image_key_snapshot,image_mime_snapshot,quantity,unit_price_minor,discount_minor,line_total_minor,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            itemId,
            invoiceId,
            item.product_id,
            item.product_name_snapshot,
            item.brand_snapshot,
            item.model_snapshot,
            item.sku_snapshot,
            item.description_snapshot,
            copied ? key : '',
            copied ? item.image_mime_snapshot : '',
            item.quantity,
            item.unit_price_minor,
            item.discount_minor,
            item.line_total_minor,
            index,
          ),
      );
    }
    const statements = [
      database
        .prepare(
          "INSERT INTO invoices(id,invoice_number,quotation_id,customer_id,lead_id,status,issue_date,due_date,currency,customer_snapshot,sales_contact_email,sales_contact_name,subtotal_minor,discount_minor,delivery_fee_minor,installation_fee_minor,other_charges_minor,vat_enabled,vat_rate_bps,tax_mode,vat_minor,grand_total_minor,deposit_minor,payment_terms,delivery_terms,warranty_terms,notes,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)",
        )
        .bind(
          invoiceId,
          number,
          quote.id,
          quote.customer_id,
          quote.lead_id,
          issueDate,
          dateAfter(issueDate, 7),
          quote.currency,
          quote.customer_snapshot,
          email,
          await salespersonName(database, email),
          quote.subtotal_minor,
          quote.discount_minor,
          quote.delivery_fee_minor,
          quote.installation_fee_minor,
          quote.other_charges_minor,
          quote.vat_enabled,
          quote.vat_rate_bps,
          quote.tax_mode,
          quote.vat_minor,
          quote.grand_total_minor,
          quote.payment_terms,
          quote.delivery_terms,
          quote.warranty_terms,
          quote.notes,
          email,
          createdAt,
          createdAt,
        ),
      ...itemStatements,
      database
        .prepare(
          "INSERT INTO invoice_status_history(id,invoice_id,from_status,to_status,changed_by,created_at) VALUES(?,?,NULL,'DRAFT',?,?)",
        )
        .bind(id(), invoiceId, email, createdAt),
      activity(
        database,
        'invoice',
        invoiceId,
        'created',
        `Invoice ${number} created from quotation ${quote.quotation_number}`,
        email,
        createdAt,
      ),
    ];
    if (quote.status !== 'ACCEPTED')
      statements.push(
        database
          .prepare(
            "INSERT INTO quotation_status_history(id,quotation_id,from_status,to_status,changed_by,created_at) SELECT ?,?,?,'ACCEPTED',?,? WHERE EXISTS(SELECT 1 FROM quotations WHERE id=? AND status=?)",
          )
          .bind(id(), quote.id, quote.status, email, createdAt, quote.id, quote.status),
        database
          .prepare(
            "UPDATE quotations SET status='ACCEPTED',updated_at=? WHERE id=? AND status=?",
          )
          .bind(createdAt, quote.id, quote.status),
      );
    await database.batch(statements);
  } catch (error) {
    await Promise.all(uploads.map((key) => c.env.PRODUCT_IMAGES.delete(key)));
    if (error instanceof HTTPException) throw error;
    const message =
      error instanceof Error
        ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}`
        : '';
    if (/UNIQUE constraint/i.test(message))
      fail(409, 'This quotation already has an invoice. Refresh and try again.');
    throw error;
  }
  return c.json((await getInvoice(database, invoiceId)).invoice, 201);
});

invoiceRoutes.get('/:id', async (c) => {
  return c.json((await getInvoice(c.env.DB, c.req.param('id'))).invoice);
});

/** Edits a draft invoice. Items can be changed or removed, never added. */
invoiceRoutes.patch('/:id', async (c) => {
  const input = invoiceUpdateInput.parse(await c.req.json());
  const database = c.env.DB;
  const invoiceId = c.req.param('id');
  const { row, items } = await getInvoice(database, invoiceId);
  if (row.status !== 'DRAFT') fail(409, 'Only draft invoices can be edited.');
  const existing = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  for (const item of input.items) {
    if (!existing.has(item.id))
      fail(422, 'Invoices can only contain products from the quotation.');
    if (seen.has(item.id)) fail(422, 'Each product can appear only once.');
    seen.add(item.id);
  }
  let totals;
  try {
    totals = calculateQuotationTotals({
      lines: input.items.map((item) => ({
        quantity: item.quantity,
        unitPriceMinor: toMinor(item.unitPrice),
        discountMinor: toMinor(item.discount),
      })),
      discountMinor: toMinor(input.discount),
      deliveryFeeMinor: toMinor(input.deliveryFee),
      installationFeeMinor: toMinor(input.installationFee),
      otherChargesMinor: toMinor(input.otherCharges),
      vatEnabled: input.vatEnabled,
      vatRateBps: Math.round(input.vatRate * 100),
      taxMode: input.taxMode,
    });
  } catch (error) {
    fail(422, error instanceof Error ? error.message : 'Invalid invoice totals.');
  }
  const depositMinor = toMinor(input.depositAmount);
  if (depositMinor > totals.grandTotalMinor)
    fail(422, 'Deposit cannot be more than the grand total.');
  const removed = items.filter((item) => !seen.has(item.id));
  const now = timestamp();
  const draftGuard = "EXISTS(SELECT 1 FROM invoices WHERE id=? AND status='DRAFT')";
  const result = await database.batch([
    database
      .prepare(
        "UPDATE invoices SET issue_date=?,due_date=?,subtotal_minor=?,discount_minor=?,delivery_fee_minor=?,installation_fee_minor=?,other_charges_minor=?,vat_enabled=?,vat_rate_bps=?,tax_mode=?,vat_minor=?,grand_total_minor=?,deposit_minor=?,payment_terms=?,delivery_terms=?,warranty_terms=?,notes=?,updated_at=? WHERE id=? AND status='DRAFT'",
      )
      .bind(
        input.issueDate,
        input.dueDate,
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
        depositMinor,
        input.paymentTerms,
        input.deliveryTerms,
        input.warrantyTerms,
        input.notes,
        now,
        invoiceId,
      ),
    ...removed.map((item) =>
      database
        .prepare(`DELETE FROM invoice_items WHERE id=? AND invoice_id=? AND ${draftGuard}`)
        .bind(item.id, invoiceId, invoiceId),
    ),
    ...input.items.map((item, index) =>
      database
        .prepare(
          `UPDATE invoice_items SET product_name_snapshot=?,description_snapshot=?,quantity=?,unit_price_minor=?,discount_minor=?,line_total_minor=?,sort_order=? WHERE id=? AND invoice_id=? AND ${draftGuard}`,
        )
        .bind(
          item.displayName,
          item.description,
          item.quantity,
          toMinor(item.unitPrice),
          toMinor(item.discount),
          totals.lineTotalsMinor[index],
          index,
          item.id,
          invoiceId,
          invoiceId,
        ),
    ),
  ]);
  if (!result[0]?.meta.changes) fail(409, 'This invoice is no longer a draft.');
  await Promise.all(
    removed
      .map((item) => item.image_key_snapshot)
      .filter(Boolean)
      .map((key) => c.env.PRODUCT_IMAGES.delete(key)),
  );
  return c.json((await getInvoice(database, invoiceId)).invoice);
});

/**
 * Changes invoice status and the stock it controls in one D1 batch:
 * DEPOSIT_COMPLETE reserves every product for the invoice's customer,
 * PAYMENT_COMPLETE sells every product, and cancelling after the deposit
 * releases the invoice's reservations. Nothing changes if any product cannot.
 */
invoiceRoutes.post('/:id/status', async (c) => {
  const parsed = z
    .object({ status: z.enum(invoiceStatuses) })
    .safeParse(await c.req.json());
  if (!parsed.success) fail(422, 'Choose a valid invoice status.');
  const next = parsed.data.status;
  const database = c.env.DB;
  const invoiceId = c.req.param('id');
  const { row, items } = await getInvoice(database, invoiceId);
  if (row.status === next) return c.json((await getInvoice(database, invoiceId)).invoice);
  if (!invoiceTransitions[row.status].includes(next))
    fail(409, `An invoice cannot move from ${row.status} to ${next}.`);

  const email = authEmail(c);
  const now = timestamp();
  // Every statement after the status update only runs if this request made it.
  const guard = 'EXISTS(SELECT 1 FROM invoices WHERE id=? AND status=? AND updated_at=?)';
  const guardArgs = [invoiceId, next, now] as const;
  const statements: D1PreparedStatement[] = [
    database
      .prepare('UPDATE invoices SET status=?,updated_at=? WHERE id=? AND status=?')
      .bind(next, now, invoiceId, row.status),
    database
      .prepare(
        `INSERT INTO invoice_status_history(id,invoice_id,from_status,to_status,changed_by,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`,
      )
      .bind(id(), invoiceId, row.status, next, email, now, ...guardArgs),
    database
      .prepare(
        `INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
      )
      .bind(
        id(),
        'invoice',
        invoiceId,
        'status_changed',
        `Invoice ${row.invoice_number}: ${row.status} → ${next}`,
        email,
        now,
        ...guardArgs,
      ),
  ];
  const productActivity = (productId: string, action: string, description: string) =>
    database
      .prepare(
        `INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
      )
      .bind(id(), 'product', productId, action, description, email, now, ...guardArgs);

  if (next === 'DEPOSIT_COMPLETE' || next === 'PAYMENT_COMPLETE') {
    const lines = items.filter((item) => item.product_id);
    if (!lines.length) fail(422, 'This invoice has no stock products.');
    const placeholders = lines.map(() => '?').join(',');
    const stock = new Map(
      (
        await database
          .prepare(
            `SELECT p.id,p.sku,p.status,p.archived_at,p.purchase_cost,r.customer_id AS reserved_for FROM products p LEFT JOIN reservations r ON r.product_id=p.id WHERE p.id IN (${placeholders})`,
          )
          .bind(...lines.map((item) => item.product_id))
          .all<StockRow>()
      ).results.map((product) => [product.id, product]),
    );
    const problems: string[] = [];
    for (const line of lines) {
      const product = stock.get(line.product_id!);
      const name = product?.sku || line.sku_snapshot;
      if (!product || product.archived_at) problems.push(`${name} (archived)`);
      else if (product.status === 'SOLD') problems.push(`${name} (already sold)`);
      else if (product.status === 'NOT_AVAILABLE') problems.push(`${name} (not available)`);
      else if (product.status === 'RESERVED' && product.reserved_for !== row.customer_id)
        problems.push(`${name} (reserved for another customer)`);
    }
    if (problems.length)
      fail(
        409,
        `${next === 'DEPOSIT_COMPLETE' ? 'These products cannot be reserved' : 'These products cannot be sold'}: ${problems.join(', ')}.`,
      );
    for (const line of lines) {
      const product = stock.get(line.product_id!)!;
      if (next === 'DEPOSIT_COMPLETE') {
        if (product.status === 'RESERVED')
          statements.push(
            database
              .prepare(
                `UPDATE reservations SET invoice_id=? WHERE product_id=? AND customer_id=? AND ${guard}`,
              )
              .bind(invoiceId, product.id, row.customer_id, ...guardArgs),
          );
        else
          statements.push(
            database
              .prepare(
                `INSERT INTO reservations(id,product_id,customer_id,lead_id,reserved_at,expires_at,notes,invoice_id) SELECT ?,?,?,NULL,?,NULL,?,? WHERE ${guard}`,
              )
              .bind(
                id(),
                product.id,
                row.customer_id,
                now,
                `Deposit received on invoice ${row.invoice_number}`,
                invoiceId,
                ...guardArgs,
              ),
            productActivity(
              product.id,
              'reserved',
              `Reserved by invoice ${row.invoice_number} (deposit complete)`,
            ),
          );
      } else {
        statements.push(
          database
            .prepare(
              `INSERT INTO product_sales(product_id,lead_id,customer_id,sold_at,selling_price,purchase_cost,invoice_id) SELECT ?,NULL,?,?,?,?,? WHERE ${guard}`,
            )
            .bind(
              product.id,
              row.customer_id,
              now,
              fromMinor(line.line_total_minor),
              product.purchase_cost,
              invoiceId,
              ...guardArgs,
            ),
          productActivity(
            product.id,
            'sold',
            `Sold on invoice ${row.invoice_number} (payment complete)`,
          ),
        );
      }
    }
  }
  if (next === 'CANCELLED' && row.status === 'DEPOSIT_COMPLETE') {
    for (const line of items.filter((item) => item.product_id))
      statements.push(
        productActivity(
          line.product_id!,
          'released',
          `Reservation released: invoice ${row.invoice_number} cancelled`,
        ),
      );
    statements.push(
      database
        .prepare(`DELETE FROM reservations WHERE invoice_id=? AND ${guard}`)
        .bind(invoiceId, ...guardArgs),
    );
  }

  let results: D1Result[];
  try {
    results = await database.batch(statements);
  } catch (error) {
    const message =
      error instanceof Error
        ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}`
        : '';
    if (/Product is not available|reserved|UNIQUE constraint|Sale does not match/i.test(message))
      fail(409, 'Stock changed while updating this invoice. Refresh and try again.');
    throw error;
  }
  if (!results[0]?.meta.changes)
    fail(409, 'The invoice status changed. Refresh and try again.');
  return c.json((await getInvoice(database, invoiceId)).invoice);
});

/**
 * Deletes an invoice. A deposit-complete invoice releases its reservations in
 * the same batch; a paid invoice cannot be deleted because it holds the sale
 * records. The quotation stays as it is and can be invoiced again.
 */
invoiceRoutes.delete('/:id', async (c) => {
  const database = c.env.DB;
  const invoiceId = c.req.param('id');
  const { row, items } = await getInvoice(database, invoiceId);
  if (row.status === 'PAYMENT_COMPLETE')
    fail(409, 'Paid invoices cannot be deleted because the products are sold on them.');
  const email = authEmail(c);
  const now = timestamp();
  // Everything before the delete only runs while the invoice is still in the status read above.
  const guard = 'EXISTS(SELECT 1 FROM invoices WHERE id=? AND status=?)';
  const guarded = (sql: string, ...args: unknown[]) =>
    database.prepare(`${sql} AND ${guard}`).bind(...args, invoiceId, row.status);
  const log = (entityType: string, entityId: string, action: string, description: string) =>
    database
      .prepare(
        `INSERT INTO activities(id,entity_type,entity_id,action,description,user_email,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
      )
      .bind(id(), entityType, entityId, action, description, email, now, invoiceId, row.status);
  const statements: D1PreparedStatement[] = [];
  if (row.status === 'DEPOSIT_COMPLETE') {
    for (const line of items.filter((item) => item.product_id))
      statements.push(
        log('product', line.product_id!, 'released', `Reservation released: invoice ${row.invoice_number} deleted`),
      );
    statements.push(guarded('DELETE FROM reservations WHERE invoice_id=?', invoiceId));
  }
  statements.push(
    log('quotation', row.quotation_id, 'invoice_deleted', `Invoice ${row.invoice_number} (${row.status}) deleted`),
    guarded('UPDATE reservations SET invoice_id=NULL WHERE invoice_id=?', invoiceId),
    database
      .prepare('DELETE FROM invoices WHERE id=? AND status=?')
      .bind(invoiceId, row.status),
  );
  const results = await database.batch(statements);
  const deleted = results[statements.length - 1];
  if (!deleted?.meta.changes)
    fail(409, 'The invoice status changed. Refresh and try again.');
  await Promise.all(
    items
      .map((item) => item.image_key_snapshot)
      .filter(Boolean)
      .map((key) => c.env.PRODUCT_IMAGES.delete(key)),
  );
  return c.json({ ok: true });
});

invoiceRoutes.get('/:id/items/:itemId/image', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT image_key_snapshot,image_mime_snapshot FROM invoice_items WHERE invoice_id=? AND id=?',
  )
    .bind(c.req.param('id'), c.req.param('itemId'))
    .first<{ image_key_snapshot: string; image_mime_snapshot: string }>();
  if (!row?.image_key_snapshot) fail(404, 'Invoice photo not found.');
  const object = await c.env.PRODUCT_IMAGES.get(row.image_key_snapshot);
  if (!object) fail(404, 'Invoice photo is unavailable.');
  c.header('Content-Type', row.image_mime_snapshot || 'application/octet-stream');
  c.header('Content-Disposition', 'inline');
  return c.body(object.body);
});
invoiceRoutes.get('/:id/company-logo', async (c) => {
  const exists = await c.env.DB.prepare('SELECT 1 AS ok FROM invoices WHERE id=?')
    .bind(c.req.param('id'))
    .first<{ ok: number }>();
  if (!exists) fail(404, 'Invoice not found.');
  const profile = await companyRow(c.env.DB);
  if (!profile?.logo_key) fail(404, 'Company logo not found.');
  const object = await c.env.PRODUCT_IMAGES.get(profile.logo_key);
  if (!object) fail(404, 'Company logo is unavailable.');
  c.header('Content-Type', object.httpMetadata?.contentType ?? 'image/png');
  c.header('Content-Disposition', 'inline');
  return c.body(object.body);
});
