# Post-Deploy Backup + Rollback Runbook v1

## Cel

Runbook definiuje szybki, powtarzalny pakiet bezpieczeństwa po wdrożeniu Soon:

1. snapshot krytycznej konfiguracji runtime,
2. kontrolowany rollback do wskazanego refa git,
3. checklista GO/NO-GO po zmianie.

## Skrypty

1. `scripts/ops/post-deploy-snapshot.sh`
2. `scripts/ops/rollback-vm210.sh`

## Założenia

1. Host runtime: `soonadmin@192.168.1.210`
2. Root repo na serwerze: `/home/soonadmin/Soon`
3. Usługi systemowe:
   - `soon-api.service`
   - `cloudflared.service`

## Snapshot po wdrożeniu

Uruchom w lokalnym repo Soon:

```bash
npm run ops:deploy:snapshot
```

Wynik:

1. archiwum `ops/reports/deploy/soon-post-deploy-backup-<timestamp>.tgz`
2. metadata JSON `ops/reports/deploy/soon-post-deploy-backup-<timestamp>.meta.json`

Snapshot obejmuje:

1. `/home/soonadmin/Soon/.env.local`
2. `/etc/systemd/system/soon-api.service`
3. `/etc/cloudflared/config.yml`
4. `/etc/cloudflared/*.json`

## Rollback kontrolowany

1. Wybierz ref (commit/tag), np. `dbb6956`.
2. Uruchom rollback:

```bash
npm run ops:deploy:rollback -- dbb6956 --yes
```

Rollback wykonuje:

1. `git fetch origin`
2. `git checkout <ref>`
3. `npm ci`
4. `npm run db:migrate`
5. `systemctl restart soon-api`
6. health-check `http://127.0.0.1:3100/health`

## Checklista GO/NO-GO

1. `quality-gate` na `main` = PASS
2. `runtime-state-watchdog` = PASS
3. `https://api.ambot.nl/health` = 200
4. `systemctl is-active soon-api cloudflared` = `active active`
5. `make check` na VM210 = PASS

NO-GO:

1. którykolwiek warunek wyżej nie jest spełniony,
2. rollback nie kończy się health-checkiem 200,
3. watchdog zwraca CRIT.
