# Hunter Calibration Reset Plan

Cel: rozpocząć kalibrację od nowego baseline logicznego, ale wykorzystać pełne historyczne dane z obecnego systemu.

## Założenia

1. Resetujemy profile AI/progi/autotune do nowego baseline.
2. Zachowujemy historyczne dane (runy, alerty, price_history, decyzje) jako dataset replay.
3. Produkcyjny rollout tylko przez canary i guardrails.

## Faza 1: Baseline deterministic

1. Definiujemy twarde reguły Huntera (bez AI override).
2. Ustalamy metryki bazowe:
- precision,
- recall,
- false-positive rate,
- tokens/deal,
- median decision latency.
3. Uruchamiamy replay na danych historycznych i zapisujemy benchmark.

## Faza 2: Offline AI calibration

1. AI działa offline na tym samym replay datasecie.
2. Budujemy profile `champion/challenger`.
3. AI może zmieniać ranking, ale nie łamie twardych reguł jakości.

Warunki przejścia:
1. AI >= baseline quality.
2. AI <= baseline token burn (lub lepiej).

## Faza 3: Canary production

1. Włączamy AI policy na małym procencie ruchu.
2. Porównujemy champion vs challenger live.
3. Auto-rollback przy przekroczeniu guardrail.

## Guardrails (hard stop)

1. Wzrost false-positive ponad próg -> rollback.
2. Wzrost tokens/deal ponad próg -> rollback.
3. Spadek precision poniżej baseline -> rollback.
4. Wzrost błędów runtime/timeout -> rollback.

## Self-heal i operacja

1. Każdy eksperyment AI ma watchdog i health probe.
2. Auto-retry + dead-letter queue + circuit breaker.
3. Każdy rollback zapisuje przyczynę i snapshot metryk.

## Kryterium zakończenia kalibracji

Kalibracja uznana za domkniętą, gdy przez co najmniej 7 dni:
1. jakość decyzji nie jest gorsza od baseline,
2. token efficiency nie jest gorszy od baseline,
3. nie ma ręcznych interwencji krytycznych w pętli Huntera.

