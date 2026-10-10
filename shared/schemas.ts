import { z } from 'zod';
export const productStatuses = ['AVAILABLE', 'RESERVED', 'SOLD'] as const;
export const leadStatuses = [
  'NEW',
  'CONTACTED',
  'INTERESTED',
  'QUOTED',
  'WON',
  'LOST',
] as const;
const text = z.string().trim().max(10000).default('');
const money = z
  .number()
  .finite()
  .min(0)
  .max(999999999)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
    'Use no more than two decimal places',
  )
  .default(0);
export const productInput = z.object({
  brand: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).optional(),
  category: text,
  serialNumber: text,
  condition: text,
  purchaseCost: money,
  sellingPrice: money,
  status: z.enum(productStatuses).default('AVAILABLE'),
  location: text,
  descriptionTh: text,
  descriptionEn: text,
  shortDescription: text,
  facebookCaption: text,
  notes: text,
});
export const customerInput = z.object({
  name: z.string().trim().min(1).max(200),
  companyName: text,
  contactName: text,
  phone: text,
  lineId: text,
  email: z.union([z.literal(''), z.string().email()]).default(''),
  budget: money,
  interestedIn: text,
  notes: text,
});
export const leadInput = z.object({
  customerId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  status: z.enum(leadStatuses).default('NEW'),
  assignedTo: z.union([z.literal(''), z.string().email()]).default(''),
  estimatedValue: money,
  lastContactAt: z.string().datetime().nullable().default(null),
  nextFollowUpAt: z.string().datetime().nullable().default(null),
  notes: text,
  productIds: z.array(z.string()).max(100).default([]),
});
export const descriptionSchema = z
  .object({
    descriptionTh: z.string().max(10000),
    descriptionEn: z.string().max(10000),
    shortDescription: z.string().max(2000),
    facebookCaption: z.string().max(10000),
  })
  .strict();
export const generateInput = z.object({
  target: z
    .enum([
      'all',
      'descriptionTh',
      'descriptionEn',
      'shortDescription',
      'facebookCaption',
    ])
    .default('all'),
});
export type ProductInput = z.infer<typeof productInput>;
export type CustomerInput = z.infer<typeof customerInput>;
export type LeadInput = z.infer<typeof leadInput>;
export type Descriptions = z.infer<typeof descriptionSchema>;
export type Product = ProductInput & {
  id: string;
  sku: string;
  createdAt: string;
  updatedAt: string;
  soldAt: string | null;
  archivedAt: string | null;
  primaryImageId?: string | null;
  reservedCustomerName?: string | null;
};
export type ProductImage = {
  id: string;
  productId: string;
  r2Key: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: string;
};
export type Customer = CustomerInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
export type Lead = LeadInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  customerName?: string;
  products?: Product[];
};
export type Activity = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  description: string;
  userEmail: string;
  createdAt: string;
};
export type Reservation = {
  id: string;
  productId: string;
  customerId: string;
  leadId: string | null;
  reservedAt: string;
  expiresAt: string | null;
  notes: string;
  customerName?: string;
};
export type Settings = {
  conditions: string[];
  userEmail: string;
  environment: string;
  aiConfigured: boolean;
  maxUploadMB: number;
  timezone: string;
};
export type ProductDetail = {
  product: Product;
  images: ProductImage[];
  reservation: Reservation | null;
  activities: Activity[];
};
export type CustomerDetail = {
  customer: Customer;
  leads: Lead[];
  activities: Activity[];
};
export type LeadDetail = {
  lead: Lead;
  customer: Customer;
  products: Product[];
  activities: Activity[];
};
export type Dashboard = {
  available: number;
  reserved: number;
  soldThisMonth: number;
  inventoryCostValue: number;
  activeLeads: number;
  dueToday: number;
  overdue: number;
  recentProducts: Product[];
  followups: Lead[];
  recentSales: Product[];
};

export const salespersonInput = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    phone: z.string().trim().max(50).default(''),
  })
  .strict();
export type SalespersonInput = z.infer<typeof salespersonInput>;
export type Salesperson = SalespersonInput & {
  email: string;
  lineReady: boolean;
};
export function salespersonName(sale: Salesperson) {
  return (
    [sale.firstName, sale.lastName].filter(Boolean).join(' ') || sale.email
  );
}

export const chatInput = z
  .object({
    requestId: z.string().uuid(),
    body: z.string().trim().max(2000).default(''),
    productIds: z.array(z.string().min(1).max(100)).max(3).default([]),
  })
  .strict()
  .refine((v) => !!v.body || v.productIds.length > 0, {
    message: 'Write a message or attach equipment.',
  })
  .refine((v) => new Set(v.productIds).size === v.productIds.length, {
    message: 'Each equipment item can only be attached once.',
  });
export type ChatProduct = Pick<
  Product,
  | 'id'
  | 'sku'
  | 'brand'
  | 'model'
  | 'status'
  | 'sellingPrice'
  | 'primaryImageId'
  | 'archivedAt'
>;
export type ChatMessage = {
  id: number;
  senderEmail: string;
  senderName: string;
  body: string;
  createdAt: string;
  products: ChatProduct[];
};
export type ChatPage = {
  messages: ChatMessage[];
  hasMore: boolean;
  userEmail: string;
};
