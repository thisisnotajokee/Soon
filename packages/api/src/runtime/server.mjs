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

const ALERT_ROUTING_REMEDIATION_STATE_KEY = 'alert_routing_last_remediation_at';
const RUNTIME_STATE_ALLOWLIST = new Set([ALERT_ROUTING_REMEDIATION_STATE_KEY]);

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

function evaluateSelfHealOperationalStatus(retryStatus) {
  const pending = Number(retryStatus?.queuePending ?? 0);
  const deadLetter = Number(retryStatus?.deadLetterCount ?? 0);
  const queueDeadLetter = Number(retryStatus?.queueDeadLetter ?? 0);
  const signals = [];

  if (pending >= 200) signals.push({ level: 'crit', code: 'retry_queue_pending_critical', value: pending });
  else if (pending >= 50) signals.push({ level: 'warn', code: 'retry_queue_pending_high', value: pending });

  if (deadLetter >= 20) signals.push({ level: 'crit', code: 'dead_letter_count_critical', value: deadLetter });
  else if (deadLetter > 0) signals.push({ level: 'warn', code: 'dead_letter_count_nonzero', value: deadLetter });

  if (queueDeadLetter > 0) {
    signals.push({ level: 'warn', code: 'retry_queue_dead_letter_nonzero', value: queueDeadLetter });
  }

  const hasCrit = signals.some((item) => item.level === 'crit');
  const hasWarn = signals.some((item) => item.level === 'warn');
  return {
    overall: hasCrit ? 'CRIT' : hasWarn ? 'WARN' : 'PASS',
    signals,
  };
}

function summarizeAlertRouting(items, limit) {
  const metrics = {
    purchaseToNonTelegram: 0,
    purchaseToDiscord: 0,
    technicalToNonDiscord: 0,
    technicalToTelegram: 0,
    unknownKind: 0,
    unknownChannel: 0,
  };
  const alertsByChannel = { telegram: 0, discord: 0, other: 0 };

  for (const run of items) {
    for (const alert of run.alerts ?? []) {
      const kind = alert?.kind;
      const channel = alert?.channel;

      if (channel === 'telegram') alertsByChannel.telegram += 1;
      else if (channel === 'discord') alertsByChannel.discord += 1;
      else alertsByChannel.other += 1;

      if (!kind || (kind !== 'purchase' && kind !== 'technical')) {
        metrics.unknownKind += 1;
      } else if (kind === 'purchase' && channel !== 'telegram') {
        metrics.purchaseToNonTelegram += 1;
        if (channel === 'discord') metrics.purchaseToDiscord += 1;
      } else if (kind === 'technical' && channel !== 'discord') {
        metrics.technicalToNonDiscord += 1;
        if (channel === 'telegram') metrics.technicalToTelegram += 1;
      }

      if (!channel || (channel !== 'telegram' && channel !== 'discord')) {
        metrics.unknownChannel += 1;
      }
    }
  }

  const totalViolations =
    metrics.purchaseToNonTelegram +
    metrics.technicalToNonDiscord +
    metrics.unknownKind +
    metrics.unknownChannel;

  return {
    status: 'ok',
    overall: totalViolations > 0 ? 'WARN' : 'PASS',
    checkedAt: new Date().toISOString(),
    policy: { purchase: 'telegram', technical: 'discord' },
    window: { limit, runs: items.length },
    violations: { total: totalViolations, ...metrics },
    alertsByChannel,
  };
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return Math.max(min, Math.min(max, rounded));
}

function resolveAlertRoutingRemediationConfig(rawConfig) {
  const rawMode = String(rawConfig?.mode ?? 'latest').trim().toLowerCase();
  const mode = rawMode === 'off' || rawMode === 'window' || rawMode === 'latest' ? rawMode : 'latest';
  const fallbackWindowLimit = mode === 'window' ? 5 : 1;
  const windowLimit = clampInt(rawConfig?.limit, fallbackWindowLimit, 1, 20);
  const fallbackCooldownSec = clampInt(process.env.SOON_ALERT_ROUTING_REMEDIATION_COOLDOWN_SEC, 120, 0, 86400);
  const cooldownSec = clampInt(rawConfig?.cooldownSec, fallbackCooldownSec, 0, 86400);
  return {
    mode,
    windowLimit,
    cooldownSec,
  };
}

function deriveAlertRoutingCooldownFromRuntimeState(runtimeState, { fallbackCooldownSec = 0, nowMs = Date.now() } = {}) {
  const stateValue = runtimeState?.stateValue ?? {};
  const rawTimestamp = stateValue?.timestamp ?? stateValue?.at ?? null;
  const lastRemediationAtMs = Number.isFinite(Date.parse(rawTimestamp ?? '')) ? Date.parse(rawTimestamp) : 0;
  const cooldownSec = clampInt(stateValue?.cooldownSec, fallbackCooldownSec, 0, 86400);
  const cooldownRemainingMs =
    cooldownSec > 0 && lastRemediationAtMs > 0
      ? Math.max(0, lastRemediationAtMs + cooldownSec * 1000 - nowMs)
      : 0;

  return {
    lastRemediationAtMs,
    lastRemediationAt: lastRemediationAtMs > 0 ? new Date(lastRemediationAtMs).toISOString() : null,
    cooldownSec,
    cooldownActive: cooldownRemainingMs > 0,
    cooldownRemainingMs,
    cooldownRemainingSec: Math.ceil(cooldownRemainingMs / 1000),
  };
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp01(value, fallback = 0) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeTokenBudgetItems(rawItems) {
  if (!Array.isArray(rawItems)) {
    return { error: 'items_required' };
  }

  const normalized = [];
  for (let idx = 0; idx < rawItems.length; idx += 1) {
    const raw = rawItems[idx] ?? {};
    const asin = String(raw.asin ?? '').trim();
    if (!asin) {
      return { error: 'invalid_item', index: idx, reason: 'asin_required' };
    }

    const expectedValue = toFiniteNumber(raw.expectedValue);
    if (expectedValue === null || expectedValue < 0) {
      return { error: 'invalid_item', index: idx, asin, reason: 'expected_value_invalid' };
    }

    const tokenCost = toFiniteNumber(raw.tokenCost);
    if (tokenCost === null || tokenCost <= 0) {
      return { error: 'invalid_item', index: idx, asin, reason: 'token_cost_invalid' };
    }

    const confidence = clamp01(raw.confidence, 0);
    const priority = Number(((expectedValue * confidence) / Math.max(1, tokenCost)).toFixed(6));
    normalized.push({
      asin,
      expectedValue: Number(expectedValue.toFixed(2)),
      confidence: Number(confidence.toFixed(4)),
      tokenCost: Number(tokenCost.toFixed(2)),
      priority,
    });
  }

  if (normalized.length === 0) {
    return { error: 'items_required' };
  }

  return { items: normalized };
}

function allocateTokenControlPlan({ items, budgetTokens = null }) {
  const ranked = [...items].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.tokenCost !== b.tokenCost) return a.tokenCost - b.tokenCost;
    return a.asin.localeCompare(b.asin);
  });

  const constrained = Number.isFinite(budgetTokens);
  let remaining = constrained ? Math.max(0, budgetTokens) : null;
  let selectedCount = 0;
  let skippedCount = 0;
  let selectedTokenCost = 0;

  const plan = ranked.map((item) => {
    if (!constrained) {
      selectedCount += 1;
      selectedTokenCost += item.tokenCost;
      return {
        ...item,
        selected: true,
        skipReason: null,
        remainingBudgetAfter: null,
      };
    }

    if (item.tokenCost <= remaining) {
      remaining = Number((remaining - item.tokenCost).toFixed(2));
      selectedCount += 1;
      selectedTokenCost += item.tokenCost;
      return {
        ...item,
        selected: true,
        skipReason: null,
        remainingBudgetAfter: remaining,
      };
    }

    skippedCount += 1;
    return {
      ...item,
      selected: false,
      skipReason: 'budget_exceeded',
      remainingBudgetAfter: remaining,
    };
  });

  return {
    plan,
    summary: {
      requested: ranked.length,
      selected: selectedCount,
      skipped: skippedCount,
      budgetTokens: constrained ? Number(budgetTokens.toFixed(2)) : null,
      totalTokenCostSelected: Number(selectedTokenCost.toFixed(2)),
      remainingBudgetTokens: constrained ? Number(Math.max(0, remaining).toFixed(2)) : null,
    },
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
    '# HELP soon_self_heal_retry_exhausted_total Number of dead-letter entries caused by retry budget exhaustion.',
    '# TYPE soon_self_heal_retry_exhausted_total counter',
    `soon_self_heal_retry_exhausted_total ${toPromNumber(status?.retryExhaustedTotal)}`,
    '# HELP soon_self_heal_retry_backoff_seconds Max seconds until next queued retry execution.',
    '# TYPE soon_self_heal_retry_backoff_seconds gauge',
    `soon_self_heal_retry_backoff_seconds ${toPromNumber(status?.retryBackoffSeconds)}`,
    '# HELP soon_self_heal_dead_letter_total Number of dead-letter records.',
    '# TYPE soon_self_heal_dead_letter_total gauge',
    `soon_self_heal_dead_letter_total ${toPromNumber(status?.deadLetterCount)}`,
    '# HELP soon_self_heal_manual_requeue_total Number of manual dead-letter requeue operations.',
    '# TYPE soon_self_heal_manual_requeue_total counter',
    `soon_self_heal_manual_requeue_total ${toPromNumber(status?.manualRequeueTotal)}`,
  ];
  return `${lines.join('\n')}\n`;
}

function overallToScore(overall) {
  if (overall === 'CRIT') return 2;
  if (overall === 'WARN') return 1;
  return 0;
}

function renderRuntimeOperationalPrometheusMetrics({ selfHeal, alertRouting, alertRoutingCooldownRemainingSec = 0 }) {
  const selfHealOverall = String(selfHeal?.overall ?? 'PASS');
  const selfHealSignals = Array.isArray(selfHeal?.signals) ? selfHeal.signals.length : 0;
  const violations = alertRouting?.violations ?? {};
  const alertRoutingOverall = String(alertRouting?.overall ?? 'PASS');

  const lines = [
    '# HELP soon_runtime_self_heal_overall_score Runtime self-heal operational score (0=PASS,1=WARN,2=CRIT).',
    '# TYPE soon_runtime_self_heal_overall_score gauge',
    `soon_runtime_self_heal_overall_score ${overallToScore(selfHealOverall)}`,
    '# HELP soon_runtime_self_heal_signals_total Runtime self-heal active signal count.',
    '# TYPE soon_runtime_self_heal_signals_total gauge',
    `soon_runtime_self_heal_signals_total ${toPromNumber(selfHealSignals)}`,
    '# HELP soon_alert_routing_overall_score Alert routing policy score (0=PASS,1=WARN,2=CRIT).',
    '# TYPE soon_alert_routing_overall_score gauge',
    `soon_alert_routing_overall_score ${overallToScore(alertRoutingOverall)}`,
    '# HELP soon_alert_routing_violations_total Total alert routing policy violations.',
    '# TYPE soon_alert_routing_violations_total gauge',
    `soon_alert_routing_violations_total ${toPromNumber(violations.total)}`,
    '# HELP soon_alert_routing_purchase_non_telegram_total Purchase alerts routed to non-Telegram channels.',
    '# TYPE soon_alert_routing_purchase_non_telegram_total gauge',
    `soon_alert_routing_purchase_non_telegram_total ${toPromNumber(violations.purchaseToNonTelegram)}`,
    '# HELP soon_alert_routing_technical_non_discord_total Technical alerts routed to non-Discord channels.',
    '# TYPE soon_alert_routing_technical_non_discord_total gauge',
    `soon_alert_routing_technical_non_discord_total ${toPromNumber(violations.technicalToNonDiscord)}`,
    '# HELP soon_alert_routing_unknown_kind_total Alerts with unknown kind.',
    '# TYPE soon_alert_routing_unknown_kind_total gauge',
    `soon_alert_routing_unknown_kind_total ${toPromNumber(violations.unknownKind)}`,
    '# HELP soon_alert_routing_unknown_channel_total Alerts with unknown/unexpected channel.',
    '# TYPE soon_alert_routing_unknown_channel_total gauge',
    `soon_alert_routing_unknown_channel_total ${toPromNumber(violations.unknownChannel)}`,
    '# HELP soon_alert_routing_remediation_cooldown_remaining_seconds Remaining seconds for alert-routing remediation cooldown.',
    '# TYPE soon_alert_routing_remediation_cooldown_remaining_seconds gauge',
    `soon_alert_routing_remediation_cooldown_remaining_seconds ${toPromNumber(alertRoutingCooldownRemainingSec)}`,
  ];

  return `${lines.join('\n')}\n`;
}

export function createSoonApiServer({ store = resolveStore() } = {}) {
  let lastAlertRoutingRemediationAtMs = 0;

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

      if (
        method === 'POST' &&
        (pathname === '/token-control/allocate' || pathname === '/api/token-control/allocate')
      ) {
        const body = await readJsonBody(req).catch(() => ({}));
        const normalized = normalizeTokenBudgetItems(body?.items);
        if (normalized.error) {
          return sendJson(res, 400, {
            error: normalized.error,
            index: normalized.index ?? null,
            asin: normalized.asin ?? null,
            reason: normalized.reason ?? null,
          });
        }

        const rawBudget = toFiniteNumber(body?.budgetTokens ?? body?.dailyBudgetTokens ?? body?.tokenBudget);
        if (rawBudget !== null && rawBudget < 0) {
          return sendJson(res, 400, { error: 'budget_tokens_invalid' });
        }
        const budgetTokens = rawBudget === null ? null : rawBudget;
        const allocation = allocateTokenControlPlan({ items: normalized.items, budgetTokens });

        return sendJson(res, 200, {
          status: 'ok',
          budgetMode: budgetTokens === null ? 'unbounded' : 'capped',
          ...allocation,
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
        const remediationConfig = resolveAlertRoutingRemediationConfig(body?.alertRoutingRemediation ?? null);
        const remediationStateKey = ALERT_ROUTING_REMEDIATION_STATE_KEY;
        const cycle = await runSelfHealWorker({
          readModelStatusProvider: store.getReadModelRefreshStatus
            ? async () => (override ?? store.getReadModelRefreshStatus())
            : undefined,
        });

        let alertRoutingAutoRemediation = null;
        if (store.listLatestAutomationRuns) {
          const beforeItems = await store.listLatestAutomationRuns(remediationConfig.windowLimit);
          const before = summarizeAlertRouting(beforeItems, remediationConfig.windowLimit);
          alertRoutingAutoRemediation = {
            checked: true,
            triggered: false,
            reason: remediationConfig.mode === 'off' ? 'disabled' : 'no_policy_drift',
            mode: remediationConfig.mode,
            windowLimit: remediationConfig.windowLimit,
            cooldownSec: remediationConfig.cooldownSec,
            cooldownActive: false,
            cooldownRemainingSec: 0,
            beforeViolations: Number(before?.violations?.total ?? 0),
            afterViolations: Number(before?.violations?.total ?? 0),
            recovered: false,
            evaluatedRuns: Number(before?.window?.runs ?? 0),
            recoveryWindowLimit: 1,
            remediationRunId: null,
          };

          if (remediationConfig.mode !== 'off' && before.violations.total > 0) {
            const nowMs = Date.now();
            let cooldownState = {
              lastRemediationAtMs: 0,
              cooldownRemainingMs: 0,
              cooldownRemainingSec: 0,
              cooldownActive: false,
            };
            if (store.getRuntimeState) {
              const runtimeState = await store.getRuntimeState(remediationStateKey);
              cooldownState = deriveAlertRoutingCooldownFromRuntimeState(runtimeState, {
                fallbackCooldownSec: remediationConfig.cooldownSec,
                nowMs,
              });
            } else {
              const cooldownRemainingMs =
                remediationConfig.cooldownSec > 0
                  ? Math.max(0, lastAlertRoutingRemediationAtMs + remediationConfig.cooldownSec * 1000 - nowMs)
                  : 0;
              cooldownState = {
                lastRemediationAtMs: lastAlertRoutingRemediationAtMs,
                cooldownRemainingMs,
                cooldownRemainingSec: Math.ceil(cooldownRemainingMs / 1000),
                cooldownActive: cooldownRemainingMs > 0,
              };
            }

            if (cooldownState.cooldownActive) {
              alertRoutingAutoRemediation.reason = 'cooldown_active';
              alertRoutingAutoRemediation.cooldownActive = true;
              alertRoutingAutoRemediation.cooldownRemainingSec = cooldownState.cooldownRemainingSec;
            } else {
              const startedAt = new Date().toISOString();
              const trackings = await store.listTrackings();
              const remediationCycle = runAutomationCycle(trackings);
              const finishedAt = new Date().toISOString();
              const remediationPersisted = store.recordAutomationCycle
                ? await store.recordAutomationCycle({
                    cycle: remediationCycle,
                    trackingCount: trackings.length,
                    startedAt,
                    finishedAt,
                  })
                : null;

              if (store.setRuntimeState) {
                await store.setRuntimeState(remediationStateKey, {
                  timestamp: new Date(nowMs).toISOString(),
                  cooldownSec: remediationConfig.cooldownSec,
                  remediationRunId: remediationPersisted?.runId ?? null,
                  mode: remediationConfig.mode,
                });
              } else {
                lastAlertRoutingRemediationAtMs = nowMs;
              }

              const afterItems = await store.listLatestAutomationRuns(1);
              const after = summarizeAlertRouting(afterItems, 1);
              alertRoutingAutoRemediation = {
                checked: true,
                triggered: true,
                reason: remediationConfig.mode === 'window' ? 'policy_drift_window_runset' : 'policy_drift_latest_run',
                mode: remediationConfig.mode,
                windowLimit: remediationConfig.windowLimit,
                cooldownSec: remediationConfig.cooldownSec,
                cooldownActive: false,
                cooldownRemainingSec: 0,
                beforeViolations: Number(before?.violations?.total ?? 0),
                afterViolations: Number(after?.violations?.total ?? 0),
                recovered: Number(after?.violations?.total ?? 0) === 0,
                evaluatedRuns: Number(before?.window?.runs ?? 0),
                recoveryWindowLimit: 1,
                remediationRunId: remediationPersisted?.runId ?? null,
              };
            }
          }
        }

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
          alertRoutingAutoRemediation,
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

      if (
        method === 'GET' &&
        (pathname === '/self-heal/runtime-state' || pathname === '/api/self-heal/runtime-state')
      ) {
        if (!store.getRuntimeState) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const key = String(url.searchParams.get('key') ?? '').trim();
        if (!key) {
          return sendJson(res, 400, {
            error: 'key_required',
            allowedKeys: [...RUNTIME_STATE_ALLOWLIST],
          });
        }
        if (!RUNTIME_STATE_ALLOWLIST.has(key)) {
          return sendJson(res, 400, {
            error: 'key_not_allowed',
            key,
            allowedKeys: [...RUNTIME_STATE_ALLOWLIST],
          });
        }

        const runtimeState = await store.getRuntimeState(key);
        const fallbackCooldownSec = clampInt(process.env.SOON_ALERT_ROUTING_REMEDIATION_COOLDOWN_SEC, 120, 0, 86400);
        const cooldown =
          key === ALERT_ROUTING_REMEDIATION_STATE_KEY
            ? deriveAlertRoutingCooldownFromRuntimeState(runtimeState, { fallbackCooldownSec, nowMs: Date.now() })
            : null;

        return sendJson(res, 200, {
          status: 'ok',
          key,
          found: Boolean(runtimeState),
          runtimeState,
          cooldown,
        });
      }

      if (
        method === 'GET' &&
        (pathname === '/runtime-self-heal-status' || pathname === '/api/runtime-self-heal-status')
      ) {
        if (!store.getSelfHealRetryStatus) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const retryStatus = await store.getSelfHealRetryStatus();
        const latest = store.listLatestSelfHealRuns ? await store.listLatestSelfHealRuns(1) : [];
        const latestRun = latest[0] ?? null;
        const evaluation = evaluateSelfHealOperationalStatus(retryStatus);

        return sendJson(res, 200, {
          status: 'ok',
          overall: evaluation.overall,
          checkedAt: new Date().toISOString(),
          retryQueue: {
            scheduler: retryStatus.scheduler,
            queuePending: retryStatus.queuePending,
            queueDone: retryStatus.queueDone,
            queueDeadLetter: retryStatus.queueDeadLetter,
            deadLetterCount: retryStatus.deadLetterCount,
            retryExhaustedTotal: retryStatus.retryExhaustedTotal,
            retryBackoffSeconds: retryStatus.retryBackoffSeconds,
            manualRequeueTotal: retryStatus.manualRequeueTotal,
          },
          latestRun: latestRun
            ? {
                runId: latestRun.runId ?? null,
                startedAt: latestRun.startedAt ?? null,
                finishedAt: latestRun.finishedAt ?? null,
                anomalyCount: latestRun.anomalyCount ?? null,
                playbookCount: latestRun.playbookCount ?? null,
              }
            : null,
          signals: evaluation.signals,
        });
      }

      if (method === 'GET' && (pathname === '/check-alert-status' || pathname === '/api/check-alert-status')) {
        if (!store.listLatestAutomationRuns) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const rawLimit = Number(url.searchParams.get('limit') ?? 20);
        const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));
        const items = await store.listLatestAutomationRuns(limit);
        return sendJson(res, 200, summarizeAlertRouting(items, limit));
      }

      if (method === 'GET' && pathname === '/metrics') {
        if (!store.getReadModelRefreshStatus) {
          res.writeHead(501, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('soon_read_model_metrics_unavailable 1\n');
          return;
        }

        const status = await store.getReadModelRefreshStatus();
        const retryStatus = store.getSelfHealRetryStatus ? await store.getSelfHealRetryStatus() : null;
        let payload = renderReadModelPrometheusMetrics(status);
        if (retryStatus) {
          payload += renderSelfHealRetryPrometheusMetrics(retryStatus);
        }
        if (store.getSelfHealRetryStatus && store.listLatestAutomationRuns) {
          const selfHealEval = evaluateSelfHealOperationalStatus(retryStatus ?? {});
          const latestRuns = await store.listLatestAutomationRuns(20);
          const alertRouting = summarizeAlertRouting(latestRuns, 20);
          let alertRoutingCooldownRemainingSec = 0;
          if (store.getRuntimeState) {
            const runtimeState = await store.getRuntimeState(ALERT_ROUTING_REMEDIATION_STATE_KEY);
            const fallbackCooldownSec = clampInt(process.env.SOON_ALERT_ROUTING_REMEDIATION_COOLDOWN_SEC, 120, 0, 86400);
            const cooldown = deriveAlertRoutingCooldownFromRuntimeState(runtimeState, {
              fallbackCooldownSec,
              nowMs: Date.now(),
            });
            alertRoutingCooldownRemainingSec = cooldown.cooldownRemainingSec;
          }
          payload += renderRuntimeOperationalPrometheusMetrics({
            selfHeal: selfHealEval,
            alertRouting,
            alertRoutingCooldownRemainingSec,
          });
        }
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
