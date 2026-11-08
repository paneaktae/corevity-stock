import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from './auth';
import {
  expenseAllocationInput,
  expenseAttachmentTypes,
  expenseCategoryInput,
  expenseInput,
  expensePaymentInput,
  expenseUpdateInput,
  type ExpenseType,
} from '../shared/finance';

const app = new Hono<AppEnv>();
const makeId = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const toMinor = (value: number) => Math.round(value * 100);
const fromMinor = (value: number) => value / 100;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const todayBangkok = () => {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};
function fail(status: 400 | 404 | 409 | 422 | 500, message: string): never {
  throw new HTTPException(status, { message });
}
type ExpenseRow = {
  id: string;
  expense_number: string;
  expense_date: string;
  description: string;
  category_id: string;
  category_name: string;
  expense_type: ExpenseType;
  amount_minor: number;
  currency: string;
  exchange_rate: number;
  converted_thb_minor: number;
  exchange_rate_date: string;
  vendor: string;
  payment_method: string;
  due_date: string | null;
  related_product_id: string | null;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  void_reason: string;
  paid_minor: number;
  paid_thb_minor: number;
};
function expenseView(row: ExpenseRow) {
  const outstandingMinor = Math.max(0, row.amount_minor - row.paid_minor);
  const status = row.voided_at
    ? 'CANCELLED'
    : outstandingMinor === 0
      ? 'PAID'
      : row.paid_minor > 0
        ? 'PARTIALLY_PAID'
        : 'UNPAID';
  return {
    id: row.id,
    expenseNumber: row.expense_number,
    expenseDate: row.expense_date,
    description: row.description,
    categoryId: row.category_id,
    categoryName: row.category_name,
    expenseType: row.expense_type,
    amount: fromMinor(row.amount_minor),
    currency: row.currency,
    exchangeRate: row.exchange_rate,
    convertedThb: fromMinor(row.converted_thb_minor),
    exchangeRateDate: row.exchange_rate_date,
    vendor: row.vendor,
    paymentMethod: row.payment_method,
    dueDate: row.due_date,
    relatedProductId: row.related_product_id,
    notes: row.notes,
    paid: fromMinor(row.paid_minor),
    paidThb: fromMinor(row.paid_thb_minor),
    outstanding: fromMinor(outstandingMinor),
    outstandingThb: fromMinor(
      Math.max(0, row.converted_thb_minor - row.paid_thb_minor),
    ),
    status,
    isOverdue:
      status !== 'PAID' &&
      status !== 'CANCELLED' &&
      !!row.due_date &&
      row.due_date < todayBangkok(),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  };
}
const expenseSelect = `SELECT e.*,c.name AS category_name,
  COALESCE((SELECT SUM(p.amount_minor) FROM expense_payments p WHERE p.expense_id=e.id),0) AS paid_minor,
  COALESCE((SELECT SUM(ROUND(p.amount_minor*e.exchange_rate)) FROM expense_payments p WHERE p.expense_id=e.id),0) AS paid_thb_minor
  FROM expenses e JOIN expense_categories c ON c.id=e.category_id`;
async function getExpense(database: D1Database, id: string) {
  return database
    .prepare(`${expenseSelect} WHERE e.id=?`)
    .bind(id)
    .first<ExpenseRow>();
}
async function audit(
  database: D1Database,
  expenseId: string,
  action: string,
  actor: string,
  details: Record<string, unknown> = {},
) {
  await database
    .prepare(
      'INSERT INTO expense_audit_logs(id,expense_id,action,details,actor_email,created_at) VALUES(?,?,?,?,?,?)',
    )
    .bind(makeId(), expenseId, action, JSON.stringify(details), actor, now())
    .run();
}
async function listExpenseRows(
  database: D1Database,
  where: string,
  params: unknown[] = [],
) {
  const { results } = await database
    .prepare(`${expenseSelect} ${where}`)
    .bind(...(params as (string | number | null)[]))
    .all<ExpenseRow>();
  return results;
}
async function monthRange(request: Request) {
  const query = new URL(request.url).searchParams;
  const today = todayBangkok();
  const from = query.get('from') || `${today.slice(0, 7)}-01`;
  const to = query.get('to') || today;
  if (!validDate(from) || !validDate(to) || from > to)
    fail(422, 'Choose a valid date range.');
  return { from, to };
}

app.get('/expense-categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id,name,default_expense_type AS defaultExpenseType,is_active AS isActive,created_at AS createdAt,updated_at AS updatedAt FROM expense_categories ORDER BY is_active DESC,name COLLATE NOCASE',
  ).all();
  return c.json(results);
});
app.post('/expense-categories', async (c) => {
  const input = expenseCategoryInput.parse(await c.req.json());
  const id = makeId();
  const timestamp = now();
  try {
    await c.env.DB.prepare(
      'INSERT INTO expense_categories(id,name,default_expense_type,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
      .bind(
        id,
        input.name,
        input.defaultExpenseType,
        Number(input.isActive),
        timestamp,
        timestamp,
      )
      .run();
  } catch (error) {
    if (String(error).toLowerCase().includes('unique'))
      fail(409, 'An expense category with this name already exists.');
    throw error;
  }
  return c.json({ id, ...input, createdAt: timestamp, updatedAt: timestamp }, 201);
});
app.patch('/expense-categories/:id', async (c) => {
  const input = expenseCategoryInput.partial().strict().parse(await c.req.json());
  const current = await c.env.DB.prepare(
    'SELECT id FROM expense_categories WHERE id=?',
  )
    .bind(c.req.param('id'))
    .first();
  if (!current) fail(404, 'Expense category not found.');
  if (!Object.keys(input).length) fail(422, 'Choose a category field to update.');
  const values: (string | number)[] = [];
  const sets: string[] = [];
  if (input.name !== undefined) {
    sets.push('name=?');
    values.push(input.name);
  }
  if (input.defaultExpenseType !== undefined) {
    sets.push('default_expense_type=?');
    values.push(input.defaultExpenseType);
  }
  if (input.isActive !== undefined) {
    sets.push('is_active=?');
    values.push(Number(input.isActive));
  }
  sets.push('updated_at=?');
  values.push(now(), c.req.param('id'));
  try {
    await c.env.DB.prepare(
      `UPDATE expense_categories SET ${sets.join(',')} WHERE id=?`,
    )
      .bind(...values)
      .run();
  } catch (error) {
    if (String(error).toLowerCase().includes('unique'))
      fail(409, 'An expense category with this name already exists.');
    throw error;
  }
  return c.json({ success: true });
});

app.get('/expenses', async (c) => {
  const params = new URL(c.req.url).searchParams;
  const filters = ['1=1'];
  const values: (string | number)[] = [];
  const q = params.get('q')?.trim().slice(0, 100);
  if (q) {
    filters.push('(e.expense_number LIKE ? OR e.description LIKE ? OR e.vendor LIKE ?)');
    values.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  for (const [key, column] of [
    ['categoryId', 'e.category_id'],
    ['expenseType', 'e.expense_type'],
  ] as const) {
    const value = params.get(key);
    if (value) {
      filters.push(`${column}=?`);
      values.push(value);
    }
  }
  for (const [key, column, op] of [
    ['from', 'e.expense_date', '>='],
    ['to', 'e.expense_date', '<='],
  ] as const) {
    const value = params.get(key);
    if (value) {
      if (!validDate(value)) fail(422, 'Choose a valid date filter.');
      filters.push(`${column}${op}?`);
      values.push(value);
    }
  }
  const fromDate = params.get('from');
  const toDate = params.get('to');
  if (fromDate && toDate && fromDate > toDate) fail(422, 'Start date must not be after end date.');
  const status = params.get('status');
  if (status === 'CANCELLED') filters.push('e.voided_at IS NOT NULL');
  else if (status === 'PAID') filters.push(`e.voided_at IS NULL AND COALESCE((SELECT SUM(p.amount_minor) FROM expense_payments p WHERE p.expense_id=e.id),0)>=e.amount_minor`);
  else if (status === 'PARTIALLY_PAID') filters.push(`e.voided_at IS NULL AND COALESCE((SELECT SUM(p.amount_minor) FROM expense_payments p WHERE p.expense_id=e.id),0)>0 AND COALESCE((SELECT SUM(p.amount_minor) FROM expense_payments p WHERE p.expense_id=e.id),0)<e.amount_minor`);
  else if (status === 'UNPAID') filters.push(`e.voided_at IS NULL AND COALESCE((SELECT SUM(p.amount_minor) FROM expense_payments p WHERE p.expense_id=e.id),0)=0`);
  else if (status) fail(422, 'Choose a valid payment status.');
  const rows = await listExpenseRows(
    c.env.DB,
    `WHERE ${filters.join(' AND ')} GROUP BY e.id ORDER BY e.expense_date DESC,e.created_at DESC LIMIT 500`,
    values,
  );
  return c.json(rows.map(expenseView));
});
app.post('/expenses', async (c) => {
  const raw = await c.req.json();
  const input = expenseInput.parse(raw);
  const existing = await c.env.DB.prepare(
    `${expenseSelect} WHERE e.idempotency_key=?`,
  )
    .bind(input.idempotencyKey)
    .first<ExpenseRow>();
  if (existing) return c.json(expenseView(existing));
  const category = await c.env.DB.prepare(
    'SELECT default_expense_type FROM expense_categories WHERE id=? AND is_active=1',
  )
    .bind(input.categoryId)
    .first<{ default_expense_type: ExpenseType }>();
  if (!category) fail(422, 'Choose an active expense category.');
  if (
    input.relatedProductId &&
    !(await c.env.DB.prepare(
      'SELECT id FROM products WHERE id=? AND archived_at IS NULL',
    )
      .bind(input.relatedProductId)
      .first())
  )
    fail(422, 'Choose a valid inventory product.');
  if (input.currency !== 'THB' && (!input.exchangeRateDate || !raw.exchangeRate))
    fail(422, 'Enter the exchange rate and its date for foreign currency.');
  const rate = input.currency === 'THB' ? 1 : input.exchangeRate;
  const rateDate = input.currency === 'THB' ? input.expenseDate : input.exchangeRateDate!;
  const amountMinor = toMinor(input.amount);
  const convertedMinor = Math.round(amountMinor * rate);
  if (amountMinor <= 0 || convertedMinor <= 0)
    fail(422, 'Enter an amount greater than zero.');
  const year = Number(input.expenseDate.slice(0, 4));
  const sequence = await c.env.DB.prepare(
    'INSERT INTO expense_number_sequences(year,last_number) VALUES(?,1) ON CONFLICT(year) DO UPDATE SET last_number=last_number+1 RETURNING last_number',
  )
    .bind(year)
    .first<{ last_number: number }>();
  if (!sequence) fail(500, 'Could not generate an expense number.');
  const id = makeId();
  const timestamp = now();
  const expenseNumber = `EXP-${year}-${String(sequence.last_number).padStart(4, '0')}`;
  const expenseType = input.expenseType ?? category.default_expense_type;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO expenses(id,expense_number,expense_date,description,category_id,expense_type,amount_minor,currency,exchange_rate,converted_thb_minor,exchange_rate_date,vendor,payment_method,due_date,related_product_id,notes,idempotency_key,created_by,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        id,
        expenseNumber,
        input.expenseDate,
        input.description,
        input.categoryId,
        expenseType,
        amountMinor,
        input.currency,
        rate,
        convertedMinor,
        rateDate,
        input.vendor,
        input.paymentMethod,
        input.dueDate,
        input.relatedProductId,
        input.notes,
        input.idempotencyKey,
        c.get('email'),
        timestamp,
        timestamp,
      ),
      c.env.DB.prepare(
        'INSERT INTO expense_audit_logs(id,expense_id,action,details,actor_email,created_at) VALUES(?,?,?,?,?,?)',
      ).bind(
        makeId(),
        id,
        'CREATED',
        JSON.stringify({ expenseNumber, expenseType, currency: input.currency }),
        c.get('email'),
        timestamp,
      ),
    ]);
  } catch (error) {
    const retry = await c.env.DB.prepare(
      `${expenseSelect} WHERE e.idempotency_key=?`,
    )
      .bind(input.idempotencyKey)
      .first<ExpenseRow>();
    if (retry) return c.json(expenseView(retry));
    throw error;
  }
  const created = await getExpense(c.env.DB, id);
  return c.json(expenseView(created!), 201);
});
app.get('/expenses/:id', async (c) => {
  const row = await getExpense(c.env.DB, c.req.param('id'));
  if (!row) fail(404, 'Expense not found.');
  const [payments, attachments, allocations, history] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id,amount_minor AS amountMinor,payment_date AS paymentDate,payment_method AS paymentMethod,reference_number AS referenceNumber,notes,created_by AS createdBy,created_at AS createdAt FROM expense_payments WHERE expense_id=? ORDER BY payment_date DESC,created_at DESC',
    )
      .bind(row.id)
      .all(),
    c.env.DB.prepare(
      'SELECT id,payment_id AS paymentId,file_name AS fileName,mime_type AS mimeType,file_size AS fileSize,attachment_type AS attachmentType,created_at AS createdAt FROM expense_attachments WHERE expense_id=? AND removed_at IS NULL ORDER BY created_at DESC',
    )
      .bind(row.id)
      .all(),
    c.env.DB.prepare(
      `SELECT a.id,a.product_id AS productId,a.allocated_thb_minor AS allocatedThbMinor,a.allocation_method AS allocationMethod,p.sku,p.brand,p.model
       FROM expense_allocations a JOIN products p ON p.id=a.product_id WHERE a.expense_id=? ORDER BY p.sku`,
    )
      .bind(row.id)
      .all(),
    c.env.DB.prepare(
      'SELECT id,action,details,actor_email AS actorEmail,created_at AS createdAt FROM expense_audit_logs WHERE expense_id=? ORDER BY created_at DESC',
    )
      .bind(row.id)
      .all(),
  ]);
  return c.json({
    expense: expenseView(row),
    payments: payments.results.map((payment) => ({
      ...payment,
      amount: fromMinor(Number(payment.amountMinor)),
    })),
    attachments: attachments.results,
    allocations: allocations.results.map((allocation) => ({
      ...allocation,
      amountThb: fromMinor(Number(allocation.allocatedThbMinor)),
    })),
    history: history.results.map((item) => ({
      ...item,
      details: JSON.parse(String(item.details || '{}')),
    })),
  });
});
app.patch('/expenses/:id', async (c) => {
  const input = expenseUpdateInput.parse(await c.req.json());
  const current = await getExpense(c.env.DB, c.req.param('id'));
  if (!current) fail(404, 'Expense not found.');
  if (current.voided_at) fail(409, 'Voided expenses cannot be edited.');
  if (input.categoryId && input.categoryId !== current.category_id && !(await c.env.DB.prepare('SELECT id FROM expense_categories WHERE id=? AND is_active=1').bind(input.categoryId).first()))
    fail(422, 'Choose an active expense category.');
  if (input.relatedProductId && !(await c.env.DB.prepare('SELECT id FROM products WHERE id=? AND archived_at IS NULL').bind(input.relatedProductId).first()))
    fail(422, 'Choose a valid inventory product.');
  if (input.currency && input.currency !== 'THB' && input.currency !== current.currency && (!input.exchangeRate || !input.exchangeRateDate))
    fail(422, 'Enter the exchange rate and its date when changing to a foreign currency.');
  if (input.amount !== undefined || input.currency !== undefined || input.exchangeRate !== undefined || input.expenseDate !== undefined || input.expenseType !== undefined) {
    if (current.paid_minor > 0) fail(409, 'Amounts and dates cannot change after payment.');
    const allocation = await c.env.DB.prepare('SELECT 1 FROM expense_allocations WHERE expense_id=? LIMIT 1').bind(current.id).first();
    if (allocation) fail(409, 'Remove product allocations before changing financial amounts.');
  }
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const add = (column: string, value: string | number | null) => {
    sets.push(`${column}=?`);
    values.push(value);
  };
  for (const [key, column] of [
    ['expenseDate', 'expense_date'],
    ['description', 'description'],
    ['categoryId', 'category_id'],
    ['expenseType', 'expense_type'],
    ['vendor', 'vendor'],
    ['paymentMethod', 'payment_method'],
    ['dueDate', 'due_date'],
    ['relatedProductId', 'related_product_id'],
    ['notes', 'notes'],
  ] as const) {
    const value = input[key];
    if (value !== undefined) add(column, value as string | null);
  }
  if (input.amount !== undefined) add('amount_minor', toMinor(input.amount));
  if (input.currency !== undefined) add('currency', input.currency);
  if (input.exchangeRate !== undefined) add('exchange_rate', input.exchangeRate);
  if (input.exchangeRateDate !== undefined) add('exchange_rate_date', input.exchangeRateDate);
  if (input.amount !== undefined || input.currency !== undefined || input.exchangeRate !== undefined) {
    const amount = input.amount ?? fromMinor(current.amount_minor);
    const currency = input.currency ?? current.currency;
    const exchangeRate = currency === 'THB' ? 1 : input.exchangeRate ?? current.exchange_rate;
    add('converted_thb_minor', Math.round(toMinor(amount) * exchangeRate));
    if (currency === 'THB') {
      add('exchange_rate', 1);
      add('exchange_rate_date', input.expenseDate ?? current.expense_date);
    }
  }
  if (!sets.length) fail(422, 'Choose fields to update.');
  sets.push('updated_at=?');
  values.push(now(), current.id);
  await c.env.DB.prepare(`UPDATE expenses SET ${sets.join(',')} WHERE id=?`)
    .bind(...values)
    .run();
  await audit(c.env.DB, current.id, 'UPDATED', c.get('email'), {
    fields: Object.keys(input),
  });
  const updated = await getExpense(c.env.DB, current.id);
  return c.json(expenseView(updated!));
});
app.post('/expenses/:id/void', async (c) => {
  const body = zodVoid(await c.req.json());
  const row = await getExpense(c.env.DB, c.req.param('id'));
  if (!row) fail(404, 'Expense not found.');
  if (row.voided_at) return c.json(expenseView(row));
  if (row.paid_minor > 0) fail(409, 'Paid or partially paid expenses cannot be voided.');
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE expenses SET voided_at=?,void_reason=?,updated_at=? WHERE id=? AND voided_at IS NULL').bind(timestamp, body.reason, timestamp, row.id),
    c.env.DB.prepare('INSERT INTO expense_audit_logs(id,expense_id,action,details,actor_email,created_at) VALUES(?,?,?,?,?,?)').bind(makeId(), row.id, 'VOIDED', JSON.stringify({ reason: body.reason }), c.get('email'), timestamp),
  ]);
  return c.json(expenseView((await getExpense(c.env.DB, row.id))!));
});
const voidSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
function zodVoid(value: unknown) {
  return voidSchema.parse(value);
}

app.get('/expenses/:id/payments', async (c) => {
  const row = await getExpense(c.env.DB, c.req.param('id'));
  if (!row) fail(404, 'Expense not found.');
  const { results } = await c.env.DB.prepare(
    'SELECT id,amount_minor AS amountMinor,payment_date AS paymentDate,payment_method AS paymentMethod,reference_number AS referenceNumber,notes,created_by AS createdBy,created_at AS createdAt FROM expense_payments WHERE expense_id=? ORDER BY payment_date DESC,created_at DESC',
  )
    .bind(row.id)
    .all();
  return c.json(results.map((payment) => ({
    ...payment,
    amount: fromMinor(Number(payment.amountMinor)),
  })));
});
app.post('/expenses/:id/payments', async (c) => {
  const input = expensePaymentInput.parse(await c.req.json());
  const current = await getExpense(c.env.DB, c.req.param('id'));
  if (!current) fail(404, 'Expense not found.');
  if (current.voided_at) fail(409, 'Voided expenses cannot receive payments.');
  const duplicate = await c.env.DB.prepare(
    'SELECT id FROM expense_payments WHERE idempotency_key=?',
  )
    .bind(input.idempotencyKey)
    .first();
  if (duplicate) return c.json(expenseView((await getExpense(c.env.DB, current.id))!));
  const amountMinor = toMinor(input.amount);
  if (amountMinor + current.paid_minor > current.amount_minor)
    fail(422, 'Payment exceeds outstanding balance.');
  const id = makeId();
  const timestamp = now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO expense_payments(id,expense_id,amount_minor,payment_date,payment_method,reference_number,notes,idempotency_key,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        id,
        current.id,
        amountMinor,
        input.paymentDate,
        input.paymentMethod,
        input.referenceNumber,
        input.notes,
        input.idempotencyKey,
        c.get('email'),
        timestamp,
      ),
      c.env.DB.prepare(
        'INSERT INTO expense_audit_logs(id,expense_id,action,details,actor_email,created_at) VALUES(?,?,?,?,?,?)',
      ).bind(
        makeId(),
        current.id,
        'PAYMENT_RECORDED',
        JSON.stringify({ amount: input.amount, currency: current.currency, paymentDate: input.paymentDate }),
        c.get('email'),
        timestamp,
      ),
    ]);
  } catch (error) {
    if (String(error).includes('Payment exceeds outstanding balance'))
      fail(409, 'Payment exceeds outstanding balance.');
    throw error;
  }
  return c.json(expenseView((await getExpense(c.env.DB, current.id))!), 201);
});

app.get('/expenses/:id/allocations', async (c) => {
  const row = await getExpense(c.env.DB, c.req.param('id'));
  if (!row) fail(404, 'Expense not found.');
  const { results } = await c.env.DB.prepare(
    `SELECT a.id,a.product_id AS productId,a.allocated_thb_minor AS allocatedThbMinor,a.allocation_method AS allocationMethod,p.sku,p.brand,p.model,p.purchase_cost AS purchaseCost
     FROM expense_allocations a JOIN products p ON p.id=a.product_id WHERE a.expense_id=? ORDER BY p.sku`,
  )
    .bind(row.id)
    .all();
  return c.json(results.map((allocation) => ({
    ...allocation,
    amountThb: fromMinor(Number(allocation.allocatedThbMinor)),
  })));
});
app.post('/expenses/:id/allocations', async (c) => {
  const input = expenseAllocationInput.parse(await c.req.json());
  const row = await getExpense(c.env.DB, c.req.param('id'));
  if (!row) fail(404, 'Expense not found.');
  if (row.voided_at) fail(409, 'Voided expenses cannot be allocated.');
  if (row.expense_type !== 'PRODUCT_COST')
    fail(422, 'Only product-related cost expenses can be allocated.');
  const ids = input.allocations.map((item) => item.productId);
  if (new Set(ids).size !== ids.length) fail(422, 'Choose each product only once.');
  const placeholders = ids.map(() => '?').join(',');
  const selected = await c.env.DB.prepare(
    `SELECT id,purchase_cost FROM products WHERE archived_at IS NULL AND id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<{ id: string; purchase_cost: number }>();
  if (selected.results.length !== ids.length)
    fail(422, 'One or more selected products are unavailable.');
  const total = row.converted_thb_minor;
  let amounts: number[];
  if (input.method === 'MANUAL') {
    if (input.allocations.some((item) => item.amount === undefined))
      fail(422, 'Enter an amount for each product.');
    amounts = input.allocations.map((item) => toMinor(item.amount!));
    if (amounts.reduce((sum, amount) => sum + amount, 0) !== total)
      fail(422, 'Manual allocations must add up to the full expense amount in THB.');
  } else if (input.method === 'EQUAL') {
    const base = Math.floor(total / ids.length);
    const remainder = total - base * ids.length;
    amounts = ids.map((_, index) => base + (index < remainder ? 1 : 0));
  } else {
    const byId = new Map(selected.results.map((product) => [product.id, product.purchase_cost]));
    const weights = ids.map((productId) => Math.max(0, byId.get(productId) ?? 0));
    const sumWeights = weights.reduce((sum, weight) => sum + weight, 0);
    if (sumWeights <= 0) fail(422, 'Selected products need purchase costs for proportional allocation.');
    const portions = weights.map((weight) => (total * weight) / sumWeights);
    amounts = portions.map(Math.floor);
    let remainder = total - amounts.reduce((sum, amount) => sum + amount, 0);
    const order = portions
      .map((portion, index) => ({ index, fraction: portion - Math.floor(portion), id: ids[index] }))
      .sort((left, right) => right.fraction - left.fraction || left.id.localeCompare(right.id));
    for (let index = 0; remainder > 0; index++, remainder--)
      amounts[order[index % order.length].index]++;
  }
  const timestamp = now();
  const operations: D1PreparedStatement[] = [
    c.env.DB.prepare('DELETE FROM expense_allocations WHERE expense_id=?').bind(row.id),
    ...ids.map((productId, index) =>
      c.env.DB.prepare(
        'INSERT INTO expense_allocations(id,expense_id,product_id,allocated_thb_minor,allocation_method,created_at) VALUES(?,?,?,?,?,?)',
      ).bind(makeId(), row.id, productId, amounts[index], input.method, timestamp),
    ),
    c.env.DB.prepare(
      'INSERT INTO expense_audit_logs(id,expense_id,action,details,actor_email,created_at) VALUES(?,?,?,?,?,?)',
    ).bind(
      makeId(),
      row.id,
      'ALLOCATIONS_UPDATED',
      JSON.stringify({ method: input.method, productCount: ids.length, totalThbMinor: total }),
      c.get('email'),
      timestamp,
    ),
  ];
  await c.env.DB.batch(operations);
  return c.json({ success: true, totalThb: fromMinor(total), allocations: ids.map((productId, index) => ({ productId, amountThb: fromMinor(amounts[index]) })) });
});

function attachmentMime(bytes: Uint8Array) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') return 'application/pdf';
  return null;
}
app.post('/expenses/:id/attachments', async (c) => {
  const row = await getExpense(c.env.DB, c.req.param('id'));
  if (!row) fail(404, 'Expense not found.');
  const form = await c.req.formData();
  const value = form.get('file');
  if (!value || typeof value === 'string') fail(422, 'Choose a receipt or invoice file.');
  const file = value as File;
  if (!file.size || file.size > 10 * 1024 * 1024) fail(422, 'Attachments must be 10 MB or smaller.');
  const bytes = await file.arrayBuffer();
  const mime = attachmentMime(new Uint8Array(bytes));
  if (!mime) fail(422, 'Only valid JPEG, PNG, WEBP, and PDF files are supported.');
  const rawType = String(form.get('attachmentType') ?? 'RECEIPT');
  if (!(expenseAttachmentTypes as readonly string[]).includes(rawType)) fail(422, 'Choose a valid attachment type.');
  const paymentId = String(form.get('paymentId') ?? '') || null;
  if (paymentId && !(await c.env.DB.prepare('SELECT id FROM expense_payments WHERE id=? AND expense_id=?').bind(paymentId, row.id).first()))
    fail(422, 'Payment does not belong to this expense.');
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM expense_attachments WHERE expense_id=? AND removed_at IS NULL').bind(row.id).first<{ total: number }>();
  if ((count?.total ?? 0) >= 20) fail(422, 'Maximum 20 attachments per expense.');
  const attachmentId = makeId();
  const key = `expenses/${row.id}/${attachmentId}`;
  const timestamp = now();
  await c.env.PRODUCT_IMAGES.put(key, bytes, { httpMetadata: { contentType: mime } });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO expense_attachments(id,expense_id,payment_id,r2_key,file_name,mime_type,file_size,attachment_type,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(attachmentId,row.id,paymentId,key,file.name.slice(0,250),mime,file.size,rawType,c.get('email'),timestamp),
      c.env.DB.prepare('INSERT INTO expense_audit_logs(id,expense_id,action,details,actor_email,created_at) VALUES(?,?,?,?,?,?)').bind(makeId(),row.id,'ATTACHMENT_ADDED',JSON.stringify({fileName:file.name.slice(0,250),mimeType:mime,attachmentType:rawType}),c.get('email'),timestamp),
    ]);
  } catch (error) {
    await c.env.PRODUCT_IMAGES.delete(key);
    throw error;
  }
  return c.json({ id: attachmentId, fileName: file.name.slice(0,250), mimeType: mime, fileSize: file.size, attachmentType: rawType, createdAt: timestamp }, 201);
});
app.get('/expenses/:id/attachments/:attachmentId', async (c) => {
  const attachment = await c.env.DB.prepare('SELECT * FROM expense_attachments WHERE id=? AND expense_id=? AND removed_at IS NULL').bind(c.req.param('attachmentId'),c.req.param('id')).first<{r2_key:string;mime_type:string;file_name:string}>();
  if (!attachment) fail(404, 'Attachment not found.');
  const object = await c.env.PRODUCT_IMAGES.get(attachment.r2_key);
  if (!object) fail(404, 'Attachment file is missing.');
  return new Response(object.body, { headers: { 'Content-Type': attachment.mime_type, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});
app.delete('/expenses/:id/attachments/:attachmentId', async (c) => {
  const row = await getExpense(c.env.DB, c.req.param('id'));
  if (!row) fail(404, 'Expense not found.');
  const attachment = await c.env.DB.prepare('SELECT id,r2_key,payment_id,file_name FROM expense_attachments WHERE id=? AND expense_id=? AND removed_at IS NULL').bind(c.req.param('attachmentId'),row.id).first<{id:string;r2_key:string;payment_id:string|null;file_name:string}>();
  if (!attachment) fail(404, 'Attachment not found.');
  if (attachment.payment_id || row.paid_minor > 0) fail(409, 'Payment evidence cannot be removed.');
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE expense_attachments SET removed_at=?,removed_by=? WHERE id=?').bind(timestamp,c.get('email'),attachment.id),
    c.env.DB.prepare('INSERT INTO expense_audit_logs(id,expense_id,action,details,actor_email,created_at) VALUES(?,?,?,?,?,?)').bind(makeId(),row.id,'ATTACHMENT_REMOVED',JSON.stringify({fileName:attachment.file_name}),c.get('email'),timestamp),
  ]);
  await c.env.PRODUCT_IMAGES.delete(attachment.r2_key);
  return c.json({ success: true });
});

app.get('/finance/products/:id/cost', async (c) => {
  const product = await c.env.DB.prepare('SELECT p.id,p.sku,p.purchase_cost,p.selling_price,p.status,s.selling_price AS realized_selling_price FROM products p LEFT JOIN product_sales s ON s.product_id=p.id WHERE p.id=? AND p.archived_at IS NULL').bind(c.req.param('id')).first<{id:string;sku:string;purchase_cost:number;selling_price:number;status:string;realized_selling_price:number|null}>();
  if (!product) fail(404, 'Equipment not found.');
  const allocated = await c.env.DB.prepare('SELECT COALESCE(SUM(a.allocated_thb_minor),0) AS allocated_minor FROM expense_allocations a JOIN expenses e ON e.id=a.expense_id WHERE a.product_id=? AND e.voided_at IS NULL').bind(product.id).first<{allocated_minor:number}>();
  const purchaseCostMinor = toMinor(product.purchase_cost);
  const extraCostMinor = Number(allocated?.allocated_minor ?? 0);
  const totalCostMinor = purchaseCostMinor + extraCostMinor;
  const grossProfitMinor = toMinor(product.selling_price) - totalCostMinor;
  const realizedProfitMinor = product.realized_selling_price == null ? null : toMinor(product.realized_selling_price) - totalCostMinor;
  return c.json({sku:product.sku,purchaseCost:fromMinor(purchaseCostMinor),allocatedProductCosts:fromMinor(extraCostMinor),totalCost:fromMinor(totalCostMinor),sellingPrice:product.selling_price,estimatedGrossProfit:fromMinor(grossProfitMinor),estimatedGrossMargin:product.selling_price>0?(grossProfitMinor/toMinor(product.selling_price))*100:null,realizedSellingPrice:product.realized_selling_price,realizedGrossProfit:realizedProfitMinor == null ? null : fromMinor(realizedProfitMinor),status:product.status});
});

app.get('/finance/overview', async (c) => {
  const { from, to } = await monthRange(c.req.raw);
  const [expenseTotals, payableTotals, overdueTotals] = await Promise.all([
    c.env.DB.prepare(`SELECT expense_type,COALESCE(SUM(converted_thb_minor),0) AS total FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN ? AND ? GROUP BY expense_type`).bind(from,to).all<{expense_type:string;total:number}>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(MAX(0,e.converted_thb_minor-COALESCE((SELECT SUM(ROUND(p.amount_minor*e.exchange_rate)) FROM expense_payments p WHERE p.expense_id=e.id),0))),0) AS total FROM expenses e WHERE e.voided_at IS NULL`).first<{total:number}>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(MAX(0,e.converted_thb_minor-COALESCE((SELECT SUM(ROUND(p.amount_minor*e.exchange_rate)) FROM expense_payments p WHERE p.expense_id=e.id),0))),0) AS total FROM expenses e WHERE e.voided_at IS NULL AND e.due_date<? AND COALESCE((SELECT SUM(p.amount_minor) FROM expense_payments p WHERE p.expense_id=e.id),0)<e.amount_minor`).bind(todayBangkok()).first<{count:number;total:number}>(),
  ]);
  const totals: Record<string, number> = { OPERATING_EXPENSE: 0, INVENTORY_PURCHASE: 0, PRODUCT_COST: 0, OTHER: 0 };
  for (const row of expenseTotals.results) if (row.expense_type in totals) totals[row.expense_type] = Number(row.total);
  const payments = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(ROUND(p.amount_minor*e.exchange_rate)),0) AS paid_minor FROM expense_payments p JOIN expenses e ON e.id=p.expense_id WHERE e.voided_at IS NULL AND p.payment_date BETWEEN ? AND ?`,
  ).bind(from,to).first<{paid_minor:number}>();
  const categories = await c.env.DB.prepare(
    `SELECT c.id,c.name,c.default_expense_type AS expenseType,COALESCE(SUM(e.converted_thb_minor),0) AS totalMinor FROM expenses e JOIN expense_categories c ON c.id=e.category_id WHERE e.voided_at IS NULL AND e.expense_date BETWEEN ? AND ? GROUP BY c.id ORDER BY totalMinor DESC LIMIT 8`,
  ).bind(from,to).all<{id:string;name:string;expenseType:string;totalMinor:number}>();
  const sales = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(ROUND(selling_price*100)),0) AS revenue_minor,COALESCE(SUM(ROUND(purchase_cost*100)),0) AS cogs_minor FROM product_sales WHERE substr(sold_at,1,10) BETWEEN ? AND ?`,
  ).bind(from,to).first<{revenue_minor:number;cogs_minor:number}>();
  const allocatedSold = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(a.allocated_thb_minor),0) AS total FROM expense_allocations a JOIN expenses e ON e.id=a.expense_id AND e.voided_at IS NULL JOIN product_sales s ON s.product_id=a.product_id WHERE substr(s.sold_at,1,10) BETWEEN ? AND ?`,
  ).bind(from,to).first<{total:number}>();
  const revenue = Number(sales?.revenue_minor ?? 0);
  const cogs = Number(sales?.cogs_minor ?? 0)+Number(allocatedSold?.total ?? 0);
  const operating = totals.OPERATING_EXPENSE;
  const monthlyTrend = await c.env.DB.prepare(
    `SELECT substr(expense_date,1,7) AS month,expense_type AS expenseType,COALESCE(SUM(converted_thb_minor),0) AS totalMinor FROM expenses WHERE voided_at IS NULL AND expense_date>=date(?,'start of month','-5 months') AND expense_date<=? GROUP BY month,expense_type ORDER BY month`,
  ).bind(from,to).all<{month:string;expenseType:string;totalMinor:number}>();
  const dailyTrend = await c.env.DB.prepare(
    `SELECT expense_date AS day,COALESCE(SUM(converted_thb_minor),0) AS totalMinor FROM expenses WHERE voided_at IS NULL AND expense_date>=MAX(?,date(?,'-13 days')) AND expense_date<=? GROUP BY expense_date ORDER BY expense_date`,
  ).bind(from,to,to).all<{day:string;totalMinor:number}>();
  return c.json({
    from,to,
    expenseRecognition:{operatingExpenses:fromMinor(operating),inventoryPurchases:fromMinor(totals.INVENTORY_PURCHASE),productCosts:fromMinor(totals.PRODUCT_COST),other:fromMinor(totals.OTHER)},
    cashPaid:fromMinor(Number(payments?.paid_minor ?? 0)),
    outstandingPayables:fromMinor(Number(payableTotals?.total ?? 0)),
    overduePayables:fromMinor(Number(overdueTotals?.total ?? 0)),
    overdueCount:Number(overdueTotals?.count ?? 0),
    salesRevenue:fromMinor(revenue),
    costOfGoodsSold:fromMinor(cogs),
    grossProfit:fromMinor(revenue-cogs),
    estimatedOperatingProfit:fromMinor(revenue-cogs-operating),
    cashReceived:null,
    cashReceivedLimitation:'Customer payment tracking is not available in the current Sales module.',
    categories:categories.results.map((category)=>({...category,total:fromMinor(category.totalMinor)})),
    monthlyTrend:monthlyTrend.results.map((item)=>({...item,total:fromMinor(item.totalMinor)})),
    dailyTrend:dailyTrend.results.map((item)=>({...item,total:fromMinor(item.totalMinor)})),
  });
});

export const financeRoutes = app;
