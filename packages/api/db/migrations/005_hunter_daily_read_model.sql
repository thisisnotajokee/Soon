-- Soon v1 DB-first: daily read model for automation dashboard.

CREATE TABLE IF NOT EXISTS soon_hunter_run_daily (
  day DATE PRIMARY KEY,
  runs INTEGER NOT NULL,
  tracking_count_sum INTEGER NOT NULL,
  decision_count_sum INTEGER NOT NULL,
  alert_count_sum INTEGER NOT NULL,
  purchase_alert_count_sum INTEGER NOT NULL,
  technical_alert_count_sum INTEGER NOT NULL,
  telegram_alert_count_sum INTEGER NOT NULL DEFAULT 0,
  discord_alert_count_sum INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS soon_hunter_run_daily_asin (
  day DATE NOT NULL REFERENCES soon_hunter_run_daily(day) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  alert_count INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, asin)
);

CREATE INDEX IF NOT EXISTS idx_soon_hunter_run_daily_day_desc
  ON soon_hunter_run_daily (day DESC);

CREATE INDEX IF NOT EXISTS idx_soon_hunter_run_daily_asin_day_alert
  ON soon_hunter_run_daily_asin (day DESC, alert_count DESC, asin ASC);
