import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { SEEDED_TRACKINGS } from './in-memory-store.mjs';
import { applyRuntimeMigrations } from './db-migrations.mjs';
import { evaluateSelfHealRetryAttempt } from './self-heal-playbooks.mjs';

function toNumber(value) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function sampleHistory(base) {
  const now = Date.now();
  return Array.from({ length: 12 }, (_, idx) => ({
    ts: new Date(now - (11 - idx) * 24 * 60 * 60 * 1000).toISOString(),
    value: Number((base * (0.9 + (idx % 5) * 0.03)).toFixed(2)),
  }));
}

function groupPriceRows(rows, condition) {
  return rows
    .filter((row) => row.condition === condition)
    .reduce((acc, row) => {
      acc[row.market] = toNumber(row.price);
      return acc;
    }, {});
}

function toSummary(pricesNew) {
  const values = Object.values(pricesNew);
  if (!values.length) {
    return { min: null, max: null, avg: null };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = Number((values.reduce((acc, v) => acc + v, 0) / values.length).toFixed(2));
  return { min, max, avg };
}

function buildTrackingRow(baseRow, thresholdRow, priceRows) {
  return {
    asin: baseRow.asin,
    title: baseRow.title,
    pricesNew: groupPriceRows(priceRows, 'new'),
    pricesUsed: groupPriceRows(priceRows, 'used'),
    thresholdDropPct: toNumber(thresholdRow?.threshold_drop_pct),
    thresholdRisePct: toNumber(thresholdRow?.threshold_rise_pct),
    targetPriceNew: toNumber(thresholdRow?.target_price_new),
    targetPriceUsed: toNumber(thresholdRow?.target_price_used),
    updatedAt: (thresholdRow?.updated_at ?? baseRow.updated_at ?? new Date()).toISOString(),
  };
}

function summarizeRun(base, decisions, alerts) {
  return {
    runId: base.run_id,
    source: base.source,
    status: base.status,
    startedAt: base.started_at.toISOString(),
    finishedAt: base.finished_at.toISOString(),
    trackingCount: base.tracking_count,
    decisionCount: base.decision_count,
    alertCount: base.alert_count,
    purchaseAlertCount: base.purchase_alert_count,
    technicalAlertCount: base.technical_alert_count,
    decisions,
    alerts,
  };
}

function summarizeSelfHealRun(base, executedPlaybooks) {
  const normalizedPlaybooks = normalizeExecutedPlaybooks(executedPlaybooks);
  const playbookCount =
    Number.isFinite(Number(base.playbook_count)) && Number(base.playbook_count) > 0
      ? Number(base.playbook_count)
      : normalizedPlaybooks.length;
  return {
    runId: base.run_id,
    source: base.source,
    status: base.status,
    startedAt: base.started_at.toISOString(),
    finishedAt: base.finished_at.toISOString(),
    playbookCount,
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
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid day value: ${value}`);
  }
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
  const parsed = Date.parse(`${dayKey}T00:00:00.000Z`);
  return new Date(parsed + 24 * 60 * 60 * 1000).toISOString();
}

export function createPostgresStore({
  connectionString = process.env.SOON_DATABASE_URL,
  ssl = process.env.SOON_DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
  readModelRefreshMode = process.env.SOON_READ_MODEL_REFRESH_MODE ?? 'async',
} = {}) {
  if (!connectionString) {
    throw new Error('SOON_DATABASE_URL is required for postgres mode');
  }

  const refreshMode = String(readModelRefreshMode).toLowerCase() === 'sync' ? 'sync' : 'async';
  const pool = new Pool({ connectionString, ssl });
  let initialized = false;
  let refreshQueue = Promise.resolve();
  const pendingRefreshDays = new Set();
  let refreshLastError = null;
  let refreshLastErrorAt = null;
  let refreshLastQueuedAt = null;
  let refreshLastStartedAt = null;
  let refreshLastFinishedAt = null;
  let refreshLastDurationMs = null;
  let refreshLastBatchDays = 0;
  let refreshInFlight = false;
  let refreshTotalRuns = 0;
  let refreshTotalErrors = 0;

  async function seedIfEmpty() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(51827601)');

      const countRes = await client.query('SELECT COUNT(*)::int AS count FROM soon_tracking');
      if (countRes.rows[0].count > 0) {
        await client.query('COMMIT');
        return;
      }

      for (const item of SEEDED_TRACKINGS) {
        await client.query(
        `
        INSERT INTO soon_tracking (asin, title, created_at, updated_at)
        VALUES ($1, $2, now(), now())
        ON CONFLICT (asin) DO UPDATE SET title = EXCLUDED.title, updated_at = now()
      `,
          [item.asin, item.title],
        );

        await client.query(
        `
        INSERT INTO soon_tracking_threshold (
          asin,
          threshold_drop_pct,
          threshold_rise_pct,
          target_price_new,
          target_price_used,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (asin) DO UPDATE SET
          threshold_drop_pct = EXCLUDED.threshold_drop_pct,
          threshold_rise_pct = EXCLUDED.threshold_rise_pct,
          target_price_new = EXCLUDED.target_price_new,
          target_price_used = EXCLUDED.target_price_used,
          updated_at = now()
      `,
          [
            item.asin,
            item.thresholdDropPct ?? null,
            item.thresholdRisePct ?? null,
            item.targetPriceNew ?? null,
            item.targetPriceUsed ?? null,
          ],
        );

        for (const [market, price] of Object.entries(item.pricesNew ?? {})) {
          await client.query(
          `
          INSERT INTO soon_tracking_price (asin, market, condition, price, currency, updated_at)
          VALUES ($1, $2, 'new', $3, 'EUR', now())
          ON CONFLICT (asin, market, condition) DO UPDATE SET
            price = EXCLUDED.price,
            currency = EXCLUDED.currency,
            updated_at = now()
        `,
            [item.asin, market, price],
          );
        }

        for (const [market, price] of Object.entries(item.pricesUsed ?? {})) {
          await client.query(
          `
          INSERT INTO soon_tracking_price (asin, market, condition, price, currency, updated_at)
          VALUES ($1, $2, 'used', $3, 'EUR', now())
          ON CONFLICT (asin, market, condition) DO UPDATE SET
            price = EXCLUDED.price,
            currency = EXCLUDED.currency,
            updated_at = now()
        `,
            [item.asin, market, price],
          );
        }

        const base = item.pricesNew?.de ?? Object.values(item.pricesNew ?? {})[0] ?? 100;
        const history = sampleHistory(base);
        for (const point of history) {
          await client.query(
          `
          INSERT INTO soon_price_history (asin, market, condition, price, currency, recorded_at)
          VALUES ($1, 'de', 'new', $2, 'EUR', $3::timestamptz)
        `,
            [item.asin, point.value, point.ts],
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function ensureInit() {
    if (initialized) return;

    await applyRuntimeMigrations(pool);
    await seedIfEmpty();
    await refreshDailyReadModelRecent(30);

    initialized = true;
  }

  async function refreshDailyReadModelDay(day) {
    const dayKey = toDayKey(day);
    const runCountRes = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM soon_hunter_run
      WHERE started_at::date = $1::date
    `,
      [dayKey],
    );

    if ((runCountRes.rows[0]?.count ?? 0) === 0) {
      await pool.query('DELETE FROM soon_hunter_run_daily_asin WHERE day = $1::date', [dayKey]);
      await pool.query('DELETE FROM soon_hunter_run_daily WHERE day = $1::date', [dayKey]);
      return;
    }

    await pool.query(
      `
      WITH runs AS (
        SELECT
          COUNT(*)::int AS runs,
          COALESCE(SUM(tracking_count), 0)::int AS tracking_count_sum,
          COALESCE(SUM(decision_count), 0)::int AS decision_count_sum,
          COALESCE(SUM(alert_count), 0)::int AS alert_count_sum,
          COALESCE(SUM(purchase_alert_count), 0)::int AS purchase_alert_count_sum,
          COALESCE(SUM(technical_alert_count), 0)::int AS technical_alert_count_sum
        FROM soon_hunter_run
        WHERE started_at::date = $1::date
      ),
      alerts AS (
        SELECT
          COALESCE(SUM(CASE WHEN a.channel = 'telegram' THEN 1 ELSE 0 END), 0)::int AS telegram_alert_count_sum,
          COALESCE(SUM(CASE WHEN a.channel = 'discord' THEN 1 ELSE 0 END), 0)::int AS discord_alert_count_sum
        FROM soon_hunter_run r
        LEFT JOIN soon_alert_dispatch_audit a ON a.run_id = r.run_id
        WHERE r.started_at::date = $1::date
      )
      INSERT INTO soon_hunter_run_daily (
        day,
        runs,
        tracking_count_sum,
        decision_count_sum,
        alert_count_sum,
        purchase_alert_count_sum,
        technical_alert_count_sum,
        telegram_alert_count_sum,
        discord_alert_count_sum,
        updated_at
      )
      SELECT
        $1::date,
        runs.runs,
        runs.tracking_count_sum,
        runs.decision_count_sum,
        runs.alert_count_sum,
        runs.purchase_alert_count_sum,
        runs.technical_alert_count_sum,
        alerts.telegram_alert_count_sum,
        alerts.discord_alert_count_sum,
        now()
      FROM runs, alerts
      ON CONFLICT (day) DO UPDATE SET
        runs = EXCLUDED.runs,
        tracking_count_sum = EXCLUDED.tracking_count_sum,
        decision_count_sum = EXCLUDED.decision_count_sum,
        alert_count_sum = EXCLUDED.alert_count_sum,
        purchase_alert_count_sum = EXCLUDED.purchase_alert_count_sum,
        technical_alert_count_sum = EXCLUDED.technical_alert_count_sum,
        telegram_alert_count_sum = EXCLUDED.telegram_alert_count_sum,
        discord_alert_count_sum = EXCLUDED.discord_alert_count_sum,
        updated_at = now()
    `,
      [dayKey],
    );

    await pool.query('DELETE FROM soon_hunter_run_daily_asin WHERE day = $1::date', [dayKey]);
    await pool.query(
      `
      INSERT INTO soon_hunter_run_daily_asin (day, asin, alert_count, updated_at)
      SELECT
        $1::date AS day,
        a.asin,
        COUNT(*)::int AS alert_count,
        now()
      FROM soon_hunter_run r
      JOIN soon_alert_dispatch_audit a ON a.run_id = r.run_id
      WHERE r.started_at::date = $1::date
        AND a.asin <> 'system'
      GROUP BY a.asin
    `,
      [dayKey],
    );
  }

  async function refreshDailyReadModelRecent(days = 30) {
    const safeDays = Math.max(1, Math.min(90, Number(days) || 30));
    const daysRes = await pool.query(
      `
      SELECT DISTINCT started_at::date AS day
      FROM soon_hunter_run
      WHERE started_at >= (now() - make_interval(days => $1::int))
      ORDER BY day DESC
    `,
      [safeDays],
    );

    for (const row of daysRes.rows) {
      await refreshDailyReadModelDay(row.day);
    }
  }

  function enqueueDailyReadModelRefresh(day) {
    const dayKey = toDayKey(day);
    pendingRefreshDays.add(dayKey);
    refreshLastQueuedAt = new Date().toISOString();

    refreshQueue = refreshQueue
      .then(async () => {
        if (!pendingRefreshDays.size) {
          return;
        }

        const days = [...pendingRefreshDays];
        pendingRefreshDays.clear();
        refreshInFlight = true;
        refreshLastStartedAt = new Date().toISOString();
        refreshLastBatchDays = days.length;
        const startedMs = Date.now();

        try {
          for (const nextDay of days) {
            await refreshDailyReadModelDay(nextDay);
          }
          refreshLastError = null;
          refreshLastErrorAt = null;
          refreshTotalRuns += 1;
        } catch (error) {
          refreshLastError = error;
          refreshLastErrorAt = new Date().toISOString();
          refreshTotalErrors += 1;
          throw error;
        } finally {
          refreshInFlight = false;
          refreshLastFinishedAt = new Date().toISOString();
          refreshLastDurationMs = Date.now() - startedMs;
        }
      })
      .catch((error) => {
        console.error('[Soon/api] read-model refresh failed', error);
      });

    return refreshQueue;
  }

  async function flushDailyReadModelRefresh() {
    await refreshQueue;
    if (refreshLastError) {
      throw refreshLastError;
    }
  }

  async function getReadModelRefreshStatus() {
    await ensureInit();

    return {
      mode: refreshMode,
      pendingCount: pendingRefreshDays.size,
      pendingDays: [...pendingRefreshDays].sort(),
      inFlight: refreshInFlight,
      lastQueuedAt: refreshLastQueuedAt,
      lastStartedAt: refreshLastStartedAt,
      lastFinishedAt: refreshLastFinishedAt,
      lastDurationMs: refreshLastDurationMs,
      lastBatchDays: refreshLastBatchDays,
      totalRuns: refreshTotalRuns,
      totalErrors: refreshTotalErrors,
      lastError: refreshLastError
        ? {
            message: refreshLastError instanceof Error ? refreshLastError.message : String(refreshLastError),
            at: refreshLastErrorAt,
          }
        : null,
    };
  }

  async function fetchThresholdMap(asins) {
    if (!asins.length) return new Map();

    const res = await pool.query(
      `
      SELECT asin, threshold_drop_pct, threshold_rise_pct, target_price_new, target_price_used, updated_at
      FROM soon_tracking_threshold
      WHERE asin = ANY($1::text[])
    `,
      [asins],
    );

    return new Map(res.rows.map((row) => [row.asin, row]));
  }

  async function fetchPriceRows(asins) {
    if (!asins.length) return [];

    const res = await pool.query(
      `
      SELECT asin, market, condition, price, updated_at
      FROM soon_tracking_price
      WHERE asin = ANY($1::text[])
      ORDER BY asin ASC, condition ASC, market ASC
    `,
      [asins],
    );

    return res.rows;
  }

  async function listTrackings() {
    await ensureInit();

    const baseRes = await pool.query(
      'SELECT asin, title, updated_at FROM soon_tracking ORDER BY updated_at DESC',
    );

    const asins = baseRes.rows.map((row) => row.asin);
    const thresholdMap = await fetchThresholdMap(asins);
    const priceRows = await fetchPriceRows(asins);

    return baseRes.rows.map((baseRow) => {
      const asinPriceRows = priceRows.filter((row) => row.asin === baseRow.asin);
      return buildTrackingRow(baseRow, thresholdMap.get(baseRow.asin), asinPriceRows);
    });
  }

  async function getTracking(asin) {
    await ensureInit();

    const baseRes = await pool.query('SELECT asin, title, updated_at FROM soon_tracking WHERE asin = $1', [asin]);
    if (!baseRes.rowCount) return null;

    const thresholdRes = await pool.query(
      `
      SELECT asin, threshold_drop_pct, threshold_rise_pct, target_price_new, target_price_used, updated_at
      FROM soon_tracking_threshold
      WHERE asin = $1
    `,
      [asin],
    );

    const priceRes = await pool.query(
      `
      SELECT asin, market, condition, price, updated_at
      FROM soon_tracking_price
      WHERE asin = $1
      ORDER BY condition ASC, market ASC
    `,
      [asin],
    );

    return buildTrackingRow(baseRes.rows[0], thresholdRes.rows[0], priceRes.rows);
  }

  async function getProductDetail(asin) {
    await ensureInit();

    const tracking = await getTracking(asin);
    if (!tracking) return null;

    const historyRes = await pool.query(
      `
      SELECT market, condition, price, recorded_at
      FROM soon_price_history
      WHERE asin = $1
      ORDER BY recorded_at DESC
      LIMIT 180
    `,
      [asin],
    );

    const historyPoints = historyRes.rows
      .filter((row) => row.condition === 'new')
      .map((row) => ({
        ts: row.recorded_at.toISOString(),
        value: toNumber(row.price),
      }))
      .reverse();

    return {
      asin: tracking.asin,
      title: tracking.title,
      pricesNew: tracking.pricesNew,
      pricesUsed: tracking.pricesUsed,
      thresholds: {
        thresholdDropPct: tracking.thresholdDropPct,
        thresholdRisePct: tracking.thresholdRisePct,
        targetPriceNew: tracking.targetPriceNew,
        targetPriceUsed: tracking.targetPriceUsed,
      },
      summary: toSummary(tracking.pricesNew),
      historyPoints,
      updatedAt: tracking.updatedAt,
    };
  }

  async function updateThresholds(asin, thresholdPayload) {
    await ensureInit();

    const exists = await pool.query('SELECT 1 FROM soon_tracking WHERE asin = $1', [asin]);
    if (!exists.rowCount) return null;

    await pool.query(
      `
      INSERT INTO soon_tracking_threshold (
        asin,
        threshold_drop_pct,
        threshold_rise_pct,
        target_price_new,
        target_price_used,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (asin) DO UPDATE SET
        threshold_drop_pct = COALESCE(EXCLUDED.threshold_drop_pct, soon_tracking_threshold.threshold_drop_pct),
        threshold_rise_pct = COALESCE(EXCLUDED.threshold_rise_pct, soon_tracking_threshold.threshold_rise_pct),
        target_price_new = COALESCE(EXCLUDED.target_price_new, soon_tracking_threshold.target_price_new),
        target_price_used = COALESCE(EXCLUDED.target_price_used, soon_tracking_threshold.target_price_used),
        updated_at = now()
    `,
      [
        asin,
        thresholdPayload.thresholdDropPct ?? null,
        thresholdPayload.thresholdRisePct ?? null,
        thresholdPayload.targetPriceNew ?? null,
        thresholdPayload.targetPriceUsed ?? null,
      ],
    );

    await pool.query('UPDATE soon_tracking SET updated_at = now() WHERE asin = $1', [asin]);

    return getProductDetail(asin);
  }

  async function saveTracking(payload = {}) {
    await ensureInit();

    const asin = String(payload.asin ?? '').trim();
    if (!asin) return { error: 'asin_required' };

    const title =
      String(payload.title ?? payload.productTitle ?? '').trim() || `Tracking ${asin}`;

    await pool.query(
      `
      INSERT INTO soon_tracking (asin, title, created_at, updated_at)
      VALUES ($1, $2, now(), now())
      ON CONFLICT (asin) DO UPDATE SET
        title = COALESCE(NULLIF(EXCLUDED.title, ''), soon_tracking.title),
        updated_at = now()
    `,
      [asin, title],
    );

    const thresholdDropPct = Number(payload.thresholdDropPct ?? payload.dropPct);
    const thresholdRisePct = Number(payload.thresholdRisePct ?? payload.risePct);
    const targetPriceNew = Number(payload.targetPriceNew);
    const targetPriceUsed = Number(payload.targetPriceUsed);
    const hasThresholdPayload =
      Number.isFinite(thresholdDropPct) ||
      Number.isFinite(thresholdRisePct) ||
      Number.isFinite(targetPriceNew) ||
      Number.isFinite(targetPriceUsed);

    if (hasThresholdPayload) {
      await pool.query(
        `
        INSERT INTO soon_tracking_threshold (
          asin,
          threshold_drop_pct,
          threshold_rise_pct,
          target_price_new,
          target_price_used,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (asin) DO UPDATE SET
          threshold_drop_pct = COALESCE(EXCLUDED.threshold_drop_pct, soon_tracking_threshold.threshold_drop_pct),
          threshold_rise_pct = COALESCE(EXCLUDED.threshold_rise_pct, soon_tracking_threshold.threshold_rise_pct),
          target_price_new = COALESCE(EXCLUDED.target_price_new, soon_tracking_threshold.target_price_new),
          target_price_used = COALESCE(EXCLUDED.target_price_used, soon_tracking_threshold.target_price_used),
          updated_at = now()
      `,
        [
          asin,
          Number.isFinite(thresholdDropPct) ? thresholdDropPct : null,
          Number.isFinite(thresholdRisePct) ? thresholdRisePct : null,
          Number.isFinite(targetPriceNew) ? targetPriceNew : null,
          Number.isFinite(targetPriceUsed) ? targetPriceUsed : null,
        ],
      );
    }

    const upsertPrices = async (condition, prices) => {
      if (!prices || typeof prices !== 'object') return;
      for (const [marketRaw, rawPrice] of Object.entries(prices)) {
        const market = String(marketRaw ?? '').trim().toLowerCase();
        const price = Number(rawPrice);
        if (!market || !Number.isFinite(price)) continue;
        await pool.query(
          `
          INSERT INTO soon_tracking_price (asin, market, condition, price, currency, updated_at)
          VALUES ($1, $2, $3, $4, 'EUR', now())
          ON CONFLICT (asin, market, condition) DO UPDATE SET
            price = EXCLUDED.price,
            updated_at = now()
        `,
          [asin, market, condition, price],
        );
        await pool.query(
          `
          INSERT INTO soon_price_history (asin, market, condition, price, currency, recorded_at)
          VALUES ($1, $2, $3, $4, 'EUR', now())
        `,
          [asin, market, condition, price],
        );
      }
    };

    await upsertPrices('new', payload.pricesNew);
    await upsertPrices('used', payload.pricesUsed);

    return getProductDetail(asin);
  }

  async function deleteTracking(asin) {
    await ensureInit();
    const key = String(asin ?? '').trim();
    if (!key) return { deleted: false, reason: 'asin_required' };
    const result = await pool.query('DELETE FROM soon_tracking WHERE asin = $1', [key]);
    return { deleted: result.rowCount > 0 };
  }

  async function getPriceHistory(asin, limit = 180) {
    await ensureInit();
    const key = String(asin ?? '').trim();
    if (!key) return null;
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 180));
    const rows = await pool.query(
      `
      SELECT market, condition, price, currency, recorded_at
      FROM soon_price_history
      WHERE asin = $1
      ORDER BY recorded_at DESC
      LIMIT $2
    `,
      [key, safeLimit],
    );
    if (!rows.rowCount) return [];
    return rows.rows.map((row) => ({
      market: row.market,
      condition: row.condition,
      price: toNumber(row.price),
      currency: row.currency,
      ts: row.recorded_at.toISOString(),
    }));
  }

  async function recordAutomationCycle({ cycle, trackingCount, startedAt, finishedAt }) {
    await ensureInit();

    const runId = randomUUID();
    const purchaseAlertCount = cycle.alerts.filter((item) => item.kind === 'purchase').length;
    const technicalAlertCount = cycle.alerts.filter((item) => item.kind === 'technical').length;

    await pool.query(
      `
      INSERT INTO soon_hunter_run (
        run_id,
        source,
        status,
        tracking_count,
        decision_count,
        alert_count,
        purchase_alert_count,
        technical_alert_count,
        started_at,
        finished_at
      ) VALUES ($1, 'automation-cycle-v1', 'ok', $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
    `,
      [
        runId,
        trackingCount,
        cycle.decisions.length,
        cycle.alerts.length,
        purchaseAlertCount,
        technicalAlertCount,
        startedAt,
        finishedAt,
      ],
    );

    const tokenByAsin = new Map(cycle.tokenPlan.map((item) => [item.asin, item]));

    for (const decision of cycle.decisions) {
      const tokenRow = tokenByAsin.get(decision.asin);
      await pool.query(
        `
        INSERT INTO soon_hunter_decision (
          run_id,
          asin,
          score,
          confidence,
          should_alert,
          reason,
          token_cost,
          expected_value,
          token_priority
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
        [
          runId,
          decision.asin,
          decision.score,
          decision.confidence,
          decision.shouldAlert,
          decision.reason,
          tokenRow?.tokenCost ?? null,
          tokenRow?.expectedValue ?? null,
          tokenRow?.priority ?? null,
        ],
      );
    }

    for (const alert of cycle.alerts) {
      await pool.query(
        `
        INSERT INTO soon_alert_dispatch_audit (
          run_id,
          asin,
          kind,
          channel,
          reason,
          status
        ) VALUES ($1, $2, $3, $4, $5, 'queued')
      `,
        [runId, alert.asin, alert.kind, alert.channel, alert.reason ?? null],
      );
    }

    if (refreshMode === 'sync') {
      await enqueueDailyReadModelRefresh(startedAt);
      await flushDailyReadModelRefresh();
    } else {
      void enqueueDailyReadModelRefresh(startedAt);
    }

    return {
      runId,
      source: 'automation-cycle-v1',
      status: 'ok',
      startedAt,
      finishedAt,
      trackingCount,
      decisionCount: cycle.decisions.length,
      alertCount: cycle.alerts.length,
      purchaseAlertCount,
      technicalAlertCount,
      decisions: cycle.decisions,
      alerts: cycle.alerts,
    };
  }

  async function listLatestAutomationRuns(limit = 20) {
    await ensureInit();

    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));

    const runRes = await pool.query(
      `
      SELECT *
      FROM soon_hunter_run
      ORDER BY started_at DESC
      LIMIT $1
    `,
      [safeLimit],
    );

    if (!runRes.rowCount) {
      return [];
    }

    const runIds = runRes.rows.map((row) => row.run_id);

    const decisionRes = await pool.query(
      `
      SELECT run_id, asin, score, confidence, should_alert, reason, token_cost, expected_value, token_priority, created_at
      FROM soon_hunter_decision
      WHERE run_id = ANY($1::text[])
      ORDER BY created_at DESC
    `,
      [runIds],
    );

    const alertRes = await pool.query(
      `
      SELECT run_id, asin, kind, channel, reason, status, created_at
      FROM soon_alert_dispatch_audit
      WHERE run_id = ANY($1::text[])
      ORDER BY created_at DESC
    `,
      [runIds],
    );

    const decisionsByRun = new Map();
    for (const row of decisionRes.rows) {
      const decision = {
        asin: row.asin,
        score: toNumber(row.score),
        confidence: toNumber(row.confidence),
        shouldAlert: row.should_alert,
        reason: row.reason,
        tokenCost: toNumber(row.token_cost),
        expectedValue: toNumber(row.expected_value),
        priority: toNumber(row.token_priority),
      };

      if (!decisionsByRun.has(row.run_id)) {
        decisionsByRun.set(row.run_id, []);
      }
      decisionsByRun.get(row.run_id).push(decision);
    }

    const alertsByRun = new Map();
    for (const row of alertRes.rows) {
      const alert = {
        asin: row.asin,
        kind: row.kind,
        channel: row.channel,
        reason: row.reason,
        status: row.status,
      };

      if (!alertsByRun.has(row.run_id)) {
        alertsByRun.set(row.run_id, []);
      }
      alertsByRun.get(row.run_id).push(alert);
    }

    return runRes.rows.map((row) =>
      summarizeRun(
        row,
        decisionsByRun.get(row.run_id) ?? [],
        alertsByRun.get(row.run_id) ?? [],
      ),
    );
  }

  async function getAutomationDailyReadModel(days = 30) {
    await ensureInit();
    await flushDailyReadModelRefresh();

    const safeDays = Math.max(1, Math.min(90, Number(days) || 30));
    const dailyRes = await pool.query(
      `
      SELECT
        day,
        runs,
        tracking_count_sum,
        decision_count_sum,
        alert_count_sum,
        purchase_alert_count_sum,
        technical_alert_count_sum,
        telegram_alert_count_sum,
        discord_alert_count_sum
      FROM soon_hunter_run_daily
      WHERE day >= (current_date - ($1::int - 1))
      ORDER BY day DESC
      LIMIT $1
    `,
      [safeDays],
    );

    if (!dailyRes.rowCount) {
      return {
        generatedAt: new Date().toISOString(),
        days: safeDays,
        items: [],
      };
    }

    const daysList = dailyRes.rows.map((row) => toDayKey(row.day));
    const asinRes = await pool.query(
      `
      SELECT day, asin, alert_count
      FROM soon_hunter_run_daily_asin
      WHERE day = ANY($1::date[])
      ORDER BY day DESC, alert_count DESC, asin ASC
    `,
      [daysList],
    );

    const asinByDay = new Map();
    for (const row of asinRes.rows) {
      const dayKey = toDayKey(row.day);
      if (!asinByDay.has(dayKey)) {
        asinByDay.set(dayKey, []);
      }
      asinByDay.get(dayKey).push({
        asin: row.asin,
        alerts: Number(row.alert_count),
      });
    }

    const items = dailyRes.rows.map((row) => {
      const day = toDayKey(row.day);
      const runs = Number(row.runs);
      const trackingCountSum = Number(row.tracking_count_sum);
      const decisionCountSum = Number(row.decision_count_sum);
      const alertCountSum = Number(row.alert_count_sum);
      const purchaseAlertCountSum = Number(row.purchase_alert_count_sum);
      const technicalAlertCountSum = Number(row.technical_alert_count_sum);
      return {
        day,
        runs,
        sums: {
          trackingCount: trackingCountSum,
          decisionCount: decisionCountSum,
          alertCount: alertCountSum,
          purchaseAlertCount: purchaseAlertCountSum,
          technicalAlertCount: technicalAlertCountSum,
        },
        kpi: {
          avgTrackingCount: runs > 0 ? Number((trackingCountSum / runs).toFixed(2)) : 0,
          avgDecisionCount: runs > 0 ? Number((decisionCountSum / runs).toFixed(2)) : 0,
          avgAlertCount: runs > 0 ? Number((alertCountSum / runs).toFixed(2)) : 0,
          purchaseAlertRatePct:
            alertCountSum > 0 ? Number(((purchaseAlertCountSum / alertCountSum) * 100).toFixed(2)) : 0,
          technicalAlertRatePct:
            alertCountSum > 0 ? Number(((technicalAlertCountSum / alertCountSum) * 100).toFixed(2)) : 0,
        },
        alertsByChannel: {
          telegram: Number(row.telegram_alert_count_sum),
          discord: Number(row.discord_alert_count_sum),
        },
        topAlertedAsins: (asinByDay.get(day) ?? []).slice(0, 5),
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      days: safeDays,
      items,
    };
  }

  async function recordSelfHealRun(payload) {
    await ensureInit();

    const runId = randomUUID();
    const executedPlaybooks = normalizeExecutedPlaybooks(payload?.executedPlaybooks);
    const source = payload?.source ?? 'self-heal-worker-v1';
    const status = payload?.status ?? resolveSelfHealStatus(executedPlaybooks);
    const startedAt = payload?.startedAt ?? new Date().toISOString();
    const finishedAt = payload?.finishedAt ?? new Date().toISOString();

    await pool.query(
      `
      INSERT INTO soon_self_heal_run (
        run_id,
        source,
        status,
        playbook_count,
        started_at,
        finished_at
      ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
    `,
      [runId, source, status, executedPlaybooks.length, startedAt, finishedAt],
    );

    for (const playbook of executedPlaybooks) {
      await pool.query(
        `
        INSERT INTO soon_self_heal_playbook_execution (
          run_id,
          playbook_id,
          status,
          attempt_count,
          max_retries,
          retries_used,
          priority_score,
          retry_backoff_sec,
          matched_anomaly_codes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[])
      `,
        [
          runId,
          playbook.playbookId,
          playbook.status,
          playbook.attempts ?? 1,
          playbook.maxRetries ?? 0,
          playbook.retriesUsed ?? 0,
          playbook.priorityScore ?? 0,
          playbook.retryBackoffSec ?? 0,
          playbook.matchedAnomalyCodes ?? [],
        ],
      );
    }

    return {
      runId,
      source,
      status,
      startedAt,
      finishedAt,
      playbookCount: executedPlaybooks.length,
      executedPlaybooks,
    };
  }

  async function listLatestSelfHealRuns(limit = 20) {
    await ensureInit();

    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const runRes = await pool.query(
      `
      SELECT run_id, source, status, playbook_count, started_at, finished_at
      FROM soon_self_heal_run
      ORDER BY started_at DESC
      LIMIT $1
    `,
      [safeLimit],
    );

    if (!runRes.rowCount) {
      return [];
    }

    const runIds = runRes.rows.map((row) => row.run_id);
    const playbookRes = await pool.query(
      `
      SELECT
        run_id,
        playbook_id,
        status,
        attempt_count,
        max_retries,
        retries_used,
        priority_score,
        retry_backoff_sec,
        matched_anomaly_codes,
        created_at
      FROM soon_self_heal_playbook_execution
      WHERE run_id = ANY($1::text[])
      ORDER BY created_at DESC
    `,
      [runIds],
    );

    const playbooksByRun = new Map();
    for (const row of playbookRes.rows) {
      if (!playbooksByRun.has(row.run_id)) {
        playbooksByRun.set(row.run_id, []);
      }
      playbooksByRun.get(row.run_id).push({
        playbookId: row.playbook_id,
        status: row.status,
        attempts: Number(row.attempt_count ?? 1),
        maxRetries: Number(row.max_retries ?? 0),
        retriesUsed: Number(row.retries_used ?? 0),
        priorityScore: toNumber(row.priority_score) ?? 0,
        retryBackoffSec: Number(row.retry_backoff_sec ?? 0),
        matchedAnomalyCodes: Array.isArray(row.matched_anomaly_codes)
          ? row.matched_anomaly_codes.filter((code) => typeof code === 'string')
          : [],
      });
    }

    return runRes.rows.map((row) => summarizeSelfHealRun(row, playbooksByRun.get(row.run_id) ?? []));
  }

  async function enqueueSelfHealRetryJobs({ runId, source, jobs }) {
    await ensureInit();

    const normalized = normalizeExecutedPlaybooks(jobs);
    const retryJobs = normalized.filter((item) => item.status === 'failed' && item.maxRetries > item.retriesUsed);
    for (const item of retryJobs) {
      await pool.query(
        `
        INSERT INTO soon_self_heal_retry_queue (
          run_id,
          source,
          playbook_id,
          status,
          attempt_count,
          max_retries,
          retries_used,
          retry_backoff_sec,
          priority_score,
          matched_anomaly_codes,
          next_retry_at,
          last_error,
          updated_at
        ) VALUES (
          $1,
          $2,
          $3,
          'queued',
          $4,
          $5,
          $6,
          $7,
          $8,
          $9::text[],
          now() + (($10::int || ' seconds')::interval),
          'initial_failed',
          now()
        )
      `,
        [
          runId,
          source ?? 'self-heal-worker-v1',
          item.playbookId,
          item.attempts ?? 1,
          item.maxRetries ?? 0,
          item.retriesUsed ?? 0,
          item.retryBackoffSec ?? 0,
          item.priorityScore ?? 0,
          item.matchedAnomalyCodes ?? [],
          item.retryBackoffSec ?? 0,
        ],
      );
    }

    const pendingRes = await pool.query(
      "SELECT COUNT(*)::int AS count FROM soon_self_heal_retry_queue WHERE status = 'queued'",
    );
    return {
      enqueued: retryJobs.length,
      queueSize: Number(pendingRes.rows[0]?.count ?? 0),
    };
  }

  async function processSelfHealRetryQueue({ limit = 20, now = Date.now() } = {}) {
    await ensureInit();

    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const nowIso = new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()).toISOString();
    const dueRes = await pool.query(
      `
      SELECT
        id,
        run_id,
        source,
        playbook_id,
        attempt_count,
        max_retries,
        retries_used,
        retry_backoff_sec,
        priority_score,
        matched_anomaly_codes,
        next_retry_at
      FROM soon_self_heal_retry_queue
      WHERE status = 'queued' AND next_retry_at <= $1::timestamptz
      ORDER BY priority_score DESC NULLS LAST, next_retry_at ASC
      LIMIT $2
    `,
      [nowIso, safeLimit],
    );

    let processed = 0;
    let completed = 0;
    let rescheduled = 0;
    let deadLettered = 0;
    let retryExhausted = 0;
    let retryBackoffSeconds = 0;

    for (const row of dueRes.rows) {
      processed += 1;
      const retryJob = {
        playbookId: row.playbook_id,
        attempts: Number(row.attempt_count ?? 1),
        maxRetries: Number(row.max_retries ?? 0),
        retriesUsed: Number(row.retries_used ?? 0),
        retryBackoffSec: Number(row.retry_backoff_sec ?? 0),
        matchedAnomalyCodes: Array.isArray(row.matched_anomaly_codes) ? row.matched_anomaly_codes : [],
      };
      const outcome = evaluateSelfHealRetryAttempt(retryJob);

      await pool.query(
        `
        INSERT INTO soon_self_heal_playbook_execution (
          run_id,
          playbook_id,
          status,
          attempt_count,
          max_retries,
          retries_used,
          priority_score,
          retry_backoff_sec,
          matched_anomaly_codes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[])
      `,
        [
          row.run_id,
          row.playbook_id,
          outcome.status,
          outcome.attempts,
          outcome.maxRetries,
          outcome.retriesUsed,
          toNumber(row.priority_score) ?? 0,
          Number(row.retry_backoff_sec ?? 0),
          Array.isArray(row.matched_anomaly_codes) ? row.matched_anomaly_codes : [],
        ],
      );

      if (outcome.outcome === 'done') {
        await pool.query(
          `
          UPDATE soon_self_heal_retry_queue
          SET
            status = 'done',
            attempt_count = $2,
            retries_used = $3,
            last_error = NULL,
            updated_at = now()
          WHERE id = $1
        `,
          [row.id, outcome.attempts, outcome.retriesUsed],
        );
        completed += 1;
        continue;
      }

      if (outcome.outcome === 'retry') {
        await pool.query(
          `
          UPDATE soon_self_heal_retry_queue
          SET
            status = 'queued',
            attempt_count = $2,
            retries_used = $3,
            next_retry_at = now() + (($4::int || ' seconds')::interval),
            last_error = 'retry_failed',
            updated_at = now()
          WHERE id = $1
        `,
          [row.id, outcome.attempts, outcome.retriesUsed, outcome.retryBackoffSec],
        );
        retryBackoffSeconds = Math.max(retryBackoffSeconds, Math.max(0, Number(outcome.retryBackoffSec ?? 0)));
        rescheduled += 1;
        continue;
      }

      await pool.query(
        `
        UPDATE soon_self_heal_retry_queue
        SET
          status = 'dead_letter',
          attempt_count = $2,
          retries_used = $3,
          last_error = $4,
          updated_at = now()
        WHERE id = $1
      `,
        [row.id, outcome.attempts, outcome.retriesUsed, outcome.reason ?? 'dead_letter'],
      );

      await pool.query(
        `
        INSERT INTO soon_self_heal_dead_letter (
          queue_id,
          run_id,
          source,
          playbook_id,
          final_attempt_count,
          max_retries,
          reason,
          payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
        [
          row.id,
          row.run_id,
          row.source,
          row.playbook_id,
          outcome.attempts,
          outcome.maxRetries,
          outcome.reason ?? 'dead_letter',
          JSON.stringify({
            matchedAnomalyCodes: Array.isArray(row.matched_anomaly_codes) ? row.matched_anomaly_codes : [],
            priorityScore: toNumber(row.priority_score) ?? 0,
            retryBackoffSec: Number(row.retry_backoff_sec ?? 0),
          }),
        ],
      );
      deadLettered += 1;
      if ((outcome.reason ?? 'dead_letter') === 'retry_budget_exhausted') {
        retryExhausted += 1;
      }
    }

    const pendingRes = await pool.query(
      "SELECT COUNT(*)::int AS count FROM soon_self_heal_retry_queue WHERE status = 'queued'",
    );

    return {
      processed,
      completed,
      rescheduled,
      deadLettered,
      retryExhausted,
      retryBackoffSeconds,
      queuePending: Number(pendingRes.rows[0]?.count ?? 0),
    };
  }

  async function getSelfHealRetryStatus() {
    await ensureInit();
    const countsRes = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0)::int AS pending,
        COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0)::int AS done,
        COALESCE(SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END), 0)::int AS dead_letter,
        COALESCE(
          MAX(
            CASE
              WHEN status = 'queued'
              THEN GREATEST(EXTRACT(EPOCH FROM (next_retry_at - now())), 0)
              ELSE 0
            END
          ),
          0
        )::int AS retry_backoff_seconds
      FROM soon_self_heal_retry_queue
    `,
    );
    const dlqRes = await pool.query('SELECT COUNT(*)::int AS count FROM soon_self_heal_dead_letter');
    const exhaustedRes = await pool.query(
      "SELECT COUNT(*)::int AS count FROM soon_self_heal_dead_letter WHERE reason = 'retry_budget_exhausted'",
    );
    const requeueRes = await pool.query('SELECT COUNT(*)::int AS count FROM soon_self_heal_requeue_audit');

    return {
      queuePending: Number(countsRes.rows[0]?.pending ?? 0),
      queueDone: Number(countsRes.rows[0]?.done ?? 0),
      queueDeadLetter: Number(countsRes.rows[0]?.dead_letter ?? 0),
      retryBackoffSeconds: Number(countsRes.rows[0]?.retry_backoff_seconds ?? 0),
      deadLetterCount: Number(dlqRes.rows[0]?.count ?? 0),
      retryExhaustedTotal: Number(exhaustedRes.rows[0]?.count ?? 0),
      manualRequeueTotal: Number(requeueRes.rows[0]?.count ?? 0),
      scheduler: 'postgres-interval',
    };
  }

  async function listSelfHealDeadLetters(limit = 20) {
    await ensureInit();
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const res = await pool.query(
      `
      SELECT
        id,
        queue_id,
        run_id,
        source,
        playbook_id,
        final_attempt_count,
        max_retries,
        reason,
        payload,
        created_at
      FROM soon_self_heal_dead_letter
      ORDER BY created_at DESC
      LIMIT $1
    `,
      [safeLimit],
    );

    return res.rows.map((row) => ({
      deadLetterId: String(row.id),
      queueId: row.queue_id === null ? null : String(row.queue_id),
      runId: row.run_id,
      source: row.source,
      playbookId: row.playbook_id,
      finalAttemptCount: Number(row.final_attempt_count),
      maxRetries: Number(row.max_retries),
      reason: row.reason,
      payload: row.payload ?? {},
      createdAt: row.created_at.toISOString(),
    }));
  }

  async function requeueSelfHealDeadLetter(deadLetterId, { now = Date.now() } = {}) {
    await ensureInit();
    const id = Number(deadLetterId);
    if (!Number.isInteger(id) || id <= 0) return null;

    const nowIso = new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()).toISOString();
    const deadLetterRes = await pool.query(
      `
      SELECT id, queue_id
      FROM soon_self_heal_dead_letter
      WHERE id = $1
    `,
      [id],
    );
    if (deadLetterRes.rowCount === 0) return null;

    const queueId = deadLetterRes.rows[0].queue_id;
    if (queueId === null) return null;

    const updateRes = await pool.query(
      `
      UPDATE soon_self_heal_retry_queue
      SET
        status = 'queued',
        max_retries = GREATEST(max_retries, retries_used + 1),
        next_retry_at = $2::timestamptz,
        last_error = 'manual_requeue',
        updated_at = now()
      WHERE id = $1 AND status = 'dead_letter'
      RETURNING id, run_id, source, playbook_id, status, max_retries, retries_used, next_retry_at
    `,
      [queueId, nowIso],
    );
    if (updateRes.rowCount === 0) {
      const queueRes = await pool.query('SELECT status FROM soon_self_heal_retry_queue WHERE id = $1', [queueId]);
      if (queueRes.rowCount > 0) {
        return {
          error: 'not_dead_letter',
          deadLetterId: String(id),
          queueJobId: String(queueId),
          currentStatus: queueRes.rows[0].status,
        };
      }
      return null;
    }

    const row = updateRes.rows[0];
    await pool.query(
      `
      INSERT INTO soon_self_heal_requeue_audit (
        dead_letter_id,
        queue_id,
        run_id,
        source,
        playbook_id,
        reason
      ) VALUES ($1, $2, $3, $4, $5, 'manual_requeue')
    `,
      [id, row.id, row.run_id, row.source, row.playbook_id],
    );

    return {
      deadLetterId: String(id),
      queueJobId: String(row.id),
      status: row.status,
      nextRetryAt: row.next_retry_at.toISOString(),
      maxRetries: Number(row.max_retries),
      retriesUsed: Number(row.retries_used),
    };
  }

  async function listSelfHealRequeueAudit(limit = 20, filters = {}) {
    await ensureInit();
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const whereClauses = [];
    const params = [];

    const reason = typeof filters?.reason === 'string' ? filters.reason.trim() : '';
    if (reason) {
      params.push(reason);
      whereClauses.push(`reason = $${params.length}`);
    }

    const fromMs = Number.isFinite(Number(filters?.fromMs)) ? Number(filters.fromMs) : null;
    if (fromMs !== null) {
      params.push(new Date(fromMs).toISOString());
      whereClauses.push(`created_at >= $${params.length}::timestamptz`);
    }

    const toMs = Number.isFinite(Number(filters?.toMs)) ? Number(filters.toMs) : null;
    if (toMs !== null) {
      params.push(new Date(toMs).toISOString());
      whereClauses.push(`created_at <= $${params.length}::timestamptz`);
    }

    params.push(safeLimit);
    const limitPos = params.length;
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const res = await pool.query(
      `
      SELECT
        id,
        dead_letter_id,
        queue_id,
        run_id,
        source,
        playbook_id,
        reason,
        created_at
      FROM soon_self_heal_requeue_audit
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${limitPos}
    `,
      params,
    );

    return res.rows.map((row) => ({
      auditId: String(row.id),
      deadLetterId: row.dead_letter_id === null ? null : String(row.dead_letter_id),
      queueJobId: row.queue_id === null ? null : String(row.queue_id),
      runId: row.run_id,
      source: row.source,
      playbookId: row.playbook_id,
      reason: row.reason,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async function getSelfHealRequeueAuditSummary(days = 7, { now = Date.now() } = {}) {
    await ensureInit();
    const safeDays = Math.max(1, Math.min(365, Number(days) || 7));
    const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const cutoffIso = new Date(nowMs - safeDays * 24 * 60 * 60 * 1000).toISOString();

    const totalRes = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM soon_self_heal_requeue_audit
      WHERE created_at >= $1::timestamptz
    `,
      [cutoffIso],
    );

    const reasonRes = await pool.query(
      `
      SELECT reason, COUNT(*)::int AS count
      FROM soon_self_heal_requeue_audit
      WHERE created_at >= $1::timestamptz
      GROUP BY reason
      ORDER BY count DESC, reason ASC
    `,
      [cutoffIso],
    );

    const playbookRes = await pool.query(
      `
      SELECT playbook_id, COUNT(*)::int AS count
      FROM soon_self_heal_requeue_audit
      WHERE created_at >= $1::timestamptz
      GROUP BY playbook_id
      ORDER BY count DESC, playbook_id ASC
    `,
      [cutoffIso],
    );

    const dailyRes = await pool.query(
      `
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM soon_self_heal_requeue_audit
      WHERE created_at >= $1::timestamptz
      GROUP BY day
      ORDER BY day ASC
    `,
      [cutoffIso],
    );

    return {
      days: safeDays,
      total: Number(totalRes.rows[0]?.count ?? 0),
      byReason: reasonRes.rows.map((row) => ({ reason: row.reason, count: Number(row.count) })),
      byPlaybook: playbookRes.rows.map((row) => ({ playbookId: row.playbook_id, count: Number(row.count) })),
      daily: dailyRes.rows.map((row) => ({ day: row.day, count: Number(row.count) })),
    };
  }

  async function requeueSelfHealDeadLetters({ limit = 20, deadLetterIds, now = Date.now() } = {}) {
    await ensureInit();
    const hasIdList = Array.isArray(deadLetterIds) && deadLetterIds.length > 0;
    const normalizedIds = hasIdList
      ? [...new Set(deadLetterIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
      : [];

    let candidateIds = [];
    let requestedCount = 0;
    let missing = 0;
    if (hasIdList) {
      candidateIds = normalizedIds;
      requestedCount = deadLetterIds.length;
      missing = Math.max(0, deadLetterIds.length - normalizedIds.length);
    } else {
      const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
      const idsRes = await pool.query(
        `
        SELECT id
        FROM soon_self_heal_dead_letter
        ORDER BY created_at DESC
        LIMIT $1
      `,
        [safeLimit],
      );
      candidateIds = idsRes.rows.map((row) => row.id);
      requestedCount = candidateIds.length;
    }

    const items = [];
    let conflicts = 0;
    for (const deadLetterId of candidateIds) {
      const requeued = await requeueSelfHealDeadLetter(deadLetterId, { now });
      if (requeued && !requeued.error) {
        items.push(requeued);
      } else if (requeued?.error === 'not_dead_letter') {
        conflicts += 1;
      } else {
        missing += 1;
      }
    }

    return {
      requested: requestedCount,
      requeued: items.length,
      conflicts,
      missing,
      items,
    };
  }

  async function recordTokenAllocationSnapshot(payload = {}) {
    await ensureInit();

    const summary = payload?.summary ?? {};
    const runId = payload?.runId ?? null;
    const budgetMode = payload?.budgetMode ?? 'unbounded';
    const budgetTokens = summary?.budgetTokens ?? null;
    const requested = Number(summary?.requested ?? 0);
    const selected = Number(summary?.selected ?? 0);
    const skipped = Number(summary?.skipped ?? 0);
    const totalTokenCostSelected = Number(summary?.totalTokenCostSelected ?? 0);
    const remainingBudgetTokens = summary?.remainingBudgetTokens ?? null;

    const snapshotRes = await pool.query(
      `
      INSERT INTO soon_token_allocation_snapshot (
        run_id,
        budget_mode,
        budget_tokens,
        requested_count,
        selected_count,
        skipped_count,
        total_token_cost_selected,
        remaining_budget_tokens
      )
      VALUES (
        $1::uuid,
        $2,
        $3::numeric,
        $4::int,
        $5::int,
        $6::int,
        $7::numeric,
        $8::numeric
      )
      RETURNING id, run_id, budget_mode, budget_tokens, requested_count, selected_count, skipped_count, total_token_cost_selected, remaining_budget_tokens, created_at
    `,
      [
        runId,
        budgetMode,
        budgetTokens,
        requested,
        selected,
        skipped,
        totalTokenCostSelected,
        remainingBudgetTokens,
      ],
    );

    const snapshotRow = snapshotRes.rows[0];
    const snapshotId = Number(snapshotRow.id);
    const plan = Array.isArray(payload?.plan) ? payload.plan : [];

    for (const item of plan) {
      await pool.query(
        `
        INSERT INTO soon_token_allocation_snapshot_item (
          snapshot_id,
          asin,
          expected_value,
          confidence,
          token_cost,
          priority,
          selected,
          skip_reason,
          remaining_budget_after
        )
        VALUES (
          $1::bigint,
          $2,
          $3::numeric,
          $4::numeric,
          $5::numeric,
          $6::numeric,
          $7::boolean,
          $8,
          $9::numeric
        )
      `,
        [
          snapshotId,
          String(item?.asin ?? ''),
          Number(item?.expectedValue ?? 0),
          Number(item?.confidence ?? 0),
          Number(item?.tokenCost ?? 0),
          Number(item?.priority ?? 0),
          Boolean(item?.selected),
          item?.skipReason ?? null,
          item?.remainingBudgetAfter ?? null,
        ],
      );
    }

    return {
      snapshotId: String(snapshotId),
      runId: snapshotRow.run_id ?? null,
      budgetMode: snapshotRow.budget_mode,
      summary: {
        requested: Number(snapshotRow.requested_count ?? 0),
        selected: Number(snapshotRow.selected_count ?? 0),
        skipped: Number(snapshotRow.skipped_count ?? 0),
        budgetTokens: toNumber(snapshotRow.budget_tokens),
        totalTokenCostSelected: toNumber(snapshotRow.total_token_cost_selected, 0),
        remainingBudgetTokens: toNumber(snapshotRow.remaining_budget_tokens),
      },
      plan: plan.map((item) => ({
        asin: String(item?.asin ?? ''),
        expectedValue: Number(item?.expectedValue ?? 0),
        confidence: Number(item?.confidence ?? 0),
        tokenCost: Number(item?.tokenCost ?? 0),
        priority: Number(item?.priority ?? 0),
        selected: Boolean(item?.selected),
        skipReason: item?.skipReason ?? null,
        remainingBudgetAfter:
          item?.remainingBudgetAfter === null || item?.remainingBudgetAfter === undefined
            ? null
            : Number(item.remainingBudgetAfter),
      })),
      createdAt: snapshotRow.created_at.toISOString(),
    };
  }

  async function listLatestTokenAllocationSnapshots(limit = 20) {
    await ensureInit();
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));

    const snapshotsRes = await pool.query(
      `
      SELECT
        id,
        run_id,
        budget_mode,
        budget_tokens,
        requested_count,
        selected_count,
        skipped_count,
        total_token_cost_selected,
        remaining_budget_tokens,
        created_at
      FROM soon_token_allocation_snapshot
      ORDER BY created_at DESC, id DESC
      LIMIT $1
    `,
      [safeLimit],
    );

    const snapshots = snapshotsRes.rows.map((row) => ({
      snapshotId: String(row.id),
      runId: row.run_id ?? null,
      budgetMode: row.budget_mode,
      summary: {
        requested: Number(row.requested_count ?? 0),
        selected: Number(row.selected_count ?? 0),
        skipped: Number(row.skipped_count ?? 0),
        budgetTokens: toNumber(row.budget_tokens),
        totalTokenCostSelected: toNumber(row.total_token_cost_selected, 0),
        remainingBudgetTokens: toNumber(row.remaining_budget_tokens),
      },
      plan: [],
      createdAt: row.created_at.toISOString(),
    }));

    if (!snapshots.length) {
      return snapshots;
    }

    const snapshotIds = snapshots.map((item) => Number(item.snapshotId)).filter(Number.isFinite);
    const itemsRes = await pool.query(
      `
      SELECT
        snapshot_id,
        asin,
        expected_value,
        confidence,
        token_cost,
        priority,
        selected,
        skip_reason,
        remaining_budget_after,
        id
      FROM soon_token_allocation_snapshot_item
      WHERE snapshot_id = ANY($1::bigint[])
      ORDER BY snapshot_id DESC, id ASC
    `,
      [snapshotIds],
    );

    const bySnapshot = new Map();
    for (const row of itemsRes.rows) {
      const key = String(row.snapshot_id);
      const current = bySnapshot.get(key) ?? [];
      current.push({
        asin: row.asin,
        expectedValue: toNumber(row.expected_value, 0),
        confidence: toNumber(row.confidence, 0),
        tokenCost: toNumber(row.token_cost, 0),
        priority: toNumber(row.priority, 0),
        selected: Boolean(row.selected),
        skipReason: row.skip_reason ?? null,
        remainingBudgetAfter: toNumber(row.remaining_budget_after),
      });
      bySnapshot.set(key, current);
    }

    for (const snapshot of snapshots) {
      snapshot.plan = bySnapshot.get(snapshot.snapshotId) ?? [];
    }

    return snapshots;
  }

  async function getRuntimeState(stateKey) {
    await ensureInit();
    const key = String(stateKey ?? '').trim();
    if (!key) return null;

    const res = await pool.query(
      `
      SELECT state_key, state_value, updated_at
      FROM soon_runtime_state
      WHERE state_key = $1
    `,
      [key],
    );

    if (!res.rowCount) return null;
    const row = res.rows[0];
    return {
      stateKey: row.state_key,
      stateValue: row.state_value ?? null,
      updatedAt: row.updated_at?.toISOString?.() ?? new Date(row.updated_at).toISOString(),
    };
  }

  async function setRuntimeState(stateKey, stateValue) {
    await ensureInit();
    const key = String(stateKey ?? '').trim();
    if (!key) return null;

    const res = await pool.query(
      `
      INSERT INTO soon_runtime_state (state_key, state_value, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (state_key) DO UPDATE SET
        state_value = EXCLUDED.state_value,
        updated_at = now()
      RETURNING state_key, state_value, updated_at
    `,
      [key, JSON.stringify(stateValue ?? null)],
    );

    const row = res.rows[0];
    return {
      stateKey: row.state_key,
      stateValue: row.state_value ?? null,
      updatedAt: row.updated_at?.toISOString?.() ?? new Date(row.updated_at).toISOString(),
    };
  }

  async function getTokenDailyBudgetStatus({ day, budgetTokens } = {}) {
    await ensureInit();
    const dayKey = toDayKey(day ?? new Date().toISOString());
    const normalizedBudget = toBudgetTokens(budgetTokens);

    const res = await pool.query(
      `
      SELECT day, budget_tokens, consumed_tokens, updated_at
      FROM soon_token_daily_budget_ledger
      WHERE day = $1::date
    `,
      [dayKey],
    );

    const row = res.rows[0] ?? null;
    const consumedRaw = row ? Number(row.consumed_tokens ?? 0) : 0;
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
      updatedAt: row
        ? row.updated_at?.toISOString?.() ?? new Date(row.updated_at).toISOString()
        : new Date().toISOString(),
    };
  }

  async function consumeTokenDailyBudget({ day, budgetTokens, amountTokens } = {}) {
    await ensureInit();
    const dayKey = toDayKey(day ?? new Date().toISOString());
    const normalizedBudget = toBudgetTokens(budgetTokens);
    if (normalizedBudget === null) {
      return getTokenDailyBudgetStatus({ day: dayKey, budgetTokens: null });
    }

    const amount = toAmountTokens(amountTokens);
    if (amount <= 0) {
      return getTokenDailyBudgetStatus({ day: dayKey, budgetTokens: normalizedBudget });
    }

    await pool.query(
      `
      INSERT INTO soon_token_daily_budget_ledger (
        day,
        budget_tokens,
        consumed_tokens,
        created_at,
        updated_at
      )
      VALUES (
        $1::date,
        $2::numeric,
        LEAST($2::numeric, $3::numeric),
        now(),
        now()
      )
      ON CONFLICT (day) DO UPDATE SET
        budget_tokens = EXCLUDED.budget_tokens,
        consumed_tokens = LEAST(
          EXCLUDED.budget_tokens,
          GREATEST(0, soon_token_daily_budget_ledger.consumed_tokens + EXCLUDED.consumed_tokens)
        ),
        updated_at = now()
    `,
      [dayKey, normalizedBudget, amount],
    );

    return getTokenDailyBudgetStatus({ day: dayKey, budgetTokens: normalizedBudget });
  }

  return {
    mode: 'postgres',
    listTrackings,
    getTracking,
    getProductDetail,
    updateThresholds,
    saveTracking,
    deleteTracking,
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
    recordTokenAllocationSnapshot,
    listLatestTokenAllocationSnapshots,
    getRuntimeState,
    setRuntimeState,
    getTokenDailyBudgetStatus,
    consumeTokenDailyBudget,
    async close() {
      await flushDailyReadModelRefresh();
      await pool.end();
    },
  };
}
