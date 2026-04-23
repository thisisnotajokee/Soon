import { state, MARKET_ORDER } from '../state/index.js';
import type { MarketRow, TrackingItem } from '../state/types.js';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function marketFlag(domainRaw: string | null | undefined): string {
  const domain = String(domainRaw || '').toLowerCase();
  const flags: Record<string, string> = {
    de: '🇩🇪',
    it: '🇮🇹',
    fr: '🇫🇷',
    es: '🇪🇸',
    uk: '🇬🇧',
    nl: '🇳🇱',
    pl: '🇵🇱',
  };
  return flags[domain] || '•';
}

export function currencyForDomain(domainRaw?: string | null): string {
  return String(domainRaw || '').toLowerCase() === 'uk' ? '£' : '€';
}

export function formatPrice(value: unknown, domainRaw?: string | null): string {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return `${currencyForDomain(domainRaw)}${num.toFixed(2)}`;
}

export function formatDateTime(value: unknown): string {
  const ts = Date.parse(String(value || ''));
  if (!Number.isFinite(ts)) return '—';
  return new Intl.DateTimeFormat(state.lang, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

export function toNullableNumber(value: unknown): number | null {
  const str = String(value ?? '').trim();
  if (!str) return null;
  const num = Number(str.replace(',', '.'));
  return Number.isFinite(num) && num >= 0 ? num : null;
}

export function parseAsinFromInput(raw: string): string[] {
  const lines = raw.split(/[\n\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const asins: string[] = [];
  const urlRegex = /amazon\.(de|it|fr|es|co\.uk|uk|nl|pl)\/[^]*?(?:dp|gp\/product)\/([A-Z0-9]{10})/i;
  for (const line of lines) {
    const m = line.match(urlRegex);
    if (m) {
      asins.push(m[2].toUpperCase());
    } else if (/^[A-Z0-9]{10}$/i.test(line)) {
      asins.push(line.toUpperCase());
    }
  }
  return [...new Set(asins)];
}

export function sortedMarkets(rows: MarketRow[] = []): MarketRow[] {
  return [...rows].sort((a, b) => {
    const aIdx = MARKET_ORDER.indexOf(String(a.market || '').toLowerCase());
    const bIdx = MARKET_ORDER.indexOf(String(b.market || '').toLowerCase());
    const ai = aIdx === -1 ? 999 : aIdx;
    const bi = bIdx === -1 ? 999 : bIdx;
    return ai - bi;
  });
}

export function normalizedRows(item: TrackingItem): MarketRow[] {
  const cpRows = Array.isArray(item.cardPreview?.marketRows) ? item.cardPreview?.marketRows || [] : [];
  if (cpRows.length) return sortedMarkets(cpRows);

  const map = new Map<string, MarketRow>();
  for (const [market, value] of Object.entries(item.pricesNew || {})) {
    const key = String(market || '').toLowerCase();
    map.set(key, {
      market: key,
      newPrice: Number.isFinite(Number(value)) ? Number(value) : null,
      usedPrice: null,
      trendPct: null,
    });
  }
  for (const [market, value] of Object.entries(item.pricesUsed || {})) {
    const key = String(market || '').toLowerCase();
    const entry = map.get(key) || {
      market: key,
      newPrice: null,
      usedPrice: null,
      trendPct: null,
    };
    entry.usedPrice = Number.isFinite(Number(value)) ? Number(value) : null;
    map.set(key, entry);
  }
  return sortedMarkets(Array.from(map.values()));
}

export function bestNewPrice(item: TrackingItem): number | null {
  const rows = normalizedRows(item).map((row) => Number(row.newPrice)).filter((price) => Number.isFinite(price) && price > 0);
  if (!rows.length) return null;
  return Math.min(...rows);
}

export function bestUsedPrice(item: TrackingItem): number | null {
  const rows = normalizedRows(item).map((row) => Number(row.usedPrice)).filter((price) => Number.isFinite(price) && price > 0);
  if (!rows.length) return null;
  return Math.min(...rows);
}

export function getBestDomain(item: TrackingItem): string {
  const fromPreview = String(item.cardPreview?.bestDomain || '').toLowerCase();
  if (fromPreview) return fromPreview;

  const rows = normalizedRows(item)
    .filter((row) => Number.isFinite(Number(row.newPrice)) && Number(row.newPrice) > 0)
    .sort((a, b) => Number(a.newPrice || 0) - Number(b.newPrice || 0));
  if (rows.length) return String(rows[0].market || 'de').toLowerCase();
  return 'de';
}

export function avgNewPrice(item: TrackingItem): number | null {
  const direct = Number(item.cardPreview?.avgPriceNew);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const values = normalizedRows(item)
    .map((row) => Number(row.newPrice))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function isSnoozed(item: TrackingItem): boolean {
  const active = Boolean(item?.snooze?.active);
  const untilTs = Date.parse(String(item?.snooze?.until || ''));
  if (active) return true;
  return Number.isFinite(untilTs) && untilTs > Date.now();
}

export function getSparkline(item: TrackingItem): { ts: string; value: number }[] {
  const points = Array.isArray(item?.cardPreview?.sparkline) ? item.cardPreview?.sparkline || [] : [];
  return points.slice(-60);
}

export function marketStrokeColor(marketRaw: string): string {
  const market = String(marketRaw || '').toLowerCase();
  const palette: Record<string, string> = {
    de: '#ff7a00',
    it: '#47c95f',
    fr: '#57a7ff',
    es: '#ff5a55',
    uk: '#f3c613',
    nl: '#79b4ff',
    pl: '#5bd3f2',
  };
  return palette[market] || '#ff7a00';
}
