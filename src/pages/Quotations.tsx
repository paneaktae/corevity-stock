import { Suspense, lazy, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, FileText, Plus, Search, Trash2 } from 'lucide-react';
import type { Customer, CustomerDetail, CustomerInput, Product, ProductDetail } from '../../shared/schemas';
import type { Quotation, QuotationInput, QuotationItemInput, QuotationStatus } from '../../shared/quotations';
import { quotationStatuses } from '../../shared/quotations';
import { calculateQuotationTotals, fromMinor, toMinor } from '../../shared/quotation-money';
import { api, date, useData, useDebounce } from '../lib';
import { getLanguage, t } from '../i18n';
import { AddLink, Badge, Empty, ErrorBox, Field, Header, Loading } from '../components/ui';

type CustomerChoice = Pick<Customer, 'id' | 'name' | 'companyName' | 'contactName' | 'phone' | 'email' | 'billingAddress'>;
type ProductChoice = Pick<Product, 'id' | 'sku' | 'brand' | 'model' | 'category' | 'condition' | 'sellingPrice' | 'status' | 'shortDescription' | 'descriptionTh' | 'descriptionEn' | 'primaryImageId'>;
type QuoteListItem = Pick<Quotation, 'id' | 'quotationNumber' | 'customerId' | 'customer' | 'issueDate' | 'validUntil' | 'currency' | 'status' | 'createdAt'> & { total: number };
type DraftItem = {
  productId: string;
  imageId: string | null;
  displayName: string;
  description: string;
  quantity: number;
  unitPrice: string;
  discount: string;
};
type DraftForm = Omit<QuotationInput, 'items'> & { items: DraftItem[] };

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateAfter = (day: string, count: number) => {
  const value = new Date(`${day}T12:00:00+07:00`);
  value.setDate(value.getDate() + count);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
};
function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(getLanguage() === 'th' ? 'th-TH' : 'en-TH', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
function blankForm(defaultVatRate = 7, query?: URLSearchParams): DraftForm {
  const issueDate = today();
  return {
    customerId: query?.get('customerId') ?? '',
    leadId: query?.get('leadId') ?? null,
    issueDate,
    validUntil: dateAfter(issueDate, 30),
    currency: 'THB',
    items: [],
    discount: 0,
    deliveryFee: 0,
    installationFee: 0,
    otherCharges: 0,
    vatEnabled: false,
    vatRate: defaultVatRate,
    taxMode: 'EXCLUSIVE',
    paymentTerms: '',
    deliveryTerms: '',
    warrantyTerms: '',
    notes: '',
  };
}
function draftFromQuote(quote: Quotation): DraftForm {
  return {
    customerId: quote.customerId,
    leadId: quote.leadId,
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    currency: quote.currency,
    items: quote.items.map((item) => ({
      productId: item.productId ?? '',
      imageId: item.imageId || null,
      displayName: item.productName,
      description: item.description,
      quantity: item.quantity,
      unitPrice: String(item.unitPrice),
      discount: String(item.discount || ''),
    })),
    discount: quote.discount,
    deliveryFee: quote.deliveryFee,
    installationFee: quote.installationFee,
    otherCharges: quote.otherCharges,
    vatEnabled: quote.vatEnabled,
    vatRate: quote.vatRate,
    taxMode: quote.taxMode,
    paymentTerms: quote.paymentTerms,
    deliveryTerms: quote.deliveryTerms,
    warrantyTerms: quote.warrantyTerms,
    notes: quote.notes,
  };
}
function itemPayload(items: DraftItem[]): QuotationItemInput[] {
  return items.map((item) => ({
    ...item,
    unitPrice: Number(item.unitPrice || 0),
    discount: Number(item.discount || 0),
  }));
}

export function QuotationsPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('newest');
  const search = useDebounce(query);
  const { data, error } = useData<QuoteListItem[]>(`/quotations?q=${encodeURIComponent(search)}&status=${status}&sort=${sort}`);
  return <>
    <Header title={t('Quotations')} subtitle={t('Create and track customer quotations.')} action={<AddLink to="/quotations/new">{t('Create quotation')}</AddLink>} />
    <div className="panel toolbar quotation-toolbar">
      <label className="search"><Search size={18} /><input aria-label={t('Search quotations')} placeholder={t('Search quotation number or customer')} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <select aria-label={t('Filter by status')} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">{t('All quotation statuses')}</option>
        {quotationStatuses.map((v) => <option key={v} value={v}>{t(v)}</option>)}
      </select>
      <select aria-label={t('Sort by date')} value={sort} onChange={(e) => setSort(e.target.value)}>
        <option value="newest">{t('Newest first')}</option><option value="oldest">{t('Oldest first')}</option>
      </select>
    </div>
    <ErrorBox message={error} />
    {!data && !error ? <Loading /> : data?.length ? <div className="panel quotation-list-wrap">
      <table className="quotation-table"><thead><tr><th>{t('Quotation number')}</th><th>{t('Customer')}</th><th>{t('Issue date')}</th><th>{t('Valid until')}</th><th>{t('Total')}</th><th>{t('Status')}</th><th /></tr></thead>
        <tbody>{data.map((quote) => <tr key={quote.id}>
          <td><Link className="text-link" to={`/quotations/${quote.id}`}><strong>{quote.quotationNumber}</strong></Link></td>
          <td><Link className="text-link" to={`/quotations/${quote.id}`}>{quote.customer.companyName || quote.customer.name}</Link></td>
          <td>{date(quote.issueDate)}</td><td>{date(quote.validUntil)}</td>
          <td className="quotation-money">{formatCurrency(quote.total, quote.currency)}</td><td><Badge value={quote.status} /></td>
          <td><Link className="icon-button" aria-label={t('Open quotation')} to={`/quotations/${quote.id}`}><ArrowLeft className="quotation-open-icon" size={16} /></Link></td>
        </tr>)}</tbody>
      </table>
      <div className="quotation-cards">{data.map((quote) => <Link className="quotation-card panel" key={quote.id} to={`/quotations/${quote.id}`}>
        <div className="section-heading"><strong>{quote.quotationNumber}</strong><Badge value={quote.status} /></div><span>{quote.customer.companyName || quote.customer.name}</span><small>{date(quote.issueDate)} · {t('Valid until')} {date(quote.validUntil)}</small><strong>{formatCurrency(quote.total, quote.currency)}</strong>
      </Link>)}</div>
    </div> : <Empty title={t('No quotations yet')}><p>{t('Create a quotation from your customers and inventory.')}</p></Empty>}
  </>;
}

function CustomerCreateInline({ onCreated, onCancel }: { onCreated: (customer: CustomerChoice) => void; onCancel: () => void }) {
  const [form, setForm] = useState<CustomerInput>({ name: '', companyName: '', contactName: '', phone: '', lineId: '', email: '', billingAddress: '', budget: 0, interestedIn: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <section className="quotation-inline-customer panel">
    <div className="section-heading"><h3>{t('Add a customer')}</h3><button type="button" onClick={onCancel}>{t('Cancel')}</button></div>
    <ErrorBox message={error} />
    <div className="form-grid">
      {([['name','Name *'],['companyName','Company'],['contactName','Contact person'],['phone','Phone'],['email','Email']] as const).map(([key,label]) => <Field key={key} label={t(label)}><input required={key==='name'} value={form[key]} onChange={(e)=>setForm({...form,[key]:e.target.value})} /></Field>)}
    </div>
    <Field label={t('Billing address')}><textarea rows={2} value={form.billingAddress} onChange={(e)=>setForm({...form,billingAddress:e.target.value})}/></Field>
    <button type="button" className="primary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const customer=await api<Customer>('/customers',{method:'POST',body:JSON.stringify(form)});onCreated(customer)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>{busy?t('Saving…'):t('Save customer')}</button>
  </section>;
}

function QuotationItemEditor({ item, index, currency, update, remove, move, count }: {
  item: DraftItem; index: number; currency: string; update: (next: DraftItem) => void;
  remove: () => void; move: (direction: number) => void; count: number;
}) {
  const { data } = useData<ProductDetail>(item.productId ? `/products/${item.productId}` : null);
  const total = Math.max(0, item.quantity * Number(item.unitPrice || 0) - Number(item.discount || 0));
  const currentStatus = data?.product.status;
  return <article className="quotation-item-editor panel">
    <div className="quotation-item-top">
      {data?.images.length ? <img src={`/api/images/${item.imageId || data.images.find((photo)=>photo.isPrimary)?.id || data.images[0].id}`} alt="" /> : <div className="quotation-image-placeholder"><FileText size={20}/></div>}
      <div className="grow"><strong>{item.displayName}</strong><small>{data ? `${data.product.sku} · ${data.product.brand} ${data.product.model}` : ''}</small>
        {currentStatus === 'SOLD' || currentStatus === 'RESERVED' ? <div className="warning">{t(currentStatus === 'SOLD' ? 'This product is sold.' : 'This product is reserved.')}</div> : null}
      </div>
      <div className="quotation-item-order"><button type="button" className="icon-button" aria-label={t('Move item up')} disabled={index===0} onClick={()=>move(-1)}><ArrowUp size={16}/></button><button type="button" className="icon-button" aria-label={t('Move item down')} disabled={index===count-1} onClick={()=>move(1)}><ArrowDown size={16}/></button><button type="button" className="icon-button danger" aria-label={t('Remove item')} onClick={remove}><Trash2 size={16}/></button></div>
    </div>
    {data?.images.length ? <Field label={t('Product photo')}><select value={item.imageId || ''} onChange={(e)=>update({...item,imageId:e.target.value || null})}>{data.images.map((photo,index)=><option key={photo.id} value={photo.id}>{photo.isPrimary ? t('Primary photo') : `${t('Photo')} ${index+1}`}</option>)}</select></Field> : null}
    <div className="form-grid quotation-item-fields">
      <Field label={t('Display name')}><input value={item.displayName} onChange={(e)=>update({...item,displayName:e.target.value})}/></Field>
      <Field label={t('Quantity')}><input type="number" min="1" max="10000" step="1" value={item.quantity} onChange={(e)=>update({...item,quantity:Math.max(1,Number(e.target.value)||1)})}/></Field>
      <Field label={`${t('Unit price')} (${currency})`}><input type="number" min="0" step="0.01" inputMode="decimal" value={item.unitPrice} onChange={(e)=>update({...item,unitPrice:e.target.value})}/></Field>
      <Field label={`${t('Item discount')} (${currency})`}><input type="number" min="0" step="0.01" inputMode="decimal" value={item.discount} onChange={(e)=>update({...item,discount:e.target.value})}/></Field>
    </div>
    <Field label={t('Description')}><textarea rows={2} value={item.description} onChange={(e)=>update({...item,description:e.target.value})}/></Field>
    <div className="quotation-item-total"><span>{t('Line total')}</span><strong>{formatCurrency(total,currency)}</strong></div>
  </article>;
}

export function QuotationForm() {
  const { id: quoteId } = useParams();
  const [queryParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: existing, error: loadError } = useData<Quotation>(quoteId ? `/quotations/${quoteId}` : null);
  const { data: company } = useData<{ defaultVatRate: number; paymentTerms: string; deliveryTerms: string; warrantyTerms: string }>('/quotation-settings');
  const prefilledCustomerId = !quoteId ? queryParams.get('customerId') : null;
  const { data: prefilledCustomer } = useData<CustomerDetail>(prefilledCustomerId ? `/customers/${prefilledCustomerId}` : null);
  const [form,setForm] = useState<DraftForm>(()=>blankForm());
  const [customerQuery,setCustomerQuery]=useState('');
  const customerSearch=useDebounce(customerQuery);
  const { data: customers }=useData<CustomerChoice[]>(`/quotations/customers?q=${encodeURIComponent(customerSearch)}`);
  const [productQuery,setProductQuery]=useState('');
  const productSearch=useDebounce(productQuery);
  const { data: products }=useData<ProductChoice[]>(`/quotations/products?q=${encodeURIComponent(productSearch)}`);
  const [customerDraft,setCustomerDraft]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [initialized,setInitialized]=useState(false);
  useEffect(()=>{
    if(quoteId && existing && !initialized){setForm(draftFromQuote(existing));setCustomerQuery(existing.customer.companyName || existing.customer.name);setInitialized(true)}
    else if(!quoteId && !initialized && company){
      const blank=blankForm(company.defaultVatRate,queryParams);
      blank.paymentTerms=company.paymentTerms;
      blank.deliveryTerms=company.deliveryTerms;
      blank.warrantyTerms=company.warrantyTerms;
      const productId=queryParams.get('productId');
      if(productId){api<ProductDetail>(`/products/${productId}`).then(({product,images})=>setForm({...blank,items:[{productId:product.id,imageId:images.find((photo)=>photo.isPrimary)?.id??images[0]?.id??null,displayName:`${product.brand} ${product.model}`,description:product.shortDescription||product.descriptionTh||product.descriptionEn,quantity:1,unitPrice:String(product.sellingPrice),discount:''}]})).catch(()=>setForm(blank))}
      else setForm(blank);
      setInitialized(true);
    }
  },[quoteId,existing,initialized,company,queryParams]);
  useEffect(()=>{
    if(prefilledCustomer?.customer){
      setCustomerQuery(prefilledCustomer.customer.companyName || prefilledCustomer.customer.name);
    }
  },[prefilledCustomer]);
  const selectedCustomer=customers?.find((customer)=>customer.id===form.customerId) ?? (prefilledCustomer?.customer.id===form.customerId ? prefilledCustomer.customer : undefined);
  const [summary,setSummary]=useState({subtotal:0,beforeTax:0,vat:0,total:0});
  useEffect(()=>{
    try{
      const totals=calculateQuotationTotals({lines:form.items.map((item)=>({quantity:item.quantity,unitPriceMinor:toMinor(Number(item.unitPrice||0)),discountMinor:toMinor(Number(item.discount||0))})),discountMinor:toMinor(Number(form.discount||0)),deliveryFeeMinor:toMinor(Number(form.deliveryFee||0)),installationFeeMinor:toMinor(Number(form.installationFee||0)),otherChargesMinor:toMinor(Number(form.otherCharges||0)),vatEnabled:form.vatEnabled,vatRateBps:Math.round(form.vatRate*100),taxMode:form.taxMode});
      setSummary({subtotal:fromMinor(totals.subtotalMinor),beforeTax:fromMinor(totals.beforeTaxMinor),vat:fromMinor(totals.vatMinor),total:fromMinor(totals.grandTotalMinor)});
    }catch{setSummary({subtotal:0,beforeTax:0,vat:0,total:0})}
  },[form]);
  function updateItem(index:number,item:DraftItem){setForm((current)=>({...current,items:current.items.map((old,i)=>i===index?item:old)}))}
  function addProduct(product:ProductChoice){
    if(form.items.some((item)=>item.productId===product.id))return;
    setForm((current)=>({...current,items:[...current.items,{productId:product.id,imageId:product.primaryImageId??null,displayName:`${product.brand} ${product.model}`,description:product.shortDescription||product.descriptionTh||product.descriptionEn,quantity:1,unitPrice:String(product.sellingPrice),discount:''}]}));
    setProductQuery('');
  }
  async function submit(e:FormEvent){e.preventDefault();setError('');if(!form.customerId){setError(t('Select a customer.'));return}if(!form.items.length){setError(t('Add at least one product.'));return}setBusy(true);try{const payload={...form,discount:Number(form.discount||0),deliveryFee:Number(form.deliveryFee||0),installationFee:Number(form.installationFee||0),otherCharges:Number(form.otherCharges||0),items:itemPayload(form.items)};const saved=await api<Quotation>(quoteId?`/quotations/${quoteId}`:'/quotations',{method:quoteId?'PATCH':'POST',body:JSON.stringify(payload)});navigate(`/quotations/${saved.id}`)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  if(quoteId && !existing)return <><ErrorBox message={loadError}/>{!loadError&&<Loading/>}</>;
  if(quoteId && existing?.status!=='DRAFT')return <><ErrorBox message={t('Only draft quotations can be edited.')}/><Link className="button" to={`/quotations/${quoteId}`}>{t('Back to quotation')}</Link></>;
  return <>
    <Link className="back" to={quoteId?`/quotations/${quoteId}`:'/quotations'}><ArrowLeft size={16}/>{t('Quotations')}</Link>
    <Header title={quoteId?t('Edit draft quotation'):t('Create quotation')} subtitle={t('Build a clear customer offer from saved inventory.')} />
    <ErrorBox message={error}/>
    <form className="quotation-editor-layout" onSubmit={(e)=>void submit(e)}>
      <div className="quotation-editor-main">
        <section className="panel quotation-section"><h2>{t('Customer')}</h2>
          {selectedCustomer ? <div className="quotation-selected-customer"><div><strong>{selectedCustomer.companyName||selectedCustomer.name}</strong><small>{[selectedCustomer.contactName,selectedCustomer.phone,selectedCustomer.email].filter(Boolean).join(' · ')}</small></div><button type="button" onClick={()=>setForm({...form,customerId:''})}>{t('Change')}</button></div> : <>
            <Field label={t('Search customers')}><input value={customerQuery} placeholder={t('Search name, company, phone, or email')} onChange={(e)=>{setCustomerQuery(e.target.value);setForm({...form,customerId:''})}}/></Field>
            <div className="quotation-search-results">{customers?.slice(0,8).map((customer)=><button type="button" key={customer.id} onClick={()=>{setForm({...form,customerId:customer.id});setCustomerQuery(customer.companyName||customer.name)}}><strong>{customer.companyName||customer.name}</strong><small>{customer.contactName} {customer.phone}</small></button>)}</div>
            <button type="button" className="button" onClick={()=>setCustomerDraft(true)}><Plus size={15}/>{t('Add a customer')}</button>
            {customerDraft&&<CustomerCreateInline onCancel={()=>setCustomerDraft(false)} onCreated={(customer)=>{setForm({...form,customerId:customer.id});setCustomerQuery(customer.companyName||customer.name);setCustomerDraft(false)}}/>}
          </>}
        </section>
        <section className="panel quotation-section"><h2>{t('Quotation information')}</h2><div className="form-grid">
          <Field label={t('Issue date')}><input type="date" required value={form.issueDate} onChange={(e)=>setForm({...form,issueDate:e.target.value})}/></Field>
          <Field label={t('Valid until')}><input type="date" min={form.issueDate} required value={form.validUntil} onChange={(e)=>setForm({...form,validUntil:e.target.value})}/></Field>
          <Field label={t('Currency')}><select value={form.currency} onChange={(e)=>setForm({...form,currency:e.target.value as 'THB'|'USD'})}><option value="THB">THB · Thai baht</option><option value="USD">USD · US dollar</option></select></Field>
        </div></section>
        <section className="panel quotation-section"><div className="section-heading"><h2>{t('Products')}</h2><span>{form.items.length} / 100</span></div>
          <Field label={t('Search inventory')}><input value={productQuery} placeholder={t('Search brand, model, SKU, or category')} onChange={(e)=>setProductQuery(e.target.value)}/></Field>
          {productQuery&&<div className="quotation-search-results product-results">{products?.map((product)=><button type="button" key={product.id} disabled={form.items.some((item)=>item.productId===product.id)} onClick={()=>addProduct(product)}>{product.primaryImageId?<img src={`/api/images/${product.primaryImageId}`} alt=""/>:<span className="quotation-image-placeholder"><FileText size={18}/></span>}<span><strong>{product.brand} {product.model}</strong><small>{product.sku} · {product.category} · {formatCurrency(product.sellingPrice,form.currency)}</small></span><Badge value={product.status}/></button>)}</div>}
          <div className="quotation-items">{form.items.map((item,index)=><QuotationItemEditor key={`${item.productId}-${index}`} item={item} index={index} currency={form.currency} count={form.items.length} update={(next)=>updateItem(index,next)} remove={()=>setForm({...form,items:form.items.filter((_,i)=>i!==index)})} move={(direction)=>{const items=[...form.items];const target=index+direction;[items[index],items[target]]=[items[target],items[index]];setForm({...form,items})}}/>)}</div>
          {!form.items.length&&<div className="quotation-no-items">{t('Search inventory above to add equipment.')}</div>}
        </section>
        <section className="panel quotation-section"><h2>{t('Additional charges and tax')}</h2><div className="form-grid">
          {([['discount','Quotation discount'],['deliveryFee','Delivery fee'],['installationFee','Installation fee'],['otherCharges','Other charges']] as const).map(([key,label])=><Field key={key} label={`${t(label)} (${form.currency})`}><input type="number" min="0" step="0.01" inputMode="decimal" value={form[key]||''} onChange={(e)=>setForm({...form,[key]:Number(e.target.value||0)})}/></Field>)}
          <Field label={t('VAT rate (%)')}><input type="number" min="0" max="100" step="0.01" inputMode="decimal" value={form.vatRate} onChange={(e)=>setForm({...form,vatRate:Number(e.target.value||0)})}/></Field>
          <Field label={t('Tax calculation')}><select value={form.taxMode} onChange={(e)=>setForm({...form,taxMode:e.target.value as 'EXCLUSIVE'|'INCLUSIVE'})}><option value="EXCLUSIVE">{t('Tax exclusive')}</option><option value="INCLUSIVE">{t('Tax inclusive')}</option></select></Field>
        </div><label className="quotation-check"><input type="checkbox" checked={form.vatEnabled} onChange={(e)=>setForm({...form,vatEnabled:e.target.checked})}/>{t('Apply VAT')}</label></section>
        <section className="panel quotation-section"><h2>{t('Terms and notes')}</h2><div className="form-grid">
          {([['paymentTerms','Payment terms'],['deliveryTerms','Delivery terms'],['warrantyTerms','Warranty terms']] as const).map(([key,label])=><Field key={key} label={t(label)}><textarea rows={3} value={form[key]} onChange={(e)=>setForm({...form,[key]:e.target.value})}/></Field>)}
        </div><Field label={t('Additional notes')}><textarea rows={3} value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></Field></section>
      </div>
      <aside className="panel quotation-summary"><h2>{t('Summary')}</h2>
        {[[t('Subtotal'),summary.subtotal],[t('Quotation discount'),-Number(form.discount||0)],[t('Delivery fee'),Number(form.deliveryFee||0)],[t('Installation fee'),Number(form.installationFee||0)],[t('Other charges'),Number(form.otherCharges||0)],[t('Before tax'),summary.beforeTax],[t('VAT'),summary.vat]].map(([label,value])=><div className="quotation-summary-line" key={String(label)}><span>{label}</span><strong>{formatCurrency(Number(value),form.currency)}</strong></div>)}
        <div className="quotation-grand-total"><span>{t('Grand total')}</span><strong>{formatCurrency(summary.total,form.currency)}</strong></div>
        <div className="quotation-summary-actions"><button className="primary" disabled={busy}>{busy?t('Saving…'):t('Save draft')}</button><Link className="button" to={quoteId?`/quotations/${quoteId}`:'/quotations'}>{t('Cancel')}</Link></div>
        <small>{t('Rounding: nearest minor currency unit. Totals are recalculated on save.')}</small>
      </aside>
    </form>
  </>;
}

const PdfPreview = lazy(() => import('../components/QuotationPdf'));
export function QuotationPage() {
  const { id }=useParams();
  const navigate=useNavigate();
  const {data:quote,error,reload}=useData<Quotation>(`/quotations/${id}`);
  const [actionError,setActionError]=useState('');
  const [busy,setBusy]=useState(false);
  const [showPdf,setShowPdf]=useState(false);
  const [pdfAssets,setPdfAssets]=useState<Record<string,string>>({});
  const [assetsBusy,setAssetsBusy]=useState(false);
  useEffect(()=>{
    if(!quote||!showPdf)return;
    let active=true;
    setAssetsBusy(true);
    const load=async()=>{
      const result:Record<string,string>={};
      const urls=[...quote.items.filter((item)=>item.imageAvailable).map((item)=>[`/api/quotations/${quote.id}/items/${item.id}/image`,item.id] as const),...(quote.company.logoAvailable?[[`/api/quotations/${quote.id}/company-logo`,'companyLogo'] as const]:[])];
      await Promise.all(urls.map(async([url,key])=>{try{const response=await fetch(url);if(response.ok){const blob=await response.blob();result[key]=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)})}}catch{/* Missing optional snapshot images are omitted from the PDF. */}}));
      if(active){setPdfAssets(result);setAssetsBusy(false)}
    };
    void load();
    return()=>{active=false};
  },[quote,showPdf]);
  if(!quote)return <><ErrorBox message={error}/>{!error&&<Loading/>}</>;
  async function changeStatus(status:QuotationStatus){setBusy(true);setActionError('');try{await api(`/quotations/${quote!.id}/status`,{method:'POST',body:JSON.stringify({status})});reload()}catch(e){setActionError((e as Error).message)}finally{setBusy(false)}}
  async function duplicate(){setBusy(true);setActionError('');try{const copy=await api<Quotation>(`/quotations/${quote!.id}/duplicate`,{method:'POST'});navigate(`/quotations/${copy.id}/edit`)}catch(e){setActionError((e as Error).message)}finally{setBusy(false)}}
  const Pdf = PdfPreview;
  return <>
    <Link className="back" to="/quotations"><ArrowLeft size={16}/>{t('Quotations')}</Link>
    <Header title={quote.quotationNumber} subtitle={`${quote.customer.companyName||quote.customer.name} · ${date(quote.issueDate)}`} action={<div className="header-actions"><button type="button" onClick={()=>void duplicate()} disabled={busy}><Copy size={16}/>{t('Duplicate')}</button>{quote.status==='DRAFT'&&<Link className="button" to={`/quotations/${quote.id}/edit`}>{t('Edit draft')}</Link>}<button className="primary" type="button" onClick={()=>setShowPdf((v)=>!v)}><FileText size={16}/>{showPdf?t('Hide PDF'):t('Preview / download PDF')}</button></div>}/>
    <ErrorBox message={actionError}/>
    <div className="quotation-detail-layout"><div className="panel quotation-detail-card">
      <div className="section-heading"><h2>{t('Quotation details')}</h2><Badge value={quote.status}/></div>
      <div className="quotation-facts">{[[t('Customer'),quote.customer.companyName||quote.customer.name],[t('Issue date'),date(quote.issueDate)],[t('Valid until'),date(quote.validUntil)],[t('Sales contact'),quote.salesContactName],[t('Status'),t(quote.status)]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="quotation-detail-items"><h3>{t('Products')}</h3>{quote.items.map((item)=><div className="quotation-detail-item" key={item.id}>{item.imageAvailable?<img src={`/api/quotations/${quote.id}/items/${item.id}/image`} alt=""/>:<div className="quotation-image-placeholder"><FileText size={18}/></div>}<div className="grow"><strong>{item.productName}</strong><small>{item.sku} · {item.condition||t('Condition not specified')}</small><small>{item.quantity} × {formatCurrency(item.unitPrice,quote.currency)}</small>{item.productStatus==='SOLD'||item.productStatus==='RESERVED'?<span className="warning">{t(item.productStatus==='SOLD'?'This product is sold.':'This product is reserved.')}</span>:null}</div><strong>{formatCurrency(item.lineTotal,quote.currency)}</strong></div>)}</div>
      <div className="quotation-detail-totals">{[[t('Subtotal'),quote.subtotal],[t('Quotation discount'),-quote.discount],[t('Delivery fee'),quote.deliveryFee],[t('Installation fee'),quote.installationFee],[t('Other charges'),quote.otherCharges],[t('Before tax'),quote.beforeTax],...(quote.vatEnabled?[[`${t('VAT')} (${quote.vatRate}%)`,quote.vatAmount] as [string,number]]:[])].map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{formatCurrency(Number(value),quote.currency)}</strong></div>)}<div className="quotation-grand-total"><span>{t('Grand total')}</span><strong>{formatCurrency(quote.grandTotal,quote.currency)}</strong></div></div>
      {[['Payment terms',quote.paymentTerms],['Delivery terms',quote.deliveryTerms],['Warranty terms',quote.warrantyTerms],['Additional notes',quote.notes]].map(([label,value])=>value&&<div className="quotation-detail-term" key={label}><strong>{t(label)}</strong><p>{value}</p></div>)}
      <div className="quotation-status-actions"><h3>{t('Change status')}</h3><div>{quotationStatuses.filter((status)=>status!==quote.status).map((status)=><button key={status} type="button" disabled={busy} onClick={()=>void changeStatus(status)}>{t(status)}</button>)}</div></div>
      <div className="quotation-history"><h3>{t('Status history')}</h3>{quote.history.map((entry)=><div key={entry.id}><span>{date(entry.createdAt)}</span><strong>{entry.fromStatus?t(entry.fromStatus):t('Created')} → {t(entry.toStatus)}</strong><small>{entry.changedBy}</small></div>)}</div>
    </div>
    {showPdf&&<section className="panel quotation-pdf-panel"><div className="section-heading"><h2>{t('PDF preview')}</h2><button type="button" onClick={()=>setShowPdf(false)}>{t('Close')}</button></div>{assetsBusy?<Loading/>:<Suspense fallback={<Loading/>}><Pdf quote={quote} assets={pdfAssets}/></Suspense>}</section>}
    </div>
  </>;
}
