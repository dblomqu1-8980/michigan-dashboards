-- Aurora alert subscribers, one row per (email, region) pair so somebody can
-- subscribe to both dashboards independently.
--
-- status:
--   pending      signed up, confirmation email sent, NOT yet mailable
--   active       clicked the confirm link — the only status that gets alerts
--   unsubscribed clicked unsubscribe; row is kept so a resubscribe is auditable
CREATE TABLE IF NOT EXISTS subscribers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL,
  region          TEXT NOT NULL CHECK (region IN ('up','nlp')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','unsubscribed')),
  token           TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL,
  confirmed_at    TEXT,
  unsubscribed_at TEXT,
  UNIQUE (email, region)
);
CREATE INDEX IF NOT EXISTS idx_sub_region_status ON subscribers (region, status);
CREATE INDEX IF NOT EXISTS idx_sub_token         ON subscribers (token);

-- One row per alert actually sent. Doubles as the de-duplication record: the
-- cron refuses to send again for a region within ALERT_COOLDOWN_HOURS, so a
-- three-night storm produces three emails, not thirty.
CREATE TABLE IF NOT EXISTS alert_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  region     TEXT NOT NULL,
  sent_at    TEXT NOT NULL,
  kp         REAL,
  best_spot  TEXT,
  best_cloud INTEGER,
  recipients INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alert_region_time ON alert_log (region, sent_at DESC);
