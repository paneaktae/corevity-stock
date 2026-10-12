DROP TRIGGER reservation_guard;
DROP TRIGGER reservation_created;
DROP TRIGGER reservation_released;
DROP TRIGGER product_sold;
DROP TRIGGER reservation_required;
DROP TRIGGER reserved_no_direct_release;
DROP TRIGGER sold_immutable;
DROP TRIGGER sale_guard;
DROP TRIGGER sale_created;
DROP TRIGGER archive_guard;
DROP INDEX products_status;
ALTER TABLE products ADD COLUMN status_next TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status_next IN ('AVAILABLE','NOT_AVAILABLE','RESERVED','SOLD'));
UPDATE products SET status_next=status;
ALTER TABLE products DROP COLUMN status;
ALTER TABLE products RENAME COLUMN status_next TO status;
CREATE INDEX products_status ON products(status,archived_at);
CREATE TRIGGER reservation_guard BEFORE INSERT ON reservations BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND status='AVAILABLE' AND archived_at IS NULL) THEN RAISE(ABORT,'Product is not available') END);
 SELECT (CASE WHEN NEW.lead_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM leads JOIN lead_products ON leads.id=lead_products.lead_id WHERE leads.id=NEW.lead_id AND leads.customer_id=NEW.customer_id AND lead_products.product_id=NEW.product_id AND leads.status NOT IN ('WON','LOST')) THEN RAISE(ABORT,'Reservation does not match an active lead') END);
END;
CREATE TRIGGER reservation_created AFTER INSERT ON reservations BEGIN UPDATE products SET status='RESERVED',updated_at=NEW.reserved_at WHERE id=NEW.product_id; END;
CREATE TRIGGER reservation_released AFTER DELETE ON reservations BEGIN UPDATE products SET status='AVAILABLE',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=OLD.product_id AND status='RESERVED'; END;
CREATE TRIGGER product_sold AFTER UPDATE OF status ON products WHEN NEW.status='SOLD' BEGIN DELETE FROM reservations WHERE product_id=NEW.id; END;
CREATE TRIGGER reservation_required BEFORE UPDATE OF status ON products WHEN NEW.status='RESERVED' AND NOT EXISTS(SELECT 1 FROM reservations WHERE product_id=NEW.id) BEGIN SELECT RAISE(ABORT,'Reserve this product for a customer first'); END;
CREATE TRIGGER reserved_no_direct_release BEFORE UPDATE OF status ON products WHEN OLD.status='RESERVED' AND NEW.status IN ('AVAILABLE','NOT_AVAILABLE') AND EXISTS(SELECT 1 FROM reservations WHERE product_id=NEW.id) BEGIN SELECT RAISE(ABORT,'Release the reservation first'); END;
CREATE TRIGGER sold_immutable BEFORE UPDATE OF status ON products WHEN OLD.status='SOLD' AND NEW.status!='SOLD' BEGIN SELECT RAISE(ABORT,'Sold products cannot be reopened'); END;
CREATE TRIGGER sale_guard BEFORE INSERT ON product_sales BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND status IN ('AVAILABLE','RESERVED') AND archived_at IS NULL) THEN RAISE(ABORT,'Product is not available for sale') END);
 SELECT (CASE WHEN NEW.lead_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM leads JOIN lead_products ON leads.id=lead_products.lead_id WHERE leads.id=NEW.lead_id AND leads.customer_id=NEW.customer_id AND lead_products.product_id=NEW.product_id AND leads.status!='WON') THEN RAISE(ABORT,'Sale does not match the lead') END);
 SELECT (CASE WHEN NEW.lead_id IS NOT NULL AND EXISTS(SELECT 1 FROM reservations WHERE product_id=NEW.product_id AND customer_id!=NEW.customer_id) THEN RAISE(ABORT,'Product is reserved for another customer') END);
END;
CREATE TRIGGER sale_created AFTER INSERT ON product_sales BEGIN UPDATE products SET status='SOLD',sold_at=NEW.sold_at,updated_at=NEW.sold_at WHERE id=NEW.product_id; END;
CREATE TRIGGER archive_guard BEFORE UPDATE OF archived_at ON products WHEN NEW.archived_at IS NOT NULL BEGIN
 SELECT (CASE WHEN OLD.status='RESERVED' OR EXISTS(SELECT 1 FROM leads JOIN lead_products ON leads.id=lead_products.lead_id WHERE lead_products.product_id=NEW.id AND leads.status NOT IN ('WON','LOST')) THEN RAISE(ABORT,'Product has an active reservation or lead') END);
END;

