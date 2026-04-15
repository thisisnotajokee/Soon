# Self-Heal Alert Routing + Auto-Remediation Runbook v1

## Cel

Runbook definiuje minimalny, operacyjny standard dla:

1. klasyfikacji alertu (purchase vs technical),
2. poprawnego routingu kanałów (Telegram/Discord),
3. auto-remediacji przy driftach routingu,
4. audytu i weryfikowalności decyzji.

## Zakres v1

1. API runtime:
   - `/api/check-alert-status`
   - `/api/runtime-self-heal-status`
   - `/self-heal/run`
   - `/self-heal/retry/process`
2. Monitoring:
   - metryki `soon_alert_routing_*`
   - metryki `soon_self_heal_retry_*`
3. Self-heal:
   - dead-letter + manual requeue + retry budget exhaustion.

## Invarianty (MUST)

1. Alert `purchase` trafia wyłącznie na `telegram`.
2. Alert `technical` trafia wyłącznie na `discord`.
3. Każde naruszenie polityki musi zostać zapisane telemetrycznie.
4. Każdy retry self-heal musi mieć:
   - jawny backoff,
   - licznik retries,
   - terminalny reason po wyczerpaniu budżetu.

## Auto-Remediation v1

1. Detect:
   - runtime wykrywa violation policy (`/api/check-alert-status`).
2. Diagnose:
   - self-heal klasyfikuje anomaly code i dobiera playbook.
3. Act:
   - retry queue uruchamia playbook z limit/backoff guardrails.
4. Record:
   - każda próba i outcome trafia do execution/dead-letter/audit.
5. Observe:
   - Prometheus eksportuje pending/dead-letter/exhausted/backoff.

## Checklista wdrożeniowa

1. Contracts: API zwraca spójny `status/overall/violations`.
2. Workers: retry path ma test dla `retry`, `done`, `dead_letter`.
3. Metrics: `soon_self_heal_retry_exhausted_total` obecne.
4. Metrics: `soon_self_heal_retry_backoff_seconds` obecne.
5. Dead-letter: reason `retry_budget_exhausted` testowalny.
6. CI: `npm run check` musi przejść na branchu i po merge do `main`.

## Kryterium DONE (v1)

1. Wszystkie powyższe punkty check-listy spełnione.
2. PR zawiera testy kontraktowe i workers dla retry hardening.
3. `main` po merge przechodzi pełny `npm run check`.
