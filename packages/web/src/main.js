import { createApiClient } from "./api-client.mjs";
const client = createApiClient(window.location.origin);
const MARKET_ORDER = ["de", "it", "fr", "es", "uk", "nl", "pl"];
const DETAIL_MARKETS = ["de", "it", "fr", "es", "uk", "nl"];
const TRACKING_CARD_MARKETS = ["de", "it", "fr", "es", "uk", "nl"];
const I18N = {
  pl: {
    nav: {
      tracking: "\u015Aledzone",
      deals: "Okazje",
      add: "Dodaj",
      alerts: "Alerty",
      settings: "Ustawienia"
    },
    searchPlaceholder: "Szukaj po tytule lub ASIN",
    details: "Szczeg\xF3\u0142y produktu",
    bestPrice: "Najlepsza cena",
    buyNow: "Kup teraz",
    buyNowAt: "w Amazon",
    noData: "Brak danych",
    active: "Aktywnie \u015Bledzony",
    paused: "\u015Aledzenie wy\u0142\u0105czone",
    updated: "Aktualizacja",
    overview: "Przegl\u0105d",
    settingsTab: "Ustawienia",
    chartHistory: "Historia (new)",
    summaryCurrent: "Obecna",
    summaryAvg: "\u015Ar. (90d)",
    summaryLow: "Najni\u017Csza",
    summaryHigh: "Najwy\u017Csza",
    summaryDrop30: "Zmiana 30d",
    summaryAsin: "ASIN",
    summaryUpdated: "Aktualizacja",
    summaryUsedMin: "Used min",
    newPrices: "CENY NOWE",
    usedPrices: "CENY U\u017BYWANE",
    refreshAsin: "Refresh ASIN",
    snooze60: "Snooze 60 min",
    unsnooze: "Unsnooze",
    setChatId: "Ustaw Chat ID",
    dealsTitle: "Okazje",
    dealsDesc: "Zak\u0142adka w przygotowaniu.",
    addTitle: "Dodaj",
    addDesc: "Dodawanie produktu uruchomimy w kolejnym etapie.",
    alertsTitle: "Alerty",
    alertsDesc: "Panel alert\xF3w b\u0119dzie rozwijany po sekcji \u015Aledzone."
  },
  en: {
    nav: {
      tracking: "Tracked",
      deals: "Deals",
      add: "Add",
      alerts: "Alerts",
      settings: "Settings"
    },
    searchPlaceholder: "Search by title or ASIN",
    details: "Product details",
    bestPrice: "Best price",
    buyNow: "Buy now",
    buyNowAt: "at Amazon",
    noData: "No data",
    active: "Actively tracked",
    paused: "Tracking paused",
    updated: "Updated",
    overview: "Overview",
    settingsTab: "Settings",
    chartHistory: "History (new)",
    summaryCurrent: "Current",
    summaryAvg: "Avg (90d)",
    summaryLow: "Lowest",
    summaryHigh: "Highest",
    summaryDrop30: "Change 30d",
    summaryAsin: "ASIN",
    summaryUpdated: "Updated",
    summaryUsedMin: "Used min",
    newPrices: "NEW PRICES",
    usedPrices: "USED PRICES",
    refreshAsin: "Refresh ASIN",
    snooze60: "Snooze 60 min",
    unsnooze: "Unsnooze",
    setChatId: "Set Chat ID",
    dealsTitle: "Deals",
    dealsDesc: "This tab is in progress.",
    addTitle: "Add",
    addDesc: "Product add flow will be released in next stage.",
    alertsTitle: "Alerts",
    alertsDesc: "Alerts panel will be expanded after Tracked."
  },
  de: {
    nav: {
      tracking: "Getrackt",
      deals: "Deals",
      add: "Hinzuf\xFCgen",
      alerts: "Alarme",
      settings: "Einstellungen"
    },
    searchPlaceholder: "Suche nach Titel oder ASIN",
    details: "Produktdetails",
    bestPrice: "Bester Preis",
    buyNow: "Jetzt kaufen",
    buyNowAt: "bei Amazon",
    noData: "Keine Daten",
    active: "Aktiv getrackt",
    paused: "Tracking pausiert",
    updated: "Aktualisiert",
    overview: "\xDCberblick",
    settingsTab: "Einstellungen",
    chartHistory: "Historie (neu)",
    summaryCurrent: "Aktuell",
    summaryAvg: "\xD8 (90d)",
    summaryLow: "Tiefstwert",
    summaryHigh: "H\xF6chstwert",
    summaryDrop30: "\xC4nderung 30d",
    summaryAsin: "ASIN",
    summaryUpdated: "Aktualisiert",
    summaryUsedMin: "Used min",
    newPrices: "NEU PREISE",
    usedPrices: "GEBRAUCHT PREISE",
    refreshAsin: "ASIN refresh",
    snooze60: "Snooze 60 min",
    unsnooze: "Unsnooze",
    setChatId: "Chat ID speichern",
    dealsTitle: "Deals",
    dealsDesc: "Dieser Tab ist in Arbeit.",
    addTitle: "Hinzuf\xFCgen",
    addDesc: "Produkt-Add-Flow folgt im n\xE4chsten Schritt.",
    alertsTitle: "Alarme",
    alertsDesc: "Alarm-Bereich wird nach Getrackt erweitert."
  }
};
const state = {
  activeView: "tracking",
  detailTab: "overview",
  selectedAsin: null,
  chatId: readChatId(),
  lang: readLang(),
  query: "",
  trackings: [],
  trackingStatusFilter: "active",
  detailByAsin: {},
  detailChartRangeDays: 90,
  detailChartMarketsByAsin: {}
};
const nodes = {
  views: {
    tracking: document.querySelector("#v-tracking"),
    deals: document.querySelector("#v-deals"),
    add: document.querySelector("#v-add"),
    notifications: document.querySelector("#v-notifications"),
    settings: document.querySelector("#v-settings")
  },
  navItems: document.querySelectorAll(".bnav-item[data-v]"),
  productsList: document.querySelector("#productsList"),
  searchInput: document.querySelector("#searchInput"),
  searchClear: document.querySelector("#searchClear"),
  topRefreshBtn: document.querySelector("#topRefreshBtn"),
  topCopyBtn: document.querySelector("#topCopyBtn"),
  trackingStatusFilters: document.querySelector("#trackingStatusFilters"),
  detailView: document.querySelector("#detailView"),
  detailContent: document.querySelector("#detailContent"),
  detailBack: document.querySelector("#detailBack"),
  detailShare: document.querySelector("#detailShare"),
  detailDelete: document.querySelector("#detailDelete"),
  detailTopbarTitle: document.querySelector("#d-bartitle") || document.querySelector("#detailTopbarTitle"),
  chatIdInput: document.querySelector("#chatIdInput"),
  chatIdSave: document.querySelector("#chatIdSave"),
  langRow: document.querySelector("#langRow"),
  navLabels: {
    tracking: document.querySelector("#nav-trackings"),
    deals: document.querySelector("#nav-deals"),
    add: document.querySelector("#nav-add"),
    alerts: document.querySelector("#nav-alerts"),
    settings: document.querySelector("#nav-settings")
  }
};
function readChatId() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("chatId") || params.get("userId") || params.get("x-telegram-user-id") || "";
  const fromStorage = (() => {
    try {
      return window.localStorage.getItem("soon.chatId") || "";
    } catch {
      return "";
    }
  })();
  return String(fromQuery || fromStorage || "demo").trim() || "demo";
}
function readLang() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = String(params.get("lang") || "").trim().toLowerCase();
  if (fromQuery === "pl" || fromQuery === "en" || fromQuery === "de") return fromQuery;
  const fromStorage = (() => {
    try {
      return String(window.localStorage.getItem("soon.lang") || "").trim().toLowerCase();
    } catch {
      return "";
    }
  })();
  if (fromStorage === "pl" || fromStorage === "en" || fromStorage === "de") return fromStorage;
  return "pl";
}
function setQueryParam(key, value) {
  const url = new URL(window.location.href);
  url.searchParams.set(key, value);
  window.history.replaceState({}, "", url.toString());
}
function t() {
  return I18N[state.lang];
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function marketFlag(domainRaw) {
  const domain = String(domainRaw || "").toLowerCase();
  const flags = {
    de: "\u{1F1E9}\u{1F1EA}",
    it: "\u{1F1EE}\u{1F1F9}",
    fr: "\u{1F1EB}\u{1F1F7}",
    es: "\u{1F1EA}\u{1F1F8}",
    uk: "\u{1F1EC}\u{1F1E7}",
    nl: "\u{1F1F3}\u{1F1F1}",
    pl: "\u{1F1F5}\u{1F1F1}"
  };
  return flags[domain] || "\u2022";
}
function currencyForDomain(domainRaw) {
  return String(domainRaw || "").toLowerCase() === "uk" ? "\xA3" : "\u20AC";
}
function formatPrice(value, domainRaw) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "\u2014";
  return `${currencyForDomain(domainRaw)}${num.toFixed(2)}`;
}
function formatDateTime(value) {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return "\u2014";
  return new Intl.DateTimeFormat(state.lang, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(ts));
}
function sortedMarkets(rows = []) {
  return [...rows].sort((a, b) => {
    const aIdx = MARKET_ORDER.indexOf(String(a.market || "").toLowerCase());
    const bIdx = MARKET_ORDER.indexOf(String(b.market || "").toLowerCase());
    const ai = aIdx === -1 ? 999 : aIdx;
    const bi = bIdx === -1 ? 999 : bIdx;
    return ai - bi;
  });
}
function normalizedRows(item) {
  const cpRows = Array.isArray(item.cardPreview?.marketRows) ? item.cardPreview?.marketRows || [] : [];
  if (cpRows.length) return sortedMarkets(cpRows);
  const map = /* @__PURE__ */ new Map();
  for (const [market, value] of Object.entries(item.pricesNew || {})) {
    const key = String(market || "").toLowerCase();
    map.set(key, {
      market: key,
      newPrice: Number.isFinite(Number(value)) ? Number(value) : null,
      usedPrice: null,
      trendPct: null
    });
  }
  for (const [market, value] of Object.entries(item.pricesUsed || {})) {
    const key = String(market || "").toLowerCase();
    const entry = map.get(key) || {
      market: key,
      newPrice: null,
      usedPrice: null,
      trendPct: null
    };
    entry.usedPrice = Number.isFinite(Number(value)) ? Number(value) : null;
    map.set(key, entry);
  }
  return sortedMarkets(Array.from(map.values()));
}
function bestNewPrice(item) {
  const rows = normalizedRows(item).map((row) => Number(row.newPrice)).filter((price) => Number.isFinite(price) && price > 0);
  if (!rows.length) return null;
  return Math.min(...rows);
}
function bestUsedPrice(item) {
  const rows = normalizedRows(item).map((row) => Number(row.usedPrice)).filter((price) => Number.isFinite(price) && price > 0);
  if (!rows.length) return null;
  return Math.min(...rows);
}
function getBestDomain(item) {
  const fromPreview = String(item.cardPreview?.bestDomain || "").toLowerCase();
  if (fromPreview) return fromPreview;
  const rows = normalizedRows(item).filter((row) => Number.isFinite(Number(row.newPrice)) && Number(row.newPrice) > 0).sort((a, b) => Number(a.newPrice || 0) - Number(b.newPrice || 0));
  if (rows.length) return String(rows[0].market || "de").toLowerCase();
  return "de";
}
function avgNewPrice(item) {
  const direct = Number(item.cardPreview?.avgPriceNew);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const values = normalizedRows(item).map((row) => Number(row.newPrice)).filter((price) => Number.isFinite(price) && price > 0);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function isSnoozed(item) {
  const active = Boolean(item?.snooze?.active);
  const untilTs = Date.parse(String(item?.snooze?.until || ""));
  if (active) return true;
  return Number.isFinite(untilTs) && untilTs > Date.now();
}
function getSparkline(item) {
  const points = Array.isArray(item?.cardPreview?.sparkline) ? item.cardPreview?.sparkline || [] : [];
  return points.slice(-60);
}
function marketStrokeColor(marketRaw) {
  const market = String(marketRaw || "").toLowerCase();
  const palette = {
    de: "#ff7a00",
    it: "#47c95f",
    fr: "#57a7ff",
    es: "#ff5a55",
    uk: "#f3c613",
    nl: "#79b4ff",
    pl: "#5bd3f2"
  };
  return palette[market] || "#ff7a00";
}
const DETAIL_CHART_ORDER = ["de", "it", "fr", "nl", "es", "uk"];
let detailChartInstance = null;
function buildDetailChartRows(item, detail) {
  const rowsByKey = /* @__PURE__ */ new Map();
  const raw = Array.isArray(detail?.historySeries) ? detail?.historySeries || [] : [];
  for (const point of raw) {
    const domain = String(point?.market || "").toLowerCase();
    const condition = String(point?.condition || "new").toLowerCase();
    const recordedAt = String(point?.ts || "");
    const ts = Date.parse(recordedAt);
    const value = Number(point?.value);
    if (!domain || !Number.isFinite(ts) || !Number.isFinite(value) || value <= 0) continue;
    const key = `${domain}|${new Date(ts).toISOString()}`;
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        domain,
        recorded_at: new Date(ts).toISOString(),
        price: null,
        price_used: null
      });
    }
    const row = rowsByKey.get(key);
    if (condition === "used") row.price_used = value;
    else row.price = value;
  }
  if (!rowsByKey.size) {
    const fallbackDomain = getBestDomain(item);
    for (const point of getSparkline(item)) {
      const ts = Date.parse(String(point.ts || ""));
      const value = Number(point.value);
      if (!Number.isFinite(ts) || !Number.isFinite(value) || value <= 0) continue;
      const key = `${fallbackDomain}|${new Date(ts).toISOString()}`;
      rowsByKey.set(key, {
        domain: fallbackDomain,
        recorded_at: new Date(ts).toISOString(),
        price: value,
        price_used: null
      });
    }
  }
  const existingRows = [...rowsByKey.values()];
  const pricesByMarket = new Map(
    normalizedRows(item).map((row) => [String(row.market || "").toLowerCase(), Number(row.newPrice)]).filter(([, price]) => Number.isFinite(price) && price > 0)
  );
  const existingMarkets = new Set(existingRows.map((row) => String(row.domain || "").toLowerCase()));
  const referenceMarket = DETAIL_CHART_ORDER.find((market) => existingMarkets.has(market)) || [...existingMarkets][0] || "";
  const referenceSeries = existingRows.filter((row) => String(row.domain || "").toLowerCase() === referenceMarket).sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  const referenceLast = referenceSeries.length ? Number(referenceSeries[referenceSeries.length - 1].price) : null;
  const referencePrice = pricesByMarket.get(referenceMarket) ?? null;
  const safeReference = Number.isFinite(referenceLast) && Number(referenceLast) > 0 ? Number(referenceLast) : Number.isFinite(referencePrice) && Number(referencePrice) > 0 ? Number(referencePrice) : null;
  if (referenceSeries.length >= 2 && Number.isFinite(safeReference)) {
    for (const market of DETAIL_CHART_ORDER) {
      if (existingMarkets.has(market)) continue;
      const marketPrice = pricesByMarket.get(market);
      if (!Number.isFinite(marketPrice) || Number(marketPrice) <= 0) continue;
      const ratio = Number(marketPrice) / Number(safeReference);
      for (const baseRow of referenceSeries) {
        const key = `${market}|${baseRow.recorded_at}`;
        rowsByKey.set(key, {
          domain: market,
          recorded_at: baseRow.recorded_at,
          price: Number((Number(baseRow.price || 0) * ratio).toFixed(2)),
          price_used: null
        });
      }
    }
  }
  return [...rowsByKey.values()].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
}
function applyDetailChartFilters(rows, selectedMarkets, rangeDays) {
  const selected = new Set(selectedMarkets.map((m) => String(m || "").toLowerCase()));
  let output = rows.filter((row) => selected.has(String(row.domain || "").toLowerCase()));
  if (rangeDays > 0 && output.length) {
    const newestTs = Math.max(...output.map((row) => Date.parse(row.recorded_at)).filter(Number.isFinite));
    const cut = newestTs - rangeDays * 864e5;
    output = output.filter((row) => Date.parse(row.recorded_at) >= cut);
  }
  return output;
}
function getChartThemeColors() {
  const tick = getComputedStyle(document.documentElement).getPropertyValue("--t1").trim() || "#fff";
  const isLight = document.documentElement.classList.contains("light-theme");
  const grid = isLight ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.12)";
  const crosshair = isLight ? "rgba(0,0,0,.25)" : "rgba(255,255,255,.3)";
  return { tick, grid, crosshair };
}
function buildDetailChartDatasets(rows) {
  const datasets = [];
  const usedLabel = state.lang === "en" ? "Used" : state.lang === "de" ? "Gebraucht" : "U\u017Cywane";
  for (const domain of DETAIL_CHART_ORDER) {
    const domainRows = rows.filter((row) => row.domain === domain);
    if (!domainRows.length) continue;
    const newPts = domainRows.filter((row) => Number.isFinite(Number(row.price)) && Number(row.price) > 0).map((row) => ({ x: Date.parse(row.recorded_at), y: Number(row.price) }));
    if (newPts.length) {
      datasets.push({
        label: `${domain.toUpperCase()} New`,
        data: newPts,
        borderColor: marketStrokeColor(domain),
        backgroundColor: marketStrokeColor(domain),
        borderWidth: 1.35,
        pointRadius: 1.1,
        pointHoverRadius: 3.6,
        stepped: true,
        tension: 0,
        fill: false
      });
    }
    const usedPts = domainRows.filter((row) => Number.isFinite(Number(row.price_used)) && Number(row.price_used) > 0).map((row) => ({ x: Date.parse(row.recorded_at), y: Number(row.price_used) }));
    if (usedPts.length) {
      datasets.push({
        label: `${domain.toUpperCase()} ${usedLabel}`,
        data: usedPts,
        borderColor: marketStrokeColor(domain),
        backgroundColor: "transparent",
        borderWidth: 1.1,
        borderDash: [6, 3],
        pointRadius: 1.1,
        pointHoverRadius: 3.6,
        stepped: true,
        tension: 0,
        fill: false
      });
    }
  }
  return datasets;
}
function computeDetailChartStats(rows) {
  const points = rows.map((row) => {
    const ts = Date.parse(row.recorded_at);
    const y = Number(row.price);
    return { ts, y, domain: String(row.domain || "").toLowerCase() };
  }).filter((point) => Number.isFinite(point.ts) && Number.isFinite(point.y) && point.y > 0).sort((a, b) => a.ts - b.ts);
  if (!points.length) return null;
  const prices = points.map((point) => point.y);
  const avg = prices.reduce((acc, value) => acc + value, 0) / prices.length;
  const variance = prices.reduce((acc, value) => acc + (value - avg) ** 2, 0) / prices.length;
  const stdDev = Math.sqrt(Math.max(variance, 0));
  const minPoint = points.reduce((best, point) => point.y < best.y ? point : best, points[0]);
  const maxPoint = points.reduce((best, point) => point.y > best.y ? point : best, points[0]);
  const latestPoint = points.reduce((best, point) => point.ts > best.ts ? point : best, points[0]);
  return {
    minPrice: minPoint.y,
    maxPrice: maxPoint.y,
    avgPrice: avg,
    volatilityPct: avg > 0 ? stdDev / avg * 100 : 0,
    minPoint,
    maxPoint,
    latestPoint,
    daysSinceLow: Math.max(0, Math.round((latestPoint.ts - minPoint.ts) / 864e5))
  };
}
function destroyDetailChart() {
  if (detailChartInstance && typeof detailChartInstance.destroy === "function") {
    detailChartInstance.destroy();
  }
  detailChartInstance = null;
}
function renderDetailChartCanvas(filteredRows) {
  const canvas = document.getElementById("mainChart");
  if (!canvas || typeof Chart === "undefined") return;
  destroyDetailChart();
  const datasets = buildDetailChartDatasets(filteredRows);
  const colors = getChartThemeColors();
  detailChartInstance = new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          align: "start",
          labels: {
            color: colors.tick,
            font: { size: 11, weight: "700" },
            usePointStyle: true,
            pointStyleWidth: 12,
            padding: 8,
            boxWidth: 12,
            boxHeight: 12
          }
        },
        tooltip: {
          backgroundColor: "rgba(0,0,0,.9)",
          titleColor: "#fff",
          bodyColor: "#fff",
          borderColor: "#30363d",
          borderWidth: 1,
          padding: 8,
          titleFont: { size: 11, weight: "700" },
          bodyFont: { size: 10, weight: "600" },
          displayColors: true
        }
      },
      scales: {
        x: {
          type: "linear",
          grid: { color: colors.grid },
          ticks: {
            color: colors.tick,
            maxTicksLimit: 7,
            font: { size: 11 },
            callback: (value) => {
              const ts = Number(value);
              if (!Number.isFinite(ts)) return "";
              return formatChartLabelDate(new Date(ts).toISOString());
            }
          }
        },
        y: {
          beginAtZero: false,
          grid: { color: colors.grid },
          ticks: {
            color: colors.tick,
            font: { size: 11 },
            callback: (value) => {
              const num = Number(value);
              if (!Number.isFinite(num)) return "";
              return new Intl.NumberFormat(state.lang === "de" ? "de-DE" : state.lang === "en" ? "en-US" : "pl-PL", {
                maximumFractionDigits: 0
              }).format(num);
            }
          }
        }
      }
    }
  });
}
function normalizeDetailHistorySeries(item, detail) {
  const fromDetail = Array.isArray(detail?.historySeries) ? detail?.historySeries || [] : [];
  const byMarket = /* @__PURE__ */ new Map();
  for (const row of fromDetail) {
    const market = String(row?.market || "").toLowerCase();
    const condition = String(row?.condition || "new").toLowerCase();
    if (!market || condition !== "new") continue;
    const value = Number(row?.value);
    const ts = String(row?.ts || "");
    const tsMs = Date.parse(ts);
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(tsMs)) continue;
    if (!byMarket.has(market)) byMarket.set(market, []);
    byMarket.get(market)?.push({ ts, tsMs, value });
  }
  if (!byMarket.size) {
    const fallbackMarket = getBestDomain(item);
    const fallback = getSparkline(item).map((point) => {
      const value = Number(point.value);
      const ts = String(point.ts || "");
      const tsMs = Date.parse(ts);
      if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(tsMs)) return null;
      return { ts, tsMs, value };
    }).filter(Boolean);
    if (fallback.length) byMarket.set(fallbackMarket, fallback);
  }
  for (const [market, points] of byMarket) {
    points.sort((a, b) => a.tsMs - b.tsMs);
    const deduped = [];
    for (const point of points) {
      const previous = deduped[deduped.length - 1];
      if (previous && previous.tsMs === point.tsMs) {
        deduped[deduped.length - 1] = point;
      } else {
        deduped.push(point);
      }
    }
    byMarket.set(market, deduped);
  }
  const pricedMarkets = normalizedRows(item).map((row) => ({
    market: String(row.market || "").toLowerCase(),
    price: Number(row.newPrice)
  })).filter((row) => row.market && Number.isFinite(row.price) && row.price > 0);
  const referenceMarket = pricedMarkets.find((row) => byMarket.has(row.market))?.market || byMarket.keys().next().value || "";
  const referenceSeries = referenceMarket ? byMarket.get(referenceMarket) || [] : [];
  const referenceLast = referenceSeries.length ? Number(referenceSeries[referenceSeries.length - 1].value) : null;
  const referencePrice = pricedMarkets.find((row) => row.market === referenceMarket)?.price ?? null;
  const safeRef = Number.isFinite(referenceLast) && Number(referenceLast) > 0 ? Number(referenceLast) : Number.isFinite(referencePrice) && Number(referencePrice) > 0 ? Number(referencePrice) : null;
  if (referenceSeries.length >= 2 && Number.isFinite(safeRef)) {
    for (const row of pricedMarkets) {
      if (byMarket.has(row.market)) continue;
      const ratio = Number(row.price) / Number(safeRef);
      const synthetic = referenceSeries.map((point) => ({
        ts: point.ts,
        tsMs: point.tsMs,
        value: Number((point.value * ratio).toFixed(2))
      }));
      byMarket.set(row.market, synthetic);
    }
  }
  return byMarket;
}
function getDetailChartMarkets(asinRaw, availableMarkets, bestDomainRaw) {
  const asin = String(asinRaw || "").toUpperCase();
  const bestDomain = String(bestDomainRaw || "").toLowerCase();
  const saved = Array.isArray(state.detailChartMarketsByAsin[asin]) ? state.detailChartMarketsByAsin[asin] : [];
  const savedFiltered = saved.filter((market) => availableMarkets.includes(market));
  if (savedFiltered.length) return savedFiltered;
  if (availableMarkets.length) return availableMarkets;
  return bestDomain ? [bestDomain] : ["de"];
}
function detailChartSvg(seriesByMarket, selectedMarkets, rangeDays, bestDomainRaw) {
  const selected = selectedMarkets.filter((market) => seriesByMarket.has(market));
  if (!selected.length) {
    return {
      svg: '<svg viewBox="0 0 320 180" preserveAspectRatio="none"><rect x="0.5" y="0.5" width="319" height="179" fill="#07090d" stroke="rgba(255,255,255,.18)"/></svg>',
      stats: { min: null, max: null, avg: null, vol: null, sinceMinDays: null },
      activeMarkets: selected,
      xTicks: []
    };
  }
  const sourcePoints = selected.flatMap((market) => seriesByMarket.get(market) || []);
  const newestTs = sourcePoints.length ? Math.max(...sourcePoints.map((point) => point.tsMs)) : Date.now();
  const minAllowedTs = rangeDays > 0 ? newestTs - rangeDays * 24 * 60 * 60 * 1e3 : Number.NEGATIVE_INFINITY;
  const filtered = selected.map((market) => {
    const points = (seriesByMarket.get(market) || []).filter((point) => point.tsMs >= minAllowedTs);
    return [market, points];
  }).filter(([, points]) => points.length >= 2);
  if (!filtered.length) {
    return {
      svg: '<svg viewBox="0 0 320 180" preserveAspectRatio="none"><rect x="0.5" y="0.5" width="319" height="179" fill="#07090d" stroke="rgba(255,255,255,.18)"/></svg>',
      stats: { min: null, max: null, avg: null, vol: null, sinceMinDays: null },
      activeMarkets: selected,
      xTicks: []
    };
  }
  const allPoints = filtered.flatMap(([, points]) => points);
  const values = allPoints.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spanValue = Math.max(maxValue - minValue, 1);
  const minTs = Math.min(...allPoints.map((point) => point.tsMs));
  const maxTs = Math.max(...allPoints.map((point) => point.tsMs));
  const spanTs = Math.max(maxTs - minTs, 1);
  const w = 320;
  const h = 180;
  const left = 38;
  const right = 308;
  const top = 10;
  const bottom = 136;
  const plotW = right - left;
  const plotH = bottom - top;
  const toX = (tsMs) => left + (tsMs - minTs) / spanTs * plotW;
  const toY = (value) => bottom - (value - minValue) / spanValue * plotH;
  const seriesPaths = filtered.map(([market, points]) => {
    const xy = points.map((point) => ({ x: toX(point.tsMs), y: toY(point.value), ts: point.ts, value: point.value }));
    if (xy.length < 2) return "";
    const pathParts = [`M${xy[0].x.toFixed(2)} ${xy[0].y.toFixed(2)}`];
    for (let index = 1; index < xy.length; index += 1) {
      pathParts.push(`H${xy[index].x.toFixed(2)}`);
      pathParts.push(`V${xy[index].y.toFixed(2)}`);
    }
    const line = pathParts.join(" ");
    const last = xy[xy.length - 1];
    return `<path d="${line}" fill="none" stroke="${marketStrokeColor(market)}" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="2.2" fill="${marketStrokeColor(market)}"/>`;
  }).join("");
  const bestDomain = String(bestDomainRaw || "").toLowerCase();
  const statMarket = selected.includes(bestDomain) ? bestDomain : selected[0];
  const statPoints = filtered.find(([market]) => market === statMarket)?.[1] || filtered[0]?.[1] || [];
  const statValues = statPoints.map((point) => point.value);
  const statMin = statValues.length ? Math.min(...statValues) : null;
  const statMax = statValues.length ? Math.max(...statValues) : null;
  const statAvg = statValues.length ? statValues.reduce((sum, value) => sum + value, 0) / statValues.length : null;
  const statVol = Number.isFinite(Number(statMin)) && Number.isFinite(Number(statMax)) && Number.isFinite(Number(statAvg)) && Number(statAvg) > 0 ? Math.round((Number(statMax) - Number(statMin)) / Number(statAvg) * 100) : null;
  const minTimestamp = statPoints.filter((point) => Number.isFinite(Number(statMin)) && point.value === Number(statMin)).map((point) => point.tsMs).at(-1);
  const sinceMinDays = Number.isFinite(minTimestamp) ? Math.max(0, Math.floor((newestTs - Number(minTimestamp)) / (24 * 60 * 60 * 1e3))) : null;
  const avgY = Number.isFinite(Number(statAvg)) ? toY(Number(statAvg)) : bottom;
  const yTop = formatChartAxisPrice(maxValue, statMarket || bestDomain);
  const yMid = formatChartAxisPrice((maxValue + minValue) / 2, statMarket || bestDomain);
  const yLow = formatChartAxisPrice(minValue, statMarket || bestDomain);
  const xTickA = formatChartLabelDate(new Date(minTs).toISOString());
  const xTickB = formatChartLabelDate(new Date(minTs + spanTs * 0.5).toISOString());
  const xTickC = formatChartLabelDate(new Date(maxTs).toISOString());
  const gid = chartToken(
    allPoints.map((point) => ({ ts: point.ts, value: point.value })),
    "detail-multi-chart"
  );
  const gridYs = [top, top + plotH * 0.25, top + plotH * 0.5, top + plotH * 0.75, bottom];
  const gridXs = [left, left + plotW * 0.25, left + plotW * 0.5, left + plotW * 0.75, right];
  const svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="${gid}-bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(16,20,29,.98)"/>
        <stop offset="62%" stop-color="rgba(9,13,20,.94)"/>
        <stop offset="100%" stop-color="rgba(5,8,13,.99)"/>
      </linearGradient>
    </defs>
    <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="url(#${gid}-bg)" stroke="rgba(255,255,255,.2)"/>
    ${gridYs.map((y) => `<line x1="${left}" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}" stroke="rgba(255,255,255,.16)" stroke-width="1"/>`).join("")}
    ${gridXs.map((x) => `<line x1="${x.toFixed(2)}" y1="${top}" x2="${x.toFixed(2)}" y2="${bottom}" stroke="rgba(255,255,255,.11)" stroke-width="1"/>`).join("")}
    <line x1="${left}" y1="${avgY.toFixed(2)}" x2="${right}" y2="${avgY.toFixed(2)}" stroke="rgba(255,166,87,.58)" stroke-width="1.2" stroke-dasharray="4 4"/>
    ${seriesPaths}
    <text x="5" y="${(top + 4).toFixed(2)}" fill="rgba(242,246,250,.9)" font-size="9.2" font-family="Roboto, sans-serif">${escapeHtml(yTop)}</text>
    <text x="5" y="${(top + plotH * 0.5 + 4).toFixed(2)}" fill="rgba(242,246,250,.86)" font-size="9.2" font-family="Roboto, sans-serif">${escapeHtml(yMid)}</text>
    <text x="5" y="${(bottom + 4).toFixed(2)}" fill="rgba(242,246,250,.86)" font-size="9.2" font-family="Roboto, sans-serif">${escapeHtml(yLow)}</text>
    <text x="${left}" y="${h - 10}" fill="rgba(242,246,250,.86)" font-size="10" font-family="Roboto, sans-serif">${escapeHtml(xTickA)}</text>
    <text x="${(left + plotW * 0.5).toFixed(2)}" y="${h - 10}" fill="rgba(242,246,250,.86)" font-size="10" text-anchor="middle" font-family="Roboto, sans-serif">${escapeHtml(xTickB)}</text>
    <text x="${right}" y="${h - 10}" fill="rgba(242,246,250,.86)" font-size="10" text-anchor="end" font-family="Roboto, sans-serif">${escapeHtml(xTickC)}</text>
  </svg>`;
  return {
    svg,
    stats: { min: statMin, max: statMax, avg: statAvg, vol: statVol, sinceMinDays },
    activeMarkets: selected,
    xTicks: [xTickA, xTickB, xTickC]
  };
}
function chartToken(points, prefix) {
  const first = Number(points[0]?.value || 0);
  const last = Number(points[points.length - 1]?.value || 0);
  const token = Math.abs(Math.round(first * 13 + last * 17 + points.length * 97)) % 1e6;
  return `${prefix}-${token}`;
}
function sparklineSvg(points, stroke = "#ff7a00", domainRaw = "de") {
  if (!points.length) {
    return '<svg viewBox="0 0 320 180" preserveAspectRatio="none"><rect x="0.5" y="0.5" width="319" height="179" fill="#07090d" stroke="rgba(255,255,255,.18)"/></svg>';
  }
  const values = points.map((point) => Number(point.value)).filter(Number.isFinite);
  if (!values.length) {
    return '<svg viewBox="0 0 320 180" preserveAspectRatio="none"><rect x="0.5" y="0.5" width="319" height="179" fill="#07090d" stroke="rgba(255,255,255,.18)"/></svg>';
  }
  const w = 320;
  const h = 180;
  const left = 38;
  const right = 308;
  const top = 10;
  const bottom = 136;
  const plotW = right - left;
  const plotH = bottom - top;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const pointsXY = values.map((value, index) => {
    const x = values.length <= 1 ? left : left + index / (values.length - 1) * plotW;
    const y = bottom - (value - min) / span * plotH;
    return { x, y };
  });
  const linePath = pointsXY.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${right} ${bottom} L${left} ${bottom} Z`;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const avgY = bottom - (avg - min) / span * plotH;
  const gridYs = [top, top + plotH * 0.25, top + plotH * 0.5, top + plotH * 0.75, bottom];
  const gridXs = [left, left + plotW * 0.25, left + plotW * 0.5, left + plotW * 0.75, right];
  const yTop = formatChartAxisPrice(max, domainRaw);
  const yMid = formatChartAxisPrice((max + min) / 2, domainRaw);
  const yLow = formatChartAxisPrice(min, domainRaw);
  const xTickA = formatChartLabelDate(points[0]?.ts ?? "");
  const xTickB = formatChartLabelDate(points[Math.floor((points.length - 1) / 2)]?.ts ?? "");
  const xTickC = formatChartLabelDate(points[points.length - 1]?.ts ?? "");
  const gid = chartToken(points, "detail-chart");
  const last = pointsXY[pointsXY.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="${gid}-bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(16,20,29,.98)"/>
        <stop offset="62%" stop-color="rgba(9,13,20,.94)"/>
        <stop offset="100%" stop-color="rgba(5,8,13,.99)"/>
      </linearGradient>
      <linearGradient id="${gid}-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(255,122,0,.50)"/>
        <stop offset="55%" stop-color="rgba(255,122,0,.18)"/>
        <stop offset="100%" stop-color="rgba(255,122,0,0)"/>
      </linearGradient>
    </defs>
    <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="url(#${gid}-bg)" stroke="rgba(255,255,255,.2)"/>
    ${gridYs.map((y) => `<line x1="${left}" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}" stroke="rgba(255,255,255,.16)" stroke-width="1"/>`).join("")}
    ${gridXs.map((x) => `<line x1="${x.toFixed(2)}" y1="${top}" x2="${x.toFixed(2)}" y2="${bottom}" stroke="rgba(255,255,255,.11)" stroke-width="1"/>`).join("")}
    <line x1="${left}" y1="${avgY.toFixed(2)}" x2="${right}" y2="${avgY.toFixed(2)}" stroke="rgba(255,166,87,.58)" stroke-width="1.2" stroke-dasharray="4 4"/>
    <path d="${areaPath}" fill="url(#${gid}-fill)"/>
    <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="2.9" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="3.7" fill="#ff6a55"/>
    <text x="5" y="${(top + 4).toFixed(2)}" fill="rgba(242,246,250,.9)" font-size="9.2" font-family="Roboto, sans-serif">${escapeHtml(yTop)}</text>
    <text x="5" y="${(top + plotH * 0.5 + 4).toFixed(2)}" fill="rgba(242,246,250,.86)" font-size="9.2" font-family="Roboto, sans-serif">${escapeHtml(yMid)}</text>
    <text x="5" y="${(bottom + 4).toFixed(2)}" fill="rgba(242,246,250,.86)" font-size="9.2" font-family="Roboto, sans-serif">${escapeHtml(yLow)}</text>
    <text x="${left}" y="${h - 10}" fill="rgba(242,246,250,.86)" font-size="10" font-family="Roboto, sans-serif">${escapeHtml(xTickA)}</text>
    <text x="${(left + plotW * 0.5).toFixed(2)}" y="${h - 10}" fill="rgba(242,246,250,.86)" font-size="10" text-anchor="middle" font-family="Roboto, sans-serif">${escapeHtml(xTickB)}</text>
    <text x="${right}" y="${h - 10}" fill="rgba(242,246,250,.86)" font-size="10" text-anchor="end" font-family="Roboto, sans-serif">${escapeHtml(xTickC)}</text>
  </svg>`;
}
function formatChartLabelDate(value) {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return "\u2014";
  return new Intl.DateTimeFormat(state.lang, {
    day: "numeric",
    month: "short"
  }).format(new Date(ts));
}
function formatChartAxisPrice(value, domainRaw) {
  if (!Number.isFinite(value)) return "\u2014";
  const rounded = value >= 1e3 ? Math.round(value) : Number(value.toFixed(2));
  const nf = new Intl.NumberFormat(state.lang === "de" ? "de-DE" : state.lang === "en" ? "en-US" : "pl-PL", {
    maximumFractionDigits: value >= 1e3 ? 0 : 2
  });
  return `${currencyForDomain(domainRaw)}${nf.format(rounded)}`;
}
function cardHistorySvg(points, domainRaw) {
  if (!points.length) {
    return '<svg viewBox="0 0 320 116" preserveAspectRatio="none"><rect x="0.5" y="0.5" width="319" height="115" class="cardhist-frame"/><text x="12" y="62" class="cardhist-muted">Brak historii</text></svg>';
  }
  const values = points.map((point) => Number(point.value)).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < 2) {
    return '<svg viewBox="0 0 320 116" preserveAspectRatio="none"><rect x="0.5" y="0.5" width="319" height="115" class="cardhist-frame"/></svg>';
  }
  const w = 320;
  const h = 116;
  const left = 32;
  const right = 312;
  const top = 8;
  const bottom = 86;
  const plotW = right - left;
  const plotH = bottom - top;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const prev = values[values.length - 2] ?? values[values.length - 1];
  const last = values[values.length - 1];
  const lastUp = last > prev;
  const xy = values.map((value, index) => {
    const x = values.length <= 1 ? left : left + index / (values.length - 1) * plotW;
    const y = bottom - (value - min) / span * plotH;
    return { x, y };
  });
  const stepPath = [`M${xy[0].x.toFixed(2)} ${xy[0].y.toFixed(2)}`];
  for (let i = 1; i < xy.length; i += 1) {
    stepPath.push(`H${xy[i].x.toFixed(2)}`);
    stepPath.push(`V${xy[i].y.toFixed(2)}`);
  }
  const stepLine = stepPath.join(" ");
  const areaPath = `${stepLine} L${right} ${bottom} L${left} ${bottom} Z`;
  const avgY = bottom - (avg - min) / span * plotH;
  const xTickA = formatChartLabelDate(points[0]?.ts ?? "");
  const xTickB = formatChartLabelDate(points[Math.floor((points.length - 1) / 2)]?.ts ?? "");
  const xTickC = formatChartLabelDate(points[points.length - 1]?.ts ?? "");
  const yTop = formatChartAxisPrice(max, domainRaw);
  const yMid = formatChartAxisPrice((max + min) / 2, domainRaw);
  const yLow = formatChartAxisPrice(min, domainRaw);
  const gid = chartToken(points, "card-chart");
  const gridYs = [top, top + plotH * 0.5, bottom];
  const gridXs = [left, left + plotW * 0.25, left + plotW * 0.5, left + plotW * 0.75, right];
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="${gid}-bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(16,18,24,.96)"/>
        <stop offset="100%" stop-color="rgba(7,10,15,.98)"/>
      </linearGradient>
      <linearGradient id="${gid}-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(220,139,53,.36)"/>
        <stop offset="100%" stop-color="rgba(220,139,53,0)"/>
      </linearGradient>
    </defs>
    <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="url(#${gid}-bg)" stroke="rgba(255,255,255,.16)"/>
    ${gridYs.map((y) => `<line x1="${left}" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}" stroke="rgba(255,255,255,.10)" stroke-width="1"/>`).join("")}
    ${gridXs.map((x) => `<line x1="${x.toFixed(2)}" y1="${top}" x2="${x.toFixed(2)}" y2="${bottom}" stroke="rgba(255,255,255,.07)" stroke-width="1"/>`).join("")}
    <line x1="${left}" y1="${avgY.toFixed(2)}" x2="${right}" y2="${avgY.toFixed(2)}" stroke="rgba(255,166,87,.62)" stroke-width="1.2" stroke-dasharray="4 4"/>
    <path d="${areaPath}" fill="url(#${gid}-fill)"/>
    <path d="${stepLine}" fill="none" stroke="#81a9ff" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${xy[xy.length - 1].x.toFixed(2)}" cy="${xy[xy.length - 1].y.toFixed(2)}" r="3.6" fill="${lastUp ? "#f85149" : "#3fb950"}"/>
    <text x="6" y="${(top + 4).toFixed(2)}" fill="rgba(242,246,250,.86)" font-size="9.5" font-family="Roboto, sans-serif">${escapeHtml(yTop)}</text>
    <text x="6" y="${(top + plotH * 0.5 + 4).toFixed(2)}" fill="rgba(242,246,250,.82)" font-size="9.5" font-family="Roboto, sans-serif">${escapeHtml(yMid)}</text>
    <text x="6" y="${(bottom + 4).toFixed(2)}" fill="rgba(242,246,250,.82)" font-size="9.5" font-family="Roboto, sans-serif">${escapeHtml(yLow)}</text>
    <text x="${left}" y="${h - 5}" fill="rgba(242,246,250,.9)" font-size="9.5" font-family="Roboto, sans-serif">${escapeHtml(xTickA)}</text>
    <text x="${(left + plotW * 0.5).toFixed(2)}" y="${h - 5}" fill="rgba(242,246,250,.9)" font-size="9.5" font-family="Roboto, sans-serif" text-anchor="middle">${escapeHtml(xTickB)}</text>
    <text x="${right}" y="${h - 5}" fill="rgba(242,246,250,.9)" font-size="9.5" font-family="Roboto, sans-serif" text-anchor="end">${escapeHtml(xTickC)}</text>
  </svg>`;
}
function openAmazon(asinRaw, marketRaw) {
  const asin = String(asinRaw || "").trim().toUpperCase();
  if (!asin) return;
  const market = String(marketRaw || "de").toLowerCase();
  const hostByMarket = {
    de: "amazon.de",
    it: "amazon.it",
    fr: "amazon.fr",
    es: "amazon.es",
    uk: "amazon.co.uk",
    nl: "amazon.nl",
    pl: "amazon.pl"
  };
  const host = hostByMarket[market] || hostByMarket.de;
  window.open(`https://${host}/dp/${encodeURIComponent(asin)}`, "_blank", "noopener,noreferrer");
}
function applyCopy() {
  const copy = t();
  document.documentElement.lang = state.lang;
  if (nodes.searchInput) nodes.searchInput.placeholder = copy.searchPlaceholder;
  if (nodes.navLabels.tracking) nodes.navLabels.tracking.textContent = copy.nav.tracking;
  if (nodes.navLabels.deals) nodes.navLabels.deals.textContent = copy.nav.deals;
  if (nodes.navLabels.add) nodes.navLabels.add.textContent = copy.nav.add;
  if (nodes.navLabels.alerts) nodes.navLabels.alerts.textContent = copy.nav.alerts;
  if (nodes.navLabels.settings) nodes.navLabels.settings.textContent = copy.nav.settings;
  const dealsTitle = document.querySelector("#deals-title");
  const dealsDesc = document.querySelector("#deals-desc");
  const addTitle = document.querySelector("#add-title");
  const addDesc = document.querySelector("#add-desc");
  const alertsTitle = document.querySelector("#alerts-title");
  const alertsDesc = document.querySelector("#alerts-desc");
  const chatIdSave = document.querySelector("#chatIdSave");
  if (dealsTitle) dealsTitle.textContent = copy.dealsTitle;
  if (dealsDesc) dealsDesc.textContent = copy.dealsDesc;
  if (addTitle) addTitle.textContent = copy.addTitle;
  if (addDesc) addDesc.textContent = copy.addDesc;
  if (alertsTitle) alertsTitle.textContent = copy.alertsTitle;
  if (alertsDesc) alertsDesc.textContent = copy.alertsDesc;
  if (chatIdSave) chatIdSave.textContent = copy.setChatId;
  for (const button of nodes.langRow?.querySelectorAll(".mchip[data-lang]") || []) {
    const value = String(button.dataset.lang || "");
    button.classList.toggle("on", value === state.lang);
  }
  if (state.selectedAsin) {
    const selected = state.trackings.find((item) => String(item.asin).toUpperCase() === String(state.selectedAsin).toUpperCase());
    if (selected) renderDetail(selected);
  }
}
function setActiveView(next) {
  state.activeView = next;
  for (const [key, view] of Object.entries(nodes.views)) {
    if (!view) continue;
    view.classList.toggle("on", key === next);
  }
  for (const button of nodes.navItems) {
    button.classList.toggle("on", String(button.dataset.v || "") === next);
  }
}
function visibleItems() {
  const query = state.query.trim().toLowerCase();
  const list = state.trackings.filter((item) => {
    const active = !isSnoozed(item);
    if (state.trackingStatusFilter === "active" && !active) return false;
    if (state.trackingStatusFilter === "inactive" && active) return false;
    if (!query) return true;
    const haystack = `${String(item.title || "")} ${String(item.asin || "")}`.toLowerCase();
    return haystack.includes(query);
  });
  list.sort((a, b) => {
    const aTs = Date.parse(String(a.updatedAt || ""));
    const bTs = Date.parse(String(b.updatedAt || ""));
    return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
  });
  return list;
}
function updateTrackingStatusFiltersUi() {
  const root = nodes.trackingStatusFilters;
  if (!root) return;
  const activeCount = state.trackings.filter((item) => !isSnoozed(item)).length;
  const inactiveCount = state.trackings.filter((item) => isSnoozed(item)).length;
  const allCount = state.trackings.length;
  for (const button of root.querySelectorAll(".deal-chip[data-status]")) {
    const status = String(button.dataset.status || "");
    button.classList.toggle("on", status === state.trackingStatusFilter);
    if (status === "active") button.textContent = `Aktywne (${activeCount})`;
    if (status === "all") button.textContent = `Wszystkie (${allCount})`;
    if (status === "inactive") button.textContent = `Wy\u0142\u0105czone (${inactiveCount})`;
  }
}
function recommendationBadge(item) {
  const copy = t();
  const delta = Number(item.cardPreview?.deltaPctVsAvg);
  if (!Number.isFinite(delta)) {
    return `<span class="reco"><span class="material-icons-round">remove</span>${copy.bestPrice}</span>`;
  }
  if (delta <= -5) {
    return `<span class="reco"><span class="material-icons-round">south</span>${copy.bestPrice}</span>`;
  }
  return `<span class="reco"><span class="material-icons-round">schedule</span>${copy.bestPrice}</span>`;
}
function renderTrackingCard(item) {
  const copy = t();
  const title = escapeHtml(item.title || item.asin);
  const asin = escapeHtml(item.asin || "");
  const bestDomain = getBestDomain(item);
  const bestNew = bestNewPrice(item);
  const bestUsed = bestUsedPrice(item);
  const delta = Number(item.cardPreview?.deltaPctVsAvg);
  const ratingRaw = Number(item.cardPreview?.rating);
  const rating = Number.isFinite(ratingRaw) ? Math.max(0, Math.min(5, ratingRaw)) : 0;
  const stars = "\u2605".repeat(Math.floor(rating));
  const image = String(item.cardPreview?.imageUrl || item.imageUrl || "").trim();
  const rows = normalizedRows(item);
  const sparkPoints = getSparkline(item);
  const spark = cardHistorySvg(sparkPoints, bestDomain);
  const priceDeltaBadge = Number.isFinite(delta) ? `<span class="pdrop ${delta > 0 ? "up" : "dn"}"><span class="material-icons-round">${delta > 0 ? "north" : "south"}</span>${delta > 0 ? "+" : ""}${delta.toFixed(0)}%</span>` : "";
  const statusBadge = isSnoozed(item) ? `<span class="track-status-badge inactive"><span class="material-icons-round">pause_circle</span>${copy.paused}</span>` : `<span class="track-status-badge active"><span class="material-icons-round">track_changes</span>${copy.active}</span>`;
  const signalChips = [
    recommendationBadge(item),
    bestUsed !== null ? '<span class="target-price-badge blue">used min</span>' : "",
    item.targetNew && Number(item.targetNew) > 0 ? `<span class="target-price-badge inline"><span class="material-icons-round">notifications</span>${escapeHtml(formatPrice(item.targetNew, bestDomain))}</span>` : ""
  ].filter(Boolean).join("");
  const rowByMarket = new Map(rows.map((row) => [String(row.market || "").toLowerCase(), row]));
  const grid = TRACKING_CARD_MARKETS.map((market) => {
    const row = rowByMarket.get(market);
    const newPrice = Number(row?.newPrice);
    const usedPrice = Number(row?.usedPrice);
    const trend = Number(row?.trendPct);
    const isBest = Number.isFinite(newPrice) && newPrice > 0 && Number(bestNew) === newPrice;
    const trendTag = Number.isFinite(trend) && Math.abs(trend) >= 2 ? `<span class="pgrid-trend ${trend > 0 ? "up" : "dn"}"><span class="material-icons-round">${trend > 0 ? "north" : "south"}</span></span>` : "";
    return `<div class="pgrid-item" data-domain="${escapeHtml(market)}" data-asin="${asin}">
        <span class="pgrid-flag flag-round">${marketFlag(market)}</span>
        <span class="pgrid-price ${isBest ? "best" : ""}">${escapeHtml(formatPrice(newPrice, market))}</span>
        <span class="pgrid-used">${Number.isFinite(usedPrice) && usedPrice > 0 ? `u:${escapeHtml(formatPrice(usedPrice, market))}` : ""}</span>
        ${trendTag}
      </div>`;
  }).join("");
  const stockBadge = item.cardPreview?.outOfStock ? '<span class="stock-badge out-of-stock">BRAK W MAGAZYNIE</span>' : "";
  const popRaw = Number(item.cardPreview?.popularity);
  const popBadge = Number.isFinite(popRaw) && popRaw > 1 ? `<span class="pop-badge"><span class="material-icons-round">groups</span>${popRaw}</span>` : "";
  const utilityBadges = [stockBadge, popBadge].filter(Boolean).join("");
  return `<article class="pcard" data-asin="${asin}">
    <div class="pcard-top">
      <div class="pcard-img">
        ${image ? `<img src="${escapeHtml(image)}" alt="${title}" loading="lazy" />` : '<span class="pcard-img-fallback material-icons-round">inventory_2</span>'}
      </div>
      <div class="pcard-info">
        <div class="pcard-title">${title}</div>
        <div class="pcard-meta"><span class="stars">${stars}</span>${rating > 0 ? `(${rating.toFixed(1)})` : "(0.0)"}</div>
        <div class="pcard-track-status">${statusBadge}</div>
        <div class="pcard-prices">
          <div class="pcard-price-row" data-asin="${asin}" data-market="${escapeHtml(bestDomain)}">
            <span class="pflag flag-round">${marketFlag(bestDomain)}</span>
            <span class="pprice">${escapeHtml(formatPrice(bestNew, bestDomain))}</span>
            ${recommendationBadge(item)}
            ${priceDeltaBadge}
          </div>
        </div>
      </div>
    </div>
    ${signalChips ? `<div class="pcard-signals-row"><div class="pcard-signals">${signalChips}</div></div>` : ""}
    ${utilityBadges ? `<div class="pcard-signals-row"><div class="pcard-signals">${utilityBadges}</div></div>` : ""}
    <div class="pgrid">${grid}</div>
    ${sparkPoints.length > 1 ? `<div class="pcard-spark sparkline pcard-history">${spark}</div>` : ""}
  </article>`;
}
function renderTrackingList() {
  if (!nodes.productsList) return;
  const items = visibleItems();
  if (!items.length) {
    nodes.productsList.innerHTML = `<div class="empty"><h3>${escapeHtml(t().noData)}</h3></div>`;
    updateTrackingStatusFiltersUi();
    return;
  }
  nodes.productsList.innerHTML = items.map((item) => renderTrackingCard(item)).join("");
  updateTrackingStatusFiltersUi();
}
function renderPriceRows(rows, type, asin) {
  if (!rows.length) return `<div class="detail-overview-value">${escapeHtml(t().noData)}</div>`;
  return rows.map(
    ([market, value]) => `<div class="ptable-row">
        <button class="ptable-cell ptable-cell-link" type="button" data-action="open-market" data-asin="${escapeHtml(asin)}" data-market="${escapeHtml(market)}">
          <span class="flag-round">${marketFlag(market)}</span>
          <span>${escapeHtml(market.toUpperCase())}</span>
        </button>
        <div class="ptable-cell ${type === "new" ? "ptable-cell-new" : "ptable-cell-used"}">${escapeHtml(formatPrice(value, market))}</div>
        <div class="ptable-cell"></div>
      </div>`
  ).join("");
}
function renderMarketCompare(rows, bestValue, asin) {
  if (!rows.length) return `<div class="detail-overview-value">${escapeHtml(t().noData)}</div>`;
  const maxValue = Math.max(...rows.map((row) => row[1]));
  return rows.map(([market, value]) => {
    const widthPct = maxValue > 0 ? Math.max(14, Math.round(value / maxValue * 100)) : 14;
    const diff = Number.isFinite(Number(bestValue)) && Number(bestValue) > 0 ? value - Number(bestValue) : 0;
    const diffClass = diff > 0 ? "up" : diff < 0 ? "dn" : "neu";
    const diffLabel = diff === 0 ? "\u2014" : `${diff > 0 ? "+" : ""}${formatPrice(Math.abs(diff), market)}`;
    return `<button class="detail-market-row" type="button" data-action="open-market" data-asin="${escapeHtml(asin)}" data-market="${escapeHtml(market)}">
        <span class="detail-market-left">${marketFlag(market)} ${escapeHtml(market.toUpperCase())}</span>
        <span class="detail-market-bar"><span class="detail-market-fill ${diffClass}" style="width:${widthPct}%"></span></span>
        <strong class="detail-market-price">${escapeHtml(formatPrice(value, market))}</strong>
        <span class="detail-market-diff ${diffClass}">${escapeHtml(diffLabel)}</span>
      </button>`;
  }).join("");
}
function getSelectedTrackingItem() {
  const asin = String(state.selectedAsin || "").toUpperCase();
  if (!asin) return null;
  return state.trackings.find((item) => String(item.asin || "").toUpperCase() === asin) || null;
}
async function hydrateDetail(asinRaw) {
  const asin = String(asinRaw || "").trim().toUpperCase();
  if (!asin) return null;
  if (state.detailByAsin[asin]) return state.detailByAsin[asin];
  try {
    const detail = await client.getProductDetail(asin);
    state.detailByAsin[asin] = detail;
    return detail;
  } catch {
    return null;
  }
}
function rerenderSelectedDetail() {
  const selected = getSelectedTrackingItem();
  if (!selected) return;
  renderDetail(selected);
}
function renderDetail(item) {
  if (!nodes.detailContent) return;
  const copy = t();
  const asin = String(item.asin || "").toUpperCase();
  const detail = state.detailByAsin[asin] || null;
  const bestDomain = getBestDomain(item);
  const bestNew = bestNewPrice(item);
  const bestUsed = bestUsedPrice(item);
  const avgNew = avgNewPrice(item);
  const delta = Number(item.cardPreview?.deltaPctVsAvg);
  const rows = normalizedRows(item);
  const newRows = rows.map((row) => [String(row.market || "").toLowerCase(), Number(row.newPrice)]).filter(([, value]) => Number.isFinite(value) && value > 0).sort((a, b) => a[1] - b[1]);
  const usedRows = rows.map((row) => [String(row.market || "").toLowerCase(), Number(row.usedPrice)]).filter(([, value]) => Number.isFinite(value) && value > 0).sort((a, b) => a[1] - b[1]);
  const image = String(item.cardPreview?.imageUrl || item.imageUrl || "").trim();
  const detailChartRows = buildDetailChartRows(item, detail);
  const availableChartMarkets = DETAIL_MARKETS.filter(
    (market) => detailChartRows.some((row) => String(row.domain || "").toLowerCase() === market)
  );
  const selectedChartMarkets = getDetailChartMarkets(asin, availableChartMarkets, bestDomain);
  state.detailChartMarketsByAsin[asin] = selectedChartMarkets;
  const filteredChartRows = applyDetailChartFilters(detailChartRows, selectedChartMarkets, state.detailChartRangeDays);
  const detailChartStats = computeDetailChartStats(filteredChartRows);
  const minNew = Number.isFinite(Number(detailChartStats?.minPrice)) ? Number(detailChartStats?.minPrice) : newRows.length ? Math.min(...newRows.map((row) => row[1])) : null;
  const maxNew = Number.isFinite(Number(detailChartStats?.maxPrice)) ? Number(detailChartStats?.maxPrice) : newRows.length ? Math.max(...newRows.map((row) => row[1])) : null;
  const avgForKpi = Number.isFinite(Number(detailChartStats?.avgPrice)) ? Number(detailChartStats?.avgPrice) : avgNew;
  const vol = Number.isFinite(Number(detailChartStats?.volatilityPct)) ? Math.round(Number(detailChartStats?.volatilityPct)) : Number.isFinite(Number(minNew)) && Number.isFinite(Number(maxNew)) && Number.isFinite(Number(avgForKpi)) && Number(avgForKpi) > 0 ? Math.round((Number(maxNew) - Number(minNew)) / Number(avgForKpi) * 100) : null;
  const kpiMin = minNew !== null ? formatPrice(minNew, bestDomain) : "\u2014";
  const kpiMax = maxNew !== null ? formatPrice(maxNew, bestDomain) : "\u2014";
  const kpiAvg = avgForKpi !== null ? formatPrice(avgForKpi, bestDomain) : "\u2014";
  const kpiVol = vol !== null ? `${vol}%` : "\u2014";
  const sinceLow = Number.isFinite(Number(detailChartStats?.daysSinceLow)) ? `${Number(detailChartStats?.daysSinceLow)} d` : "\u2014";
  const bestUsedDomain = usedRows.length ? usedRows[0][0] : bestDomain;
  const reco = recommendationBadge(item);
  const ratingRaw = Number(item.cardPreview?.rating);
  const rating = Number.isFinite(ratingRaw) ? Math.max(0, Math.min(5, ratingRaw)) : 0;
  const stars = "\u2605".repeat(Math.floor(rating));
  nodes.detailContent.innerHTML = `<div class="dhdr">
    <div class="dhdr-img"><span class="dhdr-img-fallback material-icons-round" aria-hidden="true">inventory_2</span>${image ? `<img id="d-img" src="${escapeHtml(image)}" alt="${escapeHtml(item.title || asin)}" loading="lazy" />` : '<img id="d-img" alt="" style="display:none" />'}</div>
    <div class="dhdr-info">
      <div class="dhdr-title" id="d-title">${escapeHtml(item.title || asin)}</div>
      <div class="pcard-meta">${escapeHtml(asin)}</div>
      <div class="detail-rating-row">
        <span class="stars" id="d-stars">${stars}</span>
        <span class="detail-rating-text" id="d-rating">${rating > 0 ? `(${rating.toFixed(1)})` : "(0.0)"}</span>
      </div>
    </div>
    <div class="detail-price-row">
      <span class="pflag" id="d-flag">${marketFlag(bestDomain)}</span>
      <div class="dhdr-price" id="d-price">${escapeHtml(formatPrice(bestNew, bestDomain))}</div>
      <div id="d-reco" class="detail-reco detail-reco-inline">${reco}</div>
      <div class="dhdr-change ${Number.isFinite(delta) && delta > 0 ? "up" : "dn"}" id="d-change">${Number.isFinite(delta) ? `${delta > 0 ? "+" : ""}${delta.toFixed(0)}%` : "\u2014"}</div>
    </div>
  </div>

  <button class="buy-btn" id="buyNowBtn" type="button" data-action="open-best" data-asin="${escapeHtml(asin)}" data-market="${escapeHtml(bestDomain)}">
    <span class="material-icons-round buy-icon">shopping_cart</span>
    <span id="buyNowText">${escapeHtml(copy.buyNow)} \u2014 ${escapeHtml(formatPrice(bestNew, bestDomain))} ${escapeHtml(copy.buyNowAt)} ${escapeHtml(bestDomain.toUpperCase())}</span>
  </button>

  <div class="chart-wrap">
    <div class="detail-section-title"><span class="material-icons-round">show_chart</span><span>${escapeHtml(copy.chartHistory)}</span></div>
    <div class="chart-box"><canvas id="mainChart" aria-label="Price history chart"></canvas></div>
    <div class="chart-kpis" id="chartStats">
      <div class="chart-kpi"><span class="chart-kpi-label">Min</span><strong class="chart-kpi-value" id="chartStatMin">${escapeHtml(kpiMin)}</strong></div>
      <div class="chart-kpi"><span class="chart-kpi-label">Max</span><strong class="chart-kpi-value" id="chartStatMax">${escapeHtml(kpiMax)}</strong></div>
      <div class="chart-kpi"><span class="chart-kpi-label">\u015Ar.</span><strong class="chart-kpi-value" id="chartStatAvg">${escapeHtml(kpiAvg)}</strong></div>
      <div class="chart-kpi"><span class="chart-kpi-label">Zmienno\u015B\u0107</span><strong class="chart-kpi-value" id="chartStatVol">${escapeHtml(kpiVol)}</strong></div>
      <div class="chart-kpi"><span class="chart-kpi-label">Od minimum</span><strong class="chart-kpi-value" id="chartStatSinceLow">${escapeHtml(sinceLow)}</strong></div>
    </div>
    <div class="trange" id="timeRange">
      <button type="button" data-r="1" class="${state.detailChartRangeDays === 1 ? "on" : ""}">1D</button>
      <button type="button" data-r="7" class="${state.detailChartRangeDays === 7 ? "on" : ""}">1W</button>
      <button type="button" data-r="30" class="${state.detailChartRangeDays === 30 ? "on" : ""}">1M</button>
      <button type="button" data-r="90" class="${state.detailChartRangeDays === 90 ? "on" : ""}">3M</button>
      <button type="button" data-r="180" class="${state.detailChartRangeDays === 180 ? "on" : ""}">6M</button>
      <button type="button" data-r="365" class="${state.detailChartRangeDays === 365 ? "on" : ""}">1Y</button>
      <button type="button" data-r="1095" class="${state.detailChartRangeDays === 1095 ? "on" : ""}">3Y</button>
      <button type="button" data-r="0" class="${state.detailChartRangeDays === 0 ? "on" : ""}">ALL</button>
    </div>
    <div class="market-toggle-bar" id="chartMarkets">
      ${DETAIL_MARKETS.map((market) => `<button type="button" class="mchip ${selectedChartMarkets.includes(market) ? "on" : ""}" data-action="toggle-chart-market" data-dom="${market}"><span class="flag-round">${marketFlag(market)}</span><span>${market.toUpperCase()}</span></button>`).join("")}
    </div>
  </div>
  <div id="competitorCard" class="detail-aux-gap-10"></div>

  <div class="dtabs" id="detailTabs">
    <div class="dtab ${state.detailTab === "overview" ? "on" : ""}" data-dt="overview"><span class="material-icons-round">grid_view</span><span>${escapeHtml(copy.overview)}</span></div>
    <div class="dtab ${state.detailTab === "settings" ? "on" : ""}" data-dt="settings"><span class="material-icons-round">tune</span><span>${escapeHtml(copy.settingsTab)}</span></div>
  </div>

  <div class="dtpanel ${state.detailTab === "overview" ? "on" : ""}" id="dt-overview">
    <div class="detail-section-title-gap"><span class="material-icons-round">compare_arrows</span><span>Por\xF3wnanie mi\u0119dzy rynkami</span></div>
    <div class="detail-market-card">
      ${renderMarketCompare(newRows, bestNew, asin)}
      ${usedRows.length ? `<div class="detail-market-used-sep">Ceny u\u017Cywane</div>${renderMarketCompare(usedRows, bestUsed, asin)}` : ""}
    </div>

    <div class="ptable" id="priceTable">
      <div class="ptable-section-title">${escapeHtml(copy.newPrices)}</div>
      ${renderPriceRows(newRows, "new", asin)}
      <div class="ptable-section-title used">${escapeHtml(copy.usedPrices)}</div>
      ${renderPriceRows(usedRows, "used", asin)}
    </div>
    <div id="buyboxIndicator" class="detail-aux-gap-10"></div>
    <div id="bestTimeToBuy" class="detail-aux-gap-10"></div>

    <div class="detail-overview-list detail-aux-gap-12">
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryCurrent)}</div><div class="detail-overview-value" id="s-cur">${escapeHtml(formatPrice(bestNew, bestDomain))}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryAvg)}</div><div class="detail-overview-value" id="s-avg">${escapeHtml(avgNew !== null ? formatPrice(avgNew, bestDomain) : "\u2014")}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryLow)}</div><div class="detail-overview-value" id="s-low">${escapeHtml(kpiMin)}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryHigh)}</div><div class="detail-overview-value" id="s-high">${escapeHtml(kpiMax)}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryDrop30)}</div><div class="detail-overview-value" id="s-drop30">${Number.isFinite(delta) ? `${delta > 0 ? "+" : ""}${delta.toFixed(0)}%` : "\u2014"}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryAsin)}</div><div class="detail-overview-value" id="s-asin">${escapeHtml(asin)}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryUpdated)}</div><div class="detail-overview-value" id="s-updates">${escapeHtml(formatDateTime(item.updatedAt))}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryUsedMin)}</div><div class="detail-overview-value" id="s-alerts-threshold">${escapeHtml(bestUsed !== null ? formatPrice(bestUsed, bestUsedDomain) : "\u2014")}</div></div>
    </div>
  </div>

  <div class="dtpanel ${state.detailTab === "settings" ? "on" : ""}" id="dt-settings">
    <button class="buy-btn" type="button" data-action="refresh-asin" data-asin="${escapeHtml(asin)}">${escapeHtml(copy.refreshAsin)}</button>
    <button class="buy-btn" type="button" data-action="snooze" data-asin="${escapeHtml(asin)}">${escapeHtml(copy.snooze60)}</button>
    <button class="buy-btn" type="button" data-action="unsnooze" data-asin="${escapeHtml(asin)}">${escapeHtml(copy.unsnooze)}</button>
  </div>`;
  renderDetailChartCanvas(filteredChartRows);
  if (nodes.detailTopbarTitle) nodes.detailTopbarTitle.textContent = copy.details;
}
async function openDetail(asinRaw) {
  const asin = String(asinRaw || "").trim().toUpperCase();
  const item = state.trackings.find((row) => String(row.asin || "").toUpperCase() === asin);
  if (!item || !nodes.detailView) return;
  state.selectedAsin = asin;
  state.detailTab = "overview";
  renderDetail(item);
  nodes.detailView.classList.add("on");
  await hydrateDetail(asin);
  rerenderSelectedDetail();
}
function closeDetail() {
  state.selectedAsin = null;
  if (nodes.detailView) nodes.detailView.classList.remove("on");
}
async function refreshSelectedTracking(asinRaw) {
  const asin = String(asinRaw || "").trim().toUpperCase();
  if (!asin) return;
  try {
    await client.refreshTracking(asin);
  } catch {
  }
  await loadTrackings();
  if (state.selectedAsin) void openDetail(state.selectedAsin);
}
async function snoozeSelectedTracking(asinRaw) {
  const asin = String(asinRaw || "").trim().toUpperCase();
  if (!asin) return;
  try {
    await client.snoozeTracking(state.chatId, asin, 60);
  } catch {
  }
  await loadTrackings();
  if (state.selectedAsin) void openDetail(state.selectedAsin);
}
async function unsnoozeSelectedTracking(asinRaw) {
  const asin = String(asinRaw || "").trim().toUpperCase();
  if (!asin) return;
  try {
    await client.unsnoozeTracking(state.chatId, asin);
  } catch {
  }
  await loadTrackings();
  if (state.selectedAsin) void openDetail(state.selectedAsin);
}
async function deleteSelectedTracking() {
  const asin = String(state.selectedAsin || "").trim().toUpperCase();
  if (!asin) return;
  const confirmed = window.confirm(`Delete tracking ${asin}?`);
  if (!confirmed) return;
  try {
    await client.deleteTracking(state.chatId, asin);
  } catch {
  }
  closeDetail();
  await loadTrackings();
}
async function shareSelectedTracking() {
  const asin = String(state.selectedAsin || "").trim().toUpperCase();
  if (!asin) return;
  const bestDomain = (() => {
    const item = state.trackings.find((row) => String(row.asin || "").toUpperCase() === asin);
    return item ? getBestDomain(item) : "de";
  })();
  const url = `https://${bestDomain === "uk" ? "amazon.co.uk" : `amazon.${bestDomain}`}/dp/${encodeURIComponent(asin)}`;
  const shareData = {
    title: asin,
    text: `Soon ${asin}`,
    url
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
  } catch {
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
  }
}
async function copyMobileUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("chatId", state.chatId);
  url.searchParams.set("lang", state.lang);
  try {
    await navigator.clipboard.writeText(url.toString());
  } catch {
  }
}
async function loadTrackings() {
  try {
    const dashboard = await client.getDashboard(state.chatId, { includeCardPreview: true });
    state.trackings = Array.isArray(dashboard?.items) ? dashboard.items : [];
  } catch {
    state.trackings = [];
  }
  renderTrackingList();
}
function bindEvents() {
  for (const button of nodes.navItems) {
    button.addEventListener("click", () => {
      const view = String(button.dataset.v || "tracking");
      setActiveView(view);
    });
  }
  nodes.searchInput?.addEventListener("input", () => {
    state.query = String(nodes.searchInput?.value || "");
    renderTrackingList();
  });
  nodes.searchClear?.addEventListener("click", () => {
    state.query = "";
    if (nodes.searchInput) nodes.searchInput.value = "";
    renderTrackingList();
  });
  nodes.topRefreshBtn?.addEventListener("click", async () => {
    await loadTrackings();
  });
  nodes.topCopyBtn?.addEventListener("click", async () => {
    await copyMobileUrl();
  });
  nodes.trackingStatusFilters?.addEventListener("click", (event) => {
    const target = event.target;
    const button = target.closest(".deal-chip[data-status]");
    if (!button) return;
    const status = String(button.dataset.status || "");
    if (status !== "active" && status !== "all" && status !== "inactive") return;
    state.trackingStatusFilter = status;
    renderTrackingList();
  });
  nodes.productsList?.addEventListener("click", (event) => {
    const target = event.target;
    const marketButton = target.closest('[data-action="open-market"]');
    if (marketButton) {
      openAmazon(marketButton.dataset.asin || "", marketButton.dataset.market || "de");
      return;
    }
    const bestButton = target.closest(".pcard-price-row[data-asin][data-market]");
    if (bestButton) {
      openAmazon(bestButton.dataset.asin || "", bestButton.dataset.market || "de");
      return;
    }
    const gridItem = target.closest(".pgrid-item[data-domain][data-asin]");
    if (gridItem) {
      openAmazon(gridItem.dataset.asin || "", gridItem.dataset.domain || "de");
      return;
    }
    const card = target.closest(".pcard[data-asin]");
    if (card?.dataset.asin) {
      void openDetail(card.dataset.asin);
    }
  });
  nodes.detailBack?.addEventListener("click", closeDetail);
  nodes.detailDelete?.addEventListener("click", deleteSelectedTracking);
  nodes.detailShare?.addEventListener("click", shareSelectedTracking);
  nodes.detailContent?.addEventListener("click", async (event) => {
    const target = event.target;
    const marketButton = target.closest('[data-action="open-market"]');
    if (marketButton) {
      openAmazon(marketButton.dataset.asin || "", marketButton.dataset.market || "de");
      return;
    }
    const bestButton = target.closest('[data-action="open-best"]');
    if (bestButton) {
      openAmazon(bestButton.dataset.asin || "", bestButton.dataset.market || "de");
      return;
    }
    const tabButton = target.closest(".dtab[data-dt]");
    if (tabButton) {
      const tab = String(tabButton.dataset.dt || "overview");
      if (tab !== "overview" && tab !== "settings") return;
      state.detailTab = tab;
      rerenderSelectedDetail();
      return;
    }
    const rangeButton = target.closest("#timeRange [data-r]");
    if (rangeButton) {
      const rangeDays = Number(rangeButton.dataset.r);
      if (Number.isFinite(rangeDays) && rangeDays >= 0) {
        state.detailChartRangeDays = rangeDays;
        rerenderSelectedDetail();
      }
      return;
    }
    const chartMarketChip = target.closest('[data-action="toggle-chart-market"]');
    if (chartMarketChip) {
      const asin = String(state.selectedAsin || "").toUpperCase();
      const dom = String(chartMarketChip.dataset.dom || "").toLowerCase();
      if (!asin || !dom) return;
      const selected = new Set(state.detailChartMarketsByAsin[asin] || []);
      if (selected.has(dom)) {
        if (selected.size > 1) selected.delete(dom);
      } else {
        selected.add(dom);
      }
      state.detailChartMarketsByAsin[asin] = [...selected];
      rerenderSelectedDetail();
      return;
    }
    const refreshButton = target.closest('[data-action="refresh-asin"]');
    if (refreshButton) {
      await refreshSelectedTracking(refreshButton.dataset.asin || "");
      return;
    }
    const snoozeButton = target.closest('[data-action="snooze"]');
    if (snoozeButton) {
      await snoozeSelectedTracking(snoozeButton.dataset.asin || "");
      return;
    }
    const unsnoozeButton = target.closest('[data-action="unsnooze"]');
    if (unsnoozeButton) {
      await unsnoozeSelectedTracking(unsnoozeButton.dataset.asin || "");
    }
  });
  if (nodes.chatIdInput) nodes.chatIdInput.value = state.chatId;
  nodes.chatIdSave?.addEventListener("click", async () => {
    const next = String(nodes.chatIdInput?.value || "").trim() || "demo";
    state.chatId = next;
    try {
      window.localStorage.setItem("soon.chatId", next);
    } catch {
    }
    setQueryParam("chatId", next);
    await loadTrackings();
  });
  nodes.langRow?.addEventListener("click", async (event) => {
    const target = event.target;
    const button = target.closest(".mchip[data-lang]");
    if (!button) return;
    const next = String(button.dataset.lang || "pl");
    if (!["pl", "en", "de"].includes(next)) return;
    state.lang = next;
    try {
      window.localStorage.setItem("soon.lang", next);
    } catch {
    }
    setQueryParam("lang", next);
    applyCopy();
    renderTrackingList();
  });
}
async function bootstrap() {
  bindEvents();
  setActiveView("tracking");
  applyCopy();
  await loadTrackings();
}
bootstrap().catch(() => {
});
