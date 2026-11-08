CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
  details TEXT NOT NULL DEFAULT '' CHECK(length(details) <= 4000),
  location TEXT NOT NULL DEFAULT '' CHECK(length(location) <= 240),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  reminder_minutes INTEGER NOT NULL DEFAULT 1440 CHECK(reminder_minutes BETWEEN 0 AND 10080),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX calendar_events_starts_at ON calendar_events(starts_at);

CREATE TABLE calendar_event_attendees (
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  PRIMARY KEY(event_id, email)
);
CREATE INDEX calendar_event_attendees_email ON calendar_event_attendees(email, event_id);

CREATE TABLE calendar_reminders (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  reminder_minutes INTEGER NOT NULL,
  remind_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  sent_at TEXT,
  last_error TEXT,
  UNIQUE(event_id, email, starts_at, reminder_minutes, line_user_id)
);
CREATE INDEX calendar_reminders_pending ON calendar_reminders(status, next_attempt_at);
