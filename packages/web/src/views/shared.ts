import type { SparkPoint, TrackingItem, ProductDetail, DetailChartRow } from '../state/types.js';
import { state, MARKET_ORDER, DETAIL_CHART_ORDER } from '../state/index.js';
import { nodes } from '../utils/dom.js';
import { t } from '../utils/i18n.js';
import { escapeHtml, marketFlag, formatPrice, formatDateTime, currencyForDomain } from '../utils/formatters.js';
import { renderDetail } from './detail.js';

declare const Chart: any;

export function chartToken(points: SparkPoint[], prefix: string) {
  const first = Number(points[0]?.value || 0);
  const last = Number(points[points.length - 1]?.value || 0);
  const token = Math.abs(Math.round(first * 13 + last * 17 + points.length * 97)) % 1_000_000;
  return `${prefix}-${token}`;
}

export function sparklineSvg(points: SparkPoint[], stroke = '#ff7a00', domainRaw = 'de') {
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
    const x = values.length <= 1 ? left : left + (index / (values.length - 1)) * plotW;
    const y = bottom - ((value - min) / span) * plotH;
    return { x, y };
  });

  const linePath = pointsXY
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const areaPath = `${linePath} L${right} ${bottom} L${left} ${bottom} Z`;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const avgY = bottom - ((avg - min) / span) * plotH;
  const gridYs = [top, top + plotH * 0.25, top + plotH * 0.5, top + plotH * 0.75, bottom];
  const gridXs = [left, left + plotW * 0.25, left + plotW * 0.5, left + plotW * 0.75, right];
  const yTop = formatChartAxisPrice(max, domainRaw);
  const yMid = formatChartAxisPrice((max + min) / 2, domainRaw);
  const yLow = formatChartAxisPrice(min, domainRaw);

  const xTickA = formatChartLabelDate(points[0]?.ts ?? '');
  const xTickB = formatChartLabelDate(points[Math.floor((points.length - 1) / 2)]?.ts ?? '');
  const xTickC = formatChartLabelDate(points[points.length - 1]?.ts ?? '');
  const gid = chartToken(points, 'detail-chart');
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
    ${gridYs.map((y) => `<line x1="${left}" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}" stroke="rgba(255,255,255,.16)" stroke-width="1"/>`).join('')}
    ${gridXs.map((x) => `<line x1="${x.toFixed(2)}" y1="${top}" x2="${x.toFixed(2)}" y2="${bottom}" stroke="rgba(255,255,255,.11)" stroke-width="1"/>`).join('')}
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

export function formatChartLabelDate(value: string) {
  const ts = Date.parse(String(value || ''));
  if (!Number.isFinite(ts)) return '—';
  return new Intl.DateTimeFormat(state.lang, {
    day: 'numeric',
    month: 'short',
  }).format(new Date(ts));
}

export function formatChartAxisPrice(value: number, domainRaw: string) {
  if (!Number.isFinite(value)) return '—';
  const rounded = value >= 1000 ? Math.round(value) : Number(value.toFixed(2));
  const nf = new Intl.NumberFormat(state.lang === 'de' ? 'de-DE' : state.lang === 'en' ? 'en-US' : 'pl-PL', {
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  });
  return `${currencyForDomain(domainRaw)}${nf.format(rounded)}`;
}

export function cardHistorySvg(points: SparkPoint[], domainRaw: string) {
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
    const x = values.length <= 1 ? left : left + (index / (values.length - 1)) * plotW;
    const y = bottom - ((value - min) / span) * plotH;
    return { x, y };
  });

  const stepPath: string[] = [`M${xy[0].x.toFixed(2)} ${xy[0].y.toFixed(2)}`];
  for (let i = 1; i < xy.length; i += 1) {
    stepPath.push(`H${xy[i].x.toFixed(2)}`);
    stepPath.push(`V${xy[i].y.toFixed(2)}`);
  }
  const stepLine = stepPath.join(' ');
  const areaPath = `${stepLine} L${right} ${bottom} L${left} ${bottom} Z`;

  const avgY = bottom - ((avg - min) / span) * plotH;
  const xTickA = formatChartLabelDate(points[0]?.ts ?? '');
  const xTickB = formatChartLabelDate(points[Math.floor((points.length - 1) / 2)]?.ts ?? '');
  const xTickC = formatChartLabelDate(points[points.length - 1]?.ts ?? '');

  const yTop = formatChartAxisPrice(max, domainRaw);
  const yMid = formatChartAxisPrice((max + min) / 2, domainRaw);
  const yLow = formatChartAxisPrice(min, domainRaw);
  const gid = chartToken(points, 'card-chart');

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
    ${gridYs.map((y) => `<line x1="${left}" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}" stroke="rgba(255,255,255,.10)" stroke-width="1"/>`).join('')}
    ${gridXs.map((x) => `<line x1="${x.toFixed(2)}" y1="${top}" x2="${x.toFixed(2)}" y2="${bottom}" stroke="rgba(255,255,255,.07)" stroke-width="1"/>`).join('')}
    <line x1="${left}" y1="${avgY.toFixed(2)}" x2="${right}" y2="${avgY.toFixed(2)}" stroke="rgba(255,166,87,.62)" stroke-width="1.2" stroke-dasharray="4 4"/>
    <path d="${areaPath}" fill="url(#${gid}-fill)"/>
    <path d="${stepLine}" fill="none" stroke="#81a9ff" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${xy[xy.length - 1].x.toFixed(2)}" cy="${xy[xy.length - 1].y.toFixed(2)}" r="3.6" fill="${lastUp ? '#f85149' : '#3fb950'}"/>
    <text x="6" y="${(top + 4).toFixed(2)}" fill="rgba(242,246,250,.86)" font-size="9.5" font-family="Roboto, sans-serif">${escapeHtml(yTop)}</text>
    <text x="6" y="${(top + plotH * 0.5 + 4).toFixed(2)}" fill="rgba(242,246,250,.82)" font-size="9.5" font-family="Roboto, sans-serif">${escapeHtml(yMid)}</text>
    <text x="6" y="${(bottom + 4).toFixed(2)}" fill="rgba(242,246,250,.82)" font-size="9.5" font-family="Roboto, sans-serif">${escapeHtml(yLow)}</text>
    <text x="${left}" y="${h - 5}" fill="rgba(242,246,250,.9)" font-size="9.5" font-family="Roboto, sans-serif">${escapeHtml(xTickA)}</text>
    <text x="${(left + plotW * 0.5).toFixed(2)}" y="${h - 5}" fill="rgba(242,246,250,.9)" font-size="9.5" font-family="Roboto, sans-serif" text-anchor="middle">${escapeHtml(xTickB)}</text>
    <text x="${right}" y="${h - 5}" fill="rgba(242,246,250,.9)" font-size="9.5" font-family="Roboto, sans-serif" text-anchor="end">${escapeHtml(xTickC)}</text>
  </svg>`;
}

export function openAmazon(asinRaw: string, marketRaw: string) {
  const asin = String(asinRaw || '').trim().toUpperCase();
  if (!asin) return;
  const market = String(marketRaw || 'de').toLowerCase();

  const hostByMarket: Record<string, string> = {
    de: 'amazon.de',
    it: 'amazon.it',
    fr: 'amazon.fr',
    es: 'amazon.es',
    uk: 'amazon.co.uk',
    nl: 'amazon.nl',
    pl: 'amazon.pl',
  };

  const host = hostByMarket[market] || hostByMarket.de;
  window.open(`https://${host}/dp/${encodeURIComponent(asin)}`, '_blank', 'noopener,noreferrer');
}

export function applyCopy() {
  const copy = t();
  document.documentElement.lang = state.lang;

  if (nodes.searchInput) nodes.searchInput.placeholder = copy.searchPlaceholder;

  if (nodes.navLabels.tracking) nodes.navLabels.tracking.textContent = copy.nav.tracking;
  if (nodes.navLabels.deals) nodes.navLabels.deals.textContent = copy.nav.deals;
  if (nodes.navLabels.add) nodes.navLabels.add.textContent = copy.nav.add;
  if (nodes.navLabels.alerts) nodes.navLabels.alerts.textContent = copy.nav.alerts;
  if (nodes.navLabels.settings) nodes.navLabels.settings.textContent = copy.nav.settings;

  const dealsTitle = document.querySelector('#deals-title');
  const dealsDesc = document.querySelector('#deals-desc');
  const addTitle = document.querySelector('#add-title');
  const addDesc = document.querySelector('#add-desc');
  const alertsTitle = document.querySelector('#alerts-title');
  const alertsDesc = document.querySelector('#alerts-desc');
  const chatIdSave = document.querySelector('#chatIdSave');

  if (dealsTitle) dealsTitle.textContent = copy.dealsTitle;
  if (dealsDesc) dealsDesc.textContent = copy.dealsDesc;
  if (addTitle) addTitle.textContent = copy.addTitle;
  if (addDesc) addDesc.textContent = copy.addDesc;
  if (alertsTitle) alertsTitle.textContent = copy.alertsTitle;
  if (alertsDesc) alertsDesc.textContent = copy.alertsDesc;
  if (chatIdSave) chatIdSave.textContent = copy.setChatId;

  for (const button of nodes.langRow?.querySelectorAll('.mchip[data-lang]') || []) {
    const value = String((button as HTMLButtonElement).dataset.lang || '');
    button.classList.toggle('on', value === state.lang);
  }

  if (state.selectedAsin) {
    const selected = state.trackings.find((item) => String(item.asin).toUpperCase() === String(state.selectedAsin).toUpperCase());
    if (selected) renderDetail(selected);
  }
}

