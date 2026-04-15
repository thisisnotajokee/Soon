export type MarketCode = 'de' | 'it' | 'fr' | 'es' | 'uk' | 'nl';

export type TrackingEntity = {
  asin: string;
  title: string;
  pricesNew: Partial<Record<MarketCode, number>>;
  pricesUsed: Partial<Record<MarketCode, number>>;
  thresholdDropPct?: number;
  thresholdRisePct?: number;
};
