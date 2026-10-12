function period(clock: Date) {
  const local = new Date(clock.getTime() + 7 * 3600000).toISOString();
  return {
    year: Number(local.slice(0, 4)),
    prefix: local.slice(0, 7).replace('-', ''),
  };
}
export async function nextSku(database: D1Database, clock = new Date()) {
  const { year, prefix } = period(clock);
  const latest = await latestStoredSequence(database, year);
  return `${prefix}${String(latest + 1).padStart(3, '0')}`;
}

async function latestStoredSequence(database: D1Database, year: number) {
  const [sequence, stored] = await Promise.all([
    database
      .prepare('SELECT value FROM sku_sequences WHERE year=?')
      .bind(year)
      .first<{ value: number }>(),
    database
      .prepare(
        "SELECT MAX(CAST(substr(sku,7) AS INTEGER)) AS value FROM products WHERE substr(sku,1,4)=? AND length(sku)>6 AND substr(sku,7) NOT GLOB '*[^0-9]*'",
      )
      .bind(String(year))
      .first<{ value: number | null }>(),
  ]);
  return Math.max(sequence?.value ?? 0, stored?.value ?? 0);
}

export async function generateSkus(
  database: D1Database,
  count: number,
  clock = new Date(),
) {
  if (!count) return [];
  const { year, prefix } = period(clock);
  const latest = await latestStoredSequence(database, year);
  const sequence = await database
    .prepare(
      'INSERT INTO sku_sequences(year,value) VALUES (?,?) ON CONFLICT(year) DO UPDATE SET value=MAX(sku_sequences.value,excluded.value-?)+? RETURNING value',
    )
    .bind(year, latest + count, count, count)
    .first<{ value: number }>();
  const first = sequence!.value - count + 1;
  return Array.from(
    { length: count },
    (_, index) => `${prefix}${String(first + index).padStart(3, '0')}`,
  );
}
