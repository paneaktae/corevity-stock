import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink, MapPin, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { api, ApiError, useData, useDebounce } from '../lib';
import { t, useLanguage } from '../i18n';
import type { Salesperson } from '../../shared/schemas';
import { salespersonName } from '../../shared/schemas';
import { extractGoogleMapsUrl, isGoogleMapsEmbedUrl } from '../../shared/google-maps';
import { ErrorBox, Field, Header } from '../components/ui';
import { thaiHoliday } from '../thaiHolidays';

type CalendarAttendee = { email: string; name: string; lineReady: boolean };
type CalendarConflict = { eventId: string; title: string; startsAt: string; endsAt: string | null; attendeeEmail: string; attendeeName: string };
type CalendarEvent = {
  id: string;
  title: string;
  details: string;
  location: string;
  locationPlaceId: string;
  locationMapUrl: string;
  startsAt: string;
  endsAt: string | null;
  reminderMinutes: number;
  reminderDelivery: { sentCount: number; sentAt: string | null } | null;
  createdBy: string;
  createdAt: string;
  attendees: CalendarAttendee[];
};
type EventDraft = {
  title: string;
  details: string;
  location: string;
  locationPlaceId: string;
  locationMapUrl: string;
  startsAt: string;
  endsAt: string;
  reminderMinutes: string;
  attendeeEmails: string[];
};

const pad = (value: number) => String(value).padStart(2, '0');
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const startOfGrid = (month: Date) => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return first;
};
const bangkokDayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(iso));
function validDayKey(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? value : '';
}
function calendarLinkTarget() {
  const params = new URLSearchParams(window.location.search);
  const date = validDayKey(params.get('date')) || dayKey(new Date());
  const [year, month] = date.split('-').map(Number);
  return { date, month: new Date(year, month - 1, 1), eventId: params.get('event') ?? '' };
}
const timeLabel = (iso: string) => new Intl.DateTimeFormat(undefined, {
  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok', hour12: false,
}).format(new Date(iso));
const dateTimeLabel = (iso: string, language: string) => new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
}).format(new Date(iso));
function localInput(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}
function eventDraft(day = new Date()): EventDraft {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
  const now = new Date();
  if (dayKey(day) === dayKey(now) && start <= now)
    start.setHours(now.getHours() + 1, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60000);
  return { title: '', details: '', location: '', locationPlaceId: '', locationMapUrl: '', startsAt: localInput(start), endsAt: localInput(end), reminderMinutes: '1440', attendeeEmails: [] };
}
function monthTitle(value: Date, language: string) {
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-US', { month: 'long', year: 'numeric' }).format(value);
}
function dayTitle(value: string, language: string) {
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(`${value}T12:00:00+07:00`));
}

function EventLocationField({ value, language, onChange }: { value: string; language: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState('');
  const debouncedQuery = useDebounce(query.trim());
  const path = debouncedQuery.length >= 3
    ? `/calendar/locations?q=${encodeURIComponent(debouncedQuery)}&lang=${language}`
    : null;
  const { data } = useData<{ suggestions: Array<{ title: string; detail: string }>; configured: boolean }>(path);

  return <div className="field calendar-location-field">
    <span>{t('Event location')}</span>
    <div className="calendar-location-control">
      <Search size={17} aria-hidden="true" />
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={focused && Boolean(data?.suggestions.length)}
        aria-controls="calendar-location-suggestions"
        autoComplete="off"
        maxLength={240}
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onChange={(event) => { onChange(event.target.value); setSelectedLocation(''); setQuery(event.target.value); }}
      />
      {focused && data?.suggestions.length ? <div className="calendar-location-suggestions" id="calendar-location-suggestions" role="listbox">
        {data.suggestions.map((item) => <button
          type="button"
          role="option"
          aria-selected="false"
          key={`${item.title}-${item.detail}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { const selectedLabel = [item.title, item.detail].filter(Boolean).join(', '); onChange(selectedLabel); setSelectedLocation(selectedLabel); setQuery(''); setFocused(false); }}
        ><MapPin size={15} /><span className="calendar-location-result-copy"><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span></button>)}
        <small className="calendar-location-attribution">Search by <a href="https://github.com/komoot/photon" target="_blank" rel="noopener noreferrer">Photon</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></small>
      </div> : null}
    </div>
    {selectedLocation ? <small className="calendar-location-selected">{t('Location selected')}: {selectedLocation}</small> : <small className="calendar-location-credit">{t('Search for a place or enter a location manually.')}</small>}
    <small className="calendar-location-credit">Search by <a href="https://github.com/komoot/photon" target="_blank" rel="noopener noreferrer">Photon</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></small>
  </div>;
}

function isGoogleMapsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    return ((url.hostname === 'www.google.com' || url.hostname === 'maps.google.com') && url.pathname.startsWith('/maps/'))
      || (url.hostname === 'maps.app.goo.gl' && url.pathname.length > 1);
  } catch {
    return false;
  }
}

export function CalendarPage() {
  const language = useLanguage();
  const [linkTarget] = useState(calendarLinkTarget);
  const [month, setMonth] = useState(() => linkTarget.month);
  const [selectedDay, setSelectedDay] = useState(() => linkTarget.date);
  const [focusedEventId, setFocusedEventId] = useState(() => linkTarget.eventId);
  const focusedEventRef = useRef<HTMLElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState<CalendarConflict[]>([]);
  const [notice, setNotice] = useState('');
  const gridStart = useMemo(() => startOfGrid(month), [month]);
  const days = useMemo(() => Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(day.getDate() + index);
    return day;
  }), [gridStart]);
  const eventsPath = `/calendar?from=${dayKey(days[0])}&to=${dayKey(days[41])}`;
  const { data: events, error: eventsError, reload } = useData<CalendarEvent[]>(eventsPath);
  const { data: team } = useData<Salesperson[]>('/salespeople');
  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of events ?? []) {
      const key = bangkokDayKey(event.startsAt);
      grouped.set(key, [...(grouped.get(key) ?? []), event]);
    }
    return grouped;
  }, [events]);
  const selectedEvents = eventsByDay.get(selectedDay) ?? [];
  const selectedHoliday = thaiHoliday(selectedDay);
  const weekdays = language === 'th'
    ? ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  useEffect(() => {
    if (!focusedEventId || !focusedEventRef.current) return;
    const timeout = window.setTimeout(() => focusedEventRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    return () => window.clearTimeout(timeout);
  }, [focusedEventId, events]);

  function openNew(day = new Date()) {
    setEditingId(null);
    setDraft(eventDraft(day));
    setError('');
    setConflicts([]);
    setNotice('');
  }
  function openEdit(event: CalendarEvent) {
    setEditingId(event.id);
    setDraft({
      title: event.title,
      details: event.details,
      location: event.location,
      locationPlaceId: event.locationPlaceId ?? '',
      locationMapUrl: event.locationMapUrl ?? '',
      startsAt: localInput(new Date(event.startsAt)),
      endsAt: event.endsAt ? localInput(new Date(event.endsAt)) : '',
      reminderMinutes: String(event.reminderMinutes),
      attendeeEmails: event.attendees.map((attendee) => attendee.email),
    });
    setError('');
    setConflicts([]);
    setNotice('');
  }
  async function saveEvent(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError('');
    setConflicts([]);
    try {
      const body = {
        ...draft,
        startsAt: new Date(draft.startsAt).toISOString(),
        endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
        reminderMinutes: Number(draft.reminderMinutes),
      };
      await api(`/calendar${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      reload();
      setDraft(null);
      setNotice(t('Event saved.'));
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'EVENT_CONFLICT') {
        setConflicts(reason.conflicts);
        setError(t('Please resolve the schedule conflict before saving.'));
      } else {
        setError((reason as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }
  async function deleteEvent() {
    if (!editingId || !confirm(t('Delete this event?'))) return;
    setSaving(true);
    setError('');
    try {
      await api(`/calendar/${editingId}`, { method: 'DELETE' });
      reload();
      setDraft(null);
      setEditingId(null);
      setNotice(t('Event deleted.'));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function toggleAttendee(email: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      attendeeEmails: draft.attendeeEmails.includes(email)
        ? draft.attendeeEmails.filter((item) => item !== email)
        : [...draft.attendeeEmails, email],
    });
  }
  function shiftMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDay(dayKey(next));
    setFocusedEventId('');
  }

  return (
    <>
      <Header
        title={t('Calendar & reminders')}
        subtitle={t('Track team events and notify invited teammates on LINE.')}
        action={<button className="primary" type="button" onClick={() => openNew()}><Plus size={17} />{t('Add event')}</button>}
      />
      {notice && <p className="success calendar-notice" role="status">{notice}</p>}
      <ErrorBox message={error || eventsError} />
      {draft && <section className="panel calendar-editor">
        <div className="section-heading">
          <div className="calendar-editor-title"><span className="calendar-icon"><CalendarDays size={19} /></span><div><h2>{t(editingId ? 'Edit event' : 'New event')}</h2><p className="muted">{t('Invited teammates receive a LINE reminder if they have connected their account.')}</p></div></div>
          <button type="button" onClick={() => setDraft(null)}>{t('Cancel')}</button>
        </div>
        <form onSubmit={(e) => void saveEvent(e)}>
          {conflicts.length > 0 && <div className="calendar-conflict-alert" role="alert">
            <strong>{t('Schedule conflict')}</strong>
            <p>{t('The same teammate is already included in another event at this time.')}</p>
            <ul>{conflicts.map((conflict) => <li key={`${conflict.eventId}-${conflict.attendeeEmail}`}>
              <strong>{conflict.attendeeName}</strong> · {conflict.title} · {dateTimeLabel(conflict.startsAt, language)}{conflict.endsAt ? ` – ${timeLabel(conflict.endsAt)}` : ''}
            </li>)}</ul>
          </div>}
          <div className="form-grid calendar-form-grid">
            <Field label={t('Event title *')}><input autoFocus required maxLength={160} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
            <EventLocationField language={language} value={draft.location} onChange={(location) => setDraft((current) => current ? { ...current, location, locationPlaceId: '' } : current)} />
            <Field label={t('Google Maps link')}>
              <div className="calendar-google-map-input-row">
                <input type="text" inputMode="url" autoComplete="off" spellCheck={false} maxLength={10000} placeholder={t('Paste a Google Maps link or full iframe code')} value={draft.locationMapUrl} onChange={(e) => setDraft({ ...draft, locationMapUrl: e.target.value })} onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text');
                  if (/<iframe\b/i.test(pasted)) {
                    e.preventDefault();
                    setDraft({ ...draft, locationMapUrl: extractGoogleMapsUrl(pasted) });
                  }
                }} />
                <a className="button secondary calendar-google-map-search" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(draft.location || draft.title)}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />{t('Open Google Maps')}</a>
              </div>
              <small className="calendar-location-credit">{t('Copy the full iframe code from Google Maps → Share → Embed a map and paste it here.')}</small>
            </Field>
            <Field label={t('Starts *')}><input type="datetime-local" required value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} /></Field>
            <Field label={t('Ends')}><input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} /></Field>
            <Field label={t('LINE reminder')}>
              <select value={draft.reminderMinutes} onChange={(e) => setDraft({ ...draft, reminderMinutes: e.target.value })}>
                <option value="0">{t('No reminder')}</option>
                <option value="10">{t('10 minutes before')}</option>
                <option value="30">{t('30 minutes before')}</option>
                <option value="60">{t('1 hour before')}</option>
                <option value="1440">{t('1 day before')}</option>
                <option value="10080">{t('1 week before')}</option>
              </select>
            </Field>
            <Field label={t('Event details')}><textarea rows={3} maxLength={4000} value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} /></Field>
          </div>
          <div className="calendar-attendees">
            <div className="calendar-subheading"><Users size={17} /><strong>{t('Invite teammates')}</strong><span>{t('You are included automatically.')}</span></div>
            <div className="calendar-team-list">
              {(team ?? []).map((person) => <label className="calendar-person" key={person.email}>
                <input type="checkbox" checked={draft.attendeeEmails.includes(person.email)} onChange={() => toggleAttendee(person.email)} />
                <span className="calendar-person-name">{salespersonName(person)}</span>
                <small>{person.email}</small>
                <span className={person.lineReady ? 'calendar-line-state ready' : 'calendar-line-state'}>{person.lineReady ? t('LINE ready') : t('LINE not connected')}</span>
              </label>)}
            </div>
          </div>
          <div className="button-row">
            <button className="primary" disabled={saving}>{saving ? t('Saving…') : t('Save event')}</button>
            {editingId && <button className="danger calendar-delete" type="button" disabled={saving} onClick={() => void deleteEvent()}><Trash2 size={15} />{t('Delete event')}</button>}
          </div>
        </form>
      </section>}
      <section className="panel calendar-panel">
        <div className="calendar-month-toolbar">
          <div><span className="calendar-icon"><CalendarDays size={19} /></span><h2>{monthTitle(month, language)}</h2></div>
          <div className="calendar-month-actions">
            <button type="button" onClick={() => { const today = new Date(); setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDay(dayKey(today)); setFocusedEventId(''); }}>{t('Today')}</button>
            <button type="button" aria-label={t('Previous month')} onClick={() => shiftMonth(-1)}><ChevronLeft size={18} /></button>
            <button type="button" aria-label={t('Next month')} onClick={() => shiftMonth(1)}><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="calendar-legend" aria-label={t('Calendar legend')}>
          <span><i className="calendar-legend-weekend" />{t('Weekend')}</span>
          <span><i className="calendar-legend-holiday" />{t('Thai public holiday')}</span>
          <span><i className="calendar-legend-event" />{t('Event')}</span>
        </div>
        <div className="calendar-weekdays">{weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
        <div className="calendar-month-grid">
          {days.map((day) => {
            const key = dayKey(day);
            const dayEvents = eventsByDay.get(key) ?? [];
            const holiday = thaiHoliday(key);
            const today = key === dayKey(new Date());
            const weekday = day.getDay();
            const weekend = weekday === 0 || weekday === 6;
            const eventTitles = dayEvents.map((event) => `${timeLabel(event.startsAt)} ${event.title}`);
            const accessibleDate = [dayTitle(key, language), holiday ? (language === 'th' ? holiday.th : holiday.en) : '', ...eventTitles].filter(Boolean).join(' · ');
            return <button type="button" aria-label={accessibleDate} title={accessibleDate} className={`calendar-day${day.getMonth() !== month.getMonth() ? ' outside' : ''}${weekend ? ' weekend' : ''}${weekday === 6 ? ' saturday' : ''}${weekday === 0 ? ' sunday' : ''}${holiday ? ' holiday' : ''}${dayEvents.length > 0 ? ' has-events' : ''}${selectedDay === key ? ' selected' : ''}${today ? ' today' : ''}`} key={key} onClick={() => { setSelectedDay(key); setFocusedEventId(''); }}>
              <span className="calendar-day-number">{day.getDate()}</span>
              {holiday && <span className="calendar-day-holiday">{language === 'th' ? holiday.th : holiday.en}</span>}
              {dayEvents.map((event) => <span className="calendar-day-event" key={event.id}><strong>{timeLabel(event.startsAt)}</strong>{event.title}</span>)}
            </button>;
          })}
        </div>
      </section>
      <section className="panel calendar-agenda">
        <div className="section-heading"><div><h2>{dayTitle(selectedDay, language)}</h2><p className="muted">{selectedHoliday ? <span className="calendar-agenda-holiday">{language === 'th' ? selectedHoliday.th : selectedHoliday.en}</span> : t('Team events')}</p></div><button type="button" onClick={() => openNew(new Date(`${selectedDay}T12:00:00`))}><Plus size={16} />{t('Add event')}</button></div>
        {!events ? <p className="muted">{t('Loading…')}</p> : selectedEvents.length === 0 ? <div className="calendar-empty"><CalendarDays size={23} /><span>{t('No events on this day.')}</span></div> : <div className="calendar-event-list">
          {selectedEvents.map((event) => <article ref={event.id === focusedEventId ? focusedEventRef : undefined} className={`calendar-event-card${event.id === focusedEventId ? ' is-focused' : ''}`} key={event.id}>
            <div className="calendar-event-time"><strong>{timeLabel(event.startsAt)}</strong>{event.endsAt && <span>{t('to')} {timeLabel(event.endsAt)}</span>}</div>
            <div className="calendar-event-main"><h3>{event.title}</h3>{event.details && <p>{event.details}</p>}<div className="calendar-event-meta">
              {event.location && <span><MapPin size={14} />{event.location}</span>}
              {event.locationMapUrl && isGoogleMapsUrl(event.locationMapUrl) && <a className="calendar-map-link" href={event.locationMapUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />{t('Open in Google Maps')}</a>}
              <span><Users size={14} />{event.attendees.length} {t('attendees')}</span>
              {event.reminderMinutes > 0 && <span><Clock3 size={14} />{t('LINE reminder')}: {t(reminderLabel(event.reminderMinutes))}</span>}
              {event.reminderDelivery?.sentAt && <span className="calendar-reminder-sent"><CheckCircle2 size={14} />{t('LINE reminder sent')} ({event.reminderDelivery.sentCount}) · {dateTimeLabel(event.reminderDelivery.sentAt, language)}</span>}
            </div>{event.locationMapUrl && isGoogleMapsEmbedUrl(event.locationMapUrl) && <details className="calendar-event-map"><summary>{t('View embedded map')}</summary><iframe src={event.locationMapUrl} title={`${t('Map for event')}: ${event.title}`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></details>}<div className="calendar-attendee-chips">{event.attendees.map((attendee) => <span key={attendee.email} title={attendee.email}>{attendee.name}{attendee.lineReady && <i aria-label={t('LINE ready')} />}</span>)}</div></div>
            <button type="button" className="icon-button calendar-edit-button" aria-label={`${t('Edit event')}: ${event.title}`} onClick={() => openEdit(event)}><Pencil size={16} /></button>
          </article>)}
        </div>}
      </section>
    </>
  );
}

function reminderLabel(minutes: number) {
  if (minutes >= 10080) return '1 week before';
  if (minutes >= 1440) return '1 day before';
  if (minutes >= 60) return '1 hour before';
  return `${minutes} minutes before`;
}
