import type { TrackingEntity } from '../../domain/entities';
import type { TrackingReadRepository } from '../../domain/ports';

export async function getTrackingList(repo: TrackingReadRepository): Promise<TrackingEntity[]> {
  return repo.listActive();
}
