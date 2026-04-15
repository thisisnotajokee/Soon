-- Soon v1 retention policy for legacy backup table.

CREATE TABLE IF NOT EXISTS soon_maintenance_event (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('public.soon_trackings_legacy_backup') IS NULL THEN
    CREATE TABLE soon_trackings_legacy_backup (
      asin TEXT PRIMARY KEY,
      payload JSONB,
      updated_at TIMESTAMPTZ,
      backup_copied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      backup_source_table TEXT NOT NULL DEFAULT 'soon_trackings'
    );
  END IF;
END
$$;

ALTER TABLE soon_trackings_legacy_backup
  ADD COLUMN IF NOT EXISTS backup_copied_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE soon_trackings_legacy_backup
  ADD COLUMN IF NOT EXISTS backup_source_table TEXT NOT NULL DEFAULT 'soon_trackings';

CREATE INDEX IF NOT EXISTS idx_soon_legacy_backup_copied_at
  ON soon_trackings_legacy_backup (backup_copied_at);

CREATE OR REPLACE FUNCTION soon_cleanup_legacy_backup(
  p_retention_days INTEGER,
  p_execute BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  retention_days INTEGER,
  cutoff TIMESTAMPTZ,
  eligible_rows BIGINT,
  deleted_rows BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_eligible BIGINT := 0;
  v_deleted BIGINT := 0;
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 1 OR p_retention_days > 3650 THEN
    RAISE EXCEPTION 'retention_days must be in range 1..3650';
  END IF;

  v_cutoff := now() - make_interval(days => p_retention_days);

  SELECT COUNT(*) INTO v_eligible
  FROM soon_trackings_legacy_backup
  WHERE backup_copied_at < v_cutoff;

  IF p_execute AND v_eligible > 0 THEN
    DELETE FROM soon_trackings_legacy_backup
    WHERE backup_copied_at < v_cutoff;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  INSERT INTO soon_maintenance_event (event_type, details)
  VALUES (
    CASE WHEN p_execute THEN 'legacy_backup_cleanup_execute' ELSE 'legacy_backup_cleanup_preview' END,
    jsonb_build_object(
      'retention_days', p_retention_days,
      'cutoff', v_cutoff,
      'eligible_rows', v_eligible,
      'deleted_rows', v_deleted
    )
  );

  RETURN QUERY
  SELECT p_retention_days, v_cutoff, v_eligible, v_deleted;
END;
$$;
