import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { primaryKey } from 'drizzle-orm/sqlite-core';
const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
};
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  brand: text('brand').notNull(),
  model: text('model').notNull(),
  category: text('category').notNull(),
  serialNumber: text('serial_number').notNull(),
  condition: text('condition').notNull(),
  purchaseCost: real('purchase_cost').notNull(),
  sellingPrice: real('selling_price').notNull(),
  status: text('status', {
    enum: ['AVAILABLE', 'NOT_AVAILABLE', 'RESERVED', 'SOLD'],
  }).notNull(),
  location: text('location').notNull(),
  descriptionTh: text('description_th').notNull(),
  descriptionEn: text('description_en').notNull(),
  shortDescription: text('short_description').notNull(),
  facebookCaption: text('facebook_caption').notNull(),
  priceRating: real('price_rating'),
  designRating: real('design_rating'),
  qualityPerformanceRating: real('quality_performance_rating'),
  features: text('features').notNull().default('[]'),
  strengths: text('strengths').notNull().default('[]'),
  weaknesses: text('weaknesses').notNull().default('[]'),
  analysisSources: text('analysis_sources').notNull().default('[]'),
  ratingReasons: text('rating_reasons').notNull().default('{}'),
  isPublished: integer('is_published', { mode: 'boolean' })
    .notNull()
    .default(false),
  showPrice: integer('show_price', { mode: 'boolean' })
    .notNull()
    .default(false),
  publicSlug: text('public_slug'),
  publicDescriptionTh: text('public_description_th').notNull().default(''),
  publicDescriptionEn: text('public_description_en').notNull().default(''),
  publishedAt: text('published_at'),
  notes: text('notes').notNull(),
  soldAt: text('sold_at'),
  archivedAt: text('archived_at'),
  ...timestamps,
});
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  companyName: text('company_name').notNull(),
  contactName: text('contact_name').notNull(),
  phone: text('phone').notNull(),
  lineId: text('line_id').notNull(),
  email: text('email').notNull(),
  billingAddress: text('billing_address').notNull(),
  budget: real('budget').notNull(),
  interestedIn: text('interested_in').notNull(),
  notes: text('notes').notNull(),
  ...timestamps,
});
export const leads = sqliteTable('leads', {
  id: text('id').primaryKey(),
  customerId: text('customer_id')
    .notNull()
    .references(() => customers.id),
  title: text('title').notNull(),
  status: text('status', {
    enum: ['NEW', 'CONTACTED', 'INTERESTED', 'QUOTED', 'WON', 'LOST'],
  }).notNull(),
  assignedTo: text('assigned_to').notNull().default(''),
  estimatedValue: real('estimated_value').notNull(),
  lastContactAt: text('last_contact_at'),
  nextFollowUpAt: text('next_follow_up_at'),
  notes: text('notes').notNull(),
  ...timestamps,
});
export const leadProducts = sqliteTable('lead_products', {
  leadId: text('lead_id')
    .notNull()
    .references(() => leads.id),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
});
export const images = sqliteTable('product_images', {
  id: text('id').primaryKey(),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  r2Key: text('r2_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  sortOrder: integer('sort_order').notNull(),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
});
export const reservations = sqliteTable('reservations', {
  id: text('id').primaryKey(),
  productId: text('product_id')
    .notNull()
    .unique()
    .references(() => products.id),
  customerId: text('customer_id')
    .notNull()
    .references(() => customers.id),
  leadId: text('lead_id').references(() => leads.id),
  reservedAt: text('reserved_at').notNull(),
  expiresAt: text('expires_at'),
  notes: text('notes').notNull(),
});
export const activities = sqliteTable('activities', {
  id: text('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  description: text('description').notNull(),
  userEmail: text('user_email').notNull(),
  createdAt: text('created_at').notNull(),
});
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
export const quotationNumberSequences = sqliteTable(
  'quotation_number_sequences',
  {
    year: integer('year').primaryKey(),
    lastNumber: integer('last_number').notNull(),
  },
);
export const quotationSettings = sqliteTable('quotation_settings', {
  id: text('id').primaryKey(),
  companyNameTh: text('company_name_th').notNull(),
  companyNameEn: text('company_name_en').notNull(),
  address: text('address').notNull(),
  phone: text('phone').notNull(),
  email: text('email').notNull(),
  taxId: text('tax_id').notNull(),
  lineUrl: text('line_url').notNull().default(''),
  facebookUrl: text('facebook_url').notNull().default(''),
  logoKey: text('logo_key').notNull(),
  bankDetails: text('bank_details').notNull(),
  paymentTerms: text('payment_terms').notNull(),
  deliveryTerms: text('delivery_terms').notNull(),
  warrantyTerms: text('warranty_terms').notNull(),
  defaultVatRateBps: integer('default_vat_rate_bps').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const quotations = sqliteTable('quotations', {
  id: text('id').primaryKey(),
  quotationNumber: text('quotation_number').notNull().unique(),
  customerId: text('customer_id').notNull(),
  leadId: text('lead_id'),
  status: text('status').notNull(),
  issueDate: text('issue_date').notNull(),
  validUntil: text('valid_until').notNull(),
  currency: text('currency').notNull(),
  customerSnapshot: text('customer_snapshot').notNull(),
  companySnapshot: text('company_snapshot').notNull(),
  salesContactEmail: text('sales_contact_email').notNull(),
  salesContactName: text('sales_contact_name').notNull(),
  subtotalMinor: integer('subtotal_minor').notNull(),
  discountMinor: integer('discount_minor').notNull(),
  deliveryFeeMinor: integer('delivery_fee_minor').notNull(),
  installationFeeMinor: integer('installation_fee_minor').notNull(),
  otherChargesMinor: integer('other_charges_minor').notNull(),
  vatEnabled: integer('vat_enabled', { mode: 'boolean' }).notNull(),
  vatRateBps: integer('vat_rate_bps').notNull(),
  taxMode: text('tax_mode').notNull(),
  vatMinor: integer('vat_minor').notNull(),
  grandTotalMinor: integer('grand_total_minor').notNull(),
  paymentTerms: text('payment_terms').notNull(),
  deliveryTerms: text('delivery_terms').notNull(),
  warrantyTerms: text('warranty_terms').notNull(),
  notes: text('notes').notNull(),
  createdBy: text('created_by').notNull(),
  ...timestamps,
});
export const quotationItems = sqliteTable('quotation_items', {
  id: text('id').primaryKey(),
  quotationId: text('quotation_id').notNull(),
  productId: text('product_id'),
  productNameSnapshot: text('product_name_snapshot').notNull(),
  brandSnapshot: text('brand_snapshot').notNull(),
  modelSnapshot: text('model_snapshot').notNull(),
  skuSnapshot: text('sku_snapshot').notNull(),
  descriptionSnapshot: text('description_snapshot').notNull(),
  conditionSnapshot: text('condition_snapshot').notNull(),
  imageKeySnapshot: text('image_key_snapshot').notNull(),
  imageMimeSnapshot: text('image_mime_snapshot').notNull(),
  imageIdSnapshot: text('image_id_snapshot').notNull(),
  quantity: integer('quantity').notNull(),
  unitPriceMinor: integer('unit_price_minor').notNull(),
  discountMinor: integer('discount_minor').notNull(),
  lineTotalMinor: integer('line_total_minor').notNull(),
  sortOrder: integer('sort_order').notNull(),
});
export const quotationStatusHistory = sqliteTable(
  'quotation_status_history',
  {
    id: text('id').primaryKey(),
    quotationId: text('quotation_id').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    changedBy: text('changed_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
);
export const productSales = sqliteTable('product_sales', {
  productId: text('product_id')
    .primaryKey()
    .references(() => products.id),
  leadId: text('lead_id').references(() => leads.id),
  customerId: text('customer_id').references(() => customers.id),
  soldAt: text('sold_at').notNull(),
  sellingPrice: real('selling_price').notNull(),
  purchaseCost: real('purchase_cost').notNull(),
});

export const salespeople = sqliteTable('salespeople', {
  email: text('email').primaryKey(),
  firstName: text('first_name').notNull().default(''),
  lastName: text('last_name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
});
export const chatMessages = sqliteTable('chat_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestId: text('request_id').notNull(),
  senderEmail: text('sender_email').notNull(),
  body: text('body').notNull(),
  productIds: text('product_ids').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
});
export const assistantMessages = sqliteTable('assistant_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userEmail: text('user_email').notNull(),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  body: text('body').notNull(),
  productIds: text('product_ids').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
});

export const catalogs = sqliteTable('catalogs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  slug: text('slug').notNull().unique(),
  status: text('status', { enum: ['ACTIVE', 'ARCHIVED'] })
    .notNull()
    .default('ACTIVE'),
  customerId: text('customer_id').references(() => customers.id, {
    onDelete: 'set null',
  }),
  showPrices: integer('show_prices', { mode: 'boolean' })
    .notNull()
    .default(true),
  showSold: integer('show_sold', { mode: 'boolean' }).notNull().default(false),
  expiresAt: text('expires_at'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  assignedSalespersonEmail: text('assigned_salesperson_email')
    .notNull()
    .default(''),
});
export const catalogItems = sqliteTable('catalog_items', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id')
    .notNull()
    .references(() => catalogs.id, { onDelete: 'cascade' }),
  productId: text('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  productNameSnapshot: text('product_name_snapshot').notNull(),
  brandSnapshot: text('brand_snapshot').notNull(),
  modelSnapshot: text('model_snapshot').notNull(),
  categorySnapshot: text('category_snapshot').notNull(),
  conditionSnapshot: text('condition_snapshot').notNull(),
  descriptionSnapshot: text('description_snapshot').notNull(),
  imageKeySnapshot: text('image_key_snapshot').notNull().default(''),
  imageMimeSnapshot: text('image_mime_snapshot').notNull().default(''),
  displayPrice: real('display_price'),
});
export const catalogEvents = sqliteTable('catalog_events', {
  entityType: text('entity_type').notNull(),
  entitySlug: text('entity_slug').notNull(),
  eventType: text('event_type').notNull(),
  hour: text('hour').notNull(),
  count: integer('count').notNull().default(0),
});

export const catalogChats = sqliteTable('catalog_chats', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  catalogSlug: text('catalog_slug').notNull().default(''),
  catalogTitle: text('catalog_title').notNull().default(''),
  assignedEmail: text('assigned_email').notNull().default(''),
  visitorName: text('visitor_name').notNull().default(''),
  status: text('status', { enum: ['OPEN', 'CLOSED'] })
    .notNull()
    .default('OPEN'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastMessageAt: text('last_message_at').notNull(),
  visitorPhone: text('visitor_phone').notNull().default(''),
});
export const catalogChatMessages = sqliteTable('catalog_chat_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: text('chat_id')
    .notNull()
    .references(() => catalogChats.id, { onDelete: 'cascade' }),
  senderType: text('sender_type', {
    enum: ['VISITOR', 'SALESPERSON'],
  }).notNull(),
  senderEmail: text('sender_email').notNull().default(''),
  body: text('body').notNull(),
  products: text('products').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
});
export const catalogChatRateLimits = sqliteTable(
  'catalog_chat_rate_limits',
  {
    visitorHash: text('visitor_hash').notNull(),
    scope: text('scope', { enum: ['thread', 'message'] }).notNull(),
    windowStart: text('window_start').notNull(),
    requestCount: integer('request_count').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.visitorHash, table.scope, table.windowStart],
    }),
  }),
);
