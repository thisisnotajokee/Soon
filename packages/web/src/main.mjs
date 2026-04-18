import { createApiClient } from '/api-client.mjs';

const client = createApiClient(window.location.origin);
const params = new URLSearchParams(window.location.search);
const chatId = params.get('chatId') || params.get('userId') || params.get('x-telegram-user-id') || 'demo';

const state = {
  trackings: [],
  selectedAsin: null,
  filterQuery: '',
  filterSnooze: 'all',
  sortBy: 'updated_desc',
  settings: null,
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
  detailSnoozeBadge: document.querySelector('#detail-snooze-badge'),
  detailChart: document.querySelector('#detail-chart'),
  detailNewPrices: document.querySelector('#detail-new-prices'),
  detailUsedPrices: document.querySelector('#detail-used-prices'),
  detailThresholds: document.querySelector('#detail-thresholds'),
  detailSummary: document.querySelector('#detail-summary'),
  detailHistory: document.querySelector('#detail-history'),
  thresholdForm: document.querySelector('#threshold-form'),
  thresholdDropPct: document.querySelector('#threshold-drop-pct'),
  actionRefresh: document.querySelector('#action-refresh'),
  actionSnooze: document.querySelector('#action-snooze'),
  actionUnsnooze: document.querySelector('#action-unsnooze'),
  filterQuery: document.querySelector('#filter-query'),
  filterSnooze: document.querySelector('#filter-snooze'),
  sortBy: document.querySelector('#sort-by'),
  settingsForm: document.querySelector('#settings-form'),
  settingsProductInterval: document.querySelector('#settings-product-interval'),
  settingsScanInterval: document.querySelector('#settings-scan-interval'),
  settingsNotifications: document.querySelector('#settings-notifications'),
  settingsUpdated: document.querySelector('#settings-updated'),
  uiError: document.querySelector('#ui-error'),
  reloadTrackings: document.querySelector('#reload-trackings'),
  reloadDetail: document.querySelector('#reload-detail'),
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

function eur(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'EUR' }).format(value);
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
    const li = document.createElement('li');
    li.className = `tracking-item${item.asin === state.selectedAsin ? ' selected' : ''}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tracking-button';
    button.dataset.asin = item.asin;

    const title = document.createElement('strong');
    title.textContent = item.title || item.asin;

    const asin = document.createElement('span');
    asin.className = 'muted';
    asin.textContent = item.asin;

    const chips = document.createElement('div');
    chips.className = 'chip-row';
    const newChip = document.createElement('span');
    newChip.className = 'chip';
    newChip.textContent = `new min: ${eur(minPrice(item.pricesNew))}`;
    const usedChip = document.createElement('span');
    usedChip.className = 'chip';
    usedChip.textContent = `used min: ${eur(minPrice(item.pricesUsed))}`;
    chips.append(newChip, usedChip);

    if (item?.snooze?.active) {
      const snoozeChip = document.createElement('span');
      snoozeChip.className = 'chip';
      snoozeChip.textContent = `snooze do ${formatIso(item.snooze.until)}`;
      chips.appendChild(snoozeChip);
    }

    button.append(title, asin, chips);
    li.appendChild(button);
    nodes.trackingList.appendChild(li);
  }
}

function renderMapList(node, mapping) {
  node.innerHTML = '';
  const entries = Object.entries(mapping || {});
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

  nodes.detailChart.innerHTML = [
    `<line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#d8d1be" />`,
    `<polyline points="${pointsAttr}" fill="none" stroke="#0f766e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`,
    `<text x="${padding}" y="18" fill="#5e686f" font-size="12">min ${eur(min)}</text>`,
    `<text x="${width - padding}" y="18" fill="#5e686f" font-size="12" text-anchor="end">max ${eur(max)}</text>`,
  ].join('');
}

function getSelectedTracking() {
  return state.trackings.find((item) => item.asin === state.selectedAsin) || null;
}

function renderSettings() {
  const settings = state.settings;
  if (!settings) return;
  nodes.settingsProductInterval.value = String(settings.productIntervalMin ?? 60);
  nodes.settingsScanInterval.value = String(settings.scanIntervalMin ?? 60);
  nodes.settingsNotifications.checked = Boolean(settings.notificationsEnabled);
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
  const dashboard = await client.getDashboard(chatId);
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
  const settings = await client.getSettings(chatId);
  state.settings = settings;
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
  nodes.detailAsin.textContent = detail.asin || state.selectedAsin;

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

  const dropPct = Number(detail.thresholds?.thresholdDropPct);
  nodes.thresholdDropPct.value = Number.isFinite(dropPct) ? String(dropPct) : '10';
}

async function refreshAll() {
  setError('');
  nodes.chatId.textContent = chatId;
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
  const target = event.target.closest('button[data-asin]');
  if (!target) return;
  state.selectedAsin = target.dataset.asin;
  renderTrackingList();
  try {
    setError('');
    await loadDetail();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
});

nodes.filterQuery.addEventListener('input', () => {
  state.filterQuery = String(nodes.filterQuery.value ?? '');
  renderTrackingList();
});

nodes.filterSnooze.addEventListener('change', () => {
  state.filterSnooze = String(nodes.filterSnooze.value || 'all');
  renderTrackingList();
});

nodes.sortBy.addEventListener('change', () => {
  state.sortBy = String(nodes.sortBy.value || 'updated_desc');
  renderTrackingList();
});

nodes.thresholdForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedAsin) return;
  try {
    setError('');
    const dropPct = Number(nodes.thresholdDropPct.value);
    if (!Number.isFinite(dropPct) || dropPct < 1 || dropPct > 95) {
      throw new Error('Drop % musi być w zakresie 1-95');
    }
    await client.setDropPct(chatId, state.selectedAsin, Math.round(dropPct));
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
    await client.snoozeTracking(chatId, state.selectedAsin, 60);
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
    await client.unsnoozeTracking(chatId, state.selectedAsin);
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

    await client.setProductInterval(chatId, Math.round(productIntervalMin));
    await client.setScanInterval(chatId, Math.round(scanIntervalMin));
    await client.setNotifications(chatId, nodes.settingsNotifications.checked);
    await loadSettings();
    await loadTrackings();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
});

refreshAll();
