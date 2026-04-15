import type { HunterDecision } from './entities';

export interface HunterDecisionRepository {
  saveMany(decisions: HunterDecision[]): Promise<void>;
}

export interface HunterSignalProvider {
  collectSignals(): Promise<Array<{ asin: string; signal: number }>>;
}
