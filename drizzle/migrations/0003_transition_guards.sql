CREATE TRIGGER won_once BEFORE UPDATE OF status ON leads WHEN OLD.status='WON' AND NEW.status='WON' BEGIN SELECT RAISE(ABORT,'Lead is already won'); END;
CREATE TRIGGER archive_guard BEFORE UPDATE OF archived_at ON products WHEN NEW.archived_at IS NOT NULL BEGIN
 SELECT (CASE WHEN OLD.status='RESERVED' OR EXISTS(SELECT 1 FROM leads JOIN lead_products ON leads.id=lead_products.lead_id WHERE lead_products.product_id=NEW.id AND leads.status NOT IN ('WON','LOST')) THEN RAISE(ABORT,'Product has an active reservation or lead') END);
END;
