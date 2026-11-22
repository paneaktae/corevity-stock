-- English versions of quotation/invoice terms. The existing columns hold the
-- Thai text; Thai documents print it, English documents print the *_en text
-- and fall back to the Thai text when it is empty.
ALTER TABLE quotation_settings ADD COLUMN payment_terms_en TEXT NOT NULL DEFAULT '';
ALTER TABLE quotation_settings ADD COLUMN delivery_terms_en TEXT NOT NULL DEFAULT '';
ALTER TABLE quotation_settings ADD COLUMN warranty_terms_en TEXT NOT NULL DEFAULT '';
ALTER TABLE quotation_settings ADD COLUMN bank_details_en TEXT NOT NULL DEFAULT '';
ALTER TABLE quotations ADD COLUMN payment_terms_en TEXT NOT NULL DEFAULT '';
ALTER TABLE quotations ADD COLUMN delivery_terms_en TEXT NOT NULL DEFAULT '';
ALTER TABLE quotations ADD COLUMN warranty_terms_en TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN payment_terms_en TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN warranty_terms_en TEXT NOT NULL DEFAULT '';
