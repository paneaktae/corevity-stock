function period(clock: Date) {
  const local = new Date(clock.getTime() + 7 * 3600000).toISOString();
  return {
    year: Number(local.slice(0, 4)),
    prefix: local.slice(0, 7).replace('-', ''),
  };
}
export async function nextSku(database: D1Database, clock = new Date()) {
  const { year, prefix } = period(clock);
  const row = await database
    .prepare('SELECT value FROM sku_sequences WHERE year=?')
    .bind(year)
    .first<{ value: number }>();
  return `${prefix}${String((row?.value ?? 0) + 1).padStart(3, '0')}`;
}
export async function generateSkus(
  database: D1Database,
  count: number,
  clock = new Date(),
) {
  if (!count) return [];
  const { year, prefix } = period(clock);
  const sequence = await database
    .prepare(
      'INSERT INTO sku_sequences(year,value) VALUES (?,?) ON CONFLICT(year) DO UPDATE SET value=value+excluded.value RETURNING value',
    )
    .bind(year, count)
    .first<{ value: number }>();
  const first = sequence!.value - count + 1;
  return Array.from(
    { length: count },
    (_, index) => `${prefix}${String(first + index).padStart(3, '0')}`,
  );
}
