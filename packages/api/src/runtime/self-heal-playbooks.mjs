export const DEFAULT_PLAYBOOKS = [
  {
    id: 'scanner-timeout',
    trigger: 'scanner timeout spike',
    actions: ['restart-scanner-worker', 'requeue-batch', 'verify-health'],
  },
  {
    id: 'alert-router-backlog',
    trigger: 'alert queue backlog',
    actions: ['scale-alert-consumers', 'drain-dlq', 'verify-routing-policy'],
  },
];

export function remediationCycle() {
  return DEFAULT_PLAYBOOKS.map((playbook) => playbook.id);
}
