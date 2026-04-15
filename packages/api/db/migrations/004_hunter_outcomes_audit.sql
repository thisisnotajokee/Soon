-- Soon v1 DB-first: hunter outcomes + alert dispatch audit.

CREATE TABLE IF NOT EXISTS soon_hunter_run (
  run_id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'automation-cycle-v1',
  status TEXT NOT NULL DEFAULT 'ok',
  tracking_count INTEGER NOT NULL,
  decision_count INTEGER NOT NULL,
  alert_count INTEGER NOT NULL,
  purchase_alert_count INTEGER NOT NULL,
  technical_alert_count INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soon_hunter_run_started_at
  ON soon_hunter_run (started_at DESC);

CREATE TABLE IF NOT EXISTS soon_hunter_decision (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES soon_hunter_run(run_id) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  score NUMERIC(8, 2) NOT NULL,
  confidence NUMERIC(8, 3) NOT NULL,
  should_alert BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  token_cost NUMERIC(10, 2),
  expected_value NUMERIC(12, 2),
  token_priority NUMERIC(12, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soon_hunter_decision_run_id
  ON soon_hunter_decision (run_id);

CREATE TABLE IF NOT EXISTS soon_alert_dispatch_audit (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES soon_hunter_run(run_id) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('purchase', 'technical')),
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'discord')),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soon_alert_dispatch_audit_run_id
  ON soon_alert_dispatch_audit (run_id);
