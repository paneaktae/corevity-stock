import { t, localized } from '../i18n';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  Search,
  ArrowUpRight,
  Upload,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  Star,
  Trash2,
} from 'lucide-react';
import type {
  Product,
  ProductDetail,
  ProductInput,
  Settings,
  Customer,
  Descriptions,
} from '../../shared/schemas';
import { productStatuses } from '../../shared/schemas';
import {
  api,
  ApiError,
  useData,
  useDebounce,
  money,
  date,
  label,
  toISO,
} from '../lib';
import {
  ActivityList,
  AddLink,
  Badge,
  Empty,
  ErrorBox,
  Field,
  Header,
  Loading,
  Photo,
} from '../components/ui';
export function InventoryPage() {
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [filters, setFilters] = useState({
    brand: '',
    category: '',
    status: params.get('status') ?? '',
    condition: '',
    sort: 'newest',
  });
  const { data, error } = useData<Product[]>(
    `/products?${new URLSearchParams({ q, ...filters })}`,
  );
  const { data: all } = useData<Product[]>('/products');
  return (
    <>
      <Header
        title={t('Equipment inventory')}
        subtitle={t('Everything on hand. Every detail in one place.')}
        action={<AddLink to="/inventory/new">{t('Add equipment')}</AddLink>}
      />
      <div className="toolbar panel">
        <label className="search">
          <Search size={18} />
          <input
            aria-label={t('Search equipment')}
            placeholder={t('Search brand, model, SKU, serial…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="filters">
          {(['brand', 'category', 'status', 'condition'] as const).map((k) => (
            <select
              key={k}
              aria-label={t(
                {
                  brand: 'All brands',
                  category: 'All categories',
                  status: 'All statuses',
                  condition: 'All conditions',
                }[k],
              )}
              value={filters[k]}
              onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}
            >
              <option value="">
                {t(
                  {
                    brand: 'All brands',
                    category: 'All categories',
                    status: 'All statuses',
                    condition: 'All conditions',
                  }[k],
                )}
              </option>
              {(k === 'status'
                ? [...productStatuses]
                : [...new Set(all?.map((p) => p[k]).filter(Boolean))].sort()
              ).map((v) => (
                <option key={v} value={v}>
                  {k === 'status' ? label(v) : t(v)}
                </option>
              ))}
            </select>
          ))}
          <select
            aria-label={t('Sort inventory')}
            value={filters.sort}
            onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
          >
            <option value="newest">{t('Newest first')}</option>
            <option value="brand">{t('Brand A–Z')}</option>
            <option value="price-asc">{t('Price: low to high')}</option>
            <option value="price-desc">{t('Price: high to low')}</option>
          </select>
        </div>
      </div>
      <ErrorBox message={error} />
      {!data && !error ? (
        <Loading />
      ) : data?.length ? (
        <>
          <div className="result-count">
            {localized(
              `${data.length} equipment items`,
              `สินค้า ${data.length} รายการ`,
            )}
          </div>
          <div className="panel table-wrap inventory-table">
            <table>
              <thead>
                <tr>
                  {[
                    t('Equipment'),
                    t('Category / Condition'),
                    t('Cost'),
                    t('Selling price'),
                    t('Status'),
                    t('Location'),
                    '',
                  ].map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link
                        className="equipment-cell"
                        to={`/inventory/${p.id}`}
                      >
                        <Photo product={p} />
                        <div>
                          <strong>{p.brand}</strong>
                          <span>{p.model}</span>
                          <small>{p.sku}</small>
                        </div>
                      </Link>
                    </td>
                    <td>
                      {p.category || '—'}
                      <small>{t(p.condition) || t('Not specified')}</small>
                    </td>
                    <td>{money(p.purchaseCost)}</td>
                    <td>
                      <strong>{money(p.sellingPrice)}</strong>
                    </td>
                    <td>
                      <Badge value={p.status} />
                      {p.reservedCustomerName && (
                        <small>{p.reservedCustomerName}</small>
                      )}
                    </td>
                    <td>{p.location || '—'}</td>
                    <td>
                      <Link
                        className="icon-button"
                        aria-label={localized(
                          `Open ${p.model}`,
                          `เปิด ${p.model}`,
                        )}
                        to={`/inventory/${p.id}`}
                      >
                        <ArrowUpRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="inventory-cards">
            {data.map((p) => (
              <Link
                className="inventory-card"
                to={`/inventory/${p.id}`}
                key={p.id}
              >
                <Photo product={p} />
                <div>
                  <small>{p.sku}</small>
                  <h3>{p.brand}</h3>
                  <p>{p.model}</p>
                  <strong>{money(p.sellingPrice)}</strong>
                  <Badge value={p.status} />
                  {p.reservedCustomerName && (
                    <small>
                      {t('Reserved for')}
                      {p.reservedCustomerName}
                    </small>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <Empty title={t('No equipment found')}>
          <p>
            {q
              ? t('Try a different search or filter.')
              : t('Add your first equipment item.')}
          </p>
        </Empty>
      )}
    </>
  );
}
type ProductFormValues = Omit<ProductInput, 'purchaseCost' | 'sellingPrice'> & {
  purchaseCost: string | number;
  sellingPrice: string | number;
};
const blank: ProductFormValues = {
  brand: '',
  model: '',
  status: 'AVAILABLE',
  sku: '',
  category: '',
  condition: 'Good',
  serialNumber: '',
  purchaseCost: '',
  sellingPrice: '',
  location: '',
  descriptionTh: '',
  descriptionEn: '',
  shortDescription: '',
  facebookCaption: '',
  notes: '',
};
const textFields = [
  ['brand', 'Brand *'],
  ['model', 'Model *'],
  ['sku', 'SKU (generated if empty)'],
  ['category', 'Category'],
  ['serialNumber', 'Serial number'],
  ['location', 'Location'],
] as const;
const descriptions = [
  ['descriptionTh', 'Thai description'],
  ['descriptionEn', 'English description'],
  ['shortDescription', 'Short description'],
  ['facebookCaption', 'Facebook caption'],
] as const;
const ratings = [
  ['priceRating', 'Price'],
  ['designRating', 'Design'],
  ['qualityPerformanceRating', 'Quality & performance'],
] as const;
const analysisLists = [
  ['strengths', 'Strengths'],
  ['weaknesses', 'Weaknesses / considerations'],
] as const;
type RatingValues = Partial<Record<(typeof ratings)[number][0], number | null>>;
type AnalysisValues = Partial<
  Record<(typeof analysisLists)[number][0], string[]>
>;
function RatingCards({ values }: { values: RatingValues }) {
  return (
    <div className="rating-grid">
      {ratings.map(([key, title]) => {
        const score = values[key];
        const value =
          typeof score === 'number' && Number.isFinite(score)
            ? Math.min(10, Math.max(0, score))
            : null;
        return (
          <div className="rating-card" key={key}>
            <span>{t(title)}</span>
            <strong>{value == null ? '—' : value.toFixed(1)}</strong>
            <small>{t('out of 10')}</small>
            <div
              className="rating-track"
              {...(value == null
                ? {}
                : {
                    role: 'meter',
                    'aria-label': t(title),
                    'aria-valuemin': 0,
                    'aria-valuemax': 10,
                    'aria-valuenow': value,
                  })}
            >
              <span style={{ width: `${(value ?? 0) * 10}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
function AnalysisLists({ values }: { values: AnalysisValues }) {
  return (
    <div className="analysis-grid">
      {analysisLists.map(([key, title]) => (
        <div className="analysis-card" key={key}>
          <h4>{t(title)}</h4>
          {values[key]?.length ? (
            <ul>
              {values[key]!.map((item, index) => (
                <li key={`${key}-${index}`}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t('No supported points yet.')}</p>
          )}
        </div>
      ))}
    </div>
  );
}
export function ProductForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: detail, error: loadError } = useData<ProductDetail>(
    id ? `/products/${id}` : null,
  );
  const { data: settings } = useData<Settings>('/settings');
  const [form, setForm] = useState<ProductFormValues>(blank);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (id && detail) setForm(detail.product);
  }, [id, detail]);
  async function save(e: FormEvent, stay: boolean) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      const p = await api<Product>(id ? `/products/${id}` : '/products', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...form,
          purchaseCost: Number(form.purchaseCost),
          sellingPrice: Number(form.sellingPrice),
        }),
      });
      nav(`/inventory/${p.id}${stay ? '/edit' : ''}`);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) setFields(e.fields);
    } finally {
      setBusy(false);
    }
  }
  if (id && !detail)
    return (
      <>
        <ErrorBox message={loadError} />
        {!loadError && <Loading />}
      </>
    );
  return (
    <>
      <Header
        title={id ? t('Edit equipment') : t('Add equipment')}
        subtitle={t('Start with a brand and model. Add photos after saving.')}
      />
      <form onSubmit={(e) => void save(e, false)}>
        <ErrorBox message={error} />
        <section className="panel">
          <h2>{t('Equipment details')}</h2>
          <div className="form-grid">
            {textFields.map(([k, title]) => (
              <Field key={k} label={title} error={fields[k]}>
                <input
                  required={k === 'brand' || k === 'model'}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </Field>
            ))}
            <Field label={t('Condition')} error={fields.condition}>
              <select
                value={form.condition}
                onChange={(e) =>
                  setForm({ ...form, condition: e.target.value })
                }
              >
                <option value="">{t('Not specified')}</option>
                {[
                  ...new Set(
                    [
                      ...(settings?.conditions ?? [
                        'Excellent',
                        'Good',
                        'Fair',
                        'Needs Repair',
                      ]),
                      form.condition,
                    ].filter(Boolean),
                  ),
                ].map((v) => (
                  <option key={v} value={v}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Status *')} error={fields.status}>
              <select
                disabled={!!id}
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as ProductInput['status'],
                  })
                }
              >
                {(id ? productStatuses : ['AVAILABLE', 'SOLD']).map((v) => (
                  <option key={v} value={v}>
                    {label(v)}
                  </option>
                ))}
              </select>
              <small>
                {t(
                  'Use the equipment detail page to reserve or sell an existing item.',
                )}
              </small>
            </Field>
            {(['purchaseCost', 'sellingPrice'] as const).map((k) => (
              <Field
                key={k}
                label={
                  k === 'purchaseCost'
                    ? t('Purchase cost (THB)')
                    : t('Selling price (THB)')
                }
                error={fields[k]}
              >
                <input
                  disabled={form.status === 'SOLD' && !!id}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <Field label={t('Internal notes')} error={fields.notes}>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </section>
        <section className="panel">
          <h2>{t('Descriptions & sales copy')}</h2>
          <p className="muted">
            {t(
              'AI draft generation is available from the equipment detail page after saving.',
            )}
          </p>
          {descriptions.map(([k, title]) => (
            <Field key={k} label={title} error={fields[k]}>
              <textarea
                rows={3}
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </Field>
          ))}
        </section>
        <div className="form-actions">
          <Link className="button" to={id ? `/inventory/${id}` : '/inventory'}>
            {t('Cancel')}
          </Link>
          <button
            disabled={busy}
            type="button"
            onClick={(e) => {
              const f = e.currentTarget.form;
              if (f?.reportValidity()) void save(e, true);
            }}
          >
            {t('Save & continue editing')}
          </button>
          <button disabled={busy} className="primary">
            {busy ? t('Saving…') : t('Save equipment')}
          </button>
        </div>
      </form>
    </>
  );
}
export function ProductPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const {
    data: d,
    error: loadError,
    reload,
  } = useData<ProductDetail>(`/products/${id}`);
  const { data: customers } = useData<Customer[]>('/customers');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reserve, setReserve] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [expires, setExpires] = useState('');
  const [reserveNotes, setReserveNotes] = useState('');
  const [draft, setDraft] = useState<Partial<Descriptions> | null>(null);
  const [notice, setNotice] = useState('');
  async function action(path: string, body?: unknown, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      await api(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      reload();
      setReserve(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate(target: string) {
    setBusy(true);
    setError('');
    try {
      setDraft(
        await api(`/products/${id}/generate-description`, {
          method: 'POST',
          body: JSON.stringify({ target }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!d)
    return (
      <>
        <ErrorBox message={loadError} />
        {!loadError && <Loading />}
      </>
    );
  const p = d.product;
  const hasRating = ratings.some(
    ([key]) => typeof p[key] === 'number' && Number.isFinite(p[key]),
  );
  const main = d.images.find((i) => i.isPrimary) ?? d.images[0];
  const profit = p.sellingPrice - p.purchaseCost;
  async function order(imageIds: string[], primaryId: string) {
    await action(`/products/${id}/images`, { imageIds, primaryId }, 'PATCH');
  }
  return (
    <>
      <Link className="back" to="/inventory">
        <ArrowLeft size={16} /> {t('Inventory')}
      </Link>
      <Header
        eyebrow={p.sku}
        title={`${p.brand} ${p.model}`}
        subtitle={`${p.category || t('Equipment')} · ${t(p.condition) || t('Condition not specified')}`}
        action={
          <Link className="button" to={`/inventory/${id}/edit`}>
            {t('Edit equipment')}
          </Link>
        }
      />
      <ErrorBox message={error || loadError} />
      {notice && (
        <div className="success" role="status">
          {notice}
        </div>
      )}
      <div className="detail-grid">
        <section className="panel">
          <div className="main-photo">
            {main ? (
              <a
                href={`/api/images/${main.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={`/api/images/${main.id}`}
                  alt={`${p.brand} ${p.model}`}
                />
              </a>
            ) : (
              <Empty title={t('Add a first look')}>
                <p>
                  {t('Upload equipment photos from your phone or computer.')}
                </p>
              </Empty>
            )}
          </div>
          <div className="gallery">
            {d.images.map((img, index) => (
              <div className="gallery-item" key={img.id}>
                <a
                  href={`/api/images/${img.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img src={`/api/images/${img.id}`} alt={img.fileName} />
                </a>
                <div>
                  <button
                    disabled={busy || index === 0}
                    aria-label={t('Move image earlier')}
                    onClick={() => {
                      const ids = d.images.map((i) => i.id);
                      [ids[index - 1], ids[index]] = [
                        ids[index],
                        ids[index - 1],
                      ];
                      void order(ids, main.id);
                    }}
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <button
                    disabled={busy || img.isPrimary}
                    title={t('Set primary photo')}
                    aria-label={t('Set primary photo')}
                    onClick={() =>
                      void order(
                        d.images.map((i) => i.id),
                        img.id,
                      )
                    }
                  >
                    <Star
                      size={14}
                      fill={img.isPrimary ? 'currentColor' : 'none'}
                    />
                  </button>
                  <button
                    disabled={busy || index === d.images.length - 1}
                    aria-label={t('Move image later')}
                    onClick={() => {
                      const ids = d.images.map((i) => i.id);
                      [ids[index + 1], ids[index]] = [
                        ids[index],
                        ids[index + 1],
                      ];
                      void order(ids, main.id);
                    }}
                  >
                    <ArrowRight size={14} />
                  </button>
                  <button
                    disabled={busy}
                    aria-label={t('Delete photo')}
                    onClick={() => {
                      if (confirm(t('Permanently delete this photo?')))
                        void action(
                          `/products/${id}/images/${img.id}`,
                          undefined,
                          'DELETE',
                        );
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <label className={`button upload-button ${busy ? 'disabled' : ''}`}>
            <Upload size={17} />
            {busy ? t('Working…') : t('Upload photos')}
            <input
              disabled={busy}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                if (!files.length) return;
                setBusy(true);
                setError('');
                const form = new FormData();
                files.forEach((f) => form.append('files', f));
                try {
                  await api(`/products/${id}/images`, {
                    method: 'POST',
                    body: form,
                  });
                  reload();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                  e.target.value = '';
                }
              }}
            />
          </label>
          <small className="muted">
            {t('JPEG, PNG, WEBP · up to 5 photos per upload')}
          </small>
        </section>
        <section className="panel">
          <Badge value={p.status} />
          <div className="detail-price">{money(p.sellingPrice)}</div>
          <div className="facts">
            <div>
              <span>{t('Purchase cost')}</span>
              <strong>{money(p.purchaseCost)}</strong>
            </div>
            <div>
              <span>{t('Estimated gross profit')}</span>
              <strong>{money(profit)}</strong>
            </div>
            <div>
              <span>{t('Estimated margin')}</span>
              <strong>
                {p.sellingPrice
                  ? `${((profit / p.sellingPrice) * 100).toFixed(1)}%`
                  : '—'}
              </strong>
            </div>
            <div>
              <span>{t('Location')}</span>
              <strong>{p.location || t('Not set')}</strong>
            </div>
            <div>
              <span>{t('Serial number')}</span>
              <strong>{p.serialNumber || t('Not set')}</strong>
            </div>
          </div>
          {d.reservation && (
            <div className="reservation">
              <strong>
                {t('Reserved for')}
                {d.reservation.customerName}
              </strong>
              <small>
                {t('Since')}
                {date(d.reservation.reservedAt)}
              </small>
              <small>
                {t('Expires:')}
                {date(d.reservation.expiresAt)}
              </small>
              {d.reservation.notes && <p>{d.reservation.notes}</p>}
            </div>
          )}
          <div className="stack">
            {p.status === 'AVAILABLE' && (
              <button disabled={busy} onClick={() => setReserve(!reserve)}>
                {t('Reserve for a customer')}
              </button>
            )}
            {p.status === 'RESERVED' && (
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      t(
                        'Release this reservation and make the equipment available?',
                      ),
                    )
                  )
                    void action(`/products/${id}/release-reservation`);
                }}
              >
                {t('Release reservation')}
              </button>
            )}
            {p.status !== 'SOLD' && (
              <button
                disabled={busy}
                className="primary"
                onClick={() => {
                  if (
                    confirm(
                      t(
                        'Mark this equipment as sold? This cannot be undone in the app.',
                      ),
                    )
                  )
                    void action(`/products/${id}/mark-sold`);
                }}
              >
                {t('Mark as sold')}
              </button>
            )}
          </div>
          {reserve && (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action(`/products/${id}/reserve`, {
                  customerId,
                  expiresAt: toISO(expires),
                  notes: reserveNotes,
                });
              }}
            >
              <Field label={t('Customer')}>
                <select
                  required
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">{t('Choose customer')}</option>
                  {customers?.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('Expires (optional)')}>
                <input
                  type="datetime-local"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              </Field>
              <Field label={t('Reservation notes')}>
                <textarea
                  value={reserveNotes}
                  onChange={(e) => setReserveNotes(e.target.value)}
                />
              </Field>
              <button className="primary" disabled={busy}>
                {t('Confirm reservation')}
              </button>
            </form>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{t('Descriptions & sales copy')}</h2>
            <p className="muted">
              {t("Generate a draft, review it, and save when you're ready.")}
            </p>
          </div>
          <Sparkles size={22} />
        </div>
        <div className="button-row">
          <button disabled={busy} onClick={() => void generate('all')}>
            <Sparkles size={16} />
            {t('Generate all')}
          </button>
          {descriptions.map(([key, title]) => (
            <button
              disabled={busy}
              key={key}
              onClick={() => void generate(key)}
            >
              {t('Generate')}
              {t(title)}
            </button>
          ))}
        </div>
        {draft && (
          <div className="ai-draft">
            <h3>{t('Review AI draft')}</h3>
            <p>
              {t(
                'Check accuracy before saving. Existing saved text is unchanged.',
              )}
            </p>
            <h4>{t('AI rating')}</h4>
            <RatingCards values={draft} />
            {analysisLists.map(([key, title]) => (
              <Field label={title} key={key}>
                <textarea
                  rows={4}
                  value={(draft[key] ?? []).join('\n')}
                  placeholder={t('One point per line')}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [key]: e.target.value
                        .split('\n')
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
            ))}
            {descriptions
              .filter(([key]) => draft[key] !== undefined)
              .map(([key, title]) => (
                <Field label={title} key={key}>
                  <textarea
                    rows={4}
                    value={draft[key] ?? ''}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.value })
                    }
                  />
                </Field>
              ))}
            <div className="button-row">
              <button
                disabled={busy}
                className="primary"
                onClick={async () => {
                  if (
                    !confirm(
                      t(
                        'Save this draft? It will replace the matching saved descriptions.',
                      ),
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    await api(`/products/${id}`, {
                      method: 'PATCH',
                      body: JSON.stringify(draft),
                    });
                    setDraft(null);
                    setNotice(t('Descriptions saved.'));
                    reload();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('Save reviewed draft')}
              </button>
              <button disabled={busy} onClick={() => void generate('all')}>
                {t('Regenerate')}
              </button>
              <button onClick={() => setDraft(null)}>
                {t('Discard draft')}
              </button>
            </div>
          </div>
        )}
        <div className="product-ratings">
          <div className="section-heading">
            <div>
              <h3>{t('AI rating')}</h3>
              <p className="muted">
                {t(
                  hasRating
                    ? 'AI scores are estimates based on the saved product details.'
                    : 'No AI rating yet. Generate a description to create scores.',
                )}
              </p>
            </div>
          </div>
          <RatingCards values={p} />
          <AnalysisLists values={p} />
        </div>
        {descriptions.map(([key, title]) => (
          <div className="description" key={key}>
            <div className="section-heading">
              <h3>{t(title)}</h3>
              {p[key] && (
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(p[key]);
                      setNotice(
                        localized(`${title} copied.`, `คัดลอก${t(title)}แล้ว`),
                      );
                    } catch {
                      setError(
                        t(
                          'Copy is unavailable. Select and copy the text manually.',
                        ),
                      );
                    }
                  }}
                >
                  {t('Copy')}
                </button>
              )}
            </div>
            <p>{p[key] || t('No description yet.')}</p>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>{t('Internal notes')}</h2>
        <p className="preserve">{p.notes || t('No notes yet.')}</p>
      </section>
      <ActivityList items={d.activities} />
      <button
        className="danger"
        disabled={busy}
        onClick={async () => {
          if (
            !confirm(
              t(
                'Archive this equipment? It will be hidden from inventory, with its history retained.',
              ),
            )
          )
            return;
          setBusy(true);
          try {
            await api(`/products/${id}`, { method: 'DELETE' });
            nav('/inventory');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('Archive equipment')}
      </button>
    </>
  );
}
