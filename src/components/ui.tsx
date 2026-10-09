import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Dumbbell, Plus, ArrowUpRight } from 'lucide-react';
import { date, label } from '../lib';
import type { Activity, Product } from '../../shared/schemas';
export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value.toLowerCase()}`}>
      <span />
      {label(value)}
    </span>
  );
}
export function Header({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <div className="eyebrow">{eyebrow ?? 'YOUR WORKSPACE'}</div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Dumbbell size={30} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="empty" role="status">
      Loading your workspace…
    </div>
  );
}
export function AddLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="button primary" to={to}>
      <Plus size={17} />
      {children}
    </Link>
  );
}
export function Photo({ product }: { product: Product }) {
  return product.primaryImageId ? (
    <img
      className="product-photo"
      src={`/api/images/${product.primaryImageId}`}
      alt={`${product.brand} ${product.model}`}
    />
  ) : (
    <div className="photo-placeholder">
      <Dumbbell size={26} />
      <span>No photo</span>
    </div>
  );
}
export function Field({
  label: caption,
  error,
  children,
}: {
  label: string;
  error?: string[];
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{caption}</span>
      {children}
      {error && <small className="field-error">{error.join(' ')}</small>}
    </label>
  );
}
export function ActivityList({ items }: { items: Activity[] }) {
  return (
    <section className="panel">
      <h2>Recent activity</h2>
      {items.length ? (
        items.map((item) => (
          <div className="activity" key={item.id}>
            <span className="activity-dot" />
            <div>
              <strong>{item.description}</strong>
              <small>
                {item.userEmail} · {date(item.createdAt)}
              </small>
            </div>
          </div>
        ))
      ) : (
        <p className="muted">No activity yet.</p>
      )}
    </section>
  );
}
export function SectionLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className="text-link" to={to}>
      {children}
      <ArrowUpRight size={15} />
    </Link>
  );
}
