import { runAutomationCycle } from '../automation-cycle.mjs';

export async function runHunterRunnerWorker({ store }) {
  const startedAt = new Date().toISOString();
  const trackings = await store.listTrackings();
  const cycle = runAutomationCycle(trackings);

  return {
    worker: 'hunter-runner',
    status: 'ok',
    decisions: cycle.decisions,
    tokenPlan: cycle.tokenPlan,
    alerts: cycle.alerts,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
