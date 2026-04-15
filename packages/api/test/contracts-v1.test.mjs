import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoonApiServer } from '../src/runtime/server.mjs';
import { createInMemoryStore } from '../src/runtime/in-memory-store.mjs';

async function withServer(fn, options = {}) {
  const server = createSoonApiServer(options);

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
    assert.match(body, /soon_self_heal_retry_queue_pending/);
    assert.match(body, /soon_self_heal_retry_queue_done/);
    assert.match(body, /soon_self_heal_retry_queue_dead_letter/);
    assert.match(body, /soon_self_heal_dead_letter_total/);
    assert.match(body, /soon_self_heal_manual_requeue_total/);
  });
});

test('POST /self-heal/run persists self-heal run and playbooks', async () => {
  await withServer(async (baseUrl) => {
    const run = await readJson(
      await fetch(`${baseUrl}/self-heal/run`, {
        method: 'POST',
      }),
    );

    assert.equal(run.status, 200);
    assert.equal(run.body.status, 'ok');
    assert.equal(run.body.worker, 'self-heal');
    assert.ok(typeof run.body.anomalyCount === 'number');
    assert.ok(Array.isArray(run.body.anomalies));
    assert.ok(typeof run.body.playbookCount === 'number');
    assert.ok(Array.isArray(run.body.executedPlaybooks));
    assert.ok(run.body.executedPlaybooks.length >= 1);
    assert.ok(typeof run.body.executedPlaybooks[0].playbookId === 'string');
    assert.ok(['success', 'rollback', 'failed'].includes(run.body.executedPlaybooks[0].status));
    assert.ok(Number.isFinite(run.body.executedPlaybooks[0].attempts));
    assert.ok(Number.isFinite(run.body.executedPlaybooks[0].maxRetries));
    assert.ok(Number.isFinite(run.body.executedPlaybooks[0].retriesUsed));
    assert.ok(Number.isFinite(run.body.executedPlaybooks[0].priorityScore));
    assert.ok(Number.isFinite(run.body.executedPlaybooks[0].retryBackoffSec));
    assert.ok(Array.isArray(run.body.executedPlaybooks[0].matchedAnomalyCodes));
    assert.ok(run.body.runId);
    assert.ok(run.body.retryQueue);
    assert.ok(Number.isFinite(run.body.retryQueue.enqueued));

    const latest = await readJson(await fetch(`${baseUrl}/self-heal/runs/latest?limit=5`));
    assert.equal(latest.status, 200);
    assert.ok(latest.body.count >= 1);
    assert.ok(Array.isArray(latest.body.items));
    assert.ok(latest.body.items[0].runId);
    assert.ok(Array.isArray(latest.body.items[0].executedPlaybooks));
    assert.ok(latest.body.items[0].executedPlaybooks.length >= 1);
    assert.ok(typeof latest.body.items[0].executedPlaybooks[0].playbookId === 'string');
    assert.ok(['success', 'rollback', 'failed'].includes(latest.body.items[0].executedPlaybooks[0].status));
    assert.ok(Number.isFinite(latest.body.items[0].executedPlaybooks[0].attempts));
    assert.ok(Number.isFinite(latest.body.items[0].executedPlaybooks[0].priorityScore));

    const retryStatus = await readJson(await fetch(`${baseUrl}/self-heal/retry/status`));
    assert.equal(retryStatus.status, 200);
    assert.ok(Number.isFinite(retryStatus.body.queuePending));
    assert.ok(Number.isFinite(retryStatus.body.deadLetterCount));

    const deadLetter = await readJson(await fetch(`${baseUrl}/self-heal/dead-letter?limit=5`));
    assert.equal(deadLetter.status, 200);
    assert.ok(Array.isArray(deadLetter.body.items));
    assert.ok(Number.isFinite(deadLetter.body.count));
  });
});

test('POST /self-heal/retry/process drains queued retries created from anomaly run', async () => {
  await withServer(async (baseUrl) => {
    const run = await readJson(
      await fetch(`${baseUrl}/self-heal/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          readModelStatusOverride: {
            mode: 'async',
            pendingCount: 12,
            pendingDays: [],
            inFlight: false,
            lastQueuedAt: null,
            lastStartedAt: null,
            lastFinishedAt: new Date().toISOString(),
            lastDurationMs: 20000,
            lastBatchDays: 1,
            totalRuns: 10,
            totalErrors: 1,
            lastError: { message: 'refresh failed' },
          },
        }),
      }),
    );

    assert.equal(run.status, 200);
    assert.ok(run.body.retryQueue.enqueued >= 1);

    const process = await readJson(
      await fetch(`${baseUrl}/self-heal/retry/process`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 10, now: Date.now() + 120000 }),
      }),
    );
    assert.equal(process.status, 200);
    assert.ok(process.body.summary.processed >= 1);
    assert.ok(process.body.summary.completed >= 1);

    const retryStatus = await readJson(await fetch(`${baseUrl}/self-heal/retry/status`));
    assert.equal(retryStatus.status, 200);
    assert.equal(retryStatus.body.queuePending, 0);
  });
});

test('POST /self-heal/dead-letter/requeue validates input and handles missing item', async () => {
  await withServer(async (baseUrl) => {
    const missingId = await readJson(
      await fetch(`${baseUrl}/self-heal/dead-letter/requeue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    assert.equal(missingId.status, 400);
    assert.equal(missingId.body.error, 'dead_letter_id_required');

    const notFound = await readJson(
      await fetch(`${baseUrl}/self-heal/dead-letter/requeue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deadLetterId: '999999' }),
      }),
    );
    assert.equal(notFound.status, 404);
    assert.equal(notFound.body.error, 'dead_letter_not_found');

    const invalidBulk = await readJson(
      await fetch(`${baseUrl}/self-heal/dead-letter/requeue-bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deadLetterIds: [] }),
      }),
    );
    assert.equal(invalidBulk.status, 400);
    assert.equal(invalidBulk.body.error, 'dead_letter_ids_invalid');
  });
});

test('POST /self-heal/dead-letter/requeue restores dead-letter item back to queue', async () => {
  const store = createInMemoryStore();
  await store.enqueueSelfHealRetryJobs({
    runId: 'run-dead-letter-test',
    source: 'test-suite',
    jobs: [
      {
        playbookId: 'unknown-playbook',
        status: 'failed',
        attempts: 1,
        maxRetries: 1,
        retriesUsed: 0,
        retryBackoffSec: 0,
        priorityScore: 100,
        matchedAnomalyCodes: ['TEST_UNKNOWN_PLAYBOOK'],
      },
    ],
  });
  await store.processSelfHealRetryQueue({ limit: 10, now: Date.now() + 1000 });
  const deadLetters = await store.listSelfHealDeadLetters(10);
  assert.ok(deadLetters.length >= 1);

  await withServer(
    async (baseUrl) => {
      const requeue = await readJson(
        await fetch(`${baseUrl}/self-heal/dead-letter/requeue`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deadLetterId: deadLetters[0].deadLetterId }),
        }),
      );
      assert.equal(requeue.status, 200);
      assert.equal(requeue.body.status, 'ok');
      assert.equal(requeue.body.requeue.status, 'queued');
      assert.ok(requeue.body.retryStatus.queuePending >= 1);
      assert.ok(requeue.body.retryStatus.manualRequeueTotal >= 1);

      const secondRequeue = await readJson(
        await fetch(`${baseUrl}/self-heal/dead-letter/requeue`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deadLetterId: deadLetters[0].deadLetterId }),
        }),
      );
      assert.equal(secondRequeue.status, 409);
      assert.equal(secondRequeue.body.error, 'dead_letter_not_pending');
      assert.equal(secondRequeue.body.currentStatus, 'queued');

      const audit = await readJson(await fetch(`${baseUrl}/self-heal/requeue-audit?limit=5`));
      assert.equal(audit.status, 200);
      assert.ok(Array.isArray(audit.body.items));
      assert.ok(audit.body.items.length >= 1);
      assert.equal(audit.body.items[0].reason, 'manual_requeue');
      assert.ok(audit.body.items[0].playbookId);

      const process = await readJson(
        await fetch(`${baseUrl}/self-heal/retry/process`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ limit: 10, now: Date.now() + 120000 }),
        }),
      );
      assert.equal(process.status, 200);
      assert.ok(process.body.summary.processed >= 1);
    },
    { store },
  );
});

test('POST /self-heal/dead-letter/requeue-bulk requeues latest dead-letter entries', async () => {
  const store = createInMemoryStore();
  await store.enqueueSelfHealRetryJobs({
    runId: 'run-dead-letter-bulk-test',
    source: 'test-suite',
    jobs: [
      {
        playbookId: 'unknown-playbook-A',
        status: 'failed',
        attempts: 1,
        maxRetries: 1,
        retriesUsed: 0,
        retryBackoffSec: 0,
        priorityScore: 100,
        matchedAnomalyCodes: ['TEST_UNKNOWN_PLAYBOOK_A'],
      },
      {
        playbookId: 'unknown-playbook-B',
        status: 'failed',
        attempts: 1,
        maxRetries: 1,
        retriesUsed: 0,
        retryBackoffSec: 0,
        priorityScore: 99,
        matchedAnomalyCodes: ['TEST_UNKNOWN_PLAYBOOK_B'],
      },
    ],
  });
  await store.processSelfHealRetryQueue({ limit: 10, now: Date.now() + 1000 });
  const deadLetters = await store.listSelfHealDeadLetters(10);
  assert.ok(deadLetters.length >= 2);

  await withServer(
    async (baseUrl) => {
      const selectedIds = [deadLetters[0].deadLetterId, deadLetters[1].deadLetterId];
      const bulk = await readJson(
        await fetch(`${baseUrl}/self-heal/dead-letter/requeue-bulk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deadLetterIds: selectedIds }),
        }),
      );
      assert.equal(bulk.status, 200);
      assert.equal(bulk.body.status, 'ok');
      assert.equal(bulk.body.summary.requested, 2);
      assert.equal(bulk.body.summary.requeued, 2);
      assert.ok(Array.isArray(bulk.body.summary.items));
      assert.equal(bulk.body.summary.items.length, 2);
      assert.ok(bulk.body.retryStatus.queuePending >= 2);
      assert.ok(bulk.body.retryStatus.manualRequeueTotal >= 2);

      const audit = await readJson(await fetch(`${baseUrl}/self-heal/requeue-audit?limit=5`));
      assert.equal(audit.status, 200);
      assert.ok(Array.isArray(audit.body.items));
      assert.ok(audit.body.items.length >= 2);
      assert.equal(audit.body.items[0].reason, 'manual_requeue');
    },
    { store },
  );
});

test('GET /products/:asin/detail returns 404 for unknown ASIN', async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await readJson(await fetch(`${baseUrl}/products/UNKNOWN_ASIN/detail`));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });
});
