-- Soon v1 DB-first: self-heal execution metadata for priority/retry/anomaly context.

ALTER TABLE soon_self_heal_playbook_execution
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1;

ALTER TABLE soon_self_heal_playbook_execution
  ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 0;

ALTER TABLE soon_self_heal_playbook_execution
  ADD COLUMN IF NOT EXISTS retries_used INTEGER NOT NULL DEFAULT 0;

ALTER TABLE soon_self_heal_playbook_execution
  ADD COLUMN IF NOT EXISTS priority_score NUMERIC(10, 2);

ALTER TABLE soon_self_heal_playbook_execution
  ADD COLUMN IF NOT EXISTS retry_backoff_sec INTEGER;

ALTER TABLE soon_self_heal_playbook_execution
  ADD COLUMN IF NOT EXISTS matched_anomaly_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

