import { useEffect, useState, type FormEvent } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { LayoutGrid, List, Clock, ArrowUpRight } from 'lucide-react';
import {
  leadStatuses,
  type Lead,
  type LeadDetail,
  type LeadInput,
  type Customer,
  type Product,
} from '../../shared/schemas';
import {
  api,
  ApiError,
  useData,
  money,
  date,
  label,
  localDate,
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
} from '../components/ui';
export function SalesPage() {
  const { data, error } = useData<Lead[]>('/leads');
  const [view, setView] = useState('kanban');
  return (
    <>
      <Header
        title="Sales pipeline"
        subtitle="Keep every conversation moving forward."
        action={<AddLink to="/sales/new">Add lead</AddLink>}
      />
      <div className="view-switch">
        <button
          className={view === 'kanban' ? 'selected' : ''}
          onClick={() => setView('kanban')}
        >
          <LayoutGrid size={16} />
          Board
        </button>
        <button
          className={view === 'list' ? 'selected' : ''}
          onClick={() => setView('list')}
        >
          <List size={16} />
          List
        </button>
      </div>
      <ErrorBox message={error} />
      {!data && !error ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title="Your next sale starts here">
          <p>Create a lead and connect it to equipment.</p>
        </Empty>
      ) : view === 'kanban' ? (
        <div className="kanban">
          {leadStatuses.map((status) => (
            <section className="kanban-column" key={status}>
              <div className="column-title">
                <Badge value={status} />
                <span>{data.filter((l) => l.status === status).length}</span>
              </div>
              {data
                .filter((l) => l.status === status)
                .map((l) => (
                  <Link key={l.id} className="deal-card" to={`/sales/${l.id}`}>
                    <small>{l.customerName}</small>
                    <h3>{l.title}</h3>
                    <strong>{money(l.estimatedValue)}</strong>
                    <p>
                      {l.products?.map((p) => p.model).join(', ') ||
                        'No equipment linked'}
                    </p>
                    {l.nextFollowUpAt && (
                      <small className="due-date">
                        <Clock size={13} />
                        {date(l.nextFollowUpAt)}
                      </small>
                    )}
                  </Link>
                ))}
            </section>
          ))}
        </div>
      ) : (
        <section className="panel">
          {data.map((l) => (
            <Link className="list-row" to={`/sales/${l.id}`} key={l.id}>
              <div className="grow">
                <strong>{l.title}</strong>
                <small>{l.customerName}</small>
              </div>
              <strong>{money(l.estimatedValue)}</strong>
              <Badge value={l.status} />
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
const blank: LeadInput = {
  customerId: '',
  title: '',
  status: 'NEW',
  estimatedValue: 0,
  lastContactAt: null,
  nextFollowUpAt: null,
  notes: '',
  productIds: [],
};
export function LeadForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { data: detail, error: loadError } = useData<LeadDetail>(
    id ? `/leads/${id}` : null,
  );
  const { data: customers } = useData<Customer[]>('/customers');
  const { data: products } = useData<Product[]>('/products');
  const [form, setForm] = useState<LeadInput>({
    ...blank,
    customerId: params.get('customerId') ?? '',
  });
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (id && detail) setForm(detail.lead);
  }, [id, detail]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      const l = await api<Lead>(id ? `/leads/${id}` : '/leads', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      });
      nav(`/sales/${l.id}`);
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
        title={id ? 'Edit lead' : 'Start a new conversation'}
        subtitle="Connect a customer with the equipment they're looking for."
      />
      <form onSubmit={(e) => void save(e)}>
        <ErrorBox message={error} />
        <section className="panel">
          <div className="form-grid">
            <Field label="Customer *" error={fields.customerId}>
              <select
                required
                disabled={!!id}
                value={form.customerId}
                onChange={(e) =>
                  setForm({ ...form, customerId: e.target.value })
                }
              >
                <option value="">Select a customer</option>
                {customers?.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Link to="/customers/new">Add a customer</Link>
            </Field>
            <Field label="Lead title *" error={fields.title}>
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Estimated value (THB)" error={fields.estimatedValue}>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.estimatedValue}
                onChange={(e) =>
                  setForm({ ...form, estimatedValue: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Stage" error={fields.status}>
              <select
                disabled={form.status === 'WON'}
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as LeadInput['status'],
                  })
                }
              >
                {leadStatuses
                  .filter((s) => s !== 'WON' || form.status === 'WON')
                  .map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Last contact" error={fields.lastContactAt}>
              <input
                type="datetime-local"
                value={localDate(form.lastContactAt)}
                onChange={(e) =>
                  setForm({ ...form, lastContactAt: toISO(e.target.value) })
                }
              />
            </Field>
            <Field label="Next follow-up" error={fields.nextFollowUpAt}>
              <input
                type="datetime-local"
                value={localDate(form.nextFollowUpAt)}
                onChange={(e) =>
                  setForm({ ...form, nextFollowUpAt: toISO(e.target.value) })
                }
              />
            </Field>
          </div>
          <Field label="Notes" error={fields.notes}>
            <textarea
              rows={4}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </section>
        <section className="panel">
          <h2>Interested equipment</h2>
          <p className="muted">
            Select one or more products. You will choose the actual sold items
            when winning the deal.
          </p>
          <ErrorBox message={fields.productIds?.join(' ') ?? ''} />
          <div className="product-picker">
            {products?.map((p) => (
              <label className="checkbox-row" key={p.id}>
                <input
                  type="checkbox"
                  checked={form.productIds.includes(p.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      productIds: e.target.checked
                        ? [...form.productIds, p.id]
                        : form.productIds.filter((v) => v !== p.id),
                    })
                  }
                />
                <div className="grow">
                  <strong>
                    {p.brand} {p.model}
                  </strong>
                  <small>
                    {p.sku} · {money(p.sellingPrice)}
                  </small>
                </div>
                <Badge value={p.status} />
              </label>
            ))}
          </div>
        </section>
        <div className="form-actions">
          <Link className="button" to={id ? `/sales/${id}` : '/sales'}>
            Cancel
          </Link>
          <button disabled={busy} className="primary">
            {busy ? 'Saving…' : 'Save lead'}
          </button>
        </div>
      </form>
    </>
  );
}
export function LeadPage() {
  const { id } = useParams();
  const {
    data: d,
    error: loadError,
    reload,
  } = useData<LeadDetail>(`/leads/${id}`);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [winning, setWinning] = useState(false);
  const [sold, setSold] = useState<string[]>([]);
  const [followup, setFollowup] = useState('');
  useEffect(() => {
    if (d) setFollowup(localDate(d.lead.nextFollowUpAt));
  }, [d]);
  async function action(path: string, body: unknown, method = 'PATCH') {
    setBusy(true);
    setError('');
    try {
      await api(path, { method, body: JSON.stringify(body) });
      reload();
      setWinning(false);
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
  const l = d.lead;
  return (
    <>
      <Header
        title={l.title}
        subtitle={d.customer.name}
        action={
          <Link className="button" to={`/sales/${id}/edit`}>
            Edit lead
          </Link>
        }
      />
      <ErrorBox message={error || loadError} />
      <section className="panel">
        <div className="section-heading">
          <Badge value={l.status} />
          <strong className="lead-value">{money(l.estimatedValue)}</strong>
        </div>
        <div className="button-row">
          {(['CONTACTED', 'INTERESTED', 'QUOTED'] as const).map((status) => (
            <button
              key={status}
              disabled={busy || l.status === 'WON' || l.status === status}
              onClick={() =>
                void action(`/leads/${id}`, {
                  status,
                  ...(status === 'CONTACTED'
                    ? {
                        lastContactAt: new Date().toISOString(),
                        nextFollowUpAt: null,
                      }
                    : {}),
                })
              }
            >
              Mark {label(status)}
            </button>
          ))}
          <button
            disabled={busy || l.status === 'WON'}
            className="primary"
            onClick={() => setWinning(!winning)}
          >
            Mark won
          </button>
          <button
            disabled={busy || ['WON', 'LOST'].includes(l.status)}
            onClick={() => {
              if (
                confirm(
                  'Mark this lead lost? Any equipment reservations must be released separately.',
                )
              )
                void action(`/leads/${id}`, {
                  status: 'LOST',
                  nextFollowUpAt: null,
                });
            }}
          >
            Mark lost
          </button>
        </div>
        {winning && (
          <div className="ai-draft">
            <h3>Which equipment was actually sold?</h3>
            <p>
              Only checked items will be marked sold. Leave unchecked products
              unchanged.
            </p>
            {d.products
              .filter((p) => p.status !== 'SOLD')
              .map((p) => (
                <label className="checkbox-row" key={p.id}>
                  <input
                    type="checkbox"
                    checked={sold.includes(p.id)}
                    onChange={(e) =>
                      setSold(
                        e.target.checked
                          ? [...sold, p.id]
                          : sold.filter((v) => v !== p.id),
                      )
                    }
                  />
                  <span>
                    {p.brand} {p.model}
                  </span>
                </label>
              ))}
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    `Win this lead and mark ${sold.length} selected equipment item(s) sold?`,
                  )
                )
                  void action(`/leads/${id}/win`, { productIds: sold }, 'POST');
              }}
            >
              Confirm won · {sold.length} item(s) sold
            </button>
          </div>
        )}
      </section>
      <div className="detail-grid">
        <section className="panel">
          <h2>Customer & follow-up</h2>
          <Link className="text-link" to={`/customers/${d.customer.id}`}>
            {d.customer.name}
            <ArrowUpRight size={15} />
          </Link>
          <p>
            {d.customer.phone ||
              d.customer.email ||
              'No contact details recorded'}
          </p>
          <p className="muted">Last contact: {date(l.lastContactAt)}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(`/leads/${id}`, { nextFollowUpAt: toISO(followup) });
            }}
          >
            <Field label="Next follow-up">
              <input
                type="datetime-local"
                value={followup}
                onChange={(e) => setFollowup(e.target.value)}
              />
            </Field>
            <button disabled={busy || ['WON', 'LOST'].includes(l.status)}>
              Save follow-up
            </button>
          </form>
          <h3>Notes</h3>
          <p className="preserve">{l.notes || 'No notes yet.'}</p>
        </section>
        <section className="panel">
          <h2>Interested equipment</h2>
          {d.products.length ? (
            d.products.map((p) => (
              <div className="linked-product" key={p.id}>
                <Link to={`/inventory/${p.id}`}>
                  <strong>
                    {p.brand} {p.model}
                  </strong>
                  <small>{money(p.sellingPrice)}</small>
                </Link>
                <Badge value={p.status} />
                {p.status === 'AVAILABLE' &&
                  !['WON', 'LOST'].includes(l.status) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          `/products/${p.id}/reserve`,
                          { customerId: l.customerId, leadId: l.id },
                          'POST',
                        )
                      }
                    >
                      Reserve
                    </button>
                  )}
              </div>
            ))
          ) : (
            <Empty title="No equipment linked">
              <Link to={`/sales/${id}/edit`}>Choose interested products</Link>
            </Empty>
          )}
        </section>
      </div>
      <ActivityList items={d.activities} />
    </>
  );
}
export function FollowupsPage() {
  const {
    data,
    error: loadError,
    reload,
  } = useData<{ overdue: Lead[]; today: Lead[]; upcoming: Lead[] }>(
    '/followups',
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <Header
        title="Keep the conversation going"
        subtitle="Small follow-ups. Stronger customer relationships."
      />
      <ErrorBox message={error || loadError} />
      {!data && !loadError ? (
        <Loading />
      ) : (
        data &&
        (['overdue', 'today', 'upcoming'] as const).map((group) => (
          <section className="followup-section" key={group}>
            <div className="section-heading">
              <h2>
                {label(group)}{' '}
                <span className={`count ${group}`}>{data[group].length}</span>
              </h2>
            </div>
            {data[group].length ? (
              <div className="followup-grid">
                {data[group].map((l) => (
                  <article
                    className={`panel followup-card ${group}`}
                    key={l.id}
                  >
                    <div className="section-heading">
                      <strong>{l.customerName}</strong>
                      <Badge value={l.status} />
                    </div>
                    <h3>
                      <Link to={`/sales/${l.id}`}>{l.title}</Link>
                    </h3>
                    <p>
                      {l.products
                        ?.map((p) => `${p.brand} ${p.model}`)
                        .join(', ') || 'No equipment linked'}
                    </p>
                    <strong>{money(l.estimatedValue)}</strong>
                    <small>Last contact: {date(l.lastContactAt)}</small>
                    <small className="due-date">
                      <Clock size={14} />
                      {date(l.nextFollowUpAt)}
                    </small>
                    {l.notes && <p className="preserve">{l.notes}</p>}
                    <div className="button-row">
                      <button
                        disabled={busy === l.id}
                        onClick={async () => {
                          setBusy(l.id);
                          setError('');
                          try {
                            await api(`/leads/${l.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({
                                lastContactAt: new Date().toISOString(),
                                nextFollowUpAt: null,
                                ...(l.status === 'NEW'
                                  ? { status: 'CONTACTED' }
                                  : {}),
                              }),
                            });
                            reload();
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        Mark contacted
                      </button>
                      <Link className="button" to={`/sales/${l.id}`}>
                        Reschedule / open
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="quiet-empty">
                {group === 'today'
                  ? "No follow-ups today. You're all caught up."
                  : `No ${group} follow-ups.`}
              </div>
            )}
          </section>
        ))
      )}
    </>
  );
}
