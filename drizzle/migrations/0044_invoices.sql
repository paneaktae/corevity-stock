-- Invoices issued from quotations. Stock changes are driven by invoice status:
-- DEPOSIT_COMPLETE reserves the products (reservations.invoice_id),
-- PAYMENT_COMPLETE sells them (product_sales.invoice_id). Existing reservation
-- and sale triggers keep setting products.status.

CREATE TABLE invoice_number_sequences (
  year INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL CHECK(last_number > 0)
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ISSUED','DEPOSIT_COMPLETE','PAYMENT_COMPLETE','CANCELLED')),
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'THB' CHECK(currency IN ('THB','USD')),
  customer_snapshot TEXT NOT NULL CHECK(json_valid(customer_snapshot)),
  sales_contact_email TEXT NOT NULL,
  sales_contact_name TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL CHECK(subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL CHECK(discount_minor >= 0),
  delivery_fee_minor INTEGER NOT NULL CHECK(delivery_fee_minor >= 0),
  installation_fee_minor INTEGER NOT NULL CHECK(installation_fee_minor >= 0),
  other_charges_minor INTEGER NOT NULL CHECK(other_charges_minor >= 0),
  vat_enabled INTEGER NOT NULL DEFAULT 0 CHECK(vat_enabled IN (0,1)),
  vat_rate_bps INTEGER NOT NULL DEFAULT 700 CHECK(vat_rate_bps BETWEEN 0 AND 10000),
  tax_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE' CHECK(tax_mode IN ('EXCLUSIVE','INCLUSIVE')),
  vat_minor INTEGER NOT NULL CHECK(vat_minor >= 0),
  grand_total_minor INTEGER NOT NULL CHECK(grand_total_minor >= 0),
  deposit_minor INTEGER NOT NULL DEFAULT 0 CHECK(deposit_minor >= 0 AND deposit_minor <= grand_total_minor),
  payment_terms TEXT NOT NULL DEFAULT '',
  delivery_terms TEXT NOT NULL DEFAULT '',
  warranty_terms TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX invoices_status_date_idx ON invoices(status, issue_date DESC);
CREATE INDEX invoices_customer_date_idx ON invoices(customer_id, issue_date DESC);
-- One invoice that is not cancelled per quotation.
CREATE UNIQUE INDEX invoices_active_quotation_idx ON invoices(quotation_id) WHERE status != 'CANCELLED';

CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  brand_snapshot TEXT NOT NULL,
  model_snapshot TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL,
  description_snapshot TEXT NOT NULL DEFAULT '',
  image_key_snapshot TEXT NOT NULL DEFAULT '',
  image_mime_snapshot TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0),
  discount_minor INTEGER NOT NULL CHECK(discount_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK(line_total_minor >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX invoice_items_invoice_idx ON invoice_items(invoice_id, sort_order);
CREATE UNIQUE INDEX invoice_items_product_idx ON invoice_items(invoice_id, product_id) WHERE product_id IS NOT NULL;

CREATE TABLE invoice_status_history (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK(to_status IN ('DRAFT','ISSUED','DEPOSIT_COMPLETE','PAYMENT_COMPLETE','CANCELLED')),
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX invoice_status_history_invoice_idx ON invoice_status_history(invoice_id, created_at);

ALTER TABLE reservations ADD COLUMN invoice_id TEXT REFERENCES invoices(id);
ALTER TABLE product_sales ADD COLUMN invoice_id TEXT REFERENCES invoices(id);
CREATE INDEX reservations_invoice_idx ON reservations(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX product_sales_invoice_idx ON product_sales(invoice_id) WHERE invoice_id IS NOT NULL;
