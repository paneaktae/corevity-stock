import { describe, expect, it } from 'vitest';
import { quotationPrintHtml, type PrintableDocument } from '../src/quotationPrint';

const doc = {
  quotationNumber: 'INV-2026-0001',
  issueDate: '2026-11-22',
  validUntil: '2026-11-29',
  currency: 'THB',
  customer: { name: 'Customer', companyName: '', contactName: '', phone: '', email: '', billingAddress: '' },
  company: {
    companyNameTh: 'คอร์วิตี้', companyNameEn: 'Corevity Used Gym Equipment', address: '', phone: '', email: '',
    taxId: '', lineUrl: '', facebookUrl: '', bankDetails: '', paymentTerms: '', deliveryTerms: '', warrantyTerms: '',
    defaultVatRate: 7, logoAvailable: false,
  },
  salesContactName: 'Sales',
  items: [{ id: 'i1', productName: 'Hammer Strength Plate Loaded', specification: 'DY Row', sku: 'SKU-1', description: '', productStatus: 'RESERVED', quantity: 1, unitPrice: 1000, discount: 0, lineTotal: 1000 }],
  subtotal: 1000, discount: 0, deliveryFee: 0, installationFee: 0, otherCharges: 0,
  vatEnabled: false, vatRate: 7, vatAmount: 0, grandTotal: 1000, beforeTax: 1000,
  paymentTerms: '', deliveryTerms: '', warrantyTerms: '', notes: '',
} satisfies PrintableDocument;

describe('invoice print layout', () => {
  it('prints invoice title, due date, quotation reference, deposit and balance', () => {
    const html = quotationPrintHtml(doc, {}, { latinRegular: '', latinBold: '', thaiRegular: '', thaiBold: '' }, 'en', (v) => v, {
      title: 'Invoice',
      englishTitle: 'INVOICE',
      secondDateLabel: 'Due date',
      reference: ['Quotation reference', 'QT-2026-0003'],
      afterTotal: [['Deposit', 300], ['Balance due', 700]],
      hideStockNotes: true,
    });
    expect(html).toContain('<h2>Invoice</h2>');
    expect(html).toContain('<dt>Due date</dt>');
    expect(html).not.toContain('Valid until');
    expect(html).toContain('<dt>Quotation reference</dt><dd>QT-2026-0003</dd>');
    expect(html).toMatch(/Deposit<\/span><span>THB\s300\.00/);
    expect(html).toMatch(/Balance due<\/span><span>THB\s700\.00/);
    expect(html).toContain('Hammer Strength Plate Loaded DY Row');
    expect(html).not.toContain('This product is reserved.');
  });

  it('keeps the quotation layout by default', () => {
    const html = quotationPrintHtml(doc, {}, { latinRegular: '', latinBold: '', thaiRegular: '', thaiBold: '' }, 'th', (v) => v);
    expect(html).toContain('<h2>Quotation</h2><p>QUOTATION</p>');
    expect(html).toContain('<dt>Valid until</dt>');
    expect(html).not.toContain('Balance due');
  });
});
