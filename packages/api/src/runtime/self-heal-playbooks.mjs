const DEFAULT_THRESHOLDS = {
  pendingWarn: 3,
  pendingCrit: 10,
  durationWarnMs: 5000,
  durationCritMs: 15000,
  stuckSec: 300,
};

export const DEFAULT_PLAYBOOKS = [
  {
    id: 'system-health-check',
    trigger: 'always-on heartbeat',
    actions: ['verify-runtime-health', 'verify-read-model-health'],
    triggerCodes: [],
  },
  {
    id: 'scanner-timeout',
    trigger: 'scanner timeout spike',
    actions: ['restart-scanner-worker', 'requeue-batch', 'verify-health'],
    triggerCodes: ['REFRESH_STUCK', 'LAST_REFRESH_ERROR'],
  },
  {
    id: 'alert-router-backlog',
    trigger: 'alert queue backlog',
    actions: ['scale-alert-consumers', 'drain-dlq', 'verify-routing-policy'],
    triggerCodes: ['PENDING_BACKLOG_WARN', 'PENDING_BACKLOG_CRIT'],
  },
  {
    id: 'read-model-slow-path',
    trigger: 'read-model refresh duration spike',
    actions: ['throttle-refresh-jobs', 'enable-degraded-read-path', 'verify-refresh-latency'],
    triggerCodes: ['REFRESH_DURATION_WARN', 'REFRESH_DURATION_CRIT'],
  },
];

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStartedAtMs(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeThresholds(input = {}) {
  return {
    pendingWarn: toNumber(input.pendingWarn, DEFAULT_THRESHOLDS.pendingWarn),
    pendingCrit: toNumber(input.pendingCrit, DEFAULT_THRESHOLDS.pendingCrit),
    durationWarnMs: toNumber(input.durationWarnMs, DEFAULT_THRESHOLDS.durationWarnMs),
    durationCritMs: toNumber(input.durationCritMs, DEFAULT_THRESHOLDS.durationCritMs),
    stuckSec: toNumber(input.stuckSec, DEFAULT_THRESHOLDS.stuckSec),
  };
}

export function detectSelfHealAnomalies({ readModelStatus, now = Date.now(), thresholds } = {}) {
  const config = mergeThresholds(thresholds);
  const findings = [];

  if (!readModelStatus) {
    findings.push({
      severity: 'WARN',
      code: 'STATUS_UNAVAILABLE',
      message: 'read-model status not available for anomaly detection',
    });
    return findings;
  }

  const pendingCount = toNumber(readModelStatus.pendingCount, 0);
  const lastDurationMs = toNumber(readModelStatus.lastDurationMs, 0);

  if (pendingCount >= config.pendingCrit) {
    findings.push({
      severity: 'CRIT',
      code: 'PENDING_BACKLOG_CRIT',
      message: `pendingCount=${pendingCount} >= pendingCrit=${config.pendingCrit}`,
    });
  } else if (pendingCount >= config.pendingWarn) {
    findings.push({
      severity: 'WARN',
      code: 'PENDING_BACKLOG_WARN',
      message: `pendingCount=${pendingCount} >= pendingWarn=${config.pendingWarn}`,
    });
  }

  if (lastDurationMs >= config.durationCritMs) {
    findings.push({
      severity: 'CRIT',
      code: 'REFRESH_DURATION_CRIT',
      message: `lastDurationMs=${lastDurationMs} >= durationCritMs=${config.durationCritMs}`,
    });
  } else if (lastDurationMs >= config.durationWarnMs) {
    findings.push({
      severity: 'WARN',
      code: 'REFRESH_DURATION_WARN',
      message: `lastDurationMs=${lastDurationMs} >= durationWarnMs=${config.durationWarnMs}`,
    });
  }

  if (readModelStatus.lastError) {
    findings.push({
      severity: 'CRIT',
      code: 'LAST_REFRESH_ERROR',
      message: readModelStatus.lastError.message ?? 'unknown read-model refresh error',
    });
  }

  if (readModelStatus.inFlight) {
    const startedAtMs = parseStartedAtMs(readModelStatus.lastStartedAt);
    if (startedAtMs !== null) {
      const inFlightSec = Math.floor((toNumber(now, Date.now()) - startedAtMs) / 1000);
      if (inFlightSec >= config.stuckSec) {
        findings.push({
          severity: 'CRIT',
          code: 'REFRESH_STUCK',
          message: `inFlight=${inFlightSec}s >= stuckSec=${config.stuckSec}`,
        });
      }
    }
  }

  return findings;
}

function selectPlaybooks(findings) {
  const anomalyCodes = new Set(findings.map((item) => item.code));
  const selected = new Set(['system-health-check']);

  for (const playbook of DEFAULT_PLAYBOOKS) {
    if (playbook.id === 'system-health-check') continue;
    if (playbook.triggerCodes.some((code) => anomalyCodes.has(code))) {
      selected.add(playbook.id);
    }
  }

  return DEFAULT_PLAYBOOKS.filter((playbook) => selected.has(playbook.id));
}

function resolvePlaybookStatus(playbook, findings) {
  const anomalyCodes = new Set(findings.map((item) => item.code));

  if (playbook.id === 'scanner-timeout' && anomalyCodes.has('LAST_REFRESH_ERROR')) {
    return 'rollback';
  }

  if (playbook.id === 'system-health-check') {
    return 'success';
  }

  return 'success';
}

function resolveCycleStatus(executedPlaybooks) {
  if (executedPlaybooks.some((item) => item.status === 'failed')) return 'failed';
  if (executedPlaybooks.some((item) => item.status === 'rollback')) return 'rollback';
  return 'ok';
}

export function remediationCycle({ readModelStatus, now = Date.now(), thresholds } = {}) {
  const anomalies = detectSelfHealAnomalies({ readModelStatus, now, thresholds });
  const plan = selectPlaybooks(anomalies);
  const executedPlaybooks = plan.map((playbook) => ({
    playbookId: playbook.id,
    status: resolvePlaybookStatus(playbook, anomalies),
  }));

  return {
    status: resolveCycleStatus(executedPlaybooks),
    anomalies,
    executedPlaybooks,
  };
}
