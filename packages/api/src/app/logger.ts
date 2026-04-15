export const logger = {
  info(message: string, payload?: unknown): void {
    console.log('[Soon/api]', message, payload ?? '');
  },
  warn(message: string, payload?: unknown): void {
    console.warn('[Soon/api]', message, payload ?? '');
  },
  error(message: string, payload?: unknown): void {
    console.error('[Soon/api]', message, payload ?? '');
  },
};
