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

test('POST /api/token-control/allocate ranks candidates and applies token budget cap', async () => {
  await withServer(async (baseUrl) => {
    const allocation = await readJson(
      await fetch(`${baseUrl}/api/token-control/allocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          budgetTokens: 12,
          items: [
            { asin: 'A-LOW', expectedValue: 100, confidence: 0.5, tokenCost: 50 },
            { asin: 'B-HIGH', expectedValue: 60, confidence: 0.9, tokenCost: 10 },
            { asin: 'C-MID', expectedValue: 50, confidence: 0.4, tokenCost: 5 },
          ],
        }),
      }),
    );

    assert.equal(allocation.status, 200);
    assert.equal(allocation.body.status, 'ok');
    assert.equal(allocation.body.budgetMode, 'capped');
    assert.ok(allocation.body.snapshotId);
    assert.equal(allocation.body.summary.requested, 3);
    assert.equal(allocation.body.summary.selected, 1);
    assert.equal(allocation.body.summary.skipped, 2);
    assert.equal(allocation.body.summary.totalTokenCostSelected, 10);
    assert.equal(allocation.body.summary.remainingBudgetTokens, 2);
    assert.equal(allocation.body.plan[0].asin, 'B-HIGH');
    assert.equal(allocation.body.plan[0].selected, true);
    assert.equal(allocation.body.plan[1].asin, 'C-MID');
    assert.equal(allocation.body.plan[1].selected, false);
    assert.equal(allocation.body.plan[1].skipReason, 'budget_exceeded');
  });
});

test('GET /token-control/snapshots/latest returns persisted token allocation snapshots', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/token-control/allocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          budgetTokens: 30,
          items: [
            { asin: 'B0AAATEST1', expectedValue: 120, confidence: 0.7, tokenCost: 12 },
            { asin: 'B0AAATEST2', expectedValue: 80, confidence: 0.6, tokenCost: 8 },
          ],
        }),
      }),
    );

    const snapshots = await readJson(await fetch(`${baseUrl}/api/token-control/snapshots/latest?limit=5`));
    assert.equal(snapshots.status, 200);
    assert.ok(Array.isArray(snapshots.body.items));
    assert.ok(snapshots.body.count >= 1);
    assert.ok(snapshots.body.items[0].snapshotId);
    assert.ok(['unbounded', 'capped'].includes(snapshots.body.items[0].budgetMode));
    assert.ok(Array.isArray(snapshots.body.items[0].plan));
    assert.ok(snapshots.body.items[0].plan.length >= 1);
    assert.ok(typeof snapshots.body.items[0].summary.requested === 'number');
  });
});

test('GET /api/token-control/budget/status returns daily token budget status and window reset', async () => {
  await withServer(async (baseUrl) => {
    const dayOne = '2036-04-16';
    const dayTwo = '2036-04-17';

    const initial = await readJson(
      await fetch(`${baseUrl}/api/token-control/budget/status?mode=capped&budgetTokens=20&day=${dayOne}`),
    );
    assert.equal(initial.status, 200);
    assert.equal(initial.body.tokenBudgetStatus.day, dayOne);
    assert.equal(initial.body.tokenBudgetStatus.mode, 'capped');
    assert.equal(initial.body.tokenBudgetStatus.budgetTokens, 20);
    assert.equal(initial.body.tokenBudgetStatus.consumedTokens, 0);
    assert.equal(initial.body.tokenBudgetStatus.remainingTokens, 20);

    const runOne = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${dayOne}T08:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 20 },
        }),
      }),
    );
    assert.equal(runOne.status, 200);
    assert.ok(Number(runOne.body.tokenPolicy.totalTokenCostSelected) > 0);

    const afterOne = await readJson(
      await fetch(`${baseUrl}/api/token-control/budget/status?mode=capped&budgetTokens=20&day=${dayOne}`),
    );
    assert.equal(afterOne.status, 200);
    assert.ok(afterOne.body.tokenBudgetStatus.consumedTokens > 0);
    assert.ok(afterOne.body.tokenBudgetStatus.remainingTokens < 20);

    const runTwo = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${dayOne}T12:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 20 },
        }),
      }),
    );
    assert.equal(runTwo.status, 200);

    const afterTwo = await readJson(
      await fetch(`${baseUrl}/api/token-control/budget/status?mode=capped&budgetTokens=20&day=${dayOne}`),
    );
    assert.equal(afterTwo.status, 200);
    assert.ok(afterTwo.body.tokenBudgetStatus.consumedTokens >= afterOne.body.tokenBudgetStatus.consumedTokens);
    assert.ok(afterTwo.body.tokenBudgetStatus.remainingTokens <= afterOne.body.tokenBudgetStatus.remainingTokens);

    const nextDay = await readJson(
      await fetch(`${baseUrl}/api/token-control/budget/status?mode=capped&budgetTokens=20&day=${dayTwo}`),
    );
    assert.equal(nextDay.status, 200);
    assert.equal(nextDay.body.tokenBudgetStatus.day, dayTwo);
    assert.equal(nextDay.body.tokenBudgetStatus.consumedTokens, 0);
    assert.equal(nextDay.body.tokenBudgetStatus.remainingTokens, 20);
  });
});

test('POST /token-control/allocate validates payload shape', async () => {
  await withServer(async (baseUrl) => {
    const missingItems = await readJson(
      await fetch(`${baseUrl}/token-control/allocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    assert.equal(missingItems.status, 400);
    assert.equal(missingItems.body.error, 'items_required');

    const invalidBudget = await readJson(
      await fetch(`${baseUrl}/token-control/allocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          budgetTokens: -1,
          items: [{ asin: 'B0TEST1', expectedValue: 10, confidence: 0.5, tokenCost: 5 }],
        }),
      }),
    );
    assert.equal(invalidBudget.status, 400);
    assert.equal(invalidBudget.body.error, 'budget_tokens_invalid');

    const invalidItem = await readJson(
      await fetch(`${baseUrl}/token-control/allocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [{ asin: '', expectedValue: 10, confidence: 0.5, tokenCost: 5 }],
        }),
      }),
    );
    assert.equal(invalidItem.status, 400);
    assert.equal(invalidItem.body.error, 'invalid_item');
    assert.equal(invalidItem.body.reason, 'asin_required');
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
    assert.ok(body.tokenSnapshotId);
    assert.ok(body.tokenPolicy);
    assert.ok(['unbounded', 'capped'].includes(body.tokenPolicy.mode));
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

test('POST /automation/cycle applies capped token budget and skips over-budget candidates', async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: '2036-04-18T12:00:00.000Z',
          tokenPolicy: { mode: 'capped', budgetTokens: 12 },
        }),
      }),
    );

    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.tokenPolicy.mode, 'capped');
    assert.equal(body.tokenPolicy.budgetTokens, 12);
    assert.ok(body.tokenPolicy.selectedCount >= 0);
    assert.ok(body.tokenPolicy.skippedCount >= 1);
    assert.ok(Array.isArray(body.tokenPlan));
    assert.ok(body.tokenPlan.some((item) => item.selected === false));
    assert.ok(body.tokenPlan.some((item) => item.skipReason === 'budget_exceeded'));

    const selectedAsins = new Set(body.tokenPlan.filter((item) => item.selected).map((item) => item.asin));
    assert.ok(body.decisions.every((decision) => selectedAsins.has(decision.asin)));
  });
});

test('POST /automation/cycle triggers smart deferral when daily token budget is exhausted', async () => {
  await withServer(async (baseUrl) => {
    const day = '2036-05-01';

    const firstRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T08:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12 },
        }),
      }),
    );

    assert.equal(firstRun.status, 200);
    assert.equal(firstRun.body.tokenPolicy.mode, 'capped');
    assert.equal(firstRun.body.tokenBudgetStatus?.remainingTokens, 0);

    const secondRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12 },
        }),
      }),
    );

    assert.equal(secondRun.status, 200);
    assert.equal(secondRun.body.tokenPolicy.mode, 'capped');
    assert.equal(secondRun.body.tokenPolicy.budgetTokens, 0);
    assert.equal(secondRun.body.tokenPolicy.selectedCount, 0);
    assert.ok(Array.isArray(secondRun.body.decisions));
    assert.equal(secondRun.body.decisions.length, 0);
    assert.ok(secondRun.body.tokenPlan.every((item) => item.selected === false));
    assert.ok(secondRun.body.tokenPlan.every((item) => item.skipReason === 'budget_exceeded'));
    assert.equal(secondRun.body.degradation?.active, true);
    assert.equal(secondRun.body.degradation?.mode, 'token_budget_exhausted_deferral');
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.triggered, true);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.action, 'smart_deferral');
    assert.ok(secondRun.body.alerts.some((alert) => alert.reason === 'token_budget_exhausted_deferral'));

    const runtimeState = await readJson(
      await fetch(`${baseUrl}/api/self-heal/runtime-state?key=token_budget_last_deferral_at`),
    );
    assert.equal(runtimeState.status, 200);
    assert.equal(runtimeState.body.found, true);
    assert.equal(runtimeState.body.runtimeState?.stateValue?.reason, 'daily_token_budget_exhausted');
    assert.equal(runtimeState.body.runtimeState?.stateValue?.day, day);
  });
});

test('POST /automation/cycle uses one-shot smart probe before fallback deferral when budget is exhausted', async () => {
  await withServer(async (baseUrl) => {
    const day = '2036-05-02';

    const firstRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T08:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12, probeBudgetTokens: 10 },
        }),
      }),
    );

    assert.equal(firstRun.status, 200);
    assert.equal(firstRun.body.tokenBudgetStatus?.remainingTokens, 0);

    const secondRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12, probeBudgetTokens: 10 },
        }),
      }),
    );

    assert.equal(secondRun.status, 200);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.triggered, true);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.action, 'smart_probe');
    assert.equal(secondRun.body.degradation?.active, true);
    assert.equal(secondRun.body.degradation?.mode, 'token_budget_exhausted_probe');
    assert.equal(secondRun.body.degradation?.probeBudgetTokens, 10);
    assert.ok(secondRun.body.tokenBudgetAutoRemediation?.probeCooldownSec > 0);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probeBlockedByCooldown, false);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.maxProbesPerDay, 1);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probesUsedToday, 0);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probesUsedAfterAction, 1);
    assert.equal(secondRun.body.tokenPolicy?.budgetTokens, 10);
    assert.ok(secondRun.body.alerts.some((alert) => alert.reason === 'token_budget_exhausted_probe'));

    const probeRuntimeState = await readJson(
      await fetch(`${baseUrl}/api/self-heal/runtime-state?key=token_budget_last_probe_at`),
    );
    assert.equal(probeRuntimeState.status, 200);
    assert.equal(probeRuntimeState.body.found, true);
    assert.equal(probeRuntimeState.body.runtimeState?.stateValue?.day, day);
    assert.equal(probeRuntimeState.body.runtimeState?.stateValue?.probeBudgetTokens, 10);
    assert.equal(probeRuntimeState.body.runtimeState?.stateValue?.probesForDay, 1);

    const thirdRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T12:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12, probeBudgetTokens: 10 },
        }),
      }),
    );

    assert.equal(thirdRun.status, 200);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.triggered, true);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.action, 'smart_deferral');
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probeBlockedByDailyCap, true);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probesUsedToday, 1);
    assert.equal(thirdRun.body.degradation?.mode, 'token_budget_exhausted_deferral');
    assert.ok(thirdRun.body.alerts.some((alert) => alert.reason === 'token_budget_exhausted_deferral'));
  });
});

test('POST /automation/cycle allows second smart probe after cooldown elapses', async () => {
  await withServer(async (baseUrl) => {
    const day = '2036-05-03';

    const firstRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T08:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 2,
          },
        }),
      }),
    );
    assert.equal(firstRun.status, 200);
    assert.equal(firstRun.body.tokenBudgetStatus?.remainingTokens, 0);

    const secondRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 2,
          },
        }),
      }),
    );
    assert.equal(secondRun.status, 200);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.action, 'smart_probe');
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probeCooldownSec, 3600);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.maxProbesPerDay, 2);

    const thirdRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:30:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 2,
          },
        }),
      }),
    );
    assert.equal(thirdRun.status, 200);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.action, 'smart_deferral');
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probeBlockedByCooldown, true);
    assert.ok(thirdRun.body.tokenBudgetAutoRemediation?.probeCooldownRemainingSec > 0);

    const fourthRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T11:15:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 2,
          },
        }),
      }),
    );
    assert.equal(fourthRun.status, 200);
    assert.equal(fourthRun.body.tokenBudgetAutoRemediation?.action, 'smart_probe');
    assert.equal(fourthRun.body.degradation?.mode, 'token_budget_exhausted_probe');
  });
});

test('POST /automation/cycle blocks probe by daily cap even after cooldown elapsed', async () => {
  await withServer(async (baseUrl) => {
    const day = '2036-05-04';

    const firstRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T08:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 1,
          },
        }),
      }),
    );
    assert.equal(firstRun.status, 200);
    assert.equal(firstRun.body.tokenBudgetStatus?.remainingTokens, 0);

    const secondRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 1,
          },
        }),
      }),
    );
    assert.equal(secondRun.status, 200);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.action, 'smart_probe');

    const thirdRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T11:30:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 1,
          },
        }),
      }),
    );
    assert.equal(thirdRun.status, 200);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.action, 'smart_deferral');
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probeBlockedByCooldown, false);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probeBlockedByDailyCap, true);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probesUsedToday, 1);
  });
});

test('POST /automation/cycle autotunes probe policy under high token-pressure conditions', async () => {
  await withServer(async (baseUrl) => {
    const day = '2036-05-05';

    const firstRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T08:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 300,
            maxProbesPerDay: 4,
            autoTuneProbePolicy: true,
          },
        }),
      }),
    );
    assert.equal(firstRun.status, 200);
    assert.equal(firstRun.body.tokenBudgetStatus?.remainingTokens, 0);

    const secondRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 300,
            maxProbesPerDay: 4,
            autoTuneProbePolicy: true,
          },
        }),
      }),
    );
    assert.equal(secondRun.status, 200);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.action, 'smart_probe');
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.configuredProbeCooldownSec, 300);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.configuredMaxProbesPerDay, 4);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probePolicyAutoTuneEnabled, true);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probePolicyAutoTuneApplied, true);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probePolicyPressureBand, 'critical');
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probePolicyAutoTuneReason, 'critical_budget_pressure');
    assert.ok(secondRun.body.tokenBudgetAutoRemediation?.probePolicyUsagePct >= 95);
    assert.ok(secondRun.body.tokenBudgetAutoRemediation?.probeCooldownSec >= 43200);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.maxProbesPerDay, 1);

    const thirdRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:30:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 300,
            maxProbesPerDay: 4,
            autoTuneProbePolicy: true,
          },
        }),
      }),
    );
    assert.equal(thirdRun.status, 200);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.action, 'smart_deferral');
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probeBlockedByCooldown, true);
    assert.ok(thirdRun.body.tokenBudgetAutoRemediation?.probeCooldownRemainingSec > 0);
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

test('GET /api/runtime-self-heal-status returns retry queue operational view', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/self-heal/run`, {
        method: 'POST',
      }),
    );

    const status = await readJson(await fetch(`${baseUrl}/api/runtime-self-heal-status`));
    assert.equal(status.status, 200);
    assert.equal(status.body.status, 'ok');
    assert.ok(['PASS', 'WARN', 'CRIT'].includes(status.body.overall));
    assert.ok(status.body.retryQueue);
    assert.ok(typeof status.body.retryQueue.scheduler === 'string');
    assert.ok(Number.isFinite(status.body.retryQueue.queuePending));
    assert.ok(Number.isFinite(status.body.retryQueue.deadLetterCount));
    assert.ok(Array.isArray(status.body.signals));
  });
});

test('GET /self-heal/runtime-state exposes allowlisted remediation state and cooldown snapshot', async () => {
  const store = createInMemoryStore();
  const now = new Date().toISOString();

  await store.recordAutomationCycle({
    cycle: {
      executedSteps: ['test-runtime-state-drift'],
      tokenPlan: [],
      decisions: [
        {
          asin: 'B0BYW7MMBR',
          score: 81,
          confidence: 0.8,
          shouldAlert: true,
          reason: 'runtime-state-drift-injected-for-test',
        },
      ],
      alerts: [
        {
          asin: 'B0BYW7MMBR',
          kind: 'purchase',
          channel: 'discord',
          reason: 'runtime-state-drift-injected-for-test',
        },
      ],
    },
    trackingCount: 1,
    startedAt: now,
    finishedAt: now,
  });

  await withServer(async (baseUrl) => {
    const missingKey = await readJson(await fetch(`${baseUrl}/self-heal/runtime-state`));
    assert.equal(missingKey.status, 400);
    assert.equal(missingKey.body.error, 'key_required');

    const invalidKey = await readJson(await fetch(`${baseUrl}/self-heal/runtime-state?key=unknown_key`));
    assert.equal(invalidKey.status, 400);
    assert.equal(invalidKey.body.error, 'key_not_allowed');

    const heal = await readJson(
      await fetch(`${baseUrl}/self-heal/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          alertRoutingRemediation: { mode: 'window', limit: 5, cooldownSec: 3600 },
        }),
      }),
    );
    assert.equal(heal.status, 200);
    assert.equal(heal.body.alertRoutingAutoRemediation.triggered, true);

    const runtimeState = await readJson(
      await fetch(`${baseUrl}/api/self-heal/runtime-state?key=alert_routing_last_remediation_at`),
    );
    assert.equal(runtimeState.status, 200);
    assert.equal(runtimeState.body.status, 'ok');
    assert.equal(runtimeState.body.key, 'alert_routing_last_remediation_at');
    assert.equal(runtimeState.body.found, true);
    assert.ok(runtimeState.body.runtimeState?.stateValue?.timestamp);
    assert.equal(runtimeState.body.runtimeState?.stateValue?.cooldownSec, 3600);
    assert.equal(runtimeState.body.cooldown?.cooldownActive, true);
    assert.ok(runtimeState.body.cooldown?.cooldownRemainingSec > 0);
  }, { store });
});

test('GET /api/check-alert-status enforces channel policy telemetry', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    const status = await readJson(await fetch(`${baseUrl}/api/check-alert-status?limit=5`));
    assert.equal(status.status, 200);
    assert.equal(status.body.status, 'ok');
    assert.equal(status.body.policy.purchase, 'telegram');
    assert.equal(status.body.policy.technical, 'discord');
    assert.ok(status.body.window.runs >= 1);
    assert.equal(status.body.violations.total, 0);
    assert.equal(status.body.overall, 'PASS');
    assert.ok(Number.isFinite(status.body.alertsByChannel.telegram));
    assert.ok(Number.isFinite(status.body.alertsByChannel.discord));
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
    assert.match(body, /soon_self_heal_retry_exhausted_total/);
    assert.match(body, /soon_self_heal_retry_backoff_seconds/);
    assert.match(body, /soon_self_heal_dead_letter_total/);
    assert.match(body, /soon_self_heal_manual_requeue_total/);
    assert.match(body, /soon_runtime_self_heal_overall_score/);
    assert.match(body, /soon_runtime_self_heal_signals_total/);
    assert.match(body, /soon_alert_routing_overall_score/);
    assert.match(body, /soon_alert_routing_violations_total/);
    assert.match(body, /soon_alert_routing_purchase_non_telegram_total/);
    assert.match(body, /soon_alert_routing_technical_non_discord_total/);
    assert.match(body, /soon_alert_routing_remediation_cooldown_remaining_seconds/);
    assert.match(body, /soon_token_control_snapshot_present/);
    assert.match(body, /soon_token_control_selected_count\{budget_mode="/);
    assert.match(body, /soon_token_control_skipped_count\{budget_mode="/);
    assert.match(body, /soon_token_control_budget_usage_pct\{budget_mode="/);
    assert.match(body, /soon_token_budget_daily_limit_tokens\{mode="/);
    assert.match(body, /soon_token_budget_consumed_tokens\{mode="/);
    assert.match(body, /soon_token_budget_remaining_tokens\{mode="/);
    assert.match(body, /soon_token_budget_usage_pct\{mode="/);
    assert.match(body, /soon_token_budget_exhausted\{mode="/);
    assert.match(body, /soon_token_budget_policy_fallback_active\{mode="/);
    assert.match(body, /soon_token_budget_deferral_active\{mode="/);
    assert.match(body, /soon_token_budget_last_deferral_unixtime/);
    assert.match(body, /soon_token_budget_probe_active\{mode="/);
    assert.match(body, /soon_token_budget_last_probe_unixtime/);
    assert.match(body, /soon_token_budget_probe_cooldown_remaining_seconds\{mode="/);
    assert.match(body, /soon_token_budget_probe_daily_cap\{mode="/);
    assert.match(body, /soon_token_budget_probe_daily_used\{mode="/);
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
    assert.ok(
      process.body.summary.completed + process.body.summary.rescheduled + process.body.summary.deadLettered >= 1,
    );

    const retryStatus = await readJson(await fetch(`${baseUrl}/self-heal/retry/status`));
    assert.equal(retryStatus.status, 200);
    assert.ok(retryStatus.body.queuePending >= 0);
  });
});

test('POST /self-heal/retry/process stores retry_budget_exhausted dead-letter reason', async () => {
  const store = createInMemoryStore();
  await store.enqueueSelfHealRetryJobs({
    runId: 'run-retry-budget-exhausted-test',
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
    },
    { store },
  );
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

    const invalidFrom = await readJson(await fetch(`${baseUrl}/self-heal/requeue-audit?from=invalid-date`));
    assert.equal(invalidFrom.status, 400);
    assert.equal(invalidFrom.body.error, 'invalid_from_timestamp');
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
      assert.equal(bulk.body.summary.conflicts, 0);
      assert.equal(bulk.body.summary.missing, 0);
      assert.ok(Array.isArray(bulk.body.summary.items));
      assert.equal(bulk.body.summary.items.length, 2);
      assert.equal(bulk.body.operationalAlert, null);
      assert.ok(bulk.body.retryStatus.queuePending >= 2);
      assert.ok(bulk.body.retryStatus.manualRequeueTotal >= 2);

      const secondBulk = await readJson(
        await fetch(`${baseUrl}/self-heal/dead-letter/requeue-bulk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deadLetterIds: selectedIds }),
        }),
      );
      assert.equal(secondBulk.status, 200);
      assert.equal(secondBulk.body.summary.requested, 2);
      assert.equal(secondBulk.body.summary.requeued, 0);
      assert.equal(secondBulk.body.summary.conflicts, 2);
      assert.equal(secondBulk.body.summary.missing, 0);
      assert.equal(secondBulk.body.operationalAlert?.level, 'warn');
      assert.equal(secondBulk.body.operationalAlert?.code, 'self_heal_bulk_requeue_partial');
      assert.ok(Array.isArray(secondBulk.body.operationalAlert?.reasons));
      assert.ok(secondBulk.body.operationalAlert.reasons.includes('conflicts'));

      const audit = await readJson(await fetch(`${baseUrl}/self-heal/requeue-audit?limit=5`));
      assert.equal(audit.status, 200);
      assert.ok(Array.isArray(audit.body.items));
      assert.ok(audit.body.items.length >= 2);
      assert.equal(audit.body.items[0].reason, 'manual_requeue');

      const filteredByReason = await readJson(
        await fetch(`${baseUrl}/self-heal/requeue-audit?limit=5&reason=manual_requeue`),
      );
      assert.equal(filteredByReason.status, 200);
      assert.ok(filteredByReason.body.count >= 2);

      const filteredMissingReason = await readJson(
        await fetch(`${baseUrl}/self-heal/requeue-audit?limit=5&reason=unknown_reason`),
      );
      assert.equal(filteredMissingReason.status, 200);
      assert.equal(filteredMissingReason.body.count, 0);

      const futureFrom = encodeURIComponent(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
      const filteredFuture = await readJson(await fetch(`${baseUrl}/self-heal/requeue-audit?limit=5&from=${futureFrom}`));
      assert.equal(filteredFuture.status, 200);
      assert.equal(filteredFuture.body.count, 0);

      const summary = await readJson(await fetch(`${baseUrl}/self-heal/requeue-audit/summary?days=30`));
      assert.equal(summary.status, 200);
      assert.ok(Number.isFinite(summary.body.total));
      assert.ok(Array.isArray(summary.body.byReason));
      assert.ok(summary.body.byReason.every((item) => typeof item.reason === 'string' && Number.isFinite(item.count)));
      assert.ok(Array.isArray(summary.body.byPlaybook));
      assert.ok(summary.body.byPlaybook.every((item) => typeof item.playbookId === 'string' && Number.isFinite(item.count)));
      assert.ok(Array.isArray(summary.body.daily));
      assert.ok(summary.body.daily.every((item) => typeof item.day === 'string' && Number.isFinite(item.count)));
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
