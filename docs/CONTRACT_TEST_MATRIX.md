# Contract / Parity Test Matrix

## Krytyczne kontrakty

1. `GET /trackings` zwraca:
- `asin`, `title`, `price_*`, `price_used_*`, `enabled_domains`, `target_*`.
2. `GET /products/:asin/detail` zwraca:
- metryki, historię cen, aktywne alerty, progi.
3. `POST /trackings/:asin/thresholds` zapisuje:
- `drop_pct`, `rise_pct`, `target_new`, `target_used`.
4. `POST /alerts/dispatch` kieruje event do właściwego kanału.

## Parity checklist (manual + automated)

1. Lista śledzonych ładuje się bez pętli ładowania.
2. Ceny używane są widoczne dla ASIN z danymi.
3. Szczegóły produktu pokazują historię i metryki.
4. Zapis progów działa i persistuje.
5. Back navigation nie zamyka aplikacji.
6. Klik ceny otwiera Amazon bez pośrednich ekranów.
7. Telegram: tylko alerty zakupowe.
8. Discord: tylko alerty techniczne.

## Testy automatyczne (minimum)

1. Contract tests API (shape + nullable semantics).
2. Integration tests dla zapisu progów.
3. E2E smoke: tracking list -> detail -> save threshold -> verify.
4. E2E channel routing: synthetic technical alert does not reach Telegram.

