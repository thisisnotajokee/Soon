import { state } from '../state/index.js';
import { nodes } from '../utils/dom.js';
import { client } from '../services/instance.js';
import { escapeHtml, marketFlag, formatPrice, formatDateTime } from '../utils/formatters.js';

export async function loadDeals() {
  try {
    const data = await client.getDeals();
    state.dealsList = Array.isArray(data?.items) ? data.items : [];
  } catch {
    state.dealsList = [];
  }
  renderDeals();
}

export function renderDeals() {
  if (!nodes.dealsList) return;
  const items = state.dealsList;
  if (!items.length) {
    nodes.dealsList.innerHTML = `<div class="empty"><h3>Okazje</h3><p>Brak okazji do wyświetlenia.</p></div>`;
    return;
  }
  nodes.dealsList.innerHTML = items.map((deal) => {
    const title = escapeHtml(deal.title || deal.asin || 'Produkt');
    const asin = escapeHtml(deal.asin || '');
    const price = Number(deal.bestPrice ?? deal.price ?? deal.newPrice ?? deal.currentPrice);
    const currency = String(deal.currency || 'EUR').toLowerCase();
    const domain = currency === 'gbp' ? 'uk' : 'de';
    const marketCount = Number(deal.marketCount ?? 0);
    const updatedAt = formatDateTime(deal.updatedAt);

    return `<article class="pcard deals-compact" data-asin="${asin}">
      <div class="pcard-top">
        <div class="pcard-img">
          <span class="pcard-img-fallback material-icons-round">inventory_2</span>
        </div>
        <div class="pcard-info">
          <div class="pcard-title">${title}</div>
          <div class="pcard-meta">${marketCount} rynki · ${escapeHtml(updatedAt)}</div>
          <div class="pcard-prices">
            <div class="pcard-price-row">
              <span class="pflag flag-round">${marketFlag(domain)}</span>
              <span class="pprice">${escapeHtml(formatPrice(price, domain))}</span>
            </div>
          </div>
        </div>
      </div>
    </article>`;
  }).join('');
}
