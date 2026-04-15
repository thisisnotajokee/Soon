import http from 'node:http';
import { URL } from 'node:url';

import { createInMemoryStore } from './in-memory-store.mjs';
import { readJsonBody, sendJson } from './json.mjs';
import { runAutomationCycle } from './automation-cycle.mjs';
import { createPostgresStore } from './postgres-store.mjs';
import { runSelfHealWorker } from './workers/self-heal-worker.mjs';

function modulesList() {
  return [
    'tracking-core',
    'hunter-core',
    'token-control-plane',
    'autonomy-orchestrator',
    'self-heal-controller',
    'alert-router',
    'ml-platform',
  ];
}

function resolveStore() {
  const mode = (process.env.SOON_DB_MODE ?? 'memory').toLowerCase();

  if (mode === 'postgres') {
    return createPostgresStore();
  }

  return createInMemoryStore();
}

function aggregateRunMetrics(items) {
  const runs = items.length;
  const totals = items.reduce(
    (acc, item) => {
      acc.trackingCount += item.trackingCount ?? 0;
      acc.decisionCount += item.decisionCount ?? 0;
      acc.alertCount += item.alertCount ?? 0;
      acc.purchaseAlertCount += item.purchaseAlertCount ?? 0;
      acc.technicalAlertCount += item.technicalAlertCount ?? 0;
      return acc;
    },
    {
      trackingCount: 0,
      decisionCount: 0,
      alertCount: 0,
      purchaseAlertCount: 0,
      technicalAlertCount: 0,
    },
  );

  const alertsByChannel = { telegram: 0, discord: 0 };
  const alertedAsins = new Map();

  for (const run of items) {
    for (const alert of run.alerts ?? []) {
      if (alert.channel === 'telegram') alertsByChannel.telegram += 1;
      if (alert.channel === 'discord') alertsByChannel.discord += 1;
      if (alert.asin && alert.asin !== 'system') {
        alertedAsins.set(alert.asin, (alertedAsins.get(alert.asin) ?? 0) + 1);
      }
    }
  }

  const topAlertedAsins = [...alertedAsins.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([asin, count]) => ({ asin, alerts: count }));

  const kpi = runs
    ? {
        avgTrackingCount: Number((totals.trackingCount / runs).toFixed(2)),
        avgDecisionCount: Number((totals.decisionCount / runs).toFixed(2)),
        avgAlertCount: Number((totals.alertCount / runs).toFixed(2)),
        purchaseAlertRatePct:
          totals.alertCount > 0 ? Number(((totals.purchaseAlertCount / totals.alertCount) * 100).toFixed(2)) : 0,
        technicalAlertRatePct:
          totals.alertCount > 0 ? Number(((totals.technicalAlertCount / totals.alertCount) * 100).toFixed(2)) : 0,
      }
    : {
        avgTrackingCount: 0,
        avgDecisionCount: 0,
        avgAlertCount: 0,
        purchaseAlertRatePct: 0,
        technicalAlertRatePct: 0,
      };

  return {
    runs,
    kpi,
    alertsByChannel,
    topAlertedAsins,
  };
}

function summarizeAutomationRuns(items, limit) {
  const metrics = aggregateRunMetrics(items);
  return {
    window: { limit, runs: metrics.runs },
    kpi: metrics.kpi,
    alertsByChannel: metrics.alertsByChannel,
    topAlertedAsins: metrics.topAlertedAsins,
  };
}

function dayKeyFromTimestamp(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function toPromNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toPromUnixTs(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function escapePromLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function buildBulkRequeueOperationalAlert(summary) {
  const conflicts = Number(summary?.conflicts ?? 0);
  const missing = Number(summary?.missing ?? 0);
  if (conflicts <= 0 && missing <= 0) return null;

  const requested = Number(summary?.requested ?? 0);
  const requeued = Number(summary?.requeued ?? 0);
  const reasons = [];
  if (conflicts > 0) reasons.push('conflicts');
  if (missing > 0) reasons.push('missing');

  return {
    level: 'warn',
    code: 'self_heal_bulk_requeue_partial',
    reasons,
    message: `Bulk requeue partial: requested=${requested}, requeued=${requeued}, conflicts=${conflicts}, missing=${missing}.`,
    metrics: { requested, requeued, conflicts, missing },
  };
}

function aggregateTrendWindowFromDaily(items) {
  const totals = items.reduce(
    (acc, item) => {
      const runs = Number(item.runs ?? 0);
      const sums = item.sums ?? {};
      const trackingCount = Number(sums.trackingCount ?? Math.round((item.kpi?.avgTrackingCount ?? 0) * runs));
      const decisionCount = Number(sums.decisionCount ?? Math.round((item.kpi?.avgDecisionCount ?? 0) * runs));
      const alertCount = Number(sums.alertCount ?? Math.round((item.kpi?.avgAlertCount ?? 0) * runs));
      const purchaseAlertCount = Number(
        sums.purchaseAlertCount ??
          Math.round(((item.kpi?.purchaseAlertRatePct ?? 0) / 100) * alertCount),
      );
      const technicalAlertCount = Number(
        sums.technicalAlertCount ??
          Math.round(((item.kpi?.technicalAlertRatePct ?? 0) / 100) * alertCount),
      );

      acc.runs += runs;
      acc.trackingCount += trackingCount;
      acc.decisionCount += decisionCount;
      acc.alertCount += alertCount;
      acc.purchaseAlertCount += purchaseAlertCount;
      acc.technicalAlertCount += technicalAlertCount;
      acc.telegram += Number(item.alertsByChannel?.telegram ?? 0);
      acc.discord += Number(item.alertsByChannel?.discord ?? 0);
      return acc;
    },
    {
      runs: 0,
      trackingCount: 0,
      decisionCount: 0,
      alertCount: 0,
      purchaseAlertCount: 0,
      technicalAlertCount: 0,
      telegram: 0,
      discord: 0,
    },
  );

  const asinAlertMap = new Map();
  for (const item of items) {
    for (const top of item.topAlertedAsins ?? []) {
      if (!top?.asin) continue;
      asinAlertMap.set(top.asin, (asinAlertMap.get(top.asin) ?? 0) + Number(top.alerts ?? 0));
    }
  }

  return {
    runs: totals.runs,
    kpi: {
      avgTrackingCount: totals.runs > 0 ? Number((totals.trackingCount / totals.runs).toFixed(2)) : 0,
      avgDecisionCount: totals.runs > 0 ? Number((totals.decisionCount / totals.runs).toFixed(2)) : 0,
      avgAlertCount: totals.runs > 0 ? Number((totals.alertCount / totals.runs).toFixed(2)) : 0,
      purchaseAlertRatePct:
        totals.alertCount > 0 ? Number(((totals.purchaseAlertCount / totals.alertCount) * 100).toFixed(2)) : 0,
      technicalAlertRatePct:
        totals.alertCount > 0 ? Number(((totals.technicalAlertCount / totals.alertCount) * 100).toFixed(2)) : 0,
    },
    alertsByChannel: {
      telegram: totals.telegram,
      discord: totals.discord,
    },
    topAlertedAsins: [...asinAlertMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([asin, alerts]) => ({ asin, alerts })),
  };
}

function summarizeAutomationRunTrendsFromDaily(dailyModel, days) {
  const now = Date.now();
  const dailyItems = dailyModel?.items ?? [];
  const windows = [
    ['24h', 1],
    ['7d', 7],
    ['30d', 30],
  ];

  const summary = windows.map(([label, windowDays]) => {
    const cutoffDay = dayKeyFromTimestamp(now - (windowDays - 1) * 24 * 60 * 60 * 1000);
    const filtered = dailyItems.filter((item) => item.day >= cutoffDay);
    const aggregated = aggregateTrendWindowFromDaily(filtered);
    return {
      window: label,
      runs: aggregated.runs,
      kpi: aggregated.kpi,
      alertsByChannel: aggregated.alertsByChannel,
      topAlertedAsins: aggregated.topAlertedAsins,
    };
  });

  return {
    source: 'daily-read-model',
    sourceDaysLimit: days,
    generatedAt: new Date(now).toISOString(),
    windows: summary,
  };
}

function renderReadModelPrometheusMetrics(status) {
  const pendingDays = Array.isArray(status?.pendingDays) ? status.pendingDays : [];
  const hasError = status?.lastError ? 1 : 0;
  const mode = escapePromLabel(status?.mode ?? 'unknown');

  const lines = [
    '# HELP soon_read_model_refresh_info Read-model refresh mode metadata.',
    '# TYPE soon_read_model_refresh_info gauge',
    `soon_read_model_refresh_info{mode="${mode}"} 1`,
    '# HELP soon_read_model_refresh_pending_count Number of queued day refresh tasks.',
    '# TYPE soon_read_model_refresh_pending_count gauge',
    `soon_read_model_refresh_pending_count ${toPromNumber(status?.pendingCount)}`,
    '# HELP soon_read_model_refresh_in_flight Whether refresh worker is currently running.',
    '# TYPE soon_read_model_refresh_in_flight gauge',
    `soon_read_model_refresh_in_flight ${status?.inFlight ? 1 : 0}`,
    '# HELP soon_read_model_refresh_last_duration_ms Duration of last refresh batch in milliseconds.',
    '# TYPE soon_read_model_refresh_last_duration_ms gauge',
    `soon_read_model_refresh_last_duration_ms ${toPromNumber(status?.lastDurationMs)}`,
    '# HELP soon_read_model_refresh_last_batch_days Number of distinct days in last refresh batch.',
    '# TYPE soon_read_model_refresh_last_batch_days gauge',
    `soon_read_model_refresh_last_batch_days ${toPromNumber(status?.lastBatchDays)}`,
    '# HELP soon_read_model_refresh_total_runs Total successful refresh batches.',
    '# TYPE soon_read_model_refresh_total_runs counter',
    `soon_read_model_refresh_total_runs ${toPromNumber(status?.totalRuns)}`,
    '# HELP soon_read_model_refresh_total_errors Total failed refresh batches.',
    '# TYPE soon_read_model_refresh_total_errors counter',
    `soon_read_model_refresh_total_errors ${toPromNumber(status?.totalErrors)}`,
    '# HELP soon_read_model_refresh_last_error Whether last refresh ended with an error.',
    '# TYPE soon_read_model_refresh_last_error gauge',
    `soon_read_model_refresh_last_error ${hasError}`,
    '# HELP soon_read_model_refresh_last_queued_unixtime Last queued timestamp (unix seconds).',
    '# TYPE soon_read_model_refresh_last_queued_unixtime gauge',
    `soon_read_model_refresh_last_queued_unixtime ${toPromUnixTs(status?.lastQueuedAt)}`,
    '# HELP soon_read_model_refresh_last_started_unixtime Last started timestamp (unix seconds).',
    '# TYPE soon_read_model_refresh_last_started_unixtime gauge',
    `soon_read_model_refresh_last_started_unixtime ${toPromUnixTs(status?.lastStartedAt)}`,
    '# HELP soon_read_model_refresh_last_finished_unixtime Last finished timestamp (unix seconds).',
    '# TYPE soon_read_model_refresh_last_finished_unixtime gauge',
    `soon_read_model_refresh_last_finished_unixtime ${toPromUnixTs(status?.lastFinishedAt)}`,
    '# HELP soon_read_model_refresh_pending_day Pending day refresh marker.',
    '# TYPE soon_read_model_refresh_pending_day gauge',
  ];

  if (pendingDays.length) {
    for (const day of pendingDays) {
      lines.push(`soon_read_model_refresh_pending_day{day="${escapePromLabel(day)}"} 1`);
    }
  } else {
    lines.push('soon_read_model_refresh_pending_day{day="none"} 0');
  }

  return `${lines.join('\n')}\n`;
}

function renderSelfHealRetryPrometheusMetrics(status) {
  const scheduler = escapePromLabel(status?.scheduler ?? 'unknown');
  const lines = [
    '# HELP soon_self_heal_retry_queue_info Self-heal retry queue metadata.',
    '# TYPE soon_self_heal_retry_queue_info gauge',
    `soon_self_heal_retry_queue_info{scheduler="${scheduler}"} 1`,
    '# HELP soon_self_heal_retry_queue_pending Number of queued self-heal retry jobs.',
    '# TYPE soon_self_heal_retry_queue_pending gauge',
    `soon_self_heal_retry_queue_pending ${toPromNumber(status?.queuePending)}`,
    '# HELP soon_self_heal_retry_queue_done Number of completed self-heal retry jobs.',
    '# TYPE soon_self_heal_retry_queue_done counter',
    `soon_self_heal_retry_queue_done ${toPromNumber(status?.queueDone)}`,
    '# HELP soon_self_heal_retry_queue_dead_letter Number of retry jobs moved to dead-letter.',
    '# TYPE soon_self_heal_retry_queue_dead_letter counter',
    `soon_self_heal_retry_queue_dead_letter ${toPromNumber(status?.queueDeadLetter)}`,
    '# HELP soon_self_heal_dead_letter_total Number of dead-letter records.',
    '# TYPE soon_self_heal_dead_letter_total gauge',
    `soon_self_heal_dead_letter_total ${toPromNumber(status?.deadLetterCount)}`,
    '# HELP soon_self_heal_manual_requeue_total Number of manual dead-letter requeue operations.',
    '# TYPE soon_self_heal_manual_requeue_total counter',
    `soon_self_heal_manual_requeue_total ${toPromNumber(status?.manualRequeueTotal)}`,
  ];
  return `${lines.join('\n')}\n`;
}

export function createSoonApiServer({ store = resolveStore() } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = url.pathname;

      if (method === 'GET' && pathname === '/health') {
        return sendJson(res, 200, {
          status: 'ok',
          service: 'soon-api',
          modules: modulesList(),
          storage: store.mode,
          serverTime: new Date().toISOString(),
        });
      }

      if (method === 'GET' && pathname === '/trackings') {
        const items = await store.listTrackings();
        return sendJson(res, 200, {
          items,
          count: items.length,
        });
      }

      const detailMatch = pathname.match(/^\/products\/([^/]+)\/detail$/);
      if (method === 'GET' && detailMatch) {
        const asin = decodeURIComponent(detailMatch[1]);
        const detail = await store.getProductDetail(asin);
        if (!detail) {
          return sendJson(res, 404, { error: 'not_found', asin });
        }
        return sendJson(res, 200, detail);
      }

      const thresholdMatch = pathname.match(/^\/trackings\/([^/]+)\/thresholds$/);
      if (method === 'POST' && thresholdMatch) {
        const asin = decodeURIComponent(thresholdMatch[1]);
        const body = await readJsonBody(req);
        const updated = await store.updateThresholds(asin, body);

        if (!updated) {
          return sendJson(res, 404, { error: 'not_found', asin });
        }

        return sendJson(res, 200, {
          status: 'updated',
          asin,
          thresholds: updated.thresholds,
          updatedAt: updated.updatedAt,
        });
      }

      if (method === 'POST' && pathname === '/automation/cycle') {
        const startedAt = new Date().toISOString();
        const trackings = await store.listTrackings();
        const cycle = runAutomationCycle(trackings);
        const finishedAt = new Date().toISOString();

        const persisted = store.recordAutomationCycle
          ? await store.recordAutomationCycle({
              cycle,
              trackingCount: trackings.length,
              startedAt,
              finishedAt,
            })
          : null;

        return sendJson(res, 200, {
          status: 'ok',
          runId: persisted?.runId ?? null,
          ...cycle,
          persisted,
        });
      }

      if (method === 'GET' && pathname === '/automation/runs/latest') {
        const rawLimit = Number(url.searchParams.get('limit') ?? 20);
        const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));

        if (!store.listLatestAutomationRuns) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const items = await store.listLatestAutomationRuns(limit);
        return sendJson(res, 200, { items, count: items.length });
      }

      if (method === 'GET' && pathname === '/automation/runs/summary') {
        const rawLimit = Number(url.searchParams.get('limit') ?? 20);
        const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));

        if (!store.listLatestAutomationRuns) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const items = await store.listLatestAutomationRuns(limit);
        const summary = summarizeAutomationRuns(items, limit);
        return sendJson(res, 200, summary);
      }

      if (method === 'GET' && pathname === '/automation/runs/trends') {
        const rawDays = Number(url.searchParams.get('days') ?? url.searchParams.get('limit') ?? 30);
        const days = Math.max(1, Math.min(90, Number.isFinite(rawDays) ? rawDays : 30));

        if (!store.getAutomationDailyReadModel) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const dailyModel = await store.getAutomationDailyReadModel(days);
        const trends = summarizeAutomationRunTrendsFromDaily(dailyModel, days);
        return sendJson(res, 200, trends);
      }

      if (method === 'GET' && pathname === '/automation/runs/daily') {
        const rawDays = Number(url.searchParams.get('days') ?? 30);
        const days = Math.max(1, Math.min(90, Number.isFinite(rawDays) ? rawDays : 30));

        if (!store.getAutomationDailyReadModel) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const daily = await store.getAutomationDailyReadModel(days);
        return sendJson(res, 200, daily);
      }

      if (method === 'GET' && pathname === '/automation/read-model/status') {
        if (!store.getReadModelRefreshStatus) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const status = await store.getReadModelRefreshStatus();
        return sendJson(res, 200, status);
      }

      if (method === 'POST' && pathname === '/self-heal/run') {
        const body = await readJsonBody(req).catch(() => ({}));
        const override = body?.readModelStatusOverride ?? null;
        const cycle = await runSelfHealWorker({
          readModelStatusProvider: store.getReadModelRefreshStatus
            ? async () => (override ?? store.getReadModelRefreshStatus())
            : undefined,
        });
        const persisted = store.recordSelfHealRun ? await store.recordSelfHealRun(cycle) : null;
        const retryQueue = store.enqueueSelfHealRetryJobs
          ? await store.enqueueSelfHealRetryJobs({
              runId: persisted?.runId ?? cycle.runId ?? null,
              source: cycle.source,
              jobs: cycle.executedPlaybooks,
            })
          : null;

        return sendJson(res, 200, {
          status: 'ok',
          ...cycle,
          runId: persisted?.runId ?? null,
          persisted,
          retryQueue,
        });
      }

      if (method === 'GET' && pathname === '/self-heal/runs/latest') {
        const rawLimit = Number(url.searchParams.get('limit') ?? 20);
        const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));

        if (!store.listLatestSelfHealRuns) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const items = await store.listLatestSelfHealRuns(limit);
        return sendJson(res, 200, { items, count: items.length });
      }

      if (method === 'POST' && pathname === '/self-heal/retry/process') {
        const body = await readJsonBody(req).catch(() => ({}));
        const rawLimit = Number(body?.limit ?? url.searchParams.get('limit') ?? 20);
        const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));
        const rawNow = body?.now ?? url.searchParams.get('now');
        const now = Number.isFinite(Number(rawNow)) ? Number(rawNow) : Date.now();

        if (!store.processSelfHealRetryQueue) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const summary = await store.processSelfHealRetryQueue({ limit, now });
        return sendJson(res, 200, { status: 'ok', summary });
      }

      if (method === 'GET' && pathname === '/self-heal/retry/status') {
        if (!store.getSelfHealRetryStatus) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const status = await store.getSelfHealRetryStatus();
        return sendJson(res, 200, status);
      }

      if (method === 'GET' && pathname === '/self-heal/dead-letter') {
        const rawLimit = Number(url.searchParams.get('limit') ?? 20);
        const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));

        if (!store.listSelfHealDeadLetters) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const items = await store.listSelfHealDeadLetters(limit);
        return sendJson(res, 200, { items, count: items.length });
      }

      if (method === 'POST' && pathname === '/self-heal/dead-letter/requeue') {
        if (!store.requeueSelfHealDeadLetter) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const body = await readJsonBody(req).catch(() => ({}));
        const deadLetterId = body?.deadLetterId;
        if (!deadLetterId) {
          return sendJson(res, 400, { error: 'dead_letter_id_required' });
        }

        const result = await store.requeueSelfHealDeadLetter(deadLetterId, { now: Date.now() });
        if (!result) {
          return sendJson(res, 404, { error: 'dead_letter_not_found', deadLetterId: String(deadLetterId) });
        }
        if (result.error === 'not_dead_letter') {
          return sendJson(res, 409, {
            error: 'dead_letter_not_pending',
            deadLetterId: String(deadLetterId),
            currentStatus: result.currentStatus ?? 'unknown',
          });
        }

        const retryStatus = store.getSelfHealRetryStatus ? await store.getSelfHealRetryStatus() : null;
        return sendJson(res, 200, { status: 'ok', requeue: result, retryStatus });
      }

      if (method === 'POST' && pathname === '/self-heal/dead-letter/requeue-bulk') {
        if (!store.requeueSelfHealDeadLetters) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const body = await readJsonBody(req).catch(() => ({}));
        const hasIds = Array.isArray(body?.deadLetterIds);
        const deadLetterIds = hasIds
          ? [...new Set(body.deadLetterIds.map((value) => String(value ?? '').trim()).filter(Boolean))]
          : null;
        if (hasIds && (!deadLetterIds || deadLetterIds.length === 0)) {
          return sendJson(res, 400, { error: 'dead_letter_ids_invalid' });
        }

        const rawLimit = Number(body?.limit ?? url.searchParams.get('limit') ?? 20);
        const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));
        const rawNow = body?.now ?? url.searchParams.get('now');
        const now = Number.isFinite(Number(rawNow)) ? Number(rawNow) : Date.now();

        const summary = await store.requeueSelfHealDeadLetters({ limit, deadLetterIds, now });
        const retryStatus = store.getSelfHealRetryStatus ? await store.getSelfHealRetryStatus() : null;
        const operationalAlert = buildBulkRequeueOperationalAlert(summary);
        if (operationalAlert) {
          console.warn('[Soon/self-heal] bulk requeue partial', operationalAlert.metrics);
        }
        return sendJson(res, 200, { status: 'ok', summary, retryStatus, operationalAlert });
      }

      if (method === 'GET' && pathname === '/self-heal/requeue-audit') {
        const rawLimit = Number(url.searchParams.get('limit') ?? 20);
        const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));
        const reason = (url.searchParams.get('reason') ?? '').trim();
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const fromMs = from ? Date.parse(from) : null;
        const toMs = to ? Date.parse(to) : null;

        if (from && !Number.isFinite(fromMs)) {
          return sendJson(res, 400, { error: 'invalid_from_timestamp' });
        }
        if (to && !Number.isFinite(toMs)) {
          return sendJson(res, 400, { error: 'invalid_to_timestamp' });
        }

        if (!store.listSelfHealRequeueAudit) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const items = await store.listSelfHealRequeueAudit(limit, {
          reason: reason || undefined,
          fromMs: fromMs ?? undefined,
          toMs: toMs ?? undefined,
        });
        return sendJson(res, 200, { items, count: items.length });
      }

      if (method === 'GET' && pathname === '/self-heal/requeue-audit/summary') {
        if (!store.getSelfHealRequeueAuditSummary) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const rawDays = Number(url.searchParams.get('days') ?? 7);
        const days = Math.max(1, Math.min(365, Number.isFinite(rawDays) ? rawDays : 7));
        const summary = await store.getSelfHealRequeueAuditSummary(days, { now: Date.now() });
        return sendJson(res, 200, summary);
      }

      if (method === 'GET' && pathname === '/metrics') {
        if (!store.getReadModelRefreshStatus) {
          res.writeHead(501, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('soon_read_model_metrics_unavailable 1\n');
          return;
        }

        const status = await store.getReadModelRefreshStatus();
        const retryStatus = store.getSelfHealRetryStatus ? await store.getSelfHealRetryStatus() : null;
        const payload = retryStatus
          ? `${renderReadModelPrometheusMetrics(status)}${renderSelfHealRetryPrometheusMetrics(retryStatus)}`
          : renderReadModelPrometheusMetrics(status);
        res.writeHead(200, {
          'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(payload);
        return;
      }

      return sendJson(res, 404, { error: 'route_not_found', method, pathname });
    } catch (error) {
      return sendJson(res, 500, {
        error: 'internal_error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function startFromCli() {
  const port = Number(process.env.PORT ?? 3100);
  const host = process.env.HOST ?? '127.0.0.1';

  const store = resolveStore();
  const server = createSoonApiServer({ store });
  const retryIntervalSec = Math.max(5, Number(process.env.SOON_SELF_HEAL_RETRY_INTERVAL_SEC ?? 30));
  let retryTimer = null;

  if (store.processSelfHealRetryQueue) {
    retryTimer = setInterval(() => {
      store.processSelfHealRetryQueue({ limit: 20 }).catch((error) => {
        console.error('[Soon/self-heal] retry scheduler error', error);
      });
    }, retryIntervalSec * 1000);
    retryTimer.unref();
  }

  const shutdown = async () => {
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
    await new Promise((resolve) => server.close(resolve));
    if (store?.close) {
      await store.close();
    }
    process.exit(0);
  };

  process.on('SIGINT', () => {
    shutdown().catch((err) => {
      console.error('[Soon/api] shutdown error', err);
      process.exit(1);
    });
  });

  server.listen(port, host, () => {
    console.log(`[Soon/api] runtime server listening on http://${host}:${port} (store=${store.mode})`);
  });
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  startFromCli();
}
