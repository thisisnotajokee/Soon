function resolveAlertChannel(kind) {
  return kind === 'purchase' ? 'telegram' : 'discord';
}

function tokenPriorityScore({ expectedValue, confidence, tokenCost }) {
  return (expectedValue * confidence) / Math.max(1, tokenCost);
}

function scoreTracking(tracking) {
  const pricesNew = Object.values(tracking.pricesNew ?? {});
  const pricesUsed = Object.values(tracking.pricesUsed ?? {});

  const avgNew = pricesNew.length
    ? pricesNew.reduce((acc, value) => acc + value, 0) / pricesNew.length
    : 0;
  const minNew = pricesNew.length ? Math.min(...pricesNew) : 0;

  const dropBoost = Math.min(35, (tracking.thresholdDropPct ?? 0) * 2);
  const spreadBoost = avgNew > 0 ? Math.min(30, ((avgNew - minNew) / avgNew) * 100) : 0;
  const usedBoost = pricesUsed.length ? 10 : 0;

  const score = Math.round(Math.max(0, Math.min(100, 35 + dropBoost + spreadBoost + usedBoost)));
  const confidence = Number((0.55 + Math.min(0.4, score / 250)).toFixed(2));

  return { score, confidence, avgNew, minNew };
}

function allocateTokenPlan(items, { mode = 'unbounded', budgetTokens = null } = {}) {
  const ranked = items
    .map((item) => ({
      asin: item.tracking.asin,
      tokenCost: item.tokenCost,
      expectedValue: Number(item.expectedValue.toFixed(2)),
      confidence: item.confidence,
      priority: item.tokenPriority,
    }))
    .sort((a, b) => b.priority - a.priority);

  const constrained = mode === 'capped' && Number.isFinite(budgetTokens) && budgetTokens >= 0;
  let remaining = constrained ? Number(Math.max(0, budgetTokens).toFixed(2)) : null;
  let selectedCount = 0;
  let selectedTokenCost = 0;

  const tokenPlan = ranked.map((item) => {
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

    return {
      ...item,
      selected: false,
      skipReason: 'budget_exceeded',
      remainingBudgetAfter: remaining,
    };
  });

  return {
    tokenPlan,
    summary: {
      requested: tokenPlan.length,
      selected: selectedCount,
      skipped: tokenPlan.length - selectedCount,
      budgetTokens: constrained ? Number(budgetTokens.toFixed(2)) : null,
      totalTokenCostSelected: Number(selectedTokenCost.toFixed(2)),
      remainingBudgetTokens: constrained ? Number(Math.max(0, remaining).toFixed(2)) : null,
    },
  };
}

export function runAutomationCycle(trackings, options = {}) {
  const tokenPolicyMode = options?.tokenPolicyMode === 'capped' ? 'capped' : 'unbounded';
  const tokenBudgetRaw = Number(options?.budgetTokens);
  const tokenBudget =
    tokenPolicyMode === 'capped' && Number.isFinite(tokenBudgetRaw)
      ? Number(Math.max(0, tokenBudgetRaw).toFixed(2))
      : null;
  const degradationModeSource = String(options?.degradationMode ?? 'none').trim().toLowerCase();
  const degradationMode =
    degradationModeSource === 'smart_deferral' || degradationModeSource === 'smart_probe'
      ? degradationModeSource
      : 'none';
  const deferralActive = degradationMode === 'smart_deferral';
  const probeActive = degradationMode === 'smart_probe';
  const deferredUntil = options?.deferredUntil ?? null;
  const items = trackings.map((tracking) => {
    const { score, confidence, avgNew, minNew } = scoreTracking(tracking);
    const tokenCost = Math.max(8, Object.keys(tracking.pricesNew ?? {}).length * 6);
    const expectedValue = Math.max(1, avgNew - minNew);

    return {
      tracking,
      score,
      confidence,
      tokenCost,
      expectedValue,
      tokenPriority: Number(tokenPriorityScore({ expectedValue, confidence, tokenCost }).toFixed(3)),
    };
  });

  const allocation = allocateTokenPlan(items, {
    mode: tokenPolicyMode,
    budgetTokens: tokenBudget,
  });
  const tokenPlan = allocation.tokenPlan;
  const selectedAsins = new Set(tokenPlan.filter((item) => item.selected).map((item) => item.asin));

  const decisions = items
    .filter((item) => selectedAsins.has(item.tracking.asin))
    .map((item) => ({
      asin: item.tracking.asin,
      score: item.score,
      confidence: item.confidence,
      shouldAlert: item.score >= 70,
      reason: item.score >= 70 ? 'high-value-opportunity' : 'hold-baseline',
    }));

  const alerts = decisions
    .filter((decision) => decision.shouldAlert)
    .map((decision) => ({
      asin: decision.asin,
      kind: 'purchase',
      channel: resolveAlertChannel('purchase'),
      reason: decision.reason,
    }));

  alerts.push({
    asin: 'system',
    kind: 'technical',
    channel: resolveAlertChannel('technical'),
    reason: deferralActive
      ? 'token_budget_exhausted_deferral'
      : probeActive
        ? 'token_budget_exhausted_probe'
        : 'runtime-heartbeat',
    deferredUntil: deferralActive ? deferredUntil : null,
  });

  const executedSteps = ['scan', 'score', 'token-allocate', 'route-alerts', 'self-check'];
  if (deferralActive) {
    executedSteps.push('degrade-smart-deferral');
  }
  if (probeActive) {
    executedSteps.push('degrade-smart-probe');
  }

  const degradationActive = deferralActive || probeActive;
  const degradationModeResponse = deferralActive
    ? 'token_budget_exhausted_deferral'
    : probeActive
      ? 'token_budget_exhausted_probe'
      : 'none';

  return {
    executedSteps,
    tokenPolicy: {
      mode: tokenPolicyMode,
      budgetTokens: allocation.summary.budgetTokens,
      selectedCount: allocation.summary.selected,
      skippedCount: allocation.summary.skipped,
      totalTokenCostSelected: allocation.summary.totalTokenCostSelected,
      remainingBudgetTokens: allocation.summary.remainingBudgetTokens,
    },
    degradation: {
      active: degradationActive,
      mode: degradationModeResponse,
      reason: degradationActive ? 'daily_token_budget_exhausted' : null,
      deferredUntil: deferralActive ? deferredUntil : null,
      probeBudgetTokens: probeActive ? allocation.summary.budgetTokens : null,
    },
    tokenPlan,
    decisions,
    alerts,
  };
}
