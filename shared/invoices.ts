import { z } from 'zod';
import { money } from './schemas';
import type {
  QuotationCompanySnapshot,
  QuotationCustomerSnapshot,
} from './quotations';

export const invoiceStatuses = [
  'DRAFT',
  'ISSUED',
  'DEPOSIT_COMPLETE',
  'PAYMENT_COMPLETE',
  'CANCELLED',
] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

/**
 * Allowed status changes. DEPOSIT_COMPLETE reserves the invoice's products and
 * PAYMENT_COMPLETE sells them; a fully paid invoice can no longer change.
 */
export const invoiceTransitions: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ['ISSUED', 'CANCELLED'],
  ISSUED: ['DEPOSIT_COMPLETE', 'PAYMENT_COMPLETE', 'CANCELLED'],
  DEPOSIT_COMPLETE: ['PAYMENT_COMPLETE', 'CANCELLED'],
  PAYMENT_COMPLETE: [],
  CANCELLED: [],
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const invoiceItemUpdate = z
  .object({
    id: z.string().min(1),
    displayName: z.string().trim().min(1).max(200),
    description: z.string().trim().max(3000).default(''),
    quantity: z.number().int().min(1).max(10000),
    unitPrice: money,
    discount: money,
  })
  .strict();
export const invoiceUpdateInput = z
  .object({
    issueDate: date,
    dueDate: date,
    items: z.array(invoiceItemUpdate).min(1).max(100),
    discount: money,
    deliveryFee: money,
    installationFee: money,
    otherCharges: money,
    vatEnabled: z.boolean(),
    vatRate: z.number().finite().min(0).max(100),
    taxMode: z.enum(['EXCLUSIVE', 'INCLUSIVE']),
    depositAmount: money,
    paymentTerms: z.string().trim().max(2000).default(''),
    paymentTermsEn: z.string().trim().max(2000).default(''),
    warrantyTerms: z.string().trim().max(2000).default(''),
    warrantyTermsEn: z.string().trim().max(2000).default(''),
    notes: z.string().trim().max(5000).default(''),
  })
  .strict()
  .refine((value) => value.dueDate >= value.issueDate, {
    path: ['dueDate'],
    message: 'Due date must be on or after issue date.',
  });
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateInput>;

export type InvoiceItem = {
  id: string;
  productId: string | null;
  productName: string;
  brand: string;
  model: string;
  sku: string;
  description: string;
  specification: string;
  imageAvailable: boolean;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  sortOrder: number;
  productStatus: string | null;
  /** Customer the product is currently reserved for, when reserved. */
  reservedForCustomerId: string | null;
};
export type Invoice = {
  id: string;
  invoiceNumber: string;
  quotationId: string;
  quotationNumber: string;
  customerId: string;
  leadId: string | null;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  currency: 'THB' | 'USD';
  customer: QuotationCustomerSnapshot;
  company: QuotationCompanySnapshot;
  salesContactEmail: string;
  salesContactName: string;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  installationFee: number;
  otherCharges: number;
  vatEnabled: boolean;
  vatRate: number;
  taxMode: 'EXCLUSIVE' | 'INCLUSIVE';
  vatAmount: number;
  grandTotal: number;
  beforeTax: number;
  depositAmount: number;
  /** Invoices carry payment and warranty terms only (no delivery terms). */
  paymentTerms: string;
  paymentTermsEn: string;
  warrantyTerms: string;
  warrantyTermsEn: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  history: {
    id: string;
    fromStatus: InvoiceStatus | null;
    toStatus: InvoiceStatus;
    changedBy: string;
    createdAt: string;
  }[];
};
export type InvoiceListItem = Pick<
  Invoice,
  | 'id'
  | 'invoiceNumber'
  | 'quotationId'
  | 'quotationNumber'
  | 'customerId'
  | 'customer'
  | 'issueDate'
  | 'dueDate'
  | 'currency'
  | 'status'
  | 'createdAt'
> & { total: number };
/** Invoice linked to a quotation, shown on the quotation page. */
export type QuotationInvoiceLink = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
};
