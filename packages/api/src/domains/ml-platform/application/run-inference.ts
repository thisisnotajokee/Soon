import { BASELINE_POLICY } from '../domain/model-policy';

export function runInference(): { policy: string } {
  return { policy: BASELINE_POLICY.mode };
}
