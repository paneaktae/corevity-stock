import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { Font, renderToBuffer } from '@react-pdf/renderer';
import { readFileSync } from 'node:fs';
import { QuotationDocument } from '../src/components/QuotationPdf';
import type { Quotation } from '../shared/quotations';
const localFont = (name: string) => `data:font/woff;base64,${readFileSync(`node_modules/@fontsource/noto-sans-thai/files/${name}`).toString('base64')}`;

const quote: Quotation = {
  id: 'pdf-test', quotationNumber: 'QT-2026-0001', customerId: 'customer', leadId: null,
  status: 'DRAFT', issueDate: '2026-10-12', validUntil: '2026-11-11', currency: 'THB',
  customer: { name: 'ลูกค้าทดสอบ', companyName: 'บริษัท Corevity', contactName: 'Sales Test', phone: '', email: '', billingAddress: 'กรุงเทพมหานคร Bangkok' },
  company: { companyNameTh: 'บริษัท Corevity', companyNameEn: 'Corevity Co., Ltd.', address: 'Bangkok, Thailand', phone: '02-000-0000', email: 'sales@example.test', taxId: '', lineUrl: '', facebookUrl: '', bankDetails: '', paymentTerms: '50% deposit', deliveryTerms: '', warrantyTerms: '', defaultVatRate: 7, logoAvailable: false },
  salesContactEmail: 'sales@example.test', salesContactName: 'Sales Test',
  items: Array.from({ length: 60 }, (_, index) => ({
    id: `item-${index}`, productId: null, productName: `เครื่องออกกำลังกาย ${index + 1} Fitness equipment`, brand: 'Corevity', model: `Model ${index + 1}`, sku: `SKU-${index + 1}`,
    description: 'รายละเอียดภาษาไทยและ English product details '.repeat(3), condition: 'Good', imageAvailable: false, imageId: '', quantity: 1, unitPrice: 1000, discount: 0, lineTotal: 1000, sortOrder: index, productStatus: null,
  })),
  subtotal: 60000, discount: 0, deliveryFee: 0, installationFee: 0, otherCharges: 0,
  vatEnabled: true, vatRate: 7, taxMode: 'EXCLUSIVE', vatAmount: 4200, grandTotal: 64200, beforeTax: 60000,
  paymentTerms: '50% deposit', deliveryTerms: '', warrantyTerms: '', notes: '', createdBy: 'tester', createdAt: '', updatedAt: '',
  history: [],
};

describe('quotation PDF', () => {
  it('creates a multi-page A4 PDF with Thai and English text and without optional images', async () => {
    Font.clear();
    Font.register({ family: 'QuotationLatin', fonts: [
      { src: localFont('noto-sans-thai-latin-400-normal.woff'), fontWeight: 400 },
      { src: localFont('noto-sans-thai-latin-700-normal.woff'), fontWeight: 700 },
    ] });
    Font.register({ family: 'QuotationThai', fonts: [
      { src: localFont('noto-sans-thai-thai-400-normal.woff'), fontWeight: 400 },
      { src: localFont('noto-sans-thai-thai-700-normal.woff'), fontWeight: 700 },
    ] });
    Font.register({ family: 'Helvetica', src: localFont('noto-sans-thai-latin-400-normal.woff') });
    const document = createElement(QuotationDocument, { quote, assets: {} }) as Parameters<typeof renderToBuffer>[0];
    const buffer = await renderToBuffer(document);
    const output = buffer.toString('latin1');
    expect(output.startsWith('%PDF-')).toBe(true);
    expect(output).toMatch(/\/Count\s+\d+/);
    expect(Number(output.match(/\/Count\s+(\d+)/)?.[1] ?? 0)).toBeGreaterThan(1);
  });
});
