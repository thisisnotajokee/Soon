import { resolveAlertChannel, type AlertKind } from '../domain/channel-policy';

export function dispatchAlert(kind: AlertKind): { channel: 'telegram' | 'discord' } {
  return { channel: resolveAlertChannel(kind) };
}
