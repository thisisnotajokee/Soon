import { remediationCycle } from '../self-heal-playbooks.mjs';

export async function runSelfHealWorker({ readModelStatusProvider } = {}) {
  const startedAt = new Date().toISOString();
  const readModelStatus = readModelStatusProvider
    ? await readModelStatusProvider().catch(() => null)
    : null;
  const cycle = remediationCycle({ readModelStatus });
  const executedPlaybooks = [...cycle.executedPlaybooks];

  return {
    worker: 'self-heal',
    source: 'self-heal-worker-v1',
    status: cycle.status,
    anomalyCount: cycle.anomalies.length,
    anomalies: cycle.anomalies,
    playbookCount: executedPlaybooks.length,
    executedPlaybooks,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
