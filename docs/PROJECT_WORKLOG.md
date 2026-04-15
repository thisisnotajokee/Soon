# PROJECT_WORKLOG (Soon)

Cel: stały zapis kluczowych decyzji, zmian i wyników weryfikacji.

## Zasady prowadzenia

1. Logujemy tylko rzeczy istotne architektonicznie lub operacyjnie.
2. Każdy wpis zawiera: zakres, decyzje, testy, ryzyka, następny krok.
3. Zero sekretów i pełnych danych dostępowych.

---

## 2026-04-15 — Bootstrap v1 + porządek ENV

### Zakres

1. Utworzono nowy projekt `Soon` poza `ambot-pro`.
2. Zbudowano scaffold domen v1 (`tracking-core`, `hunter-core`, `token-control-plane`, `autonomy-orchestrator`, `self-heal-controller`, `alert-router`, `ml-platform`).
3. Dodano runtime API MVP i testy kontraktowe.
4. Dodano runtime workerów i testy worker contract.
5. Podłączono `packages/web` do API i dodano smoke E2E.
6. Dodano adapter PostgreSQL i uruchomiono smoke na realnej lokalnej bazie.

### Kluczowe decyzje

1. Jeden projekt (monorepo), bez splitu na dwa repo.
2. Przenosimy tylko minimalny, sprawdzony zestaw mechanik.
3. AI tylko backendowo; brak AI user-facing w v1.
4. Twarde zasady kanałów: purchase -> Telegram, technical -> Discord.
5. ENV migration policy: tylko niezbędne zmienne do aktywnego zakresu v1.

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS.
2. `npm run test:workers` -> PASS.
3. `npm run smoke:e2e` -> PASS.
4. Smoke na Postgres (`SOON_DB_MODE=postgres`) -> PASS.

### Ryzyka

1. Brak pełnej integracji z docelowym persistence modelem produkcyjnym (na razie tabela `soon_trackings`).
2. Część modułów nadal scaffold-only (bez pełnej logiki domenowej).

### Następny krok

1. Wdrożyć prawdziwy model danych tracking/hunter w Postgres (bez JSON payload jako long-term storage).
2. Dodać migration files i testy integracyjne DB-first.

---

## 2026-04-15 — DB-first model + migracje SQL

### Zakres

1. Dodano migrację SQL `001_db_first_core.sql` i runner migracji.
2. Przepisano `postgres-store` z modelu JSON payload na model relacyjny.
3. Dodano dokument modelu danych `docs/DB_MODEL_V1.md`.
4. Uzupełniono skrypty (`npm run db:migrate`) i README.

### Kluczowe decyzje

1. JSON payload nie jest już long-term storage dla trackingu.
2. Source-of-truth schematu to migracje SQL w repo (`db/migrations`).
3. Runtime store automatycznie odpala migracje i seed only-if-empty.

### Testy / weryfikacja

1. `npm run check` -> PASS (contracts + workers + web smoke).
2. Smoke na postgres po zmianie modelu -> PASS.

### Ryzyka

1. Seed runtime jest wygodny devowo, ale docelowo seed powinien zostać tylko w dedykowanym flow bootstrap.
2. `soon_trackings` (stara tabela JSON) może pozostać jako legacy artefakt do późniejszego cleanupu.

### Następny krok

1. Dodać migrację cleanup legacy tabeli JSON po potwierdzeniu pełnej zgodności.
2. Rozszerzyć model DB o outcomes i audyt decyzji Huntera (DB-first).

---

## 2026-04-15 — Cleanup legacy JSON table (guarded)

### Zakres

1. Dodano migrację `002_cleanup_legacy_json.sql`.
2. Cleanup legacy tabeli `soon_trackings` działa tylko z guardami bezpieczeństwa.
3. Dodano backup legacy danych do `soon_trackings_legacy_backup` przed dropem.

### Kluczowe decyzje

1. Legacy cleanup musi być idempotentny i fail-safe.
2. Nie usuwamy `soon_trackings`, jeśli `soon_tracking` (DB-first) jest puste.
3. Drop tabeli legacy następuje dopiero po walidacji backup row-count.

### Testy / weryfikacja

1. `npm run db:migrate` na lokalnym Postgres -> oczekiwany PASS.
2. Walidacja tabel (`to_regclass`) i liczników po migracji.
3. `npm run test:contracts` + `npm run smoke:e2e` na `SOON_DB_MODE=postgres` -> oczekiwany PASS.

### Ryzyka

1. `soon_trackings_legacy_backup` pozostaje jako artefakt operacyjny do kontrolowanego usunięcia w przyszłości.

### Następny krok

1. Dodać politykę retencji i docelowy termin usunięcia `soon_trackings_legacy_backup`.

---

## 2026-04-15 — Retencja backupu legacy (migration 003)

### Zakres

1. Dodano migrację `003_legacy_backup_retention.sql`.
2. Dodano kontrolowany mechanizm preview/execute cleanupu backupu legacy.
3. Dodano audyt zdarzeń maintenance (`soon_maintenance_event`).

### Kluczowe decyzje

1. Cleanup backupu legacy jest jawny i sterowany komendą (brak automatycznego kasowania).
2. Domyślny tryb operacyjny to preview, execute jest osobną akcją.
3. Każdy preview/execute zapisuje ślad do `soon_maintenance_event`.

### Testy / weryfikacja

1. `npm run db:migrate` -> PASS.
2. `npm run db:cleanup:legacy:preview` -> PASS.
3. `npm run check` -> PASS.

### Ryzyka

1. Backup legacy pozostaje, dopóki nie uruchomimy execute po przekroczeniu retencji.

### Następny krok

1. Dodać harmonogram operacyjny (np. tygodniowy preview + miesięczny execute po akceptacji).

---

## 2026-04-15 — Hunter outcomes + audit (migration 004)

### Zakres

1. Dodano migrację `004_hunter_outcomes_audit.sql`.
2. Persistujemy każdy cykl automatyki do `soon_hunter_run`.
3. Persistujemy decyzje per ASIN do `soon_hunter_decision`.
4. Persistujemy routing alertów do `soon_alert_dispatch_audit`.
5. Dodano endpoint `GET /automation/runs/latest`.
6. Uzupełniono kontrakty i smoke o odczyt ostatnich runów.
7. Dodano endpoint KPI `GET /automation/runs/summary`.
8. Dodano endpoint trendów `GET /automation/runs/trends` (`24h/7d/30d`).

### Kluczowe decyzje

1. To baza danych jest source-of-truth dla historii runów automatyki.
2. Audyt alertów zapisujemy niezależnie od bieżącego UI/adaptera notyfikacji.
3. Kanały routingowe pozostają sztywne: purchase -> Telegram, technical -> Discord.

### Testy / weryfikacja

1. `npm run db:migrate` -> PASS.
2. `npm run test:contracts` -> PASS.
3. `npm run test:workers` -> PASS.
4. `npm run smoke:e2e` -> PASS.
5. `npm run check` -> PASS.
6. `npm run test:contracts` na `SOON_DB_MODE=postgres` -> PASS.
7. `npm run smoke:e2e` na `SOON_DB_MODE=postgres` -> PASS.

### Ryzyka

1. Brakuje jeszcze dashboardu read-model pod analizę trendów run-to-run.
2. Polityka retencji dla `soon_hunter_*` nie jest jeszcze zdefiniowana.

### Następny krok

1. Dodać read-model z agregacją dzienną pod dashboard operacyjny (tańsze zapytania przy większej skali runów).

---

## 2026-04-15 — Daily read model dashboard (migration 005)

### Zakres

1. Dodano migrację `005_hunter_daily_read_model.sql`.
2. Dodano tabele `soon_hunter_run_daily` oraz `soon_hunter_run_daily_asin`.
3. Dodano odświeżanie read-modelu po każdym `recordAutomationCycle`.
4. Dodano endpoint `GET /automation/runs/daily?days=30`.
5. Uzupełniono klienta API, kontrakty i smoke E2E.
6. Przełączono `GET /automation/runs/trends` na źródło `daily read-model` (bez skanowania raw runów).

### Kluczowe decyzje

1. Dashboard operacyjny czyta agregaty dzienne zamiast skanować surowe runy.
2. Agregacja top ASIN trzymana jest relacyjnie (`day + asin`) bez payloadów JSON.
3. Refresh read-modelu jest synchroniczny po zapisaniu runu (spójność > minimalna latencja).
4. Trendy 24h/7d/30d są liczone z read-modelu dziennego dla tańszych i stabilnych odczytów.
5. W Postgres read-model refresh działa domyślnie asynchronicznie (`SOON_READ_MODEL_REFRESH_MODE=async`) z flush na odczycie dashboardu.
6. Dodano endpoint observability `GET /automation/read-model/status` (backlog, in-flight, błędy, czasy).
7. Dodano endpoint `GET /metrics` z eksportem metryk kolejki refreshu (Prometheus/OpenTelemetry).
8. Dodano gotowe reguły alertów Prometheus: `ops/monitoring/prometheus/soon-read-model-alerts.yml`.
9. Dodano local threshold checker: `npm run obs:read-model:alert:check`.

### Testy / weryfikacja

1. `npm run check` -> PASS.

### Update (2026-04-15, requeue-audit filters reason/from/to)

1. Rozszerzono `GET /self-heal/requeue-audit` o filtry query:
   - `reason`
   - `from` (ISO timestamp)
   - `to` (ISO timestamp)
2. Dodano walidację API:
   - błędny `from` -> `400 invalid_from_timestamp`,
   - błędny `to` -> `400 invalid_to_timestamp`.
3. Rozszerzono implementację store (memory/postgres) o filtrowanie audit entries po `reason` i zakresie czasu.
4. Rozszerzono web API client:
   - `getSelfHealRequeueAudit({ limit, reason, from, to })`.
5. Rozszerzono kontrakty HTTP:
   - walidacja błędnego `from`,
   - filtrowanie po `reason`,
   - filtrowanie po przyszłym `from` (wynik pusty).
6. Zaktualizowano `packages/api/README.md` o nowe parametry endpointu.

### Testy / weryfikacja

1. `npm run check` -> PASS.

### Update (2026-04-15, bulk requeue conflicts telemetry)

1. Rozszerzono wynik `POST /self-heal/dead-letter/requeue-bulk` o pole `conflicts`.
2. Semantyka:
   - `conflicts`: wpisy odrzucone, bo nie są już w statusie `dead_letter`,
   - `missing`: wpisy nieistniejące/nieprawidłowe.
3. Rozszerzono implementację memory/postgres, aby rozdzielać `conflicts` i `missing`.
4. Rozszerzono kontrakty HTTP:
   - pierwszy bulk: `requeued=2, conflicts=0`,
   - drugi bulk na tych samych ID: `requeued=0, conflicts=2`.
5. Zaktualizowano `packages/api/README.md` o nowy format summary.

### Testy / weryfikacja

1. `npm run check` -> PASS.

### Update (2026-04-15, dead-letter requeue idempotency hardening)

1. Dodano guard na `POST /self-heal/dead-letter/requeue`:
   - requeue działa tylko gdy queue status to `dead_letter`,
   - ponowna próba requeue tego samego wpisu zwraca `409 dead_letter_not_pending`.
2. Hardening wdrożony w obu store:
   - memory/postgres `requeueSelfHealDeadLetter(...)` zwraca błąd domenowy `not_dead_letter` przy statusie innym niż `dead_letter`.
3. Endpoint API mapuje ten błąd do odpowiedzi 409 z `currentStatus`.
4. Rozszerzono kontrakt HTTP:
   - testuje drugi requeue tego samego dead-letter (`409`, `currentStatus=queued`).
5. Zaktualizowano `packages/api/README.md` o semantykę 409.

### Testy / weryfikacja

1. `npm run check` -> PASS.

### Update (2026-04-15, bulk requeue by explicit deadLetterIds)

1. Rozszerzono `POST /self-heal/dead-letter/requeue-bulk`:
   - wspiera jawne `deadLetterIds[]` (precyzyjne requeue),
   - zachowuje fallback do `limit` (najnowsze wpisy).
2. Dodano walidację inputu bulk:
   - pusta lista `deadLetterIds` -> `400 dead_letter_ids_invalid`.
3. Rozszerzono implementację store (memory/postgres):
   - `requeueSelfHealDeadLetters({ deadLetterIds, limit, now })`.
4. Rozszerzono web API client:
   - `requeueSelfHealDeadLettersBulk(input)` obsługuje:
     - `number` (`limit`),
     - `deadLetterIds[]`,
     - obiekt `{ limit, deadLetterIds }`.
5. Rozszerzono kontrakty HTTP:
   - test walidacji pustej listy `deadLetterIds`,
   - bulk happy-path po konkretnych ID (nie tylko po `limit`).
6. Zaktualizowano `packages/api/README.md` (opis endpointu bulk).

### Testy / weryfikacja

1. `npm run check` -> PASS.

### Update (2026-04-15, self-heal dead-letter bulk requeue)

1. Dodano endpoint:
   - `POST /self-heal/dead-letter/requeue-bulk` (`limit`, opcjonalnie `now`).
2. Rozszerzono store:
   - memory/postgres: `requeueSelfHealDeadLetters({ limit, now })`.
3. Endpoint zwraca:
   - `summary` (`requested`, `requeued`, `missing`, `items[]`),
   - aktualny `retryStatus`.
4. Rozszerzono web API client:
   - `requeueSelfHealDeadLettersBulk(limit)`.
5. Rozszerzono kontrakty HTTP:
   - scenariusz bulk requeue dla 2 dead-letter,
   - walidacja `retryStatus.manualRequeueTotal` i wpisów `requeue-audit`.
6. Zaktualizowano `packages/api/README.md` o nowy endpoint.

### Testy / weryfikacja

1. `npm run check` -> PASS.

### Update (2026-04-15, self-heal requeue audit endpoint)

1. Dodano endpoint operacyjny:
   - `GET /self-heal/requeue-audit?limit=20`.
2. Rozszerzono store:
   - memory: trwa historia requeue audit in-memory (`listSelfHealRequeueAudit`),
   - postgres: odczyt z `soon_self_heal_requeue_audit`.
3. Rozszerzono client web o `getSelfHealRequeueAudit(limit)`.
4. Rozszerzono kontrakty HTTP o walidację:
   - po requeue endpoint zwraca audit z wpisem `reason=manual_requeue`.
5. Zaktualizowano `packages/api/README.md` o nowy endpoint.

### Testy / weryfikacja

1. `npm run check` -> PASS.

### Update (2026-04-15, dead-letter manual requeue endpoint)

1. Dodano operacyjny endpoint:
   - `POST /self-heal/dead-letter/requeue` (`deadLetterId` w body).
2. Rozszerzono store `memory` i `postgres` o:
   - `requeueSelfHealDeadLetter(deadLetterId, { now })`.
3. Requeue ustawia job z powrotem na `queued`, wymusza co najmniej jeden dodatkowy retry budget i ustawia `last_error='manual_requeue'`.
4. Rozszerzono web API client o metodę `requeueSelfHealDeadLetter(...)`.
5. Rozszerzono kontrakty HTTP o walidację:
   - `400 dead_letter_id_required`,
   - `404 dead_letter_not_found`.
6. Zaktualizowano `packages/api/README.md` o nowy endpoint.

### Testy / weryfikacja

1. `npm run check` -> PASS.
2. `npm run db:migrate` -> PASS.
3. `npm run test:contracts` na `SOON_DB_MODE=postgres` -> PASS.
4. `npm run smoke:e2e` na `SOON_DB_MODE=postgres` -> PASS.

### Ryzyka

1. Przy dużej skali runów synchronizowanie refreshu inline może wymagać później przeniesienia do joba async.

### Następny krok

1. Dodać alerting progi dla metryk (`pendingCount`, `totalErrors`, `lastDurationMs`) w monitoringu.
2. Dodać routowanie alertów z Prometheus/Alertmanager do kanałów operacyjnych.

---

## 2026-04-15 — Local env bootstrap for Postgres mode

### Zakres

1. Dodano lokalny plik `Soon/.env.local` z minimalnym zestawem zmiennych do uruchamiania API w trybie Postgres.
2. Zaktualizowano skrypty npm, aby automatycznie ładowały `.env.local` dla:
   - `dev:api`
   - `dev:api:postgres`
   - `db:migrate`
   - `obs:read-model:alert:check`
   - `obs:read-model:alert:check:json`
3. Potwierdzono działanie bez ręcznych `export`.

### Kluczowe decyzje

1. Domyślny lokalny flow uruchamiania oparty o `.env.local` (minimum config, zero ręcznego setupu sesji).
2. Rozdzielna baza `soon` w lokalnym Postgresie dla izolacji od `ambot-pro`.

### Testy / weryfikacja

1. `npm run db:migrate` -> PASS.
2. `npm run dev:api` -> API startuje w `mode=async` (`SOON_DB_MODE=postgres`).
3. `npm run obs:read-model:alert:check` -> PASS.

### Następny krok

1. (Opcjonalnie) Dodać `make up`/`make check` jako jeden skrót operacyjny dla lokalnego bootstrapu.

---

## 2026-04-15 — Operational shortcuts via Makefile

### Zakres

1. Dodano `Makefile` z komendami: `up`, `status`, `check`, `down`, `restart`, `logs`.
2. `make up` wykonuje migracje DB i uruchamia API w tle z kontrolą health.
3. `make status` pokazuje stan `/health` i `/automation/read-model/status`.
4. `make check` uruchamia local read-model alert checker.
5. `make down` zatrzymuje proces API po PID.
6. README zaktualizowano o nowy flow operacyjny.

### Kluczowe decyzje

1. Standaryzujemy lokalne operacje na prostych komendach `make` zamiast ręcznych sekwencji.
2. Trzymamy minimalny runbook developerski: start, status, check, stop.

### Testy / weryfikacja

1. `make up` -> PASS.
2. `make status` -> PASS.
3. `make check` -> PASS.
4. `make down` -> PASS.

### Następny krok

1. Dodać `make smoke` (contracts + workers + smoke:e2e) jako jeden punkt jakości przed commitem.

### Update (2026-04-15, później)

1. Dodano target `make smoke` jako jeden quality gate (`npm run check`).
2. Zweryfikowano `make help` -> PASS.
3. Zweryfikowano `make smoke` -> PASS (contracts + workers + web smoke).

### Update (2026-04-15, smoke env alignment)

1. `smoke:e2e` przełączono na auto-load `.env.local`.
2. `make smoke` po zmianie -> PASS, a `readModelMode` w smoke = `async` (Postgres path).
3. Gate jakości lokalnie jest teraz spójny z docelowym trybem storage.

### Update (2026-04-15, make doctor)

1. Dodano `make doctor` (health + read-model status + metrics + alert checker).
2. Zaktualizowano README o nowy flow: `make up -> make doctor -> make smoke -> make down`.
3. Walidacja: `make up`, `make doctor`, `make down` -> PASS.

### Update (2026-04-15, CI quality gate)

1. Dodano workflow GitHub Actions: `.github/workflows/quality-gate.yml`.
2. Job `memory`: `npm ci` + `make smoke`.
3. Job `postgres`: service Postgres + migracje + contracts + workers + smoke + checker.
4. Cel: automatyczna walidacja obu ścieżek storage na każdym push/PR.

### Update (2026-04-15, CI fix checker fetch)

1. Naprawiono job `postgres` w workflow `quality-gate`.
2. `Read-model checker` uruchamia teraz API przez `make up`, odpala `make check`, a następnie zawsze robi cleanup `make down` (trap EXIT).
3. Przyczyna błędu: checker był odpalany bez aktywnego API (`fetch failed`).

### Update (2026-04-15, CI Node runtime warning)

1. Podniesiono akcje GitHub w `quality-gate.yml`:
   - `actions/checkout@v6`
   - `actions/setup-node@v6`
2. Cel: usunięcie ostrzeżeń o deprecacji Node 20 na runnerach GitHub Actions.

### Update (2026-04-15, doctor v2 JSON artifact)

1. Dodano `packages/api/scripts/doctor-report.mjs` (diagnostyka v2).
2. `make doctor` korzysta teraz z nowego raportu i zapisuje artefakt JSON do `ops/reports/doctor/latest.json`.
3. Dodano `make doctor-json` oraz skrypty npm:
   - `obs:doctor:report`
   - `obs:doctor:report:json`
4. Raport zawiera: health, read-model status, kluczowe metryki, wynik alert checker i `overall` (PASS/WARN/CRIT).
5. Dodano ignore dla artefaktów: `ops/reports/doctor/*.json`.

### Testy / weryfikacja

1. `make up` -> PASS.
2. `make doctor` -> PASS + zapis artefaktu.
3. `make doctor-json` -> PASS.
4. `make down` -> PASS.

### Update (2026-04-15, CI doctor artifact)

1. W workflow `quality-gate` (job `postgres`) krok checker został podniesiony do `make doctor`.
2. Dodano upload artefaktu diagnostycznego:
   - `actions/upload-artifact@v7`
   - plik: `ops/reports/doctor/latest.json`
3. Artefakt jest publikowany w każdym runie (`if: always()`), co daje ślad diagnostyczny także przy awariach.

### Testy / weryfikacja

1. `make up` -> PASS.
2. `make doctor` -> PASS.
3. `make down` -> PASS.

### Update (2026-04-15, CI doctor run summary)

1. Dodano skrypt `packages/api/scripts/doctor-summary.mjs` (render Markdown z raportu doctor JSON).
2. Dodano npm script: `obs:doctor:summary`.
3. Workflow `quality-gate` (job `postgres`) publikuje teraz podsumowanie doctor do `GITHUB_STEP_SUMMARY`.
4. Jeśli artefakt JSON nie istnieje, workflow publikuje fallback z informacją o braku pliku.

### Testy / weryfikacja

1. `make up` -> PASS.
2. `make doctor` -> PASS.
3. `npm run -s obs:doctor:summary -- ops/reports/doctor/latest.json` -> PASS.
4. `make down` -> PASS.

### Update (2026-04-15, doctor expectation hardening)

1. Rozszerzono `packages/api/scripts/doctor-report.mjs` o jawne oczekiwania trybu runtime:
   - `SOON_DOCTOR_EXPECT_STORAGE`
   - `SOON_DOCTOR_EXPECT_READ_MODEL_MODE`
2. Dodano walidację zgodności oczekiwań z realnym stanem:
   - `UNEXPECTED_STORAGE_MODE` (CRIT)
   - `UNEXPECTED_READ_MODEL_MODE` (CRIT)
3. Raport JSON zawiera teraz sekcję `expectations` z flagami `matches`.
4. Rozszerzono `packages/api/scripts/doctor-summary.mjs` o sekcję "Expectations".
5. Workflow `.github/workflows/quality-gate.yml` (job `postgres`) wymusza oczekiwane wartości:
   - `SOON_DOCTOR_EXPECT_STORAGE=postgres`
   - `SOON_DOCTOR_EXPECT_READ_MODEL_MODE=async`

### Testy / weryfikacja

1. `make up` -> PASS.
2. `SOON_DOCTOR_EXPECT_STORAGE=postgres SOON_DOCTOR_EXPECT_READ_MODEL_MODE=async make doctor` -> PASS (`expectations ok`).
3. `npm run -s obs:doctor:summary -- ops/reports/doctor/latest.json` -> PASS (sekcja Expectations obecna).
4. `make down` -> PASS.

### Update (2026-04-15, self-heal runs persistence + API)

1. Dodano migrację `006_self_heal_runs.sql`:
   - `soon_self_heal_run`
   - `soon_self_heal_playbook_execution`
2. Rozszerzono store runtime (`memory` i `postgres`) o:
   - `recordSelfHealRun(...)`
   - `listLatestSelfHealRuns(limit)`
3. Dodano endpointy API:
   - `POST /self-heal/run`
   - `GET /self-heal/runs/latest?limit=20`
4. Rozszerzono smoke/client:
   - `packages/web/src/api-client.mjs` o metody self-heal
   - `packages/web/smoke/e2e-smoke.mjs` o walidację self-heal flow
5. Zaktualizowano kontrakty HTTP (`contracts-v1`) o test persistencji self-heal runu.
6. Zaktualizowano `packages/api/README.md` o nowe endpointy i tabele.

### Testy / weryfikacja

1. `npm run db:migrate` -> PASS.
2. `npm run test:contracts` -> PASS (12/12, w tym self-heal).
3. `npm run test:workers` -> PASS.
4. `npm run smoke:e2e` -> PASS (`selfHealRuns: 1`).

### Update (2026-04-15, self-heal anomaly detector + playbook status)

1. Przebudowano `self-heal-playbooks` z prostego stubu na runtime detector anomalii:
   - backlog (`PENDING_BACKLOG_*`)
   - spike czasu refresh (`REFRESH_DURATION_*`)
   - error refresh (`LAST_REFRESH_ERROR`)
   - stuck in-flight (`REFRESH_STUCK`)
2. Dodano baseline playbook `system-health-check` uruchamiany zawsze.
3. `self-heal` zwraca i utrwala statusy per playbook (`success|rollback|failed`) zamiast samej listy ID.
4. `scanner-timeout` przechodzi w `rollback` przy anomalii `LAST_REFRESH_ERROR`.
5. `POST /self-heal/run` zasila detector statusem read-modelu z runtime store.
6. `self-heal` contracts/smoke/workers testy sprawdzają już strukturę:
   - `anomalyCount`
   - `anomalies[]`
   - `playbookCount`
   - `executedPlaybooks[{ playbookId, status }]`

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS.
2. `npm run test:workers` -> PASS.
3. `npm run smoke:e2e` -> PASS.
4. `npm run check` -> PASS.

### Update (2026-04-15, manual requeue counter + Prometheus metric)

1. Dodano licznik operacji ręcznego requeue dead-letter:
   - pole `manualRequeueTotal` w `getSelfHealRetryStatus()` (memory/postgres).
2. Dodano migrację `009_self_heal_manual_requeue_audit.sql`:
   - tabela `soon_self_heal_requeue_audit` do trwałego audytu requeue w trybie postgres.
3. Endpoint `POST /self-heal/dead-letter/requeue` zapisuje teraz audit:
   - memory: inkrementacja licznika runtime,
   - postgres: insert do `soon_self_heal_requeue_audit`.
4. Rozszerzono `GET /metrics` o nową metrykę:
   - `soon_self_heal_manual_requeue_total`.
5. Rozszerzono kontrakty HTTP:
   - asercja obecności `soon_self_heal_manual_requeue_total` w payload `/metrics`,
   - asercja `manualRequeueTotal >= 1` w happy-path requeue.
6. Zaktualizowano `packages/api/README.md` (metryka + model DB).

### Testy / weryfikacja

1. `npm run check` -> PASS.

### Update (2026-04-15, self-heal dead-letter requeue happy-path contract)

1. Rozszerzono `contracts-v1` o pełny scenariusz happy-path dla `POST /self-heal/dead-letter/requeue`:
   - przygotowanie kontrolowanego dead-letter przez in-memory store,
   - requeue przez endpoint API,
   - ponowne procesowanie retry queue.
2. Zmieniono helper testowy `withServer(...)`, aby obsługiwał wstrzyknięty `store` do scenariuszy kontrolowanych.
3. Cel: mieć deterministyczny test operacyjny requeue bez zależności od przypadkowej produkcji dead-letter w runtime.

### Testy / weryfikacja

1. `npm run check` -> PASS (contracts 15/15 + workers + smoke).

### Update (2026-04-15, self-heal async retry queue + dead-letter)

1. Dodano migrację `008_self_heal_retry_queue.sql`:
   - `soon_self_heal_retry_queue`
   - `soon_self_heal_dead_letter`
   - indeksy dla due queue i dead-letter timeline.
2. Przebudowano wykonanie playbooków:
   - pierwszy cykl `self-heal/run` wykonuje tylko attempt #1,
   - porażki z retry policy są odkładane do kolejki async (`shouldRetry=true`).
3. Dodano runtime evaluator retry:
   - `evaluateSelfHealRetryAttempt(...)` (outcome: `done|retry|dead_letter`).
4. Rozszerzono `memory` i `postgres` store o:
   - `enqueueSelfHealRetryJobs(...)`
   - `processSelfHealRetryQueue(...)`
   - `getSelfHealRetryStatus()`
   - `listSelfHealDeadLetters(limit)`.
5. Dodano endpointy API:
   - `POST /self-heal/retry/process`
   - `GET /self-heal/retry/status`
   - `GET /self-heal/dead-letter?limit=20`
6. Dodano scheduler retry queue po stronie API runtime:
   - ENV: `SOON_SELF_HEAL_RETRY_INTERVAL_SEC` (default 30s, min 5s).
7. `POST /self-heal/run`:
   - wspiera `readModelStatusOverride`,
   - zwraca `retryQueue` (`enqueued`, `queueSize`).
8. Zaktualizowano client web (`api-client`) o metody retry/dead-letter.
9. Rozszerzono testy:
   - workers: scenariusz async retry scheduling + evaluator terminal states,
   - contracts: retry status/dead-letter endpointy + procesowanie queue.
10. Zaktualizowano `packages/api/README.md` o nowe endpointy, scheduler i tabele DB.

### Testy / weryfikacja

1. `npm run check` -> PASS (contracts + workers + smoke).

### Update (2026-04-15, self-heal retry metrics in Prometheus)

1. Rozszerzono `GET /metrics` o metryki kolejki retry self-heal:
   - `soon_self_heal_retry_queue_pending`
   - `soon_self_heal_retry_queue_done`
   - `soon_self_heal_retry_queue_dead_letter`
   - `soon_self_heal_dead_letter_total`
2. Implementacja wykorzystuje `store.getSelfHealRetryStatus()` i dołącza payload retry metrics do istniejących read-model metrics.
3. Rozszerzono kontrakty HTTP (`contracts-v1`) o asercje obecności nowych metryk.
4. Zaktualizowano `packages/api/README.md` (sekcja Observability).

### Testy / weryfikacja

1. `npm run check` -> PASS.

### Update (2026-04-15, self-heal priority scoring + retry policy)

1. Rozszerzono `self-heal` o scoring priorytetów playbooków na podstawie:
   - `basePriority` playbooka
   - severity anomalii (`CRIT`/`WARN`)
   - liczby dopasowanych anomalii
2. Dodano retry policy per playbook:
   - `maxRetries`
   - `retryBackoffSec`
   - runtime metadata (`attempts`, `retriesUsed`)
3. Rozszerzono wynik wykonania playbooków:
   - `playbookId`
   - `status` (`success|rollback|failed`)
   - `attempts`, `maxRetries`, `retriesUsed`
   - `priorityScore`
   - `matchedAnomalyCodes`
4. Dodano migrację `007_self_heal_execution_metadata.sql` i utrwalanie metadanych retry/scoring w `soon_self_heal_playbook_execution`.
5. Rozszerzono testy:
   - worker test scenariusza anomalii (w tym retry + rollback)
   - contracts/smoke o nowe pola self-heal.

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS.
2. `npm run test:workers` -> PASS.
3. `npm run smoke:e2e` -> PASS.
4. `npm run check` -> PASS.
