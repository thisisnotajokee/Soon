# Must Keep Mechanics (v1 - Hunter First)

Priorytet v1:

1. Keepa + tracking cen muszą działać stabilnie i przewidywalnie.
2. Hunter jest głównym produktem i główną przewagą.
3. Self-healing i pełna automatyka to wymaganie, nie dodatek.

## A. Core product flow

1. Uwierzytelnienie Telegram WebApp + sesja użytkownika.
2. Zakładka `Śledzenie` z listą ASIN i cenami między rynkami.
3. Szczegóły produktu (historia cen, porównanie rynków, progi).
4. Dodawanie/usuwanie śledzenia.
5. Zapisywanie progów (`spadek`, `wzrost`, `target`, `target używane`).

## B. Keepa and pricing reliability

1. Ceny `new` i `used` per rynek (`de,it,fr,es,uk,nl`).
2. Fallback danych z `price_history` gdy pola produktowe są puste.
3. Stabilna normalizacja walut (EUR/GBP; bez przypadkowego USD w EU UI).
4. Token-aware scanning (budżet i guardy).
5. Deterministyczne reguły jakości danych cenowych (anti-outlier).

## C. Hunter (main objective)

1. Pipeline Hunter: selekcja -> scoring -> filtr jakości -> decyzja.
2. Priorytetyzacja tokenów wg expected value / token cost.
3. AI tylko backendowo: ranking, policy tuning, anomaly detection.
4. Pełny audit decyzji Huntera (dlaczego alert poszedł/nie poszedł).

## D. Alerts and channel policy

1. Alerty zakupowe -> Telegram.
2. Alerty techniczne -> Discord.
3. Twarda separacja routingów (brak przecieków między kanałami).

## E. Self-healing and automation

1. Watchdog + health SLO dla scanner/hunter/alerts.
2. Auto-retry + circuit breaker + dead-letter queue.
3. Auto-remediation playbooks (restart/requeue/degrade mode/cache rebuild).
4. Autodiagnoza przyczyny awarii i zapis działań naprawczych.

## F. UX/PWA baseline

1. Stabilna nawigacja wstecz (bez zamykania app przy modalach/szczegółach).
2. Brak przypadkowego otwierania szczegółów podczas scrollowania.
3. PWA i Telegram MiniApp zachowują się funkcjonalnie tak samo.

## G. Out of scope on v1 start

1. Forum i cały social layer.
2. AI funkcje widoczne dla usera w UI.
3. Eksperymenty UI niezwiązane z tracking/hunter.
