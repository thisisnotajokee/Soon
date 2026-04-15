import type { TrackingWriteRepository } from '../../domain/ports';

export async function updateTrackingThresholds(
  repo: TrackingWriteRepository,
  asin: string,
  payload: {
    thresholdDropPct?: number;
    thresholdRisePct?: number;
    targetPriceNew?: number;
    targetPriceUsed?: number;
  },
): Promise<void> {
  await repo.updateThresholds(asin, payload);
}
