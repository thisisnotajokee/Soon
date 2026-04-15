# DB Model V1 (Soon)

Cel: relacyjny model danych dla v1 bez długoterminowego trzymania payloadów JSON.

## Tabele

1. `soon_tracking`
- `asin` (PK)
- `title`
- `created_at`
- `updated_at`

2. `soon_tracking_threshold`
- `asin` (PK, FK -> `soon_tracking`)
- `threshold_drop_pct`
- `threshold_rise_pct`
- `target_price_new`
- `target_price_used`
- `updated_at`

3. `soon_tracking_price`
- `asin` (FK -> `soon_tracking`)
- `market`
- `condition` (`new` | `used`)
- `price`
- `currency`
- `updated_at`
- PK: (`asin`, `market`, `condition`)

4. `soon_price_history`
- `id` (PK)
- `asin` (FK -> `soon_tracking`)
- `market`
- `condition` (`new` | `used`)
- `price`
- `currency`
- `recorded_at`

5. `soon_schema_migration`
- `migration_id` (PK)
- `applied_at`

6. `soon_hunter_run`
- `run_id` (PK)
- `source`
- `status`
- `tracking_count`
- `decision_count`
- `alert_count`
- `purchase_alert_count`
- `technical_alert_count`
- `started_at`
- `finished_at`
- `created_at`

7. `soon_hunter_decision`
- `id` (PK)
- `run_id` (FK -> `soon_hunter_run`)
- `asin`
- `score`
- `confidence`
- `should_alert`
- `reason`
- `token_cost`
- `expected_value`
- `token_priority`
- `created_at`

8. `soon_alert_dispatch_audit`
- `id` (PK)
- `run_id` (FK -> `soon_hunter_run`)
- `asin`
- `kind` (`purchase` | `technical`)
- `channel` (`telegram` | `discord`)
- `reason`
- `status`
- `created_at`

9. `soon_maintenance_event`
- `id` (PK)
- `event_type`
- `dry_run`
- `retention_days`
- `eligible_rows`
- `deleted_rows`
- `context`
- `created_at`

10. `soon_hunter_run_daily`
- `day` (PK)
- `runs`
- `tracking_count_sum`
- `decision_count_sum`
- `alert_count_sum`
- `purchase_alert_count_sum`
- `technical_alert_count_sum`
- `telegram_alert_count_sum`
- `discord_alert_count_sum`
- `updated_at`

11. `soon_hunter_run_daily_asin`
- `day` (FK -> `soon_hunter_run_daily`)
- `asin`
- `alert_count`
- `updated_at`
- PK: (`day`, `asin`)

12. `soon_trackings_legacy_backup` (techniczna tabela przejściowa)
- backup usuniętej tabeli legacy `soon_trackings`
- tworzona przez migrację cleanup `002_cleanup_legacy_json.sql`

## Zasady modelu

1. Jeden rekord trackingu na ASIN (`soon_tracking`).
2. Ceny per rynek i condition w osobnych rekordach (`soon_tracking_price`).
3. Progi alertowe wydzielone od cen (`soon_tracking_threshold`).
4. Historia cen append-only (`soon_price_history`).
5. Migracje SQL jako source-of-truth schematu (`db/migrations`).
6. Legacy cleanup tylko przez migrację z guardem + backup.
7. Wyniki i decyzje cyklu Huntera są zapisywane relacyjnie per run (`soon_hunter_*`).
8. Routing alertów ma audyt per zdarzenie (`soon_alert_dispatch_audit`).
9. Dashboard operacyjny korzysta z read-modelu dziennego (`soon_hunter_run_daily*`).
