import type { HunterDecision } from '../../domain/entities';
import type { HunterDecisionRepository } from '../../domain/ports';

export class InMemoryHunterDecisionRepository implements HunterDecisionRepository {
  async saveMany(_decisions: HunterDecision[]): Promise<void> {
    // TODO: persist to DB.
  }
}
