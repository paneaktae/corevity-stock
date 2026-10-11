import { z } from 'zod';

const rateSchema = z.object({
  base: z.literal('USD'),
  quote: z.literal('THB'),
  rate: z.number().finite().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkedAt: z.string().datetime(),
  source: z.enum(['BOT', 'Frankfurter']).default('Frankfurter'),
});
const botResponse = z.object({
  result: z.object({
    data: z.object({
      data_detail: z.array(
        z.object({
          period: z.string().date(),
          rate: z
            .string()
            .regex(/^\d+(\.\d+)?$/)
            .transform(Number)
            .pipe(z.number().finite().positive()),
        }),
      ),
    }),
  }),
});
// BOT publishes at 18:00 Bangkok time; allow 15 minutes for publication.
const publicationDay = (date: Date) =>
  bangkokDay(new Date(date.getTime() - (18 * 60 + 15) * 60000));
export const bangkokDay = (date: Date) =>
  new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);

export async function exchangeRate(
  database: D1Database,
  fetcher: typeof fetch = fetch,
  clock = new Date(),
  apiKey?: string,
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
  const due =
    !current ||
    current.source !== 'BOT' ||
    publicationDay(new Date(current.checkedAt)) !== publicationDay(clock);
  let refreshFailed = false;
  if (due && apiKey) {
    // Coordinate concurrent page loads and cron events; retry failed refreshes after 30 minutes.
    const lease = await database
      .prepare(
        "INSERT INTO settings(key,value) VALUES('fx_refresh_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<=? RETURNING key",
      )
      .bind(String(clock.getTime() + 30 * 60000), clock.getTime())
      .first();
    if (lease) {
      try {
        const url = new URL(
          'https://gateway.api.bot.or.th/Stat-ReferenceRate/v2/DAILY_REF_RATE/',
        );
        url.searchParams.set(
          'start_period',
          bangkokDay(new Date(clock.getTime() - 30 * 86400000)),
        );
        url.searchParams.set('end_period', today);
        const response = await fetcher(url.toString(), {
          signal: AbortSignal.timeout(8000),
          headers: { Accept: 'application/json', Authorization: apiKey },
        });
        if (!response.ok) throw new Error('Exchange rate source unavailable');
        const rows = botResponse.parse(await response.json()).result.data
          .data_detail;
        const latest = rows
          .filter((row) => row.period <= today)
          .sort((a, b) => b.period.localeCompare(a.period))[0];
        if (!latest) throw new Error('No published BOT rate');
        const next = rateSchema.parse({
          base: 'USD',
          quote: 'THB',
          source: 'BOT',
          rate: latest.rate,
          date: latest.period,
          checkedAt: clock.toISOString(),
        });
        if (
          !Number.isFinite(Date.parse(next.date)) ||
          next.date > today ||
          (current?.source === 'BOT' && next.date < current.date)
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
        refreshFailed = true;
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
    source: current?.source ?? 'BOT',
    stale:
      !current ||
      refreshFailed ||
      !apiKey ||
      current.source !== 'BOT' ||
      publicationDay(new Date(current.checkedAt)) !== publicationDay(clock) ||
      Date.parse(today) - Date.parse(current.date) > 4 * 86400000,
  };
}
