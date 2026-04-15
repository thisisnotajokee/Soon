import { remediationCycle } from '../self-heal-playbooks.mjs';

export async function runSelfHealWorker() {
  const startedAt = new Date().toISOString();
  const playbooks = remediationCycle();

  return {
    worker: 'self-heal',
    status: 'ok',
    executedPlaybooks: playbooks,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
