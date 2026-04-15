const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:3100',
  requestTimeoutMs: 8000,
  pendingWarn: 3,
  pendingCrit: 10,
  durationWarnMs: 5000,
  durationCritMs: 15000,
  stuckSec: 300,
};

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowMs() {
  return Date.now();
}

function parseThresholdsFromEnv() {
  return {
    baseUrl: process.env.SOON_ALERT_BASE_URL || DEFAULTS.baseUrl,
    requestTimeoutMs: toNumber(process.env.SOON_ALERT_REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs),
    pendingWarn: toNumber(process.env.SOON_ALERT_PENDING_WARN, DEFAULTS.pendingWarn),
    pendingCrit: toNumber(process.env.SOON_ALERT_PENDING_CRIT, DEFAULTS.pendingCrit),
    durationWarnMs: toNumber(process.env.SOON_ALERT_DURATION_WARN_MS, DEFAULTS.durationWarnMs),
    durationCritMs: toNumber(process.env.SOON_ALERT_DURATION_CRIT_MS, DEFAULTS.durationCritMs),
    stuckSec: toNumber(process.env.SOON_ALERT_STUCK_SEC, DEFAULTS.stuckSec),
  };
}

function parseStartedAtMs(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function evaluateStatus(status, thresholds) {
  const findings = [];
  const pendingCount = toNumber(status.pendingCount, 0);
  const lastDurationMs = toNumber(status.lastDurationMs, 0);

  if (pendingCount >= thresholds.pendingCrit) {
    findings.push({
      severity: 'CRIT',
      code: 'PENDING_BACKLOG_CRIT',
      message: `pendingCount=${pendingCount} >= pendingCrit=${thresholds.pendingCrit}`,
    });
  } else if (pendingCount >= thresholds.pendingWarn) {
    findings.push({
      severity: 'WARN',
      code: 'PENDING_BACKLOG_WARN',
      message: `pendingCount=${pendingCount} >= pendingWarn=${thresholds.pendingWarn}`,
    });
  }

  if (lastDurationMs >= thresholds.durationCritMs) {
    findings.push({
      severity: 'CRIT',
      code: 'REFRESH_DURATION_CRIT',
      message: `lastDurationMs=${lastDurationMs} >= durationCritMs=${thresholds.durationCritMs}`,
    });
  } else if (lastDurationMs >= thresholds.durationWarnMs) {
    findings.push({
      severity: 'WARN',
      code: 'REFRESH_DURATION_WARN',
      message: `lastDurationMs=${lastDurationMs} >= durationWarnMs=${thresholds.durationWarnMs}`,
    });
  }

  if (status.lastError) {
    findings.push({
      severity: 'CRIT',
      code: 'LAST_REFRESH_ERROR',
      message: status.lastError.message ?? 'unknown read-model refresh error',
    });
  }

  if (status.inFlight) {
    const startedAtMs = parseStartedAtMs(status.lastStartedAt);
    if (startedAtMs !== null) {
      const inFlightSec = Math.floor((nowMs() - startedAtMs) / 1000);
      if (inFlightSec >= thresholds.stuckSec) {
        findings.push({
          severity: 'CRIT',
          code: 'REFRESH_STUCK',
          message: `inFlight=${inFlightSec}s >= stuckSec=${thresholds.stuckSec}`,
        });
      }
    }
  }

  const hasCrit = findings.some((item) => item.severity === 'CRIT');
  const hasWarn = findings.some((item) => item.severity === 'WARN');
  const overall = hasCrit ? 'CRIT' : hasWarn ? 'WARN' : 'PASS';
  const exitCode = hasCrit ? 2 : hasWarn ? 1 : 0;

  return { overall, exitCode, findings };
}

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
  };
}

async function fetchStatus(baseUrl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/automation/read-model/status`, {
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`status endpoint failed (${response.status}): ${JSON.stringify(body)}`);
    }

    return body;
  } finally {
    clearTimeout(timer);
  }
}

function printHuman(result) {
  console.log(`[Soon/alerts] ${result.overall}`);
  console.log(
    `[Soon/alerts] mode=${result.status.mode} pending=${result.status.pendingCount} inFlight=${result.status.inFlight} totalErrors=${result.status.totalErrors} lastDurationMs=${result.status.lastDurationMs}`,
  );
  if (!result.findings.length) {
    console.log('[Soon/alerts] no threshold violations');
    return;
  }

  for (const finding of result.findings) {
    console.log(`[Soon/alerts] ${finding.severity} ${finding.code}: ${finding.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const thresholds = parseThresholdsFromEnv();

  const status = await fetchStatus(thresholds.baseUrl, thresholds.requestTimeoutMs);
  const evaluated = evaluateStatus(status, thresholds);

  const result = {
    checkedAt: new Date().toISOString(),
    baseUrl: thresholds.baseUrl,
    thresholds: {
      pendingWarn: thresholds.pendingWarn,
      pendingCrit: thresholds.pendingCrit,
      durationWarnMs: thresholds.durationWarnMs,
      durationCritMs: thresholds.durationCritMs,
      stuckSec: thresholds.stuckSec,
    },
    status,
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
  console.error('[Soon/alerts] CRIT CHECK_FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(2);
});
