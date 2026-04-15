import type { TrackingEntity } from './entities';

export interface TrackingReadRepository {
  listActive(): Promise<TrackingEntity[]>;
}

export interface TrackingWriteRepository {
  updateThresholds(
    asin: string,
    payload: {
      thresholdDropPct?: number;
      thresholdRisePct?: number;
      targetPriceNew?: number;
      targetPriceUsed?: number;
    },
  ): Promise<void>;
}
