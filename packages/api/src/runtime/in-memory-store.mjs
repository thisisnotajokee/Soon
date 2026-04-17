import { randomUUID } from 'node:crypto';
import { evaluateSelfHealRetryAttempt } from './self-heal-playbooks.mjs';

const TRACKING_GLOBAL_ALLOWED_DOMAINS = new Set(['de', 'it', 'fr', 'es', 'uk', 'nl']);

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

function toBudgetTokens(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(2));
}

function toAmountTokens(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Number(parsed.toFixed(2));
}

function startOfDayIso(dayKey) {
  return `${dayKey}T00:00:00.000Z`;
}

function nextDayIso(dayKey) {
  const base = Date.parse(`${dayKey}T00:00:00.000Z`);
  return new Date(base + 24 * 60 * 60 * 1000).toISOString();
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
  const selfHealRequeueAudit = [];
  const tokenAllocationSnapshots = [];
  const tokenDailyBudgetLedger = new Map();
  const runtimeState = new Map();
  const trackingGlobalInactiveAsins = new Set();
  const trackingGlobalDomainDisabled = new Map();
  let selfHealManualRequeueTotal = 0;

  function normalizeTrackingDomains(domains = []) {
    return [
      ...new Set(
        (Array.isArray(domains) ? domains : [])
          .map((domain) => String(domain ?? '').trim().toLowerCase())
          .filter((domain) => TRACKING_GLOBAL_ALLOWED_DOMAINS.has(domain)),
      ),
    ];
  }

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

  async function saveTracking(payload = {}) {
    const asin = String(payload.asin ?? '').trim();
    if (!asin) return { error: 'asin_required' };

    const existing = byAsin.get(asin);
    const title =
      String(payload.title ?? payload.productTitle ?? existing?.title ?? '').trim() || `Tracking ${asin}`;
    const nowIso = new Date().toISOString();

    const parsePriceMap = (input, fallback = {}) => {
      if (!input || typeof input !== 'object') return { ...fallback };
      const next = {};
      for (const [market, raw] of Object.entries(input)) {
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;
        next[String(market).toLowerCase()] = Number(value.toFixed(2));
      }
      return Object.keys(next).length ? next : { ...fallback };
    };

    const pricesNew = parsePriceMap(payload.pricesNew, existing?.pricesNew ?? {});
    const pricesUsed = parsePriceMap(payload.pricesUsed, existing?.pricesUsed ?? {});
    const thresholdDropPct = Number(
      payload.thresholdDropPct ?? payload.dropPct ?? existing?.thresholdDropPct ?? 15,
    );
    const thresholdRisePct = Number(
      payload.thresholdRisePct ?? payload.risePct ?? existing?.thresholdRisePct ?? 15,
    );
    const targetPriceNew = Number(payload.targetPriceNew ?? existing?.targetPriceNew ?? 0);
    const targetPriceUsed = Number(payload.targetPriceUsed ?? existing?.targetPriceUsed ?? 0);

    const base =
      pricesNew.de ??
      Object.values(pricesNew)[0] ??
      existing?.pricesNew?.de ??
      Object.values(existing?.pricesNew ?? {})[0] ??
      100;

    const next = {
      asin,
      title,
      pricesNew,
      pricesUsed,
      thresholdDropPct: Number.isFinite(thresholdDropPct) ? thresholdDropPct : 15,
      thresholdRisePct: Number.isFinite(thresholdRisePct) ? thresholdRisePct : 15,
      targetPriceNew: Number.isFinite(targetPriceNew) ? targetPriceNew : null,
      targetPriceUsed: Number.isFinite(targetPriceUsed) ? targetPriceUsed : null,
      historyPoints: existing?.historyPoints ?? sampleHistory(base),
      updatedAt: nowIso,
    };

    byAsin.set(asin, next);
    return getProductDetail(asin);
  }

  async function deleteTracking(asin) {
    const key = String(asin ?? '').trim();
    if (!key) return { deleted: false, reason: 'asin_required' };
    const existed = byAsin.delete(key);
    trackingGlobalInactiveAsins.delete(key);
    trackingGlobalDomainDisabled.delete(key);
    return { deleted: existed };
  }

  async function deactivateAllTrackingsGlobal() {
    let totalTrackings = 0;
    let activeBefore = 0;

    for (const asin of byAsin.keys()) {
      totalTrackings += 1;
      if (!trackingGlobalInactiveAsins.has(asin)) {
        activeBefore += 1;
      }
      trackingGlobalInactiveAsins.add(asin);
    }

    return {
      total_trackings: totalTrackings,
      active_before: activeBefore,
      deactivated: activeBefore,
    };
  }

  async function activateAllTrackingsGlobal() {
    let affectedRows = 0;
    let reactivatedRows = 0;

    for (const asin of byAsin.keys()) {
      affectedRows += 1;
      if (trackingGlobalInactiveAsins.has(asin)) {
        reactivatedRows += 1;
      }
      trackingGlobalInactiveAsins.delete(asin);
      trackingGlobalDomainDisabled.delete(asin);
    }

    return {
      affected_rows: affectedRows,
      reactivated_rows: reactivatedRows,
      domains_backfilled_rows: 0,
    };
  }

  async function deactivateTrackingsDomainsGlobal(domains = []) {
    const safeDomains = normalizeTrackingDomains(domains);
    if (!safeDomains.length) {
      return {
        domains: [],
        affected_rows: 0,
        emptied_rows: 0,
        deactivated_rows: 0,
      };
    }

    let affectedRows = 0;
    let emptiedRows = 0;
    let deactivatedRows = 0;

    for (const asin of byAsin.keys()) {
      const disabledBefore = new Set(trackingGlobalDomainDisabled.get(asin) ?? []);
      const activeDomainsBefore = [...TRACKING_GLOBAL_ALLOWED_DOMAINS].filter(
        (domain) => !disabledBefore.has(domain),
      ).length;

      let changed = false;
      for (const domain of safeDomains) {
        if (!disabledBefore.has(domain)) {
          disabledBefore.add(domain);
          changed = true;
        }
      }

      if (!changed) continue;

      affectedRows += 1;
      const activeDomainsAfter = [...TRACKING_GLOBAL_ALLOWED_DOMAINS].filter(
        (domain) => !disabledBefore.has(domain),
      ).length;

      trackingGlobalDomainDisabled.set(asin, disabledBefore);

      if (activeDomainsBefore > 0 && activeDomainsAfter === 0) {
        emptiedRows += 1;
        if (!trackingGlobalInactiveAsins.has(asin)) {
          trackingGlobalInactiveAsins.add(asin);
          deactivatedRows += 1;
        }
      }
    }

    return {
      domains: safeDomains,
      affected_rows: affectedRows,
      emptied_rows: emptiedRows,
      deactivated_rows: deactivatedRows,
    };
  }

  async function activateTrackingsDomainsGlobal(domains = []) {
    const safeDomains = normalizeTrackingDomains(domains);
    if (!safeDomains.length) {
      return {
        domains: [],
        affected_rows: 0,
        reactivated_rows: 0,
      };
    }

    let affectedRows = 0;
    let reactivatedRows = 0;

    for (const asin of byAsin.keys()) {
      const disabled = new Set(trackingGlobalDomainDisabled.get(asin) ?? []);
      const activeDomainsBefore = [...TRACKING_GLOBAL_ALLOWED_DOMAINS].filter(
        (domain) => !disabled.has(domain),
      ).length;

      let changed = false;
      for (const domain of safeDomains) {
        if (disabled.has(domain)) {
          disabled.delete(domain);
          changed = true;
        }
      }
      if (!changed) continue;

      affectedRows += 1;
      if (disabled.size > 0) trackingGlobalDomainDisabled.set(asin, disabled);
      else trackingGlobalDomainDisabled.delete(asin);

      const activeDomainsAfter = [...TRACKING_GLOBAL_ALLOWED_DOMAINS].filter(
        (domain) => !disabled.has(domain),
      ).length;

      if (activeDomainsBefore === 0 && activeDomainsAfter > 0 && trackingGlobalInactiveAsins.has(asin)) {
        trackingGlobalInactiveAsins.delete(asin);
        reactivatedRows += 1;
      }
    }

    return {
      domains: safeDomains,
      affected_rows: affectedRows,
      reactivated_rows: reactivatedRows,
    };
  }

  async function getPriceHistory(asin, limit = 180) {
    const key = String(asin ?? '').trim();
    const item = byAsin.get(key);
    if (!item) return null;
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 180));
    return [...(item.historyPoints ?? [])].slice(-safeLimit);
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
    let retryExhausted = 0;
    let retryBackoffSeconds = 0;

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
        jobRef.retryBackoffSec = outcome.retryBackoffSec;
        jobRef.nextRetryAt = new Date(nowMs + outcome.retryBackoffSec * 1000).toISOString();
        jobRef.updatedAt = updatedAt;
        retryBackoffSeconds = Math.max(retryBackoffSeconds, Math.max(0, Number(outcome.retryBackoffSec ?? 0)));
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
      if (jobRef.lastError === 'retry_budget_exhausted') {
        retryExhausted += 1;
      }
    }

    if (selfHealDeadLetters.length > 200) {
      selfHealDeadLetters.length = 200;
    }

    return {
      processed,
      completed,
      rescheduled,
      deadLettered,
      retryExhausted,
      retryBackoffSeconds,
      queuePending: selfHealRetryQueue.filter((item) => item.status === 'queued').length,
    };
  }

  async function getSelfHealRetryStatus() {
    const nowMs = Date.now();
    const queued = selfHealRetryQueue.filter((item) => item.status === 'queued');
    const pending = selfHealRetryQueue.filter((item) => item.status === 'queued').length;
    const done = selfHealRetryQueue.filter((item) => item.status === 'done').length;
    const deadLetter = selfHealRetryQueue.filter((item) => item.status === 'dead_letter').length;
    const retryExhaustedTotal = selfHealDeadLetters.filter((item) => item.reason === 'retry_budget_exhausted').length;
    const retryBackoffSeconds = queued.reduce((maxValue, item) => {
      const nextRetryMs = Date.parse(item.nextRetryAt ?? '');
      if (!Number.isFinite(nextRetryMs)) return maxValue;
      const remaining = Math.max(0, Math.round((nextRetryMs - nowMs) / 1000));
      return Math.max(maxValue, remaining);
    }, 0);

    return {
      queuePending: pending,
      queueDone: done,
      queueDeadLetter: deadLetter,
      deadLetterCount: selfHealDeadLetters.length,
      retryExhaustedTotal,
      retryBackoffSeconds,
      manualRequeueTotal: selfHealManualRequeueTotal,
      scheduler: 'memory-interval',
    };
  }

  async function listSelfHealDeadLetters(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    return selfHealDeadLetters.slice(0, safeLimit);
  }

  async function requeueSelfHealDeadLetter(deadLetterId, { now = Date.now() } = {}) {
    const id = String(deadLetterId ?? '').trim();
    if (!id) return null;

    const deadLetter = selfHealDeadLetters.find((item) => item.deadLetterId === id);
    if (!deadLetter) return null;

    const queueEntry = selfHealRetryQueue.find((item) => item.jobId === deadLetter.jobId);
    if (!queueEntry) return null;
    if (queueEntry.status !== 'dead_letter') {
      return {
        error: 'not_dead_letter',
        deadLetterId: deadLetter.deadLetterId,
        queueJobId: queueEntry.jobId,
        currentStatus: queueEntry.status,
      };
    }

    const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    queueEntry.status = 'queued';
    queueEntry.maxRetries = Math.max(queueEntry.maxRetries, queueEntry.retriesUsed + 1);
    queueEntry.nextRetryAt = new Date(nowMs).toISOString();
    queueEntry.lastError = 'manual_requeue';
    queueEntry.updatedAt = new Date(nowMs).toISOString();
    selfHealManualRequeueTotal += 1;
    selfHealRequeueAudit.unshift({
      auditId: randomUUID(),
      deadLetterId: deadLetter.deadLetterId,
      queueJobId: queueEntry.jobId,
      runId: queueEntry.runId,
      source: queueEntry.source,
      playbookId: queueEntry.playbookId,
      reason: 'manual_requeue',
      createdAt: new Date(nowMs).toISOString(),
    });
    if (selfHealRequeueAudit.length > 500) {
      selfHealRequeueAudit.length = 500;
    }

    return {
      deadLetterId: deadLetter.deadLetterId,
      queueJobId: queueEntry.jobId,
      status: queueEntry.status,
      nextRetryAt: queueEntry.nextRetryAt,
      maxRetries: queueEntry.maxRetries,
      retriesUsed: queueEntry.retriesUsed,
    };
  }

  async function listSelfHealRequeueAudit(limit = 20, filters = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const reason = typeof filters?.reason === 'string' ? filters.reason.trim() : '';
    const fromMs = Number.isFinite(Number(filters?.fromMs)) ? Number(filters.fromMs) : null;
    const toMs = Number.isFinite(Number(filters?.toMs)) ? Number(filters.toMs) : null;

    const filtered = selfHealRequeueAudit.filter((item) => {
      if (reason && item.reason !== reason) return false;
      const createdMs = Date.parse(item.createdAt);
      if (!Number.isFinite(createdMs)) return false;
      if (fromMs !== null && createdMs < fromMs) return false;
      if (toMs !== null && createdMs > toMs) return false;
      return true;
    });

    return filtered.slice(0, safeLimit);
  }

  async function getSelfHealRequeueAuditSummary(days = 7, { now = Date.now() } = {}) {
    const safeDays = Math.max(1, Math.min(365, Number(days) || 7));
    const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const cutoffMs = nowMs - safeDays * 24 * 60 * 60 * 1000;

    const filtered = selfHealRequeueAudit.filter((item) => {
      const createdMs = Date.parse(item.createdAt);
      return Number.isFinite(createdMs) && createdMs >= cutoffMs;
    });

    const byReasonMap = new Map();
    const byPlaybookMap = new Map();
    const dailyMap = new Map();

    for (const item of filtered) {
      byReasonMap.set(item.reason, (byReasonMap.get(item.reason) ?? 0) + 1);
      byPlaybookMap.set(item.playbookId, (byPlaybookMap.get(item.playbookId) ?? 0) + 1);
      const day = item.createdAt.slice(0, 10);
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
    }

    return {
      days: safeDays,
      total: filtered.length,
      byReason: [...byReasonMap.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      byPlaybook: [...byPlaybookMap.entries()]
        .map(([playbookId, count]) => ({ playbookId, count }))
        .sort((a, b) => b.count - a.count),
      daily: [...dailyMap.entries()]
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    };
  }

  async function requeueSelfHealDeadLetters({ limit = 20, deadLetterIds, now = Date.now() } = {}) {
    const hasIdList = Array.isArray(deadLetterIds) && deadLetterIds.length > 0;
    const normalizedIds = hasIdList
      ? [...new Set(deadLetterIds.map((value) => String(value ?? '').trim()).filter(Boolean))]
      : [];
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const candidates = hasIdList ? normalizedIds.map((id) => ({ deadLetterId: id })) : selfHealDeadLetters.slice(0, safeLimit);
    const requeuedItems = [];
    let conflicts = 0;
    let missing = 0;

    for (const item of candidates) {
      const requeued = await requeueSelfHealDeadLetter(item.deadLetterId, { now });
      if (requeued && !requeued.error) {
        requeuedItems.push(requeued);
      } else if (requeued?.error === 'not_dead_letter') {
        conflicts += 1;
      } else {
        missing += 1;
      }
    }

    return {
      requested: candidates.length,
      requeued: requeuedItems.length,
      conflicts,
      missing,
      items: requeuedItems,
    };
  }

  async function getRuntimeState(stateKey) {
    const key = String(stateKey ?? '').trim();
    if (!key) return null;
    const entry = runtimeState.get(key);
    return entry ? { stateKey: key, ...entry } : null;
  }

  async function setRuntimeState(stateKey, stateValue) {
    const key = String(stateKey ?? '').trim();
    if (!key) return null;
    const entry = {
      stateValue: stateValue ?? null,
      updatedAt: new Date().toISOString(),
    };
    runtimeState.set(key, entry);
    return { stateKey: key, ...entry };
  }

  async function getTokenDailyBudgetStatus({ day, budgetTokens } = {}) {
    const dayKey = toDayKey(day ?? new Date().toISOString());
    if (!dayKey) return null;

    const normalizedBudget = toBudgetTokens(budgetTokens);
    const entry = tokenDailyBudgetLedger.get(dayKey);
    const consumedRaw = entry ? Number(entry.consumedTokens ?? 0) : 0;
    const consumed =
      normalizedBudget === null
        ? Number(Math.max(0, consumedRaw).toFixed(2))
        : Number(Math.min(normalizedBudget, Math.max(0, consumedRaw)).toFixed(2));
    const remaining =
      normalizedBudget === null ? null : Number(Math.max(0, normalizedBudget - consumed).toFixed(2));
    const usagePct =
      normalizedBudget === null || normalizedBudget <= 0
        ? 0
        : Number(((consumed / normalizedBudget) * 100).toFixed(2));

    return {
      day: dayKey,
      mode: normalizedBudget === null ? 'unbounded' : 'capped',
      budgetTokens: normalizedBudget,
      consumedTokens: consumed,
      remainingTokens: remaining,
      usagePct,
      exhausted: normalizedBudget !== null ? remaining <= 0 : false,
      windowStartedAt: startOfDayIso(dayKey),
      windowResetAt: nextDayIso(dayKey),
      updatedAt: entry?.updatedAt ?? new Date().toISOString(),
    };
  }

  async function consumeTokenDailyBudget({ day, budgetTokens, amountTokens } = {}) {
    const dayKey = toDayKey(day ?? new Date().toISOString());
    if (!dayKey) return null;

    const normalizedBudget = toBudgetTokens(budgetTokens);
    if (normalizedBudget === null) {
      return getTokenDailyBudgetStatus({ day: dayKey, budgetTokens: null });
    }

    const amount = toAmountTokens(amountTokens);
    const existing = tokenDailyBudgetLedger.get(dayKey);
    const consumedBefore = existing ? Number(existing.consumedTokens ?? 0) : 0;
    const consumedAfter = Number(Math.min(normalizedBudget, consumedBefore + amount).toFixed(2));
    tokenDailyBudgetLedger.set(dayKey, {
      consumedTokens: consumedAfter,
      budgetTokens: normalizedBudget,
      updatedAt: new Date().toISOString(),
    });

    return getTokenDailyBudgetStatus({ day: dayKey, budgetTokens: normalizedBudget });
  }

  async function recordTokenAllocationSnapshot(payload = {}) {
    const snapshot = {
      snapshotId: randomUUID(),
      runId: payload.runId ?? null,
      budgetMode: payload.budgetMode ?? 'unbounded',
      summary: {
        requested: Number(payload?.summary?.requested ?? 0),
        selected: Number(payload?.summary?.selected ?? 0),
        skipped: Number(payload?.summary?.skipped ?? 0),
        budgetTokens:
          payload?.summary?.budgetTokens === null || payload?.summary?.budgetTokens === undefined
            ? null
            : Number(payload.summary.budgetTokens),
        totalTokenCostSelected: Number(payload?.summary?.totalTokenCostSelected ?? 0),
        remainingBudgetTokens:
          payload?.summary?.remainingBudgetTokens === null || payload?.summary?.remainingBudgetTokens === undefined
            ? null
            : Number(payload.summary.remainingBudgetTokens),
      },
      plan: Array.isArray(payload.plan)
        ? payload.plan.map((item) => ({
            asin: String(item.asin ?? ''),
            expectedValue: Number(item.expectedValue ?? 0),
            confidence: Number(item.confidence ?? 0),
            tokenCost: Number(item.tokenCost ?? 0),
            priority: Number(item.priority ?? 0),
            selected: Boolean(item.selected),
            skipReason: item.skipReason ?? null,
            remainingBudgetAfter:
              item.remainingBudgetAfter === null || item.remainingBudgetAfter === undefined
                ? null
                : Number(item.remainingBudgetAfter),
          }))
        : [],
      createdAt: new Date().toISOString(),
    };

    tokenAllocationSnapshots.unshift(snapshot);
    if (tokenAllocationSnapshots.length > 200) {
      tokenAllocationSnapshots.length = 200;
    }
    return snapshot;
  }

  async function listLatestTokenAllocationSnapshots(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    return tokenAllocationSnapshots.slice(0, safeLimit);
  }

  return {
    mode: 'in-memory',
    listTrackings,
    getTracking,
    getProductDetail,
    updateThresholds,
    saveTracking,
    deleteTracking,
    deactivateAllTrackingsGlobal,
    activateAllTrackingsGlobal,
    deactivateTrackingsDomainsGlobal,
    activateTrackingsDomainsGlobal,
    getPriceHistory,
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
    requeueSelfHealDeadLetter,
    requeueSelfHealDeadLetters,
    listSelfHealRequeueAudit,
    getSelfHealRequeueAuditSummary,
    getRuntimeState,
    setRuntimeState,
    getTokenDailyBudgetStatus,
    consumeTokenDailyBudget,
    recordTokenAllocationSnapshot,
    listLatestTokenAllocationSnapshots,
    async close() {
      // no-op
    },
  };
}
