import { Hono, type Context as HonoContext } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv, Bindings } from './auth';
import { workspaceSalesEmails } from './services/line';
import { extractGoogleMapsUrl, isSafeGoogleMapsUrl } from '../shared/google-maps';

const eventInput = z.object({
  title: z.string().trim().min(1).max(160),
  details: z.string().trim().max(4000).default(''),
  location: z.string().trim().max(240).default(''),
  locationPlaceId: z.string().trim().max(200).default(''),
  locationMapUrl: z.string().trim().max(10000).default('').transform(extractGoogleMapsUrl)
    .refine(isSafeGoogleMapsUrl, 'Enter a valid Google Maps link or iframe.'),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().default(null),
  reminderMinutes: z.number().int().min(0).max(10080).default(1440),
  attendeeEmails: z.array(z.string().email().max(254)).max(20).default([]),
}).strict();

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

async function parseEventRows(c: HonoContext<AppEnv>, from: string, to: string) {
  const fromAt = new Date(`${from}T00:00:00+07:00`).toISOString();
  const toAt = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400000).toISOString();
  const rows = await c.env.DB.prepare(
    `SELECT id,title,details,location,location_place_id AS locationPlaceId,location_map_url AS locationMapUrl,starts_at AS startsAt,ends_at AS endsAt,
      reminder_minutes AS reminderMinutes,created_by AS createdBy,created_at AS createdAt
     FROM calendar_events WHERE starts_at>=? AND starts_at<? ORDER BY starts_at LIMIT 300`,
  ).bind(fromAt, toAt).all<CalendarEventRow>();
  if (!rows.results.length) return [];
  const attendees = await c.env.DB.prepare(
    `SELECT a.event_id AS eventId,a.email,
      COALESCE(NULLIF(trim(s.first_name || ' ' || s.last_name),''),a.email) AS name,
      CASE WHEN l.enabled=1 THEN 1 ELSE 0 END AS lineReady
     FROM calendar_event_attendees a
     LEFT JOIN salespeople s ON s.email=a.email
     LEFT JOIN line_accounts l ON l.email=a.email
     WHERE a.event_id IN (${rows.results.map(() => '?').join(',')}) ORDER BY name COLLATE NOCASE`,
  ).bind(...rows.results.map((event) => event.id)).all<CalendarAttendeeRow>();
  const delivery = await c.env.DB.prepare(
    `SELECT event_id AS eventId,
      COUNT(DISTINCT CASE WHEN status='sent' THEN email END) AS sentCount,
      MAX(CASE WHEN status='sent' THEN sent_at END) AS sentAt
     FROM calendar_reminders WHERE event_id IN (${rows.results.map(() => '?').join(',')}) GROUP BY event_id`,
  ).bind(...rows.results.map((event) => event.id)).all<CalendarReminderDeliveryRow>();
  const deliveryByEvent = new Map(delivery.results.map(({ eventId, ...item }) => [eventId, item]));
  return rows.results.map((event) => ({
    ...event,
    attendees: attendees.results.filter((attendee) => attendee.eventId === event.id)
      .map(({ eventId: _eventId, ...attendee }) => ({ ...attendee, lineReady: Boolean(attendee.lineReady) })),
    reminderDelivery: deliveryByEvent.get(event.id) ?? null,
  }));
}

type CalendarEventRow = {
  id: string; title: string; details: string; location: string; locationPlaceId: string; locationMapUrl: string; startsAt: string;
  endsAt: string | null; reminderMinutes: number; createdBy: string; createdAt: string;
};
type CalendarAttendeeRow = { eventId: string; email: string; name: string; lineReady: number };
type CalendarReminderDeliveryRow = { eventId: string; sentCount: number; sentAt: string | null };

export const eventsRoutes = new Hono<AppEnv>();
eventsRoutes.get('/locations', async (c) => {
  const query = (c.req.query('q') ?? '').trim().replace(/\s+/g, ' ');
  if (query.length < 3) return c.json({ suggestions: [], configured: true });
  if (query.length > 120) throw new HTTPException(422, { message: 'Search text is too long.' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', query);
    url.searchParams.set('lang', c.req.query('lang') === 'th' ? 'th' : 'en');
    url.searchParams.set('countrycode', 'TH');
    url.searchParams.set('lat', '13.7563');
    url.searchParams.set('lon', '100.5018');
    url.searchParams.set('limit', '5');
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return c.json({ suggestions: [], configured: true });
    const result = await response.json() as {
      features?: Array<{ properties?: {
        name?: string; housenumber?: string; street?: string; district?: string; city?: string;
        state?: string; postcode?: string; country?: string;
      } }>;
    };
    const suggestions = (result.features ?? []).flatMap(({ properties }) => {
      if (!properties) return [];
      const title = (properties.name?.trim() || properties.street?.trim() || properties.city?.trim() || properties.state?.trim() || '').slice(0, 120);
      const street = [properties.housenumber, properties.street].filter(Boolean).join(' ').trim();
      const detail = [...new Set([street, properties.district, properties.city, properties.state, properties.postcode, properties.country]
        .map((part) => part?.trim()).filter((part): part is string => Boolean(part && part !== title)))].join(', ').slice(0, 180);
      return title ? [{ title, detail }] : [];
    });
    return c.json({ suggestions, configured: true });
  } catch {
    return c.json({ suggestions: [], configured: true });
  } finally {
    clearTimeout(timeout);
  }
});

eventsRoutes.get('/', async (c) => {
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  if (!validDate(from) || !validDate(to) || from > to)
    throw new HTTPException(422, { message: 'Choose a valid calendar date range.' });
  if (new Date(`${to}T00:00:00+07:00`).getTime() - new Date(`${from}T00:00:00+07:00`).getTime() > 62 * 86400000)
    throw new HTTPException(422, { message: 'Calendar range is too large.' });
  return c.json(await parseEventRows(c, from, to));
});

async function saveEvent(c: HonoContext<AppEnv>, id: string, existing?: CalendarEventRow) {
  const data = eventInput.parse(await c.req.json());
  const startsAt = new Date(data.startsAt).toISOString();
  const endsAt = data.endsAt ? new Date(data.endsAt).toISOString() : null;
  if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime())
    throw new HTTPException(422, { message: 'The end time must be after the start time.' });
  const allowed = new Set(await workspaceSalesEmails(c.env));
  const attendees = [...new Set([...data.attendeeEmails.map((email) => email.trim().toLowerCase()), c.get('email').toLowerCase()])];
  if (attendees.some((email) => !allowed.has(email)))
    throw new HTTPException(422, { message: 'Choose attendees who have access to this workspace.' });
  const effectiveEnd = endsAt ? new Date(endsAt) : new Date(new Date(startsAt).getTime() + 60 * 60000);
  const overlapping = await c.env.DB.prepare(
    `SELECT e.id AS eventId,e.title,e.starts_at AS startsAt,e.ends_at AS endsAt,a.email AS attendeeEmail,
      COALESCE(NULLIF(trim(s.first_name || ' ' || s.last_name),''),a.email) AS attendeeName
     FROM calendar_events e
     JOIN calendar_event_attendees a ON a.event_id=e.id
     LEFT JOIN salespeople s ON s.email=a.email
     WHERE a.email IN (${attendees.map(() => '?').join(',')}) AND e.id<>?
       AND e.starts_at<? AND (e.ends_at IS NULL OR e.ends_at>?)
     ORDER BY e.starts_at`,
  ).bind(...attendees, id, effectiveEnd.toISOString(), startsAt).all<{
    eventId: string; title: string; startsAt: string; endsAt: string | null; attendeeEmail: string; attendeeName: string;
  }>();
  const conflicts = overlapping.results.filter((event) => {
    const existingStart = new Date(event.startsAt).getTime();
    const existingEnd = event.endsAt ? new Date(event.endsAt).getTime() : existingStart + 60 * 60000;
    return existingStart < effectiveEnd.getTime() && existingEnd > new Date(startsAt).getTime();
  });
  if (conflicts.length) {
    return c.json({
      error: {
        code: 'EVENT_CONFLICT',
        message: 'One or more attendees already have another event at this time.',
        conflicts,
      },
    }, 409);
  }
  const now = new Date().toISOString();
  const statements = existing
    ? [
        c.env.DB.prepare('UPDATE calendar_events SET title=?,details=?,location=?,location_place_id=?,location_map_url=?,starts_at=?,ends_at=?,reminder_minutes=?,updated_at=? WHERE id=?')
          .bind(data.title, data.details, data.location, data.locationPlaceId, data.locationMapUrl, startsAt, endsAt, data.reminderMinutes, now, id),
        c.env.DB.prepare('DELETE FROM calendar_event_attendees WHERE event_id=?').bind(id),
        c.env.DB.prepare("DELETE FROM calendar_reminders WHERE event_id=? AND status='pending'").bind(id),
      ]
    : [c.env.DB.prepare('INSERT INTO calendar_events(id,title,details,location,location_place_id,location_map_url,starts_at,ends_at,reminder_minutes,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id, data.title, data.details, data.location, data.locationPlaceId, data.locationMapUrl, startsAt, endsAt, data.reminderMinutes, c.get('email'), now, now)];
  statements.push(...attendees.map((email) => c.env.DB.prepare(
    'INSERT INTO calendar_event_attendees(event_id,email) VALUES(?,?)',
  ).bind(id, email)));
  await c.env.DB.batch(statements);
  return c.json({ ok: true, id }, existing ? 200 : 201);
}

eventsRoutes.post('/', async (c) => saveEvent(c, crypto.randomUUID()));
eventsRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    'SELECT id,title,details,location,location_place_id AS locationPlaceId,location_map_url AS locationMapUrl,starts_at AS startsAt,ends_at AS endsAt,reminder_minutes AS reminderMinutes,created_by AS createdBy,created_at AS createdAt FROM calendar_events WHERE id=?',
  ).bind(id).first<CalendarEventRow>();
  if (!existing) throw new HTTPException(404, { message: 'Calendar event not found.' });
  return saveEvent(c, id, existing);
});
eventsRoutes.delete('/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM calendar_events WHERE id=?').bind(c.req.param('id')).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Calendar event not found.' });
  return c.json({ ok: true });
});

export type CalendarReminder = {
  id: string; event_id: string; email: string; line_user_id: string;
  title: string; location: string; starts_at: string; reminder_minutes: number; attempts: number;
};
export type SendCalendarReminder = (env: Bindings, job: CalendarReminder, message: string) => Promise<{ ok: boolean; retryable: boolean; error?: string }>;

const sendCalendarReminder: SendCalendarReminder = async (env, job, message) => {
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Line-Retry-Key': job.id,
    },
    body: JSON.stringify({ to: job.line_user_id, messages: [{ type: 'text', text: message }] }),
    signal: AbortSignal.timeout(15000),
  });
  const ok = response.ok || (response.status === 409 && !!response.headers.get('x-line-accepted-request-id'));
  return { ok, retryable: response.status === 429 || response.status >= 500, error: ok ? undefined : `LINE_HTTP_${response.status}` };
};

export async function processCalendarReminders(
  env: Bindings,
  time = Date.now(),
  send: SendCalendarReminder = sendCalendarReminder,
) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_CHANNEL_SECRET || !env.APP_URL) return;
  const appUrl = new URL(env.APP_URL);
  if (appUrl.protocol !== 'https:') throw new Error('Invalid application URL');
  const now = new Date(time).toISOString();
  const allowed = new Set(await workspaceSalesEmails(env));
  const upcomingLimit = new Date(time + 8 * 86400000).toISOString();
  await env.DB.prepare(
    `UPDATE calendar_reminders SET status='cancelled',lease_until=NULL WHERE status='pending' AND NOT EXISTS (
      SELECT 1 FROM calendar_events e
      JOIN calendar_event_attendees a ON a.event_id=e.id AND a.email=calendar_reminders.email
      JOIN line_accounts l ON l.email=a.email AND l.line_user_id=calendar_reminders.line_user_id AND l.enabled=1
      WHERE e.id=calendar_reminders.event_id AND e.starts_at=calendar_reminders.starts_at
      AND e.starts_at>? AND e.reminder_minutes=calendar_reminders.reminder_minutes AND e.reminder_minutes>0)`,
  ).bind(now).run();
  const candidates = await env.DB.prepare(
    `SELECT e.id AS eventId,e.title,e.location,e.starts_at AS startsAt,e.reminder_minutes AS reminderMinutes,
      a.email,l.line_user_id AS lineUserId
     FROM calendar_events e JOIN calendar_event_attendees a ON a.event_id=e.id
     JOIN line_accounts l ON l.email=a.email AND l.enabled=1
     WHERE e.starts_at>? AND e.starts_at<=? AND e.reminder_minutes>0`,
  ).bind(now, upcomingLimit).all<{ eventId: string; title: string; location: string; startsAt: string; reminderMinutes: number; email: string; lineUserId: string }>();
  for (const candidate of candidates.results) {
    if (!allowed.has(candidate.email)) continue;
    const remindAt = new Date(new Date(candidate.startsAt).getTime() - candidate.reminderMinutes * 60000).toISOString();
    await env.DB.prepare(
      `INSERT INTO calendar_reminders(id,event_id,email,line_user_id,starts_at,reminder_minutes,remind_at,status,attempts,created_at,next_attempt_at)
       VALUES(?,?,?,?,?,?,?,'pending',0,?,?)
       ON CONFLICT(event_id,email,starts_at,reminder_minutes,line_user_id) DO UPDATE SET
         status='pending',next_attempt_at=excluded.next_attempt_at,lease_until=NULL,last_error=NULL
       WHERE calendar_reminders.status='cancelled' AND calendar_reminders.attempts=0`,
    ).bind(crypto.randomUUID(), candidate.eventId, candidate.email, candidate.lineUserId, candidate.startsAt, candidate.reminderMinutes, remindAt, now, remindAt).run();
  }
  await env.DB.prepare(
    "UPDATE calendar_reminders SET status='failed',lease_until=NULL,last_error='RETRY_LIMIT' WHERE status='pending' AND attempts>=12",
  ).run();
  const jobs = await env.DB.prepare(
    "SELECT r.*,e.title,e.location FROM calendar_reminders r JOIN calendar_events e ON e.id=r.event_id WHERE r.status='pending' AND r.attempts<12 AND r.next_attempt_at<=? AND (r.lease_until IS NULL OR r.lease_until<=?) ORDER BY r.next_attempt_at LIMIT 50",
  ).bind(now, now).all<CalendarReminder>();
  for (const job of jobs.results) {
    if (!allowed.has(job.email)) {
      await env.DB.prepare("UPDATE calendar_reminders SET status='cancelled' WHERE id=?").bind(job.id).run();
      continue;
    }
    const lease = await env.DB.prepare(
      "UPDATE calendar_reminders SET lease_until=?,attempts=attempts+1 WHERE id=? AND status='pending' AND (lease_until IS NULL OR lease_until<=?)",
    ).bind(new Date(time + 120000).toISOString(), job.id, now).run();
    if (!lease.meta.changes) continue;
    const valid = await env.DB.prepare(
      `SELECT e.id FROM calendar_events e
       JOIN calendar_event_attendees a ON a.event_id=e.id AND a.email=?
       JOIN line_accounts l ON l.email=a.email AND l.line_user_id=? AND l.enabled=1
       WHERE e.id=? AND e.starts_at=? AND e.starts_at>? AND e.reminder_minutes=? AND e.reminder_minutes>0`,
    ).bind(job.email, job.line_user_id, job.event_id, job.starts_at, now, job.reminder_minutes).first();
    if (!valid) {
      await env.DB.prepare("UPDATE calendar_reminders SET status='cancelled',lease_until=NULL WHERE id=?").bind(job.id).run();
      continue;
    }
    const when = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(job.starts_at));
    const eventDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(job.starts_at));
    const eventUrl = new URL('/calendar', appUrl);
    eventUrl.searchParams.set('date', eventDay);
    eventUrl.searchParams.set('event', job.event_id);
    const message = `Corevity แจ้งเตือนกิจกรรมทีม\n${job.title}\nเวลา: ${when} (เวลาไทย)${job.location ? `\nสถานที่: ${job.location}` : ''}\nเปิดกิจกรรม: ${eventUrl.toString()}`;
    try {
      const result = await send(env, job, message);
      await env.DB.prepare(
        'UPDATE calendar_reminders SET status=?,sent_at=?,lease_until=NULL,next_attempt_at=?,last_error=? WHERE id=?',
      ).bind(
        result.ok ? 'sent' : result.retryable ? 'pending' : 'failed',
        result.ok ? now : null,
        new Date(time + Math.min(60, 5 * 2 ** job.attempts) * 60000).toISOString(),
        result.error ?? null,
        job.id,
      ).run();
    } catch {
      await env.DB.prepare("UPDATE calendar_reminders SET lease_until=NULL,next_attempt_at=?,last_error='NETWORK_ERROR' WHERE id=?")
        .bind(new Date(time + Math.min(60, 5 * 2 ** job.attempts) * 60000).toISOString(), job.id).run();
    }
  }
}
