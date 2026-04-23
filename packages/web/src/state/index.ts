import type { AppState, Lang } from './types.js';

export * from './types.js';

export const MARKET_ORDER = ['de', 'it', 'fr', 'es', 'uk', 'nl', 'pl'];
export const DETAIL_MARKETS = ['de', 'it', 'fr', 'es', 'uk', 'nl'];
export const TRACKING_CARD_MARKETS = ['de', 'it', 'fr', 'es', 'uk', 'nl'];
export const DETAIL_CHART_ORDER = ['de', 'it', 'fr', 'nl', 'es', 'uk'];

export const I18N = {
  pl: {
    nav: {
      tracking: 'Śledzone',
      deals: 'Okazje',
      add: 'Dodaj',
      alerts: 'Alerty',
      settings: 'Ustawienia',
    },
    searchPlaceholder: 'Szukaj po tytule lub ASIN',
    details: 'Szczegóły produktu',
    bestPrice: 'Najlepsza cena',
    buyNow: 'Kup teraz',
    buyNowAt: 'w Amazon',
    noData: 'Brak danych',
    active: 'Aktywnie śledzony',
    paused: 'Śledzenie wyłączone',
    updated: 'Aktualizacja',
    overview: 'Przegląd',
    settingsTab: 'Ustawienia',
    chartHistory: 'Historia (new)',
    summaryCurrent: 'Obecna',
    summaryAvg: 'Śr. (90d)',
    summaryLow: 'Najniższa',
    summaryHigh: 'Najwyższa',
    summaryDrop30: 'Zmiana 30d',
    summaryAsin: 'ASIN',
    summaryUpdated: 'Aktualizacja',
    summaryAvailability: 'Dostępność',
    summarySince: 'Śledzenie od',
    summaryAlertsKind: 'Alerty aktywne',
    summaryThresholds: 'Progi alertów',
    summaryNoThresholds: 'Brak progów liczbowych',
    summaryTrackingActive: 'Tak',
    summaryTrackingPaused: 'Wyciszone',
    newPrices: 'CENY NOWE',
    usedPrices: 'CENY UŻYWANE',
    refreshAsin: 'Refresh ASIN',
    snooze60: 'Snooze 60 min',
    unsnooze: 'Unsnooze',
    setChatId: 'Ustaw Chat ID',
    dealsTitle: 'Okazje',
    dealsDesc: 'Zakładka w przygotowaniu.',
    addTitle: 'Dodaj',
    addDesc: 'Dodawanie produktu uruchomimy w kolejnym etapie.',
    alertsTitle: 'Alerty',
    alertsDesc: 'Panel alertów będzie rozwijany po sekcji Śledzone.',
  },
  en: {
    nav: {
      tracking: 'Tracked',
      deals: 'Deals',
      add: 'Add',
      alerts: 'Alerts',
      settings: 'Settings',
    },
    searchPlaceholder: 'Search by title or ASIN',
    details: 'Product details',
    bestPrice: 'Best price',
    buyNow: 'Buy now',
    buyNowAt: 'at Amazon',
    noData: 'No data',
    active: 'Actively tracked',
    paused: 'Tracking paused',
    updated: 'Updated',
    overview: 'Overview',
    settingsTab: 'Settings',
    chartHistory: 'History (new)',
    summaryCurrent: 'Current',
    summaryAvg: 'Avg (90d)',
    summaryLow: 'Lowest',
    summaryHigh: 'Highest',
    summaryDrop30: 'Change 30d',
    summaryAsin: 'ASIN',
    summaryUpdated: 'Updated',
    summaryAvailability: 'Availability',
    summarySince: 'Tracking since',
    summaryAlertsKind: 'Active alerts',
    summaryThresholds: 'Alert thresholds',
    summaryNoThresholds: 'No numeric thresholds',
    summaryTrackingActive: 'Yes',
    summaryTrackingPaused: 'Muted',
    newPrices: 'NEW PRICES',
    usedPrices: 'USED PRICES',
    refreshAsin: 'Refresh ASIN',
    snooze60: 'Snooze 60 min',
    unsnooze: 'Unsnooze',
    setChatId: 'Set Chat ID',
    dealsTitle: 'Deals',
    dealsDesc: 'This tab is in progress.',
    addTitle: 'Add',
    addDesc: 'Product add flow will be released in next stage.',
    alertsTitle: 'Alerts',
    alertsDesc: 'Alerts panel will be expanded after Tracked.',
  },
  de: {
    nav: {
      tracking: 'Getrackt',
      deals: 'Deals',
      add: 'Hinzufügen',
      alerts: 'Alarme',
      settings: 'Einstellungen',
    },
    searchPlaceholder: 'Suche nach Titel oder ASIN',
    details: 'Produktdetails',
    bestPrice: 'Bester Preis',
    buyNow: 'Jetzt kaufen',
    buyNowAt: 'bei Amazon',
    noData: 'Keine Daten',
    active: 'Aktiv getrackt',
    paused: 'Tracking pausiert',
    updated: 'Aktualisiert',
    overview: 'Überblick',
    settingsTab: 'Einstellungen',
    chartHistory: 'Historie (neu)',
    summaryCurrent: 'Aktuell',
    summaryAvg: 'Ø (90d)',
    summaryLow: 'Tiefstwert',
    summaryHigh: 'Höchstwert',
    summaryDrop30: 'Änderung 30d',
    summaryAsin: 'ASIN',
    summaryUpdated: 'Aktualisiert',
    summaryAvailability: 'Verfügbarkeit',
    summarySince: 'Tracking seit',
    summaryAlertsKind: 'Aktive Alarme',
    summaryThresholds: 'Alarm-Schwellen',
    summaryNoThresholds: 'Keine numerischen Schwellen',
    summaryTrackingActive: 'Ja',
    summaryTrackingPaused: 'Stumm',
    newPrices: 'NEU PREISE',
    usedPrices: 'GEBRAUCHT PREISE',
    refreshAsin: 'ASIN refresh',
    snooze60: 'Snooze 60 min',
    unsnooze: 'Unsnooze',
    setChatId: 'Chat ID speichern',
    dealsTitle: 'Deals',
    dealsDesc: 'Dieser Tab ist in Arbeit.',
    addTitle: 'Hinzufügen',
    addDesc: 'Produkt-Add-Flow folgt im nächsten Schritt.',
    alertsTitle: 'Alarme',
    alertsDesc: 'Alarm-Bereich wird nach Getrackt erweitert.',
  },
} as const;

function readChatId(): string {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('chatId') || params.get('userId') || params.get('x-telegram-user-id') || '';
  const fromStorage = (() => {
    try {
      return window.localStorage.getItem('soon.chatId') || '';
    } catch {
      return '';
    }
  })();
  return String(fromQuery || fromStorage || 'demo').trim() || 'demo';
}

function readLang(): Lang {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = String(params.get('lang') || '').trim().toLowerCase();
  if (fromQuery === 'pl' || fromQuery === 'en' || fromQuery === 'de') return fromQuery;

  const fromStorage = (() => {
    try {
      return String(window.localStorage.getItem('soon.lang') || '').trim().toLowerCase();
    } catch {
      return '';
    }
  })();

  if (fromStorage === 'pl' || fromStorage === 'en' || fromStorage === 'de') return fromStorage;
  return 'pl';
}

export const state: AppState = {
  activeView: 'tracking',
  detailTab: 'overview',
  selectedAsin: null,
  chatId: readChatId(),
  lang: readLang(),
  query: '',
  trackings: [],
  trackingStatusFilter: 'active',
  trackingSort: 'newest',
  detailByAsin: {},
  detailChartRangeDays: 90,
  detailChartMarketsByAsin: {},
  dealsSource: 'all',
  dealsSort: 'newest',
  dealsList: [],
  notifTab: 'alerts',
  alertsList: [],
  addMode: 'quick',
  addDomains: ['de', 'it', 'fr', 'es', 'uk', 'nl'],
  addPreset: 'standard',
  addPriceType: 'buybox',
  addTrackMode: 'drop',
  addDropPct: 10,
  addRisePct: 5,
  addStockEvents: ['out', 'back'],
  scanKpi: null,
  keepaTokenUsage: null,
  pwaInstallEvent: null,
  tgWebApp: null,
};
