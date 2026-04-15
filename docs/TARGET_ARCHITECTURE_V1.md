# TARGET ARCHITECTURE V1 (Soon)

## Priorytety

1. Hunter-first.
2. Keepa-first.
3. 100% automation jako cel operacyjny.
4. Self-healing jako wymóg runtime.

## Warstwy systemu

1. `tracking-core` — ceny, trackingi, progi, fallback z historii.
2. `hunter-core` — scoring i decyzje dealowe.
3. `token-control-plane` — automatyczna alokacja tokenów.
4. `autonomy-orchestrator` — harmonogram i egzekucja cykli.
5. `self-heal-controller` — diagnoza i remediacja.
6. `alert-router` — twarde reguły kanałów.
7. `ml-platform` — inference/tuning/canary bez AI UI.

## Twarde reguły v1

1. Zakupowe alerty -> Telegram.
2. Techniczne alerty -> Discord.
3. AI nie jest jedynym decydentem (baseline regułowy obowiązkowy).
4. Każda remediacja ma audit trail i rollback.

## Topologia repo

- `packages/api/src/domains/*` — rdzenie domenowe.
- `packages/api/src/workers/*` — workery automation/self-heal.
- `packages/shared/src/contracts/*` — kontrakty współdzielone.
- `packages/web` — UI operatora i trackingów (bez AI user-facing).
