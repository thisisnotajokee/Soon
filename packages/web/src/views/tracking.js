import { state, TRACKING_CARD_MARKETS } from '../state/index.js';
import { nodes } from '../utils/dom.js';
import { client } from '../services/instance.js';
import { t } from '../utils/i18n.js';
import { escapeHtml, marketFlag, formatPrice, bestNewPrice, bestUsedPrice, getBestDomain, isSnoozed, getSparkline, normalizedRows, } from '../utils/formatters.js';
import { cardHistorySvg } from './shared.js';
export function visibleItems() {
    const query = state.query.trim().toLowerCase();
    const sort = state.trackingSort;
    const list = state.trackings.filter((item) => {
        const active = !isSnoozed(item);
        if (state.trackingStatusFilter === 'active' && !active)
            return false;
        if (state.trackingStatusFilter === 'inactive' && active)
            return false;
        if (sort === 'deals_only') {
            const delta = Number(item.cardPreview?.deltaPctVsAvg);
            if (!Number.isFinite(delta) || delta >= 0)
                return false;
        }
        if (sort === 'stock_used') {
            if (bestUsedPrice(item) === null)
                return false;
        }
        if (sort === 'with_alerts') {
            if (!item.cardPreview?.outOfStock && !item.cardPreview?.popularity)
                return false;
        }
        if (!query)
            return true;
        const haystack = `${String(item.title || '')} ${String(item.asin || '')}`.toLowerCase();
        return haystack.includes(query);
    });
    list.sort((a, b) => {
        if (sort === 'price_asc') {
            const av = bestNewPrice(a) ?? Infinity;
            const bv = bestNewPrice(b) ?? Infinity;
            return av - bv;
        }
        if (sort === 'price_desc') {
            const av = bestNewPrice(a) ?? -Infinity;
            const bv = bestNewPrice(b) ?? -Infinity;
            return bv - av;
        }
        if (sort === 'title_asc' || sort === 'category_asc') {
            return String(a.title || a.asin || '').localeCompare(String(b.title || b.asin || ''));
        }
        if (sort === 'drop_desc') {
            const ad = Number(a.cardPreview?.deltaPctVsAvg);
            const bd = Number(b.cardPreview?.deltaPctVsAvg);
            return (Number.isFinite(ad) ? ad : 0) - (Number.isFinite(bd) ? bd : 0);
        }
        const aTs = Date.parse(String(a.updatedAt || ''));
        const bTs = Date.parse(String(b.updatedAt || ''));
        return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
    });
    return list;
}
export function updateTrackingStatusFiltersUi() {
    const root = nodes.trackingStatusFilters;
    if (!root)
        return;
    const activeCount = state.trackings.filter((item) => !isSnoozed(item)).length;
    const inactiveCount = state.trackings.filter((item) => isSnoozed(item)).length;
    const allCount = state.trackings.length;
    for (const button of root.querySelectorAll('.deal-chip[data-status]')) {
        const status = String(button.dataset.status || '');
        button.classList.toggle('on', status === state.trackingStatusFilter);
        if (status === 'active')
            button.textContent = `Aktywne (${activeCount})`;
        if (status === 'all')
            button.textContent = `Wszystkie (${allCount})`;
        if (status === 'inactive')
            button.textContent = `Wyłączone (${inactiveCount})`;
    }
}
export function recommendationBadge(item) {
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
export function renderTrackingCard(item) {
    const copy = t();
    const title = escapeHtml(item.title || item.asin);
    const asin = escapeHtml(item.asin || '');
    const bestDomain = getBestDomain(item);
    const bestNew = bestNewPrice(item);
    const bestUsed = bestUsedPrice(item);
    const delta = Number(item.cardPreview?.deltaPctVsAvg);
    const ratingRaw = Number(item.cardPreview?.rating);
    const rating = Number.isFinite(ratingRaw) ? Math.max(0, Math.min(5, ratingRaw)) : 0;
    const stars = '★'.repeat(Math.floor(rating));
    const image = String(item.cardPreview?.imageUrl || item.imageUrl || '').trim();
    const rows = normalizedRows(item);
    const sparkPoints = getSparkline(item);
    const spark = cardHistorySvg(sparkPoints, bestDomain);
    const priceDeltaBadge = Number.isFinite(delta)
        ? `<span class="pdrop ${delta > 0 ? 'up' : 'dn'}"><span class="material-icons-round">${delta > 0 ? 'north' : 'south'}</span>${delta > 0 ? '+' : ''}${delta.toFixed(0)}%</span>`
        : '';
    const statusBadge = isSnoozed(item)
        ? `<span class="track-status-badge inactive"><span class="material-icons-round">pause_circle</span>${copy.paused}</span>`
        : `<span class="track-status-badge active"><span class="material-icons-round">track_changes</span>${copy.active}</span>`;
    const signalChips = [
        recommendationBadge(item),
        bestUsed !== null ? '<span class="target-price-badge blue">used min</span>' : '',
        item.targetNew && Number(item.targetNew) > 0
            ? `<span class="target-price-badge inline"><span class="material-icons-round">notifications</span>${escapeHtml(formatPrice(item.targetNew, bestDomain))}</span>`
            : '',
    ]
        .filter(Boolean)
        .join('');
    const rowByMarket = new Map(rows.map((row) => [String(row.market || '').toLowerCase(), row]));
    const grid = TRACKING_CARD_MARKETS
        .map((market) => {
        const row = rowByMarket.get(market);
        const newPrice = Number(row?.newPrice);
        const usedPrice = Number(row?.usedPrice);
        const trend = Number(row?.trendPct);
        const isBest = Number.isFinite(newPrice) && newPrice > 0 && Number(bestNew) === newPrice;
        const trendTag = Number.isFinite(trend) && Math.abs(trend) >= 2
            ? `<span class="pgrid-trend ${trend > 0 ? 'up' : 'dn'}"><span class="material-icons-round">${trend > 0 ? 'north' : 'south'}</span></span>`
            : '';
        return `<div class="pgrid-item" data-domain="${escapeHtml(market)}" data-asin="${asin}">
        <span class="pgrid-flag flag-round">${marketFlag(market)}</span>
        <span class="pgrid-price ${isBest ? 'best' : ''}">${escapeHtml(formatPrice(newPrice, market))}</span>
        <span class="pgrid-used">${Number.isFinite(usedPrice) && usedPrice > 0 ? `u:${escapeHtml(formatPrice(usedPrice, market))}` : ''}</span>
        ${trendTag}
      </div>`;
    })
        .join('');
    const stockBadge = item.cardPreview?.outOfStock ? '<span class="stock-badge out-of-stock">BRAK W MAGAZYNIE</span>' : '';
    const popRaw = Number(item.cardPreview?.popularity);
    const popBadge = Number.isFinite(popRaw) && popRaw > 1 ? `<span class="pop-badge"><span class="material-icons-round">groups</span>${popRaw}</span>` : '';
    const utilityBadges = [stockBadge, popBadge].filter(Boolean).join('');
    return `<article class="pcard" data-asin="${asin}">
    <div class="pcard-top">
      <div class="pcard-img">
        ${image
        ? `<img src="${escapeHtml(image)}" alt="${title}" loading="lazy" />`
        : '<span class="pcard-img-fallback material-icons-round">inventory_2</span>'}
      </div>
      <div class="pcard-info">
        <div class="pcard-title">${title}</div>
        <div class="pcard-meta"><span class="stars">${stars}</span>${rating > 0 ? `(${rating.toFixed(1)})` : '(0.0)'}</div>
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
    ${signalChips ? `<div class="pcard-signals-row"><div class="pcard-signals">${signalChips}</div></div>` : ''}
    ${utilityBadges ? `<div class="pcard-signals-row"><div class="pcard-signals">${utilityBadges}</div></div>` : ''}
    <div class="pgrid">${grid}</div>
    ${sparkPoints.length > 1 ? `<div class="pcard-spark sparkline pcard-history">${spark}</div>` : ''}
  </article>`;
}
export function renderTrackingList() {
    if (!nodes.productsList)
        return;
    const items = visibleItems();
    if (!items.length) {
        nodes.productsList.innerHTML = `<div class="empty"><h3>${escapeHtml(t().noData)}</h3></div>`;
        updateTrackingStatusFiltersUi();
        return;
    }
    nodes.productsList.innerHTML = items.map((item) => renderTrackingCard(item)).join('');
    updateTrackingStatusFiltersUi();
}
export async function loadTrackings() {
    try {
        const dashboard = await client.getDashboard(state.chatId, { includeCardPreview: true });
        state.trackings = Array.isArray(dashboard?.items) ? dashboard.items : [];
    }
    catch {
        state.trackings = [];
    }
    renderTrackingList();
}
