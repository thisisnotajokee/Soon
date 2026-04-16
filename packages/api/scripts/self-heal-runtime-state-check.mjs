const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:3100',
  requestTimeoutMs: 8000,
  runtimeStateKey: 'alert_routing_last_remediation_at',
  cooldownWarnSec: 1800,
  cooldownCritSec: 7200,
};

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseSettingsFromEnv() {
  return {
    baseUrl: process.env.SOON_ALERT_BASE_URL || DEFAULTS.baseUrl,
    requestTimeoutMs: toNumber(process.env.SOON_ALERT_REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs),
    runtimeStateKey: process.env.SOON_SELF_HEAL_RUNTIME_STATE_KEY || DEFAULTS.runtimeStateKey,
    cooldownWarnSec: toNumber(process.env.SOON_SELF_HEAL_COOLDOWN_WARN_SEC, DEFAULTS.cooldownWarnSec),
    cooldownCritSec: toNumber(process.env.SOON_SELF_HEAL_COOLDOWN_CRIT_SEC, DEFAULTS.cooldownCritSec),
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

function evaluate(runtimeState, settings) {
  const findings = [];
  const cooldown = runtimeState?.cooldown ?? null;
  const found = Boolean(runtimeState?.found);
  const active = Boolean(cooldown?.cooldownActive);
  const remainingSec = toNumber(cooldown?.cooldownRemainingSec, 0);

  if (active && remainingSec >= settings.cooldownCritSec) {
    findings.push({
      severity: 'CRIT',
      code: 'SELF_HEAL_COOLDOWN_STUCK_CRIT',
      message: `cooldownRemainingSec=${remainingSec} >= cooldownCritSec=${settings.cooldownCritSec}`,
    });
  } else if (active && remainingSec >= settings.cooldownWarnSec) {
    findings.push({
      severity: 'WARN',
      code: 'SELF_HEAL_COOLDOWN_STUCK_WARN',
      message: `cooldownRemainingSec=${remainingSec} >= cooldownWarnSec=${settings.cooldownWarnSec}`,
    });
  }

  const hasCrit = findings.some((item) => item.severity === 'CRIT');
  const hasWarn = findings.some((item) => item.severity === 'WARN');
  const overall = hasCrit ? 'CRIT' : hasWarn ? 'WARN' : 'PASS';
  const exitCode = hasCrit ? 2 : hasWarn ? 1 : 0;

  return {
    found,
    active,
    remainingSec,
    overall,
    exitCode,
    findings,
  };
}

function printHuman(result) {
  console.log(`[Soon/self-heal-runtime-state] ${result.overall}`);
  console.log(
    `[Soon/self-heal-runtime-state] key=${result.key} found=${result.found ? '1' : '0'} cooldownActive=${result.cooldownActive ? '1' : '0'} cooldownRemainingSec=${result.cooldownRemainingSec}`,
  );
  if (!result.findings.length) {
    console.log('[Soon/self-heal-runtime-state] no cooldown anomalies');
    return;
  }
  for (const finding of result.findings) {
    console.log(`[Soon/self-heal-runtime-state] ${finding.severity} ${finding.code}: ${finding.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const settings = parseSettingsFromEnv();
  const path = `/api/self-heal/runtime-state?key=${encodeURIComponent(settings.runtimeStateKey)}`;
  const runtimeState = await fetchJson(settings.baseUrl, path, settings.requestTimeoutMs);
  const evaluated = evaluate(runtimeState, settings);

  const result = {
    checkedAt: new Date().toISOString(),
    baseUrl: settings.baseUrl,
    key: settings.runtimeStateKey,
    thresholds: {
      cooldownWarnSec: settings.cooldownWarnSec,
      cooldownCritSec: settings.cooldownCritSec,
    },
    found: evaluated.found,
    cooldownActive: evaluated.active,
    cooldownRemainingSec: evaluated.remainingSec,
    runtimeState,
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
  console.error('[Soon/self-heal-runtime-state] CRIT CHECK_FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(2);
});
