# packages/api

Minimalny runtime API v1 dla projektu `Soon`.

## Szybki start

1. `npm run dev:api` (domyślnie store in-memory)
2. `npm run dev:api:postgres` (store PostgreSQL)
3. `npm run db:migrate` (migracje DB-first)
4. `npm run test:contracts`

## Endpointy v1 (MVP)

1. `GET /health`
2. `GET /trackings`
3. `GET /products/:asin/detail`
4. `POST /trackings/:asin/thresholds`
5. `POST /automation/cycle`
6. `GET /automation/runs/latest?limit=20`
7. `GET /automation/runs/summary?limit=20`
8. `GET /automation/runs/trends?days=30` (`24h`, `7d`, `30d`, source: daily read-model)
9. `GET /automation/runs/daily?days=30` (read-model dzienny dashboardu)
10. `GET /automation/read-model/status` (diagnostyka kolejki refreshu)
11. `GET /metrics` (Prometheus/OpenTelemetry scrape endpoint)
12. `POST /self-heal/run` (manualny trigger cyklu self-heal; anomalies + scoring priorytetów + retry policy)
13. `GET /self-heal/runs/latest?limit=20` (historia self-heal runów; `playbookId + status + attempts/retries`)
14. `POST /self-heal/retry/process` (ręczne przetworzenie due retry queue; body: `limit`, opcjonalnie `now`)
15. `GET /self-heal/retry/status` (stan kolejki retry + dead-letter)
16. `GET /self-heal/dead-letter?limit=20` (najnowsze wpisy dead-letter)
17. `POST /self-heal/dead-letter/requeue` (ręczne przywrócenie dead-letter do retry queue; body: `deadLetterId`)
: jeśli wpis był już wcześniej przywrócony (`status != dead_letter`), endpoint zwraca `409 dead_letter_not_pending`
18. `POST /self-heal/dead-letter/requeue-bulk` (hurtowe requeue: `deadLetterIds[]` albo fallback do najnowszych `limit`; opcjonalnie `now`; summary: `requested|requeued|conflicts|missing`)
19. `GET /self-heal/requeue-audit?limit=20&reason=manual_requeue&from=<iso>&to=<iso>` (historia manualnych requeue z filtrami)

## Storage mode

1. `SOON_DB_MODE=memory` (domyślnie)
2. `SOON_DB_MODE=postgres`
3. `SOON_DATABASE_URL=postgres://...` (wymagane dla trybu postgres)
4. `SOON_DATABASE_SSL=1` (opcjonalnie)
5. `SOON_READ_MODEL_REFRESH_MODE=async|sync` (postgres, domyślnie `async`)
6. `SOON_SELF_HEAL_RETRY_INTERVAL_SEC` (scheduler retry queue, domyślnie `30`, min `5`)

## Observability

1. Prometheus scrape: `GET /metrics`
2. `GET /metrics` zawiera metryki:
   - read-model refresh (`soon_read_model_refresh_*`)
   - self-heal retry queue (`soon_self_heal_retry_queue_*`, `soon_self_heal_dead_letter_total`, `soon_self_heal_manual_requeue_total`)
3. OpenTelemetry: użyj `prometheus receiver` w OTel Collector i scrape `GET /metrics`.
4. Reguły alertów: `ops/monitoring/prometheus/soon-read-model-alerts.yml`
5. Local checker (threshold gates): `npm run obs:read-model:alert:check`
6. JSON checker output: `npm run obs:read-model:alert:check:json`

### Alert thresholds (checker ENV)

1. `SOON_ALERT_BASE_URL` (default `http://127.0.0.1:3100`)
2. `SOON_ALERT_PENDING_WARN` (default `3`)
3. `SOON_ALERT_PENDING_CRIT` (default `10`)
4. `SOON_ALERT_DURATION_WARN_MS` (default `5000`)
5. `SOON_ALERT_DURATION_CRIT_MS` (default `15000`)
6. `SOON_ALERT_STUCK_SEC` (default `300`)

## DB-first schema

1. Migracje SQL: `packages/api/db/migrations/*`
2. Runner migracji: `packages/api/scripts/run-migrations.mjs`
3. Model relacyjny (bez JSON payload jako long-term storage):
- `soon_tracking`
- `soon_tracking_threshold`
- `soon_tracking_price`
- `soon_price_history`
- `soon_hunter_run`
- `soon_hunter_decision`
- `soon_alert_dispatch_audit`
- `soon_self_heal_run`
- `soon_self_heal_playbook_execution`
- `soon_self_heal_retry_queue`
- `soon_self_heal_dead_letter`
- `soon_self_heal_requeue_audit`
- `soon_maintenance_event`

## Legacy backup retention

1. `npm run db:cleanup:legacy:preview`
2. `npm run db:cleanup:legacy:execute`
3. Niestandardowo: `node packages/api/scripts/cleanup-legacy-backup.mjs --retention-days=90 [--execute]`

## Zasady

1. AI tylko backendowo.
2. Alert routing: purchase -> Telegram, technical -> Discord.
3. Baseline regułowy zawsze aktywny (AI nie jest jedynym decydentem).
