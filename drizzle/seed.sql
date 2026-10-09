-- Development demo data only.
INSERT OR IGNORE INTO products (id,sku,brand,model,category,condition,purchase_cost,selling_price,status,location,notes,created_at,updated_at,sold_at) VALUES
('demo-life','EQ-DEMO-0001','Life Fitness','95T Elevation','Treadmill','Good',65000,95000,'AVAILABLE','Bangkok · A1','Fictional demo item. Verify condition and specifications before sale.','2026-10-09T18:14:27.296Z','2026-10-09T18:14:27.296Z',NULL),
('demo-cybex','EQ-DEMO-0002','Cybex','Arc Trainer 770AT','Cross Trainer','Excellent',48000,72000,'AVAILABLE','Bangkok · A2','Fictional demo item. Verify condition and specifications before sale.','2026-10-08T18:14:27.296Z','2026-10-09T18:14:27.296Z',NULL),
('demo-matrix','EQ-DEMO-0003','Matrix','G3 Chest Press','Strength','Good',25000,39000,'AVAILABLE','Bangkok · A3','Fictional demo item. Verify condition and specifications before sale.','2026-10-07T18:14:27.296Z','2026-10-09T18:14:27.296Z',NULL),
('demo-techno','EQ-DEMO-0004','Technogym','Excite Bike','Bike','Fair',22000,35000,'AVAILABLE','Bangkok · A4','Fictional demo item. Verify condition and specifications before sale.','2026-10-06T18:14:27.296Z','2026-10-09T18:14:27.296Z',NULL),
('demo-precor','EQ-DEMO-0005','Precor','EFX 885','Cross Trainer','Good',42000,68000,'SOLD','Bangkok · B5','Fictional demo item. Verify condition and specifications before sale.','2026-10-05T18:14:27.296Z','2026-10-09T18:14:27.296Z','2026-10-09T18:14:27.296Z'),
('demo-hammer','EQ-DEMO-0006','Hammer Strength','Iso-Lateral Row','Strength','Needs Repair',18000,29000,'AVAILABLE','Bangkok · B6','Fictional demo item. Verify condition and specifications before sale.','2026-10-04T18:14:27.296Z','2026-10-09T18:14:27.296Z',NULL);
INSERT OR IGNORE INTO customers (id,name,company_name,phone,email,budget,interested_in,notes,created_at,updated_at) VALUES
('demo-customer-1','Narin Demo','Motion Studio (Demo)','000-000-0001','demo1@example.test',150000,'Cardio equipment','Fictional customer for development.','2026-10-04T18:14:27.296Z','2026-10-09T18:14:27.296Z'),
('demo-customer-2','Mali Demo','Everyday Strength (Demo)','000-000-0002','demo2@example.test',80000,'Strength equipment','Fictional customer for development.','2026-10-04T18:14:27.296Z','2026-10-09T18:14:27.296Z'),
('demo-customer-3','Pim Demo','Home Gym (Demo)','000-000-0003','demo3@example.test',70000,'Cross trainer','Fictional customer for development.','2026-10-04T18:14:27.296Z','2026-10-09T18:14:27.296Z');
INSERT OR IGNORE INTO leads (id,customer_id,title,status,estimated_value,last_contact_at,next_follow_up_at,notes,created_at,updated_at) VALUES
('demo-lead-1','demo-customer-1','Cardio corner for new studio','QUOTED',72000,'2026-10-07T18:14:27.296Z','2026-10-08T18:14:27.296Z','Confirm inspection time and send condition photos.','2026-10-05T18:14:27.296Z','2026-10-09T18:14:27.296Z'),
('demo-lead-2','demo-customer-2','Strength floor expansion','INTERESTED',68000,'2026-10-07T18:14:27.296Z','2026-10-09T18:14:27.296Z','Confirm inspection time and send condition photos.','2026-10-05T18:14:27.296Z','2026-10-09T18:14:27.296Z'),
('demo-lead-3','demo-customer-3','Home cardio setup','WON',68000,'2026-10-07T18:14:27.296Z',NULL,'Confirm inspection time and send condition photos.','2026-10-05T18:14:27.296Z','2026-10-09T18:14:27.296Z'),
('demo-lead-4','demo-customer-1','Second treadmill enquiry','NEW',95000,'2026-10-07T18:14:27.296Z','2026-10-11T18:14:27.296Z','Confirm inspection time and send condition photos.','2026-10-05T18:14:27.296Z','2026-10-09T18:14:27.296Z');
INSERT OR IGNORE INTO lead_products (lead_id,product_id) VALUES
('demo-lead-1','demo-cybex'),
('demo-lead-1','demo-techno'),
('demo-lead-2','demo-matrix'),
('demo-lead-2','demo-hammer'),
('demo-lead-3','demo-precor'),
('demo-lead-4','demo-life');
INSERT OR IGNORE INTO reservations(id,product_id,customer_id,lead_id,reserved_at,expires_at,notes) SELECT 'demo-reservation','demo-cybex','demo-customer-1','demo-lead-1','2026-10-09T18:14:27.296Z','2026-10-12T18:14:27.296Z','Demo hold pending inspection' WHERE NOT EXISTS(SELECT 1 FROM reservations WHERE product_id='demo-cybex') AND EXISTS(SELECT 1 FROM products WHERE id='demo-cybex' AND status='AVAILABLE');
INSERT OR IGNORE INTO activities (id,entity_type,entity_id,action,description,user_email,created_at) VALUES
('demo-activity','product','demo-life','created','Demo equipment added','demo@example.test','2026-10-09T18:14:27.296Z');
