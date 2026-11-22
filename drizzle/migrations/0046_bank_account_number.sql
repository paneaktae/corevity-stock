-- Bank account number printed on invoices. The existing bank_details /
-- bank_details_en columns now hold the bank account name (Thai / English).
ALTER TABLE quotation_settings ADD COLUMN bank_account_number TEXT NOT NULL DEFAULT '';
