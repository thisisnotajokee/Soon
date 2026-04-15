export type AlertKind = 'purchase' | 'technical';
export type AlertChannel = 'telegram' | 'discord';

export function resolveAlertChannel(kind: AlertKind): AlertChannel {
  return kind === 'purchase' ? 'telegram' : 'discord';
}
