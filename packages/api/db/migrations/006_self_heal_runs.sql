-- Soon v1 DB-first: self-heal run history + executed playbooks audit.

CREATE TABLE IF NOT EXISTS soon_self_heal_run (
  run_id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'self-heal-worker-v1',
  status TEXT NOT NULL DEFAULT 'ok',
  playbook_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soon_self_heal_run_started_at
  ON soon_self_heal_run (started_at DESC);

CREATE TABLE IF NOT EXISTS soon_self_heal_playbook_execution (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES soon_self_heal_run(run_id) ON DELETE CASCADE,
  playbook_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soon_self_heal_playbook_execution_run_id
  ON soon_self_heal_playbook_execution (run_id);

