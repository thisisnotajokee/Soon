-- Soon v1 DB-first: audit table for manual dead-letter requeue actions.

CREATE TABLE IF NOT EXISTS soon_self_heal_requeue_audit (
  id BIGSERIAL PRIMARY KEY,
  dead_letter_id BIGINT REFERENCES soon_self_heal_dead_letter(id) ON DELETE SET NULL,
  queue_id BIGINT REFERENCES soon_self_heal_retry_queue(id) ON DELETE SET NULL,
  run_id TEXT,
  source TEXT NOT NULL DEFAULT 'self-heal-worker-v1',
  playbook_id TEXT,
  reason TEXT NOT NULL DEFAULT 'manual_requeue',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soon_self_heal_requeue_audit_created_at
  ON soon_self_heal_requeue_audit (created_at DESC);
