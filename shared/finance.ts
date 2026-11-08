import { z } from 'zod';

export const expenseTypes = [
  'OPERATING_EXPENSE',
  'INVENTORY_PURCHASE',
  'PRODUCT_COST',
  'OTHER',
] as const;
export const expenseCurrencies = ['THB', 'USD', 'CNY', 'EUR'] as const;
export const paymentMethods = [
  'BANK_TRANSFER',
  'CASH',
  'CARD',
  'OTHER',
] as const;
export const allocationMethods = [
  'EQUAL',
  'MANUAL',
  'PURCHASE_COST_PROPORTIONAL',
] as const;
export const expenseAttachmentTypes = [
  'RECEIPT',
  'INVOICE',
  'PAYMENT_SLIP',
  'OTHER',
] as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().finite().min(0).max(999999999);
export const expenseCategoryInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    defaultExpenseType: z.enum(expenseTypes),
    isActive: z.boolean().default(true),
  })
  .strict();
export const expenseInput = z
  .object({
    expenseDate: date,
    description: z.string().trim().min(1).max(500),
    categoryId: z.string().min(1),
    expenseType: z.enum(expenseTypes).optional(),
    amount: money.refine((value) => value > 0, 'Amount must be greater than zero.'),
    currency: z.enum(expenseCurrencies).default('THB'),
    exchangeRate: z.number().finite().positive().max(100000).default(1),
    exchangeRateDate: date.optional(),
    vendor: z.string().trim().max(200).default(''),
    paymentMethod: z.string().trim().max(40).default(''),
    dueDate: date.nullable().default(null),
    relatedProductId: z.string().nullable().default(null),
    notes: z.string().max(5000).default(''),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export const expenseUpdateInput = expenseInput.omit({ idempotencyKey: true }).partial().strict();
export const expensePaymentInput = z
  .object({
    amount: money.refine((value) => value > 0, 'Amount must be greater than zero.'),
    paymentDate: date,
    paymentMethod: z.enum(paymentMethods),
    referenceNumber: z.string().trim().max(200).default(''),
    notes: z.string().max(2000).default(''),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export const expenseAllocationInput = z
  .object({
    method: z.enum(allocationMethods),
    allocations: z
      .array(
        z
          .object({
            productId: z.string().min(1),
            amount: money.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export type ExpenseType = (typeof expenseTypes)[number];
export type ExpenseCurrency = (typeof expenseCurrencies)[number];
export type PaymentMethod = (typeof paymentMethods)[number];
export type AllocationMethod = (typeof allocationMethods)[number];
export type ExpenseCategoryInput = z.infer<typeof expenseCategoryInput>;
export type ExpenseInput = z.infer<typeof expenseInput>;
