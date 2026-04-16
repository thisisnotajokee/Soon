CREATE TABLE IF NOT EXISTS soon_token_daily_budget_ledger (
  day DATE PRIMARY KEY,
  budget_tokens NUMERIC NOT NULL CHECK (budget_tokens > 0),
  consumed_tokens NUMERIC NOT NULL DEFAULT 0 CHECK (consumed_tokens >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soon_token_daily_budget_updated_at
  ON soon_token_daily_budget_ledger (updated_at DESC);
