import { Font, Image, Page, PDFDownloadLink, PDFViewer, StyleSheet, Text, View, Document } from '@react-pdf/renderer';
import latinRegular from '@fontsource/noto-sans-thai/files/noto-sans-thai-latin-400-normal.woff?url';
import latinBold from '@fontsource/noto-sans-thai/files/noto-sans-thai-latin-700-normal.woff?url';
import thaiRegular from '@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff?url';
import thaiBold from '@fontsource/noto-sans-thai/files/noto-sans-thai-thai-700-normal.woff?url';
import type { Quotation } from '../../shared/quotations';
import { getLanguage, t } from '../i18n';
import type { TextProps } from '@react-pdf/renderer';

Font.register({ family: 'QuotationLatin', fonts: [{ src: latinRegular, fontWeight: 400 }, { src: latinBold, fontWeight: 700 }] });
Font.register({ family: 'QuotationThai', fonts: [{ src: thaiRegular, fontWeight: 400 }, { src: thaiBold, fontWeight: 700 }] });
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: { fontFamily: 'QuotationLatin', fontSize: 9, color: '#172538', paddingTop: 84, paddingBottom: 48, paddingHorizontal: 38, lineHeight: 1.4 },
  header: { position: 'absolute', left: 38, right: 38, top: 25, minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#d7e1ee', paddingBottom: 10 },
  company: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '70%' },
  logo: { width: 58, height: 42, objectFit: 'contain' },
  companyName: { fontSize: 13, fontWeight: 700, color: '#174b83' },
  companyMeta: { fontSize: 7, color: '#52677f' },
  documentLabel: { fontSize: 9, color: '#174b83', fontWeight: 700, textAlign: 'right' },
  title: { fontSize: 20, color: '#174b83', fontWeight: 700, marginBottom: 12 },
  infoGrid: { flexDirection: 'row', gap: 14, marginBottom: 16 },
  infoCard: { flexGrow: 1, flexBasis: 0, backgroundColor: '#f3f7fc', borderRadius: 5, padding: 10 },
  label: { fontSize: 7, color: '#60748b', marginBottom: 3 },
  value: { fontSize: 9, fontWeight: 700 },
  sectionTitle: { fontSize: 10, color: '#174b83', fontWeight: 700, marginBottom: 6, marginTop: 7 },
  tableHead: { flexDirection: 'row', backgroundColor: '#174b83', color: '#fff', paddingVertical: 7, paddingHorizontal: 5, fontSize: 7, fontWeight: 700 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.7, borderBottomColor: '#e2e8f0', paddingVertical: 7, paddingHorizontal: 5, minHeight: 52 },
  cellPhoto: { width: '13%', paddingRight: 5 },
  cellProduct: { width: '33%', paddingRight: 5 },
  cellQty: { width: '8%', textAlign: 'right' },
  cellPrice: { width: '15%', textAlign: 'right', paddingLeft: 3 },
  cellDiscount: { width: '13%', textAlign: 'right', paddingLeft: 3 },
  cellTotal: { width: '18%', textAlign: 'right', paddingLeft: 3 },
  productImage: { width: 43, height: 43, objectFit: 'contain', borderRadius: 3, backgroundColor: '#f3f6fa' },
  productName: { fontSize: 8, fontWeight: 700 },
  productMeta: { fontSize: 7, color: '#63758b' },
  description: { fontSize: 7, color: '#485b70', marginTop: 2 },
  warning: { fontSize: 7, color: '#9a6700', marginTop: 2 },
  totals: { width: '52%', alignSelf: 'flex-end', marginTop: 12 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
  totalLabel: { fontSize: 8, color: '#485b70' },
  grandTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, marginTop: 3, backgroundColor: '#eaf2fc', paddingHorizontal: 8, color: '#174b83', fontWeight: 700, fontSize: 11 },
  term: { marginTop: 5, marginBottom: 3 },
  termTitle: { fontSize: 8, fontWeight: 700, color: '#174b83', marginBottom: 2 },
  termBody: { fontSize: 8, color: '#394b60' },
  footer: { position: 'absolute', bottom: 20, left: 38, right: 38, paddingTop: 6, borderTopWidth: 0.7, borderTopColor: '#d7e1ee', flexDirection: 'row', justifyContent: 'space-between', color: '#60748b', fontSize: 7 },
});

function runs(value: unknown) {
  const parts=String(value??'').split(/([\u0e00-\u0e7f]+)/g).filter(Boolean);
  return parts.map((part,index)=><Text key={index} style={{fontFamily:/[\u0e00-\u0e7f]/.test(part)?'QuotationThai':'QuotationLatin'}}>{part}</Text>);
}
function PText({ children, style }: { children: unknown; style?: TextProps['style'] }) {
  return <Text style={style}>{runs(children)}</Text>;
}
function amount(value:number,currency:string){
  try{return new Intl.NumberFormat('th-TH',{style:'currency',currency,maximumFractionDigits:2}).format(value)}catch{return `${currency} ${value.toFixed(2)}`}
}
function shortDate(value:string){
  const date=new Date(`${value.slice(0,10)}T12:00:00+07:00`);
  return new Intl.DateTimeFormat(getLanguage()==='th'?'th-TH':'en-GB',{day:'numeric',month:'short',year:'numeric'}).format(date);
}
export function QuotationDocument({quote,assets}:{quote:Quotation;assets:Record<string,string>}){
  const company=quote.company;
  const title=company.companyNameTh||company.companyNameEn||'Corevity';
  const terms=[['Payment terms',quote.paymentTerms],['Delivery terms',quote.deliveryTerms],['Warranty terms',quote.warrantyTerms],['Bank details',company.bankDetails],['Additional notes',quote.notes]].filter(([,value])=>value);
  return <Document title={quote.quotationNumber} author={title} subject="Quotation">
    <Page size="A4" style={styles.page} wrap>
      <View style={styles.header} fixed>
        <View style={styles.company}>{assets.companyLogo?<Image src={assets.companyLogo} style={styles.logo}/>:null}<View><PText style={styles.companyName}>{title}</PText>{company.companyNameEn&&company.companyNameTh?<PText style={styles.companyMeta}>{company.companyNameEn}</PText>:null}{company.address?<PText style={styles.companyMeta}>{company.address}</PText>:null}<PText style={styles.companyMeta}>{[company.phone,company.email,company.taxId&&`${t('Tax ID')}: ${company.taxId}`].filter(Boolean).join(' · ')}</PText></View></View>
        <View><PText style={styles.documentLabel}>{t('Quotation')}</PText><PText style={styles.documentLabel}>{quote.quotationNumber}</PText></View>
      </View>
      <PText style={styles.title}>{t('Quotation')}</PText>
      <View style={styles.infoGrid}>
        <View style={styles.infoCard}><PText style={styles.label}>{t('Customer')}</PText><PText style={styles.value}>{quote.customer.companyName||quote.customer.name}</PText>{quote.customer.contactName?<PText>{quote.customer.contactName}</PText>:null}{quote.customer.billingAddress?<PText>{quote.customer.billingAddress}</PText>:null}<PText>{[quote.customer.phone,quote.customer.email].filter(Boolean).join(' · ')}</PText></View>
        <View style={styles.infoCard}><PText style={styles.label}>{t('Issue date')}</PText><PText style={styles.value}>{shortDate(quote.issueDate)}</PText><PText style={styles.label}>{t('Valid until')}</PText><PText style={styles.value}>{shortDate(quote.validUntil)}</PText><PText style={styles.label}>{t('Sales contact')}</PText><PText>{quote.salesContactName}</PText></View>
      </View>
      <PText style={styles.sectionTitle}>{t('Products')}</PText>
      <View style={styles.tableHead} fixed>
        <PText style={styles.cellPhoto}>{t('Photo')}</PText><PText style={styles.cellProduct}>{t('Description')}</PText><PText style={styles.cellQty}>{t('Qty')}</PText><PText style={styles.cellPrice}>{t('Unit price')}</PText><PText style={styles.cellDiscount}>{t('Discount')}</PText><PText style={styles.cellTotal}>{t('Line total')}</PText>
      </View>
      {quote.items.map((item)=><View key={item.id} style={styles.row} wrap={false}>
        <View style={styles.cellPhoto}>{assets[item.id]?<Image src={assets[item.id]} style={styles.productImage}/>:<View style={styles.productImage}/>}</View>
        <View style={styles.cellProduct}><PText style={styles.productName}>{item.productName}</PText><PText style={styles.productMeta}>{item.sku}{item.condition?` · ${item.condition}`:''}</PText>{item.description?<PText style={styles.description}>{item.description}</PText>:null}{item.productStatus==='SOLD'||item.productStatus==='RESERVED'?<PText style={styles.warning}>{t(item.productStatus==='SOLD'?'This product is sold.':'This product is reserved.')}</PText>:null}</View>
        <PText style={styles.cellQty}>{item.quantity}</PText><PText style={styles.cellPrice}>{amount(item.unitPrice,quote.currency)}</PText><PText style={styles.cellDiscount}>{amount(item.discount,quote.currency)}</PText><PText style={styles.cellTotal}>{amount(item.lineTotal,quote.currency)}</PText>
      </View>)}
      <View style={styles.totals} wrap={false}>
        {[['Subtotal',quote.subtotal],['Quotation discount',-quote.discount],['Delivery fee',quote.deliveryFee],['Installation fee',quote.installationFee],['Other charges',quote.otherCharges],['Before tax',quote.beforeTax],...(quote.vatEnabled?[[`VAT (${quote.vatRate}%)`,quote.vatAmount] as [string,number]]:[])].map(([label,value])=><View key={String(label)} style={styles.totalLine}><PText style={styles.totalLabel}>{t(String(label))}</PText><PText>{amount(Number(value),quote.currency)}</PText></View>)}
        <View style={styles.grandTotal}><PText>{t('Grand total')}</PText><PText>{amount(quote.grandTotal,quote.currency)}</PText></View>
      </View>
      {terms.length?<PText style={styles.sectionTitle}>{t('Terms')}</PText>:null}
      {terms.map(([label,value])=><View key={label} style={styles.term} wrap={false}><PText style={styles.termTitle}>{t(String(label))}</PText><PText style={styles.termBody}>{String(value)}</PText></View>)}
      <View style={styles.footer} fixed><PText>{quote.quotationNumber} · {company.companyNameTh||company.companyNameEn||'Corevity'}</PText><Text style={{fontFamily:'QuotationLatin'}} render={({pageNumber,totalPages})=>`${pageNumber} / ${totalPages}`} /></View>
    </Page>
  </Document>;
}

export default function QuotationPdf({quote,assets}:{quote:Quotation;assets:Record<string,string>}){
  const filename=`${quote.quotationNumber}-${(quote.customer.companyName||quote.customer.name||'Customer').replace(/[^a-z0-9]+/gi,'-')}.pdf`;
  const document=<QuotationDocument quote={quote} assets={assets}/>;
  return <div className="quotation-pdf-viewer"><PDFDownloadLink document={document} fileName={filename} className="button primary">{({loading})=>loading?t('Preparing PDF…'):t('Download PDF')}</PDFDownloadLink><PDFViewer showToolbar style={{width:'100%',height:'min(75vh, 900px)',border:0}}>{document}</PDFViewer></div>;
}
