import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Package,
  Clock,
  CheckCheck,
  Wallet,
  Users,
  CalendarClock,
} from 'lucide-react';
import type { Dashboard } from '../../shared/schemas';
import { useData, money, date } from '../lib';
import {
  AddLink,
  Badge,
  Empty,
  ErrorBox,
  Header,
  Loading,
  SectionLink,
} from '../components/ui';
export function DashboardPage() {
  const { data: d, error } = useData<Dashboard>('/dashboard');
  if (!d)
    return (
      <>
        <ErrorBox message={error} />
        {!error && <Loading />}
      </>
    );
  const metrics = [
    ['Available equipment', d.available, Package, 'Ready for a new home'],
    ['Reserved equipment', d.reserved, Clock, 'Held for your customers'],
    ['Sold this month', d.soldThisMonth, CheckCheck, 'Equipment put to work'],
    [
      'Inventory cost value',
      money(d.inventoryCostValue),
      Wallet,
      'Available + reserved',
    ],
    ['Active leads', d.activeLeads, Users, 'Conversations in progress'],
    ['Follow-ups today', d.dueToday, CalendarClock, `${d.overdue} overdue`],
  ] as const;
  return (
    <>
      <Header
        title="Your business at a glance"
        subtitle="A clear view of your equipment, customers, and next steps."
        action={<AddLink to="/inventory/new">Add equipment</AddLink>}
      />
      <ErrorBox message={error} />
      {d.overdue > 0 && (
        <Link className="attention" to="/followups">
          <CalendarClock size={21} />
          <span>
            <strong>
              {d.overdue} follow-up{d.overdue !== 1 ? 's' : ''} need your
              attention
            </strong>
            <small>A quick check-in can move a deal forward.</small>
          </span>
          <ArrowUpRight size={20} />
        </Link>
      )}
      <div className="metrics">
        {metrics.map(([name, value, Icon, note]) => (
          <div className="metric" key={name}>
            <div className="metric-top">
              <span>{name}</span>
              <Icon size={19} />
            </div>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>Recent equipment</h2>
            <SectionLink to="/inventory">View inventory</SectionLink>
          </div>
          {d.recentProducts.length ? (
            d.recentProducts.map((p) => (
              <Link className="list-row" to={`/inventory/${p.id}`} key={p.id}>
                <div className="mini-icon">
                  <Package size={21} />
                </div>
                <div className="grow">
                  <strong>
                    {p.brand} {p.model}
                  </strong>
                  <small>
                    {p.sku} · {p.category || 'Uncategorized'}
                  </small>
                </div>
                <div className="align-right">
                  <strong>{money(p.sellingPrice)}</strong>
                  <Badge value={p.status} />
                </div>
              </Link>
            ))
          ) : (
            <Empty title="No products yet">
              <Link to="/inventory/new">Add your first equipment item.</Link>
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>Next conversations</h2>
            <SectionLink to="/followups">View all</SectionLink>
          </div>
          {d.followups.length ? (
            d.followups.map((l) => (
              <Link className="list-row" key={l.id} to={`/sales/${l.id}`}>
                <div className="grow">
                  <strong>{l.customerName}</strong>
                  <small>{l.title}</small>
                  <small className="due-date">
                    <Clock size={12} />
                    {date(l.nextFollowUpAt)}
                  </small>
                </div>
                <ArrowUpRight size={18} />
              </Link>
            ))
          ) : (
            <Empty title="You're all caught up">
              <p>No follow-ups scheduled.</p>
            </Empty>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>Recent sales</h2>
          <SectionLink to="/inventory?status=SOLD">
            View sold equipment
          </SectionLink>
        </div>
        {d.recentSales.length ? (
          d.recentSales.map((p) => (
            <Link className="list-row" key={p.id} to={`/inventory/${p.id}`}>
              <div className="mini-icon sold-icon">
                <CheckCheck size={21} />
              </div>
              <div className="grow">
                <strong>
                  {p.brand} {p.model}
                </strong>
                <small>{date(p.soldAt)}</small>
              </div>
              <strong>{money(p.sellingPrice)}</strong>
              <Badge value="SOLD" />
            </Link>
          ))
        ) : (
          <p className="muted">Your completed sales will appear here.</p>
        )}
      </section>
    </>
  );
}
