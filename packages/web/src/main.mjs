import { createApiClient } from '/api-client.mjs';

const client = createApiClient(window.location.origin);
const params = new URLSearchParams(window.location.search);
const queryChatId = params.get('chatId') || params.get('userId') || params.get('x-telegram-user-id') || '';
const savedChatId = (() => {
  try {
    return window.localStorage.getItem('soon.chatId') || '';
  } catch {
    return '';
  }
})();
const initialChatId = String(queryChatId || savedChatId || 'demo').trim() || 'demo';

const state = {
  trackings: [],
  selectedAsin: null,
  filterQuery: '',
  filterSnooze: 'all',
  sortBy: 'updated_desc',
  settings: null,
  chatId: initialChatId,
  activeView: 'trackings',
  lang: 'pl',
  detailOpen: false,
  detailTab: 'overview',
  detailDraft: null,
  detailRange: '3m',
  detailMarket: 'de',
};

const DEFAULT_CHANNELS = {
  telegram: true,
  discord: false,
  email: false,
  push: false,
};

const nodes = {
  healthStatus: document.querySelector('#health-status'),
  healthStorage: document.querySelector('#health-storage'),
  chatId: document.querySelector('#chat-id'),
  trackingsCount: document.querySelector('#trackings-count'),
  trackingList: document.querySelector('#tracking-list'),
  detailEmpty: document.querySelector('#detail-empty'),
  detailContent: document.querySelector('#detail-content'),
  detailTitle: document.querySelector('#detail-title'),
  detailAsin: document.querySelector('#detail-asin'),
  detailThumbImg: document.querySelector('#detail-thumb-img'),
  detailThumbFallback: document.querySelector('#detail-thumb-fallback'),
  detailRating: document.querySelector('#detail-rating'),
  detailMarketFlag: document.querySelector('#detail-market-flag'),
  detailMainPrice: document.querySelector('#detail-main-price'),
  detailBestBadge: document.querySelector('#detail-best-badge'),
  detailDropBadge: document.querySelector('#detail-drop-badge'),
  detailBuyNow: document.querySelector('#detail-buy-now'),
  detailSnoozeBadge: document.querySelector('#detail-snooze-badge'),
  detailChart: document.querySelector('#detail-chart'),
  detailRangeRow: document.querySelector('.detail-range-row'),
  detailMarketRow: document.querySelector('.detail-market-row'),
  miniMin: document.querySelector('#mini-min'),
  miniMax: document.querySelector('#mini-max'),
  miniAvg: document.querySelector('#mini-avg'),
  miniVolatility: document.querySelector('#mini-volatility'),
  miniDaysFromMin: document.querySelector('#mini-days-from-min'),
  detailNewPrices: document.querySelector('#detail-new-prices'),
  detailUsedPrices: document.querySelector('#detail-used-prices'),
  detailThresholds: document.querySelector('#detail-thresholds'),
  detailSummary: document.querySelector('#detail-summary'),
  detailHistory: document.querySelector('#detail-history'),
  detailOverlay: document.querySelector('#detail-overlay'),
  detailBack: document.querySelector('#detail-back'),
  detailShare: document.querySelector('#detail-share'),
  detailDelete: document.querySelector('#detail-delete'),
  detailTabs: document.querySelector('#detail-tabs'),
  detailTabOverview: document.querySelector('#detail-tab-overview'),
  detailTabSettings: document.querySelector('#detail-tab-settings'),
  detailPanelOverview: document.querySelector('#detail-panel-overview'),
  detailPanelSettings: document.querySelector('#detail-panel-settings'),
  thresholdForm: document.querySelector('#threshold-form'),
  thresholdDropPct: document.querySelector('#threshold-drop-pct'),
  thresholdRisePct: document.querySelector('#threshold-rise-pct'),
  thresholdTargetNew: document.querySelector('#threshold-target-new'),
  thresholdTargetUsed: document.querySelector('#threshold-target-used'),
  detailAlertStatus: document.querySelector('#detail-alert-status'),
  actionRefresh: document.querySelector('#action-refresh'),
  actionSnooze: document.querySelector('#action-snooze'),
  actionUnsnooze: document.querySelector('#action-unsnooze'),
  detailSnoozeQuick: document.querySelector('.detail-snooze-quick'),
  filterQuery: document.querySelector('#filter-query'),
  searchClear: document.querySelector('#search-clear'),
  filterSnoozeChips: document.querySelector('#filter-snooze-chips'),
  sortChips: document.querySelector('#sort-chips'),
  copyMobileUrl: document.querySelector('#copy-mobile-url'),
  settingsForm: document.querySelector('#settings-form'),
  settingsProductInterval: document.querySelector('#settings-product-interval'),
  settingsScanInterval: document.querySelector('#settings-scan-interval'),
  settingsNotifications: document.querySelector('#settings-notifications'),
  settingsChannelTelegram: document.querySelector('#settings-channel-telegram'),
  settingsChannelDiscord: document.querySelector('#settings-channel-discord'),
  settingsChannelEmail: document.querySelector('#settings-channel-email'),
  settingsChannelPush: document.querySelector('#settings-channel-push'),
  settingsAlertProfiles: document.querySelector('#settings-alert-profiles'),
  settingsUpdated: document.querySelector('#settings-updated'),
  uiError: document.querySelector('#ui-error'),
  reloadTrackings: document.querySelector('#reload-trackings'),
  reloadDetail: document.querySelector('#reload-detail'),
  bottomNav: document.querySelector('.bottom-nav'),
  viewTrackings: document.querySelector('#view-trackings'),
  viewDeals: document.querySelector('#view-deals'),
  viewAdd: document.querySelector('#view-add'),
  viewAlerts: document.querySelector('#view-alerts'),
  viewSettings: document.querySelector('#view-settings'),
};

const I18N = {
  pl: {
    'nav.trackings': 'Śledzone',
    'nav.deals': 'Okazje',
    'nav.add': 'Dodaj',
    'nav.alerts': 'Alerty',
    'nav.settings': 'Ustawienia',
    'view.deals_title': 'Okazje',
    'view.add_title': 'Dodaj',
    'view.alerts_title': 'Alerty',
    'view.placeholder': 'Widok w przygotowaniu dla Soon UI v1.',
  },
  en: {
    'nav.trackings': 'Tracked',
    'nav.deals': 'Deals',
    'nav.add': 'Add',
    'nav.alerts': 'Alerts',
    'nav.settings': 'Settings',
    'view.deals_title': 'Deals',
    'view.add_title': 'Add',
    'view.alerts_title': 'Alerts',
    'view.placeholder': 'View is being prepared for Soon UI v1.',
  },
  de: {
    'nav.trackings': 'Verfolgt',
    'nav.deals': 'Angebote',
    'nav.add': 'Hinzufügen',
    'nav.alerts': 'Alarme',
    'nav.settings': 'Einstellungen',
    'view.deals_title': 'Angebote',
    'view.add_title': 'Hinzufügen',
    'view.alerts_title': 'Alarme',
    'view.placeholder': 'Ansicht wird für Soon UI v1 vorbereitet.',
  },
};

function setError(message) {
  if (!message) {
    nodes.uiError.classList.add('hidden');
    nodes.uiError.textContent = '';
    return;
  }
  nodes.uiError.textContent = message;
  nodes.uiError.classList.remove('hidden');
}

function detectLanguage() {
  const paramsLang = String(params.get('lang') || '').trim().toLowerCase();
  const savedLang = (() => {
    try {
      return String(window.localStorage.getItem('soon.lang') || '').trim().toLowerCase();
    } catch {
      return '';
    }
  })();
  const browserLang = String(window.navigator.language || 'pl').slice(0, 2).toLowerCase();
  const candidate = paramsLang || savedLang || browserLang;
  return ['pl', 'en', 'de'].includes(candidate) ? candidate : 'pl';
}

function applyI18n(lang) {
  const labels = I18N[lang] || I18N.pl;
  document.documentElement.lang = lang;
  const textNodes = document.querySelectorAll('[data-i18n]');
  for (const node of textNodes) {
    const key = node.getAttribute('data-i18n');
    const value = labels[key];
    if (value) node.textContent = value;
  }
  try {
    window.localStorage.setItem('soon.lang', lang);
  } catch {
    // ignore storage limitations
  }
  queueAutoFit();
}

function setActiveView(nextView) {
  const allowed = ['trackings', 'deals', 'add', 'alerts', 'settings'];
  const view = allowed.includes(nextView) ? nextView : 'trackings';
  state.activeView = view;
  if (view !== 'trackings') {
    closeDetailOverlay();
  }

  const views = [
    { id: 'trackings', node: nodes.viewTrackings },
    { id: 'deals', node: nodes.viewDeals },
    { id: 'add', node: nodes.viewAdd },
    { id: 'alerts', node: nodes.viewAlerts },
    { id: 'settings', node: nodes.viewSettings },
  ];

  for (const item of views) {
    const active = item.id === view;
    item.node.classList.toggle('hidden', !active);
    item.node.classList.toggle('on', active);
  }

  const navButtons = nodes.bottomNav.querySelectorAll('button[data-view-target]');
  for (const button of navButtons) {
    button.classList.toggle('on', button.dataset.viewTarget === view);
  }
  queueAutoFit();
}

function openDetailOverlay() {
  state.detailOpen = true;
  nodes.detailOverlay.classList.remove('hidden');
  nodes.detailOverlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('detail-open');
}

function closeDetailOverlay() {
  state.detailOpen = false;
  nodes.detailOverlay.classList.add('hidden');
  nodes.detailOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('detail-open');
}

function setDetailTab(nextTab) {
  const tab = nextTab === 'settings' ? 'settings' : 'overview';
  state.detailTab = tab;
  nodes.detailTabOverview.classList.toggle('on', tab === 'overview');
  nodes.detailTabSettings.classList.toggle('on', tab === 'settings');
  nodes.detailPanelOverview.classList.toggle('hidden', tab !== 'overview');
  nodes.detailPanelOverview.classList.toggle('on', tab === 'overview');
  nodes.detailPanelSettings.classList.toggle('hidden', tab !== 'settings');
  nodes.detailPanelSettings.classList.toggle('on', tab === 'settings');
  queueAutoFit();
}

let autoFitRaf = 0;
function queueAutoFit() {
  window.cancelAnimationFrame(autoFitRaf);
  autoFitRaf = window.requestAnimationFrame(() => {
    runAutoFit();
  });
}

function runAutoFit() {
  const targets = document.querySelectorAll('[data-autofit]');
  for (const element of targets) {
    const min = Number(element.getAttribute('data-fit-min')) || 11;
    const max = Number(element.getAttribute('data-fit-max')) || 18;
    const step = Number(element.getAttribute('data-fit-step')) || 0.5;
    fitTextToBox(element, min, max, step);
  }
}

function fitTextToBox(element, minSize, maxSize, step) {
  if (!element.isConnected) return;
  let size = maxSize;
  element.style.fontSize = `${size}px`;
  element.style.lineHeight = '1.24';

  while (size > minSize) {
    const overflowX = element.scrollWidth - element.clientWidth > 1;
    const overflowY = element.scrollHeight - element.clientHeight > 1;
    if (!overflowX && !overflowY) break;
    size = Math.max(minSize, size - step);
    element.style.fontSize = `${size}px`;
  }
}

function configureStaticAutoFitTargets() {
  const navLabels = document.querySelectorAll('.bottom-nav-label');
  for (const label of navLabels) {
    label.setAttribute('data-autofit', '1');
    label.setAttribute('data-fit-min', '10');
    label.setAttribute('data-fit-max', '12');
    label.setAttribute('data-fit-step', '0.25');
  }
}

function eur(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'EUR' }).format(value);
}

function toFiniteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatIso(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso ?? '');
  return date.toLocaleString('pl-PL');
}

function minPrice(prices = {}) {
  const values = Object.values(prices).map(Number).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function setDetailDraftFromDetail(detail) {
  state.detailDraft = {
    thresholdDropPct: toFiniteOrNull(detail?.thresholds?.thresholdDropPct),
    thresholdRisePct: toFiniteOrNull(detail?.thresholds?.thresholdRisePct),
    targetPriceNew: toFiniteOrNull(detail?.thresholds?.targetPriceNew),
    targetPriceUsed: toFiniteOrNull(detail?.thresholds?.targetPriceUsed),
  };
}

function renderDetailAlertStatus() {
  if (!nodes.detailAlertStatus || !state.detailDraft) return;
  const drop = Number.isFinite(state.detailDraft.thresholdDropPct) ? `${Math.round(state.detailDraft.thresholdDropPct)}%` : '—';
  const rise = Number.isFinite(state.detailDraft.thresholdRisePct) ? `${Math.round(state.detailDraft.thresholdRisePct)}%` : '—';
  const newTarget = Number.isFinite(state.detailDraft.targetPriceNew) ? eur(state.detailDraft.targetPriceNew) : '—';
  const usedTarget = Number.isFinite(state.detailDraft.targetPriceUsed) ? eur(state.detailDraft.targetPriceUsed) : '—';
  nodes.detailAlertStatus.textContent = `Alert: drop ${drop} | rise ${rise} | target new ${newTarget} | target used ${usedTarget}`;
}

function minPriceEntry(prices = {}) {
  let minMarket = null;
  let minValue = Number.POSITIVE_INFINITY;
  for (const [market, valueRaw] of Object.entries(prices || {})) {
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) continue;
    if (value < minValue) {
      minValue = value;
      minMarket = market;
    }
  }
  if (!Number.isFinite(minValue)) return null;
  return { market: String(minMarket || '').toUpperCase(), value: minValue };
}

function computeDropPct(summary) {
  const min = Number(summary?.min);
  const max = Number(summary?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return null;
  const drop = ((max - min) / max) * 100;
  return Number.isFinite(drop) ? Math.round(drop) : null;
}

function computeMiniStats(detail, historyPoints) {
  const min = Number(detail?.summary?.min);
  const max = Number(detail?.summary?.max);
  const avg = Number(detail?.summary?.avg);
  const volatility = Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(avg) && avg > 0
    ? Math.round(((max - min) / avg) * 100)
    : null;

  let daysFromMin = null;
  if (Array.isArray(historyPoints) && historyPoints.length && Number.isFinite(min)) {
    const minPoint = historyPoints
      .map((p) => ({ ts: Date.parse(String(p?.ts || '')), value: Number(p?.value) }))
      .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.value))
      .reduce((acc, p) => {
        if (!acc) return p;
        if (p.value <= acc.value) return p;
        return acc;
      }, null);
    if (minPoint?.ts) {
      daysFromMin = Math.max(0, Math.floor((Date.now() - minPoint.ts) / (1000 * 60 * 60 * 24)));
    }
  }

  return { min, max, avg, volatility, daysFromMin };
}

function amazonHostForDomain(domain) {
  const map = {
    de: 'www.amazon.de',
    it: 'www.amazon.it',
    fr: 'www.amazon.fr',
    es: 'www.amazon.es',
    nl: 'www.amazon.nl',
    uk: 'www.amazon.co.uk',
    pl: 'www.amazon.pl',
  };
  const key = String(domain || '').toLowerCase();
  return map[key] || map.de;
}

function marketFlag(domain) {
  const map = {
    de: '🇩🇪',
    it: '🇮🇹',
    fr: '🇫🇷',
    es: '🇪🇸',
    uk: '🇬🇧',
    nl: '🇳🇱',
    pl: '🇵🇱',
  };
  return map[String(domain || '').toLowerCase()] || '🇩🇪';
}

function buildAmazonProductUrl(asin, domain) {
  const safeAsin = String(asin || '').trim().toUpperCase();
  if (!safeAsin) return '';
  return `https://${amazonHostForDomain(domain)}/dp/${encodeURIComponent(safeAsin)}`;
}

const TRACKING_MARKET_ORDER = ['de', 'it', 'fr', 'es', 'uk', 'nl', 'pl'];

function sortTrackingMarkets(markets = []) {
  return [...markets].sort((leftRaw, rightRaw) => {
    const left = String(leftRaw || '').toLowerCase();
    const right = String(rightRaw || '').toLowerCase();
    const leftIndex = TRACKING_MARKET_ORDER.indexOf(left);
    const rightIndex = TRACKING_MARKET_ORDER.indexOf(right);
    const safeLeft = leftIndex >= 0 ? leftIndex : Number.POSITIVE_INFINITY;
    const safeRight = rightIndex >= 0 ? rightIndex : Number.POSITIVE_INFINITY;
    if (safeLeft !== safeRight) return safeLeft - safeRight;
    return left.localeCompare(right);
  });
}

function normalizeSparkline(points = []) {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      const ts = String(point?.ts || '').trim();
      const value = Number(point?.value ?? point?.price);
      if (!ts || !Number.isFinite(value)) return null;
      return { ts, value: Number(value.toFixed(2)) };
    })
    .filter(Boolean)
    .slice(-30);
}

function buildFallbackMarketRows(item) {
  const pricesNew = item?.pricesNew && typeof item.pricesNew === 'object' ? item.pricesNew : {};
  const pricesUsed = item?.pricesUsed && typeof item.pricesUsed === 'object' ? item.pricesUsed : {};
  const bestNew = minPriceEntry(pricesNew);
  const avgNew = Object.values(pricesNew).map(Number).filter(Number.isFinite);
  const avgPriceNew = avgNew.length ? avgNew.reduce((sum, value) => sum + value, 0) / avgNew.length : null;
  const markets = sortTrackingMarkets(new Set([...Object.keys(pricesNew), ...Object.keys(pricesUsed)]));
  return markets.map((market) => {
    const newPrice = toFiniteOrNull(pricesNew[market]);
    const usedPrice = toFiniteOrNull(pricesUsed[market]);
    const trendPct =
      Number.isFinite(newPrice) && Number.isFinite(avgPriceNew) && avgPriceNew > 0
        ? Number((((newPrice - avgPriceNew) / avgPriceNew) * 100).toFixed(2))
        : null;
    return {
      market,
      newPrice,
      usedPrice,
      isBestNew: Boolean(bestNew && bestNew.market.toLowerCase() === market && Number.isFinite(newPrice)),
      trendPct,
    };
  });
}

function buildTrackingCardPreview(item) {
  const card = item?.cardPreview && typeof item.cardPreview === 'object' ? item.cardPreview : null;
  const pricesNew = item?.pricesNew && typeof item.pricesNew === 'object' ? item.pricesNew : {};
  const pricesUsed = item?.pricesUsed && typeof item.pricesUsed === 'object' ? item.pricesUsed : {};
  const bestNew = minPriceEntry(pricesNew);
  const allNewValues = Object.values(pricesNew).map(Number).filter(Number.isFinite);
  const avgPriceNew = allNewValues.length
    ? Number((allNewValues.reduce((sum, value) => sum + value, 0) / allNewValues.length).toFixed(2))
    : null;
  const fallbackBestPriceNew = Number.isFinite(bestNew?.value) ? Number(bestNew.value.toFixed(2)) : null;
  const fallbackBestPriceUsed = (() => {
    const values = Object.values(pricesUsed).map(Number).filter(Number.isFinite);
    return values.length ? Number(Math.min(...values).toFixed(2)) : null;
  })();
  const fallbackDeltaPct =
    Number.isFinite(fallbackBestPriceNew) && Number.isFinite(avgPriceNew) && avgPriceNew > 0
      ? Number((((fallbackBestPriceNew - avgPriceNew) / avgPriceNew) * 100).toFixed(2))
      : null;
  const fallbackMarkets = buildFallbackMarketRows(item);

  const apiMarkets = Array.isArray(card?.marketRows)
    ? card.marketRows
        .map((row) => {
          const market = String(row?.market || '').trim().toLowerCase();
          if (!market) return null;
          return {
            market,
            newPrice: toFiniteOrNull(row?.newPrice),
            usedPrice: toFiniteOrNull(row?.usedPrice),
            isBestNew: Boolean(row?.isBestNew),
            trendPct: toFiniteOrNull(row?.trendPct),
          };
        })
        .filter(Boolean)
    : [];

  const marketRows = apiMarkets.length
    ? [...apiMarkets].sort((left, right) => {
        const leftIndex = TRACKING_MARKET_ORDER.indexOf(String(left.market || '').toLowerCase());
        const rightIndex = TRACKING_MARKET_ORDER.indexOf(String(right.market || '').toLowerCase());
        const safeLeft = leftIndex >= 0 ? leftIndex : Number.POSITIVE_INFINITY;
        const safeRight = rightIndex >= 0 ? rightIndex : Number.POSITIVE_INFINITY;
        if (safeLeft !== safeRight) return safeLeft - safeRight;
        return String(left.market || '').localeCompare(String(right.market || ''));
      })
    : fallbackMarkets;
  const sparkline = normalizeSparkline(card?.sparkline);
  const fallbackSparkline = normalizeSparkline(item?.historyPoints);

  return {
    isActive: card?.isActive === false ? false : true,
    rating: toFiniteOrNull(card?.rating),
    imageUrl: String(card?.imageUrl || '').trim(),
    popularity: toFiniteOrNull(card?.popularity),
    outOfStock: Boolean(card?.outOfStock),
    bestDomain: String(card?.bestDomain || bestNew?.market || '').trim().toLowerCase() || null,
    bestPriceNew: toFiniteOrNull(card?.bestPriceNew) ?? fallbackBestPriceNew,
    bestPriceUsed: toFiniteOrNull(card?.bestPriceUsed) ?? fallbackBestPriceUsed,
    avgPriceNew: toFiniteOrNull(card?.avgPriceNew) ?? avgPriceNew,
    deltaPctVsAvg: toFiniteOrNull(card?.deltaPctVsAvg) ?? fallbackDeltaPct,
    marketRows,
    sparkline: sparkline.length ? sparkline : fallbackSparkline,
  };
}

function starText(rating) {
  const value = Number(rating);
  if (!Number.isFinite(value) || value <= 0) return '';
  const rounded = Math.max(0, Math.min(5, Math.round(value)));
  return `${'★'.repeat(rounded)}${'☆'.repeat(5 - rounded)}`;
}

function recommendationBadge(deltaPct) {
  const delta = Number(deltaPct);
  if (!Number.isFinite(delta)) return null;
  if (delta <= -15) return { text: 'Kup teraz', kind: 'buy' };
  if (delta <= -7) return { text: 'Dobra okazja', kind: 'great' };
  return { text: 'Poczekaj', kind: 'wait' };
}

function renderCardSparkline(container, points) {
  const normalized = normalizeSparkline(points);
  if (!normalized.length) {
    container.innerHTML = '';
    return;
  }
  const width = 360;
  const height = 92;
  const padding = 8;
  const values = normalized.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const stepX = normalized.length > 1 ? (width - padding * 2) / (normalized.length - 1) : 0;
  const pointsAttr = normalized
    .map((point, index) => {
      const x = padding + index * stepX;
      const y = height - padding - ((point.value - min) / span) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');
  const areaPoints = `${padding},${height - padding} ${pointsAttr} ${width - padding},${height - padding}`;
  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Mini historia cen">
      <polyline points="${areaPoints}" fill="rgba(255,122,20,0.08)" stroke="none"></polyline>
      <polyline points="${pointsAttr}" fill="none" stroke="#ff7a14" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></polyline>
    </svg>
  `;
}

function openAmazonByDomain(asin, domain) {
  const url = buildAmazonProductUrl(asin, domain);
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function resolveImageUrl(...candidates) {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const keys = ['imageUrl', 'image', 'thumbnail', 'thumb', 'photo', 'image_url'];
    for (const key of keys) {
      const value = String(candidate[key] || '').trim();
      if (!value) continue;
      if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) {
        return value;
      }
    }
  }
  return '';
}

function getVisibleTrackings() {
  const query = state.filterQuery.trim().toLowerCase();
  const scoped = state.trackings.filter((item) => {
    const title = String(item?.title ?? '').toLowerCase();
    const asin = String(item?.asin ?? '').toLowerCase();
    const matchQuery = !query || title.includes(query) || asin.includes(query);

    const snoozeActive = Boolean(item?.snooze?.active);
    const matchSnooze =
      state.filterSnooze === 'all'
        ? true
        : state.filterSnooze === 'snoozed'
          ? snoozeActive
          : !snoozeActive;

    return matchQuery && matchSnooze;
  });

  const sorters = {
    updated_desc: (a, b) => Date.parse(String(b.updatedAt ?? 0)) - Date.parse(String(a.updatedAt ?? 0)),
    new_min_asc: (a, b) => (minPrice(a.pricesNew) ?? Number.POSITIVE_INFINITY) - (minPrice(b.pricesNew) ?? Number.POSITIVE_INFINITY),
    used_min_asc: (a, b) => (minPrice(a.pricesUsed) ?? Number.POSITIVE_INFINITY) - (minPrice(b.pricesUsed) ?? Number.POSITIVE_INFINITY),
    title_asc: (a, b) => String(a.title ?? '').localeCompare(String(b.title ?? ''), 'pl'),
  };
  const sorter = sorters[state.sortBy] ?? sorters.updated_desc;
  return scoped.slice().sort(sorter);
}

function renderTrackingList() {
  const visible = getVisibleTrackings();
  nodes.trackingList.innerHTML = '';
  nodes.trackingsCount.textContent = String(visible.length);

  for (const item of visible) {
    const preview = buildTrackingCardPreview(item);
    const li = document.createElement('li');
    li.className = `tracking-item${item.asin === state.selectedAsin ? ' selected' : ''}`;

    const card = document.createElement('div');
    card.className = 'pcard';
    card.dataset.asin = item.asin;

    const cardTop = document.createElement('div');
    cardTop.className = 'pcard-top';

    const thumb = document.createElement('div');
    thumb.className = 'pcard-img';
    const thumbFallback = document.createElement('span');
    thumbFallback.className = 'pcard-img-fallback';
    thumbFallback.textContent = '📦';
    thumb.appendChild(thumbFallback);
    const imageUrl = String(preview.imageUrl || resolveImageUrl(item) || '').trim();
    if (imageUrl) {
      const img = document.createElement('img');
      img.alt = item.title || item.asin;
      img.loading = 'lazy';
      img.src = imageUrl;
      img.addEventListener('load', () => {
        thumb.classList.add('has-image');
      });
      img.addEventListener('error', () => {
        thumb.classList.remove('has-image');
      });
      thumb.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'pcard-info';

    const title = document.createElement('strong');
    title.className = 'tracking-title pcard-title';
    title.setAttribute('data-autofit', '1');
    title.setAttribute('data-fit-min', '12');
    title.setAttribute('data-fit-max', '16');
    title.setAttribute('data-fit-step', '0.5');
    title.textContent = item.title || item.asin;

    const meta = document.createElement('div');
    meta.className = 'pcard-meta';
    const stars = starText(preview.rating);
    meta.innerHTML = stars
      ? `<span class="stars">${stars}</span><span>(${Number(preview.rating).toFixed(1)})</span>`
      : '<span class="stars">☆☆☆☆☆</span><span>(0.0)</span>';

    const statusRow = document.createElement('div');
    statusRow.className = 'pcard-track-status';
    const statusBadge = document.createElement('span');
    statusBadge.className = `track-status-badge ${preview.isActive ? 'active' : 'inactive'}`;
    statusBadge.innerHTML = preview.isActive
      ? '<span class="material-icons-round">track_changes</span>Aktywnie śledzony'
      : '<span class="material-icons-round">pause_circle</span>Śledzenie wyłączone';
    statusRow.appendChild(statusBadge);

    const cardPrices = document.createElement('div');
    cardPrices.className = 'pcard-prices';
    const priceRow = document.createElement('div');
    priceRow.className = 'pcard-price-row';
    const bestDomain = preview.bestDomain || 'de';

    const marketBadge = document.createElement('span');
    marketBadge.className = 'pflag flag-round';
    marketBadge.textContent = marketFlag(bestDomain);

    const newMin = document.createElement('span');
    newMin.className = 'pprice';
    newMin.textContent = eur(preview.bestPriceNew);

    priceRow.append(marketBadge, newMin);

    const deltaPctRaw = Number(preview.deltaPctVsAvg);
    if (Number.isFinite(deltaPctRaw) && Math.abs(deltaPctRaw) >= 2) {
      const dropBadge = document.createElement('span');
      dropBadge.className = `pdrop ${deltaPctRaw > 0 ? 'up' : 'dn'}`;
      dropBadge.textContent = `${deltaPctRaw > 0 ? '+' : ''}${Math.round(deltaPctRaw)}%`;
      priceRow.append(dropBadge);
    }

    if (Number.isFinite(preview.bestPriceUsed)) {
      const usedMin = document.createElement('span');
      usedMin.className = 'target-price-badge inline';
      usedMin.textContent = `u:${eur(preview.bestPriceUsed)}`;
      priceRow.append(usedMin);
    }

    priceRow.addEventListener('click', (event) => {
      event.stopPropagation();
      openAmazonByDomain(item.asin, bestDomain);
    });

    cardPrices.appendChild(priceRow);

    info.append(title, meta, statusRow, cardPrices);
    cardTop.append(thumb, info);
    card.appendChild(cardTop);

    const signalItems = [];
    const reco = recommendationBadge(preview.deltaPctVsAvg);
    if (reco) {
      const recoChip = document.createElement('span');
      recoChip.className = `reco ${reco.kind}`;
      const icon = reco.kind === 'buy' ? 'shopping_bag' : reco.kind === 'great' ? 'local_offer' : 'schedule';
      recoChip.innerHTML = `<span class="material-icons-round">${icon}</span>${reco.text}`;
      signalItems.push(recoChip);
    }
    if (Number.isFinite(deltaPctRaw) && deltaPctRaw <= -20) {
      const atlChip = document.createElement('span');
      atlChip.className = 'atl-badge';
      atlChip.innerHTML = '<span class="material-icons-round">south</span>Historyczne minimum';
      signalItems.push(atlChip);
    }
    if (preview.outOfStock) {
      const stockChip = document.createElement('span');
      stockChip.className = 'stock-badge out-of-stock';
      stockChip.textContent = 'Brak w magazynie';
      signalItems.push(stockChip);
    }
    if (Number.isFinite(preview.popularity) && preview.popularity > 1) {
      const popChip = document.createElement('span');
      popChip.className = 'pop-badge';
      popChip.textContent = `popularne ${Math.round(preview.popularity)}`;
      signalItems.push(popChip);
    }

    if (item?.snooze?.active) {
      const snoozeChip = document.createElement('span');
      snoozeChip.className = 'snooze-badge';
      snoozeChip.textContent = `snooze do ${formatIso(item.snooze.until)}`;
      signalItems.push(snoozeChip);
    }

    if (signalItems.length) {
      const signalsRow = document.createElement('div');
      signalsRow.className = 'pcard-signals-row';
      const signals = document.createElement('div');
      signals.className = 'pcard-signals';
      for (const signal of signalItems) {
        signals.appendChild(signal);
      }
      signalsRow.appendChild(signals);
      card.appendChild(signalsRow);
    }

    const grid = document.createElement('div');
    grid.className = 'pgrid';
    for (const row of preview.marketRows) {
      const domain = String(row?.market || '').toLowerCase();
      if (!domain) continue;
      const gridItem = document.createElement('div');
      gridItem.className = 'pgrid-item';
      gridItem.dataset.domain = domain;

      const flag = document.createElement('span');
      flag.className = 'pgrid-flag flag-round';
      flag.textContent = marketFlag(domain);

      const newPrice = document.createElement('span');
      newPrice.className = `pgrid-price${row?.isBestNew ? ' best' : ''}`;
      newPrice.textContent = Number.isFinite(row?.newPrice) ? eur(row.newPrice) : '—';

      gridItem.append(flag, newPrice);

      if (Number.isFinite(row?.usedPrice)) {
        const usedPrice = document.createElement('span');
        usedPrice.className = 'pgrid-used';
        usedPrice.textContent = `u:${eur(row.usedPrice)}`;
        gridItem.appendChild(usedPrice);
      }

      if (Number.isFinite(row?.trendPct) && Math.abs(row.trendPct) >= 2) {
        const trend = document.createElement('span');
        trend.className = `pgrid-trend ${row.trendPct > 0 ? 'up' : 'dn'}`;
        trend.textContent = row.trendPct > 0 ? '↑' : '↓';
        gridItem.appendChild(trend);
      }

      gridItem.addEventListener('click', (event) => {
        event.stopPropagation();
        openAmazonByDomain(item.asin, domain);
      });

      grid.appendChild(gridItem);
    }
    card.appendChild(grid);

    const spark = document.createElement('div');
    spark.className = 'pcard-spark';
    renderCardSparkline(spark, preview.sparkline);
    if (spark.innerHTML) {
      card.appendChild(spark);
    }

    li.appendChild(card);
    nodes.trackingList.appendChild(li);
  }

  syncChipState(nodes.filterSnoozeChips, 'data-filter-snooze', state.filterSnooze);
  syncChipState(nodes.sortChips, 'data-sort-by', state.sortBy);
  queueAutoFit();
}

function syncChipState(container, attributeName, activeValue) {
  if (!container) return;
  const chips = container.querySelectorAll('button');
  for (const chip of chips) {
    const isActive = chip.getAttribute(attributeName) === activeValue;
    chip.classList.toggle('on', isActive);
  }
}

function syncDetailChoiceRows() {
  if (nodes.detailRangeRow) {
    const rangeButtons = nodes.detailRangeRow.querySelectorAll('button[data-range]');
    for (const button of rangeButtons) {
      const isActive = String(button.dataset.range || '') === state.detailRange;
      button.classList.toggle('on', isActive);
    }
  }
  if (nodes.detailMarketRow) {
    const marketButtons = nodes.detailMarketRow.querySelectorAll('button[data-market]');
    for (const button of marketButtons) {
      const isActive = String(button.dataset.market || '').toLowerCase() === state.detailMarket;
      button.classList.toggle('on', isActive);
    }
  }
}

function renderMapList(node, mapping) {
  node.innerHTML = '';
  const entries = Object.entries(mapping || {}).sort((left, right) => {
    const leftMarket = String(left[0] || '').toLowerCase();
    const rightMarket = String(right[0] || '').toLowerCase();
    if (leftMarket === state.detailMarket && rightMarket !== state.detailMarket) return -1;
    if (rightMarket === state.detailMarket && leftMarket !== state.detailMarket) return 1;
    const leftIndex = TRACKING_MARKET_ORDER.indexOf(leftMarket);
    const rightIndex = TRACKING_MARKET_ORDER.indexOf(rightMarket);
    const safeLeft = leftIndex >= 0 ? leftIndex : Number.POSITIVE_INFINITY;
    const safeRight = rightIndex >= 0 ? rightIndex : Number.POSITIVE_INFINITY;
    if (safeLeft !== safeRight) return safeLeft - safeRight;
    return leftMarket.localeCompare(rightMarket);
  });
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'brak danych';
    node.appendChild(li);
    return;
  }
  for (const [market, value] of entries) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${market.toUpperCase()}</span><strong>${eur(Number(value))}</strong>`;
    node.appendChild(li);
  }
}

function renderPlainList(node, rows) {
  node.innerHTML = '';
  for (const [label, value] of rows) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    node.appendChild(li);
  }
}

function renderHistory(node, points) {
  node.innerHTML = '';
  const list = Array.isArray(points) ? points.slice(-12).reverse() : [];
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'brak danych';
    node.appendChild(li);
    return;
  }
  for (const point of list) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${formatIso(point.ts)}</span><strong>${eur(Number(point.value))}</strong>`;
    node.appendChild(li);
  }
}

function renderChart(points) {
  const values = (Array.isArray(points) ? points : [])
    .map((row) => ({ ts: Date.parse(String(row.ts ?? '')), value: Number(row.value) }))
    .filter((row) => Number.isFinite(row.ts) && Number.isFinite(row.value))
    .sort((a, b) => a.ts - b.ts);

  if (!values.length) {
    nodes.detailChart.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#7a7a7a">brak danych</text>';
    return;
  }

  const min = Math.min(...values.map((row) => row.value));
  const max = Math.max(...values.map((row) => row.value));
  const span = Math.max(max - min, 1);
  const width = 600;
  const height = 180;
  const padding = 14;
  const xStep = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;

  const pointsAttr = values
    .map((row, index) => {
      const x = padding + index * xStep;
      const y = height - padding - ((row.value - min) / span) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');

  const gridLines = [];
  for (let i = 0; i < 6; i += 1) {
    const y = padding + ((height - padding * 2) / 5) * i;
    gridLines.push(`<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="#2a2f37" />`);
  }
  for (let i = 0; i < 7; i += 1) {
    const x = padding + ((width - padding * 2) / 6) * i;
    gridLines.push(`<line x1="${x}" y1="${padding}" x2="${x}" y2="${height - padding}" stroke="#232833" />`);
  }

  nodes.detailChart.innerHTML = [
    ...gridLines,
    `<polyline points="${pointsAttr}" fill="none" stroke="#ff7a14" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`,
    `<text x="${padding}" y="18" fill="#9ca3af" font-size="12">min ${eur(min)}</text>`,
    `<text x="${width - padding}" y="18" fill="#9ca3af" font-size="12" text-anchor="end">max ${eur(max)}</text>`,
  ].join('');
}

function getSelectedTracking() {
  return state.trackings.find((item) => item.asin === state.selectedAsin) || null;
}

function persistChatId(nextChatId) {
  const value = String(nextChatId || '').trim() || 'demo';
  state.chatId = value;
  try {
    window.localStorage.setItem('soon.chatId', value);
  } catch {
    // ignore storage limitations in restricted browsers
  }
  const url = new URL(window.location.href);
  url.searchParams.set('chatId', value);
  window.history.replaceState({}, '', url.toString());
}

function renderSettings() {
  const settings = state.settings;
  if (!settings) return;
  const channels = {
    ...DEFAULT_CHANNELS,
    ...(settings.notification_channels && typeof settings.notification_channels === 'object'
      ? settings.notification_channels
      : {}),
  };
  nodes.settingsProductInterval.value = String(settings.productIntervalMin ?? 60);
  nodes.settingsScanInterval.value = String(settings.scanIntervalMin ?? 60);
  nodes.settingsNotifications.checked = Boolean(settings.notificationsEnabled);
  nodes.settingsChannelTelegram.checked = Boolean(channels.telegram);
  nodes.settingsChannelDiscord.checked = Boolean(channels.discord);
  nodes.settingsChannelEmail.checked = Boolean(channels.email);
  nodes.settingsChannelPush.checked = Boolean(channels.push);
  nodes.settingsAlertProfiles.value = JSON.stringify(settings.alert_profiles ?? {}, null, 2);
  nodes.settingsUpdated.textContent = settings.updatedAt
    ? `Ostatnia aktualizacja: ${formatIso(settings.updatedAt)}`
    : 'Ustawienia domyślne';
}

async function loadHealth() {
  const health = await client.health();
  nodes.healthStatus.textContent = String(health.status || 'unknown');
  nodes.healthStorage.textContent = String(health.storage || 'unknown');
}

async function loadTrackings() {
  const dashboard = await client.getDashboard(state.chatId);
  state.trackings = Array.isArray(dashboard.items) ? dashboard.items : [];

  if (!state.selectedAsin && state.trackings.length) {
    state.selectedAsin = state.trackings[0].asin;
  }
  if (state.selectedAsin && !state.trackings.some((item) => item.asin === state.selectedAsin)) {
    state.selectedAsin = state.trackings[0]?.asin ?? null;
  }

  renderTrackingList();
}

async function loadSettings() {
  const [settings, alertProfilesPayload] = await Promise.all([
    client.getSettings(state.chatId),
    client.getAlertProfiles(state.chatId),
  ]);
  state.settings = {
    ...settings,
    alert_profiles:
      alertProfilesPayload?.alert_profiles && typeof alertProfilesPayload.alert_profiles === 'object'
        ? alertProfilesPayload.alert_profiles
        : settings.alert_profiles ?? {},
  };
  renderSettings();
}

async function loadDetail() {
  if (!state.selectedAsin) {
    nodes.detailEmpty.classList.remove('hidden');
    nodes.detailContent.classList.add('hidden');
    return;
  }

  const detail = await client.getProductDetail(state.selectedAsin);
  const selected = getSelectedTracking();

  nodes.detailEmpty.classList.add('hidden');
  nodes.detailContent.classList.remove('hidden');
  nodes.detailTitle.textContent = detail.title || state.selectedAsin;
  nodes.detailTitle.setAttribute('data-autofit', '1');
  nodes.detailTitle.setAttribute('data-fit-min', '14');
  nodes.detailTitle.setAttribute('data-fit-max', '24');
  nodes.detailTitle.setAttribute('data-fit-step', '0.5');
  nodes.detailAsin.textContent = detail.asin || state.selectedAsin;
  nodes.detailRating.textContent = `(${Number(detail.rating || 0).toFixed(1)})`;
  const detailImageUrl = resolveImageUrl(detail, selected);
  if (detailImageUrl) {
    nodes.detailThumbImg.src = detailImageUrl;
    nodes.detailThumbImg.classList.remove('hidden');
    nodes.detailThumbFallback.classList.add('hidden');
  } else {
    nodes.detailThumbImg.removeAttribute('src');
    nodes.detailThumbImg.classList.add('hidden');
    nodes.detailThumbFallback.classList.remove('hidden');
  }
  nodes.detailMainPrice.textContent = eur(minPrice(detail.pricesNew));
  nodes.detailBestBadge.textContent = '↓ Najlepsza cena';
  const bestNew = minPriceEntry(detail.pricesNew);
  if (bestNew?.market && Number.isFinite(bestNew.value)) {
    state.detailMarket = String(bestNew.market).toLowerCase();
    nodes.detailMarketFlag.textContent = marketFlag(bestNew.market.toLowerCase());
    nodes.detailBuyNow.textContent = `Kup teraz — ${eur(bestNew.value)} w Amazon ${bestNew.market}`;
    nodes.detailBuyNow.dataset.url = buildAmazonProductUrl(detail.asin || state.selectedAsin, bestNew.market.toLowerCase());
  } else {
    nodes.detailMarketFlag.textContent = '🇩🇪';
    nodes.detailBuyNow.textContent = 'Kup teraz';
    nodes.detailBuyNow.dataset.url = buildAmazonProductUrl(detail.asin || state.selectedAsin, 'de');
  }
  const dropPct = computeDropPct(detail.summary);
  nodes.detailDropBadge.textContent = Number.isFinite(dropPct) ? `-${dropPct}%` : '—';
  nodes.detailDropBadge.classList.toggle('hidden', !Number.isFinite(dropPct));
  nodes.detailBestBadge.classList.toggle('hidden', !Number.isFinite(minPrice(detail.pricesNew)));

  const snooze = selected?.snooze;
  if (snooze?.active) {
    nodes.detailSnoozeBadge.classList.remove('hidden');
    nodes.detailSnoozeBadge.textContent = `Snooze do ${formatIso(snooze.until)}`;
  } else {
    nodes.detailSnoozeBadge.classList.add('hidden');
    nodes.detailSnoozeBadge.textContent = '';
  }

  renderMapList(nodes.detailNewPrices, detail.pricesNew);
  renderMapList(nodes.detailUsedPrices, detail.pricesUsed);
  renderPlainList(nodes.detailThresholds, [
    ['drop %', String(detail.thresholds?.thresholdDropPct ?? 'n/a')],
    ['rise %', String(detail.thresholds?.thresholdRisePct ?? 'n/a')],
    ['target new', eur(Number(detail.thresholds?.targetPriceNew))],
    ['target used', eur(Number(detail.thresholds?.targetPriceUsed))],
  ]);
  renderPlainList(nodes.detailSummary, [
    ['min', eur(Number(detail.summary?.min))],
    ['avg', eur(Number(detail.summary?.avg))],
    ['max', eur(Number(detail.summary?.max))],
    ['updated', formatIso(detail.updatedAt)],
  ]);

  const historyPoints = Array.isArray(detail.historyPoints) ? detail.historyPoints : [];
  renderHistory(nodes.detailHistory, historyPoints);
  renderChart(historyPoints);
  const mini = computeMiniStats(detail, historyPoints);
  nodes.miniMin.textContent = Number.isFinite(mini.min) ? eur(mini.min) : '—';
  nodes.miniMax.textContent = Number.isFinite(mini.max) ? eur(mini.max) : '—';
  nodes.miniAvg.textContent = Number.isFinite(mini.avg) ? eur(mini.avg) : '—';
  nodes.miniVolatility.textContent = Number.isFinite(mini.volatility) ? `${mini.volatility}%` : '—';
  nodes.miniDaysFromMin.textContent = Number.isFinite(mini.daysFromMin) ? `${mini.daysFromMin} d` : '—';

  setDetailDraftFromDetail(detail);
  nodes.thresholdDropPct.value = Number.isFinite(state.detailDraft?.thresholdDropPct) ? String(state.detailDraft.thresholdDropPct) : '10';
  nodes.thresholdRisePct.value = Number.isFinite(state.detailDraft?.thresholdRisePct) ? String(state.detailDraft.thresholdRisePct) : '10';
  nodes.thresholdTargetNew.value = Number.isFinite(state.detailDraft?.targetPriceNew) ? String(state.detailDraft.targetPriceNew) : '';
  nodes.thresholdTargetUsed.value = Number.isFinite(state.detailDraft?.targetPriceUsed) ? String(state.detailDraft.targetPriceUsed) : '';
  renderDetailAlertStatus();
  syncDetailChoiceRows();
  setDetailTab(state.detailTab);
  queueAutoFit();
}

async function refreshAll() {
  setError('');
  nodes.chatId.textContent = state.chatId;
  try {
    await loadHealth();
    await loadSettings();
    await loadTrackings();
    await loadDetail();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

nodes.reloadTrackings.addEventListener('click', async () => {
  try {
    setError('');
    await loadTrackings();
    await loadDetail();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
});

nodes.reloadDetail.addEventListener('click', async () => {
  try {
    setError('');
    await loadDetail();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
});

nodes.trackingList.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-asin]');
  if (!target || !target.classList.contains('pcard')) return;
  state.selectedAsin = target.dataset.asin;
  state.detailTab = 'overview';
  renderTrackingList();
  try {
    setError('');
    await loadDetail();
    openDetailOverlay();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
});

nodes.detailBack.addEventListener('click', () => {
  closeDetailOverlay();
});

nodes.detailTabs.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button === nodes.detailTabOverview) setDetailTab('overview');
  if (button === nodes.detailTabSettings) setDetailTab('settings');
});

if (nodes.detailRangeRow) {
  nodes.detailRangeRow.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-range]');
    if (!button) return;
    state.detailRange = String(button.dataset.range || state.detailRange);
    syncDetailChoiceRows();
  });
}

if (nodes.detailMarketRow) {
  nodes.detailMarketRow.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-market]');
    if (!button) return;
    state.detailMarket = String(button.dataset.market || state.detailMarket).toLowerCase();
    syncDetailChoiceRows();
  });
}

nodes.detailShare.addEventListener('click', async () => {
  const selected = getSelectedTracking();
  if (!selected?.asin) return;
  const url = new URL(window.location.href);
  url.searchParams.set('asin', selected.asin);
  const shareText = `${selected.title || selected.asin} - ${url.toString()}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: selected.title || selected.asin, text: shareText, url: url.toString() });
      return;
    }
    await navigator.clipboard.writeText(shareText);
    setError('');
  } catch {
    setError(`Skopiuj ręcznie: ${shareText}`);
  }
});

nodes.detailDelete.addEventListener('click', async () => {
  const selected = getSelectedTracking();
  if (!selected?.asin) return;
  const confirmed = window.confirm(`Usunąć tracking ${selected.asin}?`);
  if (!confirmed) return;
  try {
    setError('');
    await client.deleteTracking(state.chatId, selected.asin);
    await loadTrackings();
    if (state.selectedAsin) {
      await loadDetail();
    } else {
      closeDetailOverlay();
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
});

nodes.detailBuyNow.addEventListener('click', () => {
  const url = String(nodes.detailBuyNow.dataset.url || '').trim();
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
});

function syncDetailDraftFromInputs() {
  if (!state.detailDraft) return;
  state.detailDraft.thresholdDropPct = toFiniteOrNull(nodes.thresholdDropPct.value);
  state.detailDraft.thresholdRisePct = toFiniteOrNull(nodes.thresholdRisePct.value);
  state.detailDraft.targetPriceNew = toFiniteOrNull(nodes.thresholdTargetNew.value);
  state.detailDraft.targetPriceUsed = toFiniteOrNull(nodes.thresholdTargetUsed.value);
  renderDetailAlertStatus();
}

nodes.thresholdDropPct.addEventListener('input', syncDetailDraftFromInputs);
nodes.thresholdRisePct.addEventListener('input', syncDetailDraftFromInputs);
nodes.thresholdTargetNew.addEventListener('input', syncDetailDraftFromInputs);
nodes.thresholdTargetUsed.addEventListener('input', syncDetailDraftFromInputs);

nodes.filterQuery.addEventListener('input', () => {
  state.filterQuery = String(nodes.filterQuery.value ?? '');
  renderTrackingList();
});

nodes.searchClear.addEventListener('click', () => {
  state.filterQuery = '';
  nodes.filterQuery.value = '';
  renderTrackingList();
});

nodes.filterSnoozeChips.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-filter-snooze]');
  if (!target) return;
  state.filterSnooze = String(target.dataset.filterSnooze || 'all');
  renderTrackingList();
});

nodes.sortChips.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-sort-by]');
  if (!target) return;
  state.sortBy = String(target.dataset.sortBy || 'updated_desc');
  renderTrackingList();
});

nodes.thresholdForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedAsin) return;
  try {
    setError('');
    const dropPct = Number(nodes.thresholdDropPct.value);
    const risePct = Number(nodes.thresholdRisePct.value);
    const targetNew = Number(nodes.thresholdTargetNew.value);
    const targetUsed = Number(nodes.thresholdTargetUsed.value);

    if (!Number.isFinite(dropPct) || dropPct < 1 || dropPct > 95) {
      throw new Error('Drop % musi być w zakresie 1-95');
    }
    if (!Number.isFinite(risePct) || risePct < 1 || risePct > 95) {
      throw new Error('Rise % musi być w zakresie 1-95');
    }
    if (String(nodes.thresholdTargetNew.value).trim() && (!Number.isFinite(targetNew) || targetNew < 0)) {
      throw new Error('Target new musi być liczbą >= 0');
    }
    if (String(nodes.thresholdTargetUsed.value).trim() && (!Number.isFinite(targetUsed) || targetUsed < 0)) {
      throw new Error('Target used musi być liczbą >= 0');
    }

    await client.updateThresholds(state.selectedAsin, {
      thresholdDropPct: Math.round(dropPct),
      thresholdRisePct: Math.round(risePct),
      targetPriceNew: Number.isFinite(targetNew) ? targetNew : null,
      targetPriceUsed: Number.isFinite(targetUsed) ? targetUsed : null,
    });

    state.detailDraft = {
      thresholdDropPct: Math.round(dropPct),
      thresholdRisePct: Math.round(risePct),
      targetPriceNew: Number.isFinite(targetNew) ? targetNew : null,
      targetPriceUsed: Number.isFinite(targetUsed) ? targetUsed : null,
    };
    renderDetailAlertStatus();
    await loadTrackings();
    await loadDetail();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
});

nodes.actionRefresh.addEventListener('click', async () => {
  if (!state.selectedAsin) return;
  try {
    setError('');
    await client.refreshTracking(state.selectedAsin);
    await loadTrackings();
    await loadDetail();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
});

nodes.actionSnooze.addEventListener('click', async () => {
  if (!state.selectedAsin) return;
  try {
    setError('');
    await client.snoozeTracking(state.chatId, state.selectedAsin, 60);
    await loadTrackings();
    await loadDetail();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
});

nodes.actionUnsnooze.addEventListener('click', async () => {
  if (!state.selectedAsin) return;
  try {
    setError('');
    await client.unsnoozeTracking(state.chatId, state.selectedAsin);
    await loadTrackings();
    await loadDetail();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
});

nodes.detailSnoozeQuick.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-snooze-minutes]');
  if (!button || !state.selectedAsin) return;
  try {
    setError('');
    const minutes = Number(button.dataset.snoozeMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    await client.snoozeTracking(state.chatId, state.selectedAsin, minutes);
    await loadTrackings();
    await loadDetail();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
});

nodes.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setError('');
    const productIntervalMin = Number(nodes.settingsProductInterval.value);
    const scanIntervalMin = Number(nodes.settingsScanInterval.value);
    if (!Number.isFinite(productIntervalMin) || productIntervalMin < 1 || productIntervalMin > 1440) {
      throw new Error('Product interval musi być w zakresie 1-1440');
    }
    if (!Number.isFinite(scanIntervalMin) || scanIntervalMin < 1 || scanIntervalMin > 1440) {
      throw new Error('Scan interval musi być w zakresie 1-1440');
    }
    const notificationChannels = {
      telegram: Boolean(nodes.settingsChannelTelegram.checked),
      discord: Boolean(nodes.settingsChannelDiscord.checked),
      email: Boolean(nodes.settingsChannelEmail.checked),
      push: Boolean(nodes.settingsChannelPush.checked),
    };
    let alertProfiles = {};
    try {
      alertProfiles = JSON.parse(String(nodes.settingsAlertProfiles.value || '{}'));
    } catch {
      throw new Error('Alert profiles musi być poprawnym JSON');
    }
    if (typeof alertProfiles !== 'object' || alertProfiles === null || Array.isArray(alertProfiles)) {
      throw new Error('Alert profiles musi być obiektem JSON');
    }

    await client.setProductInterval(state.chatId, Math.round(productIntervalMin));
    await client.setScanInterval(state.chatId, Math.round(scanIntervalMin));
    await client.setNotifications(state.chatId, nodes.settingsNotifications.checked);
    await client.setNotificationChannels(state.chatId, notificationChannels);
    await client.setAlertProfiles(state.chatId, alertProfiles);
    await loadSettings();
    await loadTrackings();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
});

nodes.copyMobileUrl.addEventListener('click', async () => {
  const url = new URL(window.location.href);
  url.searchParams.set('chatId', state.chatId);
  const text = url.toString();
  try {
    await navigator.clipboard.writeText(text);
    setError('');
  } catch {
    setError(`Skopiuj ręcznie URL: ${text}`);
  }
});

nodes.bottomNav.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-view-target]');
  if (!target) return;
  setActiveView(String(target.dataset.viewTarget || 'trackings'));
});

window.addEventListener('resize', queueAutoFit);

state.lang = detectLanguage();
configureStaticAutoFitTargets();
applyI18n(state.lang);
persistChatId(initialChatId);
setActiveView(state.activeView);
setDetailTab(state.detailTab);
refreshAll();
