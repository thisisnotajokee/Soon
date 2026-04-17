import http from 'node:http';
import crypto from 'node:crypto';
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
const TOKEN_BUDGET_DEFERRAL_STATE_KEY = 'token_budget_last_deferral_at';
const TOKEN_BUDGET_PROBE_STATE_KEY = 'token_budget_last_probe_at';
const TOKEN_BUDGET_PROBE_RESET_AUDIT_STATE_KEY = 'token_budget_probe_reset_audit_last';
const TOKEN_BUDGET_PROBE_OPS_KEY_ROTATION_STATE_KEY = 'token_budget_probe_ops_key_rotation';
const TOKEN_BUDGET_PROBE_OPS_KEY_ROTATION_AUDIT_STATE_KEY = 'token_budget_probe_ops_key_rotation_audit_last';
const TRACKING_CHAT_SETTINGS_PREFIX = 'tracking_chat_settings:';
const TRACKING_SNOOZE_PREFIX = 'tracking_snooze:';
const KEEPA_STATUS_STATE_KEY = 'keepa_status';
const KEEPA_WATCH_INDEX_STATE_KEY = 'keepa_watch_index';
const KEEPA_EVENTS_STATE_KEY = 'keepa_events';
const KEEPA_DEALS_STATE_KEY = 'keepa_deals';
const KEEPA_TOKEN_USAGE_STATE_KEY = 'keepa_token_usage';
const TOKEN_BUDGET_PROBE_DEFAULT_COOLDOWN_SEC = 24 * 60 * 60;
const TOKEN_BUDGET_PROBE_AUTOTUNE_FALLBACK_MIN_COOLDOWN_SEC = 6 * 60 * 60;
const TOKEN_BUDGET_PROBE_AUTOTUNE_FALLBACK_HIGH_COOLDOWN_SEC = 12 * 60 * 60;
const RUNTIME_STATE_ALLOWLIST = new Set([
  ALERT_ROUTING_REMEDIATION_STATE_KEY,
  TOKEN_BUDGET_DEFERRAL_STATE_KEY,
  TOKEN_BUDGET_PROBE_STATE_KEY,
  TOKEN_BUDGET_PROBE_RESET_AUDIT_STATE_KEY,
  TOKEN_BUDGET_PROBE_OPS_KEY_ROTATION_STATE_KEY,
  TOKEN_BUDGET_PROBE_OPS_KEY_ROTATION_AUDIT_STATE_KEY,
]);

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

function parseTimestampInput(raw, fallback = null) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) {
    return asNumber;
  }
  const parsed = Date.parse(String(raw));
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function resolveDayKeyInput(raw, fallbackTs = Date.now()) {
  if (raw === null || raw === undefined || raw === '') {
    return dayKeyFromTimestamp(fallbackTs);
  }

  const dayLiteral = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayLiteral)) {
    return dayLiteral;
  }

  const ts = parseTimestampInput(raw);
  if (ts === null) return null;
  return dayKeyFromTimestamp(ts);
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

function parseBooleanInput(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function secretsEqual(left, right) {
  const leftBuf = Buffer.from(String(left ?? ''), 'utf8');
  const rightBuf = Buffer.from(String(right ?? ''), 'utf8');
  if (leftBuf.length !== rightBuf.length) return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function shiftDayKey(dayKey, offsetDays = 0) {
  const parsed = Date.parse(`${String(dayKey).trim()}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  return dayKeyFromTimestamp(parsed + offsetDays * 24 * 60 * 60 * 1000);
}

function deriveTokenBudgetProbeAutoTunePolicy({
  enabled = false,
  usagePct = 0,
  previousUsagePct = null,
  probeCooldownSec = TOKEN_BUDGET_PROBE_DEFAULT_COOLDOWN_SEC,
  maxProbesPerDay = 1,
  minCooldownSec = TOKEN_BUDGET_PROBE_AUTOTUNE_FALLBACK_MIN_COOLDOWN_SEC,
  highCooldownSec = TOKEN_BUDGET_PROBE_AUTOTUNE_FALLBACK_HIGH_COOLDOWN_SEC,
} = {}) {
  const safeUsagePct = Number(Math.max(0, toPromNumber(usagePct, 0)).toFixed(2));
  const previousUsage = toFiniteNumber(previousUsagePct);
  const safePreviousUsagePct = previousUsage === null ? null : Number(Math.max(0, previousUsage).toFixed(2));
  const usageDeltaPct =
    safePreviousUsagePct === null ? null : Number((safeUsagePct - safePreviousUsagePct).toFixed(2));
  const baseCooldownSec = clampInt(probeCooldownSec, TOKEN_BUDGET_PROBE_DEFAULT_COOLDOWN_SEC, 0, 7 * 24 * 60 * 60);
  const baseMaxProbesPerDay = clampInt(maxProbesPerDay, 1, 0, 100);
  const minCooldownFloorSec = clampInt(
    minCooldownSec,
    TOKEN_BUDGET_PROBE_AUTOTUNE_FALLBACK_MIN_COOLDOWN_SEC,
    0,
    7 * 24 * 60 * 60,
  );
  const highCooldownFloorSec = clampInt(
    highCooldownSec,
    Math.max(minCooldownFloorSec, TOKEN_BUDGET_PROBE_AUTOTUNE_FALLBACK_HIGH_COOLDOWN_SEC),
    0,
    7 * 24 * 60 * 60,
  );
  const mediumCooldownFloorSec = Math.max(0, Math.floor(minCooldownFloorSec / 2));

  let pressureBand = 'low';
  if (safeUsagePct >= 95 || (usageDeltaPct !== null && usageDeltaPct >= 20)) {
    pressureBand = 'critical';
  } else if (safeUsagePct >= 85 || (usageDeltaPct !== null && usageDeltaPct >= 10)) {
    pressureBand = 'high';
  } else if (safeUsagePct >= 70 || (usageDeltaPct !== null && usageDeltaPct >= 5)) {
    pressureBand = 'medium';
  }

  if (!enabled) {
    return {
      enabled: false,
      applied: false,
      reason: 'disabled',
      pressureBand,
      usagePct: safeUsagePct,
      previousUsagePct: safePreviousUsagePct,
      usageDeltaPct,
      probeCooldownSec: baseCooldownSec,
      maxProbesPerDay: baseMaxProbesPerDay,
    };
  }

  let tunedProbeCooldownSec = baseCooldownSec;
  let tunedMaxProbesPerDay = baseMaxProbesPerDay;
  let reason = 'stable_budget_pressure';
  if (pressureBand === 'critical') {
    tunedProbeCooldownSec = Math.max(tunedProbeCooldownSec, highCooldownFloorSec);
    tunedMaxProbesPerDay = Math.min(tunedMaxProbesPerDay, 1);
    reason = 'critical_budget_pressure';
  } else if (pressureBand === 'high') {
    tunedProbeCooldownSec = Math.max(tunedProbeCooldownSec, minCooldownFloorSec);
    tunedMaxProbesPerDay = Math.min(tunedMaxProbesPerDay, 2);
    reason = 'high_budget_pressure';
  } else if (pressureBand === 'medium') {
    tunedProbeCooldownSec = Math.max(tunedProbeCooldownSec, mediumCooldownFloorSec);
    tunedMaxProbesPerDay = Math.min(tunedMaxProbesPerDay, 3);
    reason = 'rising_budget_pressure';
  }

  return {
    enabled: true,
    applied: tunedProbeCooldownSec !== baseCooldownSec || tunedMaxProbesPerDay !== baseMaxProbesPerDay,
    reason,
    pressureBand,
    usagePct: safeUsagePct,
    previousUsagePct: safePreviousUsagePct,
    usageDeltaPct,
    probeCooldownSec: tunedProbeCooldownSec,
    maxProbesPerDay: tunedMaxProbesPerDay,
  };
}

function deriveLastProbeAutoTuneDecision(probeRuntimeState) {
  const state = probeRuntimeState?.stateValue ?? {};
  const wasEnabled = parseBooleanInput(state?.autoTuneEnabled, false);
  const wasApplied = parseBooleanInput(state?.autoTuneApplied, false);
  const usagePct = toFiniteNumber(state?.autoTuneUsagePct);
  const previousUsagePct = toFiniteNumber(state?.autoTunePreviousUsagePct);
  const usageDeltaPct = toFiniteNumber(state?.autoTuneUsageDeltaPct);

  return {
    found: Boolean(probeRuntimeState),
    timestamp: state?.timestamp ?? null,
    day: state?.day ?? null,
    autoTuneEnabled: wasEnabled,
    autoTuneApplied: wasApplied,
    autoTuneReason: state?.autoTuneReason ?? null,
    pressureBand: state?.autoTunePressureBand ?? null,
    usagePct: usagePct === null ? null : Number(usagePct.toFixed(2)),
    previousUsagePct: previousUsagePct === null ? null : Number(previousUsagePct.toFixed(2)),
    usageDeltaPct: usageDeltaPct === null ? null : Number(usageDeltaPct.toFixed(2)),
    probeCooldownSec:
      Number.isFinite(Number(state?.cooldownSec)) ? Math.max(0, Math.floor(Number(state?.cooldownSec))) : null,
    maxProbesPerDay:
      Number.isFinite(Number(state?.maxProbesPerDay))
        ? Math.max(0, Math.floor(Number(state?.maxProbesPerDay)))
        : null,
    probesForDay:
      Number.isFinite(Number(state?.probesForDay)) ? Math.max(0, Math.floor(Number(state?.probesForDay))) : null,
  };
}

function deriveLastProbeResetAudit(resetAuditRuntimeState, { nowMs = Date.now() } = {}) {
  const state = resetAuditRuntimeState?.stateValue ?? {};
  const timestamp = state?.timestamp ?? null;
  const parsedTs = Number.isFinite(Date.parse(timestamp ?? '')) ? Date.parse(timestamp) : 0;
  const cooldownSec = Number.isFinite(Number(state?.cooldownSec))
    ? Math.max(0, Math.floor(Number(state?.cooldownSec)))
    : 0;
  const cooldownRemainingMs =
    cooldownSec > 0 && parsedTs > 0 ? Math.max(0, parsedTs + cooldownSec * 1000 - nowMs) : 0;

  return {
    found: Boolean(resetAuditRuntimeState),
    timestamp,
    day: state?.day ?? null,
    actor: state?.actor ?? null,
    reason: state?.reason ?? null,
    action: state?.action ?? null,
    cooldownSec,
    cooldown: {
      active: cooldownRemainingMs > 0,
      remainingSec: Math.ceil(cooldownRemainingMs / 1000),
    },
    probeStateExisted: parseBooleanInput(state?.probeStateExisted, false),
    previousProbeTimestamp: state?.previousProbeTimestamp ?? null,
    lastKnownProbesForDay:
      Number.isFinite(Number(state?.lastKnownProbesForDay))
        ? Math.max(0, Math.floor(Number(state?.lastKnownProbesForDay)))
        : null,
  };
}

function deriveProbeResetOpsKeyRotationState(rotationRuntimeState, { nowMs = Date.now() } = {}) {
  const state = rotationRuntimeState?.stateValue ?? {};
  const timestamp = state?.timestamp ?? null;
  const activatedAt = state?.activatedAt ?? timestamp;
  const expiresAt = state?.expiresAt ?? null;
  const activatedAtMs = Number.isFinite(Date.parse(activatedAt ?? '')) ? Date.parse(activatedAt) : 0;
  const expiresAtMs = Number.isFinite(Date.parse(expiresAt ?? '')) ? Date.parse(expiresAt) : 0;
  const nextOpsKeyHash = String(state?.nextOpsKeyHash ?? '').trim();
  const previousPrimaryOpsKeyHash = String(state?.previousPrimaryOpsKeyHash ?? '').trim();
  const graceSec = Number.isFinite(Number(state?.graceSec)) ? Math.max(0, Math.floor(Number(state?.graceSec))) : 0;
  const remainingMs = expiresAtMs > 0 ? Math.max(0, expiresAtMs - nowMs) : 0;
  const active = Boolean(nextOpsKeyHash && remainingMs > 0);
  return {
    found: Boolean(rotationRuntimeState),
    active,
    timestamp,
    activatedAt,
    activatedAtMs,
    expiresAt,
    expiresAtMs,
    remainingSec: Math.ceil(remainingMs / 1000),
    graceSec,
    actor: state?.actor ?? null,
    reason: state?.reason ?? null,
    nextOpsKeyHash,
    previousPrimaryOpsKeyHash,
    nextOpsKeyFingerprint: nextOpsKeyHash ? nextOpsKeyHash.slice(0, 12) : null,
  };
}

function deriveProbeResetOpsKeyRotationAudit(auditRuntimeState) {
  const state = auditRuntimeState?.stateValue ?? {};
  const graceSec = Number.isFinite(Number(state?.graceSec)) ? Math.max(0, Math.floor(Number(state?.graceSec))) : 0;
  return {
    found: Boolean(auditRuntimeState),
    timestamp: state?.timestamp ?? null,
    day: state?.day ?? null,
    actor: state?.actor ?? null,
    reason: state?.reason ?? null,
    action: state?.action ?? null,
    graceSec,
    expiresAt: state?.expiresAt ?? null,
    nextOpsKeyFingerprint: state?.nextOpsKeyFingerprint ?? null,
    previousRotationActive: parseBooleanInput(state?.previousRotationActive, false),
    previousRotationExpiresAt: state?.previousRotationExpiresAt ?? null,
  };
}

function resolveProvidedOpsKeyFromRequest(req) {
  const headerOpsKey = String(req.headers['x-soon-ops-key'] ?? req.headers['x-ops-key'] ?? '').trim();
  const authorization = String(req.headers.authorization ?? '').trim();
  const bearerToken = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice('bearer '.length).trim()
    : '';
  return headerOpsKey || bearerToken;
}

async function resolveProbeResetOpsKeyAuthContext({ req, store, nowMs = Date.now() }) {
  const primaryOpsKey = String(process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY ?? '').trim();
  const providedOpsKey = resolveProvidedOpsKeyFromRequest(req);
  const rotationRuntimeState = store.getRuntimeState
    ? await store.getRuntimeState(TOKEN_BUDGET_PROBE_OPS_KEY_ROTATION_STATE_KEY)
    : null;
  const rotationSnapshot = deriveProbeResetOpsKeyRotationState(rotationRuntimeState, { nowMs });

  const primaryMatched = Boolean(primaryOpsKey && providedOpsKey && secretsEqual(providedOpsKey, primaryOpsKey));
  const stagedMatched = Boolean(
    !primaryMatched &&
      providedOpsKey &&
      rotationSnapshot.active &&
      rotationSnapshot.nextOpsKeyHash &&
      secretsEqual(hashSecret(providedOpsKey), rotationSnapshot.nextOpsKeyHash),
  );

  const authRequired = Boolean(primaryOpsKey) || rotationSnapshot.active;
  const authValid = !authRequired || primaryMatched || stagedMatched;

  return {
    primaryOpsKey,
    providedOpsKey,
    authRequired,
    authValid,
    primaryMatched,
    stagedMatched,
    rotationRuntimeState,
    rotationSnapshot,
  };
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

function buildChatSettingsStateKey(chatId) {
  return `${TRACKING_CHAT_SETTINGS_PREFIX}${String(chatId ?? '').trim().toLowerCase() || 'default'}`;
}

function buildTrackingSnoozeStateKey(chatId, asin) {
  return `${TRACKING_SNOOZE_PREFIX}${String(chatId ?? '').trim().toLowerCase() || 'default'}:${String(asin ?? '')
    .trim()
    .toUpperCase()}`;
}

function normalizeChatId(raw) {
  const normalized = String(raw ?? '').trim();
  return normalized || 'default';
}

function buildKeepaWatchStateKey(asin) {
  return `keepa_watch_state:${String(asin ?? '').trim().toUpperCase()}`;
}

function normalizeKeepaTokenUsage(raw = {}) {
  const limit = toFiniteNumber(raw.limit ?? raw.tokenLimit ?? raw.capacity);
  const used = toFiniteNumber(raw.used ?? raw.tokensUsed ?? raw.spent);
  let remaining = toFiniteNumber(raw.remaining ?? raw.tokensRemaining);

  if (remaining === null && limit !== null && used !== null) {
    remaining = Math.max(0, limit - used);
  }

  const usagePct = limit && limit > 0 && used !== null ? Number(((used / limit) * 100).toFixed(2)) : 0;

  return {
    limit: limit === null ? null : Number(limit.toFixed(2)),
    used: used === null ? null : Number(used.toFixed(2)),
    remaining: remaining === null ? null : Number(remaining.toFixed(2)),
    usagePct,
    updatedAt: raw.updatedAt ?? raw.refreshedAt ?? new Date().toISOString(),
  };
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

function buildTokenSnapshotFromPlan(tokenPlan = [], { budgetMode = 'unbounded', budgetTokens = null } = {}) {
  const normalizedPlan = (Array.isArray(tokenPlan) ? tokenPlan : []).map((item) => ({
    asin: String(item?.asin ?? ''),
    expectedValue: Number(item?.expectedValue ?? 0),
    confidence: Number(item?.confidence ?? 0),
    tokenCost: Number(item?.tokenCost ?? 0),
    priority: Number(item?.priority ?? 0),
    selected: item?.selected !== false,
    skipReason: item?.skipReason ?? null,
    remainingBudgetAfter:
      item?.remainingBudgetAfter === null || item?.remainingBudgetAfter === undefined
        ? null
        : Number(item.remainingBudgetAfter),
  }));

  const selectedCount = normalizedPlan.filter((item) => item.selected).length;
  const totalTokenCostSelected = normalizedPlan
    .filter((item) => item.selected)
    .reduce((acc, item) => acc + item.tokenCost, 0);
  const normalizedBudgetMode = budgetMode === 'capped' && Number.isFinite(Number(budgetTokens)) && Number(budgetTokens) > 0
    ? 'capped'
    : 'unbounded';

  return {
    budgetMode: normalizedBudgetMode,
    summary: {
      requested: normalizedPlan.length,
      selected: selectedCount,
      skipped: normalizedPlan.length - selectedCount,
      budgetTokens: normalizedBudgetMode === 'capped' ? Number(Number(budgetTokens).toFixed(2)) : null,
      totalTokenCostSelected: Number(totalTokenCostSelected.toFixed(2)),
      remainingBudgetTokens:
        normalizedBudgetMode === 'capped'
          ? normalizedPlan.length > 0
            ? normalizedPlan[normalizedPlan.length - 1].remainingBudgetAfter
            : Number(Number(budgetTokens ?? 0).toFixed(2))
          : null,
    },
    plan: normalizedPlan,
  };
}

function resolveAutomationTokenPolicyConfig(rawConfig = null) {
  const modeSource = rawConfig?.mode ?? process.env.SOON_TOKEN_POLICY_MODE ?? 'unbounded';
  const rawMode = String(modeSource)
    .trim()
    .toLowerCase();
  const requestedMode = rawMode === 'capped' ? 'capped' : 'unbounded';
  const budgetSource = rawConfig?.budgetTokens ?? process.env.SOON_TOKEN_DAILY_BUDGET;
  const parsedBudget = toFiniteNumber(budgetSource);
  const budgetTokens = parsedBudget !== null && parsedBudget > 0 ? Number(parsedBudget.toFixed(2)) : null;
  const probeBudgetSource = rawConfig?.probeBudgetTokens ?? process.env.SOON_TOKEN_EXHAUSTED_PROBE_BUDGET;
  const parsedProbeBudget = toFiniteNumber(probeBudgetSource);
  const probeBudgetTokens =
    parsedProbeBudget !== null && parsedProbeBudget > 0 ? Number(parsedProbeBudget.toFixed(2)) : null;
  const fallbackProbeCooldownSec = clampInt(
    process.env.SOON_TOKEN_EXHAUSTED_PROBE_COOLDOWN_SEC,
    TOKEN_BUDGET_PROBE_DEFAULT_COOLDOWN_SEC,
    0,
    7 * 24 * 60 * 60,
  );
  const probeCooldownSec = clampInt(rawConfig?.probeCooldownSec, fallbackProbeCooldownSec, 0, 7 * 24 * 60 * 60);
  const fallbackProbeMaxPerDay = clampInt(process.env.SOON_TOKEN_EXHAUSTED_PROBE_MAX_PER_DAY, 1, 0, 100);
  const maxProbesPerDay = clampInt(rawConfig?.maxProbesPerDay, fallbackProbeMaxPerDay, 0, 100);
  const fallbackAutoTuneProbePolicy = parseBooleanInput(process.env.SOON_TOKEN_EXHAUSTED_PROBE_AUTOTUNE_ENABLED, false);
  const autoTuneProbePolicy = parseBooleanInput(rawConfig?.autoTuneProbePolicy, fallbackAutoTuneProbePolicy);
  const fallbackProbeAutoTuneMinCooldownSec = clampInt(
    process.env.SOON_TOKEN_EXHAUSTED_PROBE_AUTOTUNE_MIN_COOLDOWN_SEC,
    TOKEN_BUDGET_PROBE_AUTOTUNE_FALLBACK_MIN_COOLDOWN_SEC,
    0,
    7 * 24 * 60 * 60,
  );
  const probeAutoTuneMinCooldownSec = clampInt(
    rawConfig?.probeAutoTuneMinCooldownSec,
    fallbackProbeAutoTuneMinCooldownSec,
    0,
    7 * 24 * 60 * 60,
  );
  const fallbackProbeAutoTuneHighCooldownSec = clampInt(
    process.env.SOON_TOKEN_EXHAUSTED_PROBE_AUTOTUNE_HIGH_COOLDOWN_SEC,
    Math.max(probeAutoTuneMinCooldownSec, TOKEN_BUDGET_PROBE_AUTOTUNE_FALLBACK_HIGH_COOLDOWN_SEC),
    0,
    7 * 24 * 60 * 60,
  );
  const probeAutoTuneHighCooldownSec = clampInt(
    rawConfig?.probeAutoTuneHighCooldownSec,
    fallbackProbeAutoTuneHighCooldownSec,
    0,
    7 * 24 * 60 * 60,
  );

  if (requestedMode === 'capped' && budgetTokens === null) {
    return {
      requestedMode,
      mode: 'unbounded',
      budgetTokens: null,
      probeBudgetTokens: null,
      probeCooldownSec,
      maxProbesPerDay,
      autoTuneProbePolicy,
      probeAutoTuneMinCooldownSec,
      probeAutoTuneHighCooldownSec,
      fallbackReason: 'invalid_or_missing_budget',
    };
  }

  return {
    requestedMode,
    mode: requestedMode,
    budgetTokens,
    probeBudgetTokens,
    probeCooldownSec,
    maxProbesPerDay,
    autoTuneProbePolicy,
    probeAutoTuneMinCooldownSec,
    probeAutoTuneHighCooldownSec,
    fallbackReason: null,
  };
}

function deriveTokenBudgetProbeCooldownFromRuntimeState(
  runtimeState,
  {
    fallbackCooldownSec = TOKEN_BUDGET_PROBE_DEFAULT_COOLDOWN_SEC,
    nowMs = Date.now(),
    overrideCooldownSec = null,
  } = {},
) {
  const stateValue = runtimeState?.stateValue ?? {};
  const rawTimestamp = stateValue?.timestamp ?? stateValue?.at ?? null;
  const lastProbeAtMs = Number.isFinite(Date.parse(rawTimestamp ?? '')) ? Date.parse(rawTimestamp) : 0;
  const overrideCooldown = toFiniteNumber(overrideCooldownSec);
  const cooldownSec =
    overrideCooldown !== null
      ? clampInt(overrideCooldown, fallbackCooldownSec, 0, 7 * 24 * 60 * 60)
      : clampInt(stateValue?.cooldownSec, fallbackCooldownSec, 0, 7 * 24 * 60 * 60);
  const cooldownRemainingMs =
    cooldownSec > 0 && lastProbeAtMs > 0 ? Math.max(0, lastProbeAtMs + cooldownSec * 1000 - nowMs) : 0;

  return {
    lastProbeAtMs,
    lastProbeAt: lastProbeAtMs > 0 ? new Date(lastProbeAtMs).toISOString() : null,
    cooldownSec,
    cooldownActive: cooldownRemainingMs > 0,
    cooldownRemainingMs,
    cooldownRemainingSec: Math.ceil(cooldownRemainingMs / 1000),
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

function renderTokenControlPrometheusMetrics(snapshot) {
  const hasSnapshot = snapshot ? 1 : 0;
  const budgetMode = escapePromLabel(snapshot?.budgetMode ?? 'none');
  const summary = snapshot?.summary ?? {};
  const requested = toPromNumber(summary.requested);
  const selected = toPromNumber(summary.selected);
  const skipped = toPromNumber(summary.skipped);
  const totalTokenCostSelected = toPromNumber(summary.totalTokenCostSelected);
  const budgetTokens = toPromNumber(summary.budgetTokens);
  const remainingBudgetTokens = toPromNumber(summary.remainingBudgetTokens);
  const budgetLimited = summary.budgetTokens !== null && summary.budgetTokens !== undefined && Number(summary.budgetTokens) > 0;
  const budgetUsageRatio = budgetLimited
    ? Number((totalTokenCostSelected / Number(summary.budgetTokens)).toFixed(6))
    : 0;
  const budgetUsagePct = budgetLimited
    ? Number(((totalTokenCostSelected / Number(summary.budgetTokens)) * 100).toFixed(2))
    : 0;

  const lines = [
    '# HELP soon_token_control_snapshot_present Whether token-control snapshot exists.',
    '# TYPE soon_token_control_snapshot_present gauge',
    `soon_token_control_snapshot_present ${hasSnapshot}`,
    '# HELP soon_token_control_requested_count Number of requested candidates in latest token allocation snapshot.',
    '# TYPE soon_token_control_requested_count gauge',
    `soon_token_control_requested_count{budget_mode="${budgetMode}"} ${requested}`,
    '# HELP soon_token_control_selected_count Number of selected candidates in latest token allocation snapshot.',
    '# TYPE soon_token_control_selected_count gauge',
    `soon_token_control_selected_count{budget_mode="${budgetMode}"} ${selected}`,
    '# HELP soon_token_control_skipped_count Number of skipped candidates in latest token allocation snapshot.',
    '# TYPE soon_token_control_skipped_count gauge',
    `soon_token_control_skipped_count{budget_mode="${budgetMode}"} ${skipped}`,
    '# HELP soon_token_control_total_token_cost_selected Total token cost of selected candidates.',
    '# TYPE soon_token_control_total_token_cost_selected gauge',
    `soon_token_control_total_token_cost_selected{budget_mode="${budgetMode}"} ${totalTokenCostSelected}`,
    '# HELP soon_token_control_budget_tokens Latest token budget cap (0 means unbounded/not set).',
    '# TYPE soon_token_control_budget_tokens gauge',
    `soon_token_control_budget_tokens{budget_mode="${budgetMode}"} ${budgetTokens}`,
    '# HELP soon_token_control_remaining_budget_tokens Remaining token budget in latest snapshot (0 means unbounded/not set).',
    '# TYPE soon_token_control_remaining_budget_tokens gauge',
    `soon_token_control_remaining_budget_tokens{budget_mode="${budgetMode}"} ${remainingBudgetTokens}`,
    '# HELP soon_token_control_budget_limited Whether latest snapshot used capped budget mode.',
    '# TYPE soon_token_control_budget_limited gauge',
    `soon_token_control_budget_limited{budget_mode="${budgetMode}"} ${budgetLimited ? 1 : 0}`,
    '# HELP soon_token_control_budget_usage_ratio Latest selected_cost/budget ratio (0 for unbounded mode).',
    '# TYPE soon_token_control_budget_usage_ratio gauge',
    `soon_token_control_budget_usage_ratio{budget_mode="${budgetMode}"} ${toPromNumber(budgetUsageRatio)}`,
    '# HELP soon_token_control_budget_usage_pct Latest selected_cost/budget percent (0 for unbounded mode).',
    '# TYPE soon_token_control_budget_usage_pct gauge',
    `soon_token_control_budget_usage_pct{budget_mode="${budgetMode}"} ${toPromNumber(budgetUsagePct)}`,
  ];

  return `${lines.join('\n')}\n`;
}

function renderTokenBudgetPrometheusMetrics(
  status,
  tokenPolicyConfig = null,
  deferralRuntimeState = null,
  probeRuntimeState = null,
  probeCooldownState = null,
) {
  const mode = escapePromLabel(status?.mode ?? tokenPolicyConfig?.mode ?? 'unbounded');
  const budgetTokens = toPromNumber(status?.budgetTokens);
  const consumedTokens = toPromNumber(status?.consumedTokens);
  const remainingTokens = toPromNumber(status?.remainingTokens);
  const usagePct = toPromNumber(status?.usagePct);
  const exhausted = Boolean(status?.exhausted);
  const fallbackActive = tokenPolicyConfig?.fallbackReason ? 1 : 0;
  const day = escapePromLabel(status?.day ?? 'unknown');
  const deferralState = deferralRuntimeState?.stateValue ?? {};
  const deferralDay = String(deferralState?.day ?? '').trim();
  const deferralForCurrentDay = deferralDay === String(status?.day ?? '');
  const deferralActive = exhausted && deferralForCurrentDay ? 1 : 0;
  const deferralTs = toPromUnixTs(deferralState?.timestamp ?? null);
  const probeState = probeRuntimeState?.stateValue ?? {};
  const probeDay = String(probeState?.day ?? '').trim();
  const probeForCurrentDay = probeDay === String(status?.day ?? '');
  const probeActive = exhausted && probeForCurrentDay ? 1 : 0;
  const probeTs = toPromUnixTs(probeState?.timestamp ?? null);
  const probeCooldownRemainingSec = toPromNumber(probeCooldownState?.cooldownRemainingSec);
  const maxProbesPerDay = toPromNumber(tokenPolicyConfig?.maxProbesPerDay);
  const autoTuneEnabled = tokenPolicyConfig?.autoTuneProbePolicy ? 1 : 0;
  const probeUsedToday = probeForCurrentDay
    ? Number.isFinite(Number(probeState?.probesForDay))
      ? Math.max(0, Math.floor(Number(probeState?.probesForDay)))
      : 1
    : 0;

  const lines = [
    '# HELP soon_token_budget_daily_limit_tokens Daily token budget limit (0 means unbounded).',
    '# TYPE soon_token_budget_daily_limit_tokens gauge',
    `soon_token_budget_daily_limit_tokens{mode="${mode}",day="${day}"} ${budgetTokens}`,
    '# HELP soon_token_budget_consumed_tokens Consumed tokens in current daily budget window.',
    '# TYPE soon_token_budget_consumed_tokens gauge',
    `soon_token_budget_consumed_tokens{mode="${mode}",day="${day}"} ${consumedTokens}`,
    '# HELP soon_token_budget_remaining_tokens Remaining tokens in current daily budget window (0 means exhausted or unbounded).',
    '# TYPE soon_token_budget_remaining_tokens gauge',
    `soon_token_budget_remaining_tokens{mode="${mode}",day="${day}"} ${remainingTokens}`,
    '# HELP soon_token_budget_usage_pct Daily token budget usage percent.',
    '# TYPE soon_token_budget_usage_pct gauge',
    `soon_token_budget_usage_pct{mode="${mode}",day="${day}"} ${usagePct}`,
    '# HELP soon_token_budget_exhausted Whether daily token budget is exhausted (1=true).',
    '# TYPE soon_token_budget_exhausted gauge',
    `soon_token_budget_exhausted{mode="${mode}",day="${day}"} ${exhausted ? 1 : 0}`,
    '# HELP soon_token_budget_policy_fallback_active Whether token policy fallback to unbounded is active due to invalid capped config.',
    '# TYPE soon_token_budget_policy_fallback_active gauge',
    `soon_token_budget_policy_fallback_active{mode="${mode}"} ${fallbackActive}`,
    '# HELP soon_token_budget_deferral_active Whether smart deferral mode is active for current daily budget window.',
    '# TYPE soon_token_budget_deferral_active gauge',
    `soon_token_budget_deferral_active{mode="${mode}",day="${day}"} ${deferralActive}`,
    '# HELP soon_token_budget_last_deferral_unixtime Last smart-deferral activation timestamp (unix seconds, 0 when absent).',
    '# TYPE soon_token_budget_last_deferral_unixtime gauge',
    `soon_token_budget_last_deferral_unixtime ${deferralTs}`,
    '# HELP soon_token_budget_probe_active Whether smart probe mode is active for current daily budget window.',
    '# TYPE soon_token_budget_probe_active gauge',
    `soon_token_budget_probe_active{mode="${mode}",day="${day}"} ${probeActive}`,
    '# HELP soon_token_budget_last_probe_unixtime Last smart-probe activation timestamp (unix seconds, 0 when absent).',
    '# TYPE soon_token_budget_last_probe_unixtime gauge',
    `soon_token_budget_last_probe_unixtime ${probeTs}`,
    '# HELP soon_token_budget_probe_cooldown_remaining_seconds Remaining cooldown before next smart probe activation.',
    '# TYPE soon_token_budget_probe_cooldown_remaining_seconds gauge',
    `soon_token_budget_probe_cooldown_remaining_seconds{mode="${mode}",day="${day}"} ${probeCooldownRemainingSec}`,
    '# HELP soon_token_budget_probe_daily_cap Maximum number of smart probes allowed per day.',
    '# TYPE soon_token_budget_probe_daily_cap gauge',
    `soon_token_budget_probe_daily_cap{mode="${mode}",day="${day}"} ${maxProbesPerDay}`,
    '# HELP soon_token_budget_probe_daily_used Number of smart probes used in current day window.',
    '# TYPE soon_token_budget_probe_daily_used gauge',
    `soon_token_budget_probe_daily_used{mode="${mode}",day="${day}"} ${probeUsedToday}`,
    '# HELP soon_token_budget_probe_autotune_enabled Whether probe policy autotune is enabled (1=true).',
    '# TYPE soon_token_budget_probe_autotune_enabled gauge',
    `soon_token_budget_probe_autotune_enabled{mode="${mode}"} ${autoTuneEnabled}`,
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

      if (method === 'POST' && pathname === '/api/trackings/save') {
        if (!store.saveTracking) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const body = await readJsonBody(req).catch(() => ({}));
        const saved = await store.saveTracking(body);
        if (!saved || saved?.error === 'asin_required') {
          return sendJson(res, 400, { error: 'asin_required' });
        }
        return sendJson(res, 200, {
          status: 'saved',
          item: saved,
        });
      }

      const deleteTrackingMatch = pathname.match(/^\/api\/trackings\/([^/]+)\/([^/]+)$/);
      if (method === 'DELETE' && deleteTrackingMatch) {
        if (!store.deleteTracking) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const chatId = normalizeChatId(deleteTrackingMatch[1]);
        const asin = decodeURIComponent(deleteTrackingMatch[2]).toUpperCase();
        const deleted = await store.deleteTracking(asin);
        if (!deleted?.deleted) {
          return sendJson(res, 404, { error: 'not_found', asin, chatId });
        }
        return sendJson(res, 200, { status: 'deleted', asin, chatId });
      }

      const dashboardMatch = pathname.match(/^\/api\/dashboard\/([^/]+)$/);
      if (method === 'GET' && dashboardMatch) {
        const chatId = normalizeChatId(dashboardMatch[1]);
        const chatSettingsState = store.getRuntimeState
          ? await store.getRuntimeState(buildChatSettingsStateKey(chatId))
          : null;
        const chatSettings = chatSettingsState?.stateValue ?? { productIntervalMin: 60 };
        const items = await store.listTrackings();

        const enrichedItems = await Promise.all(
          items.map(async (item) => {
            const snoozeState = store.getRuntimeState
              ? await store.getRuntimeState(buildTrackingSnoozeStateKey(chatId, item.asin))
              : null;
            const snooze = snoozeState?.stateValue ?? null;
            return {
              ...item,
              snooze: snooze ? { ...snooze, active: Boolean(snooze.until && Date.parse(snooze.until) > Date.now()) } : null,
            };
          }),
        );

        return sendJson(res, 200, {
          chatId,
          count: enrichedItems.length,
          settings: chatSettings,
          items: enrichedItems,
        });
      }

      const historyMatch = pathname.match(/^\/api\/history\/([^/]+)$/);
      if (method === 'GET' && historyMatch) {
        const asin = decodeURIComponent(historyMatch[1]).toUpperCase();
        const detail = await store.getProductDetail(asin);
        if (!detail) {
          return sendJson(res, 404, { error: 'not_found', asin });
        }

        let items = Array.isArray(detail.historyPoints) ? detail.historyPoints : [];
        if (store.getPriceHistory) {
          const rows = await store.getPriceHistory(asin, Number(url.searchParams.get('limit') ?? 180));
          if (Array.isArray(rows) && rows.length) {
            items = rows;
          }
        }

        return sendJson(res, 200, {
          asin,
          count: items.length,
          items,
        });
      }

      const refreshMatch = pathname.match(/^\/api\/refresh\/([^/]+)$/);
      if (method === 'POST' && refreshMatch) {
        const asin = decodeURIComponent(refreshMatch[1]).toUpperCase();
        const detail = await store.getProductDetail(asin);
        if (!detail) {
          return sendJson(res, 404, { error: 'not_found', asin });
        }

        return sendJson(res, 200, {
          status: 'refreshed',
          asin,
          refreshedAt: new Date().toISOString(),
          item: detail,
        });
      }

      const refreshAllMatch = pathname.match(/^\/api\/refresh-all\/([^/]+)$/);
      if (method === 'POST' && refreshAllMatch) {
        const chatId = normalizeChatId(refreshAllMatch[1]);
        const items = await store.listTrackings();
        const nowIso = new Date().toISOString();
        return sendJson(res, 200, {
          status: 'queued',
          chatId,
          jobId: crypto.randomUUID(),
          requestedAt: nowIso,
          processedAt: nowIso,
          total: items.length,
        });
      }

      const snoozeMatch = pathname.match(/^\/api\/trackings\/([^/]+)\/([^/]+)\/snooze$/);
      if ((method === 'POST' || method === 'DELETE') && snoozeMatch) {
        const chatId = normalizeChatId(snoozeMatch[1]);
        const asin = decodeURIComponent(snoozeMatch[2]).toUpperCase();
        const key = buildTrackingSnoozeStateKey(chatId, asin);

        if (method === 'DELETE') {
          if (store.setRuntimeState) {
            await store.setRuntimeState(key, null);
          }
          return sendJson(res, 200, { status: 'unsnoozed', chatId, asin });
        }

        const body = await readJsonBody(req).catch(() => ({}));
        const nowMs = Date.now();
        const minutes = clampInt(
          body.minutes ?? body.snoozeMinutes ?? body.durationMin ?? 60,
          60,
          1,
          7 * 24 * 60,
        );
        const until = new Date(nowMs + minutes * 60 * 1000).toISOString();
        const state = {
          asin,
          chatId,
          minutes,
          reason: String(body.reason ?? 'manual').trim() || 'manual',
          from: new Date(nowMs).toISOString(),
          until,
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(key, state);
        }
        return sendJson(res, 200, { status: 'snoozed', ...state });
      }

      const productIntervalMatch = pathname.match(/^\/api\/settings\/([^/]+)\/product-interval$/);
      if (method === 'POST' && productIntervalMatch) {
        const chatId = normalizeChatId(productIntervalMatch[1]);
        const body = await readJsonBody(req).catch(() => ({}));
        const intervalMin = clampInt(
          body.productIntervalMin ?? body.intervalMin ?? body.intervalMinutes ?? body.value ?? 60,
          60,
          1,
          24 * 60,
        );
        const state = {
          chatId,
          productIntervalMin: intervalMin,
          updatedAt: new Date().toISOString(),
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(buildChatSettingsStateKey(chatId), state);
        }
        return sendJson(res, 200, { status: 'updated', ...state });
      }

      if (method === 'GET' && pathname === '/api/keepa/status') {
        const nowIso = new Date().toISOString();
        const statusState = store.getRuntimeState ? await store.getRuntimeState(KEEPA_STATUS_STATE_KEY) : null;
        const watchIndexState = store.getRuntimeState
          ? await store.getRuntimeState(KEEPA_WATCH_INDEX_STATE_KEY)
          : null;
        const dealsState = store.getRuntimeState ? await store.getRuntimeState(KEEPA_DEALS_STATE_KEY) : null;
        const tokenUsageState = store.getRuntimeState
          ? await store.getRuntimeState(KEEPA_TOKEN_USAGE_STATE_KEY)
          : null;
        const watchAsins = Array.isArray(watchIndexState?.stateValue?.asins)
          ? watchIndexState.stateValue.asins
          : [];
        const deals = Array.isArray(dealsState?.stateValue?.items) ? dealsState.stateValue.items : [];
        const tokenUsage = normalizeKeepaTokenUsage(tokenUsageState?.stateValue ?? {});

        return sendJson(res, 200, {
          status: 'ok',
          provider: 'keepa',
          watchedAsins: watchAsins.length,
          dealsCount: deals.length,
          lastWatchStateIngestAt: statusState?.stateValue?.lastWatchStateIngestAt ?? null,
          lastEventsIngestAt: statusState?.stateValue?.lastEventsIngestAt ?? null,
          tokenUsage,
          checkedAt: nowIso,
        });
      }

      if (method === 'GET' && pathname === '/api/keepa/token-usage') {
        const tokenUsageState = store.getRuntimeState
          ? await store.getRuntimeState(KEEPA_TOKEN_USAGE_STATE_KEY)
          : null;
        const tokenUsage = normalizeKeepaTokenUsage(tokenUsageState?.stateValue ?? {});
        return sendJson(res, 200, {
          status: 'ok',
          source: tokenUsageState ? 'ingest' : 'default',
          ...tokenUsage,
        });
      }

      if (method === 'GET' && pathname === '/api/keepa/deals') {
        const rawLimit = Number(url.searchParams.get('limit') ?? 20);
        const limit = Math.max(1, Math.min(200, Number.isFinite(rawLimit) ? rawLimit : 20));
        const dealsState = store.getRuntimeState ? await store.getRuntimeState(KEEPA_DEALS_STATE_KEY) : null;
        let items = Array.isArray(dealsState?.stateValue?.items) ? dealsState.stateValue.items : [];
        let source = 'ingest';

        if (!items.length) {
          source = 'derived';
          const trackings = await store.listTrackings();
          items = trackings
            .map((item) => {
              const prices = Object.values(item.pricesNew ?? {}).filter((price) => Number.isFinite(Number(price)));
              const bestPrice = prices.length ? Number(Math.min(...prices).toFixed(2)) : null;
              return {
                asin: item.asin,
                title: item.title,
                bestPrice,
                currency: 'EUR',
                marketCount: prices.length,
                updatedAt: item.updatedAt ?? null,
              };
            })
            .filter((item) => item.bestPrice !== null);
        }

        return sendJson(res, 200, {
          status: 'ok',
          source,
          count: items.length,
          items: items.slice(0, limit),
          updatedAt: dealsState?.stateValue?.updatedAt ?? new Date().toISOString(),
        });
      }

      const keepaHistoryMatch = pathname.match(/^\/api\/keepa\/history\/([^/]+)$/);
      if (method === 'GET' && keepaHistoryMatch) {
        const asin = decodeURIComponent(keepaHistoryMatch[1]).toUpperCase();
        const detail = await store.getProductDetail(asin);
        if (!detail) {
          return sendJson(res, 404, { error: 'not_found', asin });
        }

        const rawLimit = Number(url.searchParams.get('limit') ?? 180);
        const limit = Math.max(1, Math.min(1000, Number.isFinite(rawLimit) ? rawLimit : 180));
        let items = [];
        if (store.getPriceHistory) {
          const rows = await store.getPriceHistory(asin, limit);
          if (Array.isArray(rows)) {
            items = rows;
          }
        }
        if (!items.length) {
          items = (Array.isArray(detail.historyPoints) ? detail.historyPoints : []).slice(-limit).map((row) => ({
            ts: row.ts,
            price: row.value,
            market: 'de',
            condition: 'new',
            currency: 'EUR',
          }));
        }

        return sendJson(res, 200, {
          status: 'ok',
          asin,
          count: items.length,
          items,
        });
      }

      if (method === 'POST' && pathname === '/api/keepa/watch-state/ingest') {
        if (!store.setRuntimeState || !store.getRuntimeState) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const body = await readJsonBody(req).catch(() => ({}));
        const rawItems = Array.isArray(body) ? body : Array.isArray(body.items) ? body.items : [];
        const normalizedItems = rawItems
          .map((item) => {
            const asin = String(item?.asin ?? '').trim().toUpperCase();
            if (!asin) return null;
            return {
              asin,
              market: String(item.market ?? '').trim().toLowerCase() || null,
              watched: item.watched ?? true,
              lastSeenPrice: toFiniteNumber(item.lastSeenPrice ?? item.price),
              currency: String(item.currency ?? 'EUR').trim().toUpperCase() || 'EUR',
              updatedAt: item.updatedAt ?? new Date().toISOString(),
            };
          })
          .filter(Boolean);

        if (!normalizedItems.length) {
          return sendJson(res, 400, { error: 'items_required' });
        }

        for (const item of normalizedItems) {
          await store.setRuntimeState(buildKeepaWatchStateKey(item.asin), item);
        }

        const previousIndex = await store.getRuntimeState(KEEPA_WATCH_INDEX_STATE_KEY);
        const knownAsins = new Set(
          Array.isArray(previousIndex?.stateValue?.asins) ? previousIndex.stateValue.asins : [],
        );
        for (const item of normalizedItems) {
          knownAsins.add(item.asin);
        }

        const nowIso = new Date().toISOString();
        await store.setRuntimeState(KEEPA_WATCH_INDEX_STATE_KEY, {
          asins: [...knownAsins].sort(),
          updatedAt: nowIso,
        });

        const statusState = (await store.getRuntimeState(KEEPA_STATUS_STATE_KEY))?.stateValue ?? {};
        await store.setRuntimeState(KEEPA_STATUS_STATE_KEY, {
          ...statusState,
          lastWatchStateIngestAt: nowIso,
          updatedAt: nowIso,
        });

        return sendJson(res, 200, {
          status: 'ok',
          ingested: normalizedItems.length,
          watchedAsins: knownAsins.size,
          updatedAt: nowIso,
        });
      }

      if (method === 'POST' && pathname === '/api/keepa/events/ingest') {
        if (!store.setRuntimeState || !store.getRuntimeState) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const body = await readJsonBody(req).catch(() => ({}));
        const rawEvents = Array.isArray(body) ? body : Array.isArray(body.events) ? body.events : [];
        const normalizedEvents = rawEvents
          .map((item) => {
            const asin = String(item?.asin ?? '').trim().toUpperCase();
            if (!asin) return null;
            return {
              asin,
              kind: String(item.kind ?? item.type ?? 'unknown').trim().toLowerCase() || 'unknown',
              market: String(item.market ?? '').trim().toLowerCase() || null,
              price: toFiniteNumber(item.price ?? item.currentPrice),
              currency: String(item.currency ?? 'EUR').trim().toUpperCase() || 'EUR',
              discountPct: toFiniteNumber(item.discountPct ?? item.dropPct ?? item.deltaPct),
              isDeal: Boolean(item.isDeal) || String(item.kind ?? '').toLowerCase() === 'deal',
              title: String(item.title ?? '').trim() || null,
              ts: item.ts ?? item.timestamp ?? new Date().toISOString(),
            };
          })
          .filter(Boolean);

        if (!normalizedEvents.length) {
          return sendJson(res, 400, { error: 'events_required' });
        }

        const previousEventsState = await store.getRuntimeState(KEEPA_EVENTS_STATE_KEY);
        const previousEvents = Array.isArray(previousEventsState?.stateValue?.items)
          ? previousEventsState.stateValue.items
          : [];
        const mergedEvents = [...normalizedEvents, ...previousEvents].slice(0, 1000);

        const nowIso = new Date().toISOString();
        await store.setRuntimeState(KEEPA_EVENTS_STATE_KEY, {
          items: mergedEvents,
          updatedAt: nowIso,
        });

        const deals = mergedEvents
          .filter((item) => item.isDeal || item.kind === 'deal' || item.kind === 'drop')
          .map((item) => ({
            asin: item.asin,
            title: item.title,
            market: item.market,
            price: item.price,
            currency: item.currency,
            discountPct: item.discountPct,
            ts: item.ts,
          }));

        await store.setRuntimeState(KEEPA_DEALS_STATE_KEY, {
          items: deals,
          updatedAt: nowIso,
        });

        if (body?.tokenUsage && typeof body.tokenUsage === 'object') {
          await store.setRuntimeState(KEEPA_TOKEN_USAGE_STATE_KEY, normalizeKeepaTokenUsage(body.tokenUsage));
        }

        const statusState = (await store.getRuntimeState(KEEPA_STATUS_STATE_KEY))?.stateValue ?? {};
        await store.setRuntimeState(KEEPA_STATUS_STATE_KEY, {
          ...statusState,
          lastEventsIngestAt: nowIso,
          updatedAt: nowIso,
        });

        return sendJson(res, 200, {
          status: 'ok',
          ingested: normalizedEvents.length,
          deals: deals.length,
          updatedAt: nowIso,
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
        const snapshot = store.recordTokenAllocationSnapshot
          ? await store.recordTokenAllocationSnapshot({
              runId: null,
              budgetMode: budgetTokens === null ? 'unbounded' : 'capped',
              summary: allocation.summary,
              plan: allocation.plan,
            })
          : null;

        return sendJson(res, 200, {
          status: 'ok',
          budgetMode: budgetTokens === null ? 'unbounded' : 'capped',
          snapshotId: snapshot?.snapshotId ?? null,
          ...allocation,
        });
      }

      if (
        method === 'GET' &&
        (pathname === '/token-control/snapshots/latest' || pathname === '/api/token-control/snapshots/latest')
      ) {
        if (!store.listLatestTokenAllocationSnapshots) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const rawLimit = Number(url.searchParams.get('limit') ?? 20);
        const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));
        const items = await store.listLatestTokenAllocationSnapshots(limit);
        return sendJson(res, 200, { items, count: items.length });
      }

      if (
        method === 'GET' &&
        (pathname === '/token-control/budget/status' || pathname === '/api/token-control/budget/status')
      ) {
        if (!store.getTokenDailyBudgetStatus) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const config = resolveAutomationTokenPolicyConfig({
          mode: url.searchParams.get('mode') ?? undefined,
          budgetTokens: url.searchParams.get('budgetTokens') ?? undefined,
        });
        const dayKey = resolveDayKeyInput(url.searchParams.get('day') ?? null, Date.now());
        if (!dayKey) {
          return sendJson(res, 400, { error: 'invalid_day' });
        }

        const tokenBudgetStatus = await store.getTokenDailyBudgetStatus({
          day: dayKey,
          budgetTokens: config.budgetTokens,
        });

        return sendJson(res, 200, {
          status: 'ok',
          day: dayKey,
          tokenPolicyConfig: config,
          tokenBudgetStatus,
        });
      }

      if (
        method === 'GET' &&
        (pathname === '/token-control/probe-policy' || pathname === '/api/token-control/probe-policy')
      ) {
        if (!store.getTokenDailyBudgetStatus) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const nowTs = parseTimestampInput(url.searchParams.get('now') ?? null, Date.now());
        const dayKey = resolveDayKeyInput(url.searchParams.get('day') ?? null, nowTs);
        if (!dayKey) {
          return sendJson(res, 400, { error: 'invalid_day' });
        }

        const config = resolveAutomationTokenPolicyConfig({
          mode: url.searchParams.get('mode') ?? undefined,
          budgetTokens: url.searchParams.get('budgetTokens') ?? undefined,
          probeCooldownSec: url.searchParams.get('probeCooldownSec') ?? undefined,
          maxProbesPerDay: url.searchParams.get('maxProbesPerDay') ?? undefined,
          autoTuneProbePolicy: url.searchParams.get('autoTuneProbePolicy') ?? undefined,
          probeAutoTuneMinCooldownSec: url.searchParams.get('probeAutoTuneMinCooldownSec') ?? undefined,
          probeAutoTuneHighCooldownSec: url.searchParams.get('probeAutoTuneHighCooldownSec') ?? undefined,
        });

        const tokenBudgetStatus = await store.getTokenDailyBudgetStatus({
          day: dayKey,
          budgetTokens: config.budgetTokens,
        });
        const previousDay = shiftDayKey(dayKey, -1);
        const tokenBudgetStatusPreviousDay = previousDay
          ? await store.getTokenDailyBudgetStatus({
              day: previousDay,
              budgetTokens: tokenBudgetStatus?.budgetTokens ?? config.budgetTokens,
            })
          : null;

        const derivedAutoTuneDecision = deriveTokenBudgetProbeAutoTunePolicy({
          enabled: Boolean(config?.autoTuneProbePolicy),
          usagePct: tokenBudgetStatus?.usagePct ?? 0,
          previousUsagePct: tokenBudgetStatusPreviousDay?.usagePct ?? null,
          probeCooldownSec: config?.probeCooldownSec,
          maxProbesPerDay: config?.maxProbesPerDay,
          minCooldownSec: config?.probeAutoTuneMinCooldownSec,
          highCooldownSec: config?.probeAutoTuneHighCooldownSec,
        });

        const probeRuntimeState = store.getRuntimeState
          ? await store.getRuntimeState(TOKEN_BUDGET_PROBE_STATE_KEY)
          : null;
        const probeCooldown = deriveTokenBudgetProbeCooldownFromRuntimeState(probeRuntimeState, {
          fallbackCooldownSec: config?.probeCooldownSec ?? TOKEN_BUDGET_PROBE_DEFAULT_COOLDOWN_SEC,
          nowMs: nowTs,
        });
        const lastAutoTuneDecision = deriveLastProbeAutoTuneDecision(probeRuntimeState);
        const resetAuditRuntimeState = store.getRuntimeState
          ? await store.getRuntimeState(TOKEN_BUDGET_PROBE_RESET_AUDIT_STATE_KEY)
          : null;
        const lastProbeResetAudit = deriveLastProbeResetAudit(resetAuditRuntimeState, { nowMs: nowTs });

        return sendJson(res, 200, {
          status: 'ok',
          day: dayKey,
          tokenPolicyConfig: config,
          tokenBudgetStatus,
          tokenBudgetStatusPreviousDay,
          probeCooldown,
          derivedAutoTuneDecision,
          lastAutoTuneDecision,
          lastProbeResetAudit,
        });
      }

      if (
        method === 'GET' &&
        (pathname === '/token-control/probe-policy/reset-auth/status' ||
          pathname === '/api/token-control/probe-policy/reset-auth/status')
      ) {
        const authContext = await resolveProbeResetOpsKeyAuthContext({ req, store, nowMs: Date.now() });
        const rotationAuditRuntimeState = store.getRuntimeState
          ? await store.getRuntimeState(TOKEN_BUDGET_PROBE_OPS_KEY_ROTATION_AUDIT_STATE_KEY)
          : null;
        const rotationAudit = deriveProbeResetOpsKeyRotationAudit(rotationAuditRuntimeState);
        return sendJson(res, 200, {
          status: 'ok',
          endpoint: 'token-control/probe-policy/reset',
          auth: {
            opsKeyRequired: authContext.authRequired,
            primaryOpsKeyConfigured: Boolean(authContext.primaryOpsKey),
            acceptedHeaders: ['x-soon-ops-key', 'x-ops-key', 'authorization: bearer'],
          },
          rotation: {
            active: authContext.rotationSnapshot.active,
            found: authContext.rotationSnapshot.found,
            activatedAt: authContext.rotationSnapshot.activatedAt,
            expiresAt: authContext.rotationSnapshot.expiresAt,
            remainingSec: authContext.rotationSnapshot.remainingSec,
            graceSec: authContext.rotationSnapshot.graceSec,
            nextOpsKeyFingerprint: authContext.rotationSnapshot.nextOpsKeyFingerprint,
          },
          lastRotationAudit: rotationAudit,
        });
      }

      if (
        method === 'POST' &&
        (pathname === '/token-control/probe-policy/reset-auth/rotate' ||
          pathname === '/api/token-control/probe-policy/reset-auth/rotate')
      ) {
        if (!store.getRuntimeState || !store.setRuntimeState) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const body = await readJsonBody(req).catch(() => ({}));
        const nowTs = parseTimestampInput(body?.now, Date.now());
        if (nowTs === null) {
          return sendJson(res, 400, { error: 'invalid_now' });
        }
        const authContext = await resolveProbeResetOpsKeyAuthContext({ req, store, nowMs: nowTs });
        if (!authContext.primaryOpsKey) {
          return sendJson(res, 409, { error: 'ops_key_guard_not_enabled' });
        }
        if (!authContext.providedOpsKey) {
          return sendJson(res, 401, {
            error: 'ops_key_required',
            header: 'x-soon-ops-key',
          });
        }
        if (!authContext.authValid) {
          return sendJson(res, 403, { error: 'ops_key_invalid' });
        }

        const confirm = String(body?.confirm ?? '').trim();
        if (confirm !== 'ROTATE_TOKEN_BUDGET_PROBE_RESET_OPS_KEY') {
          return sendJson(res, 400, {
            error: 'rotation_confirmation_required',
            expectedConfirm: 'ROTATE_TOKEN_BUDGET_PROBE_RESET_OPS_KEY',
          });
        }

        const reason = String(body?.reason ?? '')
          .trim()
          .slice(0, 240);
        if (reason.length < 8) {
          return sendJson(res, 400, { error: 'rotation_reason_too_short', minLength: 8 });
        }

        const actor = String(body?.actor ?? 'manual').trim().slice(0, 80) || 'manual';
        const dryRun = parseBooleanInput(body?.dryRun, false);
        const nextOpsKey = String(body?.nextOpsKey ?? '').trim();
        if (nextOpsKey.length < 16) {
          return sendJson(res, 400, { error: 'next_ops_key_too_short', minLength: 16 });
        }
        if (secretsEqual(nextOpsKey, authContext.primaryOpsKey)) {
          return sendJson(res, 400, { error: 'next_ops_key_same_as_current' });
        }

        const defaultGraceSec = clampInt(process.env.SOON_TOKEN_PROBE_RESET_ROTATION_GRACE_SEC, 3600, 60, 604800);
        const graceSec = clampInt(body?.graceSec, defaultGraceSec, 60, 604800);
        const nowIso = new Date(nowTs).toISOString();
        const nowDay = dayKeyFromTimestamp(nowTs);
        const expiresAtIso = new Date(nowTs + graceSec * 1000).toISOString();
        const nextOpsKeyHash = hashSecret(nextOpsKey);

        if (dryRun) {
          return sendJson(res, 200, {
            status: 'ok',
            dryRun: true,
            rotation: {
              active: true,
              activatedAt: nowIso,
              expiresAt: expiresAtIso,
              graceSec,
              nextOpsKeyFingerprint: nextOpsKeyHash.slice(0, 12),
            },
            authContext: {
              primaryMatched: authContext.primaryMatched,
              stagedMatched: authContext.stagedMatched,
              rotationActiveBefore: authContext.rotationSnapshot.active,
            },
          });
        }

        const rotationState = await store.setRuntimeState(TOKEN_BUDGET_PROBE_OPS_KEY_ROTATION_STATE_KEY, {
          timestamp: nowIso,
          day: nowDay,
          activatedAt: nowIso,
          expiresAt: expiresAtIso,
          graceSec,
          actor,
          reason,
          nextOpsKeyHash,
          previousPrimaryOpsKeyHash: hashSecret(authContext.primaryOpsKey),
        });

        const rotationAuditState = await store.setRuntimeState(TOKEN_BUDGET_PROBE_OPS_KEY_ROTATION_AUDIT_STATE_KEY, {
          timestamp: nowIso,
          day: nowDay,
          action: 'token_budget_probe_reset_ops_key_rotated',
          actor,
          reason,
          graceSec,
          expiresAt: expiresAtIso,
          nextOpsKeyFingerprint: nextOpsKeyHash.slice(0, 12),
          previousRotationActive: authContext.rotationSnapshot.active,
          previousRotationExpiresAt: authContext.rotationSnapshot.expiresAt,
        });

        return sendJson(res, 200, {
          status: 'ok',
          rotated: true,
          dryRun: false,
          actor,
          reason,
          rotation: {
            active: true,
            activatedAt: nowIso,
            expiresAt: expiresAtIso,
            graceSec,
            nextOpsKeyFingerprint: nextOpsKeyHash.slice(0, 12),
          },
          rotationState,
          rotationAuditState,
        });
      }

      if (
        method === 'POST' &&
        (pathname === '/token-control/probe-policy/reset' || pathname === '/api/token-control/probe-policy/reset')
      ) {
        if (!store.getRuntimeState || !store.setRuntimeState) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const body = await readJsonBody(req).catch(() => ({}));
        const nowTs = parseTimestampInput(body?.now, Date.now());
        if (nowTs === null) {
          return sendJson(res, 400, { error: 'invalid_now' });
        }

        const authContext = await resolveProbeResetOpsKeyAuthContext({ req, store, nowMs: nowTs });
        if (authContext.authRequired && !authContext.providedOpsKey) {
          return sendJson(res, 401, {
            error: 'ops_key_required',
            header: 'x-soon-ops-key',
          });
        }
        if (authContext.authRequired && !authContext.authValid) {
          return sendJson(res, 403, { error: 'ops_key_invalid' });
        }
        const nowIso = new Date(nowTs).toISOString();
        const nowDay = dayKeyFromTimestamp(nowTs);
        const confirm = String(body?.confirm ?? '').trim();
        if (confirm !== 'RESET_TOKEN_BUDGET_PROBE_STATE') {
          return sendJson(res, 400, {
            error: 'reset_confirmation_required',
            expectedConfirm: 'RESET_TOKEN_BUDGET_PROBE_STATE',
          });
        }

        const reason = String(body?.reason ?? '')
          .trim()
          .slice(0, 240);
        if (reason.length < 8) {
          return sendJson(res, 400, { error: 'reset_reason_too_short', minLength: 8 });
        }

        const actor = String(body?.actor ?? 'manual').trim().slice(0, 80) || 'manual';
        const dryRun = parseBooleanInput(body?.dryRun, false);
        const resetCooldownSec = clampInt(process.env.SOON_TOKEN_PROBE_RESET_COOLDOWN_SEC, 300, 0, 86400);
        const resetAuditRuntimeState = await store.getRuntimeState(TOKEN_BUDGET_PROBE_RESET_AUDIT_STATE_KEY);
        const resetAuditSnapshot = deriveLastProbeResetAudit(resetAuditRuntimeState, { nowMs: nowTs });
        if (resetAuditSnapshot.cooldown.active) {
          return sendJson(res, 409, {
            error: 'reset_cooldown_active',
            cooldownRemainingSec: resetAuditSnapshot.cooldown.remainingSec,
            resetCooldownSec,
            lastProbeResetAudit: resetAuditSnapshot,
          });
        }

        const probeRuntimeStateBefore = await store.getRuntimeState(TOKEN_BUDGET_PROBE_STATE_KEY);
        if (dryRun) {
          return sendJson(res, 200, {
            status: 'ok',
            dryRun: true,
            wouldReset: true,
            actor,
            reason,
            resetCooldownSec,
            probeRuntimeStateBefore,
          });
        }

        const probeRuntimeState = await store.setRuntimeState(TOKEN_BUDGET_PROBE_STATE_KEY, {
          timestamp: nowIso,
          day: '',
          reason: 'manual_probe_runtime_state_reset',
          probeBudgetTokens: null,
          cooldownSec: 0,
          probesForDay: 0,
          maxProbesPerDay: null,
          autoTuneEnabled: false,
          autoTuneApplied: false,
          autoTuneReason: 'manual_reset',
          autoTunePressureBand: 'reset',
          autoTuneUsagePct: null,
          autoTunePreviousUsagePct: null,
          autoTuneUsageDeltaPct: null,
          resetBy: actor,
          resetReason: reason,
          resetAt: nowIso,
        });

        const resetAuditState = await store.setRuntimeState(TOKEN_BUDGET_PROBE_RESET_AUDIT_STATE_KEY, {
          timestamp: nowIso,
          day: nowDay,
          action: 'token_budget_probe_state_reset',
          actor,
          reason,
          cooldownSec: resetCooldownSec,
          probeStateExisted: Boolean(probeRuntimeStateBefore),
          previousProbeTimestamp: probeRuntimeStateBefore?.stateValue?.timestamp ?? null,
          lastKnownProbesForDay: Number.isFinite(Number(probeRuntimeStateBefore?.stateValue?.probesForDay))
            ? Math.max(0, Math.floor(Number(probeRuntimeStateBefore.stateValue.probesForDay)))
            : null,
        });

        return sendJson(res, 200, {
          status: 'ok',
          reset: true,
          dryRun: false,
          actor,
          reason,
          resetCooldownSec,
          probeRuntimeStateBefore,
          probeRuntimeState,
          resetAuditState,
        });
      }

      if (method === 'POST' && pathname === '/automation/cycle') {
        const body = await readJsonBody(req).catch(() => ({}));
        const startTs = parseTimestampInput(body?.now, Date.now());
        if (startTs === null) {
          return sendJson(res, 400, { error: 'invalid_now' });
        }

        const startedAt = new Date(startTs).toISOString();
        const budgetDay = dayKeyFromTimestamp(startedAt);
        const trackings = await store.listTrackings();
        const tokenPolicyConfig = resolveAutomationTokenPolicyConfig(body?.tokenPolicy ?? null);
        let tokenBudgetStatusBefore = null;
        let tokenPolicyApplied = { ...tokenPolicyConfig };
        if (tokenPolicyApplied.mode === 'capped' && store.getTokenDailyBudgetStatus) {
          tokenBudgetStatusBefore = await store.getTokenDailyBudgetStatus({
            day: budgetDay,
            budgetTokens: tokenPolicyApplied.budgetTokens,
          });
          const remaining = toFiniteNumber(tokenBudgetStatusBefore?.remainingTokens);
          tokenPolicyApplied = {
            ...tokenPolicyApplied,
            budgetTokens:
              remaining !== null
                ? Number(Math.max(0, remaining).toFixed(2))
                : tokenPolicyApplied.budgetTokens,
          };
        }
        let tokenBudgetUsagePreviousDay = null;
        if (tokenPolicyApplied.mode === 'capped' && tokenBudgetStatusBefore && store.getTokenDailyBudgetStatus) {
          const previousDay = shiftDayKey(budgetDay, -1);
          if (previousDay) {
            tokenBudgetUsagePreviousDay = await store.getTokenDailyBudgetStatus({
              day: previousDay,
              budgetTokens: tokenBudgetStatusBefore?.budgetTokens ?? tokenPolicyConfig?.budgetTokens,
            });
          }
        }
        const probePolicyAutoTune = deriveTokenBudgetProbeAutoTunePolicy({
          enabled: Boolean(tokenPolicyConfig?.autoTuneProbePolicy),
          usagePct: tokenBudgetStatusBefore?.usagePct ?? 0,
          previousUsagePct: tokenBudgetUsagePreviousDay?.usagePct ?? null,
          probeCooldownSec: tokenPolicyConfig?.probeCooldownSec,
          maxProbesPerDay: tokenPolicyConfig?.maxProbesPerDay,
          minCooldownSec: tokenPolicyConfig?.probeAutoTuneMinCooldownSec,
          highCooldownSec: tokenPolicyConfig?.probeAutoTuneHighCooldownSec,
        });
        const tokenBudgetExhaustedBefore = tokenPolicyApplied.mode === 'capped' && Boolean(tokenBudgetStatusBefore?.exhausted);
        let tokenBudgetAutoRemediation = {
          checked: tokenPolicyApplied.mode === 'capped',
          triggered: false,
          action: 'none',
          reason: null,
          deferredUntil: null,
          configuredProbeCooldownSec: clampInt(
            tokenPolicyConfig?.probeCooldownSec,
            TOKEN_BUDGET_PROBE_DEFAULT_COOLDOWN_SEC,
            0,
            7 * 24 * 60 * 60,
          ),
          configuredMaxProbesPerDay: clampInt(tokenPolicyConfig?.maxProbesPerDay, 1, 0, 100),
          probeCooldownSec: probePolicyAutoTune.probeCooldownSec,
          maxProbesPerDay: probePolicyAutoTune.maxProbesPerDay,
          probePolicyAutoTuneEnabled: probePolicyAutoTune.enabled,
          probePolicyAutoTuneApplied: probePolicyAutoTune.applied,
          probePolicyAutoTuneReason: probePolicyAutoTune.reason,
          probePolicyPressureBand: probePolicyAutoTune.pressureBand,
          probePolicyUsagePct: probePolicyAutoTune.usagePct,
          probePolicyPreviousUsagePct: probePolicyAutoTune.previousUsagePct,
          probePolicyUsageDeltaPct: probePolicyAutoTune.usageDeltaPct,
          probesUsedToday: 0,
          probesUsedAfterAction: 0,
          probeCooldownRemainingSec: 0,
          probeBlockedByCooldown: false,
          probeBlockedByDailyCap: false,
          stateKey: null,
          stateUpdatedAt: null,
        };
        if (tokenBudgetExhaustedBefore) {
          const probeBudgetTokens = toFiniteNumber(tokenPolicyConfig?.probeBudgetTokens);
          const probeState = store.getRuntimeState ? await store.getRuntimeState(TOKEN_BUDGET_PROBE_STATE_KEY) : null;
          const probeStateValue = probeState?.stateValue ?? {};
          const probeStateDay = String(probeStateValue?.day ?? '').trim();
          const probesUsedToday =
            probeStateDay === budgetDay
              ? Number.isFinite(Number(probeStateValue?.probesForDay))
                ? Math.max(0, Math.floor(Number(probeStateValue?.probesForDay)))
                : 1
              : 0;
          const probeCooldownState = deriveTokenBudgetProbeCooldownFromRuntimeState(probeState, {
            fallbackCooldownSec: tokenBudgetAutoRemediation.probeCooldownSec,
            nowMs: startTs,
            overrideCooldownSec: tokenBudgetAutoRemediation.probeCooldownSec,
          });
          const probeAllowedByCooldown = !probeCooldownState.cooldownActive;
          const probeAllowedByDailyCap = probesUsedToday < tokenBudgetAutoRemediation.maxProbesPerDay;
          tokenBudgetAutoRemediation = {
            ...tokenBudgetAutoRemediation,
            probesUsedToday,
            probesUsedAfterAction: probesUsedToday,
            probeCooldownSec: probeCooldownState.cooldownSec,
            probeCooldownRemainingSec: probeCooldownState.cooldownRemainingSec,
            probeBlockedByCooldown: probeBudgetTokens !== null && probeBudgetTokens > 0 && !probeAllowedByCooldown,
            probeBlockedByDailyCap:
              probeBudgetTokens !== null && probeBudgetTokens > 0 && !probeAllowedByDailyCap,
          };

          if (probeBudgetTokens !== null && probeBudgetTokens > 0 && probeAllowedByCooldown && probeAllowedByDailyCap) {
            tokenPolicyApplied = {
              ...tokenPolicyApplied,
              budgetTokens: Number(probeBudgetTokens.toFixed(2)),
            };
            tokenBudgetAutoRemediation = {
              ...tokenBudgetAutoRemediation,
              triggered: true,
              action: 'smart_probe',
              reason: 'daily_token_budget_exhausted',
              deferredUntil: null,
              probesUsedAfterAction: probesUsedToday + 1,
              stateKey: TOKEN_BUDGET_PROBE_STATE_KEY,
            };
            if (store.setRuntimeState) {
              const runtimeState = await store.setRuntimeState(TOKEN_BUDGET_PROBE_STATE_KEY, {
                timestamp: startedAt,
                day: budgetDay,
                reason: 'daily_token_budget_exhausted',
                probeBudgetTokens: tokenPolicyApplied.budgetTokens,
                cooldownSec: tokenBudgetAutoRemediation.probeCooldownSec,
                probesForDay: tokenBudgetAutoRemediation.probesUsedAfterAction,
                maxProbesPerDay: tokenBudgetAutoRemediation.maxProbesPerDay,
                autoTuneEnabled: tokenBudgetAutoRemediation.probePolicyAutoTuneEnabled,
                autoTuneApplied: tokenBudgetAutoRemediation.probePolicyAutoTuneApplied,
                autoTuneReason: tokenBudgetAutoRemediation.probePolicyAutoTuneReason,
                autoTunePressureBand: tokenBudgetAutoRemediation.probePolicyPressureBand,
                autoTuneUsagePct: tokenBudgetAutoRemediation.probePolicyUsagePct,
                autoTunePreviousUsagePct: tokenBudgetAutoRemediation.probePolicyPreviousUsagePct,
                autoTuneUsageDeltaPct: tokenBudgetAutoRemediation.probePolicyUsageDeltaPct,
                windowResetAt: tokenBudgetStatusBefore?.windowResetAt ?? null,
              });
              tokenBudgetAutoRemediation.stateUpdatedAt = runtimeState?.updatedAt ?? null;
            }
          } else {
            tokenBudgetAutoRemediation = {
              ...tokenBudgetAutoRemediation,
              triggered: true,
              action: 'smart_deferral',
              reason: 'daily_token_budget_exhausted',
              deferredUntil: tokenBudgetStatusBefore?.windowResetAt ?? null,
              stateKey: TOKEN_BUDGET_DEFERRAL_STATE_KEY,
            };
            if (store.setRuntimeState) {
              const runtimeState = await store.setRuntimeState(TOKEN_BUDGET_DEFERRAL_STATE_KEY, {
                timestamp: startedAt,
                day: budgetDay,
                reason: 'daily_token_budget_exhausted',
                deferredUntil: tokenBudgetAutoRemediation.deferredUntil,
                remainingTokens: tokenBudgetStatusBefore?.remainingTokens ?? 0,
              });
              tokenBudgetAutoRemediation.stateUpdatedAt = runtimeState?.updatedAt ?? null;
            }
          }
        }
        const cycle = runAutomationCycle(trackings, {
          tokenPolicyMode: tokenPolicyApplied.mode,
          budgetTokens: tokenPolicyApplied.budgetTokens,
          degradationMode: tokenBudgetAutoRemediation.action,
          deferredUntil: tokenBudgetAutoRemediation.deferredUntil,
        });
        const finishedAt = new Date().toISOString();

        const persisted = store.recordAutomationCycle
          ? await store.recordAutomationCycle({
              cycle,
              trackingCount: Number(cycle?.tokenPolicy?.selectedCount ?? trackings.length),
              startedAt,
              finishedAt,
            })
          : null;
        const tokenSnapshotInput = buildTokenSnapshotFromPlan(cycle.tokenPlan, {
          budgetMode: cycle?.tokenPolicy?.mode ?? tokenPolicyApplied.mode,
          budgetTokens: cycle?.tokenPolicy?.budgetTokens ?? tokenPolicyApplied.budgetTokens,
        });
        const tokenSnapshot = store.recordTokenAllocationSnapshot
          ? await store.recordTokenAllocationSnapshot({
              runId: persisted?.runId ?? null,
              ...tokenSnapshotInput,
            })
          : null;
        let tokenBudgetStatusAfter = tokenBudgetStatusBefore;
        const skipBudgetConsumeForProbe = tokenBudgetAutoRemediation.action === 'smart_probe';
        if (tokenPolicyApplied.mode === 'capped' && store.consumeTokenDailyBudget && !skipBudgetConsumeForProbe) {
          tokenBudgetStatusAfter = await store.consumeTokenDailyBudget({
            day: budgetDay,
            budgetTokens: tokenPolicyConfig.budgetTokens,
            amountTokens: cycle?.tokenPolicy?.totalTokenCostSelected ?? 0,
          });
        }

        return sendJson(res, 200, {
          status: 'ok',
          runId: persisted?.runId ?? null,
          tokenSnapshotId: tokenSnapshot?.snapshotId ?? null,
          tokenPolicyConfig,
          tokenPolicyApplied,
          tokenBudgetStatusBefore,
          tokenBudgetStatus: tokenBudgetStatusAfter,
          tokenBudgetAutoRemediation,
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
        const fallbackProbeCooldownSec = clampInt(
          process.env.SOON_TOKEN_EXHAUSTED_PROBE_COOLDOWN_SEC,
          TOKEN_BUDGET_PROBE_DEFAULT_COOLDOWN_SEC,
          0,
          7 * 24 * 60 * 60,
        );
        let cooldown = null;
        if (key === ALERT_ROUTING_REMEDIATION_STATE_KEY) {
          cooldown = deriveAlertRoutingCooldownFromRuntimeState(runtimeState, {
            fallbackCooldownSec,
            nowMs: Date.now(),
          });
        } else if (key === TOKEN_BUDGET_PROBE_STATE_KEY) {
          cooldown = deriveTokenBudgetProbeCooldownFromRuntimeState(runtimeState, {
            fallbackCooldownSec: fallbackProbeCooldownSec,
            nowMs: Date.now(),
          });
        }

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
        if (store.listLatestTokenAllocationSnapshots) {
          const tokenSnapshots = await store.listLatestTokenAllocationSnapshots(1);
          payload += renderTokenControlPrometheusMetrics(tokenSnapshots[0] ?? null);
        }
        if (store.getTokenDailyBudgetStatus) {
          const tokenPolicyConfig = resolveAutomationTokenPolicyConfig();
          const tokenBudgetStatus = await store.getTokenDailyBudgetStatus({
            day: new Date().toISOString(),
            budgetTokens: tokenPolicyConfig.budgetTokens,
          });
          const tokenBudgetDeferralState = store.getRuntimeState
            ? await store.getRuntimeState(TOKEN_BUDGET_DEFERRAL_STATE_KEY)
            : null;
          const tokenBudgetProbeState = store.getRuntimeState
            ? await store.getRuntimeState(TOKEN_BUDGET_PROBE_STATE_KEY)
            : null;
          const tokenBudgetProbeCooldown = deriveTokenBudgetProbeCooldownFromRuntimeState(tokenBudgetProbeState, {
            fallbackCooldownSec: tokenPolicyConfig?.probeCooldownSec ?? TOKEN_BUDGET_PROBE_DEFAULT_COOLDOWN_SEC,
            nowMs: Date.now(),
          });
          payload += renderTokenBudgetPrometheusMetrics(
            tokenBudgetStatus,
            tokenPolicyConfig,
            tokenBudgetDeferralState,
            tokenBudgetProbeState,
            tokenBudgetProbeCooldown,
          );
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
