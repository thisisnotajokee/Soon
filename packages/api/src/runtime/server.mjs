import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
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
const PRICE_ERROR_REALERT_RULES_STATE_KEY = 'price_error_realert_rules_v1';
const ALERT_HISTORY_STATE_KEY = 'compat_alert_history_v1';
const TRACKINGS_CACHE_RUNTIME_STATE_KEY = 'trackings_cache_runtime';
const TRACKINGS_CACHE_AUTOTUNE_LAST_STATE_KEY = 'trackings_cache_autotune_last';
const TRACKINGS_CACHE_RUNTIME_HISTORY_STATE_KEY = 'trackings_cache_runtime_history';
const GLOBAL_SCAN_INTERVAL_STATE_KEY = 'global_scan_interval_hours';
const SETTINGS_SCAN_POLICY_STATE_KEY = 'settings_scan_policy_v1';
const SCAN_RUNTIME_STATE_KEY = 'scan_runtime_state_v1';
const SYSTEM_STATS_HISTORY_STATE_KEY = 'system_stats_history_v1';
const MOBILE_TRACKING_PREFERENCES_PREFIX = 'mobile_tracking_preferences_v1:';
const MOBILE_WEB_DEALS_HISTORY_STATE_KEY = 'mobile_web_deals_history_v1';
const MOBILE_SESSION_PREFIX = 'mobile_auth_session_v1:';
const MOBILE_SESSION_INDEX_PREFIX = 'mobile_auth_user_sessions_v1:';
const MOBILE_API_VERSION = 'v1';
const KEEPA_STATUS_STATE_KEY = 'keepa_status';
const KEEPA_WATCH_INDEX_STATE_KEY = 'keepa_watch_index';
const KEEPA_EVENTS_STATE_KEY = 'keepa_events';
const KEEPA_DEALS_STATE_KEY = 'keepa_deals';
const KEEPA_TOKEN_USAGE_STATE_KEY = 'keepa_token_usage';
const HUNTER_CUSTOM_CONFIG_STATE_KEY = 'hunter_custom_config';
const HUNTER_LAST_RUN_STATE_KEY = 'hunter_last_run';
const HUNTER_STRATEGY_LAST_STATE_KEY = 'hunter_strategy_last';
const HUNTER_STRATEGY_STATUS_STATE_KEY = 'hunter_strategy_status';
const HUNTER_STRATEGY_REPLAY_STATE_KEY = 'hunter_strategy_replay';
const HUNTER_CATEGORY_GROUP_PAUSE_PREFIX = 'hunter:cat:pause:v1:';
const HUNTER_CATEGORY_GROUPS = [
  'laptops',
  'gaming',
  'smartphone',
  'pc',
  'foto',
  'audio',
  'home',
  'kitchen',
  'beauty',
  'tools',
];
const HUNTER_PRESETS = new Set([
  'off',
  'safe',
  'balanced',
  'aggressive',
  'de_nl_focus',
  'electronics_focus',
  'smartphone_focus',
  'pc_ssd_ram',
  'high_value_focus',
  'ai_max',
  'warehouse_deals',
]);
const HUNTER_TREND_AUTOTUNE_LAST_STATE_KEY = 'hunter:trend:autotune:last:v1';
const HUNTER_TREND_AUTOTUNE_HISTORY_STATE_KEY = 'hunter:trend:autotune:history:v1';
const HUNTER_TREND_AUTOTUNE_ROLLBACK_STATE_KEY = 'hunter:trend:autotune:rollback:v1';
const HUNTER_TREND_AUTOTUNE_COOLDOWN_BOOST_STATE_KEY = 'hunter:trend:autotune:cooldown:boost:v1';
const HUNTER_TREND_HEALTH_ACTION_LAST_STATE_KEY = 'hunter:trend:health:action:last:v1';
const HUNTER_TREND_HEALTH_AUDIT_STATE_KEY = 'hunter:trend:health:audit:v1';
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
const API_LOG_BUFFER_MAX_ENTRIES = 1200;
const COMPAT_PRICE_ERROR_DOMAINS = new Set(['de', 'it', 'fr', 'es', 'uk', 'nl']);
const USER_VISIBLE_ALERT_TYPES = new Set([
  'drop_detected',
  'target_hit',
  'buybox',
  'buybox_change',
  'buybox_amazon',
  'stock_back',
  'stock_out',
  'price_error',
]);
const refreshAllJobs = new Map();

let apiLogNextId = 1;
const apiLogEntries = [];

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

function classifyHunterTrendLabel(slopePctPerDay) {
  const slope = Number(slopePctPerDay);
  if (!Number.isFinite(slope)) return 'stable';
  if (slope <= -2) return 'down_strong';
  if (slope <= -0.2) return 'down';
  if (slope >= 2) return 'up_strong';
  if (slope >= 0.2) return 'up';
  return 'stable';
}

function percentileVolatility(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const nums = values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  if (nums.length < 2) return 0;
  const mean = nums.reduce((acc, value) => acc + value, 0) / nums.length;
  if (!Number.isFinite(mean) || mean <= 0) return 0;
  const variance = nums.reduce((acc, value) => acc + (value - mean) ** 2, 0) / nums.length;
  const stdDev = Math.sqrt(Math.max(0, variance));
  return Number(((stdDev / mean) * 100).toFixed(4));
}

function buildHunterTrendFeatureRows({ tracking, historyPoints, lookbackHours }) {
  if (!tracking || typeof tracking !== 'object') return [];
  const asin = String(tracking.asin ?? '').trim();
  if (!asin) return [];
  const pricesNew = tracking.pricesNew && typeof tracking.pricesNew === 'object' ? tracking.pricesNew : {};
  const domains = Object.keys(pricesNew).filter((domain) => /^[a-z]{2}$/.test(domain.toLowerCase()));
  const fallbackDomain = 'de';
  const usedDomains = domains.length ? domains : [fallbackDomain];

  const nowMs = Date.now();
  const lookbackMs = Math.max(1, Number(lookbackHours) || 24 * 7) * 60 * 60 * 1000;
  const oldestAllowed = nowMs - lookbackMs;
  const sortedHistory = (Array.isArray(historyPoints) ? historyPoints : [])
    .map((item) => ({
      ts: Date.parse(item?.ts ?? ''),
      value: Number(item?.value),
    }))
    .filter((item) => Number.isFinite(item.ts) && Number.isFinite(item.value) && item.value > 0 && item.ts >= oldestAllowed)
    .sort((a, b) => a.ts - b.ts);

  if (sortedHistory.length < 2) {
    const latestTs = new Date(Date.parse(tracking.updatedAt ?? '') || nowMs).toISOString();
    return usedDomains.map((domain) => {
      const marketPrice = Number(pricesNew[domain]);
      return {
        asin,
        title: tracking.title ?? null,
        domain,
        lookbackHours: Number(lookbackHours),
        points: sortedHistory.length,
        slopePctPerDay: 0,
        momentum24hPct: 0,
        volatilityPct: 0,
        trendLabel: 'stable',
        latestPrice: Number.isFinite(marketPrice) ? Number(marketPrice.toFixed(2)) : null,
        latestTs,
        source: 'tracking-snapshot-v1',
      };
    });
  }
  const first = sortedHistory[0];
  const last = sortedHistory[sortedHistory.length - 1];
  const spanDays = Math.max((last.ts - first.ts) / (24 * 60 * 60 * 1000), 1 / 24);
  const slopePctPerDay = Number((((last.value - first.value) / first.value) * 100 / spanDays).toFixed(4));

  const target24hTs = last.ts - 24 * 60 * 60 * 1000;
  const closest24h = sortedHistory.reduce((best, point) => {
    if (!best) return point;
    return Math.abs(point.ts - target24hTs) < Math.abs(best.ts - target24hTs) ? point : best;
  }, null);
  const momentum24hPct =
    closest24h && Number.isFinite(closest24h.value) && closest24h.value > 0
      ? Number((((last.value - closest24h.value) / closest24h.value) * 100).toFixed(4))
      : 0;

  const volatilityPct = percentileVolatility(sortedHistory.map((item) => item.value));
  const trendLabel = classifyHunterTrendLabel(slopePctPerDay);
  return usedDomains.map((domain) => {
    const marketPrice = Number(pricesNew[domain]);
    return {
      asin,
      title: tracking.title ?? null,
      domain,
      lookbackHours: Number(lookbackHours),
      points: sortedHistory.length,
      slopePctPerDay,
      momentum24hPct,
      volatilityPct,
      trendLabel,
      latestPrice: Number.isFinite(marketPrice) ? Number(marketPrice.toFixed(2)) : Number(last.value.toFixed(2)),
      latestTs: new Date(last.ts).toISOString(),
      source: 'tracking-history-v1',
    };
  });
}

const HUNTER_KEYWORD_STOPWORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'this',
  'that',
  'new',
  'used',
  'plus',
  'pro',
  'ultra',
  'inch',
  'gen',
  'very',
  'model',
]);

function deriveHunterGroupsFromConfig(config) {
  const selected =
    Array.isArray(config?.hunterCategoryGroups) && config.hunterCategoryGroups.length
      ? config.hunterCategoryGroups.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : ['laptops', 'gaming'];
  return [...new Set(selected)].slice(0, 16);
}

function classifyKeywordGroup(keyword) {
  const value = String(keyword || '').toLowerCase();
  if (/(laptop|notebook|strix|rog|scar)/.test(value)) return 'laptops';
  if (/(game|gaming|gpu|rtx)/.test(value)) return 'gaming';
  if (/(tablet|fire|hd)/.test(value)) return 'tablets';
  return 'general';
}

function extractKeywordsFromTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && item.length <= 24)
    .filter((item) => !HUNTER_KEYWORD_STOPWORDS.has(item));
}

function normalizeHunterDealAsin(value) {
  const asin = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : null;
}

function normalizeHunterDealRow(raw = {}, fallbackSource = 'unknown') {
  const asin = normalizeHunterDealAsin(raw?.asin ?? raw?.id ?? raw?.productAsin);
  if (!asin) return null;

  const updatedAtRaw = raw?.updatedAt ?? raw?.at ?? raw?.ts ?? raw?.timestamp ?? null;
  const updatedAtParsed = Date.parse(String(updatedAtRaw ?? ''));
  const updatedAt = Number.isFinite(updatedAtParsed) ? new Date(updatedAtParsed).toISOString() : new Date().toISOString();

  const dropValue =
    toFiniteNumber(raw?.dropPct) ??
    toFiniteNumber(raw?.drop) ??
    toFiniteNumber(raw?.discountPct) ??
    toFiniteNumber(raw?.discount) ??
    0;
  const confidence = toFiniteNumber(raw?.confidence) ?? 0;

  const price = {
    de: toFiniteNumber(raw?.price_de ?? raw?.priceDe),
    it: toFiniteNumber(raw?.price_it ?? raw?.priceIt),
    fr: toFiniteNumber(raw?.price_fr ?? raw?.priceFr),
    es: toFiniteNumber(raw?.price_es ?? raw?.priceEs),
    uk: toFiniteNumber(raw?.price_uk ?? raw?.priceUk),
    nl: toFiniteNumber(raw?.price_nl ?? raw?.priceNl),
  };

  const next = {
    asin,
    title: raw?.title ?? raw?.productTitle ?? null,
    url: raw?.url ?? raw?.productUrl ?? null,
    source: String((raw?.source ?? fallbackSource) || 'unknown'),
    drop: Number.isFinite(dropValue) ? Number(dropValue.toFixed(4)) : 0,
    confidence: Number.isFinite(confidence) ? Number(confidence.toFixed(4)) : 0,
    updatedAt,
    price,
  };

  return next;
}

function mapHunterDealsFromState(rawState, sourceLabel) {
  if (Array.isArray(rawState)) {
    return rawState
      .map((item) => normalizeHunterDealRow(item, sourceLabel))
      .filter(Boolean);
  }
  if (rawState && typeof rawState === 'object') {
    const rows = Array.isArray(rawState.rows)
      ? rawState.rows
      : Array.isArray(rawState.items)
        ? rawState.items
        : [];
    return rows
      .map((item) => normalizeHunterDealRow(item, sourceLabel))
      .filter(Boolean);
  }
  return [];
}

function mapHunterDealsFromTrackingsFallback(trackings = [], limit = 60) {
  const rows = (Array.isArray(trackings) ? trackings : [])
    .map((tracking) => {
      const asin = normalizeHunterDealAsin(tracking?.asin);
      if (!asin) return null;
      const pricesNew = tracking?.pricesNew && typeof tracking.pricesNew === 'object' ? tracking.pricesNew : {};
      const priceDe = toFiniteNumber(pricesNew.de);
      const target = toFiniteNumber(tracking?.targetPriceNew);
      const drop =
        Number.isFinite(priceDe) && Number.isFinite(target) && priceDe !== 0
          ? Number((((target - priceDe) / priceDe) * 100).toFixed(4))
          : 0;
      return {
        asin,
        title: tracking?.title ?? null,
        url: `https://www.amazon.de/dp/${asin}`,
        source: 'tracking-fallback',
        drop,
        confidence: 0,
        updatedAt: tracking?.updatedAt ?? new Date().toISOString(),
        price: {
          de: toFiniteNumber(pricesNew.de),
          it: toFiniteNumber(pricesNew.it),
          fr: toFiniteNumber(pricesNew.fr),
          es: toFiniteNumber(pricesNew.es),
          uk: toFiniteNumber(pricesNew.uk),
          nl: toFiniteNumber(pricesNew.nl),
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const ta = Date.parse(a?.updatedAt ?? '');
      const tb = Date.parse(b?.updatedAt ?? '');
      if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
      return Math.abs(Number(b?.drop ?? 0)) - Math.abs(Number(a?.drop ?? 0));
    });
  return rows.slice(0, Math.max(1, Math.min(200, Number(limit) || 60)));
}

function dedupeHunterDealsByAsin(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const asin = normalizeHunterDealAsin(row?.asin);
    if (!asin) continue;
    const prev = map.get(asin);
    if (!prev) {
      map.set(asin, row);
      continue;
    }
    const prevTs = Date.parse(prev?.updatedAt ?? '');
    const nextTs = Date.parse(row?.updatedAt ?? '');
    if (Number.isFinite(nextTs) && (!Number.isFinite(prevTs) || nextTs > prevTs)) {
      map.set(asin, row);
      continue;
    }
    const prevDrop = Math.abs(Number(prev?.drop ?? 0));
    const nextDrop = Math.abs(Number(row?.drop ?? 0));
    if (nextDrop > prevDrop) map.set(asin, row);
  }
  return [...map.values()];
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

function buildPriceErrorRealertRuleKey(chatId, asin, domain) {
  const normalizedChatId = String(chatId ?? '').trim().toLowerCase() || 'default';
  const normalizedAsin = String(asin ?? '').trim().toUpperCase();
  const normalizedDomain = String(domain ?? '').trim().toLowerCase();
  return `${normalizedChatId}:${normalizedAsin}:${normalizedDomain}`;
}

function normalizeChatId(raw) {
  const normalized = String(raw ?? '').trim();
  return normalized || 'default';
}

function resolveCompatAuthUserId(req, url) {
  const fromHeader = String(req.headers['x-telegram-user-id'] ?? req.headers['x-chat-id'] ?? '').trim();
  const fromQuery = String(url.searchParams.get('chatId') ?? url.searchParams.get('userId') ?? '').trim();
  const raw = fromHeader || fromQuery;
  return raw || null;
}

function resolveCompatAdminId() {
  const raw = String(process.env.SOON_ADMIN_ID ?? process.env.TELEGRAM_ADMIN_ID ?? '').trim();
  return raw || null;
}

function resolveCompatRequestId(req) {
  const raw = String(req.headers['x-request-id'] ?? '').trim();
  return raw || null;
}

function isCompatAdminUser(userId, adminId) {
  return Boolean(userId && adminId && String(userId) === String(adminId));
}

function createCompatWebToken(userId) {
  const normalizedUserId = String(userId ?? '').trim();
  if (!normalizedUserId) return null;
  const nonce = crypto.randomBytes(32).toString('hex');
  return `${normalizedUserId}.${Date.now().toString(36)}.${nonce}`;
}

function createSystemStatsSample(startedAtMs) {
  const memory = process.memoryUsage();
  const cpus = os.cpus();
  const cpuCount = Array.isArray(cpus) ? cpus.length : 1;
  const loadAvg = os.loadavg();
  return {
    capturedAt: new Date().toISOString(),
    uptimeSec: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
    cpu: {
      load1m: Number((Number(loadAvg?.[0] ?? 0)).toFixed(2)),
      load5m: Number((Number(loadAvg?.[1] ?? 0)).toFixed(2)),
      load15m: Number((Number(loadAvg?.[2] ?? 0)).toFixed(2)),
      cores: Math.max(1, Number(cpuCount || 1)),
    },
    memory: {
      rssMb: Number((memory.rss / (1024 * 1024)).toFixed(2)),
      heapUsedMb: Number((memory.heapUsed / (1024 * 1024)).toFixed(2)),
      heapTotalMb: Number((memory.heapTotal / (1024 * 1024)).toFixed(2)),
      externalMb: Number((memory.external / (1024 * 1024)).toFixed(2)),
    },
    platform: process.platform,
    node: process.version,
  };
}

function normalizeSystemStatsRange(rawRange) {
  const token = String(rawRange ?? '1h').trim().toLowerCase();
  return ['1h', '6h', '12h', '24h'].includes(token) ? token : '1h';
}

function systemStatsRangeHours(range) {
  if (range === '6h') return 6;
  if (range === '12h') return 12;
  if (range === '24h') return 24;
  return 1;
}

function scoreScanCandidate(item) {
  const trust = Number(item?.trustScore ?? item?.trust_score ?? 0);
  const drop = Number(item?.dropPct ?? item?.discountPct ?? 0);
  const updates = Number(item?.alertsCount ?? item?.updatesCount ?? 0);
  const score = (trust * 0.6) + (drop * 0.3) + (Math.min(updates, 50) * 0.1);
  return Number.isFinite(score) ? Number(score.toFixed(2)) : 0;
}

function buildCompatScanPlanPayload(trackings, budget, avgTokenPerAsin) {
  const rows = Array.isArray(trackings) ? trackings : [];
  const scored = rows
    .map((item) => ({
      asin: String(item?.asin || '').trim().toUpperCase(),
      title: item?.title ? String(item.title) : null,
      score: scoreScanCandidate(item),
    }))
    .filter((item) => item.asin);
  scored.sort((a, b) => b.score - a.score);

  const maxByBudget = Math.max(0, Math.floor(budget / Math.max(1, avgTokenPerAsin)));
  const selected = scored.slice(0, maxByBudget);
  const skipped = Math.max(0, scored.length - selected.length);
  const estimatedTokens = selected.length * Math.max(1, avgTokenPerAsin);

  return {
    generatedAt: new Date().toISOString(),
    totalTrackings: scored.length,
    budget,
    avgTokenPerAsin,
    estimatedTokens,
    plannedCount: selected.length,
    skippedCount: skipped,
    strategy: 'compat_v1',
    items: selected.map((item, index) => ({
      order: index + 1,
      asin: item.asin,
      title: item.title,
      score: item.score,
      reason: index < 10 ? 'high_priority' : 'budget_fit',
    })),
  };
}

function buildPopularityRows(trackings, limit = 20) {
  const rows = (Array.isArray(trackings) ? trackings : [])
    .map((item) => {
      const asin = String(item?.asin || '').trim().toUpperCase();
      if (!asin) return null;
      const trust = Number(item?.trustScore ?? item?.trust_score ?? 0);
      const drop = Number(item?.dropPct ?? item?.discountPct ?? 0);
      const alerts = Number(item?.alertsCount ?? item?.updatesCount ?? 0);
      const score = Number((trust * 0.55 + drop * 0.35 + Math.min(alerts, 100) * 0.1).toFixed(2));
      return {
        asin,
        title: item?.title ? String(item.title) : null,
        category: item?.category ? String(item.category) : null,
        trustScore: Number.isFinite(trust) ? trust : 0,
        dropPct: Number.isFinite(drop) ? drop : 0,
        trackers: Math.max(1, Number.isFinite(alerts) ? Math.round(alerts) : 1),
        score,
      };
    })
    .filter(Boolean);
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, Math.max(1, limit));
}

function inferCategoryFromTracking(item) {
  const title = String(item?.title || '').toLowerCase();
  if (title.includes('laptop') || title.includes('rog') || title.includes('notebook')) return 'Computers';
  if (title.includes('tablet') || title.includes('fire hd') || title.includes('ipad')) return 'Tablets';
  if (title.includes('audio') || title.includes('headphones') || title.includes('speaker')) return 'Audio';
  return 'General';
}

function buildCategoryRows(trackings, chatId) {
  const counts = new Map();
  for (const item of (Array.isArray(trackings) ? trackings : [])) {
    const category = inferCategoryFromTracking(item);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count], index) => ({
      id: `${String(chatId || 'default')}:${index + 1}`,
      category,
      count,
    }));
}

function buildTagRows(trackings, chatId) {
  const tagCounts = new Map();
  for (const item of (Array.isArray(trackings) ? trackings : [])) {
    const titleTokens = String(item?.title || '')
      .split(/[^A-Za-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .slice(0, 5);
    for (const token of titleTokens) {
      const normalized = token.toLowerCase();
      tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
    }
  }
  return [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([tag, count], index) => ({
      id: `${String(chatId || 'default')}:tag:${index + 1}`,
      tag,
      count,
    }));
}

function buildUserStatsPayload(trackings, chatId, schedulerMetrics = {}) {
  const rows = Array.isArray(trackings) ? trackings : [];
  const totalProducts = rows.length;
  const totalAlerts = Number(schedulerMetrics?.totalAlerts || 0);
  const alerts7d = Number(schedulerMetrics?.alerts7d || schedulerMetrics?.lastAlerts || 0);
  const alerts30d = Number(schedulerMetrics?.alerts30d || schedulerMetrics?.totalAlerts || 0);
  const productsAlerted = Math.min(totalProducts, Math.max(0, Number(schedulerMetrics?.productsAlerted || totalAlerts)));
  const pctDropAlerts = Number(schedulerMetrics?.pctDropAlerts || 0);
  const milestones = Number(schedulerMetrics?.milestones || 0);
  const targetsHit = Number(schedulerMetrics?.targetsHit || 0);
  return {
    chat_id: chatId,
    total_products: totalProducts,
    total_alerts: totalAlerts,
    tracking_since: rows[0]?.updatedAt ?? null,
    targets_hit: targetsHit,
    alerts_7d: alerts7d,
    alerts_30d: alerts30d,
    products_alerted: productsAlerted,
    pct_drop_alerts: pctDropAlerts,
    milestones,
  };
}

function buildCompatPriceErrorRows(trackings, limit = 50) {
  const rows = [];
  for (const item of Array.isArray(trackings) ? trackings : []) {
    const asin = String(item?.asin ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    const pricesNew = item?.pricesNew && typeof item.pricesNew === 'object' ? item.pricesNew : {};
    for (const [domainRaw, priceRaw] of Object.entries(pricesNew)) {
      const domain = String(domainRaw ?? '').trim().toLowerCase();
      if (!COMPAT_PRICE_ERROR_DOMAINS.has(domain)) continue;
      const price = toFiniteNumber(priceRaw);
      if (!Number.isFinite(price) || price <= 0) continue;
      rows.push({
        asin,
        domain,
        price: Number(price.toFixed(2)),
        title: item?.title ?? null,
        source: 'compat_runtime',
        updated_at: item?.updatedAt ?? null,
      });
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}

function normalizeCompatAlertHistoryRows(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const id = Number.parseInt(String(row?.id ?? ''), 10);
      const alertType = String(row?.alert_type ?? '').trim();
      const createdAtRaw = String(row?.created_at ?? '').trim();
      const createdTs = Date.parse(createdAtRaw);
      if (!Number.isInteger(id) || id <= 0 || !alertType || !Number.isFinite(createdTs)) return null;
      return {
        id,
        chat_id: String(row?.chat_id ?? '').trim() || null,
        asin: row?.asin ? String(row.asin).trim().toUpperCase() : null,
        alert_type: alertType,
        message: row?.message ? String(row.message) : null,
        created_at: new Date(createdTs).toISOString(),
        feedback_status: row?.feedback_status ? String(row.feedback_status).trim() : null,
        feedback_source: row?.feedback_source ? String(row.feedback_source).trim() : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)));
}

async function loadCompatAlertHistory(store) {
  if (!store.getRuntimeState) return [];
  const state = await store.getRuntimeState(ALERT_HISTORY_STATE_KEY);
  return normalizeCompatAlertHistoryRows(state?.stateValue ?? []);
}

async function saveCompatAlertHistory(store, rows) {
  if (!store.setRuntimeState) return;
  await store.setRuntimeState(ALERT_HISTORY_STATE_KEY, normalizeCompatAlertHistoryRows(rows));
}

function buildCompatAlertHistoryFromRuns(runs, limit = 200) {
  const items = [];
  for (const run of Array.isArray(runs) ? runs : []) {
    const createdAt = run?.finishedAt ?? run?.startedAt ?? new Date().toISOString();
    for (const alert of Array.isArray(run?.alerts) ? run.alerts : []) {
      const kind = String(alert?.kind ?? '').trim().toLowerCase();
      const alertType = kind === 'technical' ? 'technical' : 'drop_detected';
      items.push({
        chat_id: null,
        asin: alert?.asin ? String(alert.asin).trim().toUpperCase() : null,
        alert_type: alertType,
        message: alert?.message ? String(alert.message) : alert?.channel ? `channel=${alert.channel}` : null,
        created_at: createdAt,
        feedback_status: null,
        feedback_source: null,
      });
      if (items.length >= limit) break;
    }
    if (items.length >= limit) break;
  }
  return items.map((row, index) => ({
    id: index + 1,
    ...row,
  }));
}

function sanitizeSystemStatsHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const maxAgeMs = 24 * 60 * 60 * 1000;
  return raw
    .filter((entry) => {
      const ts = Date.parse(String(entry?.capturedAt ?? ''));
      return Number.isFinite(ts) && ts <= now + 5 * 60 * 1000 && ts >= now - maxAgeMs;
    })
    .sort((a, b) => Date.parse(String(a.capturedAt)) - Date.parse(String(b.capturedAt)))
    .slice(-1500);
}

async function appendSystemStatsHistory(store, sample) {
  if (!store.getRuntimeState || !store.setRuntimeState) return [sample];
  const state = await store.getRuntimeState(SYSTEM_STATS_HISTORY_STATE_KEY);
  const previous = sanitizeSystemStatsHistory(state?.stateValue);
  const next = sanitizeSystemStatsHistory([...previous, sample]);
  await store.setRuntimeState(SYSTEM_STATS_HISTORY_STATE_KEY, next);
  return next;
}

function normalizeMobilePagination(url) {
  const limitRaw = Number.parseInt(String(url.searchParams.get('limit') ?? '50'), 10);
  const offsetRaw = Number.parseInt(String(url.searchParams.get('offset') ?? '0'), 10);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const offset = Number.isInteger(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
  return { limit, offset };
}

function computeMobileDropPct(avgPrice, bestPrice) {
  const avg = Number(avgPrice);
  const best = Number(bestPrice);
  if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(best) || best <= 0 || best >= avg) return 0;
  return Number((((avg - best) / avg) * 100).toFixed(2));
}

function normalizeMarketPriceValue(raw) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : null;
}

function buildMobileMarketPrices(prices = {}) {
  if (!prices || typeof prices !== 'object') return {};
  const out = {};
  for (const [market, raw] of Object.entries(prices)) {
    const normalized = normalizeMarketPriceValue(raw);
    if (normalized !== null) out[String(market)] = normalized;
  }
  return out;
}

function buildMobileTrackingItem(item) {
  const pricesNew = buildMobileMarketPrices(item?.pricesNew ?? {});
  const pricesUsed = buildMobileMarketPrices(item?.pricesUsed ?? {});
  const newValues = Object.values(pricesNew);
  const bestPrice = newValues.length ? Math.min(...newValues) : 0;
  const avgPrice = newValues.length ? Number((newValues.reduce((sum, value) => sum + value, 0) / newValues.length).toFixed(2)) : 0;
  const priceTrend = Array.isArray(item?.historyPoints)
    ? item.historyPoints
        .slice(-30)
        .map((point) => ({
          ts: point?.ts ?? null,
          value: normalizeMarketPriceValue(point?.value) ?? 0,
        }))
        .filter((point) => point.ts)
    : [];

  return {
    asin: String(item?.asin ?? '').trim().toUpperCase(),
    title: item?.title ?? null,
    imageUrl: item?.imageUrl ?? null,
    dealScore: Number(item?.dealScore ?? 0),
    watchlistScore: Number(item?.watchlistScore ?? 0),
    rating: item?.rating ?? null,
    reviews: item?.reviews ?? null,
    bestPrice,
    avgPrice,
    dropPct: computeMobileDropPct(avgPrice, bestPrice),
    targetPrice: normalizeMarketPriceValue(item?.targetPriceNew),
    targetPriceUsed: normalizeMarketPriceValue(item?.targetPriceUsed),
    alertDropPct: Number.isFinite(Number(item?.thresholdDropPct)) ? Number(item.thresholdDropPct) : null,
    scanInterval: Number.isFinite(Number(item?.scanInterval)) ? Number(item.scanInterval) : null,
    enabledDomains: Object.keys(pricesNew),
    preferredSizeType: item?.preferredSizeType ?? null,
    preferredSize: item?.preferredSize ?? null,
    preferredSizeSystem: item?.preferredSizeSystem ?? null,
    snoozedUntil: item?.snoozedUntil ?? null,
    marketPrices: pricesNew,
    marketPricesUsed: pricesUsed,
    category: item?.category ?? null,
    buyboxSeller: item?.buyboxSeller ?? null,
    buyboxIsAmazon: item?.buyboxIsAmazon ?? null,
    outOfStock: item?.outOfStock ?? false,
    popularity: Number(item?.popularity ?? 0),
    createdAt: item?.createdAt ?? null,
    lastChecked: item?.updatedAt ?? null,
    priceTrend,
  };
}

function mobileTrackingPreferencesKey(userId, asin) {
  return `${MOBILE_TRACKING_PREFERENCES_PREFIX}${String(userId ?? '').trim()}:${String(asin ?? '').trim().toUpperCase()}`;
}

function parseNullablePriceValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : Number.NaN;
}

async function hydrateMobileTrackingItem(store, userId, item) {
  const asin = String(item?.asin ?? '').trim().toUpperCase();
  const snoozeState = store.getRuntimeState ? await store.getRuntimeState(buildTrackingSnoozeStateKey(userId, asin)) : null;
  const snooze = snoozeState?.stateValue ?? null;
  const snoozedUntil = snooze?.until ?? item?.snoozedUntil ?? null;
  return buildMobileTrackingItem({
    ...item,
    snoozedUntil,
  });
}

function mobileSessionKey(sessionId) {
  return `${MOBILE_SESSION_PREFIX}${String(sessionId ?? '').trim().toLowerCase()}`;
}

function mobileSessionIndexKey(userId) {
  return `${MOBILE_SESSION_INDEX_PREFIX}${String(userId ?? '').trim()}`;
}

function parseMobilePositiveUserId(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getMobileTokenTtls() {
  return {
    accessTtlSeconds: clampInt(process.env.MOBILE_ACCESS_TOKEN_TTL_SECONDS, 15 * 60, 300, 24 * 60 * 60),
    refreshTtlSeconds: clampInt(
      process.env.MOBILE_REFRESH_TOKEN_TTL_SECONDS,
      30 * 24 * 60 * 60,
      24 * 60 * 60,
      90 * 24 * 60 * 60,
    ),
  };
}

function getMobileMaxSessionsPerUser() {
  return clampInt(process.env.MOBILE_MAX_SESSIONS_PER_USER, 5, 1, 20);
}

function getMobileSessionSecret() {
  const explicit = String(process.env.MOBILE_SESSION_SECRET ?? '').trim();
  if (explicit) return explicit;
  const telegramToken = String(
    process.env.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_TOKEN ?? process.env.BOT_TOKEN ?? '',
  ).trim();
  if (telegramToken) return `${telegramToken}:mobile:v1`;
  return 'soon-mobile-v1-dev-secret';
}

function signWithMobileSecret(data) {
  return crypto.createHmac('sha256', getMobileSessionSecret()).update(String(data)).digest('hex');
}

function safeEqualHex(left, right) {
  try {
    const a = Buffer.from(String(left ?? ''), 'hex');
    const b = Buffer.from(String(right ?? ''), 'hex');
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization ?? req.headers.Authorization ?? '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice(7).trim();
}

function createMobileAccessToken(userId, sessionId, issuedAtSec = Math.floor(Date.now() / 1000)) {
  const uid = parseMobilePositiveUserId(userId);
  const sid = String(sessionId ?? '').trim().toLowerCase();
  if (!uid || !/^[a-f0-9]{12,64}$/i.test(sid)) return null;
  const { accessTtlSeconds } = getMobileTokenTtls();
  const iat = Number.parseInt(String(issuedAtSec), 10);
  const exp = iat + accessTtlSeconds;
  const payload = `m1.${uid}.${iat}.${exp}.${sid}`;
  const sig = signWithMobileSecret(payload);
  return `${payload}.${sig}`;
}

function parseMobileAccessToken(rawToken) {
  try {
    const token = String(rawToken ?? '').trim();
    const m = token.match(/^m1\.(\d+)\.(\d+)\.(\d+)\.([a-f0-9]{12,64})\.([a-f0-9]{64})$/i);
    if (!m) return null;
    const userId = parseMobilePositiveUserId(m[1]);
    const iat = Number.parseInt(m[2], 10);
    const exp = Number.parseInt(m[3], 10);
    const sessionId = String(m[4]).toLowerCase();
    const sig = String(m[5]).toLowerCase();
    if (!userId || !Number.isInteger(iat) || !Number.isInteger(exp) || exp <= iat) return null;
    const now = Math.floor(Date.now() / 1000);
    if (now > exp || iat > now + 300) return null;
    const payload = `m1.${userId}.${iat}.${exp}.${sessionId}`;
    const expected = signWithMobileSecret(payload);
    if (!safeEqualHex(expected, sig)) return null;
    return { userId, sessionId };
  } catch {
    return null;
  }
}

function createMobileRefreshToken(userId, sessionId, issuedAtSec = Math.floor(Date.now() / 1000)) {
  const uid = parseMobilePositiveUserId(userId);
  const sid = String(sessionId ?? '').trim().toLowerCase();
  if (!uid || !/^[a-f0-9]{12,64}$/i.test(sid)) return null;
  const { refreshTtlSeconds } = getMobileTokenTtls();
  const iat = Number.parseInt(String(issuedAtSec), 10);
  const exp = iat + refreshTtlSeconds;
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `mr1.${uid}.${iat}.${exp}.${sid}.${nonce}`;
  const sig = signWithMobileSecret(payload);
  return `${payload}.${sig}`;
}

function parseMobileRefreshToken(rawToken) {
  try {
    const token = String(rawToken ?? '').trim();
    const m = token.match(/^mr1\.(\d+)\.(\d+)\.(\d+)\.([a-f0-9]{12,64})\.([a-f0-9]{16})\.([a-f0-9]{64})$/i);
    if (!m) return null;
    const userId = parseMobilePositiveUserId(m[1]);
    const iat = Number.parseInt(m[2], 10);
    const exp = Number.parseInt(m[3], 10);
    const sessionId = String(m[4]).toLowerCase();
    const nonce = String(m[5]).toLowerCase();
    const sig = String(m[6]).toLowerCase();
    if (!userId || !Number.isInteger(iat) || !Number.isInteger(exp) || exp <= iat) return null;
    const now = Math.floor(Date.now() / 1000);
    if (now > exp || iat > now + 300) return null;
    const payload = `mr1.${userId}.${iat}.${exp}.${sessionId}.${nonce}`;
    const expected = signWithMobileSecret(payload);
    if (!safeEqualHex(expected, sig)) return null;
    return { userId, sessionId, nonce };
  } catch {
    return null;
  }
}

async function loadMobileSessionIndex(store, userId) {
  const raw = store.getRuntimeState ? await store.getRuntimeState(mobileSessionIndexKey(userId)) : null;
  const state = raw?.stateValue;
  if (!Array.isArray(state)) return [];
  const seen = new Set();
  const nowIso = new Date().toISOString();
  const normalized = [];
  for (const item of state) {
    const sessionId = String(item?.sessionId ?? '').trim().toLowerCase();
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    normalized.push({
      sessionId,
      createdAt: String(item?.createdAt ?? nowIso),
      lastSeenAt: String(item?.lastSeenAt ?? item?.updatedAt ?? item?.createdAt ?? nowIso),
      revokedAt: item?.revokedAt ? String(item.revokedAt) : null,
    });
  }
  normalized.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return normalized.slice(-200);
}

async function saveMobileSessionIndex(store, userId, index) {
  if (store.setRuntimeState) {
    await store.setRuntimeState(mobileSessionIndexKey(userId), index);
  }
}

async function upsertMobileSessionIndex(store, userId, sessionId, { createdAt, lastSeenAt } = {}) {
  const sid = String(sessionId ?? '').trim().toLowerCase();
  if (!sid) return;
  const nowIso = new Date().toISOString();
  const index = await loadMobileSessionIndex(store, userId);
  const existing = index.find((item) => item.sessionId === sid);
  if (existing) {
    existing.lastSeenAt = String(lastSeenAt ?? nowIso);
    if (createdAt) existing.createdAt = String(createdAt);
    existing.revokedAt = null;
  } else {
    index.push({
      sessionId: sid,
      createdAt: String(createdAt ?? nowIso),
      lastSeenAt: String(lastSeenAt ?? createdAt ?? nowIso),
      revokedAt: null,
    });
  }
  await saveMobileSessionIndex(store, userId, index);
}

async function revokeMobileSessionById(store, userId, sessionId) {
  const sid = String(sessionId ?? '').trim().toLowerCase();
  if (!sid) return false;
  const nowIso = new Date().toISOString();
  const sessionState = store.getRuntimeState ? await store.getRuntimeState(mobileSessionKey(sid)) : null;
  const session = sessionState?.stateValue ?? null;
  if (session && Number(session.userId) === Number(userId) && !session.revokedAt && store.setRuntimeState) {
    await store.setRuntimeState(mobileSessionKey(sid), {
      ...session,
      revokedAt: nowIso,
      updatedAt: nowIso,
    });
  }
  const index = await loadMobileSessionIndex(store, userId);
  const rec = index.find((item) => item.sessionId === sid);
  if (!rec) return false;
  rec.revokedAt = nowIso;
  rec.lastSeenAt = nowIso;
  await saveMobileSessionIndex(store, userId, index);
  return true;
}

async function revokeMobileOverflowSessions(store, userId, maxActiveSessions, keepSessionId = '') {
  const keep = String(keepSessionId ?? '').trim().toLowerCase();
  const index = await loadMobileSessionIndex(store, userId);
  const active = index
    .filter((item) => !item.revokedAt)
    .sort((a, b) => String(a.lastSeenAt || a.createdAt).localeCompare(String(b.lastSeenAt || b.createdAt)));
  const revoked = [];
  while (active.length > maxActiveSessions) {
    const candidate = active.find((item) => item.sessionId !== keep) || active[0];
    const idx = active.findIndex((item) => item.sessionId === candidate.sessionId);
    if (idx >= 0) active.splice(idx, 1);
    const ok = await revokeMobileSessionById(store, userId, candidate.sessionId);
    if (ok) revoked.push(candidate.sessionId);
  }
  return revoked;
}

function resolveMobileSessionIdFromRequest(req) {
  const access = parseMobileAccessToken(extractBearerToken(req));
  return String(access?.sessionId ?? '').trim().toLowerCase();
}

async function createMobileSessionSnapshot(store, userId, req) {
  const currentSessionId = resolveMobileSessionIdFromRequest(req);
  const index = await loadMobileSessionIndex(store, userId);
  const sessions = await Promise.all(
    index.map(async (entry) => {
      const sessionState = store.getRuntimeState ? await store.getRuntimeState(mobileSessionKey(entry.sessionId)) : null;
      const cached = sessionState?.stateValue ?? null;
      if (!cached || Number(cached.userId) !== Number(userId)) {
        return {
          ...entry,
          userAgent: null,
          ip: null,
          updatedAt: null,
          revokedAt: entry.revokedAt || null,
        };
      }
      return {
        ...entry,
        userAgent: cached.userAgent || null,
        ip: cached.ip || null,
        updatedAt: cached.updatedAt || null,
        revokedAt: cached.revokedAt || entry.revokedAt || null,
      };
    }),
  );
  sessions.sort((a, b) => {
    const aTs = String(a.lastSeenAt || a.updatedAt || a.createdAt || '');
    const bTs = String(b.lastSeenAt || b.updatedAt || b.createdAt || '');
    return bTs.localeCompare(aTs);
  });
  return sessions.map((entry) => ({
    sessionId: entry.sessionId,
    isCurrent: entry.sessionId === currentSessionId,
    isActive: !entry.revokedAt,
    createdAt: entry.createdAt || null,
    lastSeenAt: entry.lastSeenAt || null,
    updatedAt: entry.updatedAt || null,
    revokedAt: entry.revokedAt || null,
    ip: entry.ip || null,
    userAgent: entry.userAgent || null,
  }));
}

async function createMobileSessionTokens(store, userId, req) {
  const { accessTtlSeconds, refreshTtlSeconds } = getMobileTokenTtls();
  const sessionId = crypto.randomBytes(12).toString('hex');
  const accessToken = createMobileAccessToken(userId, sessionId);
  const refreshToken = createMobileRefreshToken(userId, sessionId);
  if (!accessToken || !refreshToken) return null;
  const nowIso = new Date().toISOString();
  const record = {
    userId: Number(userId),
    refreshTokenHash: hashSecret(refreshToken),
    createdAt: nowIso,
    updatedAt: nowIso,
    revokedAt: null,
    ip: String(req.socket?.remoteAddress ?? ''),
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 220),
    refreshExpiresAt: new Date(Date.now() + refreshTtlSeconds * 1000).toISOString(),
  };
  if (store.setRuntimeState) {
    await store.setRuntimeState(mobileSessionKey(sessionId), record);
  }
  await upsertMobileSessionIndex(store, userId, sessionId, { createdAt: nowIso, lastSeenAt: nowIso });
  const maxSessions = getMobileMaxSessionsPerUser();
  const revokedSessionIds = await revokeMobileOverflowSessions(store, userId, maxSessions, sessionId);
  return {
    accessToken,
    refreshToken,
    sessionId,
    revokedSessionIds,
    maxSessions,
    accessTtlSeconds,
    refreshTtlSeconds,
  };
}

async function resolveMobileAuthenticatedUserId(req, url, store) {
  const fromCompat = resolveCompatAuthUserId(req, url);
  const compatUserId = parseMobilePositiveUserId(fromCompat);
  if (compatUserId) return compatUserId;
  const parsedAccess = parseMobileAccessToken(extractBearerToken(req));
  if (!parsedAccess) return null;
  const sessionState = store.getRuntimeState ? await store.getRuntimeState(mobileSessionKey(parsedAccess.sessionId)) : null;
  const session = sessionState?.stateValue ?? null;
  if (!session || Number(session.userId) !== parsedAccess.userId || session.revokedAt) return null;
  return parsedAccess.userId;
}

function currentManualRefreshBucketUtc(nowTs = Date.now()) {
  const date = new Date(nowTs);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}`;
}

function secondsUntilNextUtcHour(nowTs = Date.now()) {
  const date = new Date(nowTs);
  const next = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours() + 1,
    0,
    0,
    0,
  );
  return Math.max(1, Math.ceil((next - nowTs) / 1000));
}

function appendApiLog(level, message) {
  const normalizedLevel = ['error', 'warn', 'info', 'debug'].includes(String(level ?? '').toLowerCase())
    ? String(level).toLowerCase()
    : 'info';
  const entry = {
    id: apiLogNextId++,
    ts: new Date().toISOString(),
    level: normalizedLevel,
    message: String(message ?? '').slice(0, 5000),
  };
  apiLogEntries.push(entry);
  if (apiLogEntries.length > API_LOG_BUFFER_MAX_ENTRIES) {
    apiLogEntries.splice(0, apiLogEntries.length - API_LOG_BUFFER_MAX_ENTRIES);
  }
  return entry;
}

function getApiBufferedLogs({ sinceId = null, limit = 120 } = {}) {
  const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 120));
  const safeSince = Number.isInteger(Number.parseInt(sinceId, 10)) ? Number.parseInt(sinceId, 10) : null;
  const items = safeSince === null
    ? apiLogEntries.slice(-safeLimit)
    : apiLogEntries.filter((entry) => entry.id > safeSince).slice(-safeLimit);
  return {
    items,
    nextId: apiLogNextId - 1,
    maxEntries: API_LOG_BUFFER_MAX_ENTRIES,
  };
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

function buildDefaultHunterConfig() {
  return {
    enabled: parseBooleanInput(process.env.SOON_HUNTER_ENABLED, true),
    mode: String(process.env.SOON_HUNTER_MODE ?? 'autonomy').trim().toLowerCase() || 'autonomy',
    cadenceMin: clampInt(process.env.SOON_HUNTER_CADENCE_MIN, 30, 1, 24 * 60),
    confidenceThreshold: Number(clamp01(process.env.SOON_HUNTER_CONFIDENCE_THRESHOLD, 0.75).toFixed(4)),
    minDealScore: Number(clamp01(process.env.SOON_HUNTER_MIN_DEAL_SCORE, 0.65).toFixed(4)),
    tokenPolicy: resolveAutomationTokenPolicyConfig(),
    ai: {
      enabled: parseBooleanInput(process.env.SOON_HUNTER_AI_ENABLED, true),
      model: String(process.env.SOON_HUNTER_AI_MODEL ?? '').trim() || null,
    },
  };
}

function normalizeHunterCustomConfig(rawConfig = {}) {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const normalized = {};

  if (source.enabled !== undefined) {
    normalized.enabled = parseBooleanInput(source.enabled, true);
  }
  if (source.mode !== undefined) {
    normalized.mode = String(source.mode).trim().toLowerCase() || 'autonomy';
  }
  if (source.cadenceMin !== undefined) {
    normalized.cadenceMin = clampInt(source.cadenceMin, 30, 1, 24 * 60);
  }
  if (source.confidenceThreshold !== undefined) {
    normalized.confidenceThreshold = Number(clamp01(source.confidenceThreshold, 0.75).toFixed(4));
  }
  if (source.minDealScore !== undefined) {
    normalized.minDealScore = Number(clamp01(source.minDealScore, 0.65).toFixed(4));
  }
  if (source.tokenPolicy !== undefined && source.tokenPolicy !== null) {
    normalized.tokenPolicy = resolveAutomationTokenPolicyConfig(source.tokenPolicy);
  }
  if (source.ai !== undefined && source.ai !== null && typeof source.ai === 'object') {
    normalized.ai = {
      enabled: parseBooleanInput(source.ai.enabled, true),
      model: String(source.ai.model ?? '').trim() || null,
    };
  }

  return normalized;
}

function buildHunterPresetOverride(preset) {
  const key = String(preset ?? '').trim().toLowerCase();
  switch (key) {
    case 'off':
      return { enabled: false };
    case 'safe':
      return { mode: 'autonomy', confidenceThreshold: 0.82, minDealScore: 0.74 };
    case 'balanced':
      return { mode: 'autonomy', confidenceThreshold: 0.75, minDealScore: 0.68 };
    case 'aggressive':
      return { mode: 'autonomy', confidenceThreshold: 0.64, minDealScore: 0.58 };
    case 'high_value_focus':
      return { mode: 'autonomy', confidenceThreshold: 0.8, minDealScore: 0.7 };
    case 'ai_max':
      return { ai: { enabled: true, model: 'gpt-5.4' }, confidenceThreshold: 0.78 };
    default:
      return { mode: 'autonomy' };
  }
}

function mergeHunterConfig(baseConfig, overrideConfig) {
  const base = baseConfig && typeof baseConfig === 'object' ? baseConfig : {};
  const override = overrideConfig && typeof overrideConfig === 'object' ? overrideConfig : {};
  return {
    ...base,
    ...override,
    tokenPolicy: override.tokenPolicy ?? base.tokenPolicy ?? resolveAutomationTokenPolicyConfig(),
    ai: {
      ...(base.ai ?? {}),
      ...(override.ai ?? {}),
    },
  };
}

async function buildHunterRuntimeRecommendation(store, effectiveConfig, { hours = 24 } = {}) {
  const nowMs = Date.now();
  const windowHours = Math.max(1, Number(hours) || 24);
  const minTs = nowMs - windowHours * 60 * 60 * 1000;
  const runs = store.listLatestAutomationRuns
    ? (await store.listLatestAutomationRuns(500)).filter((run) => {
        const ts = Date.parse(run?.startedAt ?? run?.finishedAt ?? '');
        return Number.isFinite(ts) && ts >= minTs;
      })
    : [];
  const decisions = runs.flatMap((run) => (Array.isArray(run?.decisions) ? run.decisions : []));
  const avgDecisionCount =
    runs.length > 0
      ? Number((runs.reduce((sum, run) => sum + Number(run?.decisionCount ?? 0), 0) / runs.length).toFixed(4))
      : 0;
  const avgConfidence =
    decisions.length > 0
      ? Number(
          (decisions.reduce((sum, decision) => sum + Number(decision?.confidence ?? 0), 0) / decisions.length).toFixed(4),
        )
      : 0;
  const purchaseAlerts = runs.reduce((sum, run) => sum + Number(run?.purchaseAlertCount ?? 0), 0);
  const technicalAlerts = runs.reduce((sum, run) => sum + Number(run?.technicalAlertCount ?? 0), 0);
  const totalAlerts = purchaseAlerts + technicalAlerts;
  const purchaseAlertShare = totalAlerts > 0 ? Number((purchaseAlerts / totalAlerts).toFixed(4)) : 0;

  let preset = 'safe';
  let confidence = 0.55;
  const reasons = [];

  if (runs.length < 3) {
    reasons.push('insufficient_samples_24h');
  } else if (avgDecisionCount >= 1.5 && avgConfidence >= 0.75 && purchaseAlertShare >= 0.6) {
    preset = 'aggressive';
    confidence = 0.86;
    reasons.push('strong_decision_density');
  } else if (avgDecisionCount >= 1 && avgConfidence >= 0.68) {
    preset = 'balanced';
    confidence = 0.78;
    reasons.push('stable_runtime_kpi');
  } else {
    preset = 'safe';
    confidence = 0.64;
    reasons.push('conservative_runtime_kpi');
  }

  return {
    windowHours,
    recommendation: {
      preset,
      confidence: Number(confidence.toFixed(4)),
      reasons,
      metrics: {
        runs: runs.length,
        decisions: decisions.length,
        avgDecisionCount,
        avgConfidence,
        purchaseAlertShare,
      },
    },
    autoApply: {
      enabled: effectiveConfig?.hunterAutoApplyRecommendation === true,
      minConfidence: Number(effectiveConfig?.hunterAutoApplyMinConfidence ?? 0.82),
      minRuns: Number(effectiveConfig?.hunterAutoApplyMinRuns ?? 3),
    },
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
  const startedAtMs = Date.now();

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

      if (method === 'GET' && pathname === '/api/auth/whoami') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        return sendJson(res, 200, {
          userId,
          adminId,
          isAdmin: Boolean(userId && adminId && userId === adminId),
          requestId: resolveCompatRequestId(req),
        });
      }

      if (method === 'GET' && pathname === '/api/status') {
        const trackings = await store.listTrackings();
        const schedulerState = store.getRuntimeState ? await store.getRuntimeState('scheduler_status') : null;
        const scheduler = schedulerState?.stateValue ?? {
          enabled: true,
          mode: 'compat',
          source: 'soon-runtime',
        };
        return sendJson(res, 200, {
          scheduler,
          products: trackings.length,
          trackings: trackings.length,
          uptime: Math.floor(process.uptime()),
        });
      }

      if (method === 'GET' && pathname === '/api/version') {
        const requestId = resolveCompatRequestId(req);
        return sendJson(res, 200, {
          version: String(process.env.npm_package_version || '0.1.0'),
          build: {
            sha: String(process.env.BUILD_SHA || process.env.GITHUB_SHA || '').trim() || null,
            at: String(process.env.BUILD_AT || '').trim() || null,
          },
          node: process.version,
          serverTime: new Date().toISOString(),
          uptime: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
          requestId,
        });
      }

      if (method === 'GET' && pathname === '/api/config') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const isAdmin = isCompatAdminUser(userId, adminId);
        const requestId = resolveCompatRequestId(req);
        return sendJson(res, 200, {
          associateTag: isAdmin ? String(process.env.AMAZON_ASSOCIATE_TAG || '').trim() : '',
          webAppUrl: String(process.env.PUBLIC_WEB_URL || '/index.html').trim() || '/index.html',
          webAppVersion: String(process.env.WEBAPP_VERSION || process.env.npm_package_version || 'dev'),
          telegramUserId: userId ? Number(userId) : null,
          webToken: createCompatWebToken(userId),
          adminPermissions: {
            isAdmin,
            actor: userId ? Number(userId) : null,
            adminId: adminId ? Number(adminId) : null,
            reason: null,
            at: null,
          },
          hostScope: {
            currentHost: String(req.headers.host || '').trim() || null,
            userAppHost: null,
            adminAppHost: null,
            isUserHost: false,
            isAdminHost: false,
          },
          webUiEdition: 'user',
          restart: {
            configured: false,
            allowed: false,
            adminChatId: null,
            audit: {
              status: 'disabled',
              actor: null,
              adminId: null,
              reason: null,
              at: null,
            },
          },
          requestId,
        });
      }

      if (method === 'GET' && pathname === '/api/launch-readiness') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const trackings = await store.listTrackings();
        const schedulerState = store.getRuntimeState ? await store.getRuntimeState('scheduler_status') : null;
        const metrics = schedulerState?.stateValue?.metrics ?? {};
        const blockers = [];
        if (trackings.length <= 0) blockers.push('no_trackings');
        if (Number(metrics?.lastErrors || 0) > 0) blockers.push('scan_last_errors_positive');
        const ready = blockers.length === 0;
        return sendJson(res, 200, {
          generatedAt: new Date().toISOString(),
          windowSec: clampInt(url.searchParams.get('windowSec'), 900, 60, 24 * 3600),
          ready,
          blockers,
          notes: ready ? ['launch_window_looks_stable'] : [],
          api: {
            samples: 0,
            p95Ms: 0,
            p99Ms: 0,
          },
          keepa: {
            capPerHour: clampInt(process.env.KEEPA_TOKEN_CAP_PER_HOUR, 0, 0, 1000000),
            spentLastHour: 0,
            spentLast24h: 0,
            guardrail: metrics?.lastTokenGuardrail ?? null,
          },
          scan: {
            lastRunAt: metrics?.lastRunAt ?? null,
            lastPlanned: Number(metrics?.lastPlanned || 0),
            lastScanned: Number(metrics?.lastScanned || 0),
            lastAlerts: Number(metrics?.lastAlerts || 0),
            lastErrors: Number(metrics?.lastErrors || 0),
            lastPriorityTier: metrics?.lastPriorityTier ?? null,
          },
          alerts: {
            sent24h: 0,
          },
          ai: {
            http429_24h: 0,
            http5xx_24h: 0,
          },
          requestId,
        });
      }

      if (method === 'GET' && pathname === '/api/ops/keepa-history-bootstrap') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }

        const sampleLimit = clampInt(url.searchParams.get('sampleLimit'), 8, 1, 50);
        const trackings = await store.listTrackings();
        const watchIndexState = store.getRuntimeState ? await store.getRuntimeState(KEEPA_WATCH_INDEX_STATE_KEY) : null;
        const watchIndex = watchIndexState?.stateValue ?? {};
        const byAsin = watchIndex?.byAsin && typeof watchIndex.byAsin === 'object' ? watchIndex.byAsin : {};

        const sample = [];
        let pending = 0;
        let ok = 0;
        for (const item of trackings) {
          const asin = String(item?.asin || '').trim().toUpperCase();
          if (!asin) continue;
          const state = byAsin[asin];
          const hasWatch = Boolean(state && (state.lastSeenAt || state.lastUpdatedAt || state.updatedAt));
          if (hasWatch) ok += 1;
          else pending += 1;
          if (sample.length < sampleLimit) {
            sample.push({
              asin,
              status: hasWatch ? 'ok' : 'missing',
              updatedAt: state?.lastSeenAt ?? state?.lastUpdatedAt ?? state?.updatedAt ?? null,
              lastSyncedAt: state?.lastSyncedAt ?? null,
            });
          }
        }

        const payload = {
          generatedAt: new Date().toISOString(),
          status: pending > 0 ? 'degraded' : 'healthy',
          backlog: {
            trackedWithoutHistory: pending,
            pending,
            error: 0,
            noData: 0,
            missingSync: pending,
            oldestOpenUpdatedAt: null,
          },
          global: {
            totalRows: trackings.length,
            pending,
            error: 0,
            noData: 0,
            ok,
            latestUpdatedAt: sample.find((row) => row.updatedAt)?.updatedAt ?? null,
          },
          sample,
          requestId,
        };
        return sendJson(res, 200, payload);
      }

      if (method === 'GET' && pathname === '/api/ops/metrics') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }

        const trackings = await store.listTrackings();
        const schedulerState = store.getRuntimeState ? await store.getRuntimeState('scheduler_status') : null;
        const keepaStatusState = store.getRuntimeState ? await store.getRuntimeState(KEEPA_STATUS_STATE_KEY) : null;
        const selfHealState = store.getRuntimeState ? await store.getRuntimeState('self_heal_runtime_state') : null;

        const memory = process.memoryUsage();
        return sendJson(res, 200, {
          generatedAt: new Date().toISOString(),
          scheduler: schedulerState?.stateValue ?? null,
          runtime: {
            node: process.version,
            uptimeSec: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
            pid: process.pid,
            host: os.hostname(),
            memoryMb: {
              rss: Number((memory.rss / 1024 / 1024).toFixed(2)),
              heapUsed: Number((memory.heapUsed / 1024 / 1024).toFixed(2)),
              heapTotal: Number((memory.heapTotal / 1024 / 1024).toFixed(2)),
            },
            cpu: {
              load1m: Number(os.loadavg()[0] || 0),
              cores: os.cpus().length,
            },
          },
          trackings: {
            total: trackings.length,
          },
          keepa: keepaStatusState?.stateValue ?? null,
          ai: {
            requestsTotal: 0,
            fallbacksTotal: 0,
            fallbackRatePct: 0,
            requests24h: 0,
            fallbacks24h: 0,
            fallbackRate24hPct: 0,
          },
          selfHeal: selfHealState?.stateValue ?? null,
          requestId,
        });
      }

      if (method === 'GET' && pathname === '/api/system-health') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        const isAdmin = isCompatAdminUser(userId, adminId);
        const base = {
          status: 'ok',
          generatedAt: new Date().toISOString(),
          requestId,
        };
        if (!isAdmin) {
          return sendJson(res, 200, base);
        }
        const schedulerState = store.getRuntimeState ? await store.getRuntimeState('scheduler_status') : null;
        const trackings = await store.listTrackings();
        return sendJson(res, 200, {
          ...base,
          modules: modulesList(),
          uptimeSec: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
          storage: store.mode,
          trackings: trackings.length,
          scheduler: schedulerState?.stateValue ?? null,
          operationalReadiness: {
            ready: true,
            reasons: [],
          },
        });
      }

      if (method === 'GET' && pathname === '/api/system-health/history') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const historyState = store.getRuntimeState ? await store.getRuntimeState(SYSTEM_STATS_HISTORY_STATE_KEY) : null;
        const rows = sanitizeSystemStatsHistory(historyState?.stateValue ?? []).map((entry) => ({
          ts: entry.capturedAt,
          cpu: Number(entry?.cpu?.load1m || 0),
          memory: Number(entry?.memory?.rssMb || 0),
          temperature: null,
          power: null,
        }));
        return sendJson(res, 200, {
          rows,
          count: rows.length,
        });
      }

      if (method === 'GET' && pathname === '/api/system-stats') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const payload = createSystemStatsSample(startedAtMs);
        await appendSystemStatsHistory(store, payload);
        return sendJson(res, 200, payload);
      }

      if (method === 'GET' && pathname === '/api/system-stats/history') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const range = normalizeSystemStatsRange(url.searchParams.get('range'));
        const historyState = store.getRuntimeState ? await store.getRuntimeState(SYSTEM_STATS_HISTORY_STATE_KEY) : null;
        const history = sanitizeSystemStatsHistory(historyState?.stateValue ?? []);
        const hours = systemStatsRangeHours(range);
        const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
        const points = history.filter((entry) => Date.parse(String(entry.capturedAt)) >= cutoffMs);
        return sendJson(res, 200, {
          range,
          hours,
          count: points.length,
          totalCount: history.length,
          lastSampleAt: points[points.length - 1]?.capturedAt ?? history[history.length - 1]?.capturedAt ?? null,
          points,
        });
      }

      if (method === 'POST' && pathname === '/api/session/refresh') {
        const userId = resolveCompatAuthUserId(req, url);
        if (!userId) {
          return sendJson(res, 401, {
            error: 'Unauthorized',
            requestId: resolveCompatRequestId(req),
          });
        }
        const webToken = createCompatWebToken(userId);
        return sendJson(res, 200, {
          ok: true,
          userId,
          webToken,
          requestId: resolveCompatRequestId(req),
        });
      }

      if (method === 'POST' && pathname === '/api/mobile/v1/auth/telegram') {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const issued = await createMobileSessionTokens(store, userId, req);
        if (!issued) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const adminId = resolveCompatAdminId();
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          tokenType: 'Bearer',
          accessToken: issued.accessToken,
          refreshToken: issued.refreshToken,
          expiresIn: issued.accessTtlSeconds,
          refreshExpiresIn: issued.refreshTtlSeconds,
          userId,
          isAdmin: Boolean(adminId && String(adminId) === String(userId)),
          maxSessionsPerUser: issued.maxSessions,
          revokedSessionIds: issued.revokedSessionIds,
        });
      }

      if (method === 'POST' && pathname === '/api/mobile/v1/auth/refresh') {
        const requestId = resolveCompatRequestId(req);
        const body = await readJsonBody(req).catch(() => ({}));
        const supplied = String(body?.refreshToken || extractBearerToken(req) || '').trim();
        const parsed = parseMobileRefreshToken(supplied);
        if (!parsed) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const sessionState = store.getRuntimeState ? await store.getRuntimeState(mobileSessionKey(parsed.sessionId)) : null;
        const session = sessionState?.stateValue ?? null;
        if (!session || Number(session.userId) !== Number(parsed.userId) || session.revokedAt) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        if (!secretsEqual(String(session.refreshTokenHash || ''), hashSecret(supplied))) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const { accessTtlSeconds, refreshTtlSeconds } = getMobileTokenTtls();
        const accessToken = createMobileAccessToken(parsed.userId, parsed.sessionId);
        const refreshToken = createMobileRefreshToken(parsed.userId, parsed.sessionId);
        if (!accessToken || !refreshToken) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        if (store.setRuntimeState) {
          await store.setRuntimeState(mobileSessionKey(parsed.sessionId), {
            ...session,
            refreshTokenHash: hashSecret(refreshToken),
            updatedAt: new Date().toISOString(),
            refreshExpiresAt: new Date(Date.now() + refreshTtlSeconds * 1000).toISOString(),
          });
        }
        await upsertMobileSessionIndex(store, parsed.userId, parsed.sessionId, {
          lastSeenAt: new Date().toISOString(),
        });
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          tokenType: 'Bearer',
          accessToken,
          refreshToken,
          expiresIn: accessTtlSeconds,
          refreshExpiresIn: refreshTtlSeconds,
        });
      }

      if (method === 'GET' && pathname === '/api/mobile/v1/session') {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const adminId = resolveCompatAdminId();
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          userId,
          isAdmin: Boolean(adminId && String(adminId) === String(userId)),
          serverTime: new Date().toISOString(),
        });
      }

      if (method === 'GET' && pathname === '/api/mobile/v1/dashboard') {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const rawTrackings = await store.listTrackings();
        const items = await Promise.all(rawTrackings.map((item) => hydrateMobileTrackingItem(store, userId, item)));
        const topDrop = items.length
          ? [...items].sort((a, b) => Number(b.dropPct || 0) - Number(a.dropPct || 0))[0]
          : null;
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          summary: {
            trackedProducts: items.length,
            avgDropPct:
              items.length > 0
                ? Number((items.reduce((sum, item) => sum + Number(item.dropPct || 0), 0) / items.length).toFixed(2))
                : 0,
          },
          topDrop: topDrop
            ? {
                asin: topDrop.asin,
                title: topDrop.title,
                dropPct: topDrop.dropPct,
                bestPrice: topDrop.bestPrice,
                avgPrice: topDrop.avgPrice,
              }
            : null,
          trackedProducts: items.length,
        });
      }

      if (method === 'GET' && pathname === '/api/mobile/v1/trackings') {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const { limit, offset } = normalizeMobilePagination(url);
        const rawTrackings = await store.listTrackings();
        const mapped = await Promise.all(rawTrackings.map((item) => hydrateMobileTrackingItem(store, userId, item)));
        const items = mapped.slice(offset, offset + limit);
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          pagination: { limit, offset, count: items.length },
          items,
        });
      }

      if (method === 'GET' && pathname === '/api/mobile/v1/deals') {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const includeSuspicious = parseBooleanInput(url.searchParams.get('includeSuspicious'), false);
        const { limit, offset } = normalizeMobilePagination(url);
        const rawTrackings = await store.listTrackings();
        const mapped = await Promise.all(rawTrackings.map((item) => hydrateMobileTrackingItem(store, userId, item)));
        const sorted = mapped.sort((a, b) => Number(b.dropPct || 0) - Number(a.dropPct || 0));
        const items = sorted.slice(offset, offset + limit).map((item, idx) => ({
          id: `${item.asin}-${offset + idx + 1}`,
          asin: item.asin,
          alertType: 'drop_detected',
          title: item.title,
          imageUrl: item.imageUrl,
          details: null,
          bestPrice: item.bestPrice,
          avgPrice: item.avgPrice,
          dealScore: item.dealScore,
          rating: item.rating,
          reviews: item.reviews,
          marketPrices: item.marketPrices,
          createdAt: item.lastChecked || new Date().toISOString(),
          isSuspiciousPrice: false,
          suspiciousReasons: [],
          priceTrend: item.priceTrend,
        }));
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          pagination: { limit, offset, count: items.length },
          filters: {
            includeSuspicious,
            filteredSuspiciousCount: 0,
          },
          items,
        });
      }

      const mobileDetailMatch = pathname.match(/^\/api\/mobile\/v1\/products\/([^/]+)\/detail$/);
      if (method === 'GET' && mobileDetailMatch) {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const asin = decodeURIComponent(mobileDetailMatch[1]).trim().toUpperCase();
        const detail = await store.getProductDetail(asin);
        if (!detail) {
          return sendJson(res, 404, { error: 'not_found', asin });
        }
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          ...detail,
        });
      }

      const mobilePreferencesMatch = pathname.match(/^\/api\/mobile\/v1\/trackings\/([^/]+)\/preferences$/);
      if (method === 'POST' && mobilePreferencesMatch) {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        if (!store.updateThresholds) {
          return sendJson(res, 501, { error: 'not_implemented', requestId });
        }
        const asin = decodeURIComponent(mobilePreferencesMatch[1]).trim().toUpperCase();
        if (!asin) {
          return sendJson(res, 400, { error: 'invalid_asin', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const targetPrice = parseNullablePriceValue(body?.targetPrice);
        const targetPriceUsed = parseNullablePriceValue(body?.targetPriceUsed);
        if (Number.isNaN(targetPrice) || Number.isNaN(targetPriceUsed)) {
          return sendJson(res, 400, { error: 'Invalid target prices', requestId });
        }
        let existing = store.getTracking ? await store.getTracking(asin) : null;
        if (!existing && store.saveTracking) {
          await store.saveTracking({ asin });
          existing = store.getTracking ? await store.getTracking(asin) : null;
        }
        if (!existing) {
          return sendJson(res, 404, { error: 'not_found', asin, requestId });
        }
        const thresholdDropPct =
          body?.alertDropPct === undefined ? undefined : clampInt(body.alertDropPct, existing.thresholdDropPct ?? 10, 1, 90);
        await store.updateThresholds(asin, {
          thresholdDropPct,
          targetPriceNew: targetPrice,
          targetPriceUsed,
        });
        const preferenceState = {
          enabledDomains: Array.isArray(body?.enabledDomains) ? body.enabledDomains : null,
          scanInterval: Number.isFinite(Number(body?.scanInterval)) ? Number(body.scanInterval) : null,
          sizeType: body?.sizeType ?? null,
          sizeValue: body?.sizeValue ?? null,
          sizeSystem: body?.sizeSystem ?? null,
          updatedAt: new Date().toISOString(),
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(mobileTrackingPreferencesKey(userId, asin), preferenceState);
        }
        const refreshed = store.getTracking ? await store.getTracking(asin) : null;
        const hydrated = refreshed ? await hydrateMobileTrackingItem(store, userId, refreshed) : null;
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          ok: true,
          item: hydrated,
        });
      }

      const mobileSnoozeMatch = pathname.match(/^\/api\/mobile\/v1\/trackings\/([^/]+)\/snooze$/);
      if ((method === 'POST' || method === 'DELETE') && mobileSnoozeMatch) {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const asin = decodeURIComponent(mobileSnoozeMatch[1]).trim().toUpperCase();
        if (!asin) {
          return sendJson(res, 400, { error: 'invalid_asin', requestId });
        }
        const tracking = store.getTracking ? await store.getTracking(asin) : null;
        if (!tracking) {
          return sendJson(res, 404, { error: 'not_found', asin, requestId });
        }
        const snoozeKey = buildTrackingSnoozeStateKey(userId, asin);
        if (method === 'DELETE') {
          if (store.setRuntimeState) {
            await store.setRuntimeState(snoozeKey, null);
          }
          const hydrated = await hydrateMobileTrackingItem(store, userId, tracking);
          return sendJson(res, 200, {
            apiVersion: MOBILE_API_VERSION,
            ok: true,
            item: hydrated,
          });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const days = clampInt(body?.days, 7, 1, 90);
        const nowMs = Date.now();
        const until = new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();
        const state = {
          asin,
          chatId: String(userId),
          days,
          from: new Date(nowMs).toISOString(),
          until,
          reason: 'mobile_manual',
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(snoozeKey, state);
        }
        const hydrated = await hydrateMobileTrackingItem(store, userId, tracking);
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          ok: true,
          days,
          item: hydrated,
        });
      }

      const mobileDeleteTrackingMatch = pathname.match(/^\/api\/mobile\/v1\/trackings\/([^/]+)$/);
      if (method === 'DELETE' && mobileDeleteTrackingMatch) {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        if (!store.deleteTracking) {
          return sendJson(res, 501, { error: 'not_implemented', requestId });
        }
        const asin = decodeURIComponent(mobileDeleteTrackingMatch[1]).trim().toUpperCase();
        if (!asin) {
          return sendJson(res, 400, { error: 'invalid_asin', requestId });
        }
        const deleted = await store.deleteTracking(asin);
        if (store.setRuntimeState) {
          await store.setRuntimeState(buildTrackingSnoozeStateKey(userId, asin), null);
          await store.setRuntimeState(mobileTrackingPreferencesKey(userId, asin), null);
        }
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          ok: true,
          deleted: deleted?.deleted ? 1 : 0,
        });
      }

      if (method === 'GET' && pathname === '/api/mobile/v1/web-deals/history') {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const limit = clampInt(url.searchParams.get('limit'), 120, 1, 300);
        const source = String(url.searchParams.get('source') ?? '').trim().toLowerCase();
        const historyState = store.getRuntimeState
          ? await store.getRuntimeState(MOBILE_WEB_DEALS_HISTORY_STATE_KEY)
          : null;
        const allRows = Array.isArray(historyState?.stateValue) ? historyState.stateValue : [];
        const filtered = allRows.filter((row) =>
          source ? String(row?.sourceId ?? '').trim().toLowerCase() === source : true,
        );
        const rows = filtered
          .slice()
          .sort((a, b) => String(b?.sentAt ?? '').localeCompare(String(a?.sentAt ?? '')))
          .slice(0, limit);
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          rows,
          meta: {
            sourceId: source || 'all',
            limit,
            total: rows.length,
            generatedAt: new Date().toISOString(),
          },
        });
      }

      if (method === 'POST' && pathname === '/api/mobile/v1/auth/logout') {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const sessionId = resolveMobileSessionIdFromRequest(req);
        if (sessionId) {
          await revokeMobileSessionById(store, userId, sessionId);
        }
        return sendJson(res, 200, { apiVersion: MOBILE_API_VERSION, ok: true });
      }

      if (method === 'POST' && pathname === '/api/mobile/v1/auth/logout-all') {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const includeCurrent = parseBooleanInput(body?.includeCurrent, false);
        const currentSessionId = resolveMobileSessionIdFromRequest(req);
        const index = await loadMobileSessionIndex(store, userId);
        let revokedCount = 0;
        for (const entry of index) {
          if (entry.revokedAt) continue;
          if (!includeCurrent && entry.sessionId === currentSessionId) continue;
          const revoked = await revokeMobileSessionById(store, userId, entry.sessionId);
          if (revoked) revokedCount += 1;
        }
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          ok: true,
          revokedCount,
        });
      }

      if (method === 'GET' && pathname === '/api/mobile/v1/auth/sessions') {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const items = await createMobileSessionSnapshot(store, userId, req);
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          maxSessionsPerUser: getMobileMaxSessionsPerUser(),
          items,
        });
      }

      if (method === 'POST' && pathname === '/api/mobile/v1/auth/sessions/revoke') {
        const requestId = resolveCompatRequestId(req);
        const userId = await resolveMobileAuthenticatedUserId(req, url, store);
        if (!userId) {
          return sendJson(res, 401, { error: 'Unauthorized', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const sessionId = String(body?.sessionId || '').trim().toLowerCase();
        if (!sessionId) {
          return sendJson(res, 400, { error: 'sessionId required', requestId });
        }
        const revoked = await revokeMobileSessionById(store, userId, sessionId);
        return sendJson(res, 200, {
          apiVersion: MOBILE_API_VERSION,
          ok: revoked,
        });
      }

      if (method === 'GET' && pathname === '/api/sessions/now') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'forbidden', requestId });
        }
        return sendJson(res, 200, {
          status: 'ok',
          summary: {
            activeSessions: 1,
            revokedSessions: 0,
          },
          guard: {
            active: false,
            reason: null,
            updatedAt: null,
          },
          adminId,
          requestId,
        });
      }

      if (method === 'POST' && pathname === '/api/sessions/logout-others') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'forbidden', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const keepCurrent = body?.keepCurrent !== false;
        const keepClientSessionId = String(req.headers['x-client-session-id'] ?? '').trim();
        return sendJson(res, 200, {
          ok: true,
          keepCurrent,
          keepClientSessionIdSet: Boolean(keepCurrent && keepClientSessionId),
          keepFingerprintSet: false,
          guard: {
            active: true,
            reason: 'admin_panic_logout_others',
            updatedAt: new Date().toISOString(),
          },
          requestId,
        });
      }

      if (method === 'GET' && pathname === '/api/logs') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'forbidden', requestId: resolveCompatRequestId(req) });
        }
        if (apiLogEntries.length === 0) {
          appendApiLog('info', '[soon-api] log buffer initialized');
        }
        appendApiLog('info', `[soon-api] /api/logs polled by admin=${adminId}`);
        const limit = Number.parseInt(String(url.searchParams.get('limit') ?? '120'), 10);
        const sinceId = Number.parseInt(String(url.searchParams.get('sinceId') ?? ''), 10);
        const payload = getApiBufferedLogs({
          limit: Number.isFinite(limit) ? limit : 120,
          sinceId: Number.isFinite(sinceId) ? sinceId : null,
        });
        return sendJson(res, 200, payload);
      }

      if (method === 'POST' && pathname === '/admin-api/trackings/deactivate-all') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'forbidden', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        if (body?.confirm !== true) {
          return sendJson(res, 400, { error: 'confirm must be true', requestId });
        }
        if (!store.deactivateAllTrackingsGlobal) {
          return sendJson(res, 501, { error: 'not_implemented', requestId });
        }
        const result = await store.deactivateAllTrackingsGlobal();
        return sendJson(res, 200, {
          success: true,
          action: 'global_trackings_deactivate',
          ...result,
          executedBy: adminId,
          executedAt: new Date().toISOString(),
          requestId,
        });
      }

      if (method === 'POST' && pathname === '/admin-api/trackings/activate-all') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'forbidden', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        if (body?.confirm !== true) {
          return sendJson(res, 400, { error: 'confirm must be true', requestId });
        }
        if (!store.activateAllTrackingsGlobal) {
          return sendJson(res, 501, { error: 'not_implemented', requestId });
        }
        const result = await store.activateAllTrackingsGlobal();
        return sendJson(res, 200, {
          success: true,
          action: 'global_trackings_activate',
          ...result,
          executedBy: adminId,
          executedAt: new Date().toISOString(),
          requestId,
        });
      }

      if (method === 'POST' && pathname === '/admin-api/trackings/deactivate-domains') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'forbidden', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        if (body?.confirm !== true) {
          return sendJson(res, 400, { error: 'confirm must be true', requestId });
        }
        if (!store.deactivateTrackingsDomainsGlobal) {
          return sendJson(res, 501, { error: 'not_implemented', requestId });
        }
        const domainsInput = Array.isArray(body?.domains) ? body.domains : [];
        const result = await store.deactivateTrackingsDomainsGlobal(domainsInput);
        if (!Array.isArray(result?.domains) || !result.domains.length) {
          return sendJson(res, 400, {
            error: 'domains must include at least one of: de,it,fr,es,uk,nl',
            requestId,
          });
        }
        return sendJson(res, 200, {
          success: true,
          action: 'global_trackings_deactivate_domains',
          ...result,
          executedBy: adminId,
          executedAt: new Date().toISOString(),
          requestId,
        });
      }

      if (method === 'POST' && pathname === '/admin-api/trackings/activate-domains') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'forbidden', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        if (body?.confirm !== true) {
          return sendJson(res, 400, { error: 'confirm must be true', requestId });
        }
        if (!store.activateTrackingsDomainsGlobal) {
          return sendJson(res, 501, { error: 'not_implemented', requestId });
        }
        const domainsInput = Array.isArray(body?.domains) ? body.domains : [];
        const result = await store.activateTrackingsDomainsGlobal(domainsInput);
        if (!Array.isArray(result?.domains) || !result.domains.length) {
          return sendJson(res, 400, {
            error: 'domains must include at least one of: de,it,fr,es,uk,nl',
            requestId,
          });
        }
        return sendJson(res, 200, {
          success: true,
          action: 'global_trackings_activate_domains',
          ...result,
          executedBy: adminId,
          executedAt: new Date().toISOString(),
          requestId,
        });
      }

      if (method === 'DELETE' && pathname === '/admin-api/data/products-global') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'forbidden', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const confirmText = String(body?.confirmText ?? '').trim();
        if (confirmText !== 'DELETE_ALL_PRODUCTS') {
          return sendJson(res, 400, { error: 'confirmText must be DELETE_ALL_PRODUCTS', requestId });
        }
        const mode = String(body?.mode ?? 'catalog_keep_alert_history').trim().toLowerCase();
        if (!['catalog_keep_alert_history', 'catalog_with_alert_history'].includes(mode)) {
          return sendJson(res, 400, { error: 'Invalid mode', requestId });
        }
        if (!store.deleteAllCatalogDataGlobal) {
          return sendJson(res, 501, { error: 'not_implemented', requestId });
        }
        const purgeAlertHistory = mode === 'catalog_with_alert_history';
        const deleted = await store.deleteAllCatalogDataGlobal({ purgeAlertHistory });
        return sendJson(res, 200, {
          success: true,
          mode,
          deleted,
          action: 'global_catalog_delete',
          executedBy: adminId,
          executedAt: new Date().toISOString(),
          requestId,
        });
      }

      const adminDeleteSingleMatch = pathname.match(/^\/admin-api\/data\/products\/([^/]+)$/);
      if (method === 'DELETE' && adminDeleteSingleMatch) {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'forbidden', requestId });
        }
        const asin = decodeURIComponent(adminDeleteSingleMatch[1]).trim().toUpperCase();
        if (!asin) {
          return sendJson(res, 400, { error: 'invalid_asin', requestId });
        }
        if (!store.deleteCatalogProductGlobal) {
          return sendJson(res, 501, { error: 'not_implemented', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const purgeAlertHistory = body?.purgeAlertHistory === true || url.searchParams.get('purgeAlertHistory') === '1';
        const deleted = await store.deleteCatalogProductGlobal(asin, { purgeAlertHistory });
        return sendJson(res, 200, {
          success: true,
          asin,
          mode: purgeAlertHistory ? 'product_with_alert_history' : 'product_keep_alert_history',
          deleted,
          action: 'global_catalog_delete_single',
          executedBy: adminId,
          executedAt: new Date().toISOString(),
          requestId,
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

      if (method === 'POST' && pathname === '/api/add-product') {
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

      const trackingDropPctMatch = pathname.match(/^\/api\/trackings\/([^/]+)\/([^/]+)\/drop-pct$/);
      if (method === 'POST' && trackingDropPctMatch) {
        const chatId = normalizeChatId(trackingDropPctMatch[1]);
        const asin = decodeURIComponent(trackingDropPctMatch[2]).toUpperCase();
        const detail = await store.getProductDetail(asin);
        if (!detail) {
          return sendJson(res, 404, { error: 'not_found', asin, chatId });
        }

        const body = await readJsonBody(req).catch(() => ({}));
        const dropPct = clampInt(body.dropPct ?? body.thresholdDropPct ?? body.value ?? 10, 10, 1, 95);
        const updated = await store.updateThresholds(asin, {
          thresholdDropPct: dropPct,
        });
        if (!updated) {
          return sendJson(res, 404, { error: 'not_found', asin, chatId });
        }
        return sendJson(res, 200, {
          status: 'updated',
          chatId,
          asin,
          dropPct,
          thresholdDropPct: updated.thresholds?.thresholdDropPct ?? dropPct,
        });
      }

      const trackingsListMatch = pathname.match(/^\/api\/trackings\/([^/]+)$/);
      if (method === 'GET' && trackingsListMatch) {
        const chatId = normalizeChatId(trackingsListMatch[1]);
        const items = await store.listTrackings();
        const rows = items.map((item) => ({
          ...item,
          last_checked: null,
          chat_id: chatId,
        }));
        return sendJson(res, 200, rows);
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
        const jobId = crypto.randomUUID();
        const payload = {
          status: 'queued',
          chatId,
          jobId,
          requestedAt: nowIso,
          processedAt: nowIso,
          total: items.length,
        };
        refreshAllJobs.set(jobId, payload);
        return sendJson(res, 200, {
          ...payload,
        });
      }

      const refreshAllStatusMatch = pathname.match(/^\/api\/refresh-all\/([^/]+)\/status\/([^/]+)$/);
      if (method === 'GET' && refreshAllStatusMatch) {
        const chatId = normalizeChatId(refreshAllStatusMatch[1]);
        const jobId = decodeURIComponent(refreshAllStatusMatch[2]);
        const job = refreshAllJobs.get(jobId);
        if (!job || job.chatId !== chatId) {
          return sendJson(res, 404, {
            error: 'not_found',
            chatId,
            jobId,
          });
        }
        return sendJson(res, 200, {
          status: 'completed',
          chatId,
          jobId,
          requestedAt: job.requestedAt,
          finishedAt: job.processedAt,
          total: job.total,
          refreshed: job.total,
          pending: 0,
        });
      }

      const refreshBudgetMatch = pathname.match(/^\/api\/refresh-budget\/([^/]+)$/);
      if (method === 'GET' && refreshBudgetMatch) {
        const chatId = normalizeChatId(refreshBudgetMatch[1]);
        const adminId = resolveCompatAdminId();
        if (!adminId || chatId !== adminId) {
          return sendJson(res, 200, {
            restricted: true,
            reason: 'free_plan_no_manual_refresh',
          });
        }
        const nowTs = Date.now();
        const budget = clampInt(process.env.SOON_MANUAL_REFRESH_BUDGET_PER_HOUR, 50, 1, 100000);
        const used = 0;
        const remaining = Math.max(0, budget - used);
        return sendJson(res, 200, {
          budget,
          used,
          remaining,
          retryInSec: secondsUntilNextUtcHour(nowTs),
          bucket: currentManualRefreshBucketUtc(nowTs),
        });
      }

      if (method === 'GET' && pathname === '/api/scan-kpi') {
        const trackings = await store.listTrackings();
        const schedulerState = store.getRuntimeState ? await store.getRuntimeState('scheduler_status') : null;
        const keepaStatusState = store.getRuntimeState ? await store.getRuntimeState(KEEPA_STATUS_STATE_KEY) : null;
        const scheduler = schedulerState?.stateValue ?? {};
        const metrics = scheduler.metrics ?? {};
        const keepa = keepaStatusState?.stateValue ?? {};
        const budget = clampInt(process.env.SOON_SCAN_HARD_TOKEN_CAP_PER_CYCLE, 120, 1, 100000);
        const avgTokenPerAsin = clampInt(process.env.SOON_SCAN_EST_TOKEN_PER_ITEM, 1, 1, 100);
        const maxByBudget = Math.max(0, Math.floor(budget / Math.max(1, avgTokenPerAsin)));
        const planned = Math.min(trackings.length, maxByBudget);

        return sendJson(res, 200, {
          trackedCount: trackings.length,
          dueCount: trackings.length,
          planner: {
            budget,
            avgTokenPerAsin,
            planned,
            skippedBudget: Math.max(0, trackings.length - planned),
            estimatedTokens: planned * avgTokenPerAsin,
          },
          tokens: {
            tokensLeft: Number(keepa?.tokensLeft || keepa?.remaining || 0),
            refillRate: Number(keepa?.refillRate || 20),
            refillIn: Number(keepa?.refillIn || 0),
            tokensConsumed: Number(keepa?.tokensConsumed || keepa?.consumed || 0),
          },
          scan: metrics,
          scheduler: {
            isScanning: Boolean(scheduler?.isScanning),
            lastScanAt: scheduler?.lastScanAt ?? metrics?.lastRunAt ?? null,
            intervalMinutes: Number(scheduler?.checkIntervalMinutes || 60),
          },
        });
      }

      const scanPlanMatch = pathname.match(/^\/api\/scan-plan\/([^/]+)$/);
      if (method === 'GET' && scanPlanMatch) {
        const chatId = normalizeChatId(scanPlanMatch[1]);
        const requestedBudget = clampInt(url.searchParams.get('budget'), 0, 0, 100000);
        const trackings = await store.listTrackings();
        const budget = requestedBudget > 0
          ? requestedBudget
          : clampInt(process.env.SOON_SCAN_HARD_TOKEN_CAP_PER_CYCLE, 120, 1, 100000);
        const avgTokenPerAsin = clampInt(process.env.SOON_SCAN_EST_TOKEN_PER_ITEM, 1, 1, 100);
        const payload = buildCompatScanPlanPayload(trackings, budget, avgTokenPerAsin);
        return sendJson(res, 200, {
          chatId,
          ...payload,
        });
      }

      const tagsMatch = pathname.match(/^\/api\/tags\/([^/]+)$/);
      if (method === 'GET' && tagsMatch) {
        const chatId = normalizeChatId(tagsMatch[1]);
        const trackings = await store.listTrackings();
        const rows = buildTagRows(trackings, chatId);
        return sendJson(res, 200, rows);
      }

      const categoriesMatch = pathname.match(/^\/api\/categories\/([^/]+)$/);
      if (method === 'GET' && categoriesMatch) {
        const chatId = normalizeChatId(categoriesMatch[1]);
        const trackings = await store.listTrackings();
        const rows = buildCategoryRows(trackings, chatId);
        return sendJson(res, 200, rows);
      }

      const stockMatch = pathname.match(/^\/api\/stock\/([^/]+)$/);
      if (method === 'GET' && stockMatch) {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const asin = decodeURIComponent(stockMatch[1]).toUpperCase();
        if (!asin) return sendJson(res, 400, { error: 'asin_required', requestId });

        const detail = await store.getProductDetail(asin);
        if (!detail) {
          return sendJson(res, 200, { out_of_stock: false, last_in_stock_at: null, asin });
        }
        return sendJson(res, 200, {
          asin,
          out_of_stock: false,
          last_in_stock_at: detail?.updatedAt ?? null,
        });
      }

      const buyboxMatch = pathname.match(/^\/api\/buybox\/([^/]+)$/);
      if (method === 'GET' && buyboxMatch) {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const asin = decodeURIComponent(buyboxMatch[1]).toUpperCase();
        if (!asin) return sendJson(res, 400, { error: 'asin_required', requestId });

        const detail = await store.getProductDetail(asin);
        if (!detail) {
          return sendJson(res, 200, []);
        }

        const pricesNew = detail?.pricesNew && typeof detail.pricesNew === 'object' ? detail.pricesNew : {};
        const bestPrice = Object.values(pricesNew)
          .map((value) => toFiniteNumber(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .sort((a, b) => a - b)[0] ?? null;
        const buyboxSeller = detail?.buyboxSeller ?? null;
        const buyboxIsAmazon = detail?.buyboxIsAmazon === true;
        const hasSignal = buyboxSeller !== null || detail?.buyboxIsAmazon !== undefined || bestPrice !== null;

        const rows = hasSignal
          ? [{
              asin,
              domain: 'de',
              seller: buyboxSeller ?? (buyboxIsAmazon ? 'Amazon' : null),
              is_amazon: buyboxIsAmazon,
              price: bestPrice,
              recorded_at: detail?.updatedAt ?? new Date().toISOString(),
            }]
          : [];
        return sendJson(res, 200, rows);
      }

      const heatmapMatch = pathname.match(/^\/api\/heatmap\/([^/]+)$/);
      if (method === 'GET' && heatmapMatch) {
        const asin = decodeURIComponent(heatmapMatch[1]).toUpperCase();
        if (!asin) return sendJson(res, 400, { error: 'asin_required' });

        const days = clampInt(url.searchParams.get('days'), 1095, 1, 1095);
        const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

        let rows = [];
        if (store.getPriceHistory) {
          const historyRows = await store.getPriceHistory(asin, 1000);
          if (Array.isArray(historyRows)) {
            rows = historyRows;
          }
        }
        if (!rows.length) {
          const detail = await store.getProductDetail(asin);
          if (detail) {
            rows = (Array.isArray(detail.historyPoints) ? detail.historyPoints : []).map((row) => ({
              ts: row?.ts ?? null,
              price: row?.value ?? null,
              market: 'de',
              condition: 'new',
              currency: 'EUR',
            }));
          }
        }

        const payload = rows
          .map((row) => {
            const ts = row?.ts ? Date.parse(String(row.ts)) : NaN;
            const price = toFiniteNumber(row?.price ?? row?.value);
            if (!Number.isFinite(ts) || !Number.isFinite(price) || price <= 0) return null;
            if (ts < sinceMs) return null;
            return {
              ts: new Date(ts).toISOString(),
              market: String(row?.market ?? 'de').toLowerCase() || 'de',
              condition: String(row?.condition ?? 'new').toLowerCase() || 'new',
              price: Number(price.toFixed(2)),
              currency: String(row?.currency ?? 'EUR').toUpperCase() || 'EUR',
            };
          })
          .filter(Boolean)
          .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

        return sendJson(res, 200, payload);
      }

      const statsMatch = pathname.match(/^\/api\/stats\/([^/]+)$/);
      if (method === 'GET' && statsMatch) {
        const chatId = normalizeChatId(statsMatch[1]);
        const trackings = await store.listTrackings();
        const schedulerState = store.getRuntimeState ? await store.getRuntimeState('scheduler_status') : null;
        const metrics = schedulerState?.stateValue?.metrics ?? {};
        const stats = buildUserStatsPayload(trackings, chatId, metrics);
        return sendJson(res, 200, stats);
      }

      if (method === 'GET' && pathname === '/api/price-errors') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }

        const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200);
        const scope = String(url.searchParams.get('scope') ?? 'tracked').trim().toLowerCase();
        const trackedOnly = scope !== 'global';
        const trackings = await store.listTrackings();
        const sourceRows = buildCompatPriceErrorRows(trackings, trackedOnly ? limit : Math.max(limit, 200));
        const rows = sourceRows.slice(0, limit);

        const runtimeRulesState = store.getRuntimeState
          ? await store.getRuntimeState(PRICE_ERROR_REALERT_RULES_STATE_KEY)
          : null;
        const runtimeRules =
          runtimeRulesState?.stateValue && typeof runtimeRulesState.stateValue === 'object'
            ? runtimeRulesState.stateValue
            : {};
        const decorated = rows.map((row) => {
          const key = buildPriceErrorRealertRuleKey(userId, row.asin, row.domain);
          const rule = runtimeRules[key];
          if (!rule || typeof rule !== 'object') return row;
          return {
            ...row,
            relert_drop_percent: toFiniteNumber(rule.dropPercent),
            relert_target_price: toFiniteNumber(rule.targetPrice),
            relert_set_at: rule.setAt ?? null,
          };
        });
        return sendJson(res, 200, decorated);
      }

      if (method === 'POST' && pathname === '/api/price-errors/realert-threshold') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const asin = String(body?.asin ?? '').trim().toUpperCase();
        const domain = String(body?.domain ?? '').trim().toLowerCase();
        const basePrice = toFiniteNumber(body?.basePrice);
        const dropPercent = toFiniteNumber(body?.dropPercent);
        const validAsin = /^[A-Z0-9]{10}$/.test(asin);
        if (!validAsin || !COMPAT_PRICE_ERROR_DOMAINS.has(domain) || !Number.isFinite(basePrice) || basePrice <= 0) {
          return sendJson(res, 400, { error: 'Invalid payload', requestId });
        }
        if (!Number.isFinite(dropPercent) || dropPercent <= 0 || dropPercent > 95) {
          return sendJson(res, 400, { error: 'Invalid payload', requestId });
        }

        const targetPrice = Number((basePrice * (1 - dropPercent / 100)).toFixed(2));
        const rule = {
          chatId: userId,
          asin,
          domain,
          basePrice: Number(basePrice.toFixed(2)),
          dropPercent: Number(dropPercent.toFixed(2)),
          targetPrice,
          setAt: new Date().toISOString(),
        };
        const runtimeRulesState = store.getRuntimeState
          ? await store.getRuntimeState(PRICE_ERROR_REALERT_RULES_STATE_KEY)
          : null;
        const existing =
          runtimeRulesState?.stateValue && typeof runtimeRulesState.stateValue === 'object'
            ? runtimeRulesState.stateValue
            : {};
        const next = {
          ...existing,
          [buildPriceErrorRealertRuleKey(userId, asin, domain)]: rule,
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(PRICE_ERROR_REALERT_RULES_STATE_KEY, next);
        }
        return sendJson(res, 200, {
          success: true,
          asin,
          domain,
          dropPercent: rule.dropPercent,
          basePrice: rule.basePrice,
          targetPrice: rule.targetPrice,
        });
      }

      if (method === 'POST' && pathname === '/api/price-errors/realert-threshold/bulk') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const dropPercent = toFiniteNumber(body?.dropPercent);
        const limit = clampInt(body?.limit, 50, 1, 300);
        if (!Number.isFinite(dropPercent) || dropPercent <= 0 || dropPercent > 95) {
          return sendJson(res, 400, { error: 'Invalid payload', requestId });
        }

        const trackings = await store.listTrackings();
        const rows = buildCompatPriceErrorRows(trackings, limit);
        const runtimeRulesState = store.getRuntimeState
          ? await store.getRuntimeState(PRICE_ERROR_REALERT_RULES_STATE_KEY)
          : null;
        const existing =
          runtimeRulesState?.stateValue && typeof runtimeRulesState.stateValue === 'object'
            ? runtimeRulesState.stateValue
            : {};
        const setAt = new Date().toISOString();
        const next = { ...existing };
        let applied = 0;
        for (const row of rows) {
          const basePrice = toFiniteNumber(row?.price);
          if (!Number.isFinite(basePrice) || basePrice <= 0) continue;
          const targetPrice = Number((basePrice * (1 - dropPercent / 100)).toFixed(2));
          next[buildPriceErrorRealertRuleKey(userId, row.asin, row.domain)] = {
            chatId: userId,
            asin: row.asin,
            domain: row.domain,
            basePrice: Number(basePrice.toFixed(2)),
            dropPercent: Number(dropPercent.toFixed(2)),
            targetPrice,
            setAt,
          };
          applied += 1;
        }
        if (store.setRuntimeState) {
          await store.setRuntimeState(PRICE_ERROR_REALERT_RULES_STATE_KEY, next);
        }
        return sendJson(res, 200, {
          success: true,
          applied,
          scanned: rows.length,
          dropPercent: Number(dropPercent.toFixed(2)),
        });
      }

      if (method === 'DELETE' && pathname === '/api/price-errors/realert-threshold') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const asin = String(body?.asin ?? '').trim().toUpperCase();
        const domain = String(body?.domain ?? '').trim().toLowerCase();
        const validAsin = /^[A-Z0-9]{10}$/.test(asin);
        if (!validAsin || !COMPAT_PRICE_ERROR_DOMAINS.has(domain)) {
          return sendJson(res, 400, { error: 'Invalid payload', requestId });
        }

        const runtimeRulesState = store.getRuntimeState
          ? await store.getRuntimeState(PRICE_ERROR_REALERT_RULES_STATE_KEY)
          : null;
        const existing =
          runtimeRulesState?.stateValue && typeof runtimeRulesState.stateValue === 'object'
            ? runtimeRulesState.stateValue
            : {};
        const key = buildPriceErrorRealertRuleKey(userId, asin, domain);
        const next = { ...existing };
        delete next[key];
        if (store.setRuntimeState) {
          await store.setRuntimeState(PRICE_ERROR_REALERT_RULES_STATE_KEY, next);
        }
        return sendJson(res, 200, { success: true, asin, domain, cleared: true });
      }

      const alertsHistoryMatch = pathname.match(/^\/api\/alerts\/([^/]+)$/);
      if (method === 'GET' && alertsHistoryMatch) {
        const chatId = normalizeChatId(alertsHistoryMatch[1]);
        const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200);
        const adminId = resolveCompatAdminId();
        const isAdmin = Boolean(adminId && chatId === adminId);

        let historyRows = await loadCompatAlertHistory(store);
        if (!historyRows.length && store.listLatestAutomationRuns) {
          const runs = await store.listLatestAutomationRuns(50);
          const bootstrapped = buildCompatAlertHistoryFromRuns(runs, 200).map((row) => ({
            ...row,
            chat_id: chatId,
          }));
          if (bootstrapped.length) {
            await saveCompatAlertHistory(store, bootstrapped);
            historyRows = await loadCompatAlertHistory(store);
          }
        }

        const scoped = historyRows
          .filter((row) => String(row?.chat_id ?? '') === chatId)
          .filter((row) => isAdmin || USER_VISIBLE_ALERT_TYPES.has(String(row?.alert_type ?? '')))
          .slice(0, limit);
        return sendJson(res, 200, scoped);
      }

      const alertsFeedbackMatch = pathname.match(/^\/api\/alerts\/([^/]+)\/(\d+)\/feedback$/);
      if (method === 'PATCH' && alertsFeedbackMatch) {
        const actorChatId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(actorChatId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const chatId = normalizeChatId(alertsFeedbackMatch[1]);
        if (chatId !== String(actorChatId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const alertId = Number.parseInt(alertsFeedbackMatch[2], 10);
        if (!Number.isInteger(alertId) || alertId <= 0) {
          return sendJson(res, 400, { error: 'Invalid alertId', requestId });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const status = String(body?.status ?? '').trim().toLowerCase();
        const source = String(body?.source ?? '').trim() || null;
        if (!status) {
          return sendJson(res, 400, { error: 'Invalid feedback payload', requestId });
        }

        const rows = await loadCompatAlertHistory(store);
        const index = rows.findIndex((row) => row.id === alertId && String(row?.chat_id ?? '') === chatId);
        if (index < 0) {
          return sendJson(res, 404, { error: 'Alert not found', requestId });
        }
        const updatedRow = {
          ...rows[index],
          feedback_status: status,
          feedback_source: source,
          chat_id: chatId,
        };
        const nextRows = rows.slice();
        nextRows[index] = updatedRow;
        await saveCompatAlertHistory(store, nextRows);
        return sendJson(res, 200, { success: true, row: updatedRow });
      }

      const alertsDeleteSingleMatch = pathname.match(/^\/api\/alerts\/([^/]+)\/(\d+)$/);
      if (method === 'DELETE' && alertsDeleteSingleMatch) {
        const actorChatId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(actorChatId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const chatId = normalizeChatId(alertsDeleteSingleMatch[1]);
        if (chatId !== String(actorChatId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }
        const alertId = Number.parseInt(alertsDeleteSingleMatch[2], 10);
        if (!Number.isInteger(alertId) || alertId <= 0) {
          return sendJson(res, 400, { error: 'Invalid alertId', requestId });
        }

        const rows = await loadCompatAlertHistory(store);
        const index = rows.findIndex((row) => row.id === alertId && String(row?.chat_id ?? '') === chatId);
        if (index < 0) {
          return sendJson(res, 404, { error: 'Alert not found', requestId });
        }
        const deletedRow = rows[index];
        const nextRows = rows.filter((row) => !(row.id === alertId && String(row?.chat_id ?? '') === chatId));
        await saveCompatAlertHistory(store, nextRows);
        return sendJson(res, 200, { success: true, row: deletedRow });
      }

      const alertsClearMatch = pathname.match(/^\/api\/alerts\/([^/]+)\/clear$/);
      if (method === 'DELETE' && alertsClearMatch) {
        const chatId = normalizeChatId(alertsClearMatch[1]);
        const rows = await loadCompatAlertHistory(store);
        const nextRows = rows.filter((row) => String(row?.chat_id ?? '') !== chatId);
        const cleared = rows.length - nextRows.length;
        await saveCompatAlertHistory(store, nextRows);
        return sendJson(res, 200, { success: true, cleared });
      }

      if (method === 'GET' && pathname === '/api/perf/routes') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }

        const windowSec = clampInt(url.searchParams.get('windowSec'), 900, 60, 24 * 3600);
        const limit = clampInt(url.searchParams.get('limit'), 20, 1, 100);
        const schedulerState = store.getRuntimeState ? await store.getRuntimeState('scheduler_status') : null;
        const metrics = schedulerState?.stateValue?.metrics ?? {};

        const snapshot = {
          window_sec: windowSec,
          samples: Number(metrics?.apiSamples || 0),
          overall: {
            p50_ms: Number(metrics?.apiP50Ms || 0),
            p95_ms: Number(metrics?.apiP95Ms || 0),
            p99_ms: Number(metrics?.apiP99Ms || 0),
          },
          routes: Array.isArray(metrics?.apiRoutes) ? metrics.apiRoutes.slice(0, limit) : [],
          slow_routes: Array.isArray(metrics?.slowRoutes) ? metrics.slowRoutes.slice(0, limit) : [],
          rate_limits: metrics?.rateLimits && typeof metrics.rateLimits === 'object' ? metrics.rateLimits : {},
          rate_limit_config: metrics?.rateLimitConfig && typeof metrics.rateLimitConfig === 'object'
            ? metrics.rateLimitConfig
            : {
                enabled: false,
              },
          requestId,
        };
        return sendJson(res, 200, snapshot);
      }

      if (method === 'GET' && pathname === '/api/token-efficiency') {
        const hours = clampInt(url.searchParams.get('hours'), 24, 1, 24 * 30);
        const schedulerState = store.getRuntimeState ? await store.getRuntimeState('scheduler_status') : null;
        const tokenUsageState = store.getRuntimeState ? await store.getRuntimeState(KEEPA_TOKEN_USAGE_STATE_KEY) : null;
        const tokenUsage = normalizeKeepaTokenUsage(tokenUsageState?.stateValue ?? {});
        const metrics = schedulerState?.stateValue?.metrics ?? {};

        const tokensSpent = Number(tokenUsage.used || 0);
        const alerts = Number(metrics?.lastAlerts || 0);
        const tokensPerAlert = alerts > 0 ? Number((tokensSpent / alerts).toFixed(2)) : null;
        const scanned = Number(metrics?.lastScanned || 0);
        const estimated = Number(metrics?.lastEstimatedTokens || 0);
        const tokensPerScanned = scanned > 0 ? Number((estimated / scanned).toFixed(2)) : null;

        return sendJson(res, 200, {
          windowHours: hours,
          tokensSpent: Number(tokensSpent.toFixed(2)),
          alerts,
          tokensPerAlert,
          latestScan: {
            scanned,
            alerts,
            estimatedTokens: estimated,
            coldSkipped: Number(metrics?.lastColdSkipped || 0),
            budgetTokens: Number(metrics?.lastBudgetTokens || 0),
            tokensPerScanned,
          },
          cumulative: {
            estimatedTokens: Number(metrics?.cumulativeEstimatedTokens || 0),
            totalScans: Number(metrics?.totalScans || 0),
            totalScanned: Number(metrics?.totalScanned || 0),
            totalAlerts: Number(metrics?.totalAlerts || 0),
          },
        });
      }

      if (method === 'GET' && pathname === '/api/popular') {
        const limit = clampInt(url.searchParams.get('limit'), 20, 1, 50);
        const trackings = await store.listTrackings();
        const rows = buildPopularityRows(trackings, limit);
        return sendJson(res, 200, rows);
      }

      const popularityMatch = pathname.match(/^\/api\/popularity\/([^/]+)$/);
      if (method === 'GET' && popularityMatch) {
        const asin = decodeURIComponent(popularityMatch[1]).toUpperCase();
        if (!asin) return sendJson(res, 400, { error: 'asin_required' });

        const trackings = await store.listTrackings();
        const rows = buildPopularityRows(trackings, 500);
        const hit = rows.find((row) => row.asin === asin);
        return sendJson(res, 200, {
          asin,
          trackers: hit?.trackers ?? 0,
          score: hit?.score ?? 0,
          rank: hit ? rows.findIndex((row) => row.asin === asin) + 1 : null,
        });
      }

      if (method === 'POST' && pathname === '/api/scan/run-now') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }

        const scanPolicyState = store.getRuntimeState ? await store.getRuntimeState(SETTINGS_SCAN_POLICY_STATE_KEY) : null;
        const scanEnabled = scanPolicyState?.stateValue?.scanEnabled ?? true;
        if (scanEnabled === false) {
          return sendJson(res, 409, { success: false, error: 'Skanowanie jest wyłączone', requestId });
        }

        const scanRuntimeState = store.getRuntimeState ? await store.getRuntimeState(SCAN_RUNTIME_STATE_KEY) : null;
        const scanRuntime = scanRuntimeState?.stateValue ?? {};
        if (scanRuntime?.isScanning === true) {
          return sendJson(res, 409, { success: false, error: 'Skan już trwa', requestId });
        }

        const requestedAt = new Date().toISOString();
        const nextRuntime = {
          ...scanRuntime,
          isScanning: true,
          lastRunNowRequestedAt: requestedAt,
          lastAction: 'run-now',
          actor: userId ?? null,
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(SCAN_RUNTIME_STATE_KEY, nextRuntime);
          const schedulerState = await store.getRuntimeState('scheduler_status');
          await store.setRuntimeState('scheduler_status', {
            ...(schedulerState?.stateValue ?? {}),
            isScanning: true,
            lastRunAt: requestedAt,
            lastAction: 'run-now',
          });
        }

        return sendJson(res, 200, {
          success: true,
          started: true,
          requestedAt,
          requestId,
        });
      }

      if (method === 'POST' && pathname === '/api/scan/stop') {
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!isCompatAdminUser(userId, adminId)) {
          return sendJson(res, 403, { error: 'Forbidden', requestId });
        }

        const requestedAt = new Date().toISOString();
        const scanRuntimeState = store.getRuntimeState ? await store.getRuntimeState(SCAN_RUNTIME_STATE_KEY) : null;
        const scanRuntime = scanRuntimeState?.stateValue ?? {};
        const nextRuntime = {
          ...scanRuntime,
          isScanning: false,
          stopRequestedAt: requestedAt,
          lastAction: 'stop',
          actor: userId ?? null,
        };

        if (store.setRuntimeState) {
          await store.setRuntimeState(SCAN_RUNTIME_STATE_KEY, nextRuntime);
          const schedulerState = await store.getRuntimeState('scheduler_status');
          await store.setRuntimeState('scheduler_status', {
            ...(schedulerState?.stateValue ?? {}),
            isScanning: false,
            stopRequestedAt: requestedAt,
            lastAction: 'stop',
          });
        }

        return sendJson(res, 200, {
          success: true,
          stopped: true,
          requestedAt,
          requestId,
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
      const scanIntervalMatch = pathname.match(/^\/api\/settings\/([^/]+)\/scan-interval$/);
      const settingsDropPctMatch = pathname.match(/^\/api\/settings\/([^/]+)\/drop-pct$/);
      const settingsNotificationsMatch = pathname.match(/^\/api\/settings\/([^/]+)\/notifications$/);
      const settingsNotificationChannelsMatch = pathname.match(/^\/api\/settings\/([^/]+)\/notification-channels$/);
      const settingsAlertProfilesMatch = pathname.match(/^\/api\/settings\/([^/]+)\/alert-profiles$/);
      const settingsScanPolicyMatch = pathname.match(/^\/api\/settings\/([^/]+)\/scan-policy$/);
      const settingsPreferencesMatch = pathname.match(/^\/api\/settings\/([^/]+)\/preferences$/);
      const globalScanIntervalMatch = pathname.match(/^\/api\/settings\/([^/]+)\/global-scan-interval$/);
      const trackingsCacheRuntimeMatch = pathname.match(/^\/api\/settings\/([^/]+)\/trackings-cache-runtime$/);
      const trackingsCacheTtlMatch = pathname.match(/^\/api\/settings\/([^/]+)\/trackings-cache-ttl$/);
      const settingsMatch = pathname.match(/^\/api\/settings\/([^/]+)$/);
      if (method === 'GET' && settingsMatch) {
        const chatId = normalizeChatId(settingsMatch[1]);
        const chatSettingsState = store.getRuntimeState
          ? await store.getRuntimeState(buildChatSettingsStateKey(chatId))
          : null;
        const state = chatSettingsState?.stateValue ?? null;
        const productIntervalMin = clampInt(state?.productIntervalMin ?? 60, 60, 1, 24 * 60);
        const scanIntervalMin =
          state?.scanIntervalMin === undefined || state?.scanIntervalMin === null
            ? null
            : clampInt(state.scanIntervalMin, 60, 1, 24 * 60);
        const defaultDropPct = clampInt(state?.default_drop_pct, 10, 1, 90);
        return sendJson(res, 200, {
          chatId,
          productIntervalMin,
          notificationsEnabled: true,
          scanIntervalMin,
          default_drop_pct: defaultDropPct,
          updatedAt: state?.updatedAt ?? null,
        });
      }

      if (method === 'GET' && trackingsCacheRuntimeMatch) {
        const chatId = normalizeChatId(trackingsCacheRuntimeMatch[1]);
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'forbidden', requestId });
        }

        const runtimeState = store.getRuntimeState ? await store.getRuntimeState(TRACKINGS_CACHE_RUNTIME_STATE_KEY) : null;
        const autotuneState = store.getRuntimeState
          ? await store.getRuntimeState(TRACKINGS_CACHE_AUTOTUNE_LAST_STATE_KEY)
          : null;
        const historyState = store.getRuntimeState
          ? await store.getRuntimeState(TRACKINGS_CACHE_RUNTIME_HISTORY_STATE_KEY)
          : null;

        const runtime = runtimeState?.stateValue ?? {
          ttlMs: clampInt(process.env.SOON_TRACKINGS_CACHE_TTL_MS, 30000, 0, 300000),
          maxEntries: clampInt(process.env.SOON_TRACKINGS_CACHE_MAX_ENTRIES, 1000, 1, 100000),
          currentEntries: 0,
          evictionCount: 0,
        };

        const sample = {
          ts: new Date().toISOString(),
          ttlMs: Number(runtime.ttlMs ?? 0),
          currentEntries: Number(runtime.currentEntries ?? 0),
          maxEntries: Number(runtime.maxEntries ?? 0),
        };
        const nextHistory = [...(Array.isArray(historyState?.stateValue) ? historyState.stateValue : []), sample].slice(-288);
        if (store.setRuntimeState) {
          await store.setRuntimeState(TRACKINGS_CACHE_RUNTIME_HISTORY_STATE_KEY, nextHistory);
        }

        return sendJson(res, 200, {
          success: true,
          chatId,
          runtime,
          autotune: autotuneState?.stateValue ?? null,
          history: nextHistory,
        });
      }

      if (method === 'POST' && trackingsCacheTtlMatch) {
        const chatId = normalizeChatId(trackingsCacheTtlMatch[1]);
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'forbidden', requestId });
        }

        const body = await readJsonBody(req).catch(() => ({}));
        const ttlMs = clampInt(body.ttl_ms ?? body.ttlMs ?? body.value ?? 30000, 30000, 0, 300000);
        const runtimeState = store.getRuntimeState ? await store.getRuntimeState(TRACKINGS_CACHE_RUNTIME_STATE_KEY) : null;
        const currentRuntime = runtimeState?.stateValue ?? {};
        const runtime = {
          ttlMs,
          maxEntries: clampInt(
            currentRuntime.maxEntries ?? process.env.SOON_TRACKINGS_CACHE_MAX_ENTRIES,
            1000,
            1,
            100000,
          ),
          currentEntries: clampInt(currentRuntime.currentEntries, 0, 0, 1000000),
          evictionCount: clampInt(currentRuntime.evictionCount, 0, 0, 100000000),
          updatedAt: new Date().toISOString(),
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(TRACKINGS_CACHE_RUNTIME_STATE_KEY, runtime);
        }
        return sendJson(res, 200, { success: true, chatId, runtime });
      }

      if (method === 'POST' && globalScanIntervalMatch) {
        const chatId = normalizeChatId(globalScanIntervalMatch[1]);
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const requestId = resolveCompatRequestId(req);
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'forbidden', requestId });
        }

        const body = await readJsonBody(req).catch(() => ({}));
        const rawHours = Number(body.hours);
        if (!Number.isFinite(rawHours)) {
          return sendJson(res, 400, { error: 'Global interval invalid', requestId });
        }
        const hours = clampInt(rawHours, 6, 1, 24);
        const nextScanAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        const state = {
          hours,
          nextScanAt,
          actor: userId,
          updatedAt: new Date().toISOString(),
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(GLOBAL_SCAN_INTERVAL_STATE_KEY, state);
        }
        return sendJson(res, 200, {
          success: true,
          chatId,
          scan_interval_hours: hours,
          next_scan_at: nextScanAt,
        });
      }

      if (method === 'POST' && settingsDropPctMatch) {
        const chatId = normalizeChatId(settingsDropPctMatch[1]);
        const requestId = resolveCompatRequestId(req);
        const body = await readJsonBody(req).catch(() => ({}));
        const rawPct = body.pct ?? body.dropPct ?? body.default_drop_pct ?? body.value;
        if (rawPct === undefined || rawPct === null || rawPct === '' || Number.isNaN(Number(rawPct))) {
          return sendJson(res, 400, { error: 'Pct invalid', requestId });
        }
        const pct = clampInt(rawPct, 10, 1, 90);
        const currentState = store.getRuntimeState ? await store.getRuntimeState(buildChatSettingsStateKey(chatId)) : null;
        const previous = currentState?.stateValue ?? {};
        const state = {
          ...previous,
          chatId,
          default_drop_pct: pct,
          updatedAt: new Date().toISOString(),
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(buildChatSettingsStateKey(chatId), state);
        }
        return sendJson(res, 200, { success: true, chatId, default_drop_pct: pct });
      }

      if (method === 'POST' && settingsNotificationsMatch) {
        const chatId = normalizeChatId(settingsNotificationsMatch[1]);
        const body = await readJsonBody(req).catch(() => ({}));
        const raw = body?.notifications ?? body?.notifyPrefs ?? body;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return sendJson(res, 400, { error: 'Invalid notifications payload' });
        }
        const normalized = Object.fromEntries(
          Object.entries(raw)
            .filter(([key]) => typeof key === 'string' && key.trim())
            .map(([key, value]) => [key, Boolean(value)]),
        );
        const currentState = store.getRuntimeState ? await store.getRuntimeState(buildChatSettingsStateKey(chatId)) : null;
        const previous = currentState?.stateValue ?? {};
        const state = {
          ...previous,
          chatId,
          notification_prefs: normalized,
          updatedAt: new Date().toISOString(),
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(buildChatSettingsStateKey(chatId), state);
        }
        return sendJson(res, 200, { success: true });
      }

      if (method === 'POST' && settingsNotificationChannelsMatch) {
        const chatId = normalizeChatId(settingsNotificationChannelsMatch[1]);
        const body = await readJsonBody(req).catch(() => ({}));
        const raw = body?.notification_channels ?? body;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return sendJson(res, 400, { error: 'notification_channels invalid' });
        }
        const normalized = Object.fromEntries(
          Object.entries(raw)
            .filter(([key]) => typeof key === 'string' && key.trim())
            .map(([key, value]) => [key, Boolean(value)]),
        );
        if (Object.keys(normalized).length === 0) {
          return sendJson(res, 400, { error: 'notification_channels invalid' });
        }
        const currentState = store.getRuntimeState ? await store.getRuntimeState(buildChatSettingsStateKey(chatId)) : null;
        const previous = currentState?.stateValue ?? {};
        const state = {
          ...previous,
          chatId,
          notification_channels: normalized,
          updatedAt: new Date().toISOString(),
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(buildChatSettingsStateKey(chatId), state);
        }
        return sendJson(res, 200, { success: true, notification_channels: normalized });
      }

      if (method === 'GET' && settingsAlertProfilesMatch) {
        const chatId = normalizeChatId(settingsAlertProfilesMatch[1]);
        const currentState = store.getRuntimeState ? await store.getRuntimeState(buildChatSettingsStateKey(chatId)) : null;
        const previous = currentState?.stateValue ?? {};
        const alertProfiles =
          previous.alert_profiles && typeof previous.alert_profiles === 'object' && !Array.isArray(previous.alert_profiles)
            ? previous.alert_profiles
            : {};
        return sendJson(res, 200, { alert_profiles: alertProfiles });
      }

      if (method === 'POST' && settingsAlertProfilesMatch) {
        const chatId = normalizeChatId(settingsAlertProfilesMatch[1]);
        const body = await readJsonBody(req).catch(() => ({}));
        const raw = body?.alert_profiles;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return sendJson(res, 400, { error: 'Invalid alert_profiles payload' });
        }
        const normalized = JSON.parse(JSON.stringify(raw));
        const currentState = store.getRuntimeState ? await store.getRuntimeState(buildChatSettingsStateKey(chatId)) : null;
        const previous = currentState?.stateValue ?? {};
        const state = {
          ...previous,
          chatId,
          alert_profiles: normalized,
          updatedAt: new Date().toISOString(),
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(buildChatSettingsStateKey(chatId), state);
        }
        return sendJson(res, 200, { success: true, alert_profiles: normalized });
      }

      if (method === 'GET' && settingsScanPolicyMatch) {
        const chatId = normalizeChatId(settingsScanPolicyMatch[1]);
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        const canEdit = Boolean(userId && adminId && userId === adminId);
        const runtimeState = store.getRuntimeState ? await store.getRuntimeState(SETTINGS_SCAN_POLICY_STATE_KEY) : null;
        const current = runtimeState?.stateValue ?? {};
        const forceFullEachCycle =
          typeof current.forceFullEachCycle === 'boolean'
            ? current.forceFullEachCycle
            : String(process.env.SOON_SCAN_FORCE_FULL_EACH_CYCLE ?? '').trim().toLowerCase() === 'true';
        const postScanTokenRechargeMin = clampInt(
          current.postScanTokenRechargeMin ?? process.env.SOON_POST_SCAN_TOKEN_RECHARGE_MIN,
          15,
          0,
          120,
        );
        const scanEnabled =
          typeof current.scanEnabled === 'boolean'
            ? current.scanEnabled
            : String(process.env.SOON_SCAN_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
        const idleScavengerMinWindowMin = clampInt(
          current.idleScavengerMinWindowMin ?? process.env.SOON_HUNTER_IDLE_SCAVENGER_MIN_WINDOW_MIN,
          20,
          1,
          360,
        );
        return sendJson(res, 200, {
          success: true,
          canEdit,
          scanPolicy: {
            scanEnabled,
            forceFullEachCycle,
            postScanTokenRechargeMin,
            idleScavengerMinWindowMin,
          },
        });
      }

      if (method === 'POST' && settingsScanPolicyMatch) {
        const chatId = normalizeChatId(settingsScanPolicyMatch[1]);
        const userId = resolveCompatAuthUserId(req, url);
        const adminId = resolveCompatAdminId();
        if (!userId || !adminId || userId !== adminId) {
          return sendJson(res, 403, { error: 'Forbidden' });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const forceFullEachCycle = body?.forceFullEachCycle;
        const scanEnabledRaw = body?.scanEnabled;
        const postScanTokenRechargeMin = Number.parseInt(body?.postScanTokenRechargeMin, 10);
        const idleScavengerMinWindowMin = Number.parseInt(body?.idleScavengerMinWindowMin, 10);

        if (typeof forceFullEachCycle !== 'boolean') {
          return sendJson(res, 400, { error: 'forceFullEachCycle must be boolean' });
        }
        if (scanEnabledRaw !== undefined && typeof scanEnabledRaw !== 'boolean') {
          return sendJson(res, 400, { error: 'scanEnabled must be boolean' });
        }
        if (!Number.isInteger(postScanTokenRechargeMin) || postScanTokenRechargeMin < 0 || postScanTokenRechargeMin > 120) {
          return sendJson(res, 400, { error: 'postScanTokenRechargeMin must be 0-120' });
        }
        if (!Number.isInteger(idleScavengerMinWindowMin) || idleScavengerMinWindowMin < 1 || idleScavengerMinWindowMin > 360) {
          return sendJson(res, 400, { error: 'idleScavengerMinWindowMin must be 1-360' });
        }

        const runtimeState = store.getRuntimeState ? await store.getRuntimeState(SETTINGS_SCAN_POLICY_STATE_KEY) : null;
        const previous = runtimeState?.stateValue ?? {};
        const scanEnabled = typeof scanEnabledRaw === 'boolean' ? scanEnabledRaw : (previous.scanEnabled ?? true);
        const next = {
          ...previous,
          chatId,
          scanEnabled,
          forceFullEachCycle,
          postScanTokenRechargeMin,
          idleScavengerMinWindowMin,
          updatedAt: new Date().toISOString(),
          updatedBy: userId,
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(SETTINGS_SCAN_POLICY_STATE_KEY, next);
        }
        return sendJson(res, 200, {
          success: true,
          scanPolicy: {
            scanEnabled: next.scanEnabled,
            forceFullEachCycle: next.forceFullEachCycle,
            postScanTokenRechargeMin: next.postScanTokenRechargeMin,
            idleScavengerMinWindowMin: next.idleScavengerMinWindowMin,
          },
        });
      }

      if (method === 'POST' && settingsPreferencesMatch) {
        const chatId = normalizeChatId(settingsPreferencesMatch[1]);
        const body = await readJsonBody(req).catch(() => ({}));
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return sendJson(res, 400, { error: 'Invalid preferences payload' });
        }
        const preferences = JSON.parse(JSON.stringify(body));
        const currentState = store.getRuntimeState ? await store.getRuntimeState(buildChatSettingsStateKey(chatId)) : null;
        const previous = currentState?.stateValue ?? {};
        const state = {
          ...previous,
          chatId,
          preferences,
          updatedAt: new Date().toISOString(),
        };
        if (
          preferences.alert_profiles &&
          typeof preferences.alert_profiles === 'object' &&
          !Array.isArray(preferences.alert_profiles)
        ) {
          state.alert_profiles = preferences.alert_profiles;
        }
        if (
          preferences.notification_channels &&
          typeof preferences.notification_channels === 'object' &&
          !Array.isArray(preferences.notification_channels)
        ) {
          state.notification_channels = Object.fromEntries(
            Object.entries(preferences.notification_channels).map(([key, value]) => [key, Boolean(value)]),
          );
        }
        if (store.setRuntimeState) {
          await store.setRuntimeState(buildChatSettingsStateKey(chatId), state);
        }
        return sendJson(res, 200, { success: true });
      }

      if (method === 'POST' && productIntervalMatch) {
        const chatId = normalizeChatId(productIntervalMatch[1]);
        const body = await readJsonBody(req).catch(() => ({}));
        const currentState = store.getRuntimeState ? await store.getRuntimeState(buildChatSettingsStateKey(chatId)) : null;
        const previous = currentState?.stateValue ?? {};
        const intervalMin = clampInt(
          body.productIntervalMin ?? body.intervalMin ?? body.intervalMinutes ?? body.value ?? 60,
          60,
          1,
          24 * 60,
        );
        const state = {
          ...previous,
          chatId,
          productIntervalMin: intervalMin,
          updatedAt: new Date().toISOString(),
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(buildChatSettingsStateKey(chatId), state);
        }
        return sendJson(res, 200, { status: 'updated', ...state });
      }

      if (method === 'POST' && scanIntervalMatch) {
        const chatId = normalizeChatId(scanIntervalMatch[1]);
        const body = await readJsonBody(req).catch(() => ({}));
        const currentState = store.getRuntimeState ? await store.getRuntimeState(buildChatSettingsStateKey(chatId)) : null;
        const previous = currentState?.stateValue ?? {};
        const intervalMin = clampInt(
          body.scanIntervalMin ?? body.intervalMin ?? body.scanEveryMin ?? body.value ?? 60,
          60,
          1,
          24 * 60,
        );
        const state = {
          ...previous,
          chatId,
          scanIntervalMin: intervalMin,
          updatedAt: new Date().toISOString(),
        };
        if (store.setRuntimeState) {
          await store.setRuntimeState(buildChatSettingsStateKey(chatId), state);
        }
        return sendJson(res, 200, {
          status: 'updated',
          chatId,
          scanIntervalMin: intervalMin,
          updatedAt: state.updatedAt,
        });
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

      if (method === 'GET' && pathname === '/api/keepa/watch-state/summary') {
        const rawLimit = Number(url.searchParams.get('limit') ?? 50);
        const limit = Math.max(1, Math.min(500, Number.isFinite(rawLimit) ? rawLimit : 50));
        const indexState = store.getRuntimeState ? await store.getRuntimeState(KEEPA_WATCH_INDEX_STATE_KEY) : null;
        const asins = Array.isArray(indexState?.stateValue?.asins) ? indexState.stateValue.asins : [];
        const items = [];
        if (store.getRuntimeState) {
          for (const asin of asins.slice(0, limit)) {
            const watchState = await store.getRuntimeState(buildKeepaWatchStateKey(asin));
            if (watchState?.stateValue) {
              items.push(watchState.stateValue);
            }
          }
        }
        return sendJson(res, 200, {
          status: 'ok',
          count: items.length,
          watchedAsins: asins.length,
          items,
          updatedAt: indexState?.stateValue?.updatedAt ?? null,
        });
      }

      if (method === 'GET' && pathname === '/api/keepa/nl-reliability') {
        const trackings = await store.listTrackings();
        const total = trackings.length;
        const withNlNew = trackings.filter((item) => Number.isFinite(Number(item?.pricesNew?.nl)) && Number(item.pricesNew.nl) > 0);
        const withNlUsed = trackings.filter(
          (item) => Number.isFinite(Number(item?.pricesUsed?.nl)) && Number(item.pricesUsed.nl) > 0,
        );
        const coverageNewPct = total > 0 ? Number(((withNlNew.length / total) * 100).toFixed(2)) : 0;
        const coverageUsedPct = total > 0 ? Number(((withNlUsed.length / total) * 100).toFixed(2)) : 0;
        const reliabilityScore = Number(((coverageNewPct * 0.7 + coverageUsedPct * 0.3)).toFixed(2));
        return sendJson(res, 200, {
          status: 'ok',
          market: 'nl',
          totals: {
            trackings: total,
            withNewPrice: withNlNew.length,
            withUsedPrice: withNlUsed.length,
          },
          coverage: {
            newPct: coverageNewPct,
            usedPct: coverageUsedPct,
          },
          reliabilityScore,
          health: reliabilityScore >= 80 ? 'good' : reliabilityScore >= 50 ? 'warn' : 'bad',
          checkedAt: new Date().toISOString(),
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

      if (method === 'GET' && pathname === '/api/hunter-config') {
        const defaultConfig = buildDefaultHunterConfig();
        const customState = store.getRuntimeState ? await store.getRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY) : null;
        const customConfig =
          customState?.stateValue && typeof customState.stateValue === 'object'
            ? customState.stateValue.config ?? {}
            : {};
        const effectiveConfig = mergeHunterConfig(defaultConfig, customConfig);
        const lastRunState = store.getRuntimeState ? await store.getRuntimeState(HUNTER_LAST_RUN_STATE_KEY) : null;

        return sendJson(res, 200, {
          status: 'ok',
          config: effectiveConfig,
          source: customState ? 'custom+default' : 'default',
          updatedAt: customState?.stateValue?.updatedAt ?? null,
          lastRun: lastRunState?.stateValue ?? null,
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-config/recommendation') {
        const defaultConfig = buildDefaultHunterConfig();
        const customState = store.getRuntimeState ? await store.getRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY) : null;
        const customConfig =
          customState?.stateValue && typeof customState.stateValue === 'object'
            ? customState.stateValue.config ?? {}
            : {};
        const effectiveConfig = mergeHunterConfig(defaultConfig, customConfig);
        const recommendationPayload = await buildHunterRuntimeRecommendation(store, effectiveConfig, { hours: 24 });

        return sendJson(res, 200, {
          isAdmin: false,
          canManage: false,
          ...recommendationPayload,
        });
      }

      if (method === 'POST' && pathname === '/api/hunter-config/preset') {
        if (!store.setRuntimeState) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const preset = String(body?.preset ?? '').trim().toLowerCase();
        if (!HUNTER_PRESETS.has(preset)) {
          return sendJson(res, 400, { error: 'Invalid preset' });
        }
        const presetConfig = normalizeHunterCustomConfig(buildHunterPresetOverride(preset));
        await store.setRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY, {
          config: presetConfig,
          actor: `preset:${preset}`,
          preset,
          updatedAt: new Date().toISOString(),
        });
        const effective = mergeHunterConfig(buildDefaultHunterConfig(), presetConfig);
        return sendJson(res, 200, { success: true, preset, effective });
      }

      if (method === 'DELETE' && pathname === '/api/hunter-config/preset') {
        if (!store.setRuntimeState) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }
        await store.setRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY, {
          config: {},
          actor: 'preset:reset',
          preset: null,
          updatedAt: new Date().toISOString(),
        });
        const effective = mergeHunterConfig(buildDefaultHunterConfig(), {});
        return sendJson(res, 200, { success: true, effective });
      }

      if (method === 'POST' && pathname === '/api/hunter-config/auto-apply-run') {
        if (!store.setRuntimeState) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const force = parseBooleanInput(body?.force, true);
        const customState = store.getRuntimeState ? await store.getRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY) : null;
        const customConfig =
          customState?.stateValue && typeof customState.stateValue === 'object'
            ? customState.stateValue.config ?? {}
            : {};
        const effectiveConfig = mergeHunterConfig(buildDefaultHunterConfig(), customConfig);
        const recommendationPayload = await buildHunterRuntimeRecommendation(store, effectiveConfig, { hours: 24 });
        const recommendedPreset = recommendationPayload?.recommendation?.preset ?? 'safe';
        const recommendedConfidence = Number(recommendationPayload?.recommendation?.confidence ?? 0);
        const runs24h = Number(recommendationPayload?.recommendation?.metrics?.runs ?? 0);
        const minConfidence = Number(recommendationPayload?.autoApply?.minConfidence ?? 0.82);
        const minRuns = Number(recommendationPayload?.autoApply?.minRuns ?? 3);
        const shouldApply = force || (recommendedConfidence >= minConfidence && runs24h >= minRuns);

        const changed = [];
        let appliedPreset = null;
        if (shouldApply) {
          const nextConfig = normalizeHunterCustomConfig(buildHunterPresetOverride(recommendedPreset));
          await store.setRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY, {
            config: nextConfig,
            actor: 'auto-apply-run',
            preset: recommendedPreset,
            updatedAt: new Date().toISOString(),
          });
          changed.push('preset');
          appliedPreset = recommendedPreset;
        }

        return sendJson(res, 200, {
          success: true,
          forced: force,
          applied: Boolean(shouldApply),
          changed,
          preset: appliedPreset,
          recommendation: recommendationPayload.recommendation,
          thresholds: { minConfidence, minRuns },
        });
      }

      if (method === 'POST' && pathname === '/api/hunter-config/momentum-run') {
        const trackings = await store.listTrackings();
        if (!Array.isArray(trackings) || trackings.length === 0) {
          return sendJson(res, 409, {
            error: 'Hunter momentum not started (no_trackings)',
            success: false,
            skipped: true,
            reason: 'no_trackings',
          });
        }

        const startedAt = new Date().toISOString();
        const cycle = runAutomationCycle(trackings, {
          tokenPolicyMode: 'unbounded',
          budgetTokens: null,
          degradationMode: 'momentum_run_now',
          deferredUntil: null,
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

        return sendJson(res, 200, {
          success: true,
          skipped: false,
          reason: null,
          runId: persisted?.runId ?? null,
          scanned: trackings.length,
          injected: Number(cycle?.alerts?.length ?? 0),
          decisions: Number(cycle?.decisions?.length ?? 0),
          at: finishedAt,
        });
      }

      if (method === 'POST' && pathname === '/api/hunter-config/custom') {
        if (!store.setRuntimeState) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const body = await readJsonBody(req).catch(() => ({}));
        const payload = body?.config && typeof body.config === 'object' ? body.config : body;
        const normalizedConfig = normalizeHunterCustomConfig(payload);
        if (!Object.keys(normalizedConfig).length) {
          return sendJson(res, 400, { error: 'config_payload_required' });
        }

        const nowIso = new Date().toISOString();
        const actor = String(body?.actor ?? 'manual').trim().slice(0, 80) || 'manual';
        const state = await store.setRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY, {
          config: normalizedConfig,
          actor,
          updatedAt: nowIso,
        });

        const effectiveConfig = mergeHunterConfig(buildDefaultHunterConfig(), normalizedConfig);
        return sendJson(res, 200, {
          status: 'ok',
          updated: true,
          actor,
          config: effectiveConfig,
          state,
        });
      }

      if (method === 'POST' && pathname === '/api/hunter-config/run-now') {
        const body = await readJsonBody(req).catch(() => ({}));
        const nowTs = parseTimestampInput(body?.now, Date.now());
        if (nowTs === null) {
          return sendJson(res, 400, { error: 'invalid_now' });
        }
        const startedAt = new Date(nowTs).toISOString();

        const defaultConfig = buildDefaultHunterConfig();
        const customState = store.getRuntimeState ? await store.getRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY) : null;
        const customConfig =
          customState?.stateValue && typeof customState.stateValue === 'object'
            ? customState.stateValue.config ?? {}
            : {};
        const effectiveConfig = mergeHunterConfig(defaultConfig, customConfig);

        const tokenPolicyConfig = resolveAutomationTokenPolicyConfig(
          body?.tokenPolicy ?? effectiveConfig.tokenPolicy ?? null,
        );
        const trackings = await store.listTrackings();
        const cycle = runAutomationCycle(trackings, {
          tokenPolicyMode: tokenPolicyConfig.mode,
          budgetTokens: tokenPolicyConfig.budgetTokens,
          degradationMode: 'manual_run_now',
          deferredUntil: null,
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
          budgetMode: cycle?.tokenPolicy?.mode ?? tokenPolicyConfig.mode,
          budgetTokens: cycle?.tokenPolicy?.budgetTokens ?? tokenPolicyConfig.budgetTokens,
        });
        const tokenSnapshot = store.recordTokenAllocationSnapshot
          ? await store.recordTokenAllocationSnapshot({
              runId: persisted?.runId ?? null,
              ...tokenSnapshotInput,
            })
          : null;

        const runNowState =
          store.setRuntimeState &&
          (await store.setRuntimeState(HUNTER_LAST_RUN_STATE_KEY, {
            runId: persisted?.runId ?? null,
            startedAt,
            finishedAt,
            trackingCount: Number(cycle?.tokenPolicy?.selectedCount ?? trackings.length),
            decisionCount: Number(cycle?.decisions?.length ?? 0),
            alertCount: Number(cycle?.alerts?.length ?? 0),
            tokenPolicy: tokenPolicyConfig,
            tokenSnapshotId: tokenSnapshot?.snapshotId ?? null,
            triggeredBy: String(body?.triggeredBy ?? 'manual').trim().slice(0, 80) || 'manual',
          }));

        return sendJson(res, 200, {
          status: 'ok',
          triggered: true,
          runId: persisted?.runId ?? null,
          tokenSnapshotId: tokenSnapshot?.snapshotId ?? null,
          tokenPolicyConfig,
          runNow: runNowState?.stateValue ?? null,
          ...cycle,
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-slo') {
        if (!store.listLatestAutomationRuns) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const defaultConfig = buildDefaultHunterConfig();
        const customState = store.getRuntimeState ? await store.getRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY) : null;
        const customConfig =
          customState?.stateValue && typeof customState.stateValue === 'object'
            ? customState.stateValue.config ?? {}
            : {};
        const effectiveConfig = mergeHunterConfig(defaultConfig, customConfig);

        const rawLimit = Number(url.searchParams.get('limit') ?? 30);
        const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 30));
        const items = await store.listLatestAutomationRuns(limit);
        const summary = summarizeAutomationRuns(items, limit);
        const routing = summarizeAlertRouting(items, limit);
        const latest = items[0] ?? null;
        const latestFinishedMs = Number.isFinite(Date.parse(latest?.finishedAt ?? ''))
          ? Date.parse(latest.finishedAt)
          : null;
        const nowMs = Date.now();
        const freshnessSec = latestFinishedMs === null ? null : Math.max(0, Math.floor((nowMs - latestFinishedMs) / 1000));
        const freshnessTargetSec = Math.max(60, Number(effectiveConfig.cadenceMin ?? 30) * 2 * 60);
        const freshnessPass = freshnessSec !== null && freshnessSec <= freshnessTargetSec;
        const decisionPass = Number(summary?.kpi?.avgDecisionCount ?? 0) >= 1;
        const routingPass = Number(routing?.violations?.total ?? 0) === 0;
        const critStale = freshnessSec !== null && freshnessSec > freshnessTargetSec * 3;
        const overall = critStale ? 'CRIT' : freshnessPass && decisionPass && routingPass ? 'PASS' : 'WARN';

        return sendJson(res, 200, {
          status: 'ok',
          overall,
          window: { limit, runs: items.length },
          targets: {
            freshnessTargetSec,
            decisionMinAvgPerRun: 1,
            alertRoutingViolations: 0,
          },
          checks: {
            freshnessPass,
            decisionPass,
            routingPass,
          },
          metrics: {
            freshnessSec,
            avgDecisionCount: summary.kpi.avgDecisionCount,
            avgAlertCount: summary.kpi.avgAlertCount,
            purchaseAlertRatePct: summary.kpi.purchaseAlertRatePct,
            technicalAlertRatePct: summary.kpi.technicalAlertRatePct,
            routingViolations: routing.violations.total,
          },
          latestRun: latest
            ? {
                runId: latest.runId,
                startedAt: latest.startedAt,
                finishedAt: latest.finishedAt,
                decisionCount: latest.decisionCount,
                alertCount: latest.alertCount,
              }
            : null,
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-smart-engine') {
        if (!store.listLatestAutomationRuns) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const defaultConfig = buildDefaultHunterConfig();
        const customState = store.getRuntimeState ? await store.getRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY) : null;
        const customConfig =
          customState?.stateValue && typeof customState.stateValue === 'object'
            ? customState.stateValue.config ?? {}
            : {};
        const effectiveConfig = mergeHunterConfig(defaultConfig, customConfig);
        const runs = await store.listLatestAutomationRuns(1);
        const latestRun = runs[0] ?? null;

        let decisions = Array.isArray(latestRun?.decisions) ? latestRun.decisions : [];
        let source = latestRun ? 'latest_run' : 'preview';
        if (!decisions.length) {
          const previewCycle = runAutomationCycle(await store.listTrackings(), {
            tokenPolicyMode: effectiveConfig?.tokenPolicy?.mode ?? 'unbounded',
            budgetTokens: effectiveConfig?.tokenPolicy?.budgetTokens ?? null,
            degradationMode: 'preview',
            deferredUntil: null,
          });
          decisions = previewCycle.decisions;
          source = 'preview';
        }

        const topCandidates = [...decisions]
          .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
          .slice(0, 10)
          .map((item) => ({
            asin: item.asin,
            score: Number(item.score ?? 0),
            confidence: Number(item.confidence ?? 0),
            shouldAlert: Boolean(item.shouldAlert),
            reason: item.reason ?? null,
          }));

        return sendJson(res, 200, {
          status: 'ok',
          source,
          engine: {
            name: 'hunter-core-v1',
            mode: 'rule-ai-hybrid',
            autonomy: true,
          },
          policy: {
            confidenceThreshold: effectiveConfig.confidenceThreshold,
            minDealScore: effectiveConfig.minDealScore,
            tokenPolicy: effectiveConfig.tokenPolicy,
          },
          latestRun: latestRun
            ? {
                runId: latestRun.runId,
                startedAt: latestRun.startedAt,
                finishedAt: latestRun.finishedAt,
                decisionCount: latestRun.decisionCount,
                alertCount: latestRun.alertCount,
              }
            : null,
          topCandidates,
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-autonomy-decision-health') {
        if (!store.listLatestAutomationRuns) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const defaultConfig = buildDefaultHunterConfig();
        const customState = store.getRuntimeState ? await store.getRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY) : null;
        const customConfig =
          customState?.stateValue && typeof customState.stateValue === 'object'
            ? customState.stateValue.config ?? {}
            : {};
        const effectiveConfig = mergeHunterConfig(defaultConfig, customConfig);

        const runs = await store.listLatestAutomationRuns(30);
        const allDecisions = runs.flatMap((run) => (Array.isArray(run.decisions) ? run.decisions : []));
        const latest = runs[0] ?? null;
        const latestFinishedMs = Number.isFinite(Date.parse(latest?.finishedAt ?? ''))
          ? Date.parse(latest.finishedAt)
          : null;
        const nowMs = Date.now();
        const cadenceSec = Math.max(60, Number(effectiveConfig.cadenceMin ?? 30) * 60);
        const staleSec = latestFinishedMs === null ? null : Math.max(0, Math.floor((nowMs - latestFinishedMs) / 1000));

        const avgConfidence =
          allDecisions.length > 0
            ? Number(
                (
                  allDecisions.reduce((acc, item) => acc + Number(item.confidence ?? 0), 0) / allDecisions.length
                ).toFixed(4),
              )
            : 0;
        const alertSharePct =
          allDecisions.length > 0
            ? Number(
                (
                  (allDecisions.filter((item) => item.shouldAlert).length / Math.max(1, allDecisions.length)) *
                  100
                ).toFixed(2),
              )
            : 0;
        const confidenceTarget = Number(effectiveConfig.confidenceThreshold ?? 0.75);
        const lowConfidence = allDecisions.length > 0 && avgConfidence < confidenceTarget * 0.85;
        const staleWarn = staleSec !== null && staleSec > cadenceSec * 3;
        const staleCrit = staleSec !== null && staleSec > cadenceSec * 6;
        const insufficientData = runs.length < 3;

        const signals = [];
        if (insufficientData) signals.push({ level: 'warn', code: 'insufficient_run_history', value: runs.length });
        if (lowConfidence) signals.push({ level: 'warn', code: 'low_average_confidence', value: avgConfidence });
        if (staleWarn) signals.push({ level: staleCrit ? 'crit' : 'warn', code: 'stale_hunter_runs', value: staleSec });

        const hasCrit = signals.some((item) => item.level === 'crit');
        const hasWarn = signals.some((item) => item.level === 'warn');
        const overall = hasCrit ? 'CRIT' : hasWarn ? 'WARN' : 'PASS';

        return sendJson(res, 200, {
          status: 'ok',
          overall,
          metrics: {
            runs: runs.length,
            decisions: allDecisions.length,
            avgConfidence,
            confidenceTarget,
            alertSharePct,
            staleSec,
            cadenceSec,
          },
          signals,
          latestRun: latest
            ? {
                runId: latest.runId,
                finishedAt: latest.finishedAt,
                decisionCount: latest.decisionCount,
                alertCount: latest.alertCount,
              }
            : null,
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-trend-autotune-health') {
        const rawHours = Number(url.searchParams.get('hours') ?? 24 * 14);
        const hours = Math.max(24, Math.min(24 * 180, Number.isFinite(rawHours) ? rawHours : 24 * 14));
        const rawLimit = Number(url.searchParams.get('limit') ?? 240);
        const limit = Math.max(20, Math.min(1000, Number.isFinite(rawLimit) ? rawLimit : 240));
        const toMs = (iso) => {
          const ts = Date.parse(iso ?? '');
          return Number.isFinite(ts) ? ts : 0;
        };
        const avg = (arr = []) => {
          const nums = (Array.isArray(arr) ? arr : []).map(Number).filter((value) => Number.isFinite(value));
          return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
        };
        const now = Date.now();
        const minTs = now - hours * 60 * 60 * 1000;
        const getStateValue = async (stateKey, fallback = null) => {
          if (!store.getRuntimeState) return fallback;
          const state = await store.getRuntimeState(stateKey);
          return state?.stateValue ?? fallback;
        };

        const [historyRaw, last, rollbackPending, cooldownBoost, healthAction, auditRaw] = await Promise.all([
          getStateValue(HUNTER_TREND_AUTOTUNE_HISTORY_STATE_KEY, []),
          getStateValue(HUNTER_TREND_AUTOTUNE_LAST_STATE_KEY, null),
          getStateValue(HUNTER_TREND_AUTOTUNE_ROLLBACK_STATE_KEY, null),
          getStateValue(HUNTER_TREND_AUTOTUNE_COOLDOWN_BOOST_STATE_KEY, null),
          getStateValue(HUNTER_TREND_HEALTH_ACTION_LAST_STATE_KEY, null),
          getStateValue(HUNTER_TREND_HEALTH_AUDIT_STATE_KEY, []),
        ]);

        const history = (Array.isArray(historyRaw) ? historyRaw : [])
          .filter((row) => toMs(row?.at) >= minTs)
          .slice(0, limit)
          .sort((a, b) => toMs(a?.at) - toMs(b?.at));
        const audit = (Array.isArray(auditRaw) ? auditRaw : [])
          .filter((row) => toMs(row?.at) >= minTs)
          .slice(0, 120);

        const points = history
          .map((row) => ({
            at: row?.at,
            rollback: row?.rollback === true,
            changed: row?.changed === true,
            labelWeight: Number(row?.to?.labelWeight ?? row?.labelWeight),
            momentumWeight: Number(row?.to?.momentumWeight ?? row?.momentumWeight),
            slopeWeight: Number(row?.to?.slopeWeight ?? row?.slopeWeight),
            volatilityPenaltyWeight: Number(
              row?.to?.volatilityPenaltyWeight ?? row?.volatilityPenaltyWeight,
            ),
          }))
          .filter((row) =>
            [
              row.labelWeight,
              row.momentumWeight,
              row.slopeWeight,
              row.volatilityPenaltyWeight,
            ].every((value) => Number.isFinite(value)),
          );

        const rollbackCount = history.filter((row) => row?.rollback === true).length;
        const changedCount = history.filter((row) => row?.changed === true).length;
        const rollbackRate = history.length > 0 ? rollbackCount / history.length : 0;
        const changeRate = history.length > 0 ? changedCount / history.length : 0;

        let drift = {
          labelWeight: 0,
          momentumWeight: 0,
          slopeWeight: 0,
          volatilityPenaltyWeight: 0,
          composite: 0,
        };
        let stability = {
          avgAbsDeltaLabel: 0,
          avgAbsDeltaMomentum: 0,
          avgAbsDeltaSlope: 0,
          avgAbsDeltaVolatility: 0,
          avgAbsDeltaComposite: 0,
        };

        if (points.length >= 2) {
          const first = points[0];
          const lastPoint = points[points.length - 1];
          drift = {
            labelWeight: Number(Math.abs(lastPoint.labelWeight - first.labelWeight).toFixed(4)),
            momentumWeight: Number(Math.abs(lastPoint.momentumWeight - first.momentumWeight).toFixed(4)),
            slopeWeight: Number(Math.abs(lastPoint.slopeWeight - first.slopeWeight).toFixed(4)),
            volatilityPenaltyWeight: Number(
              Math.abs(lastPoint.volatilityPenaltyWeight - first.volatilityPenaltyWeight).toFixed(4),
            ),
            composite: 0,
          };
          drift.composite = Number(
            (
              drift.labelWeight +
              drift.momentumWeight +
              drift.slopeWeight +
              drift.volatilityPenaltyWeight
            ).toFixed(4),
          );

          const deltas = [];
          for (let idx = 1; idx < points.length; idx += 1) {
            const prev = points[idx - 1];
            const current = points[idx];
            deltas.push({
              label: Math.abs(current.labelWeight - prev.labelWeight),
              momentum: Math.abs(current.momentumWeight - prev.momentumWeight),
              slope: Math.abs(current.slopeWeight - prev.slopeWeight),
              volatility: Math.abs(current.volatilityPenaltyWeight - prev.volatilityPenaltyWeight),
            });
          }
          stability = {
            avgAbsDeltaLabel: Number(avg(deltas.map((item) => item.label)).toFixed(4)),
            avgAbsDeltaMomentum: Number(avg(deltas.map((item) => item.momentum)).toFixed(4)),
            avgAbsDeltaSlope: Number(avg(deltas.map((item) => item.slope)).toFixed(4)),
            avgAbsDeltaVolatility: Number(avg(deltas.map((item) => item.volatility)).toFixed(4)),
            avgAbsDeltaComposite: Number(
              avg(deltas.map((item) => item.label + item.momentum + item.slope + item.volatility)).toFixed(4),
            ),
          };
        }

        const runsRaw = store.listLatestAutomationRuns ? await store.listLatestAutomationRuns(400) : [];
        const runs = runsRaw
          .filter((run) => {
            const ts = toMs(run?.startedAt ?? run?.finishedAt);
            return ts > 0 && ts >= minTs;
          })
          .filter((run) => !String(run?.status ?? '').startsWith('error'))
          .filter((run) => !String(run?.status ?? '').startsWith('skipped'));
        const totalDeals = runs.reduce((sum, run) => sum + Number(run?.decisionCount ?? 0), 0);
        const totalTokens = runs.reduce((sum, run) => {
          const direct = Number(run?.tokensSpent ?? run?.tokenCost);
          if (Number.isFinite(direct)) return sum + direct;
          const snapshotTotal = Number(run?.tokenSnapshot?.summary?.totalTokenCostSelected);
          return Number.isFinite(snapshotTotal) ? sum + snapshotTotal : sum;
        }, 0);
        const zeroRuns = runs.filter((run) => Number(run?.decisionCount ?? 0) <= 0).length;
        const runMetrics = {
          runs: runs.length,
          avgDealsPerRun: runs.length > 0 ? Number((totalDeals / runs.length).toFixed(3)) : 0,
          tokensPerDeal: totalDeals > 0 ? Number((totalTokens / totalDeals).toFixed(3)) : null,
          zeroRate: runs.length > 0 ? Number((zeroRuns / runs.length).toFixed(4)) : 0,
        };

        const rollbackPenalty = Math.min(45, rollbackRate * 120);
        const stabilityPenalty = Math.min(30, stability.avgAbsDeltaComposite * 140);
        const driftPenalty = Math.min(25, drift.composite * 10);
        const healthScore = Math.max(
          0,
          Math.min(100, Math.round(100 - rollbackPenalty - stabilityPenalty - driftPenalty)),
        );
        const status = healthScore >= 75 ? 'ok' : healthScore >= 50 ? 'warn' : 'degraded';

        return sendJson(res, 200, {
          windowHours: hours,
          status,
          healthScore,
          samples: {
            history: history.length,
            weightPoints: points.length,
            runs: runs.length,
          },
          rates: {
            rollbackRate: Number(rollbackRate.toFixed(4)),
            changeRate: Number(changeRate.toFixed(4)),
          },
          rollback: {
            count: rollbackCount,
            pending: Boolean(rollbackPending?.at),
            pendingState: rollbackPending || null,
          },
          cooldownBoost: {
            active: Number.parseInt(cooldownBoost?.remainingRuns, 10) > 0,
            state: cooldownBoost || null,
          },
          autoreact: {
            lastAction: healthAction || null,
            audit,
          },
          drift,
          stability,
          penalties: {
            rollback: Number(rollbackPenalty.toFixed(2)),
            stability: Number(stabilityPenalty.toFixed(2)),
            drift: Number(driftPenalty.toFixed(2)),
          },
          runMetrics,
          latest: last || null,
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-trend-features') {
        const rawHours = Number(url.searchParams.get('hours') ?? 24 * 7);
        const hours = Math.max(24, Math.min(24 * 180, Number.isFinite(rawHours) ? rawHours : 24 * 7));
        const rawLimit = Number(url.searchParams.get('limit') ?? 400);
        const limit = Math.max(20, Math.min(5000, Number.isFinite(rawLimit) ? rawLimit : 400));
        const domainRaw = String(url.searchParams.get('domain') ?? '').trim().toLowerCase();
        const domain = ['de', 'it', 'fr', 'es', 'uk', 'nl'].includes(domainRaw) ? domainRaw : null;
        const trendRaw = String(url.searchParams.get('trend') ?? '').trim().toLowerCase();
        const trend = ['down_strong', 'down', 'stable', 'up', 'up_strong'].includes(trendRaw) ? trendRaw : null;
        const asins = String(url.searchParams.get('asins') ?? '')
          .split(',')
          .map((item) => item.trim().toUpperCase())
          .filter((asin) => /^[A-Z0-9]{10}$/.test(asin))
          .slice(0, 300);
        const asinFilter = asins.length ? new Set(asins) : null;

        const trackings = await store.listTrackings();
        const scopedTrackings = asinFilter ? trackings.filter((item) => asinFilter.has(String(item.asin ?? '').toUpperCase())) : trackings;

        const rows = [];
        for (const tracking of scopedTrackings) {
          const historyPoints = store.getPriceHistory
            ? await store.getPriceHistory(tracking.asin, Math.max(48, Math.ceil(hours / 24) * 24))
            : [];
          rows.push(...buildHunterTrendFeatureRows({ tracking, historyPoints, lookbackHours: hours }));
        }

        const filteredRows = rows
          .filter((row) => (domain ? row.domain === domain : true))
          .filter((row) => (trend ? row.trendLabel === trend : true))
          .sort((a, b) => Math.abs(Number(b.slopePctPerDay ?? 0)) - Math.abs(Number(a.slopePctPerDay ?? 0)))
          .slice(0, limit);

        const summaryMap = filteredRows.reduce((acc, row) => {
          const key = row.trendLabel ?? 'unknown';
          if (!acc.has(key)) {
            acc.set(key, { trendLabel: key, count: 0, slopeSum: 0, momentumSum: 0, volatilitySum: 0 });
          }
          const item = acc.get(key);
          item.count += 1;
          item.slopeSum += Number(row.slopePctPerDay ?? 0);
          item.momentumSum += Number(row.momentum24hPct ?? 0);
          item.volatilitySum += Number(row.volatilityPct ?? 0);
          return acc;
        }, new Map());

        const summary = [...summaryMap.values()]
          .map((item) => ({
            trendLabel: item.trendLabel,
            count: item.count,
            avgSlopePctPerDay: item.count ? Number((item.slopeSum / item.count).toFixed(4)) : 0,
            avgMomentum24hPct: item.count ? Number((item.momentumSum / item.count).toFixed(4)) : 0,
            avgVolatilityPct: item.count ? Number((item.volatilitySum / item.count).toFixed(4)) : 0,
          }))
          .sort((a, b) => b.count - a.count);

        return sendJson(res, 200, {
          status: 'ok',
          lookbackHours: hours,
          filtered: {
            domain: domain ?? 'all',
            trend: trend ?? 'all',
            asins: asins.length,
          },
          count: filteredRows.length,
          summary,
          rows: filteredRows,
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-efficiency') {
        if (!store.listLatestAutomationRuns) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const rawHours = Number(url.searchParams.get('hours') ?? 24 * 14);
        const hours = Math.max(1, Math.min(24 * 90, Number.isFinite(rawHours) ? rawHours : 24 * 14));
        const nowMs = Date.now();
        const minTs = nowMs - hours * 60 * 60 * 1000;
        const recentRuns = (await store.listLatestAutomationRuns(400)).filter((run) => {
          const ts = Date.parse(run?.startedAt ?? run?.finishedAt ?? '');
          return Number.isFinite(ts) && ts >= minTs;
        });

        const runs = recentRuns.map((run) => ({
          runId: run.runId ?? null,
          startedAt: run.startedAt ?? null,
          finishedAt: run.finishedAt ?? null,
          trigger: run.trigger ?? 'scheduled',
          trackingCount: Number(run.trackingCount ?? 0),
          decisionCount: Number(run.decisionCount ?? 0),
          alertCount: Number(run.alertCount ?? 0),
          purchaseAlertCount: Number(run.purchaseAlertCount ?? 0),
          technicalAlertCount: Number(run.technicalAlertCount ?? 0),
          source: run.source ?? 'automation-cycle-v1',
        }));

        const triggerSummary = runs.reduce((acc, row) => {
          const key = String(row.trigger || 'scheduled');
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});

        const runsCount = runs.length;
        const decisionSum = runs.reduce((acc, row) => acc + Number(row.decisionCount ?? 0), 0);
        const alertSum = runs.reduce((acc, row) => acc + Number(row.alertCount ?? 0), 0);
        const purchaseAlertSum = runs.reduce((acc, row) => acc + Number(row.purchaseAlertCount ?? 0), 0);
        const technicalAlertSum = runs.reduce((acc, row) => acc + Number(row.technicalAlertCount ?? 0), 0);

        const presets = [
          {
            preset: 'runtime-default',
            runs: runsCount,
            avgDecisionCount: runsCount ? Number((decisionSum / runsCount).toFixed(2)) : 0,
            avgAlertCount: runsCount ? Number((alertSum / runsCount).toFixed(2)) : 0,
            purchaseAlertRatePct: alertSum ? Number(((purchaseAlertSum / alertSum) * 100).toFixed(2)) : 0,
            technicalAlertRatePct: alertSum ? Number(((technicalAlertSum / alertSum) * 100).toFixed(2)) : 0,
          },
        ];

        return sendJson(res, 200, {
          status: 'ok',
          windowHours: hours,
          runs,
          presets,
          triggers: triggerSummary,
          schedulerHunter: {},
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-category-pauses') {
        const now = Date.now();
        const rows = await Promise.all(
          HUNTER_CATEGORY_GROUPS.map(async (group) => {
            const stateKey = `${HUNTER_CATEGORY_GROUP_PAUSE_PREFIX}${group}`;
            const state = store.getRuntimeState ? await store.getRuntimeState(stateKey) : null;
            const payload = state?.stateValue && typeof state.stateValue === 'object' ? state.stateValue : {};
            const until = String(payload?.until ?? '');
            const untilTs = Date.parse(until);
            const isPaused = Number.isFinite(untilTs) && untilTs > now;
            return {
              group,
              isPaused,
              until: isPaused ? until : null,
              reason: isPaused ? String(payload?.reason ?? '') || null : null,
              queries24h: Number(payload?.queries24h ?? 0),
              hitRate24h: Number(payload?.hitRate24h ?? 0),
            };
          }),
        );
        const paused = rows.filter((item) => item.isPaused);
        return sendJson(res, 200, {
          totalGroups: rows.length,
          pausedCount: paused.length,
          paused,
          rows,
        });
      }

      if (method === 'POST' && pathname === '/api/hunter-category-pauses/unpause') {
        const body = await readJsonBody(req).catch(() => ({}));
        const requested = String(body?.group ?? '').trim().toLowerCase();
        const group = HUNTER_CATEGORY_GROUPS.includes(requested) ? requested : null;
        if (!group) {
          return sendJson(res, 400, { error: 'Invalid group' });
        }
        const stateKey = `${HUNTER_CATEGORY_GROUP_PAUSE_PREFIX}${group}`;
        if (store.setRuntimeState) {
          await store.setRuntimeState(stateKey, {
            until: null,
            reason: null,
            queries24h: 0,
            hitRate24h: 0,
            unpausedAt: new Date().toISOString(),
          });
        }
        return sendJson(res, 200, { success: true, group, unpaused: true });
      }

      if (method === 'GET' && pathname === '/api/hunter/deals-feed') {
        const rawLimit = Number(url.searchParams.get('limit') ?? 60);
        const limit = Math.max(1, Math.min(200, Number.isFinite(rawLimit) ? rawLimit : 60));
        const sourceRaw = String(url.searchParams.get('source') ?? 'all').trim().toLowerCase();
        const source = new Set(['all', 'hot', 'momentum']).has(sourceRaw) ? sourceRaw : 'all';

        const [hotState, momentumState] = store.getRuntimeState
          ? await Promise.all([
              store.getRuntimeState('hunter:hot:deals:v1'),
              store.getRuntimeState('hunter:momentum:v1'),
            ])
          : [null, null];
        const hotRaw = hotState?.stateValue ?? null;
        const momentumRaw = momentumState?.stateValue ?? null;
        const hotRows = mapHunterDealsFromState(hotRaw, 'hot');
        const momentumRows = mapHunterDealsFromState(momentumRaw, 'momentum');

        let rows = [];
        if (source === 'all' || source === 'hot') rows.push(...hotRows);
        if (source === 'all' || source === 'momentum') rows.push(...momentumRows);

        let outcomeFallbackRows = [];
        let fallbackRows = [];
        if (source === 'all' && rows.length === 0) {
          const trackings = store.listTrackings ? await store.listTrackings() : [];
          fallbackRows = mapHunterDealsFromTrackingsFallback(trackings, limit);
          if (fallbackRows.length) rows.push(...fallbackRows);
        }

        rows = dedupeHunterDealsByAsin(rows)
          .sort((a, b) => {
            const ta = Date.parse(a?.updatedAt ?? '');
            const tb = Date.parse(b?.updatedAt ?? '');
            if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
            return Math.abs(Number(b?.drop ?? 0)) - Math.abs(Number(a?.drop ?? 0));
          })
          .slice(0, limit);

        return sendJson(res, 200, {
          rows,
          meta: {
            source,
            limit,
            total: rows.length,
            hotCount: hotRows.length,
            momentumCount: momentumRows.length,
            outcomeFallbackCount: outcomeFallbackRows.length,
            fallbackCount: fallbackRows.length,
            generatedAt: new Date().toISOString(),
          },
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-ml-engine') {
        if (!store.listLatestAutomationRuns) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const rawHours = Number(url.searchParams.get('hours') ?? 24 * 7);
        const hours = Math.max(24, Math.min(24 * 180, Number.isFinite(rawHours) ? rawHours : 24 * 7));
        const nowMs = Date.now();
        const minTs = nowMs - hours * 60 * 60 * 1000;
        const recentRuns = (await store.listLatestAutomationRuns(500)).filter((run) => {
          const ts = Date.parse(run?.startedAt ?? run?.finishedAt ?? '');
          return Number.isFinite(ts) && ts >= minTs;
        });

        const decisions = recentRuns.flatMap((run) => (Array.isArray(run?.decisions) ? run.decisions : []));
        const alerts = recentRuns.flatMap((run) => (Array.isArray(run?.alerts) ? run.alerts : []));
        const avgDecisionScore =
          decisions.length > 0
            ? Number(
                (
                  decisions.reduce((acc, item) => acc + Number(item?.score ?? 0), 0) /
                  decisions.length
                ).toFixed(4),
              )
            : 0;
        const avgConfidence =
          decisions.length > 0
            ? Number(
                (
                  decisions.reduce((acc, item) => acc + Number(item?.confidence ?? 0), 0) /
                  decisions.length
                ).toFixed(4),
              )
            : 0;
        const shortlistedDeals = decisions.filter((item) => Boolean(item?.shouldAlert)).length;
        const uniqueAsins = new Set(
          decisions
            .map((item) => String(item?.asin ?? '').trim().toUpperCase())
            .filter((asin) => /^[A-Z0-9]{10}$/.test(asin)),
        );
        const sourceRows = [
          {
            source: 'runtime',
            runs: recentRuns.length,
            decisions: decisions.length,
            shortlistedDeals,
            alerts: alerts.length,
            avgDecisionScore,
            avgConfidence,
            activeAsins: uniqueAsins.size,
          },
        ];

        const modelConfigState = store.getRuntimeState
          ? await store.getRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY)
          : null;
        const customConfig =
          modelConfigState?.stateValue && typeof modelConfigState.stateValue === 'object'
            ? modelConfigState.stateValue.config ?? {}
            : {};
        const rolloutState = store.getRuntimeState
          ? await store.getRuntimeState(HUNTER_STRATEGY_STATUS_STATE_KEY)
          : null;
        const smartEngineState = store.getRuntimeState
          ? await store.getRuntimeState(HUNTER_STRATEGY_LAST_STATE_KEY)
          : null;

        return sendJson(res, 200, {
          windowHours: hours,
          model: {
            family: 'heuristic_bandit_v1',
            version: 'v1',
            rolloutMode: customConfig?.ai?.rolloutMode ?? 'shadow',
            canaryPct: Number(customConfig?.ai?.canaryPct ?? 20),
            enabled: customConfig?.ai?.enabled !== false,
          },
          summary: {
            hours,
            totals: {
              runs: recentRuns.length,
              decisions: decisions.length,
              shortlistedDeals,
              alerts: alerts.length,
            },
            decisions: sourceRows,
            banditArmsTop: [],
          },
          rollout: {
            state: rolloutState?.stateValue ?? null,
            metrics: {
              runs: recentRuns.length,
              avgDecisionScore,
              avgConfidence,
            },
          },
          smartEngine: smartEngineState?.stateValue ?? null,
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-high-value-metrics') {
        if (!store.listLatestAutomationRuns || !store.listTrackings) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const rawHours = Number(url.searchParams.get('hours') ?? 24 * 14);
        const hours = Math.max(1, Math.min(24 * 180, Number.isFinite(rawHours) ? rawHours : 24 * 14));
        const nowMs = Date.now();
        const minTs = nowMs - hours * 60 * 60 * 1000;
        const recentRuns = (await store.listLatestAutomationRuns(500)).filter((run) => {
          const ts = Date.parse(run?.startedAt ?? run?.finishedAt ?? '');
          return Number.isFinite(ts) && ts >= minTs;
        });
        const trackings = await store.listTrackings();

        const decisions = recentRuns.flatMap((run) => (Array.isArray(run?.decisions) ? run.decisions : []));
        const shortlisted = decisions.filter((item) => Boolean(item?.shouldAlert));
        const tokens = recentRuns.reduce((sum, run) => {
          const direct = Number(run?.tokensSpent ?? run?.tokenCost);
          if (Number.isFinite(direct)) return sum + direct;
          const snapshotTotal = Number(run?.tokenSnapshot?.summary?.totalTokenCostSelected);
          return Number.isFinite(snapshotTotal) ? sum + snapshotTotal : sum;
        }, 0);

        const prices = trackings
          .flatMap((tracking) => Object.values(tracking?.pricesNew ?? {}))
          .map(Number)
          .filter((value) => Number.isFinite(value) && value > 0);
        const avgPrice =
          prices.length > 0
            ? Number((prices.reduce((sum, value) => sum + value, 0) / prices.length).toFixed(2))
            : 0;

        const discounts = trackings
          .flatMap((tracking) =>
            Object.values(tracking?.pricesNew ?? {})
              .map((current) => {
                const currentValue = Number(current);
                const target = Number(tracking?.targetPriceNew ?? 0);
                if (!Number.isFinite(currentValue) || currentValue <= 0 || !Number.isFinite(target) || target <= 0) {
                  return null;
                }
                return ((target - currentValue) / currentValue) * 100;
              })
              .filter((value) => Number.isFinite(value)),
          )
          .filter((value) => Number.isFinite(value));
        const avgDiscount =
          discounts.length > 0
            ? Number((discounts.reduce((sum, value) => sum + value, 0) / discounts.length).toFixed(2))
            : 0;

        const highValueHits = shortlisted.filter((item) => Number(item?.score ?? 0) >= 0.8).length;
        const deals = shortlisted.length;
        const runs = recentRuns.length;
        const tokensPerDeal = deals > 0 ? Number((tokens / deals).toFixed(2)) : 0;

        return sendJson(res, 200, {
          windowHours: hours,
          runs,
          deals,
          tokens: Number(tokens.toFixed(2)),
          avgPrice,
          avgDiscount,
          highValueHits,
          tokensPerDeal,
          hitShare: deals > 0 ? Number((highValueHits / deals).toFixed(4)) : 0,
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-bandit-context') {
        const [lastState, strategyStatusState, replayState] = store.getRuntimeState
          ? await Promise.all([
              store.getRuntimeState(HUNTER_STRATEGY_LAST_STATE_KEY),
              store.getRuntimeState(HUNTER_STRATEGY_STATUS_STATE_KEY),
              store.getRuntimeState(HUNTER_STRATEGY_REPLAY_STATE_KEY),
            ])
          : [null, null, null];

        return sendJson(res, 200, {
          last: lastState?.stateValue ?? null,
          status: strategyStatusState?.stateValue ?? null,
          replay: replayState?.stateValue ?? null,
          schedulerHunter: {},
          schedulerRuntime: {},
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-keyword-stats') {
        if (!store.listTrackings || !store.listLatestAutomationRuns) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const rawLimit = Number(url.searchParams.get('limit') ?? 120);
        const limit = Math.max(10, Math.min(500, Number.isFinite(rawLimit) ? rawLimit : 120));
        const runs = await store.listLatestAutomationRuns(400);
        const trackings = await store.listTrackings();

        const alertsByAsin = runs.reduce((acc, run) => {
          for (const alert of run?.alerts ?? []) {
            const asin = String(alert?.asin ?? '').trim().toUpperCase();
            if (!asin || asin === 'SYSTEM') continue;
            acc.set(asin, (acc.get(asin) ?? 0) + 1);
          }
          return acc;
        }, new Map());

        const keywordRows = [];
        for (const tracking of trackings) {
          const asin = String(tracking?.asin ?? '').trim().toUpperCase();
          if (!asin) continue;
          const baseBoost = alertsByAsin.get(asin) ?? 0;
          const keywords = extractKeywordsFromTitle(tracking?.title);
          for (const keyword of keywords) {
            const queries = 1 + baseBoost;
            const hits = baseBoost > 0 ? Math.max(1, Math.floor(queries * 0.4)) : 0;
            const hitRate = queries > 0 ? Number((hits / queries).toFixed(4)) : 0;
            keywordRows.push({
              group: classifyKeywordGroup(keyword),
              keyword,
              queries,
              hits,
              hitRate,
              lastAt: tracking?.updatedAt ?? new Date().toISOString(),
              blockedUntil: null,
            });
          }
        }

        const deduped = keywordRows.reduce((acc, row) => {
          const key = `${row.group}:${row.keyword}`;
          if (!acc.has(key)) {
            acc.set(key, { ...row });
            return acc;
          }
          const current = acc.get(key);
          current.queries += row.queries;
          current.hits += row.hits;
          current.hitRate = current.queries > 0 ? Number((current.hits / current.queries).toFixed(4)) : 0;
          if (Date.parse(row.lastAt ?? '') > Date.parse(current.lastAt ?? '')) current.lastAt = row.lastAt;
          acc.set(key, current);
          return acc;
        }, new Map());

        const rows = [...deduped.values()]
          .sort((a, b) => {
            if (a.hitRate !== b.hitRate) return a.hitRate - b.hitRate;
            return b.queries - a.queries;
          })
          .slice(0, limit);

        const defaultConfig = buildDefaultHunterConfig();
        const customState = store.getRuntimeState ? await store.getRuntimeState(HUNTER_CUSTOM_CONFIG_STATE_KEY) : null;
        const customConfig =
          customState?.stateValue && typeof customState.stateValue === 'object'
            ? customState.stateValue.config ?? {}
            : {};
        const effectiveConfig = mergeHunterConfig(defaultConfig, customConfig);
        const groupsSelected = deriveHunterGroupsFromConfig(effectiveConfig);
        const limits = effectiveConfig?.hunterCategoryLimits && typeof effectiveConfig.hunterCategoryLimits === 'object'
          ? effectiveConfig.hunterCategoryLimits
          : {};

        const groupStats = rows.reduce((acc, row) => {
          if (!acc.has(row.group)) acc.set(row.group, { queries24h: 0, hits24h: 0 });
          const current = acc.get(row.group);
          current.queries24h += Number(row.queries ?? 0);
          current.hits24h += Number(row.hits ?? 0);
          acc.set(row.group, current);
          return acc;
        }, new Map());

        const groupSuggestions = groupsSelected.map((group) => {
          const curLimit = Math.max(0, Math.min(8, Number.parseInt(limits?.[group], 10) || 0));
          const agg = groupStats.get(group) ?? { queries24h: 0, hits24h: 0 };
          const queries24h = Number(agg.queries24h || 0);
          const hits24h = Number(agg.hits24h || 0);
          const hitRate24h = queries24h > 0 ? hits24h / queries24h : 0;
          let suggestedLimit = curLimit;
          let reason = 'keep';
          if (queries24h >= 6) {
            if (hitRate24h >= 0.2 && curLimit < 8) {
              suggestedLimit = curLimit + 1;
              reason = 'raise_high_hit_rate';
            } else if (hitRate24h <= 0.04 && curLimit > 0) {
              suggestedLimit = curLimit - 1;
              reason = 'lower_low_hit_rate';
            }
          } else {
            reason = 'insufficient_data';
          }

          return {
            group,
            currentLimit: curLimit,
            suggestedLimit,
            delta: suggestedLimit - curLimit,
            queries24h,
            hits24h,
            hitRate24h: Number(hitRate24h.toFixed(4)),
            reason,
          };
        });

        return sendJson(res, 200, {
          count: rows.length,
          rows,
          groupSuggestions,
        });
      }

      if (method === 'GET' && pathname === '/api/hunter-signals') {
        if (!store.listLatestAutomationRuns) {
          return sendJson(res, 501, { error: 'not_implemented' });
        }

        const runs = await store.listLatestAutomationRuns(500);
        const nowMs = Date.now();
        const minTs = nowMs - 24 * 60 * 60 * 1000;
        const rows = runs.filter((run) => {
          const ts = Date.parse(run?.startedAt ?? run?.finishedAt ?? '');
          return Number.isFinite(ts) && ts >= minTs;
        });

        const totalRuns = rows.length;
        const okRuns = rows.filter((item) => String(item?.status ?? 'ok') === 'ok').length;
        const errorRuns = rows.filter((item) => String(item?.status ?? '').startsWith('error')).length;
        const skippedBudgetRuns = rows.filter((item) => String(item?.status ?? '') === 'skipped_budget').length;
        const successRate = totalRuns > 0 ? okRuns / totalRuns : 0;

        const statusCount = rows.reduce((acc, row) => {
          const key = String(row?.status ?? 'ok');
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});

        const deals = rows.reduce((acc, row) => acc + Number(row?.decisionCount ?? 0), 0);
        const tokensEstimate = rows.reduce((acc, row) => acc + Number(row?.decisionCount ?? 0) * 10, 0);
        const tokensPerDeal = deals > 0 ? tokensEstimate / deals : null;
        const avgDeals = totalRuns > 0 ? deals / totalRuns : 0;

        const priceValid = rows.reduce((acc, row) => {
          const decisions = Number(row?.decisionCount ?? 0);
          return acc + Math.max(0, decisions);
        }, 0);
        const priceMissing = 0;
        const priceSuspect = 0;
        const qualityTotal = priceValid + priceMissing + priceSuspect;
        const qualityValidPct = qualityTotal > 0 ? priceValid / qualityTotal : null;
        const qualitySuspectPct = qualityTotal > 0 ? priceSuspect / qualityTotal : null;

        const policySamples = rows.length;
        const strategyCounts = rows.reduce((acc, row) => {
          const mode = String(row?.source ?? 'runtime-default');
          acc[mode] = (acc[mode] || 0) + 1;
          return acc;
        }, {});
        const dominantStrategy =
          Object.entries(strategyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

        const target = String(url.searchParams.get('target') ?? '').trim().toLowerCase();
        const evaluation =
          policySamples < 5
            ? {
                status: 'insufficient_data',
                target: target || 'auto',
                message: 'Not enough policy samples in runtime v1 window.',
              }
            : {
                status: 'ok',
                target: target || 'auto',
                message: 'Policy signal is within expected range.',
              };

        return sendJson(res, 200, {
          windowHours: 24,
          runs: {
            total: totalRuns,
            ok: okRuns,
            errors: errorRuns,
            skippedBudget: skippedBudgetRuns,
            successRate: Number(successRate.toFixed(4)),
            avgDeals: Number(avgDeals.toFixed(2)),
            tokensPerDeal: tokensPerDeal === null ? null : Number(tokensPerDeal.toFixed(2)),
            priceQuality: {
              samples: qualityTotal,
              valid: priceValid,
              missing: priceMissing,
              suspect: priceSuspect,
              validPct: qualityValidPct === null ? null : Number(qualityValidPct.toFixed(4)),
              suspectPct: qualitySuspectPct === null ? null : Number(qualitySuspectPct.toFixed(4)),
            },
            statusCount,
          },
          policy: {
            samples24h: policySamples,
            dominantStrategy,
            evaluation,
          },
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
