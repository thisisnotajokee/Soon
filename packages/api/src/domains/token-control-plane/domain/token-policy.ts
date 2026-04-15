export type TokenBudgetInput = {
  expectedValue: number;
  confidence: number;
  tokenCost: number;
};

export function tokenPriorityScore(input: TokenBudgetInput): number {
  return (input.expectedValue * input.confidence) / Math.max(1, input.tokenCost);
}
