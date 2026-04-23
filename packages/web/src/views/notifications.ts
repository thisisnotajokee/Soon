import { state } from '../state/index.js';
import { nodes } from '../utils/dom.js';
import { client } from '../services/instance.js';
import { escapeHtml, formatPrice, formatDateTime } from '../utils/formatters.js';

export async function loadAlerts() {
  try {
    const data = await client.getAlerts(state.chatId);
    if (Array.isArray(data)) {
      state.alertsList = data;
    } else {
      state.alertsList = Array.isArray(data?.alerts) ? data.alerts : [];
    }
  } catch {
    state.alertsList = [];
  }
  renderNotifications();
}

export function renderNotifications() {
  if (!nodes.notifList) return;
  const alertItems = state.alertsList;

  nodes.notifList.innerHTML = alertItems.length
    ? alertItems.map((a) => {
      const title = escapeHtml(a.title || a.asin || 'Alert');
      const asin = escapeHtml(a.asin || '');
      const price = formatPrice(a.price ?? a.newPrice, a.domain || a.market || 'de');
      const oldPrice = formatPrice(a.oldPrice ?? a.previousPrice, a.domain || a.market || 'de');
      return `<div class="notify-toggle" data-asin="${asin}">
        <div>
          <div class="notify-toggle-label">${title}</div>
          <div class="notify-toggle-desc">${escapeHtml(price)} ${oldPrice !== '—' ? `← ${escapeHtml(oldPrice)}` : ''}</div>
        </div>
        <span class="material-icons-round" style="color:var(--orange)">notifications_active</span>
      </div>`;
    }).join('')
    : '<div class="empty"><p>Brak nowych alertów.</p></div>';
}
