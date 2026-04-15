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
    basePriority: 10,
    retryPolicy: { maxRetries: 0, backoffSec: 0 },
  },
  {
    id: 'scanner-timeout',
    trigger: 'scanner timeout spike',
    actions: ['restart-scanner-worker', 'requeue-batch', 'verify-health'],
    triggerCodes: ['REFRESH_STUCK', 'LAST_REFRESH_ERROR'],
    basePriority: 90,
    retryPolicy: { maxRetries: 0, backoffSec: 0 },
  },
  {
    id: 'alert-router-backlog',
    trigger: 'alert queue backlog',
    actions: ['scale-alert-consumers', 'drain-dlq', 'verify-routing-policy'],
    triggerCodes: ['PENDING_BACKLOG_WARN', 'PENDING_BACKLOG_CRIT'],
    basePriority: 80,
    retryPolicy: { maxRetries: 1, backoffSec: 20 },
  },
  {
    id: 'read-model-slow-path',
    trigger: 'read-model refresh duration spike',
    actions: ['throttle-refresh-jobs', 'enable-degraded-read-path', 'verify-refresh-latency'],
    triggerCodes: ['REFRESH_DURATION_WARN', 'REFRESH_DURATION_CRIT'],
    basePriority: 70,
    retryPolicy: { maxRetries: 1, backoffSec: 30 },
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
  const severityWeight = { CRIT: 100, WARN: 40 };
  const anomalyCodes = new Set(findings.map((item) => item.code));
  const selected = [];

  for (const playbook of DEFAULT_PLAYBOOKS) {
    const matchedFindings = findings.filter((item) => playbook.triggerCodes.includes(item.code));
    const alwaysOn = playbook.id === 'system-health-check';
    if (!alwaysOn && matchedFindings.length === 0) continue;

    const score =
      (playbook.basePriority ?? 0) +
      matchedFindings.reduce((acc, item) => acc + (severityWeight[item.severity] ?? 0), 0) +
      matchedFindings.length * 5;

    selected.push({
      ...playbook,
      matchedFindings,
      priorityScore: score,
    });
  }

  return selected.sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));
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

function resolvePlaybookAttemptStatus(playbook, matchedFindings, attempt) {
  const anomalyCodes = new Set(matchedFindings.map((item) => item.code));

  if (playbook.id === 'scanner-timeout' && anomalyCodes.has('LAST_REFRESH_ERROR')) {
    return 'rollback';
  }

  if (playbook.id === 'alert-router-backlog' && anomalyCodes.has('PENDING_BACKLOG_CRIT') && attempt === 1) {
    return 'failed';
  }

  if (playbook.id === 'read-model-slow-path' && anomalyCodes.has('REFRESH_DURATION_CRIT') && attempt === 1) {
    return 'failed';
  }

  return resolvePlaybookStatus(playbook, matchedFindings);
}

function executePlaybookInitial(playbook) {
  const maxRetries = toNumber(playbook.retryPolicy?.maxRetries, 0);
  const retryBackoffSec = toNumber(playbook.retryPolicy?.backoffSec, 0);
  const attempts = 1;
  const status = resolvePlaybookAttemptStatus(playbook, playbook.matchedFindings, attempts);
  const retriesUsed = 0;
  const shouldRetry = status === 'failed' && retriesUsed < maxRetries;

  return {
    playbookId: playbook.id,
    status,
    attempts,
    maxRetries,
    retriesUsed,
    retryBackoffSec,
    shouldRetry,
    priorityScore: Number(playbook.priorityScore.toFixed(2)),
    matchedAnomalyCodes: playbook.matchedFindings.map((item) => item.code),
  };
}

function resolvePlaybookDefinition(playbookId) {
  return DEFAULT_PLAYBOOKS.find((item) => item.id === playbookId) ?? null;
}

function toMatchedFindingsFromCodes(codes = []) {
  return codes.map((code) => ({ code }));
}

export function evaluateSelfHealRetryAttempt(retryJob) {
  const playbook = resolvePlaybookDefinition(retryJob?.playbookId);
  if (!playbook) {
    return {
      outcome: 'dead_letter',
      status: 'failed',
      attempts: toNumber(retryJob?.attempts, 1),
      retriesUsed: toNumber(retryJob?.retriesUsed, 0),
      maxRetries: toNumber(retryJob?.maxRetries, 0),
      reason: `unknown_playbook:${String(retryJob?.playbookId ?? 'missing')}`,
    };
  }

  const matchedFindings = toMatchedFindingsFromCodes(retryJob?.matchedAnomalyCodes ?? []);
  const currentAttempts = toNumber(retryJob?.attempts, 1);
  const maxRetries = Math.max(0, toNumber(retryJob?.maxRetries, 0));
  const nextAttempt = currentAttempts + 1;
  const status = resolvePlaybookAttemptStatus(playbook, matchedFindings, nextAttempt);
  const retriesUsed = Math.max(0, nextAttempt - 1);

  if (status === 'failed' && retriesUsed < maxRetries) {
    return {
      outcome: 'retry',
      status,
      attempts: nextAttempt,
      retriesUsed,
      maxRetries,
      retryBackoffSec: Math.max(0, toNumber(retryJob?.retryBackoffSec, 0)),
    };
  }

  if (status === 'failed') {
    return {
      outcome: 'dead_letter',
      status,
      attempts: nextAttempt,
      retriesUsed,
      maxRetries,
      reason: 'retry_budget_exhausted',
    };
  }

  return {
    outcome: 'done',
    status,
    attempts: nextAttempt,
    retriesUsed,
    maxRetries,
  };
}

function resolveCycleStatus(executedPlaybooks) {
  if (executedPlaybooks.some((item) => item.status === 'failed')) return 'failed';
  if (executedPlaybooks.some((item) => item.status === 'rollback')) return 'rollback';
  return 'ok';
}

export function remediationCycle({ readModelStatus, now = Date.now(), thresholds } = {}) {
  const anomalies = detectSelfHealAnomalies({ readModelStatus, now, thresholds });
  const plan = selectPlaybooks(anomalies);
  const executedPlaybooks = plan.map((playbook) => executePlaybookInitial(playbook));

  return {
    status: resolveCycleStatus(executedPlaybooks),
    anomalies,
    executedPlaybooks,
  };
}
