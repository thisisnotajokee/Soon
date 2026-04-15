# Migration Blueprint (Controlled Rebuild)

## Zasada główna

Nie robimy jednorazowego przepisywania wszystkiego.
Robimy pionami funkcjonalnymi z twardym parity-gate po każdym etapie.
Zostajemy przy jednym projekcie (monorepo) z wyraźnym podziałem domenowym `tracking-core` / `hunter-core`.

Dodatkowa zasada:
1. Kalibrację AI/Huntera restartujemy logicznie od nowego baseline.
2. Nie kasujemy wiedzy: używamy historycznych danych i replay do strojenia.
3. Na produkcję wchodzi tylko to, co przejdzie canary + guardrails.

Dokument wykonawczy kalibracji:
- `docs/HUNTER_CALIBRATION_RESET_PLAN.md`

## Etap 0: Foundation

1. Ustalić kontrakty API (request/response) dla core flow.
2. Zdefiniować model domenowy produktu/trackingu/alertu.
3. Ustalić source-of-truth dla cen i fallbacków.
4. Usunąć z v1 forum i AI-user-facing z UI.

DONE:
- `packages/*` scaffold.
- dokumenty mechanik + parity matrix.

## Etap 1: Keepa + Tracking (MVP)

1. Endpoint listy trackingów (nowe + używane ceny per rynek).
2. Render listy i podstawowych kart produktu.
3. Wejście do szczegółów bez regresji UX.
4. Token-aware skan i fallback used z historii.

Gate:
- lista ładuje się stabilnie w PWA i Telegram.
- brak freeze/hard loading loop.
- spójność cen `new/used` na API i UI.

## Etap 2: Product Detail

1. API szczegółów produktu + historia cen.
2. UI wykresu + sekcja porównania rynków (new/used).
3. Zapis i odczyt progów alertów w szczegółach.
4. Brak endpointów AI dla użytkownika w UI.

Gate:
- zapis progów działa i jest od razu widoczny po odświeżeniu.
- brak regresji waluty.

## Etap 3: Hunter Core + Alerts Routing

1. Wdrożyć pipeline Huntera (deterministyczny baseline).
2. Rozdzielić routing alertów (zakupowe/techniczne).
3. Dodać testy kontraktowe kanałów i decyzji.

Gate:
- techniczne nigdy nie lecą na Telegram.
- Hunter ma stabilny precision/recall na replay dataset.

## Etap 4: Hunter AI Calibration (offline -> canary)

1. Offline replay historycznych runów i strojenie profili.
2. Champion/challenger z metrykami quality + tokens/deal.
3. Canary AI policy na części ruchu z auto-rollbackiem.

Gate:
- AI nie psuje jakości względem baseline.
- AI mieści się w guardrailach tokenowych.

## Etap 5: Self-Heal Automation

1. Watchdog + remediation playbooks dla scanner/hunter/alerts.
2. Auto-restart, auto-requeue, degrade-mode i recovery checks.
3. Diagnostyka przyczyn i audit remediation.

Gate:
- brak manualnych interwencji dla typowych awarii operacyjnych.

## Etap 6: Cutover candidate

1. Shadow run nowego API/UI (read-only compare).
2. Parity report przez kilka dni.
3. Rollout procentowy i rollback switch.

Gate:
- brak regresji krytycznej przez 72h.

## Etap 7: Decommission legacy

1. Oznaczyć moduły legacy jako read-only.
2. Usunąć nieużywane ścieżki i feature-flagi.
3. Zamknąć dokumentację na nową architekturę.
