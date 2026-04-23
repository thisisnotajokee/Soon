function resolveAlertChannel(kind) {
  return kind === 'purchase' ? 'telegram' : 'discord';
}

function tokenPriorityScore({ expectedValue, confidence, tokenCost }) {
  return (expectedValue * confidence) / Math.max(1, tokenCost);
}

function calculateTrend(prices, minPoints = 3) {
  if (!Array.isArray(prices) || prices.length < minPoints) return 0;
  const n = prices.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = prices.reduce((a, b) => a + b, 0);
  const sumXY = prices.reduce((sum, y, x) => sum + x * y, 0);
  const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
  const slope = (n * sumXY - sumX * sumY) / Math.max(1, n * sumXX - sumX * sumX);
  const avg = sumY / n;
  if (avg <= 0) return 0;
  const pctChange = (slope / avg) * 100;
  // Cena spada = pozytywny sygnał (możliwa okazja)
  if (pctChange < -2) return 15;
  if (pctChange < -0.5) return 8;
  if (pctChange > 2) return -5;
  return 5;
}

function calculateVolatility(prices) {
  if (!Array.isArray(prices) || prices.length < 2) return 0;
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  if (avg <= 0) return 0;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  return stdDev / avg;
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
  const trendBoost = calculateTrend(pricesNew);
  const volatility = calculateVolatility(pricesNew);
  const volatilityPenalty = volatility > 0.3 ? -10 : volatility > 0.15 ? -5 : 0;

  const rawScore = dropBoost + spreadBoost + usedBoost + trendBoost + volatilityPenalty;
  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  const dataPoints = pricesNew.length;
  const daysOfHistory = dataPoints > 1 ? (tracking.priceHistoryDays ?? dataPoints) : 0;
  const baseConfidence = 0.2;
  const scoreComponent = Math.min(0.5, score / 200);
  const dataComponent = Math.min(0.3, dataPoints / 100) + Math.min(0.15, daysOfHistory / 30);
  const confidence = Number((baseConfidence + scoreComponent + dataComponent).toFixed(2));

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
  const alertThreshold = Number(options?.alertThreshold ?? options?.minDealScore ?? 70);

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
      shouldAlert: item.score >= alertThreshold,
      reason: item.score >= alertThreshold ? 'high-value-opportunity' : 'hold-baseline',
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
