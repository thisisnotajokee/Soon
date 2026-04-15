-- Soon v1 DB-first: async retry queue + dead-letter for self-heal playbooks.

CREATE TABLE IF NOT EXISTS soon_self_heal_retry_queue (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES soon_self_heal_run(run_id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'self-heal-worker-v1',
  playbook_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'done', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  max_retries INTEGER NOT NULL DEFAULT 0,
  retries_used INTEGER NOT NULL DEFAULT 0,
  retry_backoff_sec INTEGER NOT NULL DEFAULT 0,
  priority_score NUMERIC(10, 2),
  matched_anomaly_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  next_retry_at TIMESTAMPTZ NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soon_self_heal_retry_queue_due
  ON soon_self_heal_retry_queue (status, next_retry_at ASC, priority_score DESC);

CREATE TABLE IF NOT EXISTS soon_self_heal_dead_letter (
  id BIGSERIAL PRIMARY KEY,
  queue_id BIGINT REFERENCES soon_self_heal_retry_queue(id) ON DELETE SET NULL,
  run_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'self-heal-worker-v1',
  playbook_id TEXT NOT NULL,
  final_attempt_count INTEGER NOT NULL,
  max_retries INTEGER NOT NULL,
  reason TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soon_self_heal_dead_letter_created_at
  ON soon_self_heal_dead_letter (created_at DESC);

