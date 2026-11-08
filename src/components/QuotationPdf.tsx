import { quotationPrintHtml, type QuotationFonts } from '../quotationPrint';
import {
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  Document,
} from '@react-pdf/renderer';
import latinRegular from '@fontsource/noto-sans-thai/files/noto-sans-thai-latin-400-normal.woff?url';
import latinBold from '@fontsource/noto-sans-thai/files/noto-sans-thai-latin-700-normal.woff?url';
import thaiRegular from '@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff?url';
import thaiBold from '@fontsource/noto-sans-thai/files/noto-sans-thai-thai-700-normal.woff?url';
import type { Quotation } from '../../shared/quotations';
import { getLanguage, t } from '../i18n';
import type { TextProps } from '@react-pdf/renderer';

Font.register({
  family: 'QuotationLatin',
  fonts: [
    { src: latinRegular, fontWeight: 400 },
    { src: latinBold, fontWeight: 700 },
  ],
});
Font.register({
  family: 'QuotationThai',
  fonts: [
    { src: thaiRegular, fontWeight: 400 },
    { src: thaiBold, fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    fontFamily: 'QuotationLatin',
    fontSize: 9,
    color: '#292a28',
    paddingTop: 84,
    paddingBottom: 48,
    paddingHorizontal: 38,
    lineHeight: 1.4,
  },
  header: {
    position: 'absolute',
    left: 38,
    right: 38,
    top: 25,
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#dedfd9',
    paddingBottom: 10,
  },
  company: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: '70%',
  },
  logo: { width: 58, height: 42, objectFit: 'contain' },
  companyName: { fontSize: 13, fontWeight: 700, color: '#165db7' },
  companyMeta: { fontSize: 7, color: '#696c68' },
  documentLabel: {
    fontSize: 9,
    color: '#165db7',
    fontWeight: 700,
    textAlign: 'right',
  },
  title: { fontSize: 20, color: '#165db7', fontWeight: 700, marginBottom: 12 },
  infoGrid: { flexDirection: 'row', gap: 14, marginBottom: 16 },
  infoCard: {
    flexGrow: 1,
    flexBasis: 0,
    backgroundColor: '#f0f1ed',
    borderRadius: 5,
    padding: 10,
  },
  label: { fontSize: 7, color: '#696c66', marginBottom: 3 },
  value: { fontSize: 9, fontWeight: 700 },
  sectionTitle: {
    fontSize: 10,
    color: '#165db7',
    fontWeight: 700,
    marginBottom: 6,
    marginTop: 7,
  },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f1',
    color: '#353633',
    paddingVertical: 7,
    paddingHorizontal: 5,
    fontSize: 7,
    fontWeight: 700,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 0.7,
    borderBottomColor: '#e2e3dd',
    paddingVertical: 7,
    paddingHorizontal: 5,
    minHeight: 52,
  },
  cellPhoto: { width: '13%', paddingRight: 5 },
  cellProduct: { width: '33%', paddingRight: 5 },
  cellQty: { width: '8%', textAlign: 'right' },
  cellPrice: { width: '15%', textAlign: 'right', paddingLeft: 3 },
  cellDiscount: { width: '13%', textAlign: 'right', paddingLeft: 3 },
  cellTotal: { width: '18%', textAlign: 'right', paddingLeft: 3 },
  productImage: {
    width: 43,
    height: 43,
    objectFit: 'contain',
    borderRadius: 3,
    backgroundColor: '#f0f1ed',
  },
  productName: { fontSize: 8, fontWeight: 700 },
  productMeta: { fontSize: 7, color: '#777a73' },
  description: { fontSize: 7, color: '#565a53', marginTop: 2 },
  warning: { fontSize: 7, color: '#9a6700', marginTop: 2 },
  totals: { width: '52%', alignSelf: 'flex-end', marginTop: 12 },
  totalLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e3dd',
  },
  totalLabel: { fontSize: 8, color: '#565a53' },
  grandTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginTop: 3,
    backgroundColor: '#eef3fb',
    paddingHorizontal: 8,
    color: '#165db7',
    fontWeight: 700,
    fontSize: 11,
  },
  term: { marginTop: 5, marginBottom: 3 },
  termTitle: {
    fontSize: 8,
    fontWeight: 700,
    color: '#165db7',
    marginBottom: 2,
  },
  termBody: { fontSize: 8, color: '#565a53' },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 38,
    right: 38,
    paddingTop: 6,
    borderTopWidth: 0.7,
    borderTopColor: '#dedfd9',
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: '#696c66',
    fontSize: 7,
  },
});

function runs(value: unknown) {
  const parts = String(value ?? '')
    .split(/([\u0e00-\u0e7f]+)/g)
    .filter(Boolean);
  return parts.map((part, index) => (
    <Text
      key={index}
      style={{
        fontFamily: /[\u0e00-\u0e7f]/.test(part)
          ? 'QuotationThai'
          : 'QuotationLatin',
      }}
    >
      {part}
    </Text>
  ));
}
function PText({
  children,
  style,
}: {
  children: unknown;
  style?: TextProps['style'];
}) {
  return <Text style={style}>{runs(children)}</Text>;
}
function amount(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
function shortDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00+07:00`);
  return new Intl.DateTimeFormat(getLanguage() === 'th' ? 'th-TH' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}
export function QuotationDocument({
  quote,
  assets,
}: {
  quote: Quotation;
  assets: Record<string, string>;
}) {
  const company = quote.company;
  const title = company.companyNameTh || company.companyNameEn || 'Corevity';
  const terms = [
    ['Payment terms', quote.paymentTerms],
    ['Delivery terms', quote.deliveryTerms],
    ['Warranty terms', quote.warrantyTerms],
    ['Bank details', company.bankDetails],
    ['Additional notes', quote.notes],
  ].filter(([, value]) => value);
  return (
    <Document title={quote.quotationNumber} author={title} subject="Quotation">
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View style={styles.company}>
            {assets.companyLogo ? (
              <Image src={assets.companyLogo} style={styles.logo} />
            ) : null}
            <View>
              <PText style={styles.companyName}>{title}</PText>
              {company.companyNameEn && company.companyNameTh ? (
                <PText style={styles.companyMeta}>
                  {company.companyNameEn}
                </PText>
              ) : null}
              {company.address ? (
                <PText style={styles.companyMeta}>{company.address}</PText>
              ) : null}
              <PText style={styles.companyMeta}>
                {[
                  company.phone,
                  company.email,
                  company.taxId && `${t('Tax ID')}: ${company.taxId}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </PText>
            </View>
          </View>
          <View>
            <PText style={styles.documentLabel}>{t('Quotation')}</PText>
            <PText style={styles.documentLabel}>{quote.quotationNumber}</PText>
          </View>
        </View>
        <PText style={styles.title}>{t('Quotation')}</PText>
        <View style={styles.infoGrid}>
          <View style={styles.infoCard}>
            <PText style={styles.label}>{t('Customer')}</PText>
            <PText style={styles.value}>
              {quote.customer.companyName || quote.customer.name}
            </PText>
            {quote.customer.contactName ? (
              <PText>{quote.customer.contactName}</PText>
            ) : null}
            {quote.customer.billingAddress ? (
              <PText>{quote.customer.billingAddress}</PText>
            ) : null}
            <PText>
              {[quote.customer.phone, quote.customer.email]
                .filter(Boolean)
                .join(' · ')}
            </PText>
          </View>
          <View style={styles.infoCard}>
            <PText style={styles.label}>{t('Issue date')}</PText>
            <PText style={styles.value}>{shortDate(quote.issueDate)}</PText>
            <PText style={styles.label}>{t('Valid until')}</PText>
            <PText style={styles.value}>{shortDate(quote.validUntil)}</PText>
            <PText style={styles.label}>{t('Sales contact')}</PText>
            <PText>{quote.salesContactName}</PText>
          </View>
        </View>
        <PText style={styles.sectionTitle}>{t('Products')}</PText>
        <View style={styles.tableHead} fixed>
          <PText style={styles.cellPhoto}>{t('Photo')}</PText>
          <PText style={styles.cellProduct}>{t('Description')}</PText>
          <PText style={styles.cellQty}>{t('Qty')}</PText>
          <PText style={styles.cellPrice}>{t('Unit price')}</PText>
          <PText style={styles.cellDiscount}>{t('Discount')}</PText>
          <PText style={styles.cellTotal}>{t('Line total')}</PText>
        </View>
        {quote.items.map((item) => (
          <View key={item.id} style={styles.row} wrap={false}>
            <View style={styles.cellPhoto}>
              {assets[item.id] ? (
                <Image src={assets[item.id]} style={styles.productImage} />
              ) : (
                <View style={styles.productImage} />
              )}
            </View>
            <View style={styles.cellProduct}>
              <PText style={styles.productName}>{item.productName}</PText>
              <PText style={styles.productMeta}>
                {item.sku}
                {item.condition ? ` · ${item.condition}` : ''}
              </PText>
              {item.description ? (
                <PText style={styles.description}>{item.description}</PText>
              ) : null}
              {item.productStatus === 'SOLD' ||
              item.productStatus === 'RESERVED' ? (
                <PText style={styles.warning}>
                  {t(
                    item.productStatus === 'SOLD'
                      ? 'This product is sold.'
                      : 'This product is reserved.',
                  )}
                </PText>
              ) : null}
            </View>
            <PText style={styles.cellQty}>{item.quantity}</PText>
            <PText style={styles.cellPrice}>
              {amount(item.unitPrice, quote.currency)}
            </PText>
            <PText style={styles.cellDiscount}>
              {amount(item.discount, quote.currency)}
            </PText>
            <PText style={styles.cellTotal}>
              {amount(item.lineTotal, quote.currency)}
            </PText>
          </View>
        ))}
        <View style={styles.totals} wrap={false}>
          {[
            ['Subtotal', quote.subtotal],
            ['Quotation discount', -quote.discount],
            ['Delivery fee', quote.deliveryFee],
            ['Installation fee', quote.installationFee],
            ['Other charges', quote.otherCharges],
            ['Before tax', quote.beforeTax],
            ...(quote.vatEnabled
              ? [
                  [`VAT (${quote.vatRate}%)`, quote.vatAmount] as [
                    string,
                    number,
                  ],
                ]
              : []),
          ].map(([label, value]) => (
            <View key={String(label)} style={styles.totalLine}>
              <PText style={styles.totalLabel}>{t(String(label))}</PText>
              <PText>{amount(Number(value), quote.currency)}</PText>
            </View>
          ))}
          <View style={styles.grandTotal}>
            <PText>{t('Grand total')}</PText>
            <PText>{amount(quote.grandTotal, quote.currency)}</PText>
          </View>
        </View>
        {terms.length ? (
          <PText style={styles.sectionTitle}>{t('Terms')}</PText>
        ) : null}
        {terms.map(([label, value]) => (
          <View key={label} style={styles.term} wrap={false}>
            <PText style={styles.termTitle}>{t(String(label))}</PText>
            <PText style={styles.termBody}>{String(value)}</PText>
          </View>
        ))}
        <View style={styles.footer} fixed>
          <PText>
            {quote.quotationNumber} ·{' '}
            {company.companyNameTh || company.companyNameEn || 'Corevity'}
          </PText>
          <Text
            style={{ fontFamily: 'QuotationLatin' }}
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export default function QuotationPdf({
  quote,
  assets,
}: {
  quote: Quotation;
  assets: Record<string, string>;
}) {
  const filename = `${quote.quotationNumber}-${(quote.customer.companyName || quote.customer.name || 'Customer').replace(/[^a-z0-9]+/gi, '-')}.pdf`;
  const fonts: QuotationFonts = {
    latinRegular,
    latinBold,
    thaiRegular,
    thaiBold,
  };
  const absoluteFonts = Object.fromEntries(
    Object.entries(fonts).map(([key, url]) => [
      key,
      new URL(url, window.location.href).href,
    ]),
  ) as QuotationFonts;
  function openPrintable() {
    const popup = window.open('', '_blank');
    if (!popup) {
      window.alert(t('Allow pop-ups to open the printable quotation.'));
      return;
    }
    popup.document.open();
    popup.document.write(
      quotationPrintHtml(quote, assets, absoluteFonts, getLanguage(), t),
    );
    popup.document.close();
    void (async () => {
      try {
        await Promise.all([
          popup.document.fonts.load(
            '400 10pt CorevityQuote',
            'Corevity ใบเสนอราคา',
          ),
          popup.document.fonts.load(
            '700 10pt CorevityQuote',
            'Corevity ใบเสนอราคา',
          ),
          ...Array.from(popup.document.images).map((img) =>
            img.decode().catch(() => undefined),
          ),
        ]);
        await popup.document.fonts.ready;
        if (!popup.closed) {
          popup.focus();
          popup.print();
        }
      } catch {
        window.alert(t('Unable to load quotation fonts. Please try again.'));
      }
    })();
  }
  async function downloadHtml() {
    try {
      const embedded = Object.fromEntries(
        await Promise.all(
          Object.entries(fonts).map(async ([key, src]) => {
            const response = await fetch(src);
            if (!response.ok) throw new Error('Font unavailable');
            const blob = await response.blob();
            const data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
            return [key, data];
          }),
        ),
      ) as QuotationFonts;
      const html = quotationPrintHtml(
        quote,
        assets,
        embedded,
        getLanguage(),
        t,
      );
      const url = URL.createObjectURL(
        new Blob([html], { type: 'text/html;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename.replace(/\.pdf$/i, '')}.html`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      window.alert(t('Unable to load quotation fonts. Please try again.'));
    }
  }
  return (
    <div className="quotation-pdf-viewer">
      <button type="button" className="button primary" onClick={openPrintable}>
        {t('Print / save as PDF')}
      </button>
      <button
        type="button"
        className="button"
        onClick={() => void downloadHtml()}
      >
        {t('Download HTML quotation')}
      </button>
    </div>
  );
}
