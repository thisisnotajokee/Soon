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

test('self-heal alert routing v1: enforces purchase->telegram and technical->discord after auto-remediation', async () => {
  await withServer(async (baseUrl) => {
    const cycle = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );
    assert.equal(cycle.status, 200);

    const status = await readJson(await fetch(`${baseUrl}/api/check-alert-status?limit=10`));
    assert.equal(status.status, 200);
    assert.equal(status.body.policy.purchase, 'telegram');
    assert.equal(status.body.policy.technical, 'discord');
    assert.equal(status.body.violations.total, 0);
    assert.equal(status.body.overall, 'PASS');
    assert.ok(Number.isFinite(status.body.alertsByChannel.telegram));
    assert.ok(Number.isFinite(status.body.alertsByChannel.discord));
  });
});

test('self-heal alert routing v1: records dead-letter retry_budget_exhausted and exposes exhausted/backoff metrics', async () => {
  const store = createInMemoryStore();
  await store.enqueueSelfHealRetryJobs({
    runId: 'run-routing-v1-retry-exhausted',
    source: 'test-suite',
    jobs: [
      {
        playbookId: 'alert-router-backlog',
        status: 'failed',
        attempts: 1,
        maxRetries: 1,
        retriesUsed: 0,
        retryBackoffSec: 20,
        priorityScore: 100,
        matchedAnomalyCodes: ['PENDING_BACKLOG_CRIT'],
      },
    ],
  });

  await withServer(
    async (baseUrl) => {
      const process = await readJson(
        await fetch(`${baseUrl}/self-heal/retry/process`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ limit: 10, now: Date.now() + 120000 }),
        }),
      );
      assert.equal(process.status, 200);
      assert.ok(process.body.summary.deadLettered >= 1);
      assert.ok(process.body.summary.retryExhausted >= 1);

      const retryStatus = await readJson(await fetch(`${baseUrl}/self-heal/retry/status`));
      assert.equal(retryStatus.status, 200);
      assert.ok(retryStatus.body.retryExhaustedTotal >= 1);
      assert.ok(Number.isFinite(retryStatus.body.retryBackoffSeconds));

      const deadLetter = await readJson(await fetch(`${baseUrl}/self-heal/dead-letter?limit=10`));
      assert.equal(deadLetter.status, 200);
      assert.ok(deadLetter.body.items.some((item) => item.reason === 'retry_budget_exhausted'));

      const metricsRes = await fetch(`${baseUrl}/metrics`);
      const metricsBody = await metricsRes.text();
      assert.equal(metricsRes.status, 200);
      assert.match(metricsBody, /soon_self_heal_retry_exhausted_total/);
      assert.match(metricsBody, /soon_self_heal_retry_backoff_seconds/);
    },
    { store },
  );
});
