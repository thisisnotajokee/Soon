import assert from 'node:assert/strict';

import { createSoonApiServer } from '../../api/src/runtime/server.mjs';
import { createApiClient } from '../src/api-client.mjs';

async function run() {
  const server = createSoonApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const client = createApiClient(baseUrl);

  try {
    const health = await client.health();
    assert.equal(health.status, 'ok');

    const list = await client.listTrackings();
    assert.ok(list.count >= 1);

    const asin = list.items[0].asin;
    const detail = await client.getProductDetail(asin);
    assert.equal(detail.asin, asin);

    const dashboard = await client.getDashboard('demo');
    assert.ok(Array.isArray(dashboard.items));
    const dashboardItem = dashboard.items.find((item) => item.asin === asin) ?? dashboard.items[0];
    assert.ok(dashboardItem?.cardPreview);
    assert.ok(Array.isArray(dashboardItem.cardPreview.marketRows));
    assert.ok(dashboardItem.cardPreview.marketRows.length >= 1);
    assert.ok(Array.isArray(dashboardItem.cardPreview.sparkline));
    assert.ok(dashboardItem.cardPreview.bestDomain === null || typeof dashboardItem.cardPreview.bestDomain === 'string');
    assert.ok(dashboardItem.cardPreview.bestPriceNew === null || Number.isFinite(Number(dashboardItem.cardPreview.bestPriceNew)));

    const update = await client.updateThresholds(asin, {
      thresholdDropPct: 18,
      thresholdRisePct: 11,
      targetPriceNew: 210,
      targetPriceUsed: 180,
    });
    assert.equal(update.thresholds.thresholdDropPct, 18);

    const cycle = await client.runAutomationCycle();
    assert.equal(cycle.status, 'ok');
    assert.ok(Array.isArray(cycle.alerts));
    assert.ok(cycle.runId);

    const runs = await client.getLatestAutomationRuns(5);
    assert.ok(runs.count >= 1);
    assert.ok(Array.isArray(runs.items));
    assert.ok(runs.items[0].runId);

    const summary = await client.getAutomationRunsSummary(5);
    assert.ok(summary.window.runs >= 1);
    assert.ok(summary.kpi.avgAlertCount >= 0);
    assert.ok(summary.alertsByChannel.discord >= 1);

    const trends = await client.getAutomationRunsTrends(20);
    assert.ok(Array.isArray(trends.windows));
    assert.equal(trends.windows.length, 3);
    assert.ok(trends.windows.some((item) => item.window === '24h'));

    const daily = await client.getAutomationRunsDaily(30);
    assert.ok(Array.isArray(daily.items));
    assert.ok(daily.items.length >= 1);
    assert.ok(daily.items[0].day);
    assert.ok(daily.items[0].kpi.avgAlertCount >= 0);

    const readModelStatus = await client.getReadModelStatus();
    assert.ok(typeof readModelStatus.mode === 'string');
    assert.ok(readModelStatus.pendingCount >= 0);
    assert.ok(readModelStatus.totalErrors >= 0);

    const alertRoutingStatus = await client.getAlertRoutingStatus(5);
    assert.equal(alertRoutingStatus.status, 'ok');
    assert.equal(alertRoutingStatus.policy.purchase, 'telegram');
    assert.equal(alertRoutingStatus.policy.technical, 'discord');
    assert.equal(alertRoutingStatus.violations.total, 0);

    const selfHeal = await client.runSelfHealCycle();
    assert.equal(selfHeal.status, 'ok');
    assert.equal(selfHeal.worker, 'self-heal');
    assert.ok(Array.isArray(selfHeal.executedPlaybooks));
    assert.ok(typeof selfHeal.anomalyCount === 'number');
    assert.ok(Array.isArray(selfHeal.anomalies));
    assert.ok(typeof selfHeal.playbookCount === 'number');
    assert.ok(typeof selfHeal.executedPlaybooks[0].playbookId === 'string');
    assert.ok(['success', 'rollback', 'failed'].includes(selfHeal.executedPlaybooks[0].status));
    assert.ok(Number.isFinite(selfHeal.executedPlaybooks[0].attempts));
    assert.ok(Number.isFinite(selfHeal.executedPlaybooks[0].priorityScore));
    assert.ok(Array.isArray(selfHeal.executedPlaybooks[0].matchedAnomalyCodes));
    assert.ok(selfHeal.runId);

    const selfHealRuns = await client.getLatestSelfHealRuns(5);
    assert.ok(selfHealRuns.count >= 1);
    assert.ok(Array.isArray(selfHealRuns.items));
    assert.ok(selfHealRuns.items[0].runId);
    assert.ok(Array.isArray(selfHealRuns.items[0].executedPlaybooks));
    assert.ok(typeof selfHealRuns.items[0].executedPlaybooks[0].playbookId === 'string');
    assert.ok(['success', 'rollback', 'failed'].includes(selfHealRuns.items[0].executedPlaybooks[0].status));
    assert.ok(Number.isFinite(selfHealRuns.items[0].executedPlaybooks[0].attempts));

    const runtimeSelfHealStatus = await client.getRuntimeSelfHealStatus();
    assert.equal(runtimeSelfHealStatus.status, 'ok');
    assert.ok(['PASS', 'WARN', 'CRIT'].includes(runtimeSelfHealStatus.overall));
    assert.ok(Number.isFinite(runtimeSelfHealStatus.retryQueue.queuePending));
    assert.ok(Number.isFinite(runtimeSelfHealStatus.retryQueue.deadLetterCount));

    const metrics = await client.getPrometheusMetrics();
    assert.ok(metrics.includes('soon_read_model_refresh_pending_count'));
    assert.ok(metrics.includes('soon_read_model_refresh_total_runs'));

    console.log('[Soon/web smoke] PASS', {
      trackingCount: list.count,
      asin,
      alerts: cycle.alerts.length,
      latestRuns: runs.count,
      summaryRuns: summary.window.runs,
      trendWindows: trends.windows.length,
      dailyItems: daily.items.length,
      selfHealRuns: selfHealRuns.count,
      readModelMode: readModelStatus.mode,
      runtimeSelfHealOverall: runtimeSelfHealStatus.overall,
      alertRoutingOverall: alertRoutingStatus.overall,
      metricsExported: true,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error('[Soon/web smoke] FAIL', error);
  process.exit(1);
});
