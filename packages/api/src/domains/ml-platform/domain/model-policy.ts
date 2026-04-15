export type ModelPolicy = {
  mode: 'offline-replay' | 'canary' | 'production';
  allowOverrideDecision: boolean;
};

export const BASELINE_POLICY: ModelPolicy = {
  mode: 'offline-replay',
  allowOverrideDecision: false,
};
