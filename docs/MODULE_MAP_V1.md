# MODULE MAP V1 (Soon)

## tracking-core

1. Entity: tracking i ceny new/used.
2. Use-cases: lista trackingów, zapis progów.
3. HTTP: endpointy trackingów.

## hunter-core

1. Sygnały -> scoring -> decyzja.
2. Persist decyzji i audyt powodów.
3. Integracja z token-control-plane.

## token-control-plane

1. Priorytetyzacja skanów wg value/token.
2. Budżety dzienne i okna decyzyjne.
3. Guardraile kosztowe.

## autonomy-orchestrator

1. Uruchamianie cykli scan/score/dispatch.
2. Planowanie retry/requeue.
3. Integracja health gate.

## self-heal-controller

1. Detekcja anomalii operacyjnych.
2. Dobór playbooka.
3. Weryfikacja efektu i rollback.

## alert-router

1. Routing kanałów wg typu alertu.
2. Idempotencja wysyłki.
3. Kontraktowe testy separacji kanałów.

## ml-platform

1. Offline replay.
2. Canary champion/challenger.
3. Brak AI user-facing.
