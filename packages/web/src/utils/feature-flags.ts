export type FeatureFlagKey =
  | 'detail-experimental'
  | 'deals-v2'
  | 'ws-push'
  | 'advanced-add'
  | 'telemetry'
  | 'sw-cache';

const DEFAULT_FLAGS: Record<FeatureFlagKey, boolean> = {
  'detail-experimental': false,
  'deals-v2': false,
  'ws-push': false,
  'advanced-add': true,
  'telemetry': true,
  'sw-cache': true,
};

let overrides: Partial<Record<FeatureFlagKey, boolean>> = {};

try {
  const stored = window.localStorage.getItem('soon.flags');
  if (stored) {
    overrides = JSON.parse(stored) as Partial<Record<FeatureFlagKey, boolean>>;
  }
} catch {
  // ignore
}

export function isEnabled(key: FeatureFlagKey): boolean {
  return overrides[key] ?? DEFAULT_FLAGS[key];
}

export function setFlag(key: FeatureFlagKey, value: boolean): void {
  overrides[key] = value;
  try {
    window.localStorage.setItem('soon.flags', JSON.stringify(overrides));
  } catch {
    // ignore
  }
}

export function getAllFlags(): Record<FeatureFlagKey, boolean> {
  const result: Partial<Record<FeatureFlagKey, boolean>> = {};
  for (const key of Object.keys(DEFAULT_FLAGS) as FeatureFlagKey[]) {
    result[key] = isEnabled(key);
  }
  return result as Record<FeatureFlagKey, boolean>;
}
