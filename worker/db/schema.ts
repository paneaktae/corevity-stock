import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
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
  status: text('status', { enum: ['AVAILABLE', 'RESERVED', 'SOLD'] }).notNull(),
  location: text('location').notNull(),
  descriptionTh: text('description_th').notNull(),
  descriptionEn: text('description_en').notNull(),
  shortDescription: text('short_description').notNull(),
  facebookCaption: text('facebook_caption').notNull(),
  priceRating: real('price_rating'),
  designRating: real('design_rating'),
  qualityPerformanceRating: real('quality_performance_rating'),
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
