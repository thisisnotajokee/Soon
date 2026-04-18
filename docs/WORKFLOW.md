# Simplified Workflow

Cel: szybki, powtarzalny flow bez rozjazdów gałęzi.

## Zasady

1. Pracujemy zawsze na gałęzi taskowej (nie na `main`).
2. Jedno zadanie = jedna gałąź = jeden PR.
3. Przed push uruchamiamy `make check` (dla UI opcjonalnie smoke).
4. Po merge wracamy na `main` i synchronizujemy repo.

## Start pracy

```bash
make wf-start BRANCH=feat/<krótka-nazwa>
```

Co robi:
1. `git checkout main`
2. `git pull --ff-only`
3. `git checkout -b <branch>`

## Zakończenie pracy

```bash
make wf-finish
```

Co robi:
1. uruchamia `make check`
2. wypisuje następne kroki:
   - commit
   - push
   - utworzenie PR

## Manual fallback

Jeśli nie używasz `make`:

```bash
git checkout main
git pull --ff-only
git checkout -b feat/<name>
# ...zmiany...
make check
git add -A
git commit -m "feat: <scope>"
git push -u origin feat/<name>
gh pr create --base main --head feat/<name>
```

## Testy na Smartphonie (LAN)

1. Uruchom API dostępne w sieci lokalnej:

```bash
make up-lan
```

2. Wygeneruj URL dla telefonu (z `chatId`):

```bash
make mobile-url CHAT_ID=demo
```

3. Otwórz wyświetlony URL na smartphonie (ta sama sieć Wi-Fi).

### Wariant Docker Desktop

```bash
make docker-up
make docker-mobile-url CHAT_ID=demo
```

Po testach:

```bash
make docker-down
```
