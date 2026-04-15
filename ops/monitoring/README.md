# Monitoring

## Prometheus

1. Załaduj reguły: `ops/monitoring/prometheus/soon-read-model-alerts.yml`.
2. Scrape target: `GET /metrics` z API Soon.
3. Walidacja configu lokalnie/CI: `npm run obs:monitoring:check`.

Nowe metryki runtime/ops:

1. `soon_runtime_self_heal_overall_score` (`0=PASS`, `1=WARN`, `2=CRIT`)
2. `soon_runtime_self_heal_signals_total`
3. `soon_alert_routing_overall_score` (`0=PASS`, `1=WARN`, `2=CRIT`)
4. `soon_alert_routing_violations_total`
5. `soon_alert_routing_purchase_non_telegram_total`
6. `soon_alert_routing_technical_non_discord_total`
7. `soon_alert_routing_unknown_kind_total`
8. `soon_alert_routing_unknown_channel_total`

## Alertmanager -> Discord (operacyjny)

1. Użyj szablonu: `ops/monitoring/alertmanager/soon-alertmanager-discord.example.yml`.
2. Ustaw sekret: `SOON_OPS_DISCORD_WEBHOOK_URL`.
3. Reguły runtime mają etykietę `channel=discord-ops`, więc trafią do receivera `discord-ops`.
