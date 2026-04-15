# Project Boundary Decision (2026-04-15)

## Decyzja

Utrzymujemy **jeden projekt** (monorepo) i nie dzielimy teraz systemu na dwa osobne repozytoria (`Hunter` i `Tracking`).

## Jak to realizujemy

1. Jeden repo, jeden pipeline release.
2. Dwa rdzenie domenowe:
- `tracking-core` (Keepa, ceny, trackingi, alert thresholds),
- `hunter-core` (scoring, policy, autotune, AI backend).
3. Wspólne kontrakty w `packages/shared`.
4. Operacyjnie: osobne procesy/workery, ale wspólny lifecycle i observability.

## Dlaczego ta decyzja

1. Mniejsze ryzyko rozjazdu kontraktów API i modeli danych.
2. Jedno źródło prawdy dla mechanik cross-domain (alert routing, quality gates, self-heal).
3. Prostsze testy parity i szybszy cutover bez synchronizacji między repo.
4. Niższy koszt utrzymania i mniej punktów awarii w CI/CD.

## Co byłoby sygnałem do rozdziału w przyszłości

1. Niezależne cykle release, które regularnie się blokują.
2. Stały konflikt wymagań skalowania runtime między trackingiem i hunterem.
3. Wąskie gardła zespołowe wynikające z jednego repo mimo czystych granic domenowych.

## Non-goals (teraz)

1. Brak podziału na dwa osobne produkty.
2. Brak duplikacji modeli danych między domenami.
3. Brak AI user-facing w UI v1.
