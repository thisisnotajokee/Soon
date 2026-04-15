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
    const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM soon_tracking');
    if (countRes.rows[0].count > 0) {
      return;
    }

    for (const item of SEEDED_TRACKINGS) {
      await pool.query(
        `
        INSERT INTO soon_tracking (asin, title, created_at, updated_at)
        VALUES ($1, $2, now(), now())
        ON CONFLICT (asin) DO UPDATE SET title = EXCLUDED.title, updated_at = now()
      `,
        [item.asin, item.title],
      );

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
        await pool.query(
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
        await pool.query(
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
        await pool.query(
          `
          INSERT INTO soon_price_history (asin, market, condition, price, currency, recorded_at)
          VALUES ($1, 'de', 'new', $2, 'EUR', $3::timestamptz)
        `,
          [item.asin, point.value, point.ts],
        );
      }
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
    }

    const pendingRes = await pool.query(
      "SELECT COUNT(*)::int AS count FROM soon_self_heal_retry_queue WHERE status = 'queued'",
    );

    return {
      processed,
      completed,
      rescheduled,
      deadLettered,
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
        COALESCE(SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END), 0)::int AS dead_letter
      FROM soon_self_heal_retry_queue
    `,
    );
    const dlqRes = await pool.query('SELECT COUNT(*)::int AS count FROM soon_self_heal_dead_letter');
    const requeueRes = await pool.query('SELECT COUNT(*)::int AS count FROM soon_self_heal_requeue_audit');

    return {
      queuePending: Number(countsRes.rows[0]?.pending ?? 0),
      queueDone: Number(countsRes.rows[0]?.done ?? 0),
      queueDeadLetter: Number(countsRes.rows[0]?.dead_letter ?? 0),
      deadLetterCount: Number(dlqRes.rows[0]?.count ?? 0),
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
      WHERE id = $1
      RETURNING id, run_id, source, playbook_id, status, max_retries, retries_used, next_retry_at
    `,
      [queueId, nowIso],
    );
    if (updateRes.rowCount === 0) return null;

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

  return {
    mode: 'postgres',
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
    requeueSelfHealDeadLetter,
    async close() {
      await flushDailyReadModelRefresh();
      await pool.end();
    },
  };
}
