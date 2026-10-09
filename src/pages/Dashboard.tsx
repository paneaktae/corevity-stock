import { t, localized } from '../i18n';
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
    [t('Available equipment'), d.available, Package, t('Ready for a new home')],
    [t('Reserved equipment'), d.reserved, Clock, t('Held for your customers')],
    [
      t('Sold this month'),
      d.soldThisMonth,
      CheckCheck,
      t('Equipment put to work'),
    ],
    [
      t('Inventory cost value'),
      money(d.inventoryCostValue),
      Wallet,
      t('Available + reserved'),
    ],
    [t('Active leads'), d.activeLeads, Users, t('Conversations in progress')],
    [
      t('Follow-ups today'),
      d.dueToday,
      CalendarClock,
      localized(`${d.overdue} overdue`, `เลยกำหนด ${d.overdue} รายการ`),
    ],
  ] as const;
  return (
    <>
      <Header
        title={t('Your business at a glance')}
        subtitle={t(
          'A clear view of your equipment, customers, and next steps.',
        )}
        action={<AddLink to="/inventory/new">{t('Add equipment')}</AddLink>}
      />
      <ErrorBox message={error} />
      {d.overdue > 0 && (
        <Link className="attention" to="/followups">
          <CalendarClock size={21} />
          <span>
            <strong>
              {localized(
                `${d.overdue} follow-ups need your attention`,
                `มี ${d.overdue} รายการที่ต้องติดตาม`,
              )}
            </strong>
            <small>{t('A quick check-in can move a deal forward.')}</small>
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
            <h2>{t('Recent equipment')}</h2>
            <SectionLink to="/inventory">{t('View inventory')}</SectionLink>
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
                    {p.sku} · {p.category || t('Uncategorized')}
                  </small>
                </div>
                <div className="align-right">
                  <strong>{money(p.sellingPrice)}</strong>
                  <Badge value={p.status} />
                </div>
              </Link>
            ))
          ) : (
            <Empty title={t('No products yet')}>
              <Link to="/inventory/new">
                {t('Add your first equipment item.')}
              </Link>
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>{t('Next conversations')}</h2>
            <SectionLink to="/followups">{t('View all')}</SectionLink>
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
            <Empty title={t("You're all caught up")}>
              <p>{t('No follow-ups scheduled.')}</p>
            </Empty>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>{t('Recent sales')}</h2>
          <SectionLink to="/inventory?status=SOLD">
            {t('View sold equipment')}
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
          <p className="muted">{t('Your completed sales will appear here.')}</p>
        )}
      </section>
    </>
  );
}
