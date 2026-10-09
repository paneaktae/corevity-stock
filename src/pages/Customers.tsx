import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Search, ArrowUpRight, Users } from 'lucide-react';
import type {
  Customer,
  CustomerDetail,
  CustomerInput,
} from '../../shared/schemas';
import { api, ApiError, useData, useDebounce, money, date } from '../lib';
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
export function CustomersPage() {
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const { data, error } = useData<Customer[]>(
    `/customers?q=${encodeURIComponent(q)}`,
  );
  return (
    <>
      <Header
        title="Your customers"
        subtitle="The people behind your next sale."
        action={<AddLink to="/customers/new">Add customer</AddLink>}
      />
      <div className="panel toolbar">
        <label className="search">
          <Search size={18} />
          <input
            aria-label="Search customers"
            placeholder="Search name, company, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <ErrorBox message={error} />
      {!data && !error ? (
        <Loading />
      ) : data?.length ? (
        <div className="customer-grid">
          {data.map((c) => (
            <Link
              className="panel customer-card"
              key={c.id}
              to={`/customers/${c.id}`}
            >
              <div className="section-heading">
                <span className="avatar">
                  {c.name.slice(0, 2).toUpperCase()}
                </span>
                <ArrowUpRight size={18} />
              </div>
              <h2>{c.name}</h2>
              <p>{c.companyName || 'Individual customer'}</p>
              <small>{c.phone || c.email || 'No contact details yet'}</small>
              <div className="card-footer">
                <Users size={15} />
                {c.interestedIn || 'Interests not set'}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="No customers found">
          <p>Add a customer to start a conversation.</p>
        </Empty>
      )}
    </>
  );
}
const blank: CustomerInput = {
  name: '',
  companyName: '',
  contactName: '',
  phone: '',
  lineId: '',
  email: '',
  budget: 0,
  interestedIn: '',
  notes: '',
};
export function CustomerForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, error: loadError } = useData<CustomerDetail>(
    id ? `/customers/${id}` : null,
  );
  const [form, setForm] = useState<CustomerInput>(blank);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (id && data) setForm(data.customer);
  }, [id, data]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setFields({});
    setBusy(true);
    try {
      const c = await api<Customer>(id ? `/customers/${id}` : '/customers', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      });
      nav(`/customers/${c.id}`);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) setFields(e.fields);
    } finally {
      setBusy(false);
    }
  }
  if (id && !data)
    return (
      <>
        <ErrorBox message={loadError} />
        {!loadError && <Loading />}
      </>
    );
  return (
    <>
      <Header
        title={id ? 'Edit customer' : 'Add a customer'}
        subtitle="A name is all you need to get started."
      />
      <form onSubmit={(e) => void save(e)}>
        <ErrorBox message={error} />
        <section className="panel">
          <div className="form-grid">
            {(
              [
                ['name', 'Name *'],
                ['companyName', 'Company'],
                ['contactName', 'Contact person'],
                ['phone', 'Phone'],
                ['lineId', 'LINE ID'],
                ['email', 'Email'],
                ['budget', 'Budget (THB)'],
                ['interestedIn', 'Interested in'],
              ] as const
            ).map(([key, title]) => (
              <Field key={key} label={title} error={fields[key]}>
                <input
                  required={key === 'name'}
                  type={
                    key === 'budget'
                      ? 'number'
                      : key === 'email'
                        ? 'email'
                        : key === 'phone'
                          ? 'tel'
                          : 'text'
                  }
                  min={key === 'budget' ? 0 : undefined}
                  step={key === 'budget' ? '0.01' : undefined}
                  value={form[key]}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      [key]:
                        key === 'budget'
                          ? Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <Field label="Notes" error={fields.notes}>
            <textarea
              rows={5}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </section>
        <div className="form-actions">
          <Link className="button" to={id ? `/customers/${id}` : '/customers'}>
            Cancel
          </Link>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save customer'}
          </button>
        </div>
      </form>
    </>
  );
}
export function CustomerPage() {
  const { id } = useParams();
  const { data: d, error } = useData<CustomerDetail>(`/customers/${id}`);
  if (!d)
    return (
      <>
        <ErrorBox message={error} />
        {!error && <Loading />}
      </>
    );
  const c = d.customer;
  const active = d.leads.filter((l) => !['WON', 'LOST'].includes(l.status));
  const next = active
    .filter((l) => l.nextFollowUpAt)
    .sort((a, b) => a.nextFollowUpAt!.localeCompare(b.nextFollowUpAt!))[0];
  return (
    <>
      <Header
        title={c.name}
        subtitle={c.companyName || 'Individual customer'}
        action={
          <Link className="button" to={`/customers/${id}/edit`}>
            Edit customer
          </Link>
        }
      />
      <div className="detail-grid">
        <section className="panel">
          <h2>Contact & interests</h2>
          <div className="facts">
            {[
              ['Contact person', c.contactName],
              ['Phone', c.phone],
              ['LINE', c.lineId],
              ['Email', c.email],
              ['Budget', money(c.budget)],
              ['Interested in', c.interestedIn],
              ['Next follow-up', date(next?.nextFollowUpAt)],
            ].map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <strong>{v || 'Not set'}</strong>
              </div>
            ))}
          </div>
          <h3>Notes</h3>
          <p className="preserve">{c.notes || 'No notes yet.'}</p>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>Leads & conversations</h2>
            <AddLink to={`/sales/new?customerId=${id}`}>Add lead</AddLink>
          </div>
          {d.leads.length ? (
            d.leads.map((l) => (
              <Link className="list-row" key={l.id} to={`/sales/${l.id}`}>
                <div className="grow">
                  <strong>{l.title}</strong>
                  <small>
                    {l.products
                      ?.map((p) => `${p.brand} ${p.model}`)
                      .join(', ') || 'No equipment linked'}
                  </small>
                  <small>{date(l.nextFollowUpAt)}</small>
                </div>
                <Badge value={l.status} />
              </Link>
            ))
          ) : (
            <Empty title="Start a conversation">
              <p>Add a lead and the equipment they're interested in.</p>
            </Empty>
          )}
        </section>
      </div>
      <ActivityList items={d.activities} />
    </>
  );
}
