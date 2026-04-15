-- Soon v1 cleanup: remove legacy JSON storage table with safety guards.

DO $$
DECLARE
  legacy_exists REGCLASS;
  backup_exists REGCLASS;
  legacy_rows BIGINT;
  new_rows BIGINT;
  backup_rows BIGINT;
BEGIN
  legacy_exists := to_regclass('public.soon_trackings');

  IF legacy_exists IS NULL THEN
    RAISE NOTICE 'Legacy table soon_trackings not found; cleanup skipped.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO new_rows FROM soon_tracking;
  IF new_rows = 0 THEN
    RAISE EXCEPTION 'Refusing cleanup: soon_tracking is empty (no DB-first data).';
  END IF;

  SELECT COUNT(*) INTO legacy_rows FROM soon_trackings;

  backup_exists := to_regclass('public.soon_trackings_legacy_backup');

  IF backup_exists IS NULL THEN
    EXECUTE 'CREATE TABLE soon_trackings_legacy_backup AS TABLE soon_trackings WITH DATA';
  ELSE
    EXECUTE 'SELECT COUNT(*) FROM soon_trackings_legacy_backup' INTO backup_rows;
    IF backup_rows = 0 AND legacy_rows > 0 THEN
      EXECUTE 'INSERT INTO soon_trackings_legacy_backup SELECT * FROM soon_trackings';
    END IF;
  END IF;

  SELECT COUNT(*) INTO backup_rows FROM soon_trackings_legacy_backup;
  IF backup_rows < legacy_rows THEN
    RAISE EXCEPTION
      'Refusing cleanup: backup rows (%) < legacy rows (%)',
      backup_rows,
      legacy_rows;
  END IF;

  EXECUTE 'DROP TABLE soon_trackings';

  RAISE NOTICE 'Legacy table soon_trackings dropped safely. Backup rows: %', backup_rows;
END
$$;
