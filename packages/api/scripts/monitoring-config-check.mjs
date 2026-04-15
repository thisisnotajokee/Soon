import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULTS = {
  prometheusRulesPath: 'ops/monitoring/prometheus/soon-read-model-alerts.yml',
  alertmanagerPath: 'ops/monitoring/alertmanager/soon-alertmanager-discord.example.yml',
};

function parseArgs(argv) {
  return { json: argv.includes('--json') };
}

function validateIncludes(content, required, scope, errors) {
  for (const entry of required) {
    if (!content.includes(entry)) {
      errors.push(`${scope}: missing required token "${entry}"`);
    }
  }
}

function validatePrometheusRules(content, errors) {
  validateIncludes(
    content,
    [
      'groups:',
      'name: soon-read-model-alerts',
      'alert: SoonRuntimeSelfHealWarn',
      'alert: SoonRuntimeSelfHealCritical',
      'alert: SoonAlertRoutingViolationWarn',
      'alert: SoonAlertRoutingViolationCritical',
      'expr: soon_runtime_self_heal_overall_score >= 1',
      'expr: soon_runtime_self_heal_overall_score >= 2',
      'expr: soon_alert_routing_violations_total > 0',
      'channel: discord-ops',
    ],
    'prometheus-rules',
    errors,
  );
}

function validateAlertmanager(content, errors) {
  validateIncludes(
    content,
    [
      'route:',
      'receiver: discord-ops',
      'channel="discord-ops"',
      'receivers:',
      'name: discord-ops',
      'discord_configs:',
      'SOON_OPS_DISCORD_WEBHOOK_URL',
    ],
    'alertmanager-config',
    errors,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rulesPath = resolve(DEFAULTS.prometheusRulesPath);
  const alertmanagerPath = resolve(DEFAULTS.alertmanagerPath);
  const errors = [];

  let rulesContent = '';
  let alertmanagerContent = '';
  try {
    rulesContent = await readFile(rulesPath, 'utf8');
  } catch (error) {
    errors.push(`prometheus-rules: cannot read file (${rulesPath}): ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    alertmanagerContent = await readFile(alertmanagerPath, 'utf8');
  } catch (error) {
    errors.push(`alertmanager-config: cannot read file (${alertmanagerPath}): ${error instanceof Error ? error.message : String(error)}`);
  }

  if (rulesContent) validatePrometheusRules(rulesContent, errors);
  if (alertmanagerContent) validateAlertmanager(alertmanagerContent, errors);

  const result = {
    checkedAt: new Date().toISOString(),
    paths: {
      prometheusRules: DEFAULTS.prometheusRulesPath,
      alertmanager: DEFAULTS.alertmanagerPath,
    },
    overall: errors.length ? 'CRIT' : 'PASS',
    findings: errors,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (errors.length) {
    console.log('[Soon/monitoring-check] CRIT');
    for (const err of errors) {
      console.log(`[Soon/monitoring-check] ${err}`);
    }
  } else {
    console.log('[Soon/monitoring-check] PASS');
    console.log(`[Soon/monitoring-check] rules=${DEFAULTS.prometheusRulesPath}`);
    console.log(`[Soon/monitoring-check] alertmanager=${DEFAULTS.alertmanagerPath}`);
  }

  process.exit(errors.length ? 2 : 0);
}

main().catch((error) => {
  console.error('[Soon/monitoring-check] CRIT CHECK_FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(2);
});
