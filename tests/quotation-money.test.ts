import { describe, expect, it } from 'vitest';
import { calculateQuotationTotals, fromMinor, toMinor } from '../shared/quotation-money';

describe('quotation money', () => {
  it('uses integer minor units and rounds VAT to the nearest satang', () => {
    const totals = calculateQuotationTotals({
      lines: [{ quantity: 2, unitPriceMinor: toMinor(1000), discountMinor: toMinor(100) }],
      discountMinor: toMinor(50), deliveryFeeMinor: toMinor(100),
      installationFeeMinor: toMinor(10), otherChargesMinor: 0,
      vatEnabled: true, vatRateBps: 700, taxMode: 'EXCLUSIVE',
    });
    expect(totals.subtotalMinor).toBe(190000);
    expect(totals.beforeTaxMinor).toBe(196000);
    expect(totals.vatMinor).toBe(13720);
    expect(fromMinor(totals.grandTotalMinor)).toBe(2097.2);
  });
  it('extracts VAT from an inclusive total without adding it twice', () => {
    const totals = calculateQuotationTotals({
      lines: [{ quantity: 1, unitPriceMinor: 10700, discountMinor: 0 }],
      discountMinor: 0, deliveryFeeMinor: 0, installationFeeMinor: 0,
      otherChargesMinor: 0, vatEnabled: true, vatRateBps: 700, taxMode: 'INCLUSIVE',
    });
    expect(totals.vatMinor).toBe(700);
    expect(totals.grandTotalMinor).toBe(10700);
  });
  it('rejects discounts above a line and unsafe monetary values', () => {
    expect(() => calculateQuotationTotals({
      lines: [{ quantity: 1, unitPriceMinor: 100, discountMinor: 101 }],
      discountMinor: 0, deliveryFeeMinor: 0, installationFeeMinor: 0,
      otherChargesMinor: 0, vatEnabled: false, vatRateBps: 700, taxMode: 'EXCLUSIVE',
    })).toThrow(/discount/i);
    expect(() => toMinor(Number.MAX_SAFE_INTEGER)).toThrow(/range/i);
  });
});
