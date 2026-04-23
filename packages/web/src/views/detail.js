import { state, DETAIL_MARKETS, DETAIL_CHART_ORDER, MARKET_ORDER } from '../state/index.js';
import { nodes } from '../utils/dom.js';
import { client } from '../services/instance.js';
import { t } from '../utils/i18n.js';
import { escapeHtml, marketFlag, formatPrice, formatDateTime, currencyForDomain, normalizedRows, bestNewPrice, bestUsedPrice, getBestDomain, avgNewPrice, isSnoozed, getSparkline, marketStrokeColor, toNullableNumber, } from '../utils/formatters.js';
import { loadTrackings, recommendationBadge } from './tracking.js';
import { log as telemetryLog } from '../utils/telemetry.js';
import { formatChartLabelDate, formatChartAxisPrice, chartToken } from './shared.js';
let detailChartInstance = null;
export function buildDetailChartRows(item, detail) {
    const rowsByKey = new Map();
    const raw = Array.isArray(detail?.historySeries) ? detail?.historySeries || [] : [];
    for (const point of raw) {
        const domain = String(point?.market || '').toLowerCase();
        const condition = String(point?.condition || 'new').toLowerCase();
        const recordedAt = String(point?.ts || '');
        const ts = Date.parse(recordedAt);
        const value = Number(point?.value);
        if (!domain || !Number.isFinite(ts) || !Number.isFinite(value) || value <= 0)
            continue;
        const key = `${domain}|${new Date(ts).toISOString()}`;
        if (!rowsByKey.has(key)) {
            rowsByKey.set(key, {
                domain,
                recorded_at: new Date(ts).toISOString(),
                price: null,
                price_used: null,
            });
        }
        const row = rowsByKey.get(key);
        if (condition === 'used')
            row.price_used = value;
        else
            row.price = value;
    }
    if (!rowsByKey.size) {
        const fallbackDomain = getBestDomain(item);
        for (const point of getSparkline(item)) {
            const ts = Date.parse(String(point.ts || ''));
            const value = Number(point.value);
            if (!Number.isFinite(ts) || !Number.isFinite(value) || value <= 0)
                continue;
            const key = `${fallbackDomain}|${new Date(ts).toISOString()}`;
            rowsByKey.set(key, {
                domain: fallbackDomain,
                recorded_at: new Date(ts).toISOString(),
                price: value,
                price_used: null,
            });
        }
    }
    const existingRows = [...rowsByKey.values()];
    const pricesByMarket = new Map(normalizedRows(item)
        .map((row) => [String(row.market || '').toLowerCase(), Number(row.newPrice)])
        .filter(([, price]) => Number.isFinite(price) && price > 0));
    const existingMarkets = new Set(existingRows.map((row) => String(row.domain || '').toLowerCase()));
    const referenceMarket = (DETAIL_CHART_ORDER.find((market) => existingMarkets.has(market)) || [...existingMarkets][0] || '');
    const referenceSeries = existingRows
        .filter((row) => String(row.domain || '').toLowerCase() === referenceMarket)
        .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
    const referenceLast = referenceSeries.length ? Number(referenceSeries[referenceSeries.length - 1].price) : null;
    const referencePrice = pricesByMarket.get(referenceMarket) ?? null;
    const safeReference = Number.isFinite(referenceLast) && Number(referenceLast) > 0
        ? Number(referenceLast)
        : Number.isFinite(referencePrice) && Number(referencePrice) > 0
            ? Number(referencePrice)
            : null;
    if (referenceSeries.length >= 2 && Number.isFinite(safeReference)) {
        for (const market of DETAIL_CHART_ORDER) {
            if (existingMarkets.has(market))
                continue;
            const marketPrice = pricesByMarket.get(market);
            if (!Number.isFinite(marketPrice) || Number(marketPrice) <= 0)
                continue;
            const ratio = Number(marketPrice) / Number(safeReference);
            for (const baseRow of referenceSeries) {
                const key = `${market}|${baseRow.recorded_at}`;
                rowsByKey.set(key, {
                    domain: market,
                    recorded_at: baseRow.recorded_at,
                    price: Number((Number(baseRow.price || 0) * ratio).toFixed(2)),
                    price_used: null,
                });
            }
        }
    }
    return [...rowsByKey.values()].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
}
export function applyDetailChartFilters(rows, selectedMarkets, rangeDays) {
    const selected = new Set(selectedMarkets.map((m) => String(m || '').toLowerCase()));
    let output = rows.filter((row) => selected.has(String(row.domain || '').toLowerCase()));
    if (rangeDays > 0 && output.length) {
        const newestTs = Math.max(...output.map((row) => Date.parse(row.recorded_at)).filter(Number.isFinite));
        const cut = newestTs - rangeDays * 86400000;
        output = output.filter((row) => Date.parse(row.recorded_at) >= cut);
    }
    return output;
}
export function getChartThemeColors() {
    const tick = getComputedStyle(document.documentElement).getPropertyValue('--t1').trim() || '#fff';
    const isLight = document.documentElement.classList.contains('light-theme');
    const grid = isLight ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.12)';
    const crosshair = isLight ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.3)';
    return { tick, grid, crosshair };
}
export function buildDetailChartDatasets(rows) {
    const datasets = [];
    const usedLabel = state.lang === 'en' ? 'Used' : state.lang === 'de' ? 'Gebraucht' : 'Używane';
    for (const domain of DETAIL_CHART_ORDER) {
        const domainRows = rows.filter((row) => row.domain === domain);
        if (!domainRows.length)
            continue;
        const newPts = domainRows
            .filter((row) => Number.isFinite(Number(row.price)) && Number(row.price) > 0)
            .map((row) => ({ x: Date.parse(row.recorded_at), y: Number(row.price) }));
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
                fill: false,
            });
        }
        const usedPts = domainRows
            .filter((row) => Number.isFinite(Number(row.price_used)) && Number(row.price_used) > 0)
            .map((row) => ({ x: Date.parse(row.recorded_at), y: Number(row.price_used) }));
        if (usedPts.length) {
            datasets.push({
                label: `${domain.toUpperCase()} ${usedLabel}`,
                data: usedPts,
                borderColor: marketStrokeColor(domain),
                backgroundColor: 'transparent',
                borderWidth: 1.1,
                borderDash: [6, 3],
                pointRadius: 1.1,
                pointHoverRadius: 3.6,
                stepped: true,
                tension: 0,
                fill: false,
            });
        }
    }
    return datasets;
}
export function computeDetailChartStats(rows) {
    const points = rows
        .map((row) => {
        const ts = Date.parse(row.recorded_at);
        const y = Number(row.price);
        return { ts, y, domain: String(row.domain || '').toLowerCase() };
    })
        .filter((point) => Number.isFinite(point.ts) && Number.isFinite(point.y) && point.y > 0)
        .sort((a, b) => a.ts - b.ts);
    if (!points.length)
        return null;
    const prices = points.map((point) => point.y);
    const avg = prices.reduce((acc, value) => acc + value, 0) / prices.length;
    const variance = prices.reduce((acc, value) => acc + (value - avg) ** 2, 0) / prices.length;
    const stdDev = Math.sqrt(Math.max(variance, 0));
    const minPoint = points.reduce((best, point) => (point.y < best.y ? point : best), points[0]);
    const maxPoint = points.reduce((best, point) => (point.y > best.y ? point : best), points[0]);
    const latestPoint = points.reduce((best, point) => (point.ts > best.ts ? point : best), points[0]);
    return {
        minPrice: minPoint.y,
        maxPrice: maxPoint.y,
        avgPrice: avg,
        volatilityPct: avg > 0 ? (stdDev / avg) * 100 : 0,
        minPoint,
        maxPoint,
        latestPoint,
        daysSinceLow: Math.max(0, Math.round((latestPoint.ts - minPoint.ts) / 864e5)),
    };
}
export function destroyDetailChart() {
    if (detailChartInstance && typeof detailChartInstance.destroy === 'function') {
        detailChartInstance.destroy();
    }
    detailChartInstance = null;
}
export function renderDetailChartCanvas(filteredRows) {
    const canvas = document.getElementById('mainChart');
    if (!canvas || typeof Chart === 'undefined')
        return;
    destroyDetailChart();
    const datasets = buildDetailChartDatasets(filteredRows);
    const colors = getChartThemeColors();
    detailChartInstance = new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'bottom',
                    align: 'start',
                    labels: {
                        color: colors.tick,
                        font: { size: 11, weight: '700' },
                        usePointStyle: true,
                        pointStyleWidth: 12,
                        padding: 8,
                        boxWidth: 12,
                        boxHeight: 12,
                    },
                },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,.9)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: '#30363d',
                    borderWidth: 1,
                    padding: 8,
                    titleFont: { size: 11, weight: '700' },
                    bodyFont: { size: 10, weight: '600' },
                    displayColors: true,
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    grid: { color: colors.grid },
                    ticks: {
                        color: colors.tick,
                        maxTicksLimit: 7,
                        font: { size: 11 },
                        callback: (value) => {
                            const ts = Number(value);
                            if (!Number.isFinite(ts))
                                return '';
                            return formatChartLabelDate(new Date(ts).toISOString());
                        },
                    },
                },
                y: {
                    beginAtZero: false,
                    grid: { color: colors.grid },
                    ticks: {
                        color: colors.tick,
                        font: { size: 11 },
                        callback: (value) => {
                            const num = Number(value);
                            if (!Number.isFinite(num))
                                return '';
                            return new Intl.NumberFormat(state.lang === 'de' ? 'de-DE' : state.lang === 'en' ? 'en-US' : 'pl-PL', {
                                maximumFractionDigits: 0,
                            }).format(num);
                        },
                    },
                },
            },
        },
    });
}
export function normalizeDetailHistorySeries(item, detail) {
    const fromDetail = Array.isArray(detail?.historySeries) ? detail?.historySeries || [] : [];
    const byMarket = new Map();
    for (const row of fromDetail) {
        const market = String(row?.market || '').toLowerCase();
        const condition = String(row?.condition || 'new').toLowerCase();
        if (!market || condition !== 'new')
            continue;
        const value = Number(row?.value);
        const ts = String(row?.ts || '');
        const tsMs = Date.parse(ts);
        if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(tsMs))
            continue;
        if (!byMarket.has(market))
            byMarket.set(market, []);
        byMarket.get(market)?.push({ ts, tsMs, value });
    }
    if (!byMarket.size) {
        const fallbackMarket = getBestDomain(item);
        const fallback = getSparkline(item)
            .map((point) => {
            const value = Number(point.value);
            const ts = String(point.ts || '');
            const tsMs = Date.parse(ts);
            if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(tsMs))
                return null;
            return { ts, tsMs, value };
        })
            .filter(Boolean);
        if (fallback.length)
            byMarket.set(fallbackMarket, fallback);
    }
    for (const [market, points] of byMarket) {
        points.sort((a, b) => a.tsMs - b.tsMs);
        const deduped = [];
        for (const point of points) {
            const previous = deduped[deduped.length - 1];
            if (previous && previous.tsMs === point.tsMs) {
                deduped[deduped.length - 1] = point;
            }
            else {
                deduped.push(point);
            }
        }
        byMarket.set(market, deduped);
    }
    const pricedMarkets = normalizedRows(item)
        .map((row) => ({
        market: String(row.market || '').toLowerCase(),
        price: Number(row.newPrice),
    }))
        .filter((row) => row.market && Number.isFinite(row.price) && row.price > 0);
    const referenceMarket = (pricedMarkets.find((row) => byMarket.has(row.market))?.market || byMarket.keys().next().value || '');
    const referenceSeries = referenceMarket ? byMarket.get(referenceMarket) || [] : [];
    const referenceLast = referenceSeries.length ? Number(referenceSeries[referenceSeries.length - 1].value) : null;
    const referencePrice = pricedMarkets.find((row) => row.market === referenceMarket)?.price ?? null;
    const safeRef = Number.isFinite(referenceLast) && Number(referenceLast) > 0
        ? Number(referenceLast)
        : Number.isFinite(referencePrice) && Number(referencePrice) > 0
            ? Number(referencePrice)
            : null;
    if (referenceSeries.length >= 2 && Number.isFinite(safeRef)) {
        for (const row of pricedMarkets) {
            if (byMarket.has(row.market))
                continue;
            const ratio = Number(row.price) / Number(safeRef);
            const synthetic = referenceSeries.map((point) => ({
                ts: point.ts,
                tsMs: point.tsMs,
                value: Number((point.value * ratio).toFixed(2)),
            }));
            byMarket.set(row.market, synthetic);
        }
    }
    return byMarket;
}
export function getDetailChartMarkets(asinRaw, defaultMarkets, bestDomainRaw) {
    const asin = String(asinRaw || '').toUpperCase();
    const bestDomain = String(bestDomainRaw || '').toLowerCase();
    const saved = Array.isArray(state.detailChartMarketsByAsin[asin]) ? state.detailChartMarketsByAsin[asin] : [];
    const savedUnique = [...new Set(saved.map((market) => String(market || '').toLowerCase()).filter(Boolean))];
    if (savedUnique.length)
        return savedUnique;
    const defaults = [...new Set(defaultMarkets.map((market) => String(market || '').toLowerCase()).filter(Boolean))];
    if (defaults.length)
        return defaults;
    return bestDomain ? [bestDomain] : ['de'];
}
export function detailChartSvg(seriesByMarket, selectedMarkets, rangeDays, bestDomainRaw) {
    const selected = selectedMarkets.filter((market) => seriesByMarket.has(market));
    if (!selected.length) {
        return {
            svg: '<svg viewBox="0 0 320 180" preserveAspectRatio="none"><rect x="0.5" y="0.5" width="319" height="179" fill="#07090d" stroke="rgba(255,255,255,.18)"/></svg>',
            stats: { min: null, max: null, avg: null, vol: null, sinceMinDays: null },
            activeMarkets: selected,
            xTicks: [],
        };
    }
    const sourcePoints = selected.flatMap((market) => seriesByMarket.get(market) || []);
    const newestTs = sourcePoints.length ? Math.max(...sourcePoints.map((point) => point.tsMs)) : Date.now();
    const minAllowedTs = rangeDays > 0 ? newestTs - rangeDays * 24 * 60 * 60 * 1000 : Number.NEGATIVE_INFINITY;
    const filtered = selected
        .map((market) => {
        const points = (seriesByMarket.get(market) || []).filter((point) => point.tsMs >= minAllowedTs);
        return [market, points];
    })
        .filter(([, points]) => points.length >= 2);
    if (!filtered.length) {
        return {
            svg: '<svg viewBox="0 0 320 180" preserveAspectRatio="none"><rect x="0.5" y="0.5" width="319" height="179" fill="#07090d" stroke="rgba(255,255,255,.18)"/></svg>',
            stats: { min: null, max: null, avg: null, vol: null, sinceMinDays: null },
            activeMarkets: selected,
            xTicks: [],
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
    const toX = (tsMs) => left + ((tsMs - minTs) / spanTs) * plotW;
    const toY = (value) => bottom - ((value - minValue) / spanValue) * plotH;
    const seriesPaths = filtered
        .map(([market, points]) => {
        const xy = points.map((point) => ({ x: toX(point.tsMs), y: toY(point.value), ts: point.ts, value: point.value }));
        if (xy.length < 2)
            return '';
        const pathParts = [`M${xy[0].x.toFixed(2)} ${xy[0].y.toFixed(2)}`];
        for (let index = 1; index < xy.length; index += 1) {
            pathParts.push(`H${xy[index].x.toFixed(2)}`);
            pathParts.push(`V${xy[index].y.toFixed(2)}`);
        }
        const line = pathParts.join(' ');
        const last = xy[xy.length - 1];
        return `<path d="${line}" fill="none" stroke="${marketStrokeColor(market)}" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="2.2" fill="${marketStrokeColor(market)}"/>`;
    })
        .join('');
    const bestDomain = String(bestDomainRaw || '').toLowerCase();
    const statMarket = selected.includes(bestDomain) ? bestDomain : selected[0];
    const statPoints = filtered.find(([market]) => market === statMarket)?.[1] || filtered[0]?.[1] || [];
    const statValues = statPoints.map((point) => point.value);
    const statMin = statValues.length ? Math.min(...statValues) : null;
    const statMax = statValues.length ? Math.max(...statValues) : null;
    const statAvg = statValues.length ? statValues.reduce((sum, value) => sum + value, 0) / statValues.length : null;
    const statVol = Number.isFinite(Number(statMin)) && Number.isFinite(Number(statMax)) && Number.isFinite(Number(statAvg)) && Number(statAvg) > 0
        ? Math.round(((Number(statMax) - Number(statMin)) / Number(statAvg)) * 100)
        : null;
    const minTimestamp = statPoints
        .filter((point) => Number.isFinite(Number(statMin)) && point.value === Number(statMin))
        .map((point) => point.tsMs)
        .at(-1);
    const sinceMinDays = Number.isFinite(minTimestamp) ? Math.max(0, Math.floor((newestTs - Number(minTimestamp)) / (24 * 60 * 60 * 1000))) : null;
    const avgY = Number.isFinite(Number(statAvg)) ? toY(Number(statAvg)) : bottom;
    const yTop = formatChartAxisPrice(maxValue, statMarket || bestDomain);
    const yMid = formatChartAxisPrice((maxValue + minValue) / 2, statMarket || bestDomain);
    const yLow = formatChartAxisPrice(minValue, statMarket || bestDomain);
    const xTickA = formatChartLabelDate(new Date(minTs).toISOString());
    const xTickB = formatChartLabelDate(new Date(minTs + spanTs * 0.5).toISOString());
    const xTickC = formatChartLabelDate(new Date(maxTs).toISOString());
    const gid = chartToken(allPoints.map((point) => ({ ts: point.ts, value: point.value })), 'detail-multi-chart');
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
    ${gridYs.map((y) => `<line x1="${left}" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}" stroke="rgba(255,255,255,.16)" stroke-width="1"/>`).join('')}
    ${gridXs.map((x) => `<line x1="${x.toFixed(2)}" y1="${top}" x2="${x.toFixed(2)}" y2="${bottom}" stroke="rgba(255,255,255,.11)" stroke-width="1"/>`).join('')}
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
        xTicks: [xTickA, xTickB, xTickC],
    };
}
export function renderPriceRows(rows, type, asin) {
    if (!rows.length)
        return `<div class="detail-overview-value">${escapeHtml(t().noData)}</div>`;
    return rows
        .map(([market, value]) => `<div class="ptable-row">
        <div class="ptable-cell ptable-cell-link" data-action="open-market" data-asin="${escapeHtml(asin)}" data-market="${escapeHtml(market)}" role="button" tabindex="0">
          <span class="flag-round">${marketFlag(market)}</span>
          <span>${escapeHtml(market.toUpperCase())}</span>
        </div>
        <div class="ptable-cell ${type === 'new' ? 'ptable-cell-new' : 'ptable-cell-used'}">${escapeHtml(formatPrice(value, market))}</div>
        <div class="ptable-cell"></div>
      </div>`)
        .join('');
}
export function renderMarketCompare(rowsSource, asin, mode = 'new') {
    if (!rowsSource.length) {
        return `<div class="competitor-row"><span class="competitor-gap">Brak cen dla wybranych rynków</span></div>`;
    }
    const rowsSorted = [...rowsSource].sort((a, b) => a[1] - b[1]);
    const best = rowsSorted[0][1];
    const worst = rowsSorted[rowsSorted.length - 1][1];
    const range = worst - best;
    return rowsSorted
        .map(([domain, price], idx) => {
        const pct = range > 0 ? ((price - best) / range) * 100 : 0;
        const savings = price - best;
        const isBest = idx === 0;
        const isWorst = idx === rowsSorted.length - 1;
        const cls = isBest ? 'competitor-best' : isWorst ? 'competitor-worst' : '';
        const cur = currencyForDomain(domain);
        const markerHtml = isBest
            ? `<span class="competitor-rank-badge best" title="Najlepsza cena"><span class="material-icons-round">arrow_downward</span></span>`
            : `<span class="competitor-meta">${isWorst ? `<span class="competitor-rank-badge worst" title="Najgorsza cena"><span class="material-icons-round">arrow_upward</span></span>` : ''}<span class="competitor-gap${isWorst ? ' worst' : ''}">+${cur}${savings.toFixed(2)}</span></span>`;
        return `<div class="competitor-row" data-action="open-market" data-asin="${escapeHtml(asin)}" data-market="${escapeHtml(domain)}">
        <span class="competitor-flag flag-round">${marketFlag(domain)}</span>
        <span style="flex:0 0 70px;font-size:12px">${escapeHtml(domain.toUpperCase())}</span>
        <div class="competitor-bar"><div class="competitor-bar-fill" style="width:${100 - pct}%"></div></div>
        <span class="competitor-price ${cls}${mode === 'used' ? ' ptable-cell-used' : ''}">${escapeHtml(cur)}${escapeHtml(price.toFixed(2))}</span>
        ${markerHtml}
      </div>`;
    })
        .join('');
}
export function getSelectedTrackingItem() {
    const asin = String(state.selectedAsin || '').toUpperCase();
    if (!asin)
        return null;
    return state.trackings.find((item) => String(item.asin || '').toUpperCase() === asin) || null;
}
export async function hydrateDetail(asinRaw) {
    const asin = String(asinRaw || '').trim().toUpperCase();
    if (!asin)
        return null;
    if (state.detailByAsin[asin])
        return state.detailByAsin[asin];
    try {
        const detail = (await client.getProductDetail(asin));
        state.detailByAsin[asin] = detail;
        return detail;
    }
    catch {
        return null;
    }
}
export function rerenderSelectedDetail() {
    const selected = getSelectedTrackingItem();
    if (!selected)
        return;
    renderDetail(selected);
}
export function normalizeThresholdPercent(value) {
    const raw = toNullableNumber(value);
    if (raw === null)
        return null;
    if (Math.abs(raw) > 100)
        return Number((raw / 100).toFixed(2));
    return raw;
}
export function normalizeThresholdTargetPrice(value) {
    const raw = toNullableNumber(value);
    if (raw === null)
        return null;
    if (Math.abs(raw) >= 100000)
        return Number((raw / 10000).toFixed(2));
    return raw;
}
export function formatPct(value) {
    if (!Number.isFinite(Number(value)))
        return '—';
    const num = Number(value);
    return Number.isInteger(num) ? `${num}` : `${num.toFixed(2)}`;
}
export function renderDetail(item) {
    if (!nodes.detailContent)
        return;
    const copy = t();
    const asin = String(item.asin || '').toUpperCase();
    const detail = state.detailByAsin[asin] || null;
    const bestDomain = getBestDomain(item);
    const bestNew = bestNewPrice(item);
    const bestUsed = bestUsedPrice(item);
    const avgNew = avgNewPrice(item);
    const delta = Number(item.cardPreview?.deltaPctVsAvg);
    const rows = normalizedRows(item);
    const newRows = rows
        .map((row) => [String(row.market || '').toLowerCase(), Number(row.newPrice)])
        .filter(([, value]) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a[1] - b[1]);
    const usedRows = rows
        .map((row) => [String(row.market || '').toLowerCase(), Number(row.usedPrice)])
        .filter(([, value]) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a[1] - b[1]);
    const image = String(item.cardPreview?.imageUrl || item.imageUrl || '').trim();
    const detailChartRows = buildDetailChartRows(item, detail);
    const marketRows = normalizedRows(item);
    const defaultChartMarkets = DETAIL_MARKETS.filter((market) => marketRows.some((row) => {
        const domain = String(row.market || '').toLowerCase();
        if (domain !== market)
            return false;
        const newPrice = Number(row.newPrice);
        const usedPrice = Number(row.usedPrice);
        return (Number.isFinite(newPrice) && newPrice > 0) || (Number.isFinite(usedPrice) && usedPrice > 0);
    }));
    const selectedChartMarkets = getDetailChartMarkets(asin, defaultChartMarkets, bestDomain);
    state.detailChartMarketsByAsin[asin] = selectedChartMarkets;
    const filteredChartRows = applyDetailChartFilters(detailChartRows, selectedChartMarkets, state.detailChartRangeDays);
    const detailChartStats = computeDetailChartStats(filteredChartRows);
    const minNew = Number.isFinite(Number(detailChartStats?.minPrice))
        ? Number(detailChartStats?.minPrice)
        : newRows.length
            ? Math.min(...newRows.map((row) => row[1]))
            : null;
    const maxNew = Number.isFinite(Number(detailChartStats?.maxPrice))
        ? Number(detailChartStats?.maxPrice)
        : newRows.length
            ? Math.max(...newRows.map((row) => row[1]))
            : null;
    const avgForKpi = Number.isFinite(Number(detailChartStats?.avgPrice)) ? Number(detailChartStats?.avgPrice) : avgNew;
    const vol = Number.isFinite(Number(detailChartStats?.volatilityPct))
        ? Math.round(Number(detailChartStats?.volatilityPct))
        : Number.isFinite(Number(minNew)) && Number.isFinite(Number(maxNew)) && Number.isFinite(Number(avgForKpi)) && Number(avgForKpi) > 0
            ? Math.round(((Number(maxNew) - Number(minNew)) / Number(avgForKpi)) * 100)
            : null;
    const kpiMin = minNew !== null ? formatPrice(minNew, bestDomain) : '—';
    const kpiMax = maxNew !== null ? formatPrice(maxNew, bestDomain) : '—';
    const kpiAvg = avgForKpi !== null ? formatPrice(avgForKpi, bestDomain) : '—';
    const kpiVol = vol !== null ? `${vol}%` : '—';
    const sinceLow = Number.isFinite(Number(detailChartStats?.daysSinceLow)) ? `${Number(detailChartStats?.daysSinceLow)} d` : '—';
    const thresholdDropPct = normalizeThresholdPercent(item.thresholdDropPct ?? 15);
    const thresholdRisePct = normalizeThresholdPercent(item.thresholdRisePct ?? 15);
    const targetPriceNew = normalizeThresholdTargetPrice(item.targetPriceNew ?? item.targetNew);
    const targetPriceUsed = normalizeThresholdTargetPrice(item.targetPriceUsed ?? item.targetUsed);
    const hasNumericThreshold = (Number.isFinite(Number(thresholdDropPct)) && Number(thresholdDropPct) > 0) ||
        (Number.isFinite(Number(thresholdRisePct)) && Number(thresholdRisePct) > 0) ||
        (Number.isFinite(Number(targetPriceNew)) && Number(targetPriceNew) > 0) ||
        (Number.isFinite(Number(targetPriceUsed)) && Number(targetPriceUsed) > 0);
    const alertsKind = isSnoozed(item) ? copy.summaryTrackingPaused : copy.summaryTrackingActive;
    const alertsThreshold = hasNumericThreshold
        ? [
            Number.isFinite(Number(thresholdDropPct)) && Number(thresholdDropPct) > 0 ? `drop ${formatPct(thresholdDropPct)}%` : '',
            Number.isFinite(Number(thresholdRisePct)) && Number(thresholdRisePct) > 0 ? `rise ${formatPct(thresholdRisePct)}%` : '',
            Number.isFinite(Number(targetPriceNew)) && Number(targetPriceNew) > 0 ? `new ${formatPrice(targetPriceNew, bestDomain)}` : '',
            Number.isFinite(Number(targetPriceUsed)) && Number(targetPriceUsed) > 0 ? `used ${formatPrice(targetPriceUsed, bestDomain)}` : '',
        ]
            .filter(Boolean)
            .join(' · ')
        : copy.summaryNoThresholds;
    const availabilityText = item.cardPreview?.outOfStock
        ? (state.lang === 'en' ? 'Out of stock' : state.lang === 'de' ? 'Nicht auf Lager' : 'Brak w magazynie')
        : (state.lang === 'en' ? 'Available' : state.lang === 'de' ? 'Verfügbar' : 'Dostępny');
    const trackedSince = formatDateTime(item.createdAt || detail?.updatedAt || item.updatedAt);
    const reco = recommendationBadge(item);
    const ratingRaw = Number(item.cardPreview?.rating);
    const rating = Number.isFinite(ratingRaw) ? Math.max(0, Math.min(5, ratingRaw)) : 0;
    const stars = '★'.repeat(Math.floor(rating));
    nodes.detailContent.innerHTML = `<div class="dhdr">
    <div class="dhdr-img"><span class="dhdr-img-fallback material-icons-round" aria-hidden="true">inventory_2</span>${image
        ? `<img id="d-img" src="${escapeHtml(image)}" alt="${escapeHtml(item.title || asin)}" loading="lazy" />`
        : '<img id="d-img" alt="" style="display:none" />'}</div>
    <div class="dhdr-info">
      <div class="dhdr-title" id="d-title">${escapeHtml(item.title || asin)}</div>
      <div class="pcard-meta">${escapeHtml(asin)}</div>
      <div class="detail-rating-row">
        <span class="stars" id="d-stars">${stars}</span>
        <span class="detail-rating-text" id="d-rating">${rating > 0 ? `(${rating.toFixed(1)})` : '(0.0)'}</span>
      </div>
    </div>
    <div class="detail-price-row">
      <span class="pflag" id="d-flag">${marketFlag(bestDomain)}</span>
      <div class="dhdr-price" id="d-price">${escapeHtml(formatPrice(bestNew, bestDomain))}</div>
      <div id="d-reco" class="detail-reco detail-reco-inline">${reco}</div>
      <div class="dhdr-change ${Number.isFinite(delta) && delta > 0 ? 'up' : 'dn'}" id="d-change">${Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%` : '—'}</div>
    </div>
  </div>

  <button class="buy-btn" id="buyNowBtn" type="button" data-action="open-best" data-asin="${escapeHtml(asin)}" data-market="${escapeHtml(bestDomain)}">
    <span class="material-icons-round buy-icon">shopping_cart</span>
    <span id="buyNowText">${escapeHtml(copy.buyNow)} — ${escapeHtml(formatPrice(bestNew, bestDomain))} ${escapeHtml(copy.buyNowAt)} ${escapeHtml(bestDomain.toUpperCase())}</span>
  </button>

  <div class="chart-wrap">
    <div class="detail-section-title"><span class="material-icons-round">show_chart</span><span>${escapeHtml(copy.chartHistory)}</span></div>
    <div class="chart-box"><canvas id="mainChart" aria-label="Price history chart"></canvas></div>
    <div class="chart-kpis" id="chartStats">
      <div class="chart-kpi"><span class="chart-kpi-label">Min</span><strong class="chart-kpi-value" id="chartStatMin">${escapeHtml(kpiMin)}</strong></div>
      <div class="chart-kpi"><span class="chart-kpi-label">Max</span><strong class="chart-kpi-value" id="chartStatMax">${escapeHtml(kpiMax)}</strong></div>
      <div class="chart-kpi"><span class="chart-kpi-label">Śr.</span><strong class="chart-kpi-value" id="chartStatAvg">${escapeHtml(kpiAvg)}</strong></div>
      <div class="chart-kpi"><span class="chart-kpi-label">Zmienność</span><strong class="chart-kpi-value" id="chartStatVol">${escapeHtml(kpiVol)}</strong></div>
      <div class="chart-kpi"><span class="chart-kpi-label">Od minimum</span><strong class="chart-kpi-value" id="chartStatSinceLow">${escapeHtml(sinceLow)}</strong></div>
    </div>
    <div class="trange" id="timeRange">
      <div data-r="1" class="${state.detailChartRangeDays === 1 ? 'on' : ''}">1D</div>
      <div data-r="7" class="${state.detailChartRangeDays === 7 ? 'on' : ''}">1W</div>
      <div data-r="30" class="${state.detailChartRangeDays === 30 ? 'on' : ''}">1M</div>
      <div data-r="90" class="${state.detailChartRangeDays === 90 ? 'on' : ''}">3M</div>
      <div data-r="180" class="${state.detailChartRangeDays === 180 ? 'on' : ''}">6M</div>
      <div data-r="365" class="${state.detailChartRangeDays === 365 ? 'on' : ''}">1Y</div>
      <div data-r="1095" class="${state.detailChartRangeDays === 1095 ? 'on' : ''}">3Y</div>
      <div data-r="0" class="${state.detailChartRangeDays === 0 ? 'on' : ''}">ALL</div>
    </div>
    <div class="market-toggle-bar" id="chartMarkets">
      ${DETAIL_MARKETS.map((market) => `<div class="mchip ${selectedChartMarkets.includes(market) ? 'on' : ''}" data-action="toggle-chart-market" data-dom="${market}" role="button" tabindex="0"><span class="flag-round">${marketFlag(market)}</span><span>${market.toUpperCase()}</span></div>`).join('')}
    </div>
  </div>
  <div id="competitorCard" class="detail-aux-gap-10">
    <div class="competitor-card">
      <div class="competitor-title"><span class="material-icons-round ui-icon-inline">compare_arrows</span>Porównanie między rynkami</div>
      ${renderMarketCompare(newRows, asin, 'new')}
      <div class="competitor-title" style="margin-top:10px"><span class="material-icons-round ui-icon-inline">autorenew</span>Ceny używane</div>
      ${renderMarketCompare(usedRows, asin, 'used')}
    </div>
  </div>

  <div class="dtabs" id="detailTabs">
    <div class="dtab ${state.detailTab === 'overview' ? 'on' : ''}" data-dt="overview"><span class="material-icons-round">grid_view</span><span>${escapeHtml(copy.overview)}</span></div>
    <div class="dtab ${state.detailTab === 'settings' ? 'on' : ''}" data-dt="settings"><span class="material-icons-round">tune</span><span>${escapeHtml(copy.settingsTab)}</span></div>
  </div>

  <div class="dtpanel ${state.detailTab === 'overview' ? 'on' : ''}" id="dt-overview">
    <div id="buyboxIndicator" class="detail-aux-gap-10"></div>
    <div id="bestTimeToBuy" class="detail-aux-gap-10"></div>

    <div class="detail-overview-list detail-aux-gap-12">
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryCurrent)}</div><div class="detail-overview-value" id="s-cur">${escapeHtml(formatPrice(bestNew, bestDomain))}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryAvg)}</div><div class="detail-overview-value" id="s-avg">${escapeHtml(avgNew !== null ? formatPrice(avgNew, bestDomain) : '—')}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryLow)}</div><div class="detail-overview-value" id="s-low">${escapeHtml(kpiMin)}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryHigh)}</div><div class="detail-overview-value" id="s-high">${escapeHtml(kpiMax)}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryDrop30)}</div><div class="detail-overview-value" id="s-drop30">${Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%` : '—'}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryAvailability)}</div><div class="detail-overview-value" id="s-avail">${escapeHtml(availabilityText)}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryAsin)}</div><div class="detail-overview-value" id="s-asin">${escapeHtml(asin)}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryUpdated)}</div><div class="detail-overview-value" id="s-updates">${escapeHtml(formatDateTime(item.updatedAt))}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summarySince)}</div><div class="detail-overview-value" id="s-since">${escapeHtml(trackedSince)}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryAlertsKind)}</div><div class="detail-overview-value detail-overview-wrap" id="s-alerts-kind">${escapeHtml(alertsKind)}</div></div>
      <div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(copy.summaryThresholds)}</div><div class="detail-overview-value detail-overview-wrap" id="s-alerts-threshold">${escapeHtml(alertsThreshold)}</div></div>
    </div>
  </div>

  <div class="dtpanel ${state.detailTab === 'settings' ? 'on' : ''}" id="dt-settings">
    <div class="add-quick-preview" style="margin-top:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t2);">Alerty aktywne</div>
          <div style="font-size:13px;margin-top:4px;">Buy Box, Amazon, New · Spadek, Magazyn (brak/powrót)</div>
        </div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding:0 4px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t2);">Progi alertów</div>
      <div style="font-size:13px;font-weight:700;">Spadek ${escapeHtml(String(thresholdDropPct ?? 10))}%</div>
    </div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t2);margin-top:14px;padding:0 4px;">Aktywne rynki</div>
    <div class="market-toggle-bar" style="margin-top:6px;" id="d-domains">
      ${MARKET_ORDER.map((m) => `<div class="domtoggle on" data-d="${escapeHtml(m)}" data-action="toggle-detail-market"><span class="flag-round" aria-hidden="true">${marketFlag(m)}</span><span>${escapeHtml(m.toUpperCase())}</span></div>`).join('')}
    </div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t2);margin-top:14px;padding:0 4px;">Alerty cenowe</div>
    <div style="font-size:10px;color:var(--t2);margin-top:2px;padding:0 4px;">Profil 1-tap</div>
    <div class="market-toggle-bar" style="margin-top:6px;flex-wrap:wrap;" id="d-profiles">
      <button class="deal-chip" type="button" data-action="set-detail-profile" data-profile="safe">Bezpieczny</button>
      <button class="deal-chip on" type="button" data-action="set-detail-profile" data-profile="standard">Standard</button>
      <button class="deal-chip" type="button" data-action="set-detail-profile" data-profile="aggressive">Agresywny</button>
    </div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t2);margin-top:14px;padding:0 4px;">Typ ceny</div>
    <div class="market-toggle-bar" style="margin-top:6px;flex-wrap:wrap;" id="d-price-types">
      <button class="deal-chip on" type="button" data-action="set-detail-price-type" data-pt="buybox">Buy Box</button>
      <button class="deal-chip" type="button" data-action="set-detail-price-type" data-pt="amazon">Amazon</button>
      <button class="deal-chip" type="button" data-action="set-detail-price-type" data-pt="new">New</button>
      <button class="deal-chip" type="button" data-action="set-detail-price-type" data-pt="buybox_used">Buy Box Used</button>
      <button class="deal-chip" type="button" data-action="set-detail-price-type" data-pt="used">Used</button>
    </div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t2);margin-top:14px;padding:0 4px;">Typ śledzenia</div>
    <div class="market-toggle-bar" style="margin-top:6px;" id="d-track-modes">
      <button class="deal-chip on" type="button" data-action="set-detail-track-mode" data-mode="drop">Spadek</button>
      <button class="deal-chip" type="button" data-action="set-detail-track-mode" data-mode="rise">Wzrost</button>
    </div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t2);margin-top:14px;padding:0 4px;">Szybki próg spadku</div>
    <div class="market-toggle-bar" style="margin-top:6px;flex-wrap:wrap;" id="dDropPresetChips">
      <button class="deal-chip ${(thresholdDropPct ?? 10) === 5 ? 'on' : ''}" type="button" data-action="set-detail-drop-preset" data-preset="5">5%</button>
      <button class="deal-chip ${(thresholdDropPct ?? 10) === 10 ? 'on' : ''}" type="button" data-action="set-detail-drop-preset" data-preset="10">10%</button>
      <button class="deal-chip ${(thresholdDropPct ?? 10) === 15 ? 'on' : ''}" type="button" data-action="set-detail-drop-preset" data-preset="15">15%</button>
      <button class="deal-chip ${(thresholdDropPct ?? 10) === 20 ? 'on' : ''}" type="button" data-action="set-detail-drop-preset" data-preset="20">20%</button>
      <button class="deal-chip ${(thresholdDropPct ?? 10) === 25 ? 'on' : ''}" type="button" data-action="set-detail-drop-preset" data-preset="25">25%</button>
      <button class="deal-chip" type="button" data-action="set-detail-drop-preset" data-preset="any">Jakikolwiek spadek</button>
    </div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t2);margin-top:14px;padding:0 4px;">Szybki próg wzrostu</div>
    <div class="market-toggle-bar" style="margin-top:6px;flex-wrap:wrap;" id="dRisePresetChips">
      <button class="deal-chip ${(thresholdRisePct ?? 10) === 5 ? 'on' : ''}" type="button" data-action="set-detail-rise-preset" data-preset="5">5%</button>
      <button class="deal-chip ${(thresholdRisePct ?? 10) === 10 ? 'on' : ''}" type="button" data-action="set-detail-rise-preset" data-preset="10">10%</button>
      <button class="deal-chip ${(thresholdRisePct ?? 10) === 15 ? 'on' : ''}" type="button" data-action="set-detail-rise-preset" data-preset="15">15%</button>
      <button class="deal-chip ${(thresholdRisePct ?? 10) === 20 ? 'on' : ''}" type="button" data-action="set-detail-rise-preset" data-preset="20">20%</button>
      <button class="deal-chip ${(thresholdRisePct ?? 10) === 25 ? 'on' : ''}" type="button" data-action="set-detail-rise-preset" data-preset="25">25%</button>
      <button class="deal-chip" type="button" data-action="set-detail-rise-preset" data-preset="any">Jakikolwiek wzrost</button>
    </div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t2);margin-top:14px;padding:0 4px;">Dodatkowe alerty</div>
    <div class="market-toggle-bar" style="margin-top:6px;flex-wrap:wrap;" id="d-stock-alerts">
      <button class="deal-chip on" type="button" data-action="toggle-detail-stock-alert">Brak w magazynie</button>
      <button class="deal-chip on" type="button" data-action="toggle-detail-back-alert">Ponownie dostępne</button>
    </div>
    <div class="add-quick-preview" style="margin-top:14px;">
      <div style="font-size:14px;font-weight:700;">Cena docelowa (nowa)</div>
      <div style="font-size:12px;color:var(--t2);margin-top:4px;">Powiadom, gdy nowa cena spadnie poniżej progu</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
        <span style="font-size:16px;">${escapeHtml(currencyForDomain(bestDomain))}</span>
        <input id="d-target-new" class="sinput" type="number" inputmode="decimal" step="0.01" min="0" value="${escapeHtml(String(targetPriceNew ?? '0.00'))}" style="flex:1;font-size:16px;text-align:right;" />
      </div>
    </div>
    <div class="add-quick-preview" style="margin-top:10px;">
      <div style="font-size:14px;font-weight:700;">Cena docelowa (używane/magazyn)</div>
      <div style="font-size:12px;color:var(--t2);margin-top:4px;">Powiadom, gdy cena używana/magazynowa spadnie poniżej progu</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
        <span style="font-size:16px;">${escapeHtml(currencyForDomain(bestDomain))}</span>
        <input id="d-target-used" class="sinput" type="number" inputmode="decimal" step="0.01" min="0" value="${escapeHtml(String(targetPriceUsed ?? '0.00'))}" style="flex:1;font-size:16px;text-align:right;" />
      </div>
    </div>
    <div class="add-quick-preview" style="margin-top:14px;">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span class="material-icons-round" style="font-size:18px;margin-top:2px;">notifications_active</span>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;">Alert aktywny: cena + magazyn</div>
          <div style="font-size:12px;color:var(--t2);margin-top:2px;">Warunki: Spadek ${escapeHtml(String(thresholdDropPct ?? 10))}% · Magazyn (brak/powrót).</div>
          <div style="font-size:12px;color:var(--t2);margin-top:2px;">Podgląd Telegram: <span style="color:rgba(255,166,87,.9);">Spadek ${escapeHtml(String(thresholdDropPct ?? 10))}%.</span></div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button class="buy-btn detail-alert-status-btn" type="button" style="min-height:34px;padding:8px 14px;font-size:12px;">Edytuj</button>
      </div>
    </div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t2);margin-top:14px;padding:0 4px;display:flex;align-items:center;gap:6px;">
      <span class="material-icons-round" style="font-size:14px;">trending_down</span>
      Alert spadku ceny
    </div>
    <div class="add-quick-preview" style="margin-top:6px;">
      <div style="font-size:14px;font-weight:700;">Próg spadku %</div>
      <div style="font-size:12px;color:var(--t2);margin-top:2px;">Alert, gdy cena spadnie o ten % (puste = globalnie)</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
        <input id="d-drop-pct" class="sinput" type="number" inputmode="decimal" step="1" min="1" max="95" value="${escapeHtml(String(thresholdDropPct ?? 10))}" style="flex:1;font-size:16px;text-align:right;" />
        <span style="font-size:16px;">%</span>
      </div>
    </div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t2);margin-top:14px;padding:0 4px;display:flex;align-items:center;gap:6px;">
      <span class="material-icons-round" style="font-size:14px;">trending_up</span>
      Alert wzrostu ceny
    </div>
    <div class="add-quick-preview" style="margin-top:6px;">
      <div style="font-size:14px;font-weight:700;">Próg wzrostu %</div>
      <div style="font-size:12px;color:var(--t2);margin-top:2px;">Alert, gdy cena wzrośnie o ten % (puste = globalnie)</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
        <input id="d-rise-pct" class="sinput" type="number" inputmode="decimal" step="1" min="1" max="95" value="${escapeHtml(String(thresholdRisePct ?? 10))}" style="flex:1;font-size:16px;text-align:right;" />
        <span style="font-size:16px;">%</span>
      </div>
    </div>
    <button class="buy-btn" type="button" data-action="save-thresholds" data-asin="${escapeHtml(asin)}" style="margin-top:16px;">Zapisz progi</button>
    <button class="buy-btn" type="button" data-action="refresh-asin" data-asin="${escapeHtml(asin)}">${escapeHtml(copy.refreshAsin)}</button>
    <button class="buy-btn" type="button" data-action="snooze" data-asin="${escapeHtml(asin)}">${escapeHtml(copy.snooze60)}</button>
    <button class="buy-btn" type="button" data-action="unsnooze" data-asin="${escapeHtml(asin)}">${escapeHtml(copy.unsnooze)}</button>
  </div>`;
    renderDetailChartCanvas(filteredChartRows);
    if (nodes.detailTopbarTitle)
        nodes.detailTopbarTitle.textContent = String(item.title || asin || copy.details);
}
export async function openDetail(asinRaw) {
    const asin = String(asinRaw || '').trim().toUpperCase();
    const item = state.trackings.find((row) => String(row.asin || '').toUpperCase() === asin);
    if (!item || !nodes.detailView)
        return;
    telemetryLog('detail.open', { asin, title: item.title || '' });
    state.selectedAsin = asin;
    state.detailTab = 'overview';
    renderDetail(item);
    nodes.detailView.classList.add('on');
    await hydrateDetail(asin);
    rerenderSelectedDetail();
}
export function closeDetail() {
    state.selectedAsin = null;
    if (nodes.detailView)
        nodes.detailView.classList.remove('on');
}
export async function refreshSelectedTracking(asinRaw) {
    const asin = String(asinRaw || '').trim().toUpperCase();
    if (!asin)
        return;
    try {
        await client.refreshTracking(asin);
    }
    catch {
        // noop
    }
    await loadTrackings();
    if (state.selectedAsin)
        void openDetail(state.selectedAsin);
}
export async function snoozeSelectedTracking(asinRaw) {
    const asin = String(asinRaw || '').trim().toUpperCase();
    if (!asin)
        return;
    telemetryLog('tracking.snooze', { asin, minutes: 60 });
    try {
        await client.snoozeTracking(state.chatId, asin, 60);
    }
    catch {
        // noop
    }
    await loadTrackings();
    if (state.selectedAsin)
        void openDetail(state.selectedAsin);
}
export async function unsnoozeSelectedTracking(asinRaw) {
    const asin = String(asinRaw || '').trim().toUpperCase();
    if (!asin)
        return;
    telemetryLog('tracking.unsnooze', { asin });
    try {
        await client.unsnoozeTracking(state.chatId, asin);
    }
    catch {
        // noop
    }
    await loadTrackings();
    if (state.selectedAsin)
        void openDetail(state.selectedAsin);
}
export async function deleteSelectedTracking() {
    const asin = String(state.selectedAsin || '').trim().toUpperCase();
    if (!asin)
        return;
    const confirmed = window.confirm(`Delete tracking ${asin}?`);
    if (!confirmed)
        return;
    try {
        await client.deleteTracking(state.chatId, asin);
    }
    catch {
        // noop
    }
    closeDetail();
    await loadTrackings();
}
export async function shareSelectedTracking() {
    const asin = String(state.selectedAsin || '').trim().toUpperCase();
    if (!asin)
        return;
    const bestDomain = (() => {
        const item = state.trackings.find((row) => String(row.asin || '').toUpperCase() === asin);
        return item ? getBestDomain(item) : 'de';
    })();
    const url = `https://${bestDomain === 'uk' ? 'amazon.co.uk' : `amazon.${bestDomain}`}/dp/${encodeURIComponent(asin)}`;
    const shareData = {
        title: asin,
        text: `Soon ${asin}`,
        url,
    };
    try {
        if (navigator.share) {
            await navigator.share(shareData);
            return;
        }
    }
    catch {
        // noop
    }
    try {
        await navigator.clipboard.writeText(url);
    }
    catch {
        // noop
    }
}
export async function copyMobileUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('chatId', state.chatId);
    url.searchParams.set('lang', state.lang);
    try {
        await navigator.clipboard.writeText(url.toString());
    }
    catch {
        // noop
    }
}
/* ═══ ADD PRODUCT ═══ */
