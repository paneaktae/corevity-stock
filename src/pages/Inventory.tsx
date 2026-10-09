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
        title="Equipment inventory"
        subtitle="Everything on hand. Every detail in one place."
        action={<AddLink to="/inventory/new">Add equipment</AddLink>}
      />
      <div className="toolbar panel">
        <label className="search">
          <Search size={18} />
          <input
            aria-label="Search equipment"
            placeholder="Search brand, model, SKU, serial…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="filters">
          {(['brand', 'category', 'status', 'condition'] as const).map((k) => (
            <select
              key={k}
              aria-label={`Filter ${k}`}
              value={filters[k]}
              onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}
            >
              <option value="">
                All {k === 'status' ? 'statuses' : `${k}s`}
              </option>
              {(k === 'status'
                ? [...productStatuses]
                : [...new Set(all?.map((p) => p[k]).filter(Boolean))].sort()
              ).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          ))}
          <select
            aria-label="Sort inventory"
            value={filters.sort}
            onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
          >
            <option value="newest">Newest first</option>
            <option value="brand">Brand A–Z</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
        </div>
      </div>
      <ErrorBox message={error} />
      {!data && !error ? (
        <Loading />
      ) : data?.length ? (
        <>
          <div className="result-count">
            {data.length} equipment item{data.length === 1 ? '' : 's'}
          </div>
          <div className="panel table-wrap inventory-table">
            <table>
              <thead>
                <tr>
                  {[
                    'Equipment',
                    'Category / Condition',
                    'Cost',
                    'Selling price',
                    'Status',
                    'Location',
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
                      <small>{p.condition || 'Not specified'}</small>
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
                        aria-label={`Open ${p.model}`}
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
                    <small>Reserved for {p.reservedCustomerName}</small>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <Empty title="No equipment found">
          <p>
            {q
              ? 'Try a different search or filter.'
              : 'Add your first equipment item.'}
          </p>
        </Empty>
      )}
    </>
  );
}
const blank: ProductInput = {
  brand: '',
  model: '',
  status: 'AVAILABLE',
  sku: '',
  category: '',
  condition: 'Good',
  serialNumber: '',
  purchaseCost: 0,
  sellingPrice: 0,
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
export function ProductForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: detail, error: loadError } = useData<ProductDetail>(
    id ? `/products/${id}` : null,
  );
  const { data: settings } = useData<Settings>('/settings');
  const [form, setForm] = useState<ProductInput>(blank);
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
        body: JSON.stringify(form),
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
        title={id ? 'Edit equipment' : 'Add equipment'}
        subtitle="Start with a brand and model. Add photos after saving."
      />
      <form onSubmit={(e) => void save(e, false)}>
        <ErrorBox message={error} />
        <section className="panel">
          <h2>Equipment details</h2>
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
            <Field label="Condition" error={fields.condition}>
              <select
                value={form.condition}
                onChange={(e) =>
                  setForm({ ...form, condition: e.target.value })
                }
              >
                <option value="">Not specified</option>
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
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Status *" error={fields.status}>
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
                Use the equipment detail page to reserve or sell an existing
                item.
              </small>
            </Field>
            {(['purchaseCost', 'sellingPrice'] as const).map((k) => (
              <Field
                key={k}
                label={
                  k === 'purchaseCost'
                    ? 'Purchase cost (THB)'
                    : 'Selling price (THB)'
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
                  onChange={(e) =>
                    setForm({ ...form, [k]: Number(e.target.value) })
                  }
                />
              </Field>
            ))}
          </div>
          <Field label="Internal notes" error={fields.notes}>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </section>
        <section className="panel">
          <h2>Descriptions & sales copy</h2>
          <p className="muted">
            AI draft generation is available from the equipment detail page
            after saving.
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
            Cancel
          </Link>
          <button
            disabled={busy}
            type="button"
            onClick={(e) => {
              const f = e.currentTarget.form;
              if (f?.reportValidity()) void save(e, true);
            }}
          >
            Save & continue editing
          </button>
          <button disabled={busy} className="primary">
            {busy ? 'Saving…' : 'Save equipment'}
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
  const main = d.images.find((i) => i.isPrimary) ?? d.images[0];
  const profit = p.sellingPrice - p.purchaseCost;
  async function order(imageIds: string[], primaryId: string) {
    await action(`/products/${id}/images`, { imageIds, primaryId }, 'PATCH');
  }
  return (
    <>
      <Link className="back" to="/inventory">
        <ArrowLeft size={16} /> Inventory
      </Link>
      <Header
        eyebrow={p.sku}
        title={`${p.brand} ${p.model}`}
        subtitle={`${p.category || 'Equipment'} · ${p.condition || 'Condition not specified'}`}
        action={
          <Link className="button" to={`/inventory/${id}/edit`}>
            Edit equipment
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
              <Empty title="Add a first look">
                <p>Upload equipment photos from your phone or computer.</p>
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
                    aria-label="Move image earlier"
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
                    title="Set primary photo"
                    aria-label="Set primary photo"
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
                    aria-label="Move image later"
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
                    aria-label="Delete photo"
                    onClick={() => {
                      if (confirm('Permanently delete this photo?'))
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
            {busy ? 'Working…' : 'Upload photos'}
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
            JPEG, PNG, WEBP · up to 5 photos per upload
          </small>
        </section>
        <section className="panel">
          <Badge value={p.status} />
          <div className="detail-price">{money(p.sellingPrice)}</div>
          <div className="facts">
            <div>
              <span>Purchase cost</span>
              <strong>{money(p.purchaseCost)}</strong>
            </div>
            <div>
              <span>Estimated gross profit</span>
              <strong>{money(profit)}</strong>
            </div>
            <div>
              <span>Estimated margin</span>
              <strong>
                {p.sellingPrice
                  ? `${((profit / p.sellingPrice) * 100).toFixed(1)}%`
                  : '—'}
              </strong>
            </div>
            <div>
              <span>Location</span>
              <strong>{p.location || 'Not set'}</strong>
            </div>
            <div>
              <span>Serial number</span>
              <strong>{p.serialNumber || 'Not set'}</strong>
            </div>
          </div>
          {d.reservation && (
            <div className="reservation">
              <strong>Reserved for {d.reservation.customerName}</strong>
              <small>Since {date(d.reservation.reservedAt)}</small>
              <small>Expires: {date(d.reservation.expiresAt)}</small>
              {d.reservation.notes && <p>{d.reservation.notes}</p>}
            </div>
          )}
          <div className="stack">
            {p.status === 'AVAILABLE' && (
              <button disabled={busy} onClick={() => setReserve(!reserve)}>
                Reserve for a customer
              </button>
            )}
            {p.status === 'RESERVED' && (
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      'Release this reservation and make the equipment available?',
                    )
                  )
                    void action(`/products/${id}/release-reservation`);
                }}
              >
                Release reservation
              </button>
            )}
            {p.status !== 'SOLD' && (
              <button
                disabled={busy}
                className="primary"
                onClick={() => {
                  if (
                    confirm(
                      'Mark this equipment as sold? This cannot be undone in the app.',
                    )
                  )
                    void action(`/products/${id}/mark-sold`);
                }}
              >
                Mark as sold
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
              <Field label="Customer">
                <select
                  required
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">Choose customer</option>
                  {customers?.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Expires (optional)">
                <input
                  type="datetime-local"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              </Field>
              <Field label="Reservation notes">
                <textarea
                  value={reserveNotes}
                  onChange={(e) => setReserveNotes(e.target.value)}
                />
              </Field>
              <button className="primary" disabled={busy}>
                Confirm reservation
              </button>
            </form>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Descriptions & sales copy</h2>
            <p className="muted">
              Generate a draft, review it, and save when you're ready.
            </p>
          </div>
          <Sparkles size={22} />
        </div>
        <div className="button-row">
          <button disabled={busy} onClick={() => void generate('all')}>
            <Sparkles size={16} />
            Generate all
          </button>
          {descriptions.map(([key, title]) => (
            <button
              disabled={busy}
              key={key}
              onClick={() => void generate(key)}
            >
              Generate {title.replace(' description', '')}
            </button>
          ))}
        </div>
        {draft && (
          <div className="ai-draft">
            <h3>Review AI draft</h3>
            <p>
              Check accuracy before saving. Existing saved text is unchanged.
            </p>
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
                      'Save this draft? It will replace the matching saved descriptions.',
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
                    setNotice('Descriptions saved.');
                    reload();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save reviewed draft
              </button>
              <button disabled={busy} onClick={() => void generate('all')}>
                Regenerate
              </button>
              <button onClick={() => setDraft(null)}>Discard draft</button>
            </div>
          </div>
        )}
        {descriptions.map(([key, title]) => (
          <div className="description" key={key}>
            <div className="section-heading">
              <h3>{title}</h3>
              {p[key] && (
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(p[key]);
                      setNotice(`${title} copied.`);
                    } catch {
                      setError(
                        'Copy is unavailable. Select and copy the text manually.',
                      );
                    }
                  }}
                >
                  Copy
                </button>
              )}
            </div>
            <p>{p[key] || 'No description yet.'}</p>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Internal notes</h2>
        <p className="preserve">{p.notes || 'No notes yet.'}</p>
      </section>
      <ActivityList items={d.activities} />
      <button
        className="danger"
        disabled={busy}
        onClick={async () => {
          if (
            !confirm(
              'Archive this equipment? It will be hidden from inventory, with its history retained.',
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
        Archive equipment
      </button>
    </>
  );
}
