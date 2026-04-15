import type { HunterDecision } from '../../domain/entities';
import type { HunterSignalProvider } from '../../domain/ports';

export async function runHunterCycle(signalProvider: HunterSignalProvider): Promise<HunterDecision[]> {
  const signals = await signalProvider.collectSignals();

  return signals.map((item) => ({
    asin: item.asin,
    score: item.signal,
    confidence: Math.min(1, Math.max(0, item.signal / 100)),
    reason: 'baseline-signal',
    shouldAlert: item.signal >= 70,
  }));
}
