import { z } from 'zod';

const rateSchema = z.object({
  base: z.literal('USD'),
  quote: z.literal('THB'),
  rate: z.number().finite().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkedAt: z.string().datetime(),
});
export const bangkokDay = (date: Date) =>
  new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);

export async function exchangeRate(
  database: D1Database,
  fetcher: typeof fetch = fetch,
  clock = new Date(),
) {
  const saved = await database
    .prepare("SELECT value FROM settings WHERE key='fx_usd_thb'")
    .first<{ value: string }>();
  let current: z.infer<typeof rateSchema> | null = null;
  try {
    current = rateSchema.parse(JSON.parse(saved?.value ?? 'null'));
  } catch {
    /* No usable saved rate. */
  }
  const today = bangkokDay(clock);
  if (!current || bangkokDay(new Date(current.checkedAt)) !== today) {
    // Coordinate concurrent page loads and cron events; retry failed refreshes after 30 minutes.
    const lease = await database
      .prepare(
        "INSERT INTO settings(key,value) VALUES('fx_refresh_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<=? RETURNING key",
      )
      .bind(String(clock.getTime() + 30 * 60000), clock.getTime())
      .first();
    if (lease) {
      try {
        const response = await fetcher(
          'https://api.frankfurter.dev/v2/rate/USD/THB',
          {
            signal: AbortSignal.timeout(8000),
            headers: { Accept: 'application/json' },
          },
        );
        if (!response.ok) throw new Error('Exchange rate source unavailable');
        const next = rateSchema.parse({
          ...((await response.json()) as object),
          checkedAt: clock.toISOString(),
        });
        if (
          !Number.isFinite(Date.parse(next.date)) ||
          next.date > today ||
          (current && next.date < current.date)
        )
          throw new Error('Invalid rate date');
        await database
          .prepare(
            "INSERT INTO settings(key,value) VALUES('fx_usd_thb',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .bind(JSON.stringify(next))
          .run();
        current = next;
      } catch {
        console.warn(
          'Daily exchange rate refresh failed; retaining last known rate',
        );
      }
    }
  }
  return {
    rate: current?.rate ?? null,
    date: current?.date ?? null,
    checkedAt: current?.checkedAt ?? null,
    source: 'Frankfurter',
    stale:
      !current ||
      bangkokDay(new Date(current.checkedAt)) !== today ||
      Date.parse(today) - Date.parse(current.date) > 4 * 86400000,
  };
}
