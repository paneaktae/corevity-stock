-- Sale records enforce exclusive sale ownership and preserve the prices at sale time.
CREATE TABLE product_sales (product_id TEXT PRIMARY KEY REFERENCES products(id), lead_id TEXT REFERENCES leads(id), customer_id TEXT REFERENCES customers(id), sold_at TEXT NOT NULL, selling_price REAL NOT NULL, purchase_cost REAL NOT NULL);
CREATE TRIGGER sale_guard BEFORE INSERT ON product_sales BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND status!='SOLD' AND archived_at IS NULL) THEN RAISE(ABORT,'Product is not available for sale') END);
 SELECT (CASE WHEN NEW.lead_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM leads JOIN lead_products ON leads.id=lead_products.lead_id WHERE leads.id=NEW.lead_id AND leads.customer_id=NEW.customer_id AND lead_products.product_id=NEW.product_id AND leads.status!='WON') THEN RAISE(ABORT,'Sale does not match the lead') END);
 SELECT (CASE WHEN NEW.lead_id IS NOT NULL AND EXISTS(SELECT 1 FROM reservations WHERE product_id=NEW.product_id AND customer_id!=NEW.customer_id) THEN RAISE(ABORT,'Product is reserved for another customer') END);
END;
CREATE TRIGGER sale_created AFTER INSERT ON product_sales BEGIN UPDATE products SET status='SOLD',sold_at=NEW.sold_at,updated_at=NEW.sold_at WHERE id=NEW.product_id; END;
