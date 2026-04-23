import { state } from '../state/index.js';
import { nodes } from '../utils/dom.js';
import { client } from '../services/instance.js';
import { escapeHtml, formatDateTime } from '../utils/formatters.js';

export async function loadScanKpi() {
  try {
    state.scanKpi = await client.getScanKpi();
  } catch {
    state.scanKpi = null;
  }
  renderScanKpi();
}

export function renderScanKpi() {
  if (!nodes.scanKpiBody) return;
  const kpi = state.scanKpi;
  if (!kpi) {
    nodes.scanKpiBody.innerHTML = 'Brak danych KPI.';
    return;
  }
  const rows = [
    ['Produkty śledzone', kpi.trackedCount ?? '—'],
    ['Ostatni skan', kpi.lastScan ? formatDateTime(kpi.lastScan) : '—'],
    ['Następny skan', kpi.nextScan ? formatDateTime(kpi.nextScan) : '—'],
    ['Zużyte tokeny (24h)', kpi.tokensUsed24h ?? '—'],
    ['Pozostałe tokeny', kpi.tokensRemaining ?? '—'],
  ];
  nodes.scanKpiBody.innerHTML = `<div class="detail-overview-list">${rows.map(([label, value]) => `<div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(label)}</div><div class="detail-overview-value">${escapeHtml(String(value))}</div></div>`).join('')}</div>`;
}

export async function loadKeepaTokenUsage() {
  try {
    state.keepaTokenUsage = await client.getKeepaTokenUsage();
  } catch {
    state.keepaTokenUsage = null;
  }
  renderKeepaTokens();
}

export function renderKeepaTokens() {
  if (!nodes.keepaTokenBody) return;
  const data = state.keepaTokenUsage;
  if (!data) {
    nodes.keepaTokenBody.innerHTML = 'Brak danych.';
    return;
  }
  const rows = [
    ['Dzienny limit', data.dailyLimit ?? '—'],
    ['Zużyte dzisiaj', data.usedToday ?? '—'],
    ['Pozostałe', data.remaining ?? '—'],
    ['Odnawianie', data.resetsAt ? formatDateTime(data.resetsAt) : '—'],
  ];
  nodes.keepaTokenBody.innerHTML = `<div class="detail-overview-list">${rows.map(([label, value]) => `<div class="detail-overview-row"><div class="detail-overview-label">${escapeHtml(label)}</div><div class="detail-overview-value">${escapeHtml(String(value))}</div></div>`).join('')}</div>`;
}

export async function refreshAllSettingsData() {
  await Promise.all([
    loadScanKpi(),
    loadKeepaTokenUsage(),
  ]);
  try {
    const health = await client.health();
    if (nodes.setLastscan && health?.lastScan) nodes.setLastscan.textContent = formatDateTime(health.lastScan);
    if (nodes.setNextscan && health?.nextScan) nodes.setNextscan.textContent = formatDateTime(health.nextScan);
    if (nodes.setLastscanDesc) nodes.setLastscanDesc.textContent = 'Ostatni skan cen';
    if (nodes.setNextscanDesc) nodes.setNextscanDesc.textContent = 'Następny zaplanowany';
    if (nodes.setKeepa) nodes.setKeepa.textContent = health?.keepa === false ? 'OFF' : 'Aktywne';
    if (nodes.setHunter) nodes.setHunter.textContent = health?.hunter === false ? 'OFF' : 'Aktywny';
  } catch {
    // noop
  }
}
