# Soon (rebuild scaffold)

Cel: nowa, czysta wersja systemu Hunter + Keepa ze 100% automatyzacją operacyjną i self-healing jako standardem.

Status: scaffold architektury v1 + działający runtime API MVP.

## Kluczowe dokumenty

1. `docs/TARGET_ARCHITECTURE_V1.md` — docelowa architektura.
2. `docs/MODULE_MAP_V1.md` — mapa modułów i odpowiedzialności.
3. `docs/DB_MODEL_V1.md` — relacyjny model danych DB-first.
4. `docs/MUST_KEEP_MECHANICS.md` — krytyczne mechaniki do zachowania.
5. `docs/MIGRATION_BLUEPRINT.md` — plan etapowej migracji.
6. `docs/CONTRACT_TEST_MATRIX.md` — parity i testy kontraktowe.
7. `docs/ENV_MINIMUM_POLICY.md` — polityka przenoszenia tylko niezbędnych zmiennych ENV.
8. `docs/PROJECT_WORKLOG.md` — bieżący worklog i kluczowe decyzje.

## Architektura

1. Jeden projekt (monorepo), bez splitu na dwa repo.
2. Dwa rdzenie domenowe: `tracking-core` i `hunter-core`.
3. Dodatkowe rdzenie autonomii: `token-control-plane`, `autonomy-orchestrator`, `self-heal-controller`, `alert-router`, `ml-platform`.

## Szybki start

1. `npm install`
2. `make up`
3. `make doctor`
4. `make smoke`
5. `make down` (na koniec)

## Komendy operacyjne (Makefile)

1. `make up` — migracje + start API w tle + wait for health.
2. `make status` — szybki podgląd `health` i `read-model status`.
3. `make check` — local checker progów alertów read-modelu.
4. `make doctor` — pełny raport diagnostyczny + triage self-heal requeue (flow status -> dead-letter -> requeue-bulk -> audit -> summary).
5. `make doctor-json` — pełny raport JSON na stdout.
6. `make smoke` — pełny quality gate (`contracts + workers + smoke:e2e`).
7. `make down` — stop API uruchomionego przez `make up`.
8. `make restart` — restart API.
9. `make logs` — podgląd logów API (`/tmp/soon-api.log`).

Skrypty pomocnicze:

1. `npm run ops:self-heal:requeue:triage`
2. `npm run ops:self-heal:requeue:triage:json`

Polityka triage:

1. Lokalnie domyślnie `SOON_SELF_HEAL_TRIAGE_WARN_AS_ERROR=0` (WARN nie przerywa `make doctor`).
2. W CI ustawiamy `SOON_SELF_HEAL_TRIAGE_WARN_AS_ERROR=1` (WARN traktowany jako błąd quality gate).

## Runbook self-heal (dead-letter)

1. `curl -fsS http://127.0.0.1:3100/self-heal/retry/status`
2. `curl -fsS "http://127.0.0.1:3100/self-heal/dead-letter?limit=20"`
3. `curl -fsS -X POST http://127.0.0.1:3100/self-heal/dead-letter/requeue-bulk -H 'content-type: application/json' -d '{"limit":20}'`
4. `curl -fsS "http://127.0.0.1:3100/self-heal/requeue-audit?limit=20"`
5. `curl -fsS "http://127.0.0.1:3100/self-heal/requeue-audit/summary?days=7"`

## Tryby storage

1. `SOON_DB_MODE=memory` (domyślnie)
2. `SOON_DB_MODE=postgres` + `SOON_DATABASE_URL`
3. `npm run db:migrate` dla migracji SQL

Przykładowe zmienne: `.env.example`.

## Sposób pracy

1. Przenosimy tylko minimum sprawdzonych mechanik.
2. AI/tuning kalibrujemy od nowego baseline (offline -> canary -> rollout).
3. W legacy robimy wyłącznie hotfixy produkcyjne.
4. Każdą kluczową decyzję i wynik testów zapisujemy w `docs/PROJECT_WORKLOG.md`.
