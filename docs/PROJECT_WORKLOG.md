# PROJECT_WORKLOG (Soon)

Cel: stały zapis kluczowych decyzji, zmian i wyników weryfikacji.

## Zasady prowadzenia

1. Logujemy tylko rzeczy istotne architektonicznie lub operacyjnie.
2. Każdy wpis zawiera: zakres, decyzje, testy, ryzyka, następny krok.
3. Zero sekretów i pełnych danych dostępowych.

---

## 2026-04-16 — Token Control Plane v4 (capped policy in automation)

### Zakres

1. `automation/cycle` obsługuje teraz policy tokenów:
- `SOON_TOKEN_POLICY_MODE=unbounded|capped`,
- `SOON_TOKEN_DAILY_BUDGET`.
2. `automation/cycle` wspiera opcjonalny override request body:
- `tokenPolicy.mode`,
- `tokenPolicy.budgetTokens`.
3. Przy `capped` selekcja ASIN jest robiona wg token budget (skipped przy `budget_exceeded`).
4. `tokenPlan` zawiera metadane selekcji:
- `selected`,
- `skipReason`,
- `remainingBudgetAfter`.
5. Snapshot tokenów z `automation/cycle` odwzorowuje realny wynik policy (nie tylko unbounded).
6. `trackingCount` runu automatyki odzwierciedla liczbę faktycznie wybranych ASIN (`selectedCount`), nie pełną watchlistę.
7. Dodano alerty Prometheus dla budget pressure:
- `SoonTokenBudgetPressureWarn`,
- `SoonTokenBudgetExhaustedCritical`.
8. Rozszerzono kontrakty:
- `automation/cycle` zwraca `tokenSnapshotId`,
- metryki `/metrics` zawierają `soon_token_control_*`,
- scenariusz `capped` z wyczerpaniem budżetu.

### Kluczowe decyzje

1. Jeśli `SOON_TOKEN_POLICY_MODE=capped`, ale budżet jest pusty/niepoprawny -> bezpieczny fallback do `unbounded`.
2. Heartbeat techniczny pozostaje zawsze aktywny (niezależnie od budget policy).
3. Capped policy ogranicza decyzje zakupowe tylko do ASIN wybranych w token-plan.

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS.
2. `npm run check` -> PASS.

### Ryzyka

1. Brak jeszcze persystowanego dziennego zużycia budżetu między runami (obecnie policy per-run).
2. Potrzebny kolejny etap: dynamiczny replenishment i limity per segment/market.

### Następny krok

1. Dodać stateful budget ledger (daily consumed/remaining) i policy reset okna dobowego.
2. Dodać endpoint operacyjny `GET /token-control/budget/status`.

---

## 2026-04-16 — Token Control Plane v3 (automation runId + metrics)

### Zakres

1. `POST /automation/cycle` zapisuje teraz również snapshot tokenów i zwraca `tokenSnapshotId`.
2. Snapshot automatyki jest wiązany z realnym `runId` z `soon_hunter_run`.
3. Dodano metryki token-control do `GET /metrics`:
- `soon_token_control_snapshot_present`,
- `soon_token_control_selected_count`,
- `soon_token_control_skipped_count`,
- `soon_token_control_budget_usage_pct` (+ pozostałe `soon_token_control_*`).
4. Rozszerzono kontrakty HTTP o:
- asercję `tokenSnapshotId` dla `automation/cycle`,
- asercję eksportu metryk token-control.

### Kluczowe decyzje

1. `automation/cycle` traktujemy jako canonical source snapshotu dla trybu unbounded.
2. Metryki token-control są emitowane zawsze (nawet gdy brak snapshotu, wartości 0 i `budget_mode=\"none\"`).
3. Nie zmieniamy jeszcze algorytmu automatyki na capped budget — to osobny etap polityki budżetowej.

### Testy / weryfikacja

1. `npm run test:contracts` -> do uruchomienia po commit.
2. `npm run check` -> do uruchomienia po commit.

### Ryzyka

1. Snapshot w `automation/cycle` jest obecnie unbounded, więc `budget_usage_pct=0`.
2. Brak alertowania na skoki `skipped_count` dla trybu capped (do dodania gdy capped wejdzie do cyklu).

### Następny krok

1. Wprowadzić capped budget policy do `automation/cycle` i użyć endpointu token-control jako source decyzji.
2. Dodać guardrail alertów Prometheus dla token budget utilization.

---

## 2026-04-16 — Token Control Plane v2 (snapshot persistence)

### Zakres

1. Dodano migrację `011_token_allocation_snapshots.sql`:
- `soon_token_allocation_snapshot`,
- `soon_token_allocation_snapshot_item`.
2. Dodano zapis snapshotów po `POST /token-control/allocate` (memory + postgres store).
3. Dodano endpoint odczytu:
- `GET /token-control/snapshots/latest`,
- alias `GET /api/token-control/snapshots/latest`.
4. Rozszerzono kontrakty HTTP o test snapshotów.
5. Zaktualizowano README API o nowy endpoint.

### Kluczowe decyzje

1. Snapshot zapisuje zarówno summary, jak i pełny plan pozycji (selected/skipped).
2. Persistencja snapshotów jest niezależna od `automation cycle runId` (na tym etapie `runId=null`).
3. V2 buduje bazę pod kolejne spięcie z automatyką i read-model tokenów.

### Testy / weryfikacja

1. `npm run test:contracts` -> do uruchomienia po zmianach.
2. `npm run check` -> do uruchomienia po zmianach.

### Ryzyka

1. Brak jeszcze metryk operacyjnych dla token snapshotów (`/metrics` bez serii token-control).
2. Brak retencji/cleanup snapshotów (na razie rośnie historia).

### Następny krok

1. Podpiąć token snapshoty do `automation/cycle` z realnym `runId`.
2. Dodać metryki token-control (`selected/skipped/budget usage`) do `GET /metrics`.

---

## 2026-04-16 — Token Control Plane v1 (kontrakt + endpoint)

### Zakres

1. Dodano endpoint `POST /token-control/allocate` + alias `POST /api/token-control/allocate`.
2. Dodano walidację payloadu (`items_required`, `invalid_item`, `budget_tokens_invalid`).
3. Dodano deterministyczne sortowanie planu tokenów (`priority desc`, `tokenCost asc`, `asin asc`).
4. Dodano tryb budżetowy:
- bez limitu (`budgetMode=unbounded`),
- z limitem (`budgetMode=capped`) + `selected/skipped` i `remainingBudgetTokens`.
5. Rozszerzono kontrakty HTTP o testy token-control-plane.
6. Zaktualizowano dokumentację endpointów (`packages/api/README.md`).

### Kluczowe decyzje

1. V1 token-control-plane jest jawnie backend-only i API-first (bez UI).
2. Priorytet tokenowy opiera się o prostą i audytowalną formułę: `(expectedValue * confidence) / tokenCost`.
3. Budżet jest opcjonalny; jeśli brak limitu, endpoint zwraca pełny ranking bez odrzucania pozycji.

### Testy / weryfikacja

1. `npm run test:contracts` -> (do uruchomienia po merge bieżących zmian).

### Ryzyka

1. V1 nie ma jeszcze persystencji planu tokenów (to etap API kontraktowego).
2. Brak dynamicznego, automatycznego budżetowania dziennego (kolejny etap token-policy runtime).

### Następny krok

1. Dodać persystencję snapshotów alokacji tokenów + endpoint read-model (`GET /token-control/snapshots/latest`).
2. Podpiąć token-control-plane do `automation/cycle` jako źródło decyzji budżetowych.

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

### Update (2026-04-15, requeue-audit summary endpoint)

1. Dodano endpoint:
   - `GET /self-heal/requeue-audit/summary?days=7`.
2. Endpoint zwraca agregaty:
   - `total`
   - `byReason[]`
   - `byPlaybook[]`
   - `daily[]`
3. Implementacja w store:
   - memory: agregacja in-process,
   - postgres: agregacje SQL (GROUP BY reason/playbook/day).
4. Rozszerzono web API client:
   - `getSelfHealRequeueAuditSummary(days)`.
5. Rozszerzono kontrakty HTTP:
   - walidacja `summary` po realnych requeue (`manual_requeue` obecny, `count >= 2`).
6. Zaktualizowano `packages/api/README.md` o endpoint `summary`.

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

1. `npm run test:contracts` -> PASS (16/16).
2. `npm run test:workers` -> PASS.
3. `npm run smoke:e2e` -> PASS.
4. `npm run check` -> PASS.

### Update (2026-04-15, bulk requeue operational alert + runbook flow)

1. Rozszerzono `POST /self-heal/dead-letter/requeue-bulk` o sygnał operacyjny:
   - `operationalAlert` w odpowiedzi API, gdy `summary.conflicts > 0` lub `summary.missing > 0`.
   - `operationalAlert.code = self_heal_bulk_requeue_partial`.
2. Runtime loguje ostrzeżenie (`console.warn`) dla partial bulk requeue z metrykami `requested|requeued|conflicts|missing`.
3. Rozszerzono kontrakty HTTP:
   - pierwszy bulk bez błędów: `operationalAlert = null`,
   - drugi bulk na tych samych ID: `operationalAlert.level = warn` i `code` zgodny.
4. Ujednolicono runbook endpoint flow w docs:
   - `status -> dead-letter -> requeue-bulk -> audit -> summary`
   - aktualizacja w `README.md` i `packages/api/README.md`.

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS.

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

### Update (2026-04-15, self-heal requeue triage automation)

1. Dodano skrypt operacyjny `packages/api/scripts/self-heal-requeue-triage.mjs`.
2. Skrypt wykonuje runbook flow:
   - `GET /self-heal/retry/status`
   - `GET /self-heal/dead-letter`
   - `POST /self-heal/dead-letter/requeue-bulk`
   - `GET /self-heal/requeue-audit`
   - `GET /self-heal/requeue-audit/summary`
3. Dodano oceny wyniku:
   - `PASS` gdy brak `operationalAlert` i brak `conflicts/missing`,
   - `WARN` gdy wystąpią sygnały partial requeue,
   - `CRIT` przy błędach endpointów/transportu.
4. Dodano nowe komendy npm:
   - `npm run ops:self-heal:requeue:triage`
   - `npm run ops:self-heal:requeue:triage:json`
5. Podłączono triage do `make doctor`, aby każdy cykl diagnostyczny od razu łapał regresje flow requeue.
6. Zaktualizowano dokumentację (`README.md`, `packages/api/README.md`).

### Testy / weryfikacja

1. `node --check packages/api/scripts/self-heal-requeue-triage.mjs` -> PASS.
2. `make up && make doctor && make down` -> PASS (`doctor=PASS`, `self-heal-triage=PASS`).

### Update (2026-04-15, self-heal triage policy + doctor summary integration)

1. Dodano politykę `SOON_SELF_HEAL_TRIAGE_WARN_AS_ERROR`:
   - lokalnie default `0` (WARN nie przerywa `make doctor`),
   - w CI ustawione `1` (WARN blokuje quality gate).
2. Rozszerzono `self-heal-requeue-triage`:
   - wsparcie `--out` i zapis artefaktu JSON,
   - raportowanie aktywnej polityki (`warnAsError`) w output.
3. `make doctor` zapisuje teraz także artefakt:
   - `ops/reports/doctor/self-heal-triage.json`.
4. Rozszerzono `doctor-summary` o sekcję:
   - **Self-heal Requeue Triage** (overall, policy, findings, conflicts/missing).
5. Workflow `quality-gate`:
   - ustawia `SOON_SELF_HEAL_TRIAGE_WARN_AS_ERROR=1`,
   - publikuje summary z obu artefaktów (`latest.json`, `self-heal-triage.json`),
   - upload artifact obejmuje oba pliki.
6. Uzupełniono dokumentację (`README.md`, `packages/api/README.md`, `.env.example`).

### Testy / weryfikacja

1. `node --check packages/api/scripts/self-heal-requeue-triage.mjs` -> PASS.
2. `node --check packages/api/scripts/doctor-summary.mjs` -> PASS.
3. `make up && make doctor && make down` -> PASS (artefakty: `latest.json`, `self-heal-triage.json`).

### Update (2026-04-15, regression tests for triage warn policy)

1. Dodano nowy zestaw testów skryptowych:
   - `packages/api/test/scripts-v1.test.mjs`.
2. Pokryte scenariusze:
   - `SOON_SELF_HEAL_TRIAGE_WARN_AS_ERROR=0`: triage kończy się `WARN`, ale exit code `0`.
   - `SOON_SELF_HEAL_TRIAGE_WARN_AS_ERROR=1`: triage kończy się `WARN`, a exit code `2`.
   - `doctor-summary` renderuje sekcję **Self-heal Requeue Triage** na podstawie artefaktu triage.
3. Dodano skrypt npm:
   - `npm run test:scripts`.
4. Rozszerzono quality gate lokalny:
   - `npm run check` uruchamia teraz `test:contracts + test:workers + test:scripts + smoke:e2e`.

### Testy / weryfikacja

1. `npm run test:scripts` -> PASS (3/3).
2. `npm run check` -> PASS.

### Update (2026-04-15, CI hardening for triage artifact presence and shape)

1. Dodano walidator artefaktu triage:
   - `packages/api/scripts/self-heal-triage-validate.mjs`.
2. Walidator sprawdza twardo:
   - `overall`,
   - `policy.warnAsError`,
   - `bulk.summary.{requested,requeued,conflicts,missing}`,
   - `findings`.
3. Workflow `quality-gate`:
   - dodano krok `Validate self-heal triage artifact (postgres)`,
   - `doctor-summary` uruchamiany z `SOON_DOCTOR_SUMMARY_REQUIRE_TRIAGE=1`,
   - brak/niepoprawny artefakt triage powoduje fail CI.
4. `doctor-summary`:
   - w trybie strict (ENV) failuje dla brakującego lub niepoprawnego artefaktu triage.
5. Dodano testy regresyjne:
   - strict-mode fail dla `doctor-summary` bez triage,
   - fail walidatora triage przy brakujących polach.
6. Dokumentacja uzupełniona (`README.md`, `packages/api/README.md`).

### Testy / weryfikacja

1. `npm run test:scripts` -> PASS (5/5).
2. `npm run check` -> PASS.

### Update (2026-04-15, CI stabilization: triage fallback before strict doctor-summary)

1. Workflow `quality-gate` (`postgres`) rozszerzono o krok:
   - `Ensure self-heal triage artifact (postgres)` z `if: always()`.
2. Nowy krok:
   - sprawdza obecność `ops/reports/doctor/self-heal-triage.json`,
   - jeśli brak, uruchamia fallback: `make up` + `ops:self-heal:requeue:triage` z zapisem artefaktu.
3. Krok walidacji triage:
   - `Validate self-heal triage artifact (postgres)` uruchamiany z `if: always()`,
   - daje deterministyczny fail i czytelny powód przy realnym problemie.
4. Merge przez PR:
   - PR `#14`: `ci: add fallback triage generation before strict doctor-summary`.

### Testy / weryfikacja

1. Lokalnie: `npm run test:scripts` -> PASS (5/5).
2. Lokalnie: `npm run check` -> PASS.
3. GitHub Actions (`quality-gate`, `main`, push):
   - run `24474747799` (2026-04-15T19:44:54Z) -> SUCCESS.

### Update (2026-04-15, runtime health parity: alert/self-heal status endpoints)

1. Dodano endpoint operacyjny:
   - `GET /api/runtime-self-heal-status` (plus alias bez prefiksu `/runtime-self-heal-status`).
2. Endpoint zwraca:
   - `retryQueue` (pending/done/dead-letter/manual requeue),
   - `latestRun` self-heal,
   - `overall` (`PASS|WARN|CRIT`) i `signals` z progów operacyjnych.
3. Dodano endpoint kontroli separacji kanałów:
   - `GET /api/check-alert-status?limit=20` (plus alias `/check-alert-status`).
4. Endpoint routingu alertów zwraca:
   - politykę (`purchase -> telegram`, `technical -> discord`),
   - agregację `alertsByChannel`,
   - `violations` i `overall` (`PASS/WARN`) dla ostatnich runów.
5. Rozszerzono klienta web API (`packages/web/src/api-client.mjs`) i smoke E2E o oba endpointy.
6. Uzupełniono dokumentację endpointów i inwentarze (`packages/api/README.md`, `docs/API_ENDPOINT_INVENTORY.md`, `docs/FULL_MECHANICS_INVENTORY.md`).

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS (18/18; nowe testy dla obu endpointów).
2. `npm run smoke:e2e` -> PASS (`runtimeSelfHealOverall=PASS`, `alertRoutingOverall=PASS`).
3. `npm run check` -> PASS.

### Ryzyka

1. Progi `PASS/WARN/CRIT` dla runtime self-heal są na razie baseline; mogą wymagać kalibracji po dłuższym okresie telemetrycznym.

### Następny krok

1. Dodać alerty Prometheus dla `overall!=PASS` (self-heal status) i `violations.total>0` (alert routing status) oraz podpiąć je do operacyjnego kanału Discord.

### Update (2026-04-15, Prometheus runtime ops alerts + Discord ops routing)

1. Rozszerzono `GET /metrics` o metryki runtime/ops:
   - `soon_runtime_self_heal_overall_score` (`0=PASS`, `1=WARN`, `2=CRIT`)
   - `soon_runtime_self_heal_signals_total`
   - `soon_alert_routing_overall_score`
   - `soon_alert_routing_violations_total`
   - `soon_alert_routing_purchase_non_telegram_total`
   - `soon_alert_routing_technical_non_discord_total`
   - `soon_alert_routing_unknown_kind_total`
   - `soon_alert_routing_unknown_channel_total`
2. Rozszerzono reguły Prometheus (`ops/monitoring/prometheus/soon-read-model-alerts.yml`) o alerty:
   - `SoonRuntimeSelfHealWarn`
   - `SoonRuntimeSelfHealCritical`
   - `SoonAlertRoutingViolationWarn`
   - `SoonAlertRoutingViolationCritical`
3. Dodano szablon Alertmanager dla operacyjnego Discord:
   - `ops/monitoring/alertmanager/soon-alertmanager-discord.example.yml`
4. Dodano dokumentację monitoringu:
   - `ops/monitoring/README.md` (Prometheus + Alertmanager -> Discord).
5. Dodano runtime checker endpointów health:
   - `packages/api/scripts/runtime-alert-check.mjs`
   - npm scripts: `obs:runtime:alert:check`, `obs:runtime:alert:check:json`
6. `make check` uruchamia teraz:
   - read-model alert checker
   - runtime alert checker.
7. Uzupełniono dokumentację (`README.md`, `packages/api/README.md`).

### Testy / weryfikacja

1. `npm run check` -> PASS.
2. `test:contracts` potwierdza obecność nowych metryk runtime/ops w `GET /metrics`.

### Ryzyka

1. Progi ostrzegawcze/krytyczne dla routing violations są baseline i mogą wymagać kalibracji po kilku dniach telemetry.

### Następny krok

1. Dodać test integracyjny Alertmanager config (lint + syntactic check) i pipeline smoke dla monitoringu.

### Update (2026-04-15, monitoring-smoke CI + config validator)

1. Dodano walidator konfiguracji monitoringu:
   - `packages/api/scripts/monitoring-config-check.mjs`
   - waliduje obecność wymaganych tokenów w:
     - `ops/monitoring/prometheus/soon-read-model-alerts.yml`
     - `ops/monitoring/alertmanager/soon-alertmanager-discord.example.yml`
2. Dodano npm skrypty:
   - `obs:monitoring:check`
   - `obs:monitoring:check:json`
3. Rozszerzono `npm run check`, aby zaczynał od `obs:monitoring:check` (fail-fast na błędnej konfiguracji monitoringu).
4. Workflow `quality-gate`:
   - dodano nowy job `monitoring-smoke` uruchamiający `npm run obs:monitoring:check`.
5. Zaktualizowano dokumentację:
   - `README.md`
   - `ops/monitoring/README.md`.

### Testy / weryfikacja

1. `npm run obs:monitoring:check` -> PASS.
2. `npm run check` -> PASS.

### Ryzyka

1. Walidator jest obecnie token-based (szybki smoke), nie pełny parser semantyczny YAML.

### Następny krok

1. Dodać pełną walidację składni YAML (`promtool` / `amtool`) jako optional strict stage w CI.

### Update (2026-04-15, monitoring strict stage with promtool/amtool)

1. Dodano strict validator:
   - `packages/api/scripts/monitoring-config-strict.mjs`.
2. Strict validator:
   - uruchamia `promtool check rules` dla reguł Prometheus,
   - uruchamia `amtool check-config` dla configu Alertmanager,
   - wspiera fallback Docker (`prom/prometheus`, `prom/alertmanager`) gdy binarki lokalne nie istnieją.
3. Dodano npm skrypty:
   - `obs:monitoring:strict`
   - `obs:monitoring:strict:json`
4. Workflow `quality-gate`:
   - dodano nowy job `monitoring-strict`,
   - wymusza `SOON_MONITORING_STRICT_FORCE_DOCKER=1` dla spójnego środowiska CI.
5. Dokumentacja monitoringu zaktualizowana (`README.md`, `ops/monitoring/README.md`).

### Testy / weryfikacja

1. `npm run obs:monitoring:strict` -> PASS.
2. `npm run check` -> PASS.

### Ryzyka

1. Strict checker zależy od dostępności Dockera w środowisku CI.

### Następny krok

1. Dodać snapshot expected-output dla strict check (stabilna kontrola zmian tooling output).

### Update (2026-04-15, PR #19 merged + sanity on main)

1. Zmergowano PR `#19` do `main`:
   - commit na `main`: `6f16af4`
   - zakres: strict monitoring validation (`promtool` + `amtool`) w quality-gate.
2. Potwierdzono spójny stan lokalnego `main` z `origin/main` (fast-forward wykonany).
3. Wykonano sanity po merge na `main`:
   - `npm run check` -> PASS
   - `npm run obs:monitoring:strict` -> PASS.

### Testy / weryfikacja

1. `npm run check` -> PASS (contracts, workers, scripts, smoke).
2. `npm run obs:monitoring:strict` -> PASS (`promtool` i `amtool` + rendered-config path).

### Ryzyka

1. Brak nowych CRIT po merge; obserwować tylko stabilność środowiska Docker w CI.

### Następny krok

1. Dodać snapshot expected-output dla strict check oraz test regresji dla rendered Alertmanager config.

### Update (2026-04-16, self-heal alert routing + auto-remediation runbook v1 bootstrap)

1. Utworzono runbook operacyjny v1:
   - `docs/SELF_HEAL_ALERT_ROUTING_RUNBOOK_V1.md`
   - zawiera invarianty routingu, flow auto-remediation, checklistę wdrożeniową i kryterium DONE.
2. Dodano szkielet testów pod kolejne wdrożenia:
   - `packages/api/test/self-heal-alert-routing-v1.test.mjs`
   - dwa `test.todo` dla:
     - policy routing + auto-remediation,
     - retry exhausted/backoff telemetry.
3. Cel tego kroku:
   - ustabilizować backlog wdrożenia i mieć jasny kontrakt operacyjny przed kolejnymi zmianami kodu.

### Testy / weryfikacja

1. `npm run check` (na `main` przed utworzeniem brancha) -> PASS.

### Ryzyka

1. Szkielet testów `todo` nie wymusza jeszcze egzekucji scenariuszy end-to-end.

### Następny krok

1. Zamienić `test.todo` na aktywne testy kontraktowe i dodać je do ścieżki CI.

### Update (2026-04-16, self-heal alert routing v1 test activation)

1. Zamieniono szkielety `test.todo` na aktywne testy:
   - `packages/api/test/self-heal-alert-routing-v1.test.mjs`.
2. Dodane scenariusze:
   - routing policy: `purchase -> telegram`, `technical -> discord`,
   - dead-letter reason `retry_budget_exhausted` + metryki:
     - `soon_self_heal_retry_exhausted_total`,
     - `soon_self_heal_retry_backoff_seconds`.
3. Podpięto nowy plik do głównego kontraktowego przebiegu:
   - `package.json` -> `test:contracts` uruchamia teraz oba pliki:
     - `contracts-v1.test.mjs`,
     - `self-heal-alert-routing-v1.test.mjs`.

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS (21/21).
2. `npm run check` -> PASS.

### Ryzyka

1. Brak nowych ryzyk funkcjonalnych; coverage kontraktowa wzrosła dla ścieżki routing/self-heal.

### Następny krok

1. Dodać scenariusz regresji „policy drift -> auto-remediation -> recovery w kolejnym cyklu”.

### Update (2026-04-16, alert routing drift auto-remediation + recovery regression)

1. Rozszerzono `POST /self-heal/run` o automatyczną remediację alert routing policy drift:
   - jeżeli ostatni run automation ma violation policy (`purchase!=telegram` lub `technical!=discord`),
   - runtime uruchamia automatyczny cykl remediacyjny (`runAutomationCycle` + persist run),
   - odpowiedź endpointu zawiera sekcję:
     - `alertRoutingAutoRemediation.checked`,
     - `triggered`,
     - `reason`,
     - `beforeViolations`,
     - `afterViolations`,
     - `recovered`,
     - `remediationRunId`.
2. Dodano test regresyjny E2E:
   - `packages/api/test/self-heal-alert-routing-v1.test.mjs`
   - scenariusz:
     - wstrzyknięty drift run (`purchase -> discord`),
     - status przed: `WARN`,
     - `POST /self-heal/run` triggeruje auto-remediation,
     - status po: `PASS` (limit=1), `recovered=true`.

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS (22/22).
2. `npm run check` -> PASS.

### Ryzyka

1. Auto-remediation bazuje obecnie na ocenie ostatniego runu (`limit=1`); historyczne drifty poza ostatnim runem nie triggerują remediacji.

### Następny krok

1. Dodać opcjonalny tryb `window-based remediation` (np. `limit=5`) z guardrail na max frequency triggerów.

### Update (2026-04-16, window-based remediation + frequency guardrail)

1. Rozszerzono `POST /self-heal/run` o konfigurację remediacji alert routing:
   - `alertRoutingRemediation.mode`: `latest | window | off`
   - `alertRoutingRemediation.limit`: rozmiar okna (`window`), domyślnie `5`
   - `alertRoutingRemediation.cooldownSec`: guardrail częstotliwości triggerów (domyślnie `120s`)
2. Dodano runtime guardrail:
   - jeśli wykryty drift i cooldown aktywny, remediacja nie jest wykonywana (`reason: cooldown_active`),
   - odpowiedź zawiera `cooldownActive` i `cooldownRemainingSec`.
3. Rozszerzono telemetryczne pola odpowiedzi `alertRoutingAutoRemediation`:
   - `mode`, `windowLimit`, `cooldownSec`,
   - `evaluatedRuns`, `recoveryWindowLimit`.
4. Domknięto regresję kontraktową:
   - `packages/api/test/self-heal-alert-routing-v1.test.mjs`
   - scenariusz: `window mode (limit=5)` wykrywa drift spoza latest-run i cooldown blokuje szybki retrigger.

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS (23/23).
2. `npm run check` -> PASS.

### Ryzyka

1. Guardrail cooldown jest obecnie in-memory (per process); po restarcie procesu licznik cooldown resetuje się.

### Następny krok

1. Przenieść cooldown state do trwałego storage (np. tabela runtime state), żeby był odporny na restart procesu.

### Update (2026-04-16, persisted cooldown state for alert-routing remediation)

1. Dodano trwały runtime state dla guardrail cooldown:
   - migration: `packages/api/db/migrations/010_runtime_state.sql`
   - tabela: `soon_runtime_state(state_key, state_value, updated_at)`.
2. Rozszerzono store API (memory + postgres):
   - `getRuntimeState(stateKey)`
   - `setRuntimeState(stateKey, stateValue)`
3. `POST /self-heal/run` używa teraz persisted key:
   - `alert_routing_last_remediation_at`
   - cooldown liczony z runtime state zamiast wyłącznie zmiennej procesu.
4. Dodano regresję kontraktową:
   - `self-heal alert routing v1: cooldown survives server restart via persisted runtime state`
   - scenariusz: restart serwera nie resetuje cooldown przy tym samym store/runtime state.

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS (24/24).
2. `npm run check` -> PASS.

### Ryzyka

1. Dla trybu memory persisted cooldown trwa tylko tyle, ile żyje instancja store (w obrębie procesu testowego); pełna trwałość produkcyjna wymaga trybu postgres.

### Następny krok

1. Dodać endpoint diagnostyczny runtime-state dla self-heal guardrails (read-only) do szybkiej inspekcji operacyjnej.

### Update (2026-04-16, runtime-state observability + cooldown metric)

1. Dodano read-only endpoint diagnostyczny runtime state:
   - `GET /self-heal/runtime-state?key=...`
   - `GET /api/self-heal/runtime-state?key=...`
2. Endpoint ma allowlist key i walidację:
   - `key_required` dla brakującego key,
   - `key_not_allowed` dla key poza allowlistą.
3. Rozszerzono runtime state remediacji o `cooldownSec` przy zapisie.
4. Dodano Prometheus gauge:
   - `soon_alert_routing_remediation_cooldown_remaining_seconds`
   - metryka pokazuje pozostały cooldown auto-remediation alert routing.
5. Rozszerzono kontrakty:
   - test endpointu runtime state (walidacja + poprawny cooldown snapshot),
   - test eksportu nowej metryki w `/metrics`.

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS (25/25).
2. `npm run check` -> PASS.

### Ryzyka

1. Endpoint jest świadomie ograniczony allowlistą; dodanie nowych kluczy runtime-state wymaga jawnego rozszerzenia allowlist.

### Następny krok

1. Dodać kontrolkę operacyjną (CLI/script) do szybkiego odczytu `/api/self-heal/runtime-state` i alarmowania, gdy cooldown utrzymuje się nienaturalnie długo.

### Update (2026-04-16, self-heal runtime-state CLI watchdog)

1. Dodano nowy skrypt operacyjny:
   - `packages/api/scripts/self-heal-runtime-state-check.mjs`
   - odczyt: `GET /api/self-heal/runtime-state?key=alert_routing_last_remediation_at`
   - tryby wyjścia:
     - `PASS` (exit `0`) gdy cooldown nie jest aktywny lub poniżej progów,
     - `WARN` (exit `1`) gdy `cooldownRemainingSec >= cooldownWarnSec`,
     - `CRIT` (exit `2`) gdy `cooldownRemainingSec >= cooldownCritSec`.
2. Dodano skrypty npm:
   - `npm run ops:self-heal:runtime-state:check`
   - `npm run ops:self-heal:runtime-state:check:json`
3. Dodano testy skryptowe:
   - PASS dla nieaktywnego cooldown,
   - WARN dla aktywnego cooldown powyżej progu ostrzegawczego.

### Testy / weryfikacja

1. `npm run test:scripts` -> PASS.

### Ryzyka

1. Progi domyślne (`warn=1800s`, `crit=7200s`) mogą wymagać strojenia per środowisko; można je nadpisać env:
   - `SOON_SELF_HEAL_COOLDOWN_WARN_SEC`,
   - `SOON_SELF_HEAL_COOLDOWN_CRIT_SEC`.

### Następny krok

1. Dodać ten watchdog do quality-gate/cron jako osobny check operacyjny (np. nightly + alert przy `WARN/CRIT`).

### Update (2026-04-16, watchdog wired into CI + scheduled ops)

1. Podpięto watchdog runtime-state do `quality-gate` (job `postgres`) jako smoke-check:
   - generowany artefakt: `ops/reports/doctor/self-heal-runtime-state-watchdog.json`,
   - publikowane podsumowanie do `GITHUB_STEP_SUMMARY`,
   - artifact upload rozszerzony o watchdog JSON.
2. Dodano osobny workflow operacyjny:
   - `.github/workflows/runtime-state-watchdog.yml`
   - triggery:
     - `schedule` (nightly, `17 2 * * *`),
     - `workflow_dispatch`.
3. Workflow operacyjny uruchamia watchdog przeciw zadanemu runtime URL:
   - sekret wymagany: `SOON_RUNTIME_BASE_URL`,
   - progi sterowane przez repo vars:
     - `SOON_SELF_HEAL_COOLDOWN_WARN_SEC` (domyślnie `1800`),
     - `SOON_SELF_HEAL_COOLDOWN_CRIT_SEC` (domyślnie `7200`).

### Testy / weryfikacja

1. `npm run check` -> PASS.

### Ryzyka

1. Jeżeli sekret `SOON_RUNTIME_BASE_URL` nie będzie ustawiony, workflow operacyjny failuje fail-fast (intencjonalnie).

### Następny krok

1. Ustawić `SOON_RUNTIME_BASE_URL` + ewentualne progi repo vars i uruchomić `runtime-state-watchdog` ręcznie (`workflow_dispatch`) jako test pierwszego przebiegu.

### Update (2026-04-16, runtime watchdog auth support)

1. Rozszerzono watchdog o nagłówki auth dla endpointów chronionych:
   - `Authorization: Bearer <token>` z `SOON_RUNTIME_BEARER_TOKEN`,
   - `x-api-key: <key>` z `SOON_RUNTIME_API_KEY`.
2. Workflow `runtime-state-watchdog` przekazuje opcjonalne sekrety auth:
   - `SOON_RUNTIME_BEARER_TOKEN`,
   - `SOON_RUNTIME_API_KEY`.
3. Dodano test skryptu potwierdzający obsługę chronionego endpointu (bearer auth).

### Testy / weryfikacja

1. `npm run test:scripts` -> PASS.
2. `npm run check` -> PASS.

### Ryzyka

1. Gdy endpoint produkcyjny wymaga auth, a sekrety auth nie są ustawione, watchdog kończy się `401` (fail-fast, intencjonalnie).

### Następny krok

1. Ustawić w GitHub Secrets:
   - `SOON_RUNTIME_BEARER_TOKEN` (preferowane) lub `SOON_RUNTIME_API_KEY`,
   a następnie uruchomić `runtime-state-watchdog` przez `workflow_dispatch`.

### Update (2026-04-16, runtime watchdog safe-enable switch)

1. Dodano bezpiecznik aktywacji watchdoga:
   - workflow uruchamia realny job tylko gdy repo variable:
     - `SOON_RUNTIME_WATCHDOG_ENABLED=1`.
2. Gdy flaga nie jest ustawiona:
   - workflow kończy się bez faila jako `watchdog-disabled`,
   - w `GITHUB_STEP_SUMMARY` jest jasna informacja jak go włączyć.

### Testy / weryfikacja

1. Walidacja syntaktyczna workflow + lokalny `npm run check` -> PASS.

### Ryzyka

1. Bez ustawienia flagi `SOON_RUNTIME_WATCHDOG_ENABLED=1` watchdog nie wykona realnego checku (świadomie).

### Następny krok

1. Na etapie deploy Soon ustawić:
   - `SOON_RUNTIME_WATCHDOG_ENABLED=1`,
   - `SOON_RUNTIME_BASE_URL`,
   - `SOON_RUNTIME_BEARER_TOKEN` lub `SOON_RUNTIME_API_KEY`,
   i dopiero wtedy aktywować monitorowanie runtime przez GitHub Actions.

### Update (2026-04-16, etap 5 token budget daily ledger)

1. Wdrożono dzienny, stanowy ledger budżetu tokenów:
   - nowa migracja: `packages/api/db/migrations/012_token_daily_budget_ledger.sql`,
   - store parity (memory + postgres):
     - `getTokenDailyBudgetStatus({ day, budgetTokens })`,
     - `consumeTokenDailyBudget({ day, budgetTokens, amountTokens })`.
2. `POST /automation/cycle` używa teraz realnego `remainingTokens` dla danego dnia:
   - capped policy jest stosowana do pozostałego dziennego budżetu,
   - po cyklu następuje konsumpcja `totalTokenCostSelected`,
   - response zawiera: `tokenPolicyApplied`, `tokenBudgetStatusBefore`, `tokenBudgetStatus`.
3. Dodano endpoint statusu budżetu:
   - `GET /token-control/budget/status`
   - `GET /api/token-control/budget/status`
   - opcjonalne query: `day`, `mode`, `budgetTokens`.
4. Rozszerzono metryki Prometheus:
   - `soon_token_budget_daily_limit_tokens`
   - `soon_token_budget_consumed_tokens`
   - `soon_token_budget_remaining_tokens`
   - `soon_token_budget_usage_pct`
   - `soon_token_budget_exhausted`
   - `soon_token_budget_policy_fallback_active`
5. Dodano alerty:
   - `SoonTokenDailyBudgetPressureWarn`
   - `SoonTokenDailyBudgetExhaustedCritical`

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS (30/30).
2. `npm run check` -> PASS (monitoring + contracts + workers + scripts + smoke:e2e).

### Ryzyka

1. Day-window jest liczony w UTC (`YYYY-MM-DD`); jeśli biznesowo potrzebny inny timezone, trzeba dodać explicit TZ policy.

### Następny krok

1. Dodać etap 6: scenariusz samonaprawy przy `token_budget_exhausted` (automatyczne obniżenie intensywności cyklu / smart deferral) i test kontraktowy dla degradacji graceful.

### Update (2026-04-16, etap 6 smart deferral przy token_budget_exhausted)

1. `automation/cycle` dostał tryb degradacji graceful:
   - gdy dzienny budżet tokenów jest wyczerpany, cykl przechodzi w `smart deferral`,
   - `tokenPolicy` zostaje `capped` z `budgetTokens=0`,
   - brak decyzji zakupowych (selected=0), plan oznacza pozycje jako `budget_exceeded`,
   - technical alert ma reason: `token_budget_exhausted_deferral`.
2. Dodano auto-remediację runtime-state:
   - key: `token_budget_last_deferral_at`,
   - payload: `timestamp`, `day`, `reason`, `deferredUntil`, `remainingTokens`,
   - key jest dostępny przez `GET /api/self-heal/runtime-state`.
3. Rozszerzono metryki:
   - `soon_token_budget_deferral_active`
   - `soon_token_budget_last_deferral_unixtime`
4. Uporządkowano logikę alokacji tokenów:
   - mode `capped` respektuje budżet `>= 0` (wcześniej `0` wpadało w `unbounded`).

### Testy / weryfikacja

1. Nowy kontrakt:
   - `POST /automation/cycle triggers smart deferral when daily token budget is exhausted`.
2. `npm run test:contracts` -> PASS (31/31).
3. `npm run check` -> PASS.

### Ryzyka

1. Smart deferral jest obecnie deterministiczny (budżet 0 => pełny deferral); ewentualny future step to adaptive partial sampling (np. 1 candidate/slot) przy minimalnym budżecie.

### Następny krok

1. Dodać parametr policy dla `partial deferral` (np. `minProbeBudgetTokens`) i test A/B: pełny deferral vs probe-mode.

### Update (2026-04-16, etap 7 one-shot smart probe przy token_budget_exhausted)

1. Rozszerzono `automation/cycle` o tryb `smart_probe`:
   - przy `token_budget_exhausted` system najpierw próbuje one-shot probe (max 1x/dzień),
   - probe budżet jest konfigurowany przez `tokenPolicy.probeBudgetTokens` lub ENV `SOON_TOKEN_EXHAUSTED_PROBE_BUDGET`,
   - kolejne wywołanie tego samego dnia przechodzi już do `smart_deferral`.
2. Runtime-state rozszerzony o nowy klucz:
   - `token_budget_last_probe_at` (`timestamp`, `day`, `reason`, `probeBudgetTokens`, `windowResetAt`),
   - klucz dodany do allowlist endpointu `GET /api/self-heal/runtime-state`.
3. Degradacja cyklu dostała dwa jawne tryby:
   - `token_budget_exhausted_probe`,
   - `token_budget_exhausted_deferral`.
4. Rozszerzono metryki token-budget:
   - `soon_token_budget_probe_active`,
   - `soon_token_budget_last_probe_unixtime`.
5. Uzupełniono kontrakty i dokumentację API:
   - nowy test scenariusza one-shot probe + fallback deferral,
   - README: nowe pole `tokenPolicy.probeBudgetTokens` i nowy ENV probe.

### Testy / weryfikacja

1. `npm run test:contracts` -> do uruchomienia po wdrożeniu etapu 7.
2. `npm run check` -> do uruchomienia po wdrożeniu etapu 7.

### Ryzyka

1. Probe jest celowo one-shot per UTC day; przy bardzo agresywnym zużyciu tokenów może być potrzebny limit oparty o częstotliwość (np. 1 probe/12h), a nie tylko day-key.

### Następny krok

1. Odpalić `npm run test:contracts` i `npm run check`, potem merge etapu 7.

### Update (2026-04-16, etap 8 cooldown-guarded smart probe)

1. Token probe przeszedł z reguły „1x/dzień” na regułę cooldown:
   - nowy parametr policy: `tokenPolicy.probeCooldownSec`,
   - nowy ENV fallback: `SOON_TOKEN_EXHAUSTED_PROBE_COOLDOWN_SEC` (default `86400`).
2. `POST /automation/cycle` rozszerzono o cooldown telemetry:
   - `tokenBudgetAutoRemediation.probeCooldownSec`,
   - `tokenBudgetAutoRemediation.probeCooldownRemainingSec`,
   - `tokenBudgetAutoRemediation.probeBlockedByCooldown`.
3. Runtime-state probe dostał explicit cooldown metadata:
   - `token_budget_last_probe_at.stateValue.cooldownSec`.
4. Endpoint `GET /api/self-heal/runtime-state` dla key `token_budget_last_probe_at` zwraca teraz `cooldown`.
5. Prometheus rozszerzony o metrykę:
   - `soon_token_budget_probe_cooldown_remaining_seconds`.
6. Kontrakty:
   - nowy test: drugi `smart_probe` po wygaśnięciu cooldown,
   - dodatkowe asercje telemetry probe + metryki cooldown.

### Testy / weryfikacja

1. `npm run test:contracts` -> do uruchomienia po wdrożeniu etapu 8.
2. `npm run check` -> do uruchomienia po wdrożeniu etapu 8.

### Ryzyka

1. Cooldown opiera się o timestamp ostatniego probe; jeśli potrzebny będzie limit hybrydowy (np. max N probe/dzień + cooldown), to trzeba dodać licznik per day-window.

### Następny krok

1. Dodać limit hybrydowy `maxProbesPerDay` i kontrakt dla kombinacji `cooldown + max/day`.

### Update (2026-04-16, etap 9 hybrid probe policy: cooldown + daily cap)

1. Token probe dostał politykę hybrydową:
   - nowy parametr policy: `tokenPolicy.maxProbesPerDay`,
   - nowy ENV fallback: `SOON_TOKEN_EXHAUSTED_PROBE_MAX_PER_DAY` (default `1`).
2. `POST /automation/cycle` rozszerzono o telemetry cap:
   - `tokenBudgetAutoRemediation.maxProbesPerDay`,
   - `tokenBudgetAutoRemediation.probesUsedToday`,
   - `tokenBudgetAutoRemediation.probesUsedAfterAction`,
   - `tokenBudgetAutoRemediation.probeBlockedByDailyCap`.
3. Runtime-state probe zapisuje licznik dzienny:
   - `token_budget_last_probe_at.stateValue.probesForDay`,
   - `token_budget_last_probe_at.stateValue.maxProbesPerDay`.
4. Prometheus rozszerzony o metryki dziennego cap:
   - `soon_token_budget_probe_daily_cap`,
   - `soon_token_budget_probe_daily_used`.
5. Uzupełniono kontrakty:
   - probe blocked by daily cap even after cooldown elapsed,
   - obecny test cooldownowy działa w wariancie `maxProbesPerDay=2`.

### Testy / weryfikacja

1. `npm run test:contracts` -> do uruchomienia po wdrożeniu etapu 9.
2. `npm run check` -> do uruchomienia po wdrożeniu etapu 9.

### Ryzyka

1. Przy bardzo dużym `maxProbesPerDay` i krótkim cooldown nadal można wygenerować wysokie zużycie tokenów; dla produkcji warto utrzymać bezpieczny cap.

### Następny krok

1. Dodać auto-tuning cap/cooldown na podstawie presji budżetu (`usagePct` i trend dzienny).

### Update (2026-04-16, etap 10 probe policy auto-tuning: pressure + daily trend)

1. Dodano auto-tuning polityki probe dla `POST /automation/cycle`:
   - nowy przełącznik policy: `tokenPolicy.autoTuneProbePolicy`,
   - nowe parametry floor: `tokenPolicy.probeAutoTuneMinCooldownSec`, `tokenPolicy.probeAutoTuneHighCooldownSec`,
   - fallback ENV:
     - `SOON_TOKEN_EXHAUSTED_PROBE_AUTOTUNE_ENABLED` (default `0`),
     - `SOON_TOKEN_EXHAUSTED_PROBE_AUTOTUNE_MIN_COOLDOWN_SEC` (default `21600`),
     - `SOON_TOKEN_EXHAUSTED_PROBE_AUTOTUNE_HIGH_COOLDOWN_SEC` (default `43200`).
2. Mechanika auto-tune:
   - wejście: `usagePct` bieżącego dnia + trend `usageDeltaPct` vs poprzedni dzień,
   - pasma presji: `medium | high | critical`,
   - efekt: podniesienie `probeCooldownSec` i ograniczenie `maxProbesPerDay` (tylko w kierunku bezpieczniejszym).
3. Telemetry `tokenBudgetAutoRemediation` rozszerzono o:
   - `configuredProbeCooldownSec`, `configuredMaxProbesPerDay`,
   - `probePolicyAutoTuneEnabled`, `probePolicyAutoTuneApplied`, `probePolicyAutoTuneReason`,
   - `probePolicyPressureBand`, `probePolicyUsagePct`, `probePolicyPreviousUsagePct`, `probePolicyUsageDeltaPct`.
4. Prometheus rozszerzony o:
   - `soon_token_budget_probe_autotune_enabled`.
5. Kontrakty rozszerzono o scenariusz:
   - auto-tune aktywny przy wysokiej presji -> podniesiony cooldown + obcięty cap + fallback do deferral przy kolejnym runie.

### Testy / weryfikacja

1. `npm run test:contracts` -> do uruchomienia po wdrożeniu etapu 10.
2. `npm run check` -> do uruchomienia po wdrożeniu etapu 10.

### Ryzyka

1. Przy złym strojeniu floorów auto-tune może być zbyt agresywny (za mało probe) albo zbyt liberalny (za dużo probe); dlatego default `autoTune=off`.
2. Trend dzienny opiera się o porównanie z poprzednim dniem w ledgerze; przy świeżym wdrożeniu brak historii może dawać skokowy `usageDeltaPct`.

### Następny krok

1. Dodać endpoint diagnostyczny policy (`/api/token-control/probe-policy`) z current config + ostatnia decyzja auto-tune dla operacyjnej obserwowalności.

### Update (2026-04-16, etap 11 probe-policy diagnostics endpoint)

1. Dodano endpoint diagnostyczny:
   - `GET /token-control/probe-policy`
   - `GET /api/token-control/probe-policy`
2. Endpoint zwraca:
   - `tokenPolicyConfig` (effective config + autotune flags),
   - `tokenBudgetStatus` dla wybranego dnia,
   - `tokenBudgetStatusPreviousDay` (trend reference),
   - `probeCooldown` (runtime-state cooldown snapshot),
   - `derivedAutoTuneDecision` (decyzja wyliczona „na teraz”),
   - `lastAutoTuneDecision` (ostatnia decyzja persisted w runtime-state probe).
3. Runtime-state probe (`token_budget_last_probe_at`) rozszerzono o persisted metadata autotune:
   - `autoTuneEnabled`, `autoTuneApplied`, `autoTuneReason`, `autoTunePressureBand`,
   - `autoTuneUsagePct`, `autoTunePreviousUsagePct`, `autoTuneUsageDeltaPct`.
4. Kontrakty:
   - nowy test `GET /api/token-control/probe-policy returns current config and auto-tune diagnostics`.

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS.
2. `npm run check` -> PASS.

### Ryzyka

1. `lastAutoTuneDecision` zależy od wystąpienia `smart_probe`; jeśli ostatnie runy kończyły się deferral bez probe, persisted decision może być historyczna.

### Następny krok

1. Dodać manualny reset `token_budget_last_probe_at` z audytem i guardrailami.

### Update (2026-04-16, etap 12 manual probe runtime-state reset + audit)

1. Dodano operacyjny endpoint resetu probe runtime-state:
   - `POST /token-control/probe-policy/reset`
   - `POST /api/token-control/probe-policy/reset`
2. Guardraile resetu:
   - wymagane potwierdzenie `confirm=RESET_TOKEN_BUDGET_PROBE_STATE`,
   - wymagany `reason` (min. 8 znaków),
   - cooldown resetów (`SOON_TOKEN_PROBE_RESET_COOLDOWN_SEC`, default `300`),
   - opcjonalny `dryRun=true`.
3. Audit resetu persisted:
   - nowy runtime-state key: `token_budget_probe_reset_audit_last`,
   - zapis: `timestamp`, `actor`, `reason`, `action`, `cooldownSec`, `previousProbeTimestamp`, `lastKnownProbesForDay`.
4. Endpoint diagnostyczny policy (`/api/token-control/probe-policy`) rozszerzono o:
   - `lastProbeResetAudit`.
5. Runtime-state probe resetuje się do neutralnego stanu (bez aktywnego cooldown i bez dziennego licznika).

### Testy / weryfikacja

1. `POST /api/token-control/probe-policy/reset`:
   - brak potwierdzenia -> `400 reset_confirmation_required`,
   - poprawny reset -> `200`,
   - ponowny reset w cooldown -> `409 reset_cooldown_active`.
2. `GET /api/token-control/probe-policy`:
   - zwraca `lastProbeResetAudit`.

### Ryzyka

1. Endpoint resetu jest celowo „mocny” operacyjnie; nadużywanie może maskować realne problemy tuningowe, dlatego cooldown i audit są obowiązkowe.

### Następny krok

1. Dodać prosty RBAC/ops key dla endpointu reset (gdy API będzie wystawione publicznie).

### Update (2026-04-16, etap 13 ops key guard dla resetu probe)

1. Dodano prosty RBAC-lite dla endpointu:
   - `POST /token-control/probe-policy/reset`
   - `POST /api/token-control/probe-policy/reset`
2. Gdy ustawione `SOON_TOKEN_PROBE_RESET_OPS_KEY`, endpoint wymaga:
   - `x-soon-ops-key: <secret>` lub
   - `Authorization: Bearer <secret>`.
3. Kody odpowiedzi:
   - brak klucza -> `401 ops_key_required`,
   - błędny klucz -> `403 ops_key_invalid`,
   - poprawny klucz -> normalny flow resetu (`200`, `400`, `409` wg guardraili resetu).
4. Implementacja porównania kluczy:
   - constant-time compare (`crypto.timingSafeEqual`).
5. Kontrakty rozszerzone:
   - nowy test `POST /api/token-control/probe-policy/reset enforces ops key when configured`.

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS lokalnie po dodaniu testu ops-key.

### Ryzyka

1. Przy braku `SOON_TOKEN_PROBE_RESET_OPS_KEY` endpoint pozostaje otwarty (intencjonalne dla dev/local), więc dla środowisk publicznych klucz musi być ustawiony.

### Następny krok

1. Dodać osobny endpoint `GET /api/token-control/probe-policy/reset-auth/status` (bez ujawniania sekretu), aby monitoring wiedział czy guard jest aktywny.

### Update (2026-04-16, etap 14 reset-auth status endpoint)

1. Dodano endpoint statusowy guardu auth:
   - `GET /token-control/probe-policy/reset-auth/status`
   - `GET /api/token-control/probe-policy/reset-auth/status`
2. Endpoint zwraca wyłącznie diagnostykę operacyjną (bez sekretów):
   - `auth.opsKeyRequired` (`true/false`),
   - `auth.acceptedHeaders` (`x-soon-ops-key`, `x-ops-key`, `authorization: bearer`).
3. Kontrakty rozszerzone o test:
   - `GET /api/token-control/probe-policy/reset-auth/status reports auth guard mode`
   - scenariusze: bez klucza (`false`) i z kluczem (`true`).

### Testy / weryfikacja

1. `npm run test:contracts` -> PASS (38/38).

### Ryzyka

1. Endpoint statusowy nie weryfikuje poprawności klucza (intencjonalnie) — raportuje tylko czy guard jest aktywny.

### Następny krok

1. Dodać `doctor` check: FAIL w CI/PROD, gdy `SOON_TOKEN_PROBE_RESET_OPS_KEY` nie jest ustawiony.

### Update (2026-04-16, etap 15 doctor-summary security gate dla probe reset ops key)

1. Rozszerzono `packages/api/scripts/doctor-summary.mjs`:
   - w trybie CI/PROD (`CI=1` lub `NODE_ENV/SOON_ENV/DEPLOY_ENV/ENVIRONMENT=prod|production`) wymagany jest `SOON_TOKEN_PROBE_RESET_OPS_KEY`,
   - brak klucza kończy `doctor-summary` błędem:
     `required env missing: SOON_TOKEN_PROBE_RESET_OPS_KEY`.
2. Dodano override konfiguracyjny:
   - `SOON_DOCTOR_SUMMARY_REQUIRE_PROBE_RESET_OPS_KEY=0|1`
   - (domyślnie auto: strict w CI/PROD, relaxed lokalnie).
3. `doctor-summary` raportuje teraz sekcję:
   - `Security Guards`
   - `Probe reset ops key required/configured`.
4. Testy skryptowe rozszerzone:
   - fail w CI strict mode przy braku klucza,
   - pass w CI strict mode przy ustawionym kluczu.
5. `README.md` doprecyzowano o politykę strict security gate w `make doctor` / `doctor-summary`.

### Testy / weryfikacja

1. `npm run test:scripts` -> PASS.

### Ryzyka

1. PR-y CI bez skonfigurowanego `SOON_TOKEN_PROBE_RESET_OPS_KEY` będą od teraz blokowane (intencjonalny quality gate).

### Następny krok

1. Ustawić `SOON_TOKEN_PROBE_RESET_OPS_KEY` w secretach repo/environment produkcyjnym i potwierdzić green CI na `quality-gate`.

### Update (2026-04-16, etap 16 ops key rotation for probe reset endpoint)

1. Dodano rotację klucza operacyjnego endpointu resetu probe:
   - `POST /token-control/probe-policy/reset-auth/rotate`
   - `POST /api/token-control/probe-policy/reset-auth/rotate`
2. Rotacja działa jako staged next key z grace window:
   - body: `confirm`, `reason`, `nextOpsKey`, opcjonalnie `actor`, `graceSec`, `dryRun`, `now`,
   - confirmation literal: `ROTATE_TOKEN_BUDGET_PROBE_RESET_OPS_KEY`.
3. Auth dla `POST /api/token-control/probe-policy/reset` rozszerzono:
   - akceptuje primary key (`SOON_TOKEN_PROBE_RESET_OPS_KEY`) albo aktywny staged key (w okresie grace).
4. Endpoint statusowy guardu auth rozszerzono o telemetry rotacji:
   - `rotation.active`, `rotation.expiresAt`, `rotation.remainingSec`, `rotation.nextOpsKeyFingerprint`,
   - `lastRotationAudit`.
5. Audit runtime-state:
   - `token_budget_probe_ops_key_rotation`
   - `token_budget_probe_ops_key_rotation_audit_last`.

### Testy / weryfikacja

1. Nowy kontrakt HTTP:
   - `POST /api/token-control/probe-policy/reset-auth/rotate stages next ops key with grace window`.
2. `npm run test:contracts` -> PASS.
3. `npm run check` -> PASS.

### Ryzyka

1. Rotacja staged wymaga bezpiecznego ustawienia docelowego sekretu w CI/produkcji przed upływem grace window.

### Następny krok

1. Dodać runbook operacyjny: sekwencja rotacji (`rotate -> update secret -> verify -> expire`) i checklistę rollback.
