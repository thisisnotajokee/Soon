import { DEFAULT_PLAYBOOKS } from '../domain/remediation-playbooks';

export function remediationCycle(): string[] {
  return DEFAULT_PLAYBOOKS.map((playbook) => playbook.id);
}
