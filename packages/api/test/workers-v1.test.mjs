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
  assert.ok(Array.isArray(result.executedPlaybooks));
  assert.ok(result.executedPlaybooks.includes('scanner-timeout'));
});
