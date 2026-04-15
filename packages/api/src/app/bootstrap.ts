import { readConfig } from './config';
import { logger } from './logger';
import { healthSnapshot } from './health';

export function bootstrapApp(): void {
  const config = readConfig();
  logger.info('Soon API bootstrap start', {
    env: config.env,
    region: config.region,
  });

  logger.info('Soon API health snapshot', healthSnapshot());
}
