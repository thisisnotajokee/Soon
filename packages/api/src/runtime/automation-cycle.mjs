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

export function runAutomationCycle(trackings) {
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

  const tokenPlan = items
    .map((item) => ({
      asin: item.tracking.asin,
      tokenCost: item.tokenCost,
      expectedValue: Number(item.expectedValue.toFixed(2)),
      confidence: item.confidence,
      priority: item.tokenPriority,
    }))
    .sort((a, b) => b.priority - a.priority);

  const decisions = items.map((item) => ({
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
    reason: 'runtime-heartbeat',
  });

  return {
    executedSteps: ['scan', 'score', 'token-allocate', 'route-alerts', 'self-check'],
    tokenPlan,
    decisions,
    alerts,
  };
}
