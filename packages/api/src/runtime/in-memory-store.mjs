import { randomUUID } from 'node:crypto';
import { evaluateSelfHealRetryAttempt } from './self-heal-playbooks.mjs';

function sampleHistory(base) {
  const now = Date.now();
  return Array.from({ length: 12 }, (_, idx) => ({
    ts: new Date(now - (11 - idx) * 24 * 60 * 60 * 1000).toISOString(),
    value: Number((base * (0.9 + (idx % 5) * 0.03)).toFixed(2)),
  }));
}

export const SEEDED_TRACKINGS = [
  {
    asin: 'B0BYW7MMBR',
    title: 'ASUS ROG Strix Scar 17 G733PY',
    pricesNew: { de: 3799.0, nl: 2042.48, uk: 4163.31 },
    pricesUsed: { nl: 1899.0, de: 3499.99 },
    thresholdDropPct: 15,
    thresholdRisePct: 15,
    targetPriceNew: 3200,
    targetPriceUsed: 2800,
  },
  {
    asin: 'B09JRYMSD5',
    title: 'Fire HD 8 Refurbished',
    pricesNew: { de: 57.99, nl: 60.0 },
    pricesUsed: { nl: 48.99 },
    thresholdDropPct: 10,
    thresholdRisePct: 12,
    targetPriceNew: 55,
    targetPriceUsed: 45,
  },
  {
    asin: 'B0DCKJG2Z3',
    title: 'Demo Tracking Product',
    pricesNew: { de: 264.99, uk: 299.99, nl: 254.5 },
    pricesUsed: { de: 239.99 },
    thresholdDropPct: 8,
    thresholdRisePct: 10,
    targetPriceNew: 240,
    targetPriceUsed: 220,
  },
];

function buildRecord(item) {
  return {
    ...item,
    historyPoints: sampleHistory(item.pricesNew.de ?? Object.values(item.pricesNew)[0] ?? 100),
    updatedAt: new Date().toISOString(),
  };
}

function summarizeRun({ runId, startedAt, finishedAt, trackingCount, decisions, alerts }) {
  return {
    runId,
    source: 'automation-cycle-v1',
    status: 'ok',
    startedAt,
    finishedAt,
    trackingCount,
    decisionCount: decisions.length,
    alertCount: alerts.length,
    purchaseAlertCount: alerts.filter((item) => item.kind === 'purchase').length,
    technicalAlertCount: alerts.filter((item) => item.kind === 'technical').length,
    decisions,
    alerts,
  };
}

function summarizeSelfHealRun({ runId, source, status, startedAt, finishedAt, executedPlaybooks }) {
  const normalizedPlaybooks = normalizeExecutedPlaybooks(executedPlaybooks);
  const resolvedStatus = status ?? resolveSelfHealStatus(normalizedPlaybooks);
  return {
    runId,
    source: source ?? 'self-heal-worker-v1',
    status: resolvedStatus,
    startedAt,
    finishedAt,
    playbookCount: normalizedPlaybooks.length,
    executedPlaybooks: normalizedPlaybooks,
  };
}

function normalizeExecutedPlaybooks(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      if (typeof item === 'string') {
        return {
          playbookId: item,
          status: 'success',
          attempts: 1,
          maxRetries: 0,
          retriesUsed: 0,
          retryBackoffSec: 0,
          priorityScore: 0,
          matchedAnomalyCodes: [],
        };
      }

      const playbookId = item?.playbookId ?? item?.id;
      if (!playbookId) return null;

      const status = item?.status;
      const safeStatus =
        status === 'failed' || status === 'rollback' || status === 'success'
          ? status
          : 'success';
      return {
        playbookId,
        status: safeStatus,
        attempts: Number.isFinite(Number(item?.attempts)) ? Number(item.attempts) : 1,
        maxRetries: Number.isFinite(Number(item?.maxRetries)) ? Number(item.maxRetries) : 0,
        retriesUsed: Number.isFinite(Number(item?.retriesUsed)) ? Number(item.retriesUsed) : 0,
        retryBackoffSec: Number.isFinite(Number(item?.retryBackoffSec))
          ? Number(item.retryBackoffSec)
          : 0,
        shouldRetry: Boolean(item?.shouldRetry),
        priorityScore: Number.isFinite(Number(item?.priorityScore)) ? Number(item.priorityScore) : 0,
        matchedAnomalyCodes: Array.isArray(item?.matchedAnomalyCodes)
          ? item.matchedAnomalyCodes.filter((code) => typeof code === 'string')
          : [],
      };
    })
    .filter(Boolean);
}

function resolveSelfHealStatus(executedPlaybooks) {
  if (executedPlaybooks.some((item) => item.status === 'failed')) return 'failed';
  if (executedPlaybooks.some((item) => item.status === 'rollback')) return 'rollback';
  return 'ok';
}

function toDayKey(value) {
  const parsed = Date.parse(value ?? '');
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function buildDailyReadModel(runs, days) {
  const byDay = new Map();

  for (const run of runs) {
    const day = toDayKey(run.startedAt);
    if (!day) continue;

    if (!byDay.has(day)) {
      byDay.set(day, {
        day,
        runs: 0,
        trackingCountSum: 0,
        decisionCountSum: 0,
        alertCountSum: 0,
        purchaseAlertCountSum: 0,
        technicalAlertCountSum: 0,
        telegramAlertCountSum: 0,
        discordAlertCountSum: 0,
        asinAlerts: new Map(),
      });
    }

    const row = byDay.get(day);
    row.runs += 1;
    row.trackingCountSum += run.trackingCount ?? 0;
    row.decisionCountSum += run.decisionCount ?? 0;
    row.alertCountSum += run.alertCount ?? 0;
    row.purchaseAlertCountSum += run.purchaseAlertCount ?? 0;
    row.technicalAlertCountSum += run.technicalAlertCount ?? 0;

    for (const alert of run.alerts ?? []) {
      if (alert.channel === 'telegram') row.telegramAlertCountSum += 1;
      if (alert.channel === 'discord') row.discordAlertCountSum += 1;
      if (alert.asin && alert.asin !== 'system') {
        row.asinAlerts.set(alert.asin, (row.asinAlerts.get(alert.asin) ?? 0) + 1);
      }
    }
  }

  const items = [...byDay.values()]
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, days)
    .map((row) => ({
      day: row.day,
      runs: row.runs,
      sums: {
        trackingCount: row.trackingCountSum,
        decisionCount: row.decisionCountSum,
        alertCount: row.alertCountSum,
        purchaseAlertCount: row.purchaseAlertCountSum,
        technicalAlertCount: row.technicalAlertCountSum,
      },
      kpi: {
        avgTrackingCount: Number((row.trackingCountSum / row.runs).toFixed(2)),
        avgDecisionCount: Number((row.decisionCountSum / row.runs).toFixed(2)),
        avgAlertCount: Number((row.alertCountSum / row.runs).toFixed(2)),
        purchaseAlertRatePct:
          row.alertCountSum > 0 ? Number(((row.purchaseAlertCountSum / row.alertCountSum) * 100).toFixed(2)) : 0,
        technicalAlertRatePct:
          row.alertCountSum > 0 ? Number(((row.technicalAlertCountSum / row.alertCountSum) * 100).toFixed(2)) : 0,
      },
      alertsByChannel: {
        telegram: row.telegramAlertCountSum,
        discord: row.discordAlertCountSum,
      },
      topAlertedAsins: [...row.asinAlerts.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5)
        .map(([asin, alerts]) => ({ asin, alerts })),
    }));

  return {
    generatedAt: new Date().toISOString(),
    days,
    items,
  };
}

export function createInMemoryStore() {
  const byAsin = new Map(SEEDED_TRACKINGS.map((item) => [item.asin, buildRecord(item)]));
  const automationRuns = [];
  const selfHealRuns = [];
  const selfHealRetryQueue = [];
  const selfHealDeadLetters = [];

  async function listTrackings() {
    return [...byAsin.values()].map(({ historyPoints, ...rest }) => rest);
  }

  async function getTracking(asin) {
    return byAsin.get(asin) ?? null;
  }

  async function getProductDetail(asin) {
    const item = byAsin.get(asin);
    if (!item) return null;

    const prices = Object.values(item.pricesNew);
    const min = prices.length ? Math.min(...prices) : null;
    const max = prices.length ? Math.max(...prices) : null;
    const avg = prices.length
      ? Number((prices.reduce((acc, value) => acc + value, 0) / prices.length).toFixed(2))
      : null;

    return {
      asin: item.asin,
      title: item.title,
      pricesNew: item.pricesNew,
      pricesUsed: item.pricesUsed,
      thresholds: {
        thresholdDropPct: item.thresholdDropPct,
        thresholdRisePct: item.thresholdRisePct,
        targetPriceNew: item.targetPriceNew,
        targetPriceUsed: item.targetPriceUsed,
      },
      summary: {
        min,
        max,
        avg,
      },
      historyPoints: item.historyPoints,
      updatedAt: item.updatedAt,
    };
  }

  async function updateThresholds(asin, payload) {
    const item = byAsin.get(asin);
    if (!item) return null;

    const next = {
      ...item,
      thresholdDropPct:
        payload.thresholdDropPct === undefined ? item.thresholdDropPct : payload.thresholdDropPct,
      thresholdRisePct:
        payload.thresholdRisePct === undefined ? item.thresholdRisePct : payload.thresholdRisePct,
      targetPriceNew:
        payload.targetPriceNew === undefined ? item.targetPriceNew : payload.targetPriceNew,
      targetPriceUsed:
        payload.targetPriceUsed === undefined ? item.targetPriceUsed : payload.targetPriceUsed,
      updatedAt: new Date().toISOString(),
    };

    byAsin.set(asin, next);
    return getProductDetail(asin);
  }

  async function recordAutomationCycle({ cycle, trackingCount, startedAt, finishedAt }) {
    const runId = randomUUID();

    const run = summarizeRun({
      runId,
      startedAt,
      finishedAt,
      trackingCount,
      decisions: cycle.decisions,
      alerts: cycle.alerts,
    });

    automationRuns.unshift(run);
    if (automationRuns.length > 100) {
      automationRuns.length = 100;
    }

    return run;
  }

  async function listLatestAutomationRuns(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    return automationRuns.slice(0, safeLimit);
  }

  async function getAutomationDailyReadModel(days = 30) {
    const safeDays = Math.max(1, Math.min(90, Number(days) || 30));
    return buildDailyReadModel(automationRuns, safeDays);
  }

  async function getReadModelRefreshStatus() {
    return {
      mode: 'memory-sync',
      pendingCount: 0,
      pendingDays: [],
      inFlight: false,
      lastQueuedAt: null,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastDurationMs: 0,
      lastBatchDays: 0,
      totalRuns: 0,
      totalErrors: 0,
      lastError: null,
    };
  }

  async function recordSelfHealRun(payload) {
    const normalizedPlaybooks = normalizeExecutedPlaybooks(payload?.executedPlaybooks);
    const run = summarizeSelfHealRun({
      runId: randomUUID(),
      source: payload?.source,
      status: payload?.status,
      startedAt: payload?.startedAt ?? new Date().toISOString(),
      finishedAt: payload?.finishedAt ?? new Date().toISOString(),
      executedPlaybooks: normalizedPlaybooks,
    });

    selfHealRuns.unshift(run);
    if (selfHealRuns.length > 100) {
      selfHealRuns.length = 100;
    }

    return run;
  }

  async function listLatestSelfHealRuns(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    return selfHealRuns.slice(0, safeLimit);
  }

  async function enqueueSelfHealRetryJobs({ runId, source, jobs }) {
    const normalized = normalizeExecutedPlaybooks(jobs);
    const createdAt = new Date();

    const queueItems = normalized
      .filter((item) => item.status === 'failed' && item.maxRetries > item.retriesUsed)
      .map((item) => {
        const nextRetryAt = new Date(createdAt.getTime() + item.retryBackoffSec * 1000).toISOString();
        return {
          jobId: randomUUID(),
          runId,
          source: source ?? 'self-heal-worker-v1',
          playbookId: item.playbookId,
          status: 'queued',
          attempts: item.attempts,
          maxRetries: item.maxRetries,
          retriesUsed: item.retriesUsed,
          retryBackoffSec: item.retryBackoffSec,
          priorityScore: item.priorityScore,
          matchedAnomalyCodes: item.matchedAnomalyCodes,
          nextRetryAt,
          lastError: null,
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        };
      });

    selfHealRetryQueue.push(...queueItems);
    return {
      enqueued: queueItems.length,
      queueSize: selfHealRetryQueue.filter((item) => item.status === 'queued').length,
    };
  }

  async function processSelfHealRetryQueue({ limit = 20, now = Date.now() } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const queued = selfHealRetryQueue
      .filter((item) => item.status === 'queued' && Date.parse(item.nextRetryAt) <= nowMs)
      .sort((a, b) => b.priorityScore - a.priorityScore || a.nextRetryAt.localeCompare(b.nextRetryAt))
      .slice(0, safeLimit);

    let processed = 0;
    let completed = 0;
    let rescheduled = 0;
    let deadLettered = 0;

    for (const job of queued) {
      processed += 1;
      const outcome = evaluateSelfHealRetryAttempt(job);
      const jobRef = selfHealRetryQueue.find((item) => item.jobId === job.jobId);
      if (!jobRef) continue;

      const updatedAt = new Date().toISOString();
      if (outcome.outcome === 'done') {
        jobRef.status = 'done';
        jobRef.attempts = outcome.attempts;
        jobRef.retriesUsed = outcome.retriesUsed;
        jobRef.lastError = null;
        jobRef.updatedAt = updatedAt;
        completed += 1;
        continue;
      }

      if (outcome.outcome === 'retry') {
        jobRef.status = 'queued';
        jobRef.attempts = outcome.attempts;
        jobRef.retriesUsed = outcome.retriesUsed;
        jobRef.lastError = outcome.status;
        jobRef.nextRetryAt = new Date(nowMs + outcome.retryBackoffSec * 1000).toISOString();
        jobRef.updatedAt = updatedAt;
        rescheduled += 1;
        continue;
      }

      jobRef.status = 'dead_letter';
      jobRef.attempts = outcome.attempts;
      jobRef.retriesUsed = outcome.retriesUsed;
      jobRef.lastError = outcome.reason ?? 'unknown_dead_letter_reason';
      jobRef.updatedAt = updatedAt;
      selfHealDeadLetters.unshift({
        deadLetterId: randomUUID(),
        jobId: jobRef.jobId,
        runId: jobRef.runId,
        source: jobRef.source,
        playbookId: jobRef.playbookId,
        reason: jobRef.lastError,
        finalAttemptCount: jobRef.attempts,
        maxRetries: jobRef.maxRetries,
        payload: {
          retryBackoffSec: jobRef.retryBackoffSec,
          priorityScore: jobRef.priorityScore,
          matchedAnomalyCodes: jobRef.matchedAnomalyCodes,
        },
        createdAt: updatedAt,
      });
      deadLettered += 1;
    }

    if (selfHealDeadLetters.length > 200) {
      selfHealDeadLetters.length = 200;
    }

    return {
      processed,
      completed,
      rescheduled,
      deadLettered,
      queuePending: selfHealRetryQueue.filter((item) => item.status === 'queued').length,
    };
  }

  async function getSelfHealRetryStatus() {
    const pending = selfHealRetryQueue.filter((item) => item.status === 'queued').length;
    const done = selfHealRetryQueue.filter((item) => item.status === 'done').length;
    const deadLetter = selfHealRetryQueue.filter((item) => item.status === 'dead_letter').length;
    return {
      queuePending: pending,
      queueDone: done,
      queueDeadLetter: deadLetter,
      deadLetterCount: selfHealDeadLetters.length,
      scheduler: 'memory-interval',
    };
  }

  async function listSelfHealDeadLetters(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    return selfHealDeadLetters.slice(0, safeLimit);
  }

  return {
    mode: 'in-memory',
    listTrackings,
    getTracking,
    getProductDetail,
    updateThresholds,
    recordAutomationCycle,
    listLatestAutomationRuns,
    getAutomationDailyReadModel,
    getReadModelRefreshStatus,
    recordSelfHealRun,
    listLatestSelfHealRuns,
    enqueueSelfHealRetryJobs,
    processSelfHealRetryQueue,
    getSelfHealRetryStatus,
    listSelfHealDeadLetters,
    async close() {
      // no-op
    },
  };
}
