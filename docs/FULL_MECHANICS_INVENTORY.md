# Full Mechanics Inventory (do selekcji migracji)

Wersja: 2026-04-15  
Cel: pełna lista mechanik funkcjonalnych z obecnego kodu, aby wskazać co przenosimy do nowego repo.

Uwaga:
1. To jest inwentarz **mechanik produktowych i operacyjnych** (grupowany semantycznie).
2. Pełny, surowy spis artefaktów technicznych masz w:
- `docs/API_ENDPOINT_INVENTORY.md`
- `docs/UI_MODULE_INVENTORY.md`
- `docs/SERVICE_MODULE_INVENTORY.md`
3. Decyzje zakresu v1 (`KEEP/LATER/DROP`) są zapisane w:
- `docs/V1_SCOPE_DECISIONS.md`

---

## A. Dostęp, sesja, tożsamość

- [ ] A001. Logowanie przez Telegram WebApp (`initData`, sesja web).
- [ ] A002. Mobilna autoryzacja Telegram (`/api/mobile/v1/auth/telegram`).
- [ ] A003. Refresh tokenów sesji mobile.
- [ ] A004. Lista sesji mobile + revoke pojedynczej sesji.
- [ ] A005. Logout bieżącej sesji i logout-all.
- [ ] A006. Endpoint `whoami` i identyfikacja użytkownika.
- [ ] A007. Ochrona endpointów admin-only (fail-closed).
- [ ] A008. Guard podszywania admin/session guard.
- [ ] A009. Web UI auth policy + sesje web-ui.
- [ ] A010. Logout innych sesji (`/api/sessions/logout-others`).

## B. Śledzenie produktów (core)

- [ ] B001. Dodanie ASIN do śledzonych.
- [ ] B002. Usunięcie pojedynczego trackingu.
- [ ] B003. Masowe usunięcie trackingów użytkownika.
- [ ] B004. Odczyt listy trackingów (`/api/trackings/:chatId`).
- [ ] B005. Odczyt dashboardu trackingów.
- [ ] B006. CSV export trackingów.
- [ ] B007. Manual refresh pojedynczego ASIN.
- [ ] B008. Manual refresh-all z job status.
- [ ] B009. Budżet manual refresh na użytkownika.
- [ ] B010. Global cache trackings + invalidacja.
- [ ] B011. Read model tracking_card_cache (canary/fallback).
- [ ] B012. Sortowanie listy: newest/price/drop/title/category.
- [ ] B013. Filtrowanie listy po statusie trackingu.
- [ ] B014. Filtrowanie po wyszukiwarce (ASIN/tytuł).
- [ ] B015. Swipe/gesture menu na kartach.
- [ ] B016. Szybkie akcje z listy (snooze/refresh/open Amazon).

## C. Ceny i rynki (new/used)

- [ ] C001. Ceny `new` per rynek (`de,it,fr,es,uk,nl`).
- [ ] C002. Ceny `used/warehouse` per rynek.
- [ ] C003. Fallback used z `price_history` gdy puste w `products`.
- [ ] C004. Porównanie między rynkami w szczegółach.
- [ ] C005. Osobna sekcja cen używanych w porównaniu rynków.
- [ ] C006. `best price` i `avg/min/max` global.
- [ ] C007. Drop % vs średnia.
- [ ] C008. Buy Box seller + `is_amazon`.
- [ ] C009. In-stock / out-of-stock status.
- [ ] C010. Popularity (`ilu śledzi ASIN`).
- [ ] C011. Normalizacja walut i symboli (EUR/GBP/USD guard).
- [ ] C012. Heurystyki podejrzanie niskiej ceny.

## D. Historia cen i szczegóły produktu

- [ ] D001. Widok szczegółów produktu.
- [ ] D002. Wykres historii cen (new + used).
- [ ] D003. Zakresy czasu (1D/1W/1M/3M/6M/1Y/ALL itp.).
- [ ] D004. Filtry rynku na wykresie.
- [ ] D005. Min/Max/Śr./zmienność/od minimum.
- [ ] D006. Lista historyczna wpisów ceny.
- [ ] D007. AI signals w szczegółach.
- [ ] D008. Najlepszy moment zakupu (AI card).
- [ ] D009. Buy Box card w szczegółach.
- [ ] D010. Przejście do Amazon z poziomu szczegółów.
- [ ] D011. Przyciski quick actions (udostępnij, usuń, alerty).
- [ ] D012. Reset scroll/pozycja widoku przy nawigacji (UX mechanika).

## E. Progi i alerty użytkownika

- [ ] E001. Zapis progu spadku % (`drop-pct`).
- [ ] E002. Zapis progu wzrostu % (`rise-pct` / notify up).
- [ ] E003. `target_price` (nowa cena).
- [ ] E004. `target_price_used` (używana/magazynowa).
- [ ] E005. One-tap quick threshold presets.
- [ ] E006. Scan interval per produkt.
- [ ] E007. Global scan interval usera.
- [ ] E008. Enabled domains per tracking.
- [ ] E009. Snooze trackingu (set/unset).
- [ ] E010. Alert profiles (zapis/odczyt profili).
- [ ] E011. Alert CTA i rekomendacje progu.
- [ ] E012. Persist preferencji po odświeżeniu.

## F. Powiadomienia i kanały

- [ ] F001. Routing alertów cenowych do Telegram.
- [ ] F002. Routing alertów technicznych do Discord.
- [ ] F003. Konfigurowalne kanały notyfikacji per user.
- [ ] F004. Alert log i historia alertów.
- [ ] F005. Feedback do alertów (PATCH feedback).
- [ ] F006. Precision metrics i policy endpoints.
- [ ] F007. Realert threshold (single/bulk/clear).
- [ ] F008. Price error log + audyt filterów.
- [ ] F009. Alert threshold recommendation.
- [ ] F010. Daily/weekly raporty alertowe.

## G. AI (chat, analiza, joby)

- [ ] G001. `/api/ai/chat` (chat AI).
- [ ] G002. `/api/ai/analyze/:asin`.
- [ ] G003. `/api/ai/prediction/:asin`.
- [ ] G004. `/api/ai/suggest-target/:asin`.
- [ ] G005. `/api/ai/best-time/:asin`.
- [ ] G006. AI actions per ASIN (`/actions/:asin`).
- [ ] G007. Apply AI actions (`/actions/:asin/apply`).
- [ ] G008. AI job orchestration (`POST /api/ai/jobs`).
- [ ] G009. Job status read (`GET /api/ai/jobs/:jobId`).
- [ ] G010. SSE stream joba (`/stream`, Last-Event-ID, heartbeat).
- [ ] G011. Bridge Node -> ai-worker (FastAPI).
- [ ] G012. Canary bridge rollout/report.
- [ ] G013. AI queue health, usage, errors.
- [ ] G014. AI fallback paths (rule-based).
- [ ] G015. AI usage tracker (cost/tokens).

## H. Hunter (deals engine)

- [ ] H001. Hunter config presets/custom.
- [ ] H002. Hunter run-now / momentum-run / auto-apply.
- [ ] H003. Hunter scoring i deal attractiveness.
- [ ] H004. Hunter budget/token guard.
- [ ] H005. Hunter post-filter i quality filter.
- [ ] H006. Hunter self-heal/autonomy.
- [ ] H007. Hunter bandit/autotune.
- [ ] H008. Hunter category pauses + unpause.
- [ ] H009. Hunter ML engine and health.
- [ ] H010. Hunter feeds/insights/trend features.
- [ ] H011. Hunter SLO i health endpoints.
- [ ] H012. Hunter alerting/notifier.

## I. Keepa i ingest danych

- [ ] I001. Keepa status + token usage.
- [ ] I002. Keepa deals endpoint.
- [ ] I003. Keepa history endpoint.
- [ ] I004. Keepa NL reliability endpoint.
- [ ] I005. Keepa watch-state summary.
- [ ] I006. Keepa watch-state ingest webhook.
- [ ] I007. Keepa events ingest webhook (price events).
- [ ] I008. Secret rotation (`KEEPA_*_PREVIOUS` flow).
- [ ] I009. Keepa rate limiter i planner.
- [ ] I010. NL used-price fallback scrape.
- [ ] I011. NL outlier guard/sanity.
- [ ] I012. History bootstrap/backfill provider-aware.

## J. Web deals (zewnętrzne okazje)

- [ ] J001. Web deals feed endpoint (`/api/web-deals/amazon`).
- [ ] J002. Web deals history endpoint.
- [ ] J003. Resolve ASIN z URL (`/resolve-asin`).
- [ ] J004. Parser/resolver/store dla web-deals.
- [ ] J005. Web-deals notifier.
- [ ] J006. UI feed + odświeżanie + normalize.

## K. Forum/community

- [ ] K001. Lista wątków forum.
- [ ] K002. Tworzenie nowego wątku.
- [ ] K003. Lista komentarzy wątku.
- [ ] K004. Dodanie komentarza.
- [ ] K005. Głosowanie thread/comment.
- [ ] K006. Report thread/comment.
- [ ] K007. Moderacja thread/comment.
- [ ] K008. Ban/unban użytkownika forum.
- [ ] K009. Forum reports panel.
- [ ] K010. Limity/rate limit i RLS forum.

## L. Ustawienia użytkownika

- [ ] L001. Odczyt/zapis settings usera.
- [ ] L002. Notyfikacje preferencje.
- [ ] L003. Preferences UI (język/theme/UX).
- [ ] L004. Settings experience/layout utils.
- [ ] L005. Data management (clear/export akcje).
- [ ] L006. Scan policy per user.
- [ ] L007. Trackings cache runtime/TTL tuning.
- [ ] L008. Product interval policy.
- [ ] L009. Notification channels policy.
- [ ] L010. Mobile settings parity.

## M. Mobile API v1

- [ ] M001. `/api/mobile/v1/dashboard`.
- [ ] M002. `/api/mobile/v1/trackings` list.
- [ ] M003. `/api/mobile/v1/products/:asin/detail`.
- [ ] M004. `/api/mobile/v1/deals`.
- [ ] M005. `/api/mobile/v1/web-deals/history`.
- [ ] M006. update tracking preferences.
- [ ] M007. snooze tracking (POST/DELETE).
- [ ] M008. delete tracking.
- [ ] M009. session endpoint + auth lifecycle.
- [ ] M010. mobile suspicious price heuristics.

## N. Analytics / Command Center

- [ ] N001. System stats i history.
- [ ] N002. Token efficiency metrics.
- [ ] N003. Scan KPI.
- [ ] N004. Route perf metrics.
- [ ] N005. Launch readiness endpoint.
- [ ] N006. Config introspection endpoint.
- [ ] N007. Popular/popularity/category/tag stats.
- [ ] N008. Buybox/stock/heatmap analytics.
- [ ] N009. AI health dashboard.
- [ ] N010. Keepa usage chart.

## O. Runtime health i self-heal

- [x] O001. `/api/system-health`.
- [x] O002. `/api/system-health/history`.
- [x] O003. `/api/runtime-self-heal-status`.
- [x] O004. `/api/check-alert-status`.
- [x] O005. `/api/ops/metrics`.
- [x] O006. `/api/ops/keepa-history-bootstrap`.
- [x] O007. scan stop / scan run-now.
- [ ] O008. runtime watchdog jobs.
- [ ] O009. offender detection (`runtime:offenders`).
- [ ] O010. resilience/circuit-breakers.

## P. Bezpieczeństwo

- [ ] P001. Internal diagnostics token auth + rotation.
- [ ] P002. Bridge auth token rotation (Node/Python).
- [ ] P003. Auth audit log.
- [ ] P004. Security posture report/alert/cycle.
- [ ] P005. SSH checklist ops.
- [ ] P006. ZAP/security checks.
- [ ] P007. No-legacy-admin-routes guard.
- [ ] P008. Fail-closed admin namespace.
- [ ] P009. RLS context checks.
- [ ] P010. WebUI auth checker/fixer.

## Q. Backup / restore / deploy

- [ ] Q001. Backup full cron.
- [ ] Q002. DB hot backup.
- [ ] Q003. Backup verify health.
- [ ] Q004. Offsite backup + gdrive sync.
- [ ] Q005. Restore latest backup.
- [ ] Q006. Rollback latest.
- [ ] Q007. Deploy check/status/version-check.
- [ ] Q008. Runtime sync deploy.
- [ ] Q009. Deploy rollback.
- [ ] Q010. Build metadata compose.

## R. Dev workflow i tooling

- [ ] R001. Dev stack orchestrator (`dev:stack:*`).
- [ ] R002. Vite dev doctor/recover/smoke.
- [ ] R003. API dev + onboard flow.
- [ ] R004. Session resume (`sam:resume`).
- [ ] R005. Worklog add flow.
- [ ] R006. Intent map sync/check.
- [ ] R007. Quality gates (`check`, lint-guard, smoke).
- [ ] R008. E2E/test suites (unit/integration/e2e).
- [ ] R009. Profiling db/api/hunter.
- [ ] R010. Governance/dataops/weekly cycles.

## S. UI mechaniki przekrojowe

- [ ] S001. Bottom navigation tabs (Śledzenie/Okazje/Forum/Dodaj/Alerty/Ustawienia).
- [ ] S002. FAB i toolbar actions.
- [ ] S003. i18n runtime PL/EN translation mapping.
- [ ] S004. Theme tokens + responsive mobile-first UI.
- [ ] S005. PWA state / Telegram state synchronizacja.
- [ ] S006. Haptic feedback hooks.
- [ ] S007. Share/copy URL helpers.
- [ ] S008. Session health overlay/recovery UX.
- [ ] S009. Inline events compatibility layer.
- [ ] S010. Vite ESM bootstrap + fallback legacy bridge.

---

## Jak wybieramy do migracji (proponowany tryb)

1. Oznacz `KEEP` dla krytycznych pozycji (MVP parity).
2. Oznacz `LATER` dla dodatków po cutover.
3. Oznacz `DROP` dla legacy/nieużywanych.

Przykład oznaczania:
- `B001 KEEP`
- `K003 LATER`
- `R009 DROP`
