import assert from 'node:assert/strict';
import test from 'node:test';

import { createInMemoryStore } from '../src/runtime/in-memory-store.mjs';
import { runPriceScannerWorker } from '../src/runtime/workers/price-scanner-worker.mjs';
import { runHunterRunnerWorker } from '../src/runtime/workers/hunter-runner-worker.mjs';
import { runSelfHealWorker } from '../src/runtime/workers/self-heal-worker.mjs';

test('price-scanner worker returns scan contract', async () => {
  const store = createInMemoryStore();
  const result = await runPriceScannerWorker({ store });

  assert.equal(result.worker, 'price-scanner');
  assert.equal(result.status, 'ok');
  assert.ok(result.scanned >= 1);
  assert.ok(result.startedAt);
  assert.ok(result.finishedAt);
});

test('hunter-runner worker returns decisions and alert routing contract', async () => {
  const store = createInMemoryStore();
  const result = await runHunterRunnerWorker({ store });

  assert.equal(result.worker, 'hunter-runner');
  assert.equal(result.status, 'ok');
  assert.ok(Array.isArray(result.decisions));
  assert.ok(Array.isArray(result.tokenPlan));
  assert.ok(Array.isArray(result.alerts));

  for (const alert of result.alerts) {
    if (alert.kind === 'purchase') {
      assert.equal(alert.channel, 'telegram');
    }
    if (alert.kind === 'technical') {
      assert.equal(alert.channel, 'discord');
    }
  }
});

test('self-heal worker returns executed remediation playbooks', async () => {
  const result = await runSelfHealWorker();

  assert.equal(result.worker, 'self-heal');
  assert.equal(result.status, 'ok');
  assert.ok(typeof result.anomalyCount === 'number');
  assert.ok(Array.isArray(result.anomalies));
  assert.ok(typeof result.playbookCount === 'number');
  assert.ok(Array.isArray(result.executedPlaybooks));
  assert.ok(result.executedPlaybooks.length >= 1);

  for (const playbook of result.executedPlaybooks) {
    assert.ok(typeof playbook.playbookId === 'string');
    assert.ok(['success', 'rollback', 'failed'].includes(playbook.status));
    assert.ok(Number.isFinite(playbook.attempts));
    assert.ok(Number.isFinite(playbook.maxRetries));
    assert.ok(Number.isFinite(playbook.retriesUsed));
    assert.ok(Number.isFinite(playbook.priorityScore));
    assert.ok(Number.isFinite(playbook.retryBackoffSec));
    assert.ok(Array.isArray(playbook.matchedAnomalyCodes));
  }
});

test('self-heal worker scores and retries anomaly-driven playbooks', async () => {
  const result = await runSelfHealWorker({
    readModelStatusProvider: async () => ({
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
    }),
  });

  assert.equal(result.worker, 'self-heal');
  assert.equal(result.status, 'rollback');
  assert.ok(result.anomalyCount >= 3);
  assert.ok(Array.isArray(result.anomalies));

  const ids = result.executedPlaybooks.map((item) => item.playbookId);
  assert.ok(ids.includes('system-health-check'));
  assert.ok(ids.includes('scanner-timeout'));
  assert.ok(ids.includes('alert-router-backlog'));
  assert.ok(ids.includes('read-model-slow-path'));

  const scanner = result.executedPlaybooks.find((item) => item.playbookId === 'scanner-timeout');
  assert.equal(scanner.status, 'rollback');
  assert.equal(scanner.attempts, 1);
  assert.equal(scanner.maxRetries, 0);

  const backlog = result.executedPlaybooks.find((item) => item.playbookId === 'alert-router-backlog');
  assert.equal(backlog.status, 'success');
  assert.equal(backlog.attempts, 2);
  assert.equal(backlog.retriesUsed, 1);
  assert.ok(backlog.matchedAnomalyCodes.includes('PENDING_BACKLOG_CRIT'));

  const slowPath = result.executedPlaybooks.find((item) => item.playbookId === 'read-model-slow-path');
  assert.equal(slowPath.status, 'success');
  assert.equal(slowPath.attempts, 2);
  assert.equal(slowPath.retriesUsed, 1);
  assert.ok(slowPath.matchedAnomalyCodes.includes('REFRESH_DURATION_CRIT'));

  for (let i = 1; i < result.executedPlaybooks.length; i += 1) {
    assert.ok(result.executedPlaybooks[i - 1].priorityScore >= result.executedPlaybooks[i].priorityScore);
  }
});
