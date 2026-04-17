# Cutover Parity Audit — 2026-04-17

## Cel

Automatyczna ocena postępu migracji z `ambot-pro` do `Soon` pod kątem API/mechanik wymaganych do pełnego cutover.

## Źródła i metoda

1. Inwentarz legacy endpointów: `docs/API_ENDPOINT_INVENTORY.md` (wygenerowany z `ambot-pro`).
2. Endpointy Soon: ekstrakcja z `packages/api/src/runtime/server.mjs` (`method === ...` + `pathname === ...`).
3. Porównanie exact-match `METHOD + PATH`.

## Wynik liczbowy (exact-match)

1. Legacy endpointy (`ambot-pro`): `161`
2. Endpointy pokryte exact-match w `Soon`: `2`
3. Brakujące względem exact-match: `159`

Dopasowane:

1. `GET /api/check-alert-status`
2. `GET /api/runtime-self-heal-status`

## Wnioski

1. Migracja **nie jest jeszcze kompletna**.
2. `Soon` ma stabilny runtime/ops (self-heal, watchdog, token-control, alert-routing), ale nie ma jeszcze parity funkcjonalnego z legacy warstwą API dla pełnego produktu.
3. To jest zgodne z dotychczasowym podejściem „Hunter/Keepa/self-heal first”, ale **nie spełnia** warunku finalnego cutover 100%.

## Zakres i interpretacja

1. Część domen z `ambot-pro` jest świadomie poza v1 (`DROP`/`LATER`), m.in. forum i AI user-facing UI.
2. Mimo tego, dla pełnego cutover nadal brakuje dużej części endpointów związanych z tracking/keepa/hunter/settings/mobile/admin.
3. Exact-match jest metryką konserwatywną: pokazuje twarde pokrycie kontraktu HTTP, nie semantyczne „podobieństwo” funkcji.

## Decyzja operacyjna

1. `Soon` jest gotowy jako stabilna platforma runtime/ops.
2. `Soon` **nie jest jeszcze gotowy** do finalnego zastąpienia `ambot-pro` jako pełny produkt produkcyjny.

## Kolejny krok (P0)

1. Zdefiniować i zatwierdzić „Cutover P0 Contract Set” (minimalny zestaw endpointów/mechanik wymaganych do przełączenia ruchu).
2. Dla każdego P0 endpointu oznaczyć status: `DONE` / `MISSING` / `INTENTIONAL_DROP`.
3. Uruchomić parity gate dla tego zestawu w CI.
