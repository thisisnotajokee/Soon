export type HunterDecision = {
  asin: string;
  score: number;
  confidence: number;
  reason: string;
  shouldAlert: boolean;
};
