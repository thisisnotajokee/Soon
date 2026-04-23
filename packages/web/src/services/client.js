function assertOk(response, body, context) {
    if (!response.ok) {
        throw new Error(`${context} failed (${response.status}): ${JSON.stringify(body)}`);
    }
}
async function fetchWithRetry(input, init = {}) {
    const { retries = 2, timeoutMs = 15000, retryDelayMs = 500, ...fetchInit } = init;
    const doFetch = async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(input, { ...fetchInit, signal: controller.signal });
            return response;
        }
        finally {
            clearTimeout(timeoutId);
        }
    };
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const response = await doFetch();
            if (response.ok)
                return response;
            if (response.status >= 500) {
                lastError = new Error(`Server error ${response.status}`);
                if (attempt < retries) {
                    await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
                    continue;
                }
            }
            return response;
        }
        catch (err) {
            lastError = err;
            if (attempt < retries) {
                await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
            }
        }
    }
    throw lastError;
}
export function createApiClient(baseUrl) {
    const apiBase = baseUrl.replace(/\/$/, '');
    async function getJson(path) {
        const response = await fetchWithRetry(`${apiBase}${path}`);
        const body = await response.json();
        assertOk(response, body, path);
        return body;
    }
    async function postJson(path, payload) {
        const response = await fetchWithRetry(`${apiBase}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: payload ? JSON.stringify(payload) : undefined,
        });
        const body = await response.json();
        assertOk(response, body, path);
        return body;
    }
    async function delJson(path) {
        const response = await fetchWithRetry(`${apiBase}${path}`, { method: 'DELETE' });
        const body = await response.json();
        assertOk(response, body, path);
        return body;
    }
    return {
        health: () => getJson('/health'),
        listTrackings: () => getJson('/trackings'),
        getProductDetail: (asin) => getJson(`/products/${encodeURIComponent(asin)}/detail`),
        getDashboard: (chatId, options) => {
            const includeCardPreview = options?.includeCardPreview !== false;
            const query = includeCardPreview ? '?include=card-preview' : '';
            return getJson(`/api/dashboard/${encodeURIComponent(String(chatId))}${query}`);
        },
        getTrackings: (chatId) => getJson(`/api/trackings/${encodeURIComponent(String(chatId))}`),
        getSettings: (chatId) => getJson(`/api/settings/${encodeURIComponent(String(chatId))}`),
        updateThresholds: (asin, payload) => postJson(`/trackings/${encodeURIComponent(asin)}/thresholds`, payload),
        setDropPct: (chatId, asin, dropPct) => postJson(`/api/trackings/${encodeURIComponent(String(chatId))}/${encodeURIComponent(asin)}/drop-pct`, { dropPct }),
        refreshTracking: (asin) => postJson(`/api/refresh-all/${encodeURIComponent(asin)}`),
        snoozeTracking: (chatId, asin, minutes = 60) => postJson(`/api/trackings/${encodeURIComponent(String(chatId))}/${encodeURIComponent(asin)}/snooze`, { minutes }),
        unsnoozeTracking: (chatId, asin) => delJson(`/api/trackings/${encodeURIComponent(String(chatId))}/${encodeURIComponent(asin)}/snooze`),
        deleteTracking: (chatId, asin) => delJson(`/api/trackings/${encodeURIComponent(String(chatId))}/${encodeURIComponent(asin)}`),
        setProductInterval: (chatId, productIntervalMin) => postJson(`/api/settings/${encodeURIComponent(String(chatId))}/product-interval`, { productIntervalMin }),
        setScanInterval: (chatId, scanIntervalMin) => postJson(`/api/settings/${encodeURIComponent(String(chatId))}/scan-interval`, { scanIntervalMin }),
        setNotifications: (chatId, enabled) => postJson(`/api/settings/${encodeURIComponent(String(chatId))}/notifications`, { notifications: { enabled } }),
        getAlertProfiles: (chatId) => getJson(`/api/settings/${encodeURIComponent(String(chatId))}/alert-profiles`),
        setAlertProfiles: (chatId, alertProfiles) => postJson(`/api/settings/${encodeURIComponent(String(chatId))}/alert-profiles`, { alert_profiles: alertProfiles }),
        setNotificationChannels: (chatId, channels) => postJson(`/api/settings/${encodeURIComponent(String(chatId))}/notification-channels`, { notification_channels: channels }),
        savePreferences: (chatId, preferences) => postJson(`/api/settings/${encodeURIComponent(String(chatId))}/preferences`, preferences),
        getDeals: () => getJson('/api/keepa/deals'),
        addProduct: (payload) => postJson('/api/add-product', payload),
        getAlerts: (chatId) => getJson(`/api/alerts/${encodeURIComponent(String(chatId))}`),
        getScanKpi: () => getJson('/api/scan-kpi'),
        getKeepaStatus: () => getJson('/api/keepa/status'),
        getKeepaTokenUsage: () => getJson('/api/keepa/token-usage'),
        runScanNow: () => postJson('/api/scan/run-now'),
        getHunterConfig: () => getJson('/api/hunter-config'),
        getAlertDeliveryMetrics: (chatId) => getJson(`/api/alerts/${encodeURIComponent(String(chatId))}/delivery-metrics`),
    };
}
