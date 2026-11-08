import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Paperclip, Plus, ReceiptText, Search, Wallet, X } from 'lucide-react';
import { api, money, useData } from '../lib';
import { getLanguage, t } from '../i18n';
import { Empty, ErrorBox, Field, Header, Loading } from '../components/ui';
import type { Product } from '../../shared/schemas';

type Category = { id: string; name: string; defaultExpenseType: string; isActive: number | boolean };
type Expense = { id: string; expenseNumber: string; expenseDate: string; description: string; categoryId: string; categoryName: string; expenseType: string; amount: number; currency: string; exchangeRate: number; exchangeRateDate: string; convertedThb: number; vendor: string; paymentMethod: string; dueDate: string | null; notes: string; paid: number; paidThb: number; outstanding: number; outstandingThb: number; status: string; isOverdue: boolean };
type Overview = { from: string; to: string; expenseRecognition: { operatingExpenses: number; inventoryPurchases: number; productCosts: number; other: number }; cashPaid: number; outstandingPayables: number; overduePayables: number; overdueCount: number; salesRevenue: number; costOfGoodsSold: number; grossProfit: number; estimatedOperatingProfit: number; cashReceived: number | null; cashReceivedLimitation: string; categories: { id: string; name: string; total: number }[]; monthlyTrend: { month: string; expenseType: string; total: number }[]; dailyTrend: { day: string; total: number }[] };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const dateLocale = () => getLanguage() === 'th' ? 'th-TH' : 'en-US';
const readableDate = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(`${value.slice(0, 10)}T12:00:00+07:00`))
  : '—';
const readableDateTime = (value: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value));
const types = ['OPERATING_EXPENSE', 'INVENTORY_PURCHASE', 'PRODUCT_COST', 'OTHER'];
const maxExpenseAttachmentBytes = 10 * 1024 * 1024;
async function compressExpenseImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.82),
    );
    if (!compressed || compressed.size >= file.size) return file;
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'expense-receipt';
    return new File([compressed], `${baseName}.webp`, {
      type: 'image/webp',
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}
const isExpenseImage = (file: File) =>
  file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name);
const isSupportedExpenseAttachment = (file: File) =>
  ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) ||
  /\.(jpe?g|png|webp|pdf)$/i.test(file.name);

export function FinanceOverviewPage() {
  const [range, setRange] = useState({ from: `${today().slice(0, 7)}-01`, to: today() });
  const [preset, setPreset] = useState('THIS_MONTH');
  const { data, error } = useData<Overview>(`/finance/overview?from=${range.from}&to=${range.to}`);
  if (error) return <><Header title={t('Finance')} /><ErrorBox message={error} /></>;
  if (!data) return <Loading />;
  const cards = [
    [t('Operating expenses'), money(data.expenseRecognition.operatingExpenses)],
    [t('Inventory purchases'), money(data.expenseRecognition.inventoryPurchases)],
    [t('Product costs'), money(data.expenseRecognition.productCosts)],
    [t('Cash paid to suppliers'), money(data.cashPaid)],
    [t('Outstanding payables'), money(data.outstandingPayables)],
    [t('Overdue payables'), `${money(data.overduePayables)} · ${data.overdueCount}`],
    [t('Sales revenue'), money(data.salesRevenue)],
    [t('Estimated gross profit'), money(data.grossProfit)],
    [t('Estimated operating profit'), money(data.estimatedOperatingProfit)],
  ];
  const monthly = new Map<string, number>();
  for (const item of data.monthlyTrend) monthly.set(item.month, (monthly.get(item.month) ?? 0) + item.total);
  const monthlyMax = Math.max(1, ...monthly.values());
  const categoryMax = Math.max(1, ...data.categories.map((item) => item.total));
  const dailyMax = Math.max(1, ...data.dailyTrend.map((item) => item.total));
  function selectPreset(value: string) {
    setPreset(value);
    const current = new Date(`${today()}T12:00:00+07:00`);
    const start = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}-01`;
    if (value === 'THIS_MONTH') setRange({ from: start(current.getFullYear(), current.getMonth()), to: today() });
    if (value === 'LAST_MONTH') { const date = new Date(current.getFullYear(), current.getMonth() - 1, 1); const end = new Date(current.getFullYear(), current.getMonth(), 0); setRange({ from: start(date.getFullYear(), date.getMonth()), to: end.toISOString().slice(0, 10) }); }
    if (value === 'LAST_3_MONTHS') { const date = new Date(current.getFullYear(), current.getMonth() - 2, 1); setRange({ from: start(date.getFullYear(), date.getMonth()), to: today() }); }
    if (value === 'THIS_YEAR') setRange({ from: `${current.getFullYear()}-01-01`, to: today() });
  }
  return <>
    <Header eyebrow={t('FINANCE')} title={t('Financial overview')} subtitle={`${readableDate(data.from)} – ${readableDate(data.to)}`} action={<Link className="button primary" to="/expenses/new"><Plus size={17} />{t('Quick add expense')}</Link>} />
    <div className="finance-card-grid">{cards.map(([name, value]) => <article className="panel finance-stat" key={name}><span>{name}</span><strong>{value}</strong></article>)}</div>
    <section className="panel finance-period-filter"><label>{t('Period')}<select value={preset} onChange={(e) => selectPreset(e.target.value)}><option value="THIS_MONTH">{t('This month')}</option><option value="LAST_MONTH">{t('Last month')}</option><option value="LAST_3_MONTHS">{t('Last 3 months')}</option><option value="THIS_YEAR">{t('This year')}</option><option value="CUSTOM">{t('Custom range')}</option></select></label><label>{t('From date')}<input type="date" value={range.from} onChange={(e) => { setPreset('CUSTOM'); setRange({ ...range, from: e.target.value }); }} /></label><label>{t('To date')}<input type="date" value={range.to} onChange={(e) => { setPreset('CUSTOM'); setRange({ ...range, to: e.target.value }); }} /></label></section>
    <div className="finance-columns">
      <section className="panel"><h2>{t('Expense categories')}</h2>{data.categories.length ? data.categories.map((item) => <div className="finance-chart-row" key={item.id}><div><span>{item.name}</span><strong>{money(item.total)}</strong></div><div className="finance-chart-track"><i style={{ width: `${Math.max(2, item.total / categoryMax * 100)}%` }} /></div></div>) : <p className="muted">{t('No expenses in this period.')}</p>}</section>
      <section className="panel"><h2>{t('Accounting notes')}</h2><p className="muted">{t('Inventory purchases are tracked separately and are not counted as operating expenses.')}</p><p className="muted">{t('Customer cash receipts cannot be calculated until sales payments are recorded.')}</p><p className="muted">{t('Estimated figures are not a substitute for accounting records.')}</p><Link className="text-link" to="/expenses">{t('View expenses')} →</Link></section>
    </div>
    <div className="finance-columns finance-trend-grid"><section className="panel"><h2>{t('Monthly expense trend')}</h2>{monthly.size ? <div className="finance-bars">{[...monthly.entries()].map(([month,total]) => <div key={month} title={`${month} · ${money(total)}`}><i style={{ height: `${Math.max(3,total/monthlyMax*100)}%` }} /><small>{month.slice(5)}</small></div>)}</div> : <p className="muted">{t('No expenses in this period.')}</p>}</section><section className="panel"><h2>{t('Daily expenses · last 14 days')}</h2>{data.dailyTrend.length ? data.dailyTrend.map((item) => <div className="finance-chart-row" key={item.day}><div><span>{item.day}</span><strong>{money(item.total)}</strong></div><div className="finance-chart-track"><i style={{ width: `${Math.max(2,item.total/dailyMax*100)}%` }} /></div></div>) : <p className="muted">{t('No expenses in this period.')}</p>}</section></div>
    <div className="finance-bottom-actions"><Link className="button" to="/expenses">{t('Manage expenses')}</Link><Link className="button" to="/finance/categories">{t('Expense categories')}</Link></div>
  </>;
}

export function ExpensesPage() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data: categories } = useData<Category[]>('/expense-categories');
  const query = useMemo(() => new URLSearchParams({ ...(q ? { q } : {}), ...(type ? { expenseType: type } : {}), ...(status ? { status } : {}), ...(categoryId ? { categoryId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString(), [q, type, status, categoryId, from, to]);
  const { data, error } = useData<Expense[]>(`/expenses${query ? `?${query}` : ''}`);
  return <>
    <Header eyebrow={t('FINANCE')} title={t('Expenses')} subtitle={t('Record supplier spending, product costs, and payments.')} action={<Link className="button primary" to="/expenses/new"><Plus size={17} />{t('Quick add expense')}</Link>} />
    <section className="panel finance-filters"><label className="search-box"><Search size={18} aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search expense, vendor, or number')} /></label><select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">{t('All categories')}</option>{categories?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={type} onChange={(e) => setType(e.target.value)}><option value="">{t('All expense types')}</option>{types.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('All payment statuses')}</option>{['UNPAID','PARTIALLY_PAID','PAID','CANCELLED'].map((v) => <option key={v} value={v}>{t(v)}</option>)}</select><input aria-label={t('From date')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><input aria-label={t('To date')} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></section>
    {error ? <ErrorBox message={error} /> : !data ? <Loading /> : data.length ? <section className="panel finance-expenses">{data.map((item) => <Link className="finance-expense-row" to={`/expenses/${item.id}`} key={item.id}><span className="finance-expense-icon"><ReceiptText size={19} /></span><span className="finance-expense-main"><strong>{item.description}</strong><small>{item.expenseNumber} · {item.categoryName} · {readableDate(item.expenseDate)}{item.vendor ? ` · ${item.vendor}` : ''}</small></span><span className="finance-expense-total"><strong>{money(item.convertedThb)}</strong><small className={item.isOverdue ? 'finance-overdue' : ''}>{t(item.status)}{item.isOverdue ? ` · ${t('Overdue')}` : ''}</small></span></Link>)}</section> : <Empty title="No expenses found." />}
  </>;
}

export function ExpenseFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: categories } = useData<Category[]>('/expense-categories');
  const { data: existing } = useData<ExpenseDetail>(id ? `/expenses/${id}` : null);
  const [form, setForm] = useState({ expenseDate: today(), description: '', categoryId: '', expenseType: '', amount: '', currency: 'THB', exchangeRate: '1', exchangeRateDate: today(), vendor: '', paymentMethod: '', dueDate: '', notes: '' });
  const [hydratedId, setHydratedId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attachmentType, setAttachmentType] = useState('RECEIPT');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [savedExpenseId, setSavedExpenseId] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [uploadProgress, setUploadProgress] = useState('');
  const activeCategories = categories?.filter((item) => Boolean(item.isActive)) ?? [];
  useEffect(() => {
    if (!id || !existing || hydratedId === id) return;
    const item = existing.expense;
    setForm({ expenseDate: item.expenseDate, description: item.description, categoryId: item.categoryId, expenseType: item.expenseType, amount: String(item.amount), currency: item.currency, exchangeRate: String(item.exchangeRate), exchangeRateDate: item.exchangeRateDate, vendor: item.vendor, paymentMethod: item.paymentMethod, dueDate: item.dueDate ?? '', notes: item.notes });
    setHydratedId(id);
  }, [id, existing, hydratedId]);
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      let expenseId = savedExpenseId;
      if (!expenseId && id && existing) {
        const before = existing.expense;
        const next: Record<string, unknown> = {};
        const compare: [keyof typeof form, keyof Expense][] = [['expenseDate','expenseDate'],['description','description'],['categoryId','categoryId'],['expenseType','expenseType'],['vendor','vendor'],['paymentMethod','paymentMethod'],['notes','notes']];
        for (const [formKey, expenseKey] of compare) if (form[formKey] !== String(before[expenseKey] ?? '')) next[formKey] = form[formKey];
        if (form.dueDate !== (before.dueDate ?? '')) next.dueDate = form.dueDate || null;
        if (Number(form.amount) !== before.amount) next.amount = Number(form.amount);
        if (form.currency !== before.currency) next.currency = form.currency;
        if (Number(form.exchangeRate) !== before.exchangeRate) next.exchangeRate = Number(form.exchangeRate);
        if (form.exchangeRateDate !== before.exchangeRateDate) next.exchangeRateDate = form.exchangeRateDate;
        const updated = await api<{ id: string }>(`/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(next) });
        expenseId = updated.id;
        setSavedExpenseId(expenseId);
      } else if (!expenseId && !id) {
        const created = await api<{ id: string }>('/expenses', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount), expenseType: form.expenseType || undefined, exchangeRate: Number(form.exchangeRate), exchangeRateDate: form.currency === 'THB' ? undefined : form.exchangeRateDate, dueDate: form.dueDate || null, idempotencyKey }) });
        expenseId = created.id;
        setSavedExpenseId(expenseId);
      }
      expenseId ||= id ?? '';
      if (!expenseId) throw new Error(t('Could not save expense.'));
      for (let index = 0; index < attachments.length; index += 1) {
        const original = attachments[index];
        if (isExpenseImage(original)) setUploadProgress(`${t('Compressing attachment')} ${index + 1}/${attachments.length}…`);
        const file = isExpenseImage(original) ? await compressExpenseImage(original) : original;
        setUploadProgress(`${t('Uploading attachment')} ${index + 1}/${attachments.length}…`);
        const payload = new FormData();
        payload.append('file', file);
        payload.append('attachmentType', attachmentType);
        await api(`/expenses/${expenseId}/attachments`, { method: 'POST', body: payload });
        setAttachments((current) => current.filter((item) => item !== original));
      }
      navigate(`/expenses/${expenseId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save expense.'));
      setSaving(false);
      setUploadProgress('');
    }
  }
  return <>
    <Header eyebrow={t('FINANCE')} title={id ? t('Edit expense') : t('Quick add expense')} action={<Link className="button" to={id ? `/expenses/${id}` : '/expenses'}><ArrowLeft size={16} />{t(id ? 'Expense details' : 'Back to expenses')}</Link>} />
    {error && <ErrorBox message={error} />}
    <form className="panel finance-form" onSubmit={submit}>
      <div className="form-grid"><Field label="Expense date"><input type="date" required value={form.expenseDate} onChange={(e) => update('expenseDate', e.target.value)} /></Field><Field label="Description"><input required maxLength={500} value={form.description} onChange={(e) => update('description', e.target.value)} /></Field><Field label="Category"><select required value={form.categoryId} onChange={(e) => update('categoryId', e.target.value)}><option value="">{t('Choose category')}</option>{activeCategories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><Field label="Expense type"><select value={form.expenseType} onChange={(e) => update('expenseType', e.target.value)}><option value="">{t('Use category default')}</option>{types.map((v) => <option value={v} key={v}>{t(v)}</option>)}</select></Field><Field label="Amount"><input type="number" inputMode="decimal" min="0.01" step="0.01" required value={form.amount} onChange={(e) => update('amount', e.target.value)} placeholder="0.00" /></Field><Field label="Currency"><select value={form.currency} onChange={(e) => update('currency', e.target.value)}>{['THB','USD','CNY','EUR'].map((v) => <option value={v} key={v}>{v}</option>)}</select></Field>{form.currency !== 'THB' && <><Field label="Exchange rate"><input type="number" inputMode="decimal" min="0.000001" step="0.000001" required value={form.exchangeRate} onChange={(e) => update('exchangeRate', e.target.value)} /></Field><Field label="Exchange rate date"><input type="date" required value={form.exchangeRateDate} onChange={(e) => update('exchangeRateDate', e.target.value)} /></Field></>}<Field label="Vendor / payee"><input value={form.vendor} maxLength={200} onChange={(e) => update('vendor', e.target.value)} /></Field><Field label="Due date"><input type="date" value={form.dueDate} onChange={(e) => update('dueDate', e.target.value)} /></Field><Field label="Payment method"><select value={form.paymentMethod} onChange={(e) => update('paymentMethod', e.target.value)}><option value="">{t('Not paid yet')}</option>{['BANK_TRANSFER','CASH','CARD','OTHER'].map((v) => <option value={v} key={v}>{t(v)}</option>)}</select></Field>      <section className="finance-form-attachments">
        <div className="finance-attachments-header"><div><h3><Paperclip size={17} />{t('Receipts and attachments')}</h3><p className="muted finance-attachment-hint">{t('Images are compressed automatically before upload. PDFs are kept as-is; maximum 10 MB per file.')}</p></div></div>
        <div className="finance-attachment-controls">
          <Field label="Attachment type"><select value={attachmentType} onChange={(e) => setAttachmentType(e.target.value)}>{['RECEIPT','INVOICE','PAYMENT_SLIP','OTHER'].map((value) => <option value={value} key={value}>{t(value)}</option>)}</select></Field>
          <label className="button"><Paperclip size={16} />{t('Choose files')}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden disabled={saving} onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            const invalid = chosen.some((file) => !isSupportedExpenseAttachment(file));
            if (invalid) setError(t('Only JPEG, PNG, WebP, and PDF files are supported.'));
            else if (chosen.some((file) => file.type === 'application/pdf' && file.size > maxExpenseAttachmentBytes)) setError(t('Attachments must be 10 MB or smaller.'));
            else if (attachments.length + chosen.length + (id ? existing?.attachments.length ?? 0 : 0) > 20) setError(t('Maximum 20 attachments per expense.'));
            else { setError(''); setAttachments((current) => [...current, ...chosen]); }
            event.target.value = '';
          }} /></label>
        </div>
        {attachments.map((file, index) => <div className="finance-pending-attachment" key={`${file.name}-${file.lastModified}-${index}`}><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span><button type="button" className="button subtle" aria-label={`${t('Remove')} ${file.name}`} disabled={saving} onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}><X size={16} /></button></div>)}
        {uploadProgress && <p className="muted" role="status">{uploadProgress}</p>}
      </section>
      <Field label="Notes"><textarea rows={3} maxLength={5000} value={form.notes} onChange={(e) => update('notes', e.target.value)} /></Field></div>

      <div className="finance-form-actions"><Link className="button" to={id ? `/expenses/${id}` : '/expenses'}>{t('Cancel')}</Link><button className="button primary" disabled={saving || (Boolean(id) && !existing)}><Plus size={16} />{saving ? (uploadProgress || t('Saving…')) : t(id ? 'Save changes' : 'Save expense')}</button></div>
    </form>
  </>;
}

type ExpenseDetail = { expense: Expense; payments: { id: string; amount: number; paymentDate: string; paymentMethod: string; referenceNumber: string }[]; attachments: { id: string; fileName: string; attachmentType: string; fileSize: number }[]; allocations: { productId: string; amountThb: number; sku: string; brand: string; model: string }[]; history: { id: string; action: string; actorEmail: string; createdAt: string }[] };
export function ExpenseDetailPage() {
  const { id = '' } = useParams();
  const { data, error, reload } = useData<ExpenseDetail>(`/expenses/${id}`);
  const { data: products } = useData<Product[]>('/products');
  const [payment, setPayment] = useState({ amount: '', paymentDate: today(), paymentMethod: 'BANK_TRANSFER', referenceNumber: '' });
  const [allocationMethod, setAllocationMethod] = useState('EQUAL');
  const [allocationIds, setAllocationIds] = useState<string[]>([]);
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [attachmentType, setAttachmentType] = useState('RECEIPT');
  const [attachmentPaymentId, setAttachmentPaymentId] = useState('');
  const [hydratedAllocationsFor, setHydratedAllocationsFor] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!data || hydratedAllocationsFor === data.expense.id) return;
    setAllocationIds(data.allocations.map((item) => item.productId));
    setAllocationAmounts(Object.fromEntries(data.allocations.map((item) => [item.productId, String(item.amountThb)])));
    setHydratedAllocationsFor(data.expense.id);
  }, [data, hydratedAllocationsFor]);
  if (error) return <><Header title={t('Expense details')} /><ErrorBox message={error} /></>;
  if (!data) return <Loading />;
  const expense = data.expense;
  const currencyAmount = (amount: number) => new Intl.NumberFormat('en', { style: 'currency', currency: expense.currency, maximumFractionDigits: 2 }).format(amount);
  const displayAmount = (amount: number, thb: number) => expense.currency === 'THB' ? money(amount) : `${currencyAmount(amount)} · ${money(thb)}`;
  async function addPayment(event: React.FormEvent) { event.preventDefault(); setMessage(''); try { await api(`/expenses/${id}/payments`, { method: 'POST', body: JSON.stringify({ amount: Number(payment.amount), paymentDate: payment.paymentDate, paymentMethod: payment.paymentMethod, referenceNumber: payment.referenceNumber, idempotencyKey: crypto.randomUUID() }) }); setPayment((value) => ({ ...value, amount: '', referenceNumber: '' })); reload(); } catch (e) { setMessage(e instanceof Error ? e.message : t('Could not record payment.')); } }
  async function upload(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; const form = new FormData(); form.append('file', file); form.append('attachmentType', attachmentType); if (attachmentPaymentId) form.append('paymentId', attachmentPaymentId); try { await api(`/expenses/${id}/attachments`, { method: 'POST', body: form }); setMessage(''); reload(); } catch (e) { setMessage(e instanceof Error ? e.message : t('Upload failed.')); } event.target.value = ''; }
  async function removeAttachment(attachmentId: string) { if (!window.confirm(t('Remove this attachment?'))) return; try { await api(`/expenses/${id}/attachments/${attachmentId}`, { method: 'DELETE' }); reload(); } catch (e) { setMessage(e instanceof Error ? e.message : t('Could not remove attachment.')); } }
  async function saveAllocations(event: React.FormEvent) { event.preventDefault(); setMessage(''); try { await api(`/expenses/${id}/allocations`, { method: 'POST', body: JSON.stringify({ method: allocationMethod, allocations: allocationIds.map((productId) => ({ productId, ...(allocationMethod === 'MANUAL' ? { amount: Number(allocationAmounts[productId] || 0) } : {}) })) }) }); reload(); } catch (e) { setMessage(e instanceof Error ? e.message : t('Could not allocate costs.')); } }
  return <>
    <Header eyebrow={expense.expenseNumber} title={expense.description} subtitle={`${expense.categoryName} · ${readableDate(expense.expenseDate)}`} action={<div className="finance-header-actions">{expense.status !== 'CANCELLED' && <Link className="button" to={`/expenses/${id}/edit`}>{t('Edit expense')}</Link>}{expense.status === 'UNPAID' && <button className="button danger" onClick={async () => { const reason = window.prompt(t('Reason for voiding this expense')); if (!reason) return; try { await api(`/expenses/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }); reload(); } catch (e) { setMessage(e instanceof Error ? e.message : t('Could not void expense.')); } }}>{t('Void expense')}</button>}<Link className="button" to="/expenses"><ArrowLeft size={16} />{t('Back to expenses')}</Link></div>} />
    {message && <ErrorBox message={message} />}
    <section className="finance-detail-grid"><article className="panel"><h2>{t('Expense summary')}</h2><div className="finance-detail-line"><span>{t('Amount')}</span><strong>{displayAmount(expense.amount, expense.convertedThb)}</strong></div><div className="finance-detail-line"><span>{t('Payment status')}</span><strong>{t(expense.status)}</strong></div><div className="finance-detail-line"><span>{t('Paid')}</span><strong>{displayAmount(expense.paid, expense.paidThb)}</strong></div><div className="finance-detail-line"><span>{t('Outstanding')}</span><strong>{displayAmount(expense.outstanding, expense.outstandingThb)}</strong></div><div className="finance-detail-line"><span>{t('Vendor / payee')}</span><strong>{expense.vendor || '—'}</strong></div><div className="finance-detail-line"><span>{t('Expense type')}</span><strong>{t(expense.expenseType)}</strong></div></article>
      <article className="panel"><h2><Wallet size={18} /> {t('Record payment')}</h2>{expense.outstanding > 0 && expense.status !== 'CANCELLED' ? <form className="finance-payment-form" onSubmit={addPayment}><Field label="Amount"><input type="number" min="0.01" max={expense.outstanding} step="0.01" required value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} placeholder="0.00" /></Field><Field label="Payment date"><input type="date" required value={payment.paymentDate} onChange={(e) => setPayment({ ...payment, paymentDate: e.target.value })} /></Field><Field label="Payment method"><select value={payment.paymentMethod} onChange={(e) => setPayment({ ...payment, paymentMethod: e.target.value })}>{['BANK_TRANSFER','CASH','CARD','OTHER'].map((v) => <option value={v} key={v}>{t(v)}</option>)}</select></Field><Field label="Reference number"><input value={payment.referenceNumber} onChange={(e) => setPayment({ ...payment, referenceNumber: e.target.value })} /></Field><button className="button primary">{t('Record payment')}</button></form> : <p className="muted">{t('No outstanding balance.')}</p>}</article></section>
    <section className="panel finance-detail-section"><h2><Paperclip size={18} /> {t('Receipts and attachments')}</h2><div className="finance-attachment-controls"><Field label="Attachment type"><select value={attachmentType} onChange={(e) => setAttachmentType(e.target.value)}>{['RECEIPT','INVOICE','PAYMENT_SLIP','OTHER'].map((value) => <option value={value} key={value}>{t(value)}</option>)}</select></Field>{data.payments.length > 0 && <Field label="Link to payment"><select value={attachmentPaymentId} onChange={(e) => setAttachmentPaymentId(e.target.value)}><option value="">{t('Expense')}</option>{data.payments.map((item) => <option value={item.id} key={item.id}>{item.paymentDate} · {money(item.amount)}</option>)}</select></Field>}<label className="button"><Plus size={16} />{t('Attach receipt')}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" hidden onChange={upload} /></label></div>{data.attachments.map((item) => <div className="finance-attachment" key={item.id}><a href={`/api/expenses/${id}/attachments/${item.id}`} target="_blank" rel="noreferrer">{item.fileName}</a><small>{t(item.attachmentType)} · {(item.fileSize / 1024).toFixed(0)} KB</small>{expense.paid === 0 && <button className="button subtle" onClick={() => removeAttachment(item.id)}>{t('Remove')}</button>}</div>)}</section>
    {expense.expenseType === 'PRODUCT_COST' && <section className="panel finance-detail-section"><h2>{t('Product allocations')}</h2>{data.allocations.map((item) => <div className="finance-category" key={item.productId}><span>{item.sku} · {item.brand} {item.model}</span><strong>{money(item.amountThb)}</strong></div>)}{expense.status !== 'CANCELLED' && <form className="finance-allocation-form" onSubmit={saveAllocations}><Field label="Allocation method"><select value={allocationMethod} onChange={(e) => setAllocationMethod(e.target.value)}>{[['EQUAL','Equal allocation'],['MANUAL','Manual allocation'],['PURCHASE_COST_PROPORTIONAL','Purchase cost proportional']].map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></Field><div className="finance-product-picker">{(products ?? []).filter((product) => !product.archivedAt).map((product) => <label key={product.id}><input type="checkbox" checked={allocationIds.includes(product.id)} onChange={(event) => setAllocationIds((current) => event.target.checked ? [...current, product.id] : current.filter((item) => item !== product.id))} /><span>{product.sku} · {product.brand} {product.model}</span>{allocationMethod === 'MANUAL' && allocationIds.includes(product.id) && <input type="number" min="0" step="0.01" value={allocationAmounts[product.id] ?? ''} placeholder="0.00" onChange={(event) => setAllocationAmounts((current) => ({ ...current, [product.id]: event.target.value }))} />}</label>)}</div><button className="button primary" disabled={!allocationIds.length}>{t('Save product allocations')}</button></form>}</section>}
    <section className="panel finance-detail-section"><h2>{t('Payment history')}</h2>{data.payments.length ? data.payments.map((item) => <div className="finance-category" key={item.id}><span>{readableDate(item.paymentDate)} · {t(item.paymentMethod)} {item.referenceNumber && `· ${item.referenceNumber}`}</span><strong>{currencyAmount(item.amount)}</strong></div>) : <p className="muted">{t('No payments recorded.')}</p>}</section>
    <section className="panel finance-detail-section"><h2>{t('Change history')}</h2>{data.history.map((item) => <div className="finance-history" key={item.id}><strong>{t(item.action)}</strong><small>{item.actorEmail} · {readableDateTime(item.createdAt)}</small></div>)}</section>
  </>;
}

export function ExpenseCategoriesPage() {
  const { data, error, reload } = useData<Category[]>('/expense-categories');
  const [name, setName] = useState(''); const [expenseType, setExpenseType] = useState('OPERATING_EXPENSE'); const [message, setMessage] = useState(''); const [pendingId, setPendingId] = useState('');
  async function create(event: React.FormEvent) { event.preventDefault(); setMessage(''); try { await api('/expense-categories', { method: 'POST', body: JSON.stringify({ name, defaultExpenseType: expenseType, isActive: true }) }); setName(''); reload(); } catch (e) { setMessage(e instanceof Error ? e.message : t('Could not save category.')); } }
  async function toggle(item: Category) { setPendingId(item.id); setMessage(''); try { await api(`/expense-categories/${item.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !item.isActive }) }); reload(); } catch (e) { setMessage(e instanceof Error ? e.message : t('Could not update category.')); } finally { setPendingId(''); } }
  return <><Header eyebrow={t('FINANCE')} title={t('Expense categories')} subtitle={t('Categories help keep expense reports consistent.')} action={<Link className="button" to="/finance"><ArrowLeft size={16} />{t('Financial overview')}</Link>} />{error && <ErrorBox message={error} />}{message && <ErrorBox message={message} />}<form className="panel finance-category-form" onSubmit={create}><Field label="Category name"><input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Default expense type"><select value={expenseType} onChange={(e) => setExpenseType(e.target.value)}>{types.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></Field><button type="submit" className="button primary"><Plus size={16} />{t('Add category')}</button></form>{!data ? <Loading /> : <section className="panel finance-expenses">{data.map((item) => <div className="finance-category-row" key={item.id}><div><strong>{item.name}</strong><small>{t(item.defaultExpenseType)}</small></div><button type="button" role="switch" aria-checked={Boolean(item.isActive)} aria-label={`${t(item.isActive ? 'Disable category' : 'Enable category')} ${item.name}`} disabled={pendingId === item.id} className={`category-switch-button${item.isActive ? ' is-active' : ''}`} onClick={() => toggle(item)}><span className="category-switch-track"><span /></span><span className="category-switch-label">{t(item.isActive ? 'Active' : 'Inactive')}</span></button></div>)}</section>}</>;
}
