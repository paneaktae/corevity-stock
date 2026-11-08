import { metaCopy as copy } from '../meta';

export function dateDefaults() {
  const until = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return {
    until,
    since: new Date(Date.parse(until) - 6 * 86400000)
      .toISOString()
      .slice(0, 10),
  };
}
export function DateFilters({
  since,
  until,
  onChange,
}: {
  since: string;
  until: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="meta-date-filters">
      <label>
        {copy('From', 'เริ่ม')}
        <input
          type="date"
          value={since}
          onChange={(e) => onChange(e.target.value, until)}
        />
      </label>
      <label>
        {copy('To', 'ถึง')}
        <input
          type="date"
          value={until}
          onChange={(e) => onChange(since, e.target.value)}
        />
      </label>
      <select
        aria-label={copy('Date preset', 'ช่วงเวลา')}
        defaultValue="7"
        onChange={(e) => {
          const today = dateDefaults().until,
            day = 86400000;
          const value = e.target.value;
          if (value === 'custom') return;
          if (value === 'yesterday') {
            const y = new Date(Date.parse(today) - day)
              .toISOString()
              .slice(0, 10);
            onChange(y, y);
          } else if (value === 'month')
            onChange(today.slice(0, 8) + '01', today);
          else
            onChange(
              new Date(Date.parse(today) - (Number(value) - 1) * day)
                .toISOString()
                .slice(0, 10),
              today,
            );
        }}
      >
        <option value="1">{copy('Today', 'วันนี้')}</option>
        <option value="yesterday">{copy('Yesterday', 'เมื่อวาน')}</option>
        <option value="7">{copy('Last 7 days', '7 วันล่าสุด')}</option>
        <option value="30">{copy('Last 30 days', '30 วันล่าสุด')}</option>
        <option value="month">{copy('This month', 'เดือนนี้')}</option>
        <option value="custom">{copy('Custom', 'กำหนดเอง')}</option>
      </select>
    </div>
  );
}
