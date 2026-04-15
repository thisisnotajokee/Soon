import type { TrackingEntity } from '../../domain/entities';
import type { TrackingReadRepository } from '../../domain/ports';

export class InMemoryTrackingReadRepository implements TrackingReadRepository {
  async listActive(): Promise<TrackingEntity[]> {
    return [];
  }
}
