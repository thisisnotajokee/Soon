import { client } from './services/instance.js';
import { state } from './state/index.js';
import { nodes } from './utils/dom.js';
import { setQueryParam } from './utils/i18n.js';
import { escapeHtml, toNullableNumber, parseAsinFromInput, } from './utils/formatters.js';
import { log as telemetryLog } from './utils/telemetry.js';
import { openAmazon, applyCopy } from './views/shared.js';
import { renderTrackingList, loadTrackings } from './views/tracking.js';
import { loadDeals, renderDeals } from './views/deals.js';
import { loadAlerts, renderNotifications } from './views/notifications.js';
import { refreshAllSettingsData } from './views/settings.js';
import { openDetail, closeDetail, refreshSelectedTracking, snoozeSelectedTracking, unsnoozeSelectedTracking, deleteSelectedTracking, shareSelectedTracking, copyMobileUrl, rerenderSelectedDetail, } from './views/detail.js';
// I18N moved to state/index.js
// state moved to state/index.js
// nodes moved to utils/dom.js
function setActiveView(next) {
    closeDetail();
    if (state.activeView !== next) {
        telemetryLog('navigate.view', { from: state.activeView, to: next });
    }
    state.activeView = next;
    for (const [key, view] of Object.entries(nodes.views)) {
        if (!view)
            continue;
        view.classList.toggle('on', key === next);
    }
    for (const button of nodes.navItems) {
        button.classList.toggle('on', String(button.dataset.v || '') === next);
    }
    nodes.dealsFabMenu?.classList.remove('open');
    nodes.trackingFabMenu?.classList.remove('open');
}
function updateAddModeUi() {
    const quick = state.addMode === 'quick';
    const advancedBlocks = document.querySelectorAll('.add-advanced-block');
    for (const block of advancedBlocks) {
        block.classList.toggle('settings-hidden', quick);
    }
    const chips = nodes.addModeSwitch?.querySelectorAll('.add-mode-chip');
    for (const chip of chips || []) {
        chip.classList.toggle('on', chip.getAttribute('data-add-mode') === state.addMode);
    }
    if (nodes.addModeHint) {
        nodes.addModeHint.textContent = quick
            ? 'Tryb szybki: tylko najważniejsze pola, 1 klik = dodanie.'
            : 'Tryb zaawansowany: pełna kontrola progów, rynków i typów cen.';
    }
}
async function submitAddProduct() {
    if (!nodes.asinInput)
        return;
    const raw = nodes.asinInput.value;
    const asins = parseAsinFromInput(raw);
    if (!asins.length) {
        if (nodes.addResultBox)
            nodes.addResultBox.textContent = 'Wklej poprawny ASIN lub link Amazon.';
        return;
    }
    telemetryLog('product.add', { count: asins.length, mode: state.addMode, domains: state.addDomains });
    if (nodes.bulkProgress)
        nodes.bulkProgress.classList.remove('settings-hidden');
    const results = [];
    for (let i = 0; i < asins.length; i += 1) {
        const asin = asins[i];
        if (nodes.bulkBarFill)
            nodes.bulkBarFill.style.width = `${((i + 1) / asins.length) * 100}%`;
        if (nodes.bulkStatus)
            nodes.bulkStatus.textContent = `Dodawanie ${asin}…`;
        try {
            await client.addProduct({
                asin,
                domains: state.addDomains,
                priceType: state.addPriceType,
                trackMode: state.addTrackMode,
                dropPct: state.addDropPct,
                risePct: state.addRisePct,
                stockEvents: state.addStockEvents,
            });
            results.push(`${asin}: OK`);
        }
        catch {
            results.push(`${asin}: Błąd`);
        }
    }
    if (nodes.bulkBarFill)
        nodes.bulkBarFill.style.width = '100%';
    if (nodes.bulkStatus)
        nodes.bulkStatus.textContent = 'Gotowe';
    if (nodes.addResultBox) {
        nodes.addResultBox.innerHTML = results.map((r) => `<div>${escapeHtml(r)}</div>`).join('');
        nodes.addResultBox.classList.remove('settings-hidden');
    }
    nodes.asinInput.value = '';
    setTimeout(() => {
        if (nodes.bulkProgress)
            nodes.bulkProgress.classList.add('settings-hidden');
    }, 1500);
    await loadTrackings();
}
function bindEvents() {
    for (const button of nodes.navItems) {
        button.addEventListener('click', () => {
            const view = String(button.dataset.v || 'tracking');
            setActiveView(view);
        });
    }
    nodes.searchInput?.addEventListener('input', () => {
        state.query = String(nodes.searchInput?.value || '');
        renderTrackingList();
    });
    nodes.searchClear?.addEventListener('click', () => {
        state.query = '';
        if (nodes.searchInput)
            nodes.searchInput.value = '';
        renderTrackingList();
    });
    nodes.topRefreshBtn?.addEventListener('click', async () => {
        await loadTrackings();
    });
    nodes.topCopyBtn?.addEventListener('click', async () => {
        await copyMobileUrl();
    });
    nodes.trackingStatusFilters?.addEventListener('click', (event) => {
        const target = event.target;
        const button = target.closest('.deal-chip[data-status]');
        if (!button)
            return;
        const status = String(button.dataset.status || '');
        if (status !== 'active' && status !== 'all' && status !== 'inactive')
            return;
        state.trackingStatusFilter = status;
        renderTrackingList();
    });
    nodes.productsList?.addEventListener('click', (event) => {
        const target = event.target;
        const marketButton = target.closest('[data-action="open-market"]');
        if (marketButton) {
            openAmazon(marketButton.dataset.asin || '', marketButton.dataset.market || 'de');
            return;
        }
        const bestButton = target.closest('.pcard-price-row[data-asin][data-market]');
        if (bestButton) {
            openAmazon(bestButton.dataset.asin || '', bestButton.dataset.market || 'de');
            return;
        }
        const gridItem = target.closest('.pgrid-item[data-domain][data-asin]');
        if (gridItem) {
            openAmazon(gridItem.dataset.asin || '', gridItem.dataset.domain || 'de');
            return;
        }
        const card = target.closest('.pcard[data-asin]');
        if (card?.dataset.asin) {
            void openDetail(card.dataset.asin);
        }
    });
    nodes.detailBack?.addEventListener('click', closeDetail);
    nodes.detailDelete?.addEventListener('click', deleteSelectedTracking);
    nodes.detailShare?.addEventListener('click', shareSelectedTracking);
    nodes.detailContent?.addEventListener('click', async (event) => {
        const target = event.target;
        const marketButton = target.closest('[data-action="open-market"]');
        if (marketButton) {
            openAmazon(marketButton.dataset.asin || '', marketButton.dataset.market || 'de');
            return;
        }
        const bestButton = target.closest('[data-action="open-best"]');
        if (bestButton) {
            openAmazon(bestButton.dataset.asin || '', bestButton.dataset.market || 'de');
            return;
        }
        const tabButton = target.closest('.dtab[data-dt]');
        if (tabButton) {
            const tab = String(tabButton.dataset.dt || 'overview');
            if (tab !== 'overview' && tab !== 'settings')
                return;
            state.detailTab = tab;
            rerenderSelectedDetail();
            return;
        }
        const rangeButton = target.closest('#timeRange [data-r]');
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
            const asin = String(state.selectedAsin || '').toUpperCase();
            const dom = String(chartMarketChip.dataset.dom || '').toLowerCase();
            if (!asin || !dom)
                return;
            const selected = new Set(state.detailChartMarketsByAsin[asin] || []);
            if (selected.has(dom)) {
                if (selected.size > 1)
                    selected.delete(dom);
            }
            else {
                selected.add(dom);
            }
            state.detailChartMarketsByAsin[asin] = [...selected];
            rerenderSelectedDetail();
            return;
        }
        const refreshButton = target.closest('[data-action="refresh-asin"]');
        if (refreshButton) {
            await refreshSelectedTracking(refreshButton.dataset.asin || '');
            return;
        }
        const snoozeButton = target.closest('[data-action="snooze"]');
        if (snoozeButton) {
            await snoozeSelectedTracking(snoozeButton.dataset.asin || '');
            return;
        }
        const unsnoozeButton = target.closest('[data-action="unsnooze"]');
        if (unsnoozeButton) {
            await unsnoozeSelectedTracking(unsnoozeButton.dataset.asin || '');
            return;
        }
        const saveThresholdsButton = target.closest('[data-action="save-thresholds"]');
        if (saveThresholdsButton) {
            const asin = String(saveThresholdsButton.dataset.asin || '').trim().toUpperCase();
            if (!asin || !nodes.detailContent)
                return;
            const dropPctInput = nodes.detailContent.querySelector('#d-drop-pct');
            const risePctInput = nodes.detailContent.querySelector('#d-rise-pct');
            const targetNewInput = nodes.detailContent.querySelector('#d-target-new');
            const targetUsedInput = nodes.detailContent.querySelector('#d-target-used');
            const dropPct = toNullableNumber(dropPctInput?.value);
            const risePct = toNullableNumber(risePctInput?.value);
            const targetPriceNew = toNullableNumber(targetNewInput?.value);
            const targetPriceUsed = toNullableNumber(targetUsedInput?.value);
            try {
                await client.updateThresholds(asin, {
                    thresholdDropPct: dropPct,
                    thresholdRisePct: risePct,
                    targetPriceNew,
                    targetPriceUsed,
                });
            }
            catch {
                // noop
            }
            await loadTrackings();
            if (state.selectedAsin)
                void openDetail(state.selectedAsin);
        }
        const detailMarketToggle = target.closest('[data-action="toggle-detail-market"]');
        if (detailMarketToggle) {
            detailMarketToggle.classList.toggle('on');
            return;
        }
    });
    nodes.detailContent?.addEventListener('keydown', (event) => {
        const key = event.key;
        if (key !== 'Enter' && key !== ' ')
            return;
        const target = event.target;
        const actionable = target.closest('[role="button"][data-action], #timeRange [data-r]');
        if (!actionable)
            return;
        event.preventDefault();
        actionable.click();
    });
    if (nodes.chatIdInput)
        nodes.chatIdInput.value = state.chatId;
    nodes.chatIdSave?.addEventListener('click', async () => {
        const next = String(nodes.chatIdInput?.value || '').trim() || 'demo';
        state.chatId = next;
        try {
            window.localStorage.setItem('soon.chatId', next);
        }
        catch {
            // noop
        }
        setQueryParam('chatId', next);
        await loadTrackings();
    });
    nodes.langRow?.addEventListener('click', async (event) => {
        const target = event.target;
        const button = target.closest('.mchip[data-lang]');
        if (!button)
            return;
        const next = String(button.dataset.lang || 'pl');
        if (!['pl', 'en', 'de'].includes(next))
            return;
        state.lang = next;
        try {
            window.localStorage.setItem('soon.lang', next);
        }
        catch {
            // noop
        }
        setQueryParam('lang', next);
        applyCopy();
        renderTrackingList();
    });
    /* Nav lazy-load data */
    for (const button of nodes.navItems) {
        button.addEventListener('click', async () => {
            const view = String(button.dataset.v || 'tracking');
            if (view === 'deals')
                await loadDeals();
            if (view === 'notifications')
                await loadAlerts();
            if (view === 'settings')
                await refreshAllSettingsData();
        });
    }
    /* ═══ DEALS EVENTS ═══ */
    nodes.dealsQuickFilters?.addEventListener('click', (event) => {
        const target = event.target;
        const chip = target.closest('.deal-chip[data-deals-source]');
        if (!chip)
            return;
        const source = String(chip.dataset.source || '');
        state.dealsSource = source;
        for (const c of nodes.dealsQuickFilters?.querySelectorAll('.deal-chip') || []) {
            c.classList.toggle('on', c.getAttribute('data-source') === source);
        }
        renderDeals();
    });
    nodes.dealsFabMenu?.addEventListener('click', async (event) => {
        const target = event.target;
        const actionBtn = target.closest('[data-action]');
        if (!actionBtn)
            return;
        const action = actionBtn.dataset.action;
        if (action === 'toggle-deals-fab-menu') {
            nodes.dealsFabMenu?.classList.toggle('open');
            return;
        }
        if (action === 'set-deals-sort') {
            const sort = String(actionBtn.dataset.sort || '');
            state.dealsSort = sort;
            nodes.dealsFabMenu?.classList.remove('open');
            renderDeals();
            return;
        }
        if (action === 'refresh-deals-feed') {
            nodes.dealsFabMenu?.classList.remove('open');
            await loadDeals();
        }
    });
    nodes.trackingFabMenu?.addEventListener('click', (event) => {
        const target = event.target;
        const actionBtn = target.closest('[data-action]');
        if (!actionBtn)
            return;
        const action = actionBtn.dataset.action;
        if (action === 'toggle-tracking-fab-menu') {
            nodes.trackingFabMenu?.classList.toggle('open');
            return;
        }
        if (action === 'set-tracking-sort') {
            const sort = String(actionBtn.dataset.sort || '');
            if (!sort)
                return;
            state.trackingSort = sort;
            nodes.trackingFabMenu?.classList.remove('open');
            for (const btn of nodes.trackingFabMenu?.querySelectorAll('.deals-fab-action[data-sort]') || []) {
                btn.classList.toggle('on', btn.dataset.sort === sort);
            }
            renderTrackingList();
            return;
        }
    });
    /* ═══ ADD EVENTS ═══ */
    nodes.addModeSwitch?.addEventListener('click', (event) => {
        const target = event.target;
        const chip = target.closest('.add-mode-chip[data-add-mode]');
        if (!chip)
            return;
        state.addMode = String(chip.dataset.addMode || 'quick');
        updateAddModeUi();
    });
    nodes.addDomains?.addEventListener('click', (event) => {
        const target = event.target;
        const chip = target.closest('.domtoggle[data-d]');
        if (!chip)
            return;
        const d = String(chip.dataset.d || '');
        if (!d)
            return;
        const set = new Set(state.addDomains);
        if (set.has(d))
            set.delete(d);
        else
            set.add(d);
        state.addDomains = [...set];
        for (const c of nodes.addDomains?.querySelectorAll('.domtoggle') || []) {
            c.classList.toggle('on', set.has(String(c.getAttribute('data-d'))));
        }
    });
    document.querySelector('#v-add')?.addEventListener('click', async (event) => {
        const target = event.target;
        const actionBtn = target.closest('[data-action]');
        if (!actionBtn) {
            /* preset / price-type / track-mode / drop-pct / rise-pct / stock-event chips */
            const chip = target.closest('button[data-add-preset], button[data-price-type], button[data-track-mode], button[data-drop-pct], button[data-rise-pct], button[data-stock-event]');
            if (chip) {
                const preset = chip.dataset.addPreset;
                const priceType = chip.dataset.priceType;
                const trackMode = chip.dataset.trackMode;
                const dropPct = chip.dataset.dropPct;
                const risePct = chip.dataset.risePct;
                const stockEvent = chip.dataset.stockEvent;
                if (preset) {
                    state.addPreset = preset;
                    const map = { safe: { drop: 20, rise: 15 }, standard: { drop: 10, rise: 5 }, aggressive: { drop: 5, rise: 1 } };
                    state.addDropPct = map[preset]?.drop ?? 10;
                    state.addRisePct = map[preset]?.rise ?? 5;
                }
                if (priceType)
                    state.addPriceType = priceType;
                if (trackMode)
                    state.addTrackMode = trackMode;
                if (dropPct !== undefined)
                    state.addDropPct = dropPct === '1' ? 1 : Number(dropPct);
                if (risePct !== undefined)
                    state.addRisePct = risePct === '1' ? 1 : Number(risePct);
                if (stockEvent) {
                    const set = new Set(state.addStockEvents);
                    if (set.has(stockEvent))
                        set.delete(stockEvent);
                    else
                        set.add(stockEvent);
                    state.addStockEvents = [...set];
                }
                const parent = chip.parentElement;
                if (parent) {
                    for (const c of parent.querySelectorAll('button')) {
                        const active = c.dataset.addPreset === state.addPreset ||
                            c.dataset.priceType === state.addPriceType ||
                            c.dataset.trackMode === state.addTrackMode ||
                            (c.dataset.dropPct !== undefined && state.addDropPct === (c.dataset.dropPct === '1' ? 1 : Number(c.dataset.dropPct))) ||
                            (c.dataset.risePct !== undefined && state.addRisePct === (c.dataset.risePct === '1' ? 1 : Number(c.dataset.risePct))) ||
                            (c.dataset.stockEvent && state.addStockEvents.includes(String(c.dataset.stockEvent)));
                        c.classList.toggle('on', Boolean(active));
                    }
                }
            }
            return;
        }
        const action = actionBtn.dataset.action;
        if (action === 'add-product') {
            await submitAddProduct();
            return;
        }
        if (action === 'paste-clipboard-add') {
            try {
                const text = await navigator.clipboard.readText();
                if (nodes.asinInput)
                    nodes.asinInput.value = text;
                await submitAddProduct();
            }
            catch {
                if (nodes.addResultBox)
                    nodes.addResultBox.textContent = 'Brak dostępu do schowka.';
            }
            return;
        }
        if (action === 'set-add-mode') {
            const mode = String(actionBtn.dataset.addMode || 'quick');
            if (mode === 'quick' || mode === 'advanced') {
                state.addMode = mode;
                updateAddModeUi();
            }
            return;
        }
        if (action === 'open-amazon-quick-add') {
            window.open('https://amazon.de', '_blank');
            return;
        }
    });
    /* ═══ DETAIL SETTINGS EVENTS ═══ */
    document.body.addEventListener('click', (event) => {
        const target = event.target;
        const chip = target.closest('button.deal-chip[data-action]');
        if (!chip)
            return;
        if (!chip.closest('#dt-settings'))
            return;
        const action = chip.dataset.action;
        const settings = document.getElementById('dt-settings');
        if (!settings)
            return;
        if (action === 'set-detail-profile') {
            const profile = chip.dataset.profile;
            const profiles = {
                safe: { priceTypes: ['buybox'], trackDrop: true, trackRise: false, dropPct: 15, risePct: 10, stockOut: false, stockBack: true },
                standard: { priceTypes: ['buybox', 'amazon', 'new'], trackDrop: true, trackRise: false, dropPct: 10, risePct: 5, stockOut: true, stockBack: true },
                aggressive: { priceTypes: ['buybox', 'amazon', 'new', 'buybox_used', 'used'], trackDrop: true, trackRise: true, dropPct: 5, risePct: 5, stockOut: true, stockBack: true },
            };
            const cfg = profiles[profile || ''];
            if (!cfg)
                return;
            // Update profile chip highlights
            settings.querySelectorAll('button.deal-chip[data-action="set-detail-profile"]').forEach((c) => {
                c.classList.toggle('on', c.dataset.profile === profile);
            });
            // Apply price types
            settings.querySelectorAll('button.deal-chip[data-action="set-detail-price-type"]').forEach((c) => {
                c.classList.toggle('on', cfg.priceTypes.includes(c.dataset.pt || ''));
            });
            // Apply track modes
            settings.querySelectorAll('button.deal-chip[data-action="set-detail-track-mode"]').forEach((c) => {
                const mode = c.dataset.mode;
                c.classList.toggle('on', (mode === 'drop' && cfg.trackDrop) || (mode === 'rise' && cfg.trackRise));
            });
            // Apply drop preset
            settings.querySelectorAll('button.deal-chip[data-action="set-detail-drop-preset"]').forEach((c) => {
                c.classList.toggle('on', Number(c.dataset.preset) === cfg.dropPct);
            });
            // Apply rise preset
            settings.querySelectorAll('button.deal-chip[data-action="set-detail-rise-preset"]').forEach((c) => {
                c.classList.toggle('on', Number(c.dataset.preset) === cfg.risePct);
            });
            // Apply stock events
            settings.querySelectorAll('button.deal-chip[data-action="set-detail-stock-event"]').forEach((c) => {
                const ev = c.dataset.event;
                c.classList.toggle('on', (ev === 'out' && cfg.stockOut) || (ev === 'back' && cfg.stockBack));
            });
            return;
        }
        if (action === 'set-detail-price-type') {
            const pt = chip.dataset.pt;
            if (!pt)
                return;
            chip.classList.toggle('on');
            // Ensure at least one remains selected
            const selected = settings.querySelectorAll('button.deal-chip[data-action="set-detail-price-type"].on');
            if (selected.length === 0)
                chip.classList.add('on');
            return;
        }
        if (action === 'set-detail-track-mode') {
            chip.classList.toggle('on');
            return;
        }
        if (action === 'set-detail-drop-preset') {
            settings.querySelectorAll('button.deal-chip[data-action="set-detail-drop-preset"]').forEach((c) => {
                c.classList.toggle('on', c === chip);
            });
            const preset = chip.dataset.preset;
            const dropInput = document.querySelector('#d-drop-pct');
            if (dropInput && preset && preset !== 'any') {
                dropInput.value = preset;
            }
            return;
        }
        if (action === 'set-detail-rise-preset') {
            settings.querySelectorAll('button.deal-chip[data-action="set-detail-rise-preset"]').forEach((c) => {
                c.classList.toggle('on', c === chip);
            });
            const preset = chip.dataset.preset;
            const riseInput = document.querySelector('#d-rise-pct');
            if (riseInput && preset && preset !== 'any') {
                riseInput.value = preset;
            }
            return;
        }
        if (action === 'set-detail-stock-event') {
            chip.classList.toggle('on');
            return;
        }
    });
    /* ═══ NOTIFICATIONS EVENTS ═══ */
    document.querySelector('.notif-tabs')?.addEventListener('click', (event) => {
        const target = event.target;
        const tab = target.closest('.ntab[data-notif-tab]');
        if (!tab)
            return;
        const key = String(tab.dataset.notifTab || '');
        state.notifTab = key;
        for (const t of document.querySelectorAll('.ntab[data-notif-tab]')) {
            t.classList.toggle('on', t.getAttribute('data-notif-tab') === key);
        }
        renderNotifications();
    });
    function updateSettingsSummaries() {
        const notifSummary = document.getElementById('notifPrefsSummary');
        if (notifSummary) {
            const total = document.querySelectorAll('#notifAccordion .toggle-switch[data-notif-key]').length;
            const on = document.querySelectorAll('#notifAccordion .toggle-switch.on[data-notif-key]').length;
            notifSummary.textContent = total ? `${on}/${total} włączonych` : 'Dotknij, aby rozwinąć';
        }
        const appearanceSummary = document.getElementById('appearanceSummary');
        if (appearanceSummary) {
            const theme = document.querySelector('[data-change-action="set-theme"]')?.value || 'AMOLED';
            const font = document.body.classList.contains('font-compact') ? 'Kompakt' : document.body.classList.contains('font-readable') ? 'Czytelny' : 'Standard';
            const cards = document.body.classList.contains('cards-normal') ? 'Duży' : 'Normalny';
            appearanceSummary.textContent = `${theme}, ${font}, ${cards}`;
        }
    }
    setTimeout(updateSettingsSummaries, 100);
    /* ═══ SETTINGS EVENTS ═══ */
    document.querySelector('#v-settings')?.addEventListener('click', async (event) => {
        const target = event.target;
        const accordionHead = target.closest('[data-action="toggle-settings-accordion"]');
        if (accordionHead) {
            const id = accordionHead.getAttribute('data-accordion-id') || '';
            const panel = document.getElementById(id);
            panel?.classList.toggle('open');
            return;
        }
        const actionBtn = target.closest('[data-action]');
        if (!actionBtn)
            return;
        const action = actionBtn.dataset.action;
        if (action === 'fetch-status') {
            await refreshAllSettingsData();
            return;
        }
        if (action === 'run-scan-now') {
            try {
                await client.runScanNow();
            }
            catch { /* noop */ }
            await refreshAllSettingsData();
            return;
        }
        if (action === 'toggle-fullscreen') {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => { });
            }
            else {
                document.exitFullscreen().catch(() => { });
            }
            return;
        }
        if (action === 'install-pwa') {
            if (state.pwaInstallEvent) {
                state.pwaInstallEvent.prompt();
            }
            return;
        }
        if (action === 'toggle-notif-prefs-panel') {
            const panelId = actionBtn.getAttribute('data-accordion-id') || '';
            const panel = document.getElementById(panelId);
            panel?.classList.toggle('open');
            actionBtn.closest('.settings-accordion')?.classList.toggle('open');
            return;
        }
        if (action === 'toggle-notif' || action === 'toggle-pref-saveall') {
            const toggle = target.closest('.toggle-switch') || actionBtn.querySelector('.toggle-switch') || actionBtn.closest('.settings-item')?.querySelector('.toggle-switch');
            if (toggle) {
                toggle.classList.toggle('on');
            }
            const prefs = {};
            document.querySelectorAll('#v-settings .toggle-switch[data-notif-key], #v-settings .toggle-switch[id^="tog-"]').forEach((el) => {
                const key = el.getAttribute('data-notif-key') || el.id.replace('tog-', '');
                if (key)
                    prefs[key] = el.classList.contains('on');
            });
            if (state.chatId) {
                client.savePreferences(state.chatId, prefs).catch(() => { });
            }
            updateSettingsSummaries();
            return;
        }
        if (action === 'toggle-card-size') {
            document.body.classList.toggle('cards-normal');
            const label = document.getElementById('set-card-size');
            if (label)
                label.textContent = document.body.classList.contains('cards-normal') ? 'Duży' : 'Normalny';
            updateSettingsSummaries();
            return;
        }
        if (action === 'apply-font-preset') {
            const preset = actionBtn.getAttribute('data-font-preset') || '';
            document.body.classList.remove('font-compact', 'font-readable');
            if (preset === 'compact')
                document.body.classList.add('font-compact');
            if (preset === 'readable')
                document.body.classList.add('font-readable');
            if (preset === 'standard') {
                document.querySelectorAll('.view[id^="v-"]').forEach((el) => {
                    el.style.transform = '';
                    el.style.width = '';
                });
                document.querySelectorAll('.tab-font-scale-select').forEach((el) => {
                    el.value = '1.0';
                });
            }
            updateSettingsSummaries();
            return;
        }
        if (action === 'reset-tab-font-scale') {
            const tab = actionBtn.getAttribute('data-font-tab') || '';
            document.querySelectorAll(`[data-font-tab="${tab}"] .tab-font-scale-select`).forEach((el) => {
                el.value = '1.0';
            });
            const tabEl = document.querySelector(`#v-${tab}`);
            if (tabEl) {
                tabEl.style.transform = '';
                tabEl.style.width = '';
            }
            return;
        }
        if (action === 'open-webapp') {
            const tg = window.Telegram?.WebApp;
            if (tg?.openTelegramLink) {
                tg.openTelegramLink('https://t.me/your_bot');
            }
            return;
        }
        if (action === 'add-to-home') {
            if (state.pwaInstallEvent) {
                state.pwaInstallEvent.prompt();
            }
            return;
        }
    });
    /* ═══ SETTINGS CHANGE EVENTS (selects) ═══ */
    document.querySelector('#v-settings')?.addEventListener('change', async (event) => {
        const target = event.target;
        const changeEl = target.closest('[data-change-action]');
        if (!changeEl)
            return;
        const changeAction = changeEl.dataset.changeAction;
        if (changeAction === 'set-theme') {
            const theme = changeEl.value;
            document.documentElement.setAttribute('data-theme', theme);
            updateSettingsSummaries();
            return;
        }
        if (changeAction === 'set-tab-font-scale') {
            const tab = changeEl.getAttribute('data-font-tab') || '';
            const value = changeEl.value;
            const el = document.querySelector(`#v-${tab}`);
            if (el) {
                const scale = parseFloat(value);
                el.style.transform = `scale(${scale})`;
                el.style.transformOrigin = 'top left';
                el.style.width = `${100 / scale}%`;
            }
            return;
        }
    });
}
async function bootstrap() {
    bindEvents();
    setActiveView('tracking');
    applyCopy();
    await loadTrackings();
    /* PWA */
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => { });
    }
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        state.pwaInstallEvent = e;
    });
    /* Telegram Mini App */
    const tg = window.Telegram?.WebApp;
    if (tg) {
        state.tgWebApp = tg;
        tg.ready();
        tg.expand();
        if (tg.initDataUnsafe?.user?.id) {
            const tgId = String(tg.initDataUnsafe.user.id);
            if (tgId && tgId !== state.chatId) {
                state.chatId = tgId;
                try {
                    window.localStorage.setItem('soon.chatId', tgId);
                }
                catch {
                    // noop
                }
                setQueryParam('chatId', tgId);
                if (nodes.chatIdInput)
                    nodes.chatIdInput.value = tgId;
                await loadTrackings();
            }
        }
        document.body.style.setProperty('--tg-viewport-height', `${tg.viewportHeight}px`);
        tg.onEvent('viewportChanged', () => {
            document.body.style.setProperty('--tg-viewport-height', `${tg.viewportHeight}px`);
        });
    }
    // Hide FAB when detail view is open
    const detailView = document.getElementById('detailView');
    if (detailView) {
        const observer = new MutationObserver(() => {
            document.body.classList.toggle('detail-open', detailView.classList.contains('on'));
        });
        observer.observe(detailView, { attributes: true, attributeFilter: ['class'] });
        document.body.classList.toggle('detail-open', detailView.classList.contains('on'));
    }
    // Wrap target price tiles in horizontal grid
    setInterval(() => {
        const settings = document.querySelector('#dt-settings');
        if (!settings)
            return;
        const previews = Array.from(settings.querySelectorAll('.add-quick-preview'));
        const targetContainers = previews.filter((p) => p.textContent?.includes('Cena docelowa'));
        if (targetContainers.length === 2 && !settings.querySelector('.target-price-grid')) {
            const grid = document.createElement('div');
            grid.className = 'target-price-grid';
            targetContainers[0].parentElement?.insertBefore(grid, targetContainers[0]);
            targetContainers.forEach((c) => {
                grid.appendChild(c);
            });
        }
        // Remove threshold tiles (drop%/rise%) completely
        previews.forEach((p) => {
            const text = p.textContent?.trim() || '';
            if (text.includes('Próg spadku') || text.includes('Próg wzrostu')) {
                p.remove();
            }
        });
        // Hide alert section titles
        settings.querySelectorAll(':scope > div').forEach((el) => {
            const text = el.textContent?.trim() || '';
            if (text.includes('Alert spadku ceny') || text.includes('Alert wzrostu ceny')) {
                el.style.display = 'none';
            }
        });
        // Hide 'Edytuj' button on alert preview tile (threshold config removed)
        const alertEditBtn = settings.querySelector('.detail-alert-status-btn');
        if (alertEditBtn) {
            alertEditBtn.style.display = 'none';
        }
    }, 500);
}
bootstrap().catch(() => {
    // noop
});
