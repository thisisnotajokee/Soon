# Cutover P0 Contract Set v1

Data: 2026-04-17
Cel: minimalny, twardy zestaw kontraktów wymaganych do finalnego przełączenia produkcji z `ambot-pro` na `Soon`.

Statusy:

1. `DONE` — wdrożone i zweryfikowane w Soon.
2. `MISSING` — brak w Soon (blokuje pełny cutover).
3. `INTENTIONAL_DROP` — celowo wycięte z v1 (nie blokuje cutover v1).

## P0-A. Runtime + Ops + Self-Heal

1. `GET /health` — `DONE`
2. `GET /metrics` — `DONE`
3. `GET /api/runtime-self-heal-status` — `DONE`
4. `GET /api/check-alert-status` — `DONE`
5. `GET /api/self-heal/runtime-state` — `DONE`
6. `POST /self-heal/run` — `DONE`
7. `POST /self-heal/retry/process` — `DONE`
8. `GET /self-heal/dead-letter` — `DONE`
9. `POST /self-heal/dead-letter/requeue-bulk` — `DONE`

## P0-B. Token Control Plane

1. `POST /api/token-control/allocate` — `DONE`
2. `GET /api/token-control/snapshots/latest` — `DONE`
3. `GET /api/token-control/budget/status` — `DONE`
4. `GET /api/token-control/probe-policy` — `DONE`
5. `POST /api/token-control/probe-policy/reset` — `DONE`
6. `GET /api/token-control/probe-policy/reset-auth/status` — `DONE`
7. `POST /api/token-control/probe-policy/reset-auth/rotate` — `DONE`

## P0-C. Tracking Core (must-have produktowe)

1. `POST /api/trackings/save` — `DONE`
2. `DELETE /api/trackings/:chatId/:asin` — `DONE`
3. `GET /api/dashboard/:chatId` — `DONE`
4. `GET /api/history/:asin` — `DONE`
5. `POST /api/refresh/:asin` — `DONE`
6. `POST /api/refresh-all/:chatId` — `DONE`
7. `POST /api/trackings/:chatId/:asin/snooze` — `DONE`
8. `DELETE /api/trackings/:chatId/:asin/snooze` — `DONE`
9. `POST /api/settings/:chatId/product-interval` — `DONE`

## P0-D. Keepa Core

1. `GET /api/keepa/status` — `DONE`
2. `GET /api/keepa/deals` — `DONE`
3. `GET /api/keepa/history/:asin` — `DONE`
4. `POST /api/keepa/watch-state/ingest` — `DONE`
5. `POST /api/keepa/events/ingest` — `DONE`
6. `GET /api/keepa/token-usage` — `DONE`

## P0-E. Hunter Core (backend only)

1. `GET /api/hunter-config` — `MISSING`
2. `POST /api/hunter-config/run-now` — `MISSING`
3. `POST /api/hunter-config/custom` — `MISSING`
4. `GET /api/hunter-slo` — `MISSING`
5. `GET /api/hunter-smart-engine` — `MISSING`
6. `GET /api/hunter-autonomy-decision-health` — `MISSING`

## P0-F. Alert Routing Policy

1. purchase -> Telegram only — `DONE` (telemetry + check endpoint)
2. technical -> Discord only — `DONE` (telemetry + check endpoint)
3. kontraktowe testy separacji kanałów — `DONE`

## P0-G. Celowo poza v1 (nie blokuje)

1. Forum (`/api/forum/*`) — `INTENTIONAL_DROP`
2. AI user-facing (`/api/ai/chat`, AI cards dla usera) — `INTENTIONAL_DROP`

## Kryterium gotowości do full cutover

1. Wszystkie pozycje `P0-C`, `P0-D`, `P0-E` muszą przejść z `MISSING` -> `DONE`.
2. Co najmniej 2 kolejne zielone cykle: `quality-gate` + `runtime-state-watchdog` po wdrożeniu tych braków.
3. Smoke produkcyjny na VM210: health + check + self-heal triage + snapshot post-deploy.

## Następny krok implementacyjny

1. Etap P0-1: Tracking Core (`P0-C`) jako pierwszy pakiet wdrożeniowy.
2. Etap P0-2: Keepa Core (`P0-D`).
3. Etap P0-3: Hunter Core backend (`P0-E`).
