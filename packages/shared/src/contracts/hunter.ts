export type HunterRunDto = {
  runId: string;
  startedAt: string;
  status: 'running' | 'ok' | 'failed';
};
