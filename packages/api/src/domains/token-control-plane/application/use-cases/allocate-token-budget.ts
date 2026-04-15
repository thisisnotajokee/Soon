import { tokenPriorityScore, type TokenBudgetInput } from '../../domain/token-policy';

export function allocateTokenBudget(items: TokenBudgetInput[]): TokenBudgetInput[] {
  return [...items].sort((a, b) => tokenPriorityScore(b) - tokenPriorityScore(a));
}
