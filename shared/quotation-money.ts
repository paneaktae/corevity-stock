export function toMinor(value: number): number {
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new RangeError('Quotation amount exceeds the supported range.');
  return result;
}

export function fromMinor(value: number): number {
  return value / 100;
}

export type LineInput = {
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
};
export type TotalsInput = {
  lines: LineInput[];
  discountMinor: number;
  deliveryFeeMinor: number;
  installationFeeMinor: number;
  otherChargesMinor: number;
  vatEnabled: boolean;
  vatRateBps: number;
  taxMode: 'EXCLUSIVE' | 'INCLUSIVE';
};
export type Totals = {
  lineTotalsMinor: number[];
  subtotalMinor: number;
  beforeTaxMinor: number;
  vatMinor: number;
  grandTotalMinor: number;
};

function safe(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('Quotation total exceeds the supported range.');
  return value;
}

export function calculateQuotationTotals(input: TotalsInput): Totals {
  const lineTotalsMinor = input.lines.map((line) => {
    const gross = safe(line.quantity * line.unitPriceMinor);
    if (line.discountMinor > gross)
      throw new RangeError('Item discount cannot exceed its line amount.');
    return safe(gross - line.discountMinor);
  });
  const subtotalMinor = safe(
    lineTotalsMinor.reduce((sum, total) => safe(sum + total), 0),
  );
  if (input.discountMinor > subtotalMinor)
    throw new RangeError('Quotation discount cannot exceed the subtotal.');
  const beforeTaxMinor = safe(
    subtotalMinor -
      input.discountMinor +
      input.deliveryFeeMinor +
      input.installationFeeMinor +
      input.otherChargesMinor,
  );
  const vatMinor = input.vatEnabled
    ? input.taxMode === 'INCLUSIVE'
      ? Math.round(
          (beforeTaxMinor * input.vatRateBps) / (10000 + input.vatRateBps),
        )
      : Math.round((beforeTaxMinor * input.vatRateBps) / 10000)
    : 0;
  safe(vatMinor);
  return {
    lineTotalsMinor,
    subtotalMinor,
    beforeTaxMinor,
    vatMinor,
    grandTotalMinor:
      input.vatEnabled && input.taxMode === 'INCLUSIVE'
        ? beforeTaxMinor
        : safe(beforeTaxMinor + vatMinor),
  };
}
