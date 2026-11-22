import { Suspense, lazy, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileText, Search, Trash2 } from 'lucide-react';
import {
  invoiceStatuses,
  invoiceTransitions,
  type Invoice,
  type InvoiceListItem,
  type InvoiceStatus,
  type InvoiceUpdateInput,
} from '../../shared/invoices';
import { quotationItemTitle, type Quotation } from '../../shared/quotations';
import { calculateQuotationTotals, fromMinor, toMinor } from '../../shared/quotation-money';
import type { PrintableDocument, PrintOptions } from '../quotationPrint';
import { api, date, useData, useDebounce } from '../lib';
import { t } from '../i18n';
import { AddLink, Badge, Empty, ErrorBox, Field, Header, Loading } from '../components/ui';
import { formatCurrency } from './Quotations';

type DraftItem = {
  id: string;
  productId: string | null;
  sku: string;
  imageAvailable: boolean;
  displayName: string;
  description: string;
  quantity: number;
  unitPrice: string;
  discount: string;
};
type DraftForm = Omit<InvoiceUpdateInput, 'items'> & { items: DraftItem[] };

const customerName = (invoice: Pick<Invoice, 'customer'>) =>
  invoice.customer.companyName || invoice.customer.name;

const actionLabels: Record<InvoiceStatus, string> = {
  DRAFT: 'Back to draft',
  ISSUED: 'Issue invoice',
  DEPOSIT_COMPLETE: 'Mark deposit complete',
  PAYMENT_COMPLETE: 'Mark payment complete',
  CANCELLED: 'Cancel invoice',
};

/** Status changes that move stock ask for confirmation first. */
function confirmMessage(invoice: Invoice, next: InvoiceStatus) {
  const products = invoice.items
    .filter((item) => item.productId)
    .map((item) => `• ${item.sku} ${quotationItemTitle(item.productName, item.specification)}`)
    .join('\n');
  if (next === 'DEPOSIT_COMPLETE')
    return `${t('Mark the deposit as complete? These products will be reserved for')} ${customerName(invoice)}:\n\n${products}`;
  if (next === 'PAYMENT_COMPLETE')
    return `${t('Mark the payment as complete? These products will be marked sold to')} ${customerName(invoice)}:\n\n${products}\n\n${t('This cannot be undone.')}`;
  if (next === 'CANCELLED' && invoice.status === 'DEPOSIT_COMPLETE')
    return `${t('Cancel this invoice? The reservations for these products will be released:')}\n\n${products}`;
  if (next === 'CANCELLED') return t('Cancel this invoice?');
  return '';
}

/** Server stock errors list SKUs after a fixed prefix; translate the fixed parts. */
function localizeStockError(message: string) {
  const match = /^(These products cannot be (?:reserved|sold)): (.*)\.$/.exec(message);
  if (!match) return message;
  const list = match[2].replace(
    /\((archived|already sold|not available|reserved for another customer)\)/g,
    (_, reason: string) => `(${t(reason)})`,
  );
  return `${t(match[1])}: ${list}`;
}

export function invoicePrintOptions(invoice: Invoice): PrintOptions {
  return {
    title: 'Invoice',
    englishTitle: 'INVOICE',
    secondDateLabel: 'Due date',
    reference: ['Quotation reference', invoice.quotationNumber],
    afterTotal:
      invoice.depositAmount > 0
        ? [
            ['Deposit', invoice.depositAmount],
            ['Balance due', fromMinor(toMinor(invoice.grandTotal) - toMinor(invoice.depositAmount))],
          ]
        : [],
    hideStockNotes: true,
  };
}
function printable(invoice: Invoice): PrintableDocument {
  return { ...invoice, quotationNumber: invoice.invoiceNumber, validUntil: invoice.dueDate };
}

export function InvoicesPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('newest');
  const search = useDebounce(query);
  const { data, error } = useData<InvoiceListItem[]>(
    `/invoices?q=${encodeURIComponent(search)}&status=${status}&sort=${sort}`,
  );
  return <>
    <Header title={t('Invoices')} subtitle={t('Invoices issued from quotations. Deposit and payment update stock.')} action={<AddLink to="/invoices/new">{t('Create invoice')}</AddLink>} />
    <div className="panel toolbar quotation-toolbar">
      <label className="search"><Search size={18} /><input aria-label={t('Search invoices')} placeholder={t('Search invoice number, quotation number or customer')} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <select aria-label={t('Filter by status')} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">{t('All invoice statuses')}</option>
        {invoiceStatuses.map((v) => <option key={v} value={v}>{t(v)}</option>)}
      </select>
      <select aria-label={t('Sort by date')} value={sort} onChange={(e) => setSort(e.target.value)}>
        <option value="newest">{t('Newest first')}</option><option value="oldest">{t('Oldest first')}</option>
      </select>
    </div>
    <ErrorBox message={error} />
    {!data && !error ? <Loading /> : data?.length ? <div className="panel quotation-list-wrap">
      <table className="quotation-table"><thead><tr><th>{t('Invoice number')}</th><th>{t('Customer')}</th><th>{t('Quotation reference')}</th><th>{t('Issue date')}</th><th>{t('Due date')}</th><th>{t('Total')}</th><th>{t('Status')}</th></tr></thead>
        <tbody>{data.map((invoice) => <tr key={invoice.id}>
          <td><Link className="text-link" to={`/invoices/${invoice.id}`}><strong>{invoice.invoiceNumber}</strong></Link></td>
          <td><Link className="text-link" to={`/invoices/${invoice.id}`}>{customerName(invoice)}</Link></td>
          <td><Link className="text-link" to={`/quotations/${invoice.quotationId}`}>{invoice.quotationNumber}</Link></td>
          <td>{date(invoice.issueDate)}</td><td>{date(invoice.dueDate)}</td>
          <td className="quotation-money">{formatCurrency(invoice.total, invoice.currency)}</td><td><Badge value={invoice.status} /></td>
        </tr>)}</tbody>
      </table>
      <div className="quotation-cards">{data.map((invoice) => <Link className="quotation-card panel" key={invoice.id} to={`/invoices/${invoice.id}`}>
        <div className="section-heading"><strong>{invoice.invoiceNumber}</strong><Badge value={invoice.status} /></div><span>{customerName(invoice)}</span><small>{invoice.quotationNumber} · {t('Due date')} {date(invoice.dueDate)}</small><strong>{formatCurrency(invoice.total, invoice.currency)}</strong>
      </Link>)}</div>
    </div> : <Empty title={t('No invoices yet')}><p>{t('Open a quotation and choose Create invoice.')}</p></Empty>}
  </>;
}

type QuoteChoice = Pick<Quotation, 'id' | 'quotationNumber' | 'customer' | 'issueDate' | 'currency' | 'status'> & { total: number };

/** Whether a quotation can get a new invoice, and why not. */
function invoiceBlocker(quote: Quotation) {
  if (quote.status === 'CANCELLED' || quote.status === 'REJECTED')
    return t('Cancelled or rejected quotations cannot be invoiced.');
  if (quote.invoice && quote.invoice.status !== 'CANCELLED')
    return t('This quotation already has an invoice. Cancel it before issuing a new one.');
  return '';
}

/** Create an invoice by finding the quotation it comes from. */
export function InvoiceCreate() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('quotationId');
  const [query, setQuery] = useState('');
  const search = useDebounce(query);
  const { data: results } = useData<QuoteChoice[]>(search ? `/quotations?q=${encodeURIComponent(search)}` : null);
  const { data: quote, error: quoteError } = useData<Quotation>(selectedId ? `/quotations/${selectedId}` : null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const blocker = quote ? invoiceBlocker(quote) : '';
  async function create() {
    if (!quote) return;
    setBusy(true); setError('');
    try {
      const invoice = await api<Invoice>('/invoices', { method: 'POST', body: JSON.stringify({ quotationId: quote.id }) });
      navigate(`/invoices/${invoice.id}/edit`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <>
    <Link className="back" to="/invoices"><ArrowLeft size={16} />{t('Invoices')}</Link>
    <Header title={t('Create invoice')} subtitle={t('Find the quotation by its number. Customer, products and prices are copied from it.')} />
    <ErrorBox message={error} />
    <div className="quotation-editor-layout">
      <div className="quotation-editor-main">
        <section className="panel quotation-section"><h2>{t('Quotation')}</h2>
          <Field label={t('Quotation number')}><input autoFocus value={query} placeholder={t('e.g. QT-2026-0003 or customer name')} onChange={(e) => setQuery(e.target.value)} /></Field>
          {search && <div className="quotation-search-results">
            {results?.length ? results.map((choice) => <button type="button" key={choice.id} className={choice.id === selectedId ? 'selected' : ''} onClick={() => { setParams({ quotationId: choice.id }); setQuery(''); }}>
              <span><strong>{choice.quotationNumber}</strong><small>{choice.customer.companyName || choice.customer.name} · {date(choice.issueDate)} · {formatCurrency(choice.total, choice.currency)}</small></span>
              <Badge value={choice.status} />
            </button>) : results ? <div className="quotation-no-items">{t('No quotations match this search.')}</div> : <Loading />}
          </div>}
        </section>
        {selectedId && !quote && <><ErrorBox message={quoteError} />{!quoteError && <Loading />}</>}
        {quote && <section className="panel quotation-section">
          <div className="section-heading"><h2>{quote.quotationNumber}</h2><Badge value={quote.status} /></div>
          <div className="quotation-facts">{[[t('Customer'), quote.customer.companyName || quote.customer.name], [t('Issue date'), date(quote.issueDate)], [t('Sales contact'), quote.salesContactName]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
          <div className="quotation-detail-items"><h3>{t('Products')}</h3>{quote.items.map((item) => <div className="quotation-detail-item" key={item.id}>
            {item.imageAvailable ? <img src={`/api/quotations/${quote.id}/items/${item.id}/image`} alt="" /> : <div className="quotation-image-placeholder"><FileText size={18} /></div>}
            <div className="grow"><strong>{quotationItemTitle(item.productName, item.specification)}</strong><small>{item.sku}</small><small>{item.quantity} × {formatCurrency(item.unitPrice, quote.currency)}</small>{item.productStatus && item.productStatus !== 'AVAILABLE' ? <span className="invoice-stock"><Badge value={item.productStatus} /></span> : null}</div>
            <strong>{formatCurrency(item.lineTotal, quote.currency)}</strong>
          </div>)}</div>
          {quote.invoice && <p className="muted">{t('Linked invoice')}: <Link className="text-link" to={`/invoices/${quote.invoice.id}`}>{quote.invoice.invoiceNumber}</Link> · {t(quote.invoice.status)}</p>}
        </section>}
      </div>
      <aside className="panel quotation-summary"><h2>{t('Summary')}</h2>
        {quote ? <>
          {[[t('Subtotal'), quote.subtotal], ...(quote.vatEnabled ? [[`${t('VAT')} (${quote.vatRate}%)`, quote.vatAmount] as [string, number]] : [])].map(([label, value]) => <div className="quotation-summary-line" key={String(label)}><span>{label}</span><strong>{formatCurrency(Number(value), quote.currency)}</strong></div>)}
          <div className="quotation-grand-total"><span>{t('Grand total')}</span><strong>{formatCurrency(quote.grandTotal, quote.currency)}</strong></div>
          {blocker ? <div className="warning">{blocker}</div> : null}
          <div className="quotation-summary-actions"><button type="button" className="primary" disabled={busy || !!blocker} onClick={() => void create()}>{busy ? t('Saving…') : t('Create invoice')}</button><Link className="button" to="/invoices">{t('Cancel')}</Link></div>
          <small>{t('The invoice starts as a draft, so you can set the deposit and due date next.')}</small>
        </> : <p className="muted">{t('Search for a quotation to see its products and total.')}</p>}
      </aside>
    </div>
  </>;
}

const PdfPreview = lazy(() => import('../components/QuotationPdf'));
export function InvoicePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: invoice, error, reload } = useData<Invoice>(`/invoices/${id}`);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [pdfAssets, setPdfAssets] = useState<Record<string, string>>({});
  const [assetsBusy, setAssetsBusy] = useState(false);
  useEffect(() => {
    if (!invoice || !showPdf) return;
    let active = true;
    setAssetsBusy(true);
    const load = async () => {
      const result: Record<string, string> = {};
      const urls = [
        ...invoice.items.filter((item) => item.imageAvailable).map((item) => [`/api/invoices/${invoice.id}/items/${item.id}/image`, item.id] as const),
        ...(invoice.company.logoAvailable ? [[`/api/invoices/${invoice.id}/company-logo`, 'companyLogo'] as const] : []),
      ];
      await Promise.all(urls.map(async ([url, key]) => {
        try {
          const response = await fetch(url);
          if (!response.ok) return;
          const blob = await response.blob();
          result[key] = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        } catch { /* Missing optional images are left out of the printout. */ }
      }));
      if (active) { setPdfAssets(result); setAssetsBusy(false); }
    };
    void load();
    return () => { active = false; };
  }, [invoice, showPdf]);
  if (!invoice) return <><ErrorBox message={error} />{!error && <Loading />}</>;
  const current = invoice;
  async function changeStatus(next: InvoiceStatus) {
    const message = confirmMessage(current, next);
    if (message && !window.confirm(message)) return;
    setBusy(true); setActionError('');
    try { await api(`/invoices/${current.id}/status`, { method: 'POST', body: JSON.stringify({ status: next }) }); reload(); }
    catch (e) { setActionError(localizeStockError((e as Error).message)); }
    finally { setBusy(false); }
  }
  async function remove() {
    const message = current.status === 'DEPOSIT_COMPLETE'
      ? `${t('Delete this invoice? The reservations for these products will be released:')}\n\n${current.items.filter((item) => item.productId).map((item) => `• ${item.sku} ${quotationItemTitle(item.productName, item.specification)}`).join('\n')}`
      : t('Delete this invoice? This cannot be undone.');
    if (!window.confirm(`${current.invoiceNumber}\n\n${message}`)) return;
    setBusy(true); setActionError('');
    try { await api(`/invoices/${current.id}`, { method: 'DELETE' }); navigate('/invoices'); }
    catch (e) { setActionError((e as Error).message); setBusy(false); }
  }
  const balance = fromMinor(toMinor(invoice.grandTotal) - toMinor(invoice.depositAmount));
  const nextStatuses = invoiceTransitions[invoice.status];
  const Pdf = PdfPreview;
  return <>
    <Link className="back" to="/invoices"><ArrowLeft size={16} />{t('Invoices')}</Link>
    <Header title={invoice.invoiceNumber} subtitle={`${customerName(invoice)} · ${date(invoice.issueDate)}`} action={<div className="header-actions">
      <Link className="button" to={`/quotations/${invoice.quotationId}`}><FileText size={16} />{invoice.quotationNumber}</Link>
      {invoice.status === 'DRAFT' && <Link className="button" to={`/invoices/${invoice.id}/edit`}>{t('Edit draft')}</Link>}
      {invoice.status !== 'PAYMENT_COMPLETE' && <button type="button" className="danger" disabled={busy} onClick={() => void remove()}><Trash2 size={16} />{t('Delete invoice')}</button>}
      <button className="primary" type="button" onClick={() => setShowPdf((v) => !v)}><FileText size={16} />{showPdf ? t('Hide PDF') : t('Preview / download PDF')}</button>
    </div>} />
    <ErrorBox message={actionError} />
    <div className="quotation-detail-layout"><div className="panel quotation-detail-card">
      <div className="section-heading"><h2>{t('Invoice details')}</h2><Badge value={invoice.status} /></div>
      <div className="quotation-facts">{[[t('Customer'), customerName(invoice)], [t('Issue date'), date(invoice.issueDate)], [t('Due date'), date(invoice.dueDate)], [t('Quotation reference'), invoice.quotationNumber], [t('Sales contact'), invoice.salesContactName], [t('Status'), t(invoice.status)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="quotation-detail-items"><h3>{t('Products')}</h3>{invoice.items.map((item) => <div className="quotation-detail-item" key={item.id}>
        {item.imageAvailable ? <img src={`/api/invoices/${invoice.id}/items/${item.id}/image`} alt="" /> : <div className="quotation-image-placeholder"><FileText size={18} /></div>}
        <div className="grow"><strong>{quotationItemTitle(item.productName, item.specification)}</strong><small>{item.sku}</small><small>{item.quantity} × {formatCurrency(item.unitPrice, invoice.currency)}</small>
          {item.productStatus ? <span className="invoice-stock"><Badge value={item.productStatus} />{item.productStatus === 'RESERVED' && item.reservedForCustomerId && item.reservedForCustomerId !== invoice.customerId ? <span className="warning">{t('Reserved for another customer')}</span> : null}</span> : <span className="warning">{t('Not linked to a stock product')}</span>}
        </div>
        <strong>{formatCurrency(item.lineTotal, invoice.currency)}</strong>
      </div>)}</div>
      <div className="quotation-detail-totals">
        {[[t('Subtotal'), invoice.subtotal], [t('Quotation discount'), -invoice.discount], [t('Delivery fee'), invoice.deliveryFee], [t('Installation fee'), invoice.installationFee], [t('Other charges'), invoice.otherCharges], ...(invoice.vatEnabled ? [[t('Before tax'), invoice.beforeTax] as [string, number], [`${t('VAT')} (${invoice.vatRate}%)`, invoice.vatAmount] as [string, number]] : [])].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{formatCurrency(Number(value), invoice.currency)}</strong></div>)}
        <div className="quotation-grand-total"><span>{t('Grand total')}</span><strong>{formatCurrency(invoice.grandTotal, invoice.currency)}</strong></div>
        {invoice.depositAmount > 0 && <><div><span>{t('Deposit')}</span><strong>{formatCurrency(invoice.depositAmount, invoice.currency)}</strong></div><div><span>{t('Balance due')}</span><strong>{formatCurrency(balance, invoice.currency)}</strong></div></>}
      </div>
      {[['Payment terms', invoice.paymentTerms], ['Delivery terms', invoice.deliveryTerms], ['Warranty terms', invoice.warrantyTerms], ['Additional notes', invoice.notes]].map(([label, value]) => value && <div className="quotation-detail-term" key={label}><strong>{t(label)}</strong><p>{value}</p></div>)}
      <div className="quotation-status-actions"><h3>{t('Change status')}</h3>
        {nextStatuses.length ? <div>{nextStatuses.map((next) => <button key={next} type="button" className={next === 'CANCELLED' ? 'danger' : next === 'ISSUED' ? '' : 'primary'} disabled={busy} onClick={() => void changeStatus(next)}>{t(actionLabels[next])}</button>)}</div> : <p className="muted">{t(invoice.status === 'PAYMENT_COMPLETE' ? 'Paid in full. The products are marked sold.' : 'This invoice is cancelled.')}</p>}
        <small>{t('Deposit complete reserves the products for this customer. Payment complete marks them sold.')}</small>
      </div>
      <div className="quotation-history"><h3>{t('Status history')}</h3>{invoice.history.map((entry) => <div key={entry.id}><span>{date(entry.createdAt)}</span><strong>{entry.fromStatus ? t(entry.fromStatus) : t('Created')} → {t(entry.toStatus)}</strong><small>{entry.changedBy}</small></div>)}</div>
    </div>
    {showPdf && <section className="panel quotation-pdf-panel"><div className="section-heading"><h2>{t('PDF preview')}</h2><button type="button" onClick={() => setShowPdf(false)}>{t('Close')}</button></div>{assetsBusy ? <Loading /> : <Suspense fallback={<Loading />}><Pdf quote={printable(invoice)} assets={pdfAssets} options={invoicePrintOptions(invoice)} downloadLabel="Download HTML invoice" /></Suspense>}</section>}
    </div>
  </>;
}

function draftFromInvoice(invoice: Invoice): DraftForm {
  return {
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    items: invoice.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      sku: item.sku,
      imageAvailable: item.imageAvailable,
      displayName: item.productName,
      description: item.description,
      quantity: item.quantity,
      unitPrice: String(item.unitPrice),
      discount: String(item.discount || ''),
    })),
    discount: invoice.discount,
    deliveryFee: invoice.deliveryFee,
    installationFee: invoice.installationFee,
    otherCharges: invoice.otherCharges,
    vatEnabled: invoice.vatEnabled,
    vatRate: invoice.vatRate,
    taxMode: invoice.taxMode,
    depositAmount: invoice.depositAmount,
    paymentTerms: invoice.paymentTerms,
    deliveryTerms: invoice.deliveryTerms,
    warrantyTerms: invoice.warrantyTerms,
    notes: invoice.notes,
  };
}

export function InvoiceForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: invoice, error: loadError } = useData<Invoice>(`/invoices/${id}`);
  const [form, setForm] = useState<DraftForm>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (invoice && !form) setForm(draftFromInvoice(invoice)); }, [invoice, form]);
  if (!invoice || !form) return <><ErrorBox message={loadError} />{!loadError && <Loading />}</>;
  if (invoice.status !== 'DRAFT') return <><ErrorBox message={t('Only draft invoices can be edited.')} /><Link className="button" to={`/invoices/${invoice.id}`}>{t('Back to invoice')}</Link></>;
  const draft = form;
  let summary = { subtotal: 0, beforeTax: 0, vat: 0, total: 0 };
  try {
    const totals = calculateQuotationTotals({
      lines: draft.items.map((item) => ({ quantity: item.quantity, unitPriceMinor: toMinor(Number(item.unitPrice || 0)), discountMinor: toMinor(Number(item.discount || 0)) })),
      discountMinor: toMinor(Number(draft.discount || 0)),
      deliveryFeeMinor: toMinor(Number(draft.deliveryFee || 0)),
      installationFeeMinor: toMinor(Number(draft.installationFee || 0)),
      otherChargesMinor: toMinor(Number(draft.otherCharges || 0)),
      vatEnabled: draft.vatEnabled,
      vatRateBps: Math.round(Number(draft.vatRate || 0) * 100),
      taxMode: draft.taxMode,
    });
    summary = { subtotal: fromMinor(totals.subtotalMinor), beforeTax: fromMinor(totals.beforeTaxMinor), vat: fromMinor(totals.vatMinor), total: fromMinor(totals.grandTotalMinor) };
  } catch { /* Invalid numbers show zero until corrected. */ }
  const updateItem = (index: number, next: DraftItem) => setForm({ ...draft, items: draft.items.map((item, i) => (i === index ? next : item)) });
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!draft.items.length) { setError(t('Keep at least one product.')); return; }
    setBusy(true);
    try {
      const payload: InvoiceUpdateInput = {
        ...draft,
        discount: Number(draft.discount || 0),
        deliveryFee: Number(draft.deliveryFee || 0),
        installationFee: Number(draft.installationFee || 0),
        otherCharges: Number(draft.otherCharges || 0),
        depositAmount: Number(draft.depositAmount || 0),
        items: draft.items.map((item) => ({ id: item.id, displayName: item.displayName, description: item.description, quantity: item.quantity, unitPrice: Number(item.unitPrice || 0), discount: Number(item.discount || 0) })),
      };
      await api<Invoice>(`/invoices/${invoice!.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      navigate(`/invoices/${invoice!.id}`);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <Link className="back" to={`/invoices/${invoice.id}`}><ArrowLeft size={16} />{invoice.invoiceNumber}</Link>
    <Header title={t('Edit draft invoice')} subtitle={`${customerName(invoice)} · ${t('Quotation reference')} ${invoice.quotationNumber}`} />
    <ErrorBox message={error} />
    <form className="quotation-editor-layout" onSubmit={(e) => void submit(e)}>
      <div className="quotation-editor-main">
        <section className="panel quotation-section"><h2>{t('Invoice details')}</h2><div className="form-grid">
          <Field label={t('Issue date')}><input className="quotation-date-input" type="date" required value={draft.issueDate} onChange={(e) => setForm({ ...draft, issueDate: e.target.value })} /></Field>
          <Field label={t('Due date')}><input className="quotation-date-input" type="date" required value={draft.dueDate} onChange={(e) => setForm({ ...draft, dueDate: e.target.value })} /></Field>
          <Field label={`${t('Deposit')} (${invoice.currency})`}><input type="number" min="0" step="0.01" inputMode="decimal" value={draft.depositAmount || ''} onChange={(e) => setForm({ ...draft, depositAmount: Number(e.target.value || 0) })} /></Field>
        </div></section>
        <section className="panel quotation-section"><h2>{t('Products')}</h2><p className="muted">{t('Products come from the quotation. You can change prices or remove a product, but not add new ones.')}</p>
          <div className="quotation-items">{draft.items.map((item, index) => {
            const total = Math.max(0, item.quantity * Number(item.unitPrice || 0) - Number(item.discount || 0));
            return <article className="quotation-item-editor panel" key={item.id}>
              <div className="quotation-item-top">
                {item.imageAvailable ? <img src={`/api/invoices/${invoice.id}/items/${item.id}/image`} alt="" /> : <div className="quotation-image-placeholder"><FileText size={20} /></div>}
                <div className="grow"><strong>{item.displayName}</strong><small>{item.sku}</small></div>
                <div className="quotation-item-order"><button type="button" className="icon-button danger" aria-label={t('Remove item')} disabled={draft.items.length === 1} onClick={() => setForm({ ...draft, items: draft.items.filter((_, i) => i !== index) })}><Trash2 size={16} /></button></div>
              </div>
              <div className="form-grid quotation-item-fields">
                <Field label={t('Display name')}><input value={item.displayName} onChange={(e) => updateItem(index, { ...item, displayName: e.target.value })} /></Field>
                <Field label={t('Quantity')}><input type="number" min="1" max="10000" step="1" value={item.quantity} onChange={(e) => updateItem(index, { ...item, quantity: Math.max(1, Number(e.target.value) || 1) })} /></Field>
                <Field label={`${t('Unit price')} (${invoice.currency})`}><input type="number" min="0" step="0.01" inputMode="decimal" value={item.unitPrice} onChange={(e) => updateItem(index, { ...item, unitPrice: e.target.value })} /></Field>
                <Field label={`${t('Item discount')} (${invoice.currency})`}><input type="number" min="0" step="0.01" inputMode="decimal" value={item.discount} onChange={(e) => updateItem(index, { ...item, discount: e.target.value })} /></Field>
              </div>
              <Field label={t('Description')}><textarea rows={3} value={item.description} onChange={(e) => updateItem(index, { ...item, description: e.target.value })} /></Field>
              <div className="quotation-item-total"><span>{t('Line total')}</span><strong>{formatCurrency(total, invoice.currency)}</strong></div>
            </article>;
          })}</div>
        </section>
        <section className="panel quotation-section"><h2>{t('Additional charges and tax')}</h2><div className="form-grid">
          {([['discount', 'Quotation discount'], ['deliveryFee', 'Delivery fee'], ['installationFee', 'Installation fee'], ['otherCharges', 'Other charges']] as const).map(([key, label]) => <Field key={key} label={`${t(label)} (${invoice.currency})`}><input type="number" min="0" step="0.01" inputMode="decimal" value={draft[key] || ''} onChange={(e) => setForm({ ...draft, [key]: Number(e.target.value || 0) })} /></Field>)}
          <Field label={t('VAT rate (%)')}><input type="number" min="0" max="100" step="0.01" inputMode="decimal" value={draft.vatRate} onChange={(e) => setForm({ ...draft, vatRate: Number(e.target.value || 0) })} /></Field>
          <Field label={t('Tax calculation')}><select value={draft.taxMode} onChange={(e) => setForm({ ...draft, taxMode: e.target.value as 'EXCLUSIVE' | 'INCLUSIVE' })}><option value="EXCLUSIVE">{t('Tax exclusive')}</option><option value="INCLUSIVE">{t('Tax inclusive')}</option></select></Field>
        </div><label className="quotation-check"><input type="checkbox" checked={draft.vatEnabled} onChange={(e) => setForm({ ...draft, vatEnabled: e.target.checked })} />{t('Apply VAT')}</label></section>
        <section className="panel quotation-section"><h2>{t('Terms and notes')}</h2><div className="form-grid">
          {([['paymentTerms', 'Payment terms'], ['deliveryTerms', 'Delivery terms'], ['warrantyTerms', 'Warranty terms']] as const).map(([key, label]) => <Field key={key} label={t(label)}><textarea rows={3} value={draft[key]} onChange={(e) => setForm({ ...draft, [key]: e.target.value })} /></Field>)}
        </div><Field label={t('Additional notes')}><textarea rows={3} value={draft.notes} onChange={(e) => setForm({ ...draft, notes: e.target.value })} /></Field></section>
      </div>
      <aside className="panel quotation-summary"><h2>{t('Summary')}</h2>
        {[[t('Subtotal'), summary.subtotal], [t('Quotation discount'), -Number(draft.discount || 0)], [t('Delivery fee'), Number(draft.deliveryFee || 0)], [t('Installation fee'), Number(draft.installationFee || 0)], [t('Other charges'), Number(draft.otherCharges || 0)], ...(draft.vatEnabled ? [[t('Before tax'), summary.beforeTax], [t('VAT'), summary.vat]] as [string, number][] : [])].map(([label, value]) => <div className="quotation-summary-line" key={String(label)}><span>{label}</span><strong>{formatCurrency(Number(value), invoice.currency)}</strong></div>)}
        <div className="quotation-grand-total"><span>{t('Grand total')}</span><strong>{formatCurrency(summary.total, invoice.currency)}</strong></div>
        {Number(draft.depositAmount || 0) > 0 && <><div className="quotation-summary-line"><span>{t('Deposit')}</span><strong>{formatCurrency(Number(draft.depositAmount), invoice.currency)}</strong></div><div className="quotation-summary-line"><span>{t('Balance due')}</span><strong>{formatCurrency(Math.max(0, summary.total - Number(draft.depositAmount)), invoice.currency)}</strong></div></>}
        <div className="quotation-summary-actions"><button className="primary" disabled={busy}>{busy ? t('Saving…') : t('Save draft')}</button><Link className="button" to={`/invoices/${invoice.id}`}>{t('Cancel')}</Link></div>
      </aside>
    </form>
  </>;
}
