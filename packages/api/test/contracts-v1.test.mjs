import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoonApiServer } from '../src/runtime/server.mjs';

async function withServer(fn) {
  const server = createSoonApiServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readJson(response) {
  const body = await response.json();
  return { status: response.status, body };
}

test('GET /health returns service status and modules', async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await readJson(await fetch(`${baseUrl}/health`));

    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'soon-api');
    assert.ok(Array.isArray(body.modules));
    assert.ok(body.modules.includes('tracking-core'));
    assert.ok(body.modules.includes('hunter-core'));
  });
});

test('GET /trackings returns seeded list', async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await readJson(await fetch(`${baseUrl}/trackings`));

    assert.equal(status, 200);
    assert.ok(Array.isArray(body.items));
    assert.ok(body.items.length >= 1);
    assert.ok(body.items[0].asin);
    assert.ok(body.items[0].pricesNew);
  });
});

test('POST /trackings/:asin/thresholds persists values', async () => {
  await withServer(async (baseUrl) => {
    const trackings = await readJson(await fetch(`${baseUrl}/trackings`));
    const asin = trackings.body.items[0].asin;

    const updateRes = await readJson(
      await fetch(`${baseUrl}/trackings/${asin}/thresholds`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thresholdDropPct: 22,
          thresholdRisePct: 14,
          targetPriceNew: 199.99,
          targetPriceUsed: 179.99,
        }),
      }),
    );

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.thresholds.thresholdDropPct, 22);

    const detail = await readJson(await fetch(`${baseUrl}/products/${asin}/detail`));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.thresholds.thresholdDropPct, 22);
    assert.equal(detail.body.thresholds.targetPriceUsed, 179.99);
  });
});

test('POST /automation/cycle enforces alert channel policy', async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.ok(Array.isArray(body.alerts));
    assert.ok(body.alerts.length >= 1);

    for (const alert of body.alerts) {
      if (alert.kind === 'purchase') {
        assert.equal(alert.channel, 'telegram');
      }
      if (alert.kind === 'technical') {
        assert.equal(alert.channel, 'discord');
      }
    }
  });
});

test('GET /automation/runs/latest returns persisted runs', async () => {
  await withServer(async (baseUrl) => {
    const cycle = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );
    assert.equal(cycle.status, 200);
    assert.ok(cycle.body.runId);

    const latest = await readJson(await fetch(`${baseUrl}/automation/runs/latest?limit=5`));
    assert.equal(latest.status, 200);
    assert.ok(Array.isArray(latest.body.items));
    assert.ok(latest.body.count >= 1);
    assert.ok(latest.body.items[0].runId);

    for (const alert of latest.body.items[0].alerts ?? []) {
      if (alert.kind === 'purchase') {
        assert.equal(alert.channel, 'telegram');
      }
      if (alert.kind === 'technical') {
        assert.equal(alert.channel, 'discord');
      }
    }
  });
});

test('GET /automation/runs/summary returns run KPI aggregates', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    const summary = await readJson(await fetch(`${baseUrl}/automation/runs/summary?limit=5`));
    assert.equal(summary.status, 200);
    assert.ok(summary.body.window.runs >= 1);
    assert.ok(summary.body.kpi.avgAlertCount >= 0);
    assert.ok(summary.body.kpi.purchaseAlertRatePct >= 0);
    assert.ok(summary.body.kpi.technicalAlertRatePct >= 0);
    assert.ok(summary.body.alertsByChannel.discord >= 1);
  });
});

test('GET /automation/runs/trends returns 24h/7d/30d windows', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    const trends = await readJson(await fetch(`${baseUrl}/automation/runs/trends?days=30`));
    assert.equal(trends.status, 200);
    assert.equal(trends.body.source, 'daily-read-model');
    assert.ok(Array.isArray(trends.body.windows));
    assert.equal(trends.body.windows.length, 3);

    const names = trends.body.windows.map((item) => item.window);
    assert.ok(names.includes('24h'));
    assert.ok(names.includes('7d'));
    assert.ok(names.includes('30d'));

    for (const window of trends.body.windows) {
      assert.ok(window.runs >= 0);
      assert.ok(window.kpi.avgAlertCount >= 0);
      assert.ok(window.kpi.purchaseAlertRatePct >= 0);
      assert.ok(window.kpi.technicalAlertRatePct >= 0);
    }
  });
});

test('GET /automation/runs/daily returns day-level read model', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    const daily = await readJson(await fetch(`${baseUrl}/automation/runs/daily?days=30`));
    assert.equal(daily.status, 200);
    assert.ok(Array.isArray(daily.body.items));
    assert.ok(daily.body.items.length >= 1);
    assert.ok(daily.body.items[0].day);
    assert.ok(daily.body.items[0].runs >= 1);
    assert.ok(daily.body.items[0].sums.alertCount >= 1);
    assert.ok(daily.body.items[0].kpi.avgTrackingCount >= 0);
    assert.ok(daily.body.items[0].alertsByChannel.discord >= 1);
  });
});

test('GET /automation/read-model/status returns refresh queue metrics', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    const status = await readJson(await fetch(`${baseUrl}/automation/read-model/status`));
    assert.equal(status.status, 200);
    assert.ok(typeof status.body.mode === 'string');
    assert.ok(typeof status.body.pendingCount === 'number');
    assert.ok(Array.isArray(status.body.pendingDays));
    assert.ok(typeof status.body.inFlight === 'boolean');
    assert.ok(typeof status.body.totalRuns === 'number');
    assert.ok(typeof status.body.totalErrors === 'number');
  });
});

test('GET /metrics exports read-model Prometheus metrics', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /soon_read_model_refresh_pending_count/);
    assert.match(body, /soon_read_model_refresh_total_runs/);
    assert.match(body, /soon_read_model_refresh_total_errors/);
    assert.match(body, /soon_read_model_refresh_info\{mode="/);
  });
});

test('GET /products/:asin/detail returns 404 for unknown ASIN', async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await readJson(await fetch(`${baseUrl}/products/UNKNOWN_ASIN/detail`));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });
});
