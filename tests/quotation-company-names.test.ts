import { describe, expect, it } from 'vitest';
import { quotationCompanyNames } from '../shared/quotations';
import { quotationPrintHtml } from '../src/quotationPrint';
import type { Quotation } from '../shared/quotations';

const names = {
  companyNameTh: 'คอร์วิตี้',
  companyNameEn: 'Corevity Used Gym Equipment',
};

describe('quotation company names', () => {
  it('uses COREVITY as the title on English quotations', () => {
    expect(quotationCompanyNames(names, 'en')).toEqual({
      title: 'COREVITY',
      subtitle: 'Corevity Used Gym Equipment',
    });
    expect(
      quotationCompanyNames(
        { companyNameTh: 'คอร์วิตี้', companyNameEn: 'Corevity' },
        'en',
      ),
    ).toEqual({ title: 'COREVITY', subtitle: '' });
  });

  it('keeps the Thai name as the title on Thai quotations', () => {
    expect(quotationCompanyNames(names, 'th')).toEqual({
      title: 'คอร์วิตี้',
      subtitle: 'Corevity Used Gym Equipment',
    });
  });

  it('prints COREVITY and no Thai company name in the English print layout', () => {
    const quote = {
      quotationNumber: 'QT-2026-0001',
      issueDate: '2026-11-21',
      validUntil: '2026-12-21',
      currency: 'THB',
      customer: {
        name: 'Customer',
        companyName: '',
        contactName: '',
        phone: '',
        email: '',
        billingAddress: '',
      },
      company: {
        ...names,
        address: '',
        phone: '',
        email: '',
        taxId: '',
        bankDetails: '',
      },
      salesContactName: 'Sales',
      items: [],
      subtotal: 0,
      discount: 0,
      deliveryFee: 0,
      installationFee: 0,
      otherCharges: 0,
      vatEnabled: false,
      vatRate: 7,
      taxMode: 'EXCLUSIVE',
      vatAmount: 0,
      grandTotal: 0,
      beforeTax: 0,
      paymentTerms: '',
      deliveryTerms: '',
      warrantyTerms: '',
      notes: '',
    } as unknown as Quotation;
    const html = quotationPrintHtml(
      quote,
      {},
      { regular: '', bold: '' } as never,
      'en',
      (v) => v,
    );
    expect(html).toContain('<h1>COREVITY</h1>');
    expect(html).not.toContain('คอร์วิตี้');
  });

  it('prints the specification instead of the condition for each item', () => {
    const quote = {
      quotationNumber: 'QT-2026-0002',
      issueDate: '2026-11-21',
      validUntil: '2026-12-21',
      currency: 'THB',
      customer: {
        name: 'Customer',
        companyName: '',
        contactName: '',
        phone: '',
        email: '',
        billingAddress: '',
      },
      company: {
        ...names,
        address: '',
        phone: '',
        email: '',
        taxId: '',
        bankDetails: '',
      },
      salesContactName: 'Sales',
      items: [
        {
          id: 'i1',
          productName: 'Leg press',
          sku: 'SKU-1',
          condition: 'Used - Excellent',
          specification: 'Seated Leg Press',
          description: '',
          productStatus: null,
          quantity: 1,
          unitPrice: 1,
          discount: 0,
          lineTotal: 1,
        },
      ],
      subtotal: 1,
      discount: 0,
      deliveryFee: 0,
      installationFee: 0,
      otherCharges: 0,
      vatEnabled: false,
      vatRate: 7,
      taxMode: 'EXCLUSIVE',
      vatAmount: 0,
      grandTotal: 1,
      beforeTax: 1,
      paymentTerms: '',
      deliveryTerms: '',
      warrantyTerms: '',
      notes: '',
    } as unknown as Quotation;
    const html = quotationPrintHtml(
      quote,
      {},
      { regular: '', bold: '' } as never,
      'en',
      (v) => v,
    );
    expect(html).toContain('SKU-1 · Seated Leg Press');
    expect(html).not.toContain('Used - Excellent');
  });
});
