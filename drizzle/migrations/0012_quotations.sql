ALTER TABLE customers ADD COLUMN billing_address TEXT NOT NULL DEFAULT '';

CREATE TABLE quotation_number_sequences (
  year INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL CHECK(last_number > 0)
);

CREATE TABLE quotation_settings (
  id TEXT PRIMARY KEY CHECK(id = 'default'),
  company_name_th TEXT NOT NULL DEFAULT '',
  company_name_en TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  tax_id TEXT NOT NULL DEFAULT '',
  logo_key TEXT NOT NULL DEFAULT '',
  bank_details TEXT NOT NULL DEFAULT '',
  payment_terms TEXT NOT NULL DEFAULT '',
  delivery_terms TEXT NOT NULL DEFAULT '',
  warranty_terms TEXT NOT NULL DEFAULT '',
  default_vat_rate_bps INTEGER NOT NULL DEFAULT 700 CHECK(default_vat_rate_bps BETWEEN 0 AND 10000),
  updated_at TEXT NOT NULL
);
INSERT INTO quotation_settings(id, updated_at) VALUES ('default', datetime('now'));

CREATE TABLE quotations (
  id TEXT PRIMARY KEY,
  quotation_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED','CANCELLED')),
  issue_date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'THB' CHECK(currency IN ('THB','USD')),
  customer_snapshot TEXT NOT NULL CHECK(json_valid(customer_snapshot)),
  company_snapshot TEXT NOT NULL CHECK(json_valid(company_snapshot)),
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
  payment_terms TEXT NOT NULL DEFAULT '',
  delivery_terms TEXT NOT NULL DEFAULT '',
  warranty_terms TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX quotations_customer_date_idx ON quotations(customer_id, issue_date DESC);
CREATE INDEX quotations_status_date_idx ON quotations(status, issue_date DESC);

CREATE TABLE quotation_items (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  brand_snapshot TEXT NOT NULL,
  model_snapshot TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL,
  description_snapshot TEXT NOT NULL DEFAULT '',
  condition_snapshot TEXT NOT NULL DEFAULT '',
  image_key_snapshot TEXT NOT NULL DEFAULT '',
  image_mime_snapshot TEXT NOT NULL DEFAULT '',
  image_id_snapshot TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0),
  discount_minor INTEGER NOT NULL CHECK(discount_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK(line_total_minor >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX quotation_items_quote_idx ON quotation_items(quotation_id, sort_order);

CREATE TABLE quotation_status_history (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK(to_status IN ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED','CANCELLED')),
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX quotation_status_history_quote_idx ON quotation_status_history(quotation_id, created_at);
