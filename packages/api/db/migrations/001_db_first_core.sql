-- Soon v1 DB-first core schema

CREATE TABLE IF NOT EXISTS soon_schema_migration (
  migration_id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS soon_tracking (
  asin TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS soon_tracking_threshold (
  asin TEXT PRIMARY KEY REFERENCES soon_tracking(asin) ON DELETE CASCADE,
  threshold_drop_pct NUMERIC(8, 2),
  threshold_rise_pct NUMERIC(8, 2),
  target_price_new NUMERIC(12, 2),
  target_price_used NUMERIC(12, 2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS soon_tracking_price (
  asin TEXT NOT NULL REFERENCES soon_tracking(asin) ON DELETE CASCADE,
  market TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('new', 'used')),
  price NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (asin, market, condition)
);

CREATE INDEX IF NOT EXISTS idx_soon_tracking_price_asin ON soon_tracking_price (asin);

CREATE TABLE IF NOT EXISTS soon_price_history (
  id BIGSERIAL PRIMARY KEY,
  asin TEXT NOT NULL REFERENCES soon_tracking(asin) ON DELETE CASCADE,
  market TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('new', 'used')),
  price NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soon_price_history_asin_recorded_at
  ON soon_price_history (asin, recorded_at DESC);
