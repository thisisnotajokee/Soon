export type RemediationPlaybook = {
  id: string;
  trigger: string;
  actions: string[];
};

export const DEFAULT_PLAYBOOKS: RemediationPlaybook[] = [
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
