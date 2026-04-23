import { runAutomationCycle } from '../automation-cycle.mjs';

export async function runHunterRunnerWorker({ store }) {
  const startedAt = new Date().toISOString();
  const trackings = await store.listTrackings();

  // Fetch hunter config from store/runtime state to determine alert threshold per preset
  let alertThreshold = 70;
  try {
    const hunterState = store.getRuntimeState
      ? await store.getRuntimeState('hunter:custom-config')
      : null;
    const config = hunterState?.stateValue?.config ?? {};
    const preset = String(config.preset ?? 'balanced').trim().toLowerCase();
    const presetThresholds = {
      safe: 74,
      balanced: 68,
      aggressive: 58,
      high_value_focus: 70,
    };
    const threshold = presetThresholds[preset] ?? 68;
    const minDealScore = Number(config.minDealScore ?? 0);
    alertThreshold = minDealScore > 0 && minDealScore < 1
      ? Math.round(minDealScore * 100)
      : threshold;
  } catch {
    // fallback to default threshold
  }

  const cycle = runAutomationCycle(trackings, { alertThreshold });

  return {
    worker: 'hunter-runner',
    status: 'ok',
    decisions: cycle.decisions,
    tokenPlan: cycle.tokenPlan,
    alerts: cycle.alerts,
    alertThreshold,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
