CREATE TABLE expense_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  default_expense_type TEXT NOT NULL CHECK(default_expense_type IN ('OPERATING_EXPENSE','INVENTORY_PURCHASE','PRODUCT_COST','OTHER')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO expense_categories(id,name,default_expense_type,created_at,updated_at) VALUES
  ('equipment-purchase','Equipment Purchase','INVENTORY_PURCHASE',datetime('now'),datetime('now')),
  ('international-shipping','International Shipping','PRODUCT_COST',datetime('now'),datetime('now')),
  ('import-customs','Import & Customs','PRODUCT_COST',datetime('now'),datetime('now')),
  ('domestic-transportation','Domestic Transportation','PRODUCT_COST',datetime('now'),datetime('now')),
  ('repair-maintenance','Repair & Maintenance','PRODUCT_COST',datetime('now'),datetime('now')),
  ('refurbishment','Refurbishment','PRODUCT_COST',datetime('now'),datetime('now')),
  ('advertising','Advertising','OPERATING_EXPENSE',datetime('now'),datetime('now')),
  ('marketing','Marketing','OPERATING_EXPENSE',datetime('now'),datetime('now')),
  ('software-subscription','Software & Subscription','OPERATING_EXPENSE',datetime('now'),datetime('now')),
  ('office-operations','Office & Operations','OPERATING_EXPENSE',datetime('now'),datetime('now')),
  ('travel','Travel','OPERATING_EXPENSE',datetime('now'),datetime('now')),
  ('professional-services','Professional Services','OPERATING_EXPENSE',datetime('now'),datetime('now')),
  ('other','Other','OTHER',datetime('now'),datetime('now'));

CREATE TABLE expense_number_sequences (
  year INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL CHECK(last_number > 0)
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  expense_number TEXT NOT NULL UNIQUE,
  expense_date TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  expense_type TEXT NOT NULL CHECK(expense_type IN ('OPERATING_EXPENSE','INVENTORY_PURCHASE','PRODUCT_COST','OTHER')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  currency TEXT NOT NULL CHECK(currency IN ('THB','USD','CNY','EUR')),
  exchange_rate REAL NOT NULL CHECK(exchange_rate > 0),
  converted_thb_minor INTEGER NOT NULL CHECK(converted_thb_minor > 0),
  exchange_rate_date TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  related_product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  voided_at TEXT,
  void_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX expenses_date_idx ON expenses(expense_date DESC);
CREATE INDEX expenses_category_date_idx ON expenses(category_id,expense_date DESC);
CREATE INDEX expenses_type_date_idx ON expenses(expense_type,expense_date DESC);
CREATE INDEX expenses_due_idx ON expenses(due_date) WHERE due_date IS NOT NULL AND voided_at IS NULL;

CREATE TABLE expense_payments (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  payment_date TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  reference_number TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX expense_payments_expense_date_idx ON expense_payments(expense_id,payment_date DESC);
CREATE INDEX expense_payments_date_idx ON expense_payments(payment_date DESC);

CREATE TABLE expense_allocations (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  allocated_thb_minor INTEGER NOT NULL CHECK(allocated_thb_minor >= 0),
  allocation_method TEXT NOT NULL CHECK(allocation_method IN ('EQUAL','MANUAL','PURCHASE_COST_PROPORTIONAL')),
  created_at TEXT NOT NULL,
  UNIQUE(expense_id,product_id)
);
CREATE INDEX expense_allocations_product_idx ON expense_allocations(product_id);

CREATE TABLE expense_attachments (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  payment_id TEXT REFERENCES expense_payments(id) ON DELETE RESTRICT,
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  file_size INTEGER NOT NULL CHECK(file_size > 0),
  attachment_type TEXT NOT NULL CHECK(attachment_type IN ('RECEIPT','INVOICE','PAYMENT_SLIP','OTHER')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT,
  removed_by TEXT
);
CREATE INDEX expense_attachments_expense_idx ON expense_attachments(expense_id,created_at DESC);

CREATE TABLE expense_audit_logs (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX expense_audit_expense_idx ON expense_audit_logs(expense_id,created_at DESC);

CREATE TRIGGER expense_payment_expense_guard BEFORE INSERT ON expense_payments BEGIN
  SELECT RAISE(ABORT,'Expense is unavailable for payment') WHERE NOT EXISTS(SELECT 1 FROM expenses WHERE id=NEW.expense_id AND voided_at IS NULL);
END;

CREATE TRIGGER expense_payment_balance_guard BEFORE INSERT ON expense_payments BEGIN
  SELECT RAISE(ABORT,'Payment exceeds outstanding balance') WHERE NEW.amount_minor + COALESCE((SELECT SUM(amount_minor) FROM expense_payments WHERE expense_id=NEW.expense_id),0) > (SELECT amount_minor FROM expenses WHERE id=NEW.expense_id);
END;

CREATE TRIGGER expense_void_guard BEFORE UPDATE OF voided_at ON expenses
WHEN OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'Paid expenses cannot be voided') WHERE COALESCE((SELECT SUM(amount_minor) FROM expense_payments WHERE expense_id=NEW.id),0)>0;
END;
