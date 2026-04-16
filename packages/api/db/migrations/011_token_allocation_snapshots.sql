CREATE TABLE IF NOT EXISTS soon_token_allocation_snapshot (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NULL,
  budget_mode TEXT NOT NULL,
  budget_tokens NUMERIC NULL,
  requested_count INTEGER NOT NULL,
  selected_count INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL,
  total_token_cost_selected NUMERIC NOT NULL,
  remaining_budget_tokens NUMERIC NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS soon_token_allocation_snapshot_item (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL REFERENCES soon_token_allocation_snapshot(id) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  expected_value NUMERIC NOT NULL,
  confidence NUMERIC NOT NULL,
  token_cost NUMERIC NOT NULL,
  priority NUMERIC NOT NULL,
  selected BOOLEAN NOT NULL,
  skip_reason TEXT NULL,
  remaining_budget_after NUMERIC NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soon_token_snapshot_created_at
  ON soon_token_allocation_snapshot (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_soon_token_snapshot_item_snapshot_id
  ON soon_token_allocation_snapshot_item (snapshot_id, id);
