const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:3100',
  requestTimeoutMs: 8000,
  routingWarn: 1,
  routingCrit: 5,
};

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseThresholdsFromEnv() {
  return {
    baseUrl: process.env.SOON_ALERT_BASE_URL || DEFAULTS.baseUrl,
    requestTimeoutMs: toNumber(process.env.SOON_ALERT_REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs),
    routingWarn: toNumber(process.env.SOON_RUNTIME_ROUTING_WARN, DEFAULTS.routingWarn),
    routingCrit: toNumber(process.env.SOON_RUNTIME_ROUTING_CRIT, DEFAULTS.routingCrit),
  };
}

function parseArgs(argv) {
  return { json: argv.includes('--json') };
}

async function fetchJson(baseUrl, path, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function evaluate(runtimeSelfHealStatus, alertStatus, thresholds) {
  const findings = [];
  const selfHealOverall = String(runtimeSelfHealStatus?.overall ?? 'PASS');
  const routingViolations = toNumber(alertStatus?.violations?.total, 0);

  if (selfHealOverall === 'CRIT') {
    findings.push({
      severity: 'CRIT',
      code: 'RUNTIME_SELF_HEAL_CRIT',
      message: 'runtime self-heal status is CRIT',
    });
  } else if (selfHealOverall === 'WARN') {
    findings.push({
      severity: 'WARN',
      code: 'RUNTIME_SELF_HEAL_WARN',
      message: 'runtime self-heal status is WARN',
    });
  }

  if (routingViolations >= thresholds.routingCrit) {
    findings.push({
      severity: 'CRIT',
      code: 'ALERT_ROUTING_VIOLATIONS_CRIT',
      message: `routing violations=${routingViolations} >= routingCrit=${thresholds.routingCrit}`,
    });
  } else if (routingViolations >= thresholds.routingWarn) {
    findings.push({
      severity: 'WARN',
      code: 'ALERT_ROUTING_VIOLATIONS_WARN',
      message: `routing violations=${routingViolations} >= routingWarn=${thresholds.routingWarn}`,
    });
  }

  const hasCrit = findings.some((item) => item.severity === 'CRIT');
  const hasWarn = findings.some((item) => item.severity === 'WARN');
  const overall = hasCrit ? 'CRIT' : hasWarn ? 'WARN' : 'PASS';
  const exitCode = hasCrit ? 2 : hasWarn ? 1 : 0;
  return { overall, exitCode, findings };
}

function printHuman(result) {
  console.log(`[Soon/runtime-alerts] ${result.overall}`);
  console.log(
    `[Soon/runtime-alerts] selfHealOverall=${result.runtimeSelfHealStatus?.overall ?? 'n/a'} routingViolations=${result.alertStatus?.violations?.total ?? 0}`,
  );
  if (!result.findings.length) {
    console.log('[Soon/runtime-alerts] no threshold violations');
    return;
  }
  for (const finding of result.findings) {
    console.log(`[Soon/runtime-alerts] ${finding.severity} ${finding.code}: ${finding.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const thresholds = parseThresholdsFromEnv();
  const runtimeSelfHealStatus = await fetchJson(
    thresholds.baseUrl,
    '/api/runtime-self-heal-status',
    thresholds.requestTimeoutMs,
  );
  const alertStatus = await fetchJson(thresholds.baseUrl, '/api/check-alert-status?limit=20', thresholds.requestTimeoutMs);
  const evaluated = evaluate(runtimeSelfHealStatus, alertStatus, thresholds);

  const result = {
    checkedAt: new Date().toISOString(),
    baseUrl: thresholds.baseUrl,
    thresholds: {
      routingWarn: thresholds.routingWarn,
      routingCrit: thresholds.routingCrit,
    },
    runtimeSelfHealStatus,
    alertStatus,
    overall: evaluated.overall,
    findings: evaluated.findings,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
  process.exit(evaluated.exitCode);
}

main().catch((error) => {
  console.error('[Soon/runtime-alerts] CRIT CHECK_FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(2);
});
