import { z } from 'zod';
import { money } from './schemas';
import type { QuotationInvoiceLink } from './invoices';

export const quotationStatuses = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type QuotationStatus = (typeof quotationStatuses)[number];

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const quotationItemInput = z
  .object({
    productId: z.string().min(1),
    imageId: z.string().max(100).nullable().default(null),
    displayName: z.string().trim().min(1).max(200),
    description: z.string().trim().max(3000).default(''),
    quantity: z.number().int().min(1).max(10000),
    unitPrice: money,
    discount: money,
  })
  .strict();
export const quotationInput = z
  .object({
    customerId: z.string().min(1),
    leadId: z.string().min(1).nullable().default(null),
    issueDate: date,
    validUntil: date,
    currency: z.enum(['THB', 'USD']).default('THB'),
    items: z.array(quotationItemInput).min(1).max(100),
    discount: money,
    deliveryFee: money,
    installationFee: money,
    otherCharges: money,
    vatEnabled: z.boolean().default(false),
    vatRate: z.number().finite().min(0).max(100).default(7),
    taxMode: z.enum(['EXCLUSIVE', 'INCLUSIVE']).default('EXCLUSIVE'),
    paymentTerms: z.string().trim().max(2000).default(''),
    deliveryTerms: z.string().trim().max(2000).default(''),
    warrantyTerms: z.string().trim().max(2000).default(''),
    paymentTermsEn: z.string().trim().max(2000).default(''),
    deliveryTermsEn: z.string().trim().max(2000).default(''),
    warrantyTermsEn: z.string().trim().max(2000).default(''),
    notes: z.string().trim().max(5000).default(''),
  })
  .strict()
  .refine((value) => value.validUntil >= value.issueDate, {
    path: ['validUntil'],
    message: 'Valid until must be on or after issue date.',
  });
export type QuotationInput = z.infer<typeof quotationInput>;
export type QuotationItemInput = z.infer<typeof quotationItemInput>;

export const quotationSettingsInput = z
  .object({
    companyNameTh: z.string().trim().max(200),
    companyNameEn: z.string().trim().max(200),
    address: z.string().trim().max(2000),
    phone: z.string().trim().max(100),
    email: z.union([z.literal(''), z.string().email()]),
    taxId: z.string().trim().max(100),
    lineUrl: z.union([z.literal(''), z.string().url()]).default(''),
    facebookUrl: z.union([z.literal(''), z.string().url()]).default(''),
    bankDetails: z.string().trim().max(2000),
    paymentTerms: z.string().trim().max(2000),
    deliveryTerms: z.string().trim().max(2000),
    warrantyTerms: z.string().trim().max(2000),
    paymentTermsEn: z.string().trim().max(2000).default(''),
    deliveryTermsEn: z.string().trim().max(2000).default(''),
    warrantyTermsEn: z.string().trim().max(2000).default(''),
    bankDetailsEn: z.string().trim().max(2000).default(''),
    defaultVatRate: z.number().finite().min(0).max(100),
  })
  .strict();
export type QuotationSettingsInput = z.infer<typeof quotationSettingsInput>;

export type QuotationCustomerSnapshot = {
  name: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  billingAddress: string;
};
export type QuotationCompanySnapshot = QuotationSettingsInput & {
  logoAvailable: boolean;
};
export type QuotationItem = {
  id: string;
  productId: string | null;
  productName: string;
  brand: string;
  model: string;
  sku: string;
  description: string;
  condition: string;
  /** Product specification (Inventory "Specification"), read live from the product. */
  specification: string;
  imageAvailable: boolean;
  imageId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  sortOrder: number;
  productStatus: string | null;
};
export type Quotation = {
  id: string;
  quotationNumber: string;
  customerId: string;
  leadId: string | null;
  status: QuotationStatus;
  issueDate: string;
  validUntil: string;
  currency: 'THB' | 'USD';
  customer: QuotationCustomerSnapshot;
  company: QuotationCompanySnapshot;
  salesContactEmail: string;
  salesContactName: string;
  items: QuotationItem[];
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
  paymentTerms: string;
  deliveryTerms: string;
  warrantyTerms: string;
  paymentTermsEn: string;
  deliveryTermsEn: string;
  warrantyTermsEn: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Latest invoice issued from this quotation (a cancelled one only if no other exists). */
  invoice?: QuotationInvoiceLink | null;
  history: {
    id: string;
    fromStatus: QuotationStatus | null;
    toStatus: QuotationStatus;
    changedBy: string;
    createdAt: string;
  }[];
};

/** Brand name printed as the company title on English quotations. */
export const QUOTATION_ENGLISH_BRAND = 'COREVITY';

/**
 * Company title and optional second line for a quotation header/footer.
 * Thai: Thai name, with the English name underneath. English: COREVITY, with
 * the English company name underneath when it says something more.
 */
export function quotationCompanyNames(
  company: Pick<QuotationSettingsInput, 'companyNameTh' | 'companyNameEn'>,
  language: 'th' | 'en',
): { title: string; subtitle: string } {
  if (language === 'en') {
    const english = company.companyNameEn.trim();
    return {
      title: QUOTATION_ENGLISH_BRAND,
      subtitle:
        english.toUpperCase() === QUOTATION_ENGLISH_BRAND ? '' : english,
    };
  }
  return {
    title: company.companyNameTh || company.companyNameEn || 'Corevity',
    subtitle:
      company.companyNameTh && company.companyNameEn
        ? company.companyNameEn
        : '',
  };
}

/**
 * Name shown for a quotation item: the saved product name followed by the
 * product's specification (skipped when the name already contains it).
 */
export function quotationItemTitle(name: string, specification: string): string {
  const spec = specification.trim();
  if (!spec || name.toLowerCase().includes(spec.toLowerCase())) return name;
  return `${name} ${spec}`;
}

/** Thai and English versions of the terms printed at the bottom of a document. */
export type BilingualTerms = {
  paymentTerms: string;
  paymentTermsEn: string;
  deliveryTerms: string;
  deliveryTermsEn: string;
  warrantyTerms: string;
  warrantyTermsEn: string;
};
/**
 * Picks a term for the document language: Thai uses the Thai text, English
 * uses the English text; either falls back to the other when it is empty.
 */
export function termFor(
  thai: string | undefined,
  english: string | undefined,
  language: 'th' | 'en',
): string {
  const [first = '', second = ''] = language === 'en' ? [english, thai] : [thai, english];
  return first.trim() ? first : second;
}
