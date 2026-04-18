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
