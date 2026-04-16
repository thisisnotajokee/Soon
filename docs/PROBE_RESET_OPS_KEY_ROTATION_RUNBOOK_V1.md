# Probe Reset Ops Key Rotation Runbook v1

## Cel

Runbook definiuje bezpieczną rotację klucza `SOON_TOKEN_PROBE_RESET_OPS_KEY` dla endpointu:

1. `POST /api/token-control/probe-policy/reset`
2. `POST /api/token-control/probe-policy/reset-auth/rotate`

## Invarianty (MUST)

1. W danym momencie działa co najmniej jeden poprawny klucz operacyjny.
2. Rotacja zawsze ma jawny `reason` i `actor`.
3. Po rotacji musi być wykonana weryfikacja statusu auth (`reset-auth/status`).
4. Sekret docelowy w CI/PROD jest aktualizowany przed końcem grace window.

## Sekwencja rotacji (standard)

1. **Pre-check**
   - uruchom preflight helper:  
     `npm run ops:probe-reset:preflight`
   - opcjonalnie zapisz artifact JSON:  
     `SOON_PROBE_RESET_PREFLIGHT_OUT=ops/reports/doctor/probe-reset-preflight.json npm run ops:probe-reset:preflight`
   - potwierdź, że guard jest aktywny:  
     `GET /api/token-control/probe-policy/reset-auth/status`
   - oczekiwane: `auth.opsKeyRequired=true`.
2. **Stage nowego klucza**
   - wywołaj:
     - `POST /api/token-control/probe-policy/reset-auth/rotate`
   - body minimalne:
     - `confirm="ROTATE_TOKEN_BUDGET_PROBE_RESET_OPS_KEY"`
     - `reason="<ticket/incydent>"`
     - `nextOpsKey="<nowy-sekret>"`
     - opcjonalnie: `actor`, `graceSec`.
3. **Update secret**
   - ustaw nowy sekret w środowisku docelowym jako:
     - `SOON_TOKEN_PROBE_RESET_OPS_KEY=<nextOpsKey>`.
   - dotyczy: runtime host + GitHub Actions secrets (jeśli workflow używa tego klucza).
4. **Verify**
   - `GET /api/token-control/probe-policy/reset-auth/status`
   - oczekiwane:
     - `rotation.active=true` (w trakcie grace),
     - widoczny fingerprint `rotation.nextOpsKeyFingerprint`,
     - brak błędów auth w testowym wywołaniu endpointu resetu z nowym kluczem.
5. **Expire / finalize**
   - po zakończeniu grace window staged key przestaje działać automatycznie.
   - status powinien wrócić do `rotation.active=false`.

## Checklista rollback

Użyj rollback, jeśli po `update secret` występują błędy `401/403` lub brak spójności między runtime a CI.

1. Natychmiast przywróć poprzedni sekret w runtime:
   - `SOON_TOKEN_PROBE_RESET_OPS_KEY=<poprzedni-klucz>`.
2. Natychmiast przywróć poprzedni sekret w GitHub Actions secretach.
3. Potwierdź:
   - `GET /api/token-control/probe-policy/reset-auth/status`
   - test resetu probe przechodzi z przywróconym kluczem.
4. Oznacz incydent i zapisz przyczynę w worklogu (`reason + requestId + timestamp`).
5. Powtórz rotację dopiero po usunięciu przyczyny (np. błędna dystrybucja sekretu).

## Minimalny payload (przykład)

```json
{
  "confirm": "ROTATE_TOKEN_BUDGET_PROBE_RESET_OPS_KEY",
  "reason": "security-rotation-2026-04-16",
  "nextOpsKey": "soon_ops_key_next_xxxxxxxxxxxxxxxx",
  "actor": "ops-bot",
  "graceSec": 3600
}
```

## Kryterium DONE

1. Rotacja wykonana bez przerwy działania endpointu resetu.
2. Status auth pokazuje poprawny stan rotacji i audit.
3. Sekret runtime i sekret CI są spójne.
4. Worklog zawiera wpis operacyjny z datą i `reason`.
