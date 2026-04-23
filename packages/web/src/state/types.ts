export type ViewId = 'tracking' | 'deals' | 'add' | 'notifications' | 'settings';
export type DetailTab = 'overview' | 'settings';
export type Lang = 'pl' | 'en' | 'de';
export type TrackingStatusFilter = 'active' | 'all' | 'inactive';
export type DealsSource = 'all' | 'hunter' | 'web';
export type DealsSort = 'newest' | 'discount' | 'price_asc' | 'price_desc' | 'trust_desc';
export type TrackingSort = 'newest' | 'price_asc' | 'price_desc' | 'title_asc' | 'drop_desc' | 'category_asc' | 'deals_only' | 'stock_used' | 'with_alerts';
export type NotifTab = 'alerts' | 'history' | 'priceErrors';
export type AddMode = 'quick' | 'advanced';

export type MarketRow = {
  market: string;
  newPrice: number | null;
  usedPrice: number | null;
  isBestNew?: boolean;
  trendPct: number | null;
};

export type SparkPoint = {
  ts: string;
  value: number;
};

export type DetailHistoryPoint = {
  ts: string;
  value: number;
  market?: string;
  condition?: string;
};

export type ProductDetail = {
  asin: string;
  title?: string;
  pricesNew?: Record<string, number>;
  pricesUsed?: Record<string, number>;
  historyPoints?: SparkPoint[];
  historySeries?: DetailHistoryPoint[];
  updatedAt?: string;
};

export type CardPreview = {
  isActive: boolean;
  rating: number | null;
  imageUrl: string | null;
  popularity: number | null;
  outOfStock: boolean;
  bestDomain: string | null;
  bestPriceNew: number | null;
  bestPriceUsed: number | null;
  avgPriceNew: number | null;
  deltaPctVsAvg: number | null;
  marketRows: MarketRow[];
  sparkline: SparkPoint[];
};

export type SnoozeState = {
  until?: string;
  active?: boolean;
};

export type TrackingItem = {
  asin: string;
  title?: string;
  imageUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
  pricesNew?: Record<string, number>;
  pricesUsed?: Record<string, number>;
  cardPreview?: CardPreview;
  snooze?: SnoozeState | null;
  targetNew?: number | null;
  targetUsed?: number | null;
  thresholdDropPct?: number | null;
  thresholdRisePct?: number | null;
  targetPriceNew?: number | null;
  targetPriceUsed?: number | null;
};

export type DetailChartRow = {
  domain: string;
  recorded_at: string;
  price: number | null;
  price_used: number | null;
};

export type AppState = {
  activeView: ViewId;
  detailTab: DetailTab;
  selectedAsin: string | null;
  chatId: string;
  lang: Lang;
  query: string;
  trackings: TrackingItem[];
  trackingStatusFilter: TrackingStatusFilter;
  trackingSort: TrackingSort;
  detailByAsin: Record<string, ProductDetail>;
  detailChartRangeDays: number;
  detailChartMarketsByAsin: Record<string, string[]>;
  dealsSource: DealsSource;
  dealsSort: DealsSort;
  dealsList: any[];
  notifTab: NotifTab;
  alertsList: any[];
  addMode: AddMode;
  addDomains: string[];
  addPreset: string;
  addPriceType: string;
  addTrackMode: string;
  addDropPct: number | null;
  addRisePct: number | null;
  addStockEvents: string[];
  scanKpi: any;
  keepaTokenUsage: any;
  pwaInstallEvent: any;
  tgWebApp: any;
};
