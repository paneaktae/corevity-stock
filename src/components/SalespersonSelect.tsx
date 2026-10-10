import { type Salesperson, salespersonName } from '../../shared/schemas';
import { t } from '../i18n';
export function SalespersonSelect({
  value,
  onChange,
  salespeople,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  salespeople: Salesperson[] | undefined;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled || !salespeople}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">
        {t(
          salespeople ? 'Unassigned — no LINE reminder' : 'Loading sales team…',
        )}
      </option>
      {salespeople?.map((sale) => (
        <option key={sale.email} value={sale.email}>
          {salespersonName(sale)}
          {sale.firstName ? ` (${sale.email})` : ''} ·{' '}
          {t(sale.lineReady ? 'LINE ready' : 'LINE not connected')}
        </option>
      ))}
      {value && !salespeople?.some((sale) => sale.email === value) && (
        <option value={value}>{value}</option>
      )}
    </select>
  );
}
