-- One row per Gmail sync run (cron or "Check now") so a missed email can be traced.
-- Holds counts and error codes only: never sender, subject or body. Pruned after 14 days.
CREATE TABLE gmail_sync_log (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  trigger TEXT NOT NULL CHECK(trigger IN ('cron','manual')),
  status TEXT NOT NULL CHECK(status IN ('ok','error','reconnect')),
  mode TEXT NOT NULL DEFAULT '',
  imported INTEGER NOT NULL DEFAULT 0,
  customers INTEGER NOT NULL DEFAULT 0,
  alerts_queued INTEGER NOT NULL DEFAULT 0,
  api_calls INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX gmail_sync_log_started ON gmail_sync_log(started_at DESC);
