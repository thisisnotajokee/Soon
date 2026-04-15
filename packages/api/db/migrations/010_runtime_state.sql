-- Soon v1 DB-first: runtime key/value state for operational guardrails.

CREATE TABLE IF NOT EXISTS soon_runtime_state (
  state_key TEXT PRIMARY KEY,
  state_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soon_runtime_state_updated_at
  ON soon_runtime_state (updated_at DESC);
