# ENV Minimum Policy (Soon)

Cel: utrzymać porządek i przenosić wyłącznie niezbędne zmienne środowiskowe.

## Zasada główna

Do `Soon` przenosimy tylko zmienne wymagane do uruchomienia aktualnego zakresu v1.

## Aktualny minimalny zestaw (v1)

### Zawsze wymagane

1. `HOST`
2. `PORT`
3. `SOON_DB_MODE` (`memory` albo `postgres`)

### Wymagane tylko dla `SOON_DB_MODE=postgres`

1. `SOON_DATABASE_URL`
2. `SOON_DATABASE_SSL` (opcjonalne, domyślnie `0`)

## Czego nie przenosimy teraz

1. Zmienne legacy z `ambot-pro` niezwiązane z runtime `Soon`.
2. Sekrety i parametry dla modułów jeszcze niezaimplementowanych.
3. "Na zapas" konfiguracje bez aktywnego użycia w kodzie.

## Reguła zmiany ENV

Każde dodanie nowej zmiennej wymaga:

1. Uzasadnienia w PR/commicie (po co i gdzie jest używana).
2. Aktualizacji `.env.example`.
3. Wpisu do `docs/PROJECT_WORKLOG.md` (sekcja decyzji).

## Szybki check przed merge

1. `rg "process\.env\." /home/piotras/Soon/packages -n`
2. Zweryfikować, że każda używana zmienna istnieje w `.env.example`.
