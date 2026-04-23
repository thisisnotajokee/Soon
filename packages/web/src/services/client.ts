export type ApiClient = ReturnType<typeof createApiClient>;

function assertOk(response: Response, body: unknown, context: string): void {
  if (!response.ok) {
    throw new Error(`${context} failed (${response.status}): ${JSON.stringify(body)}`);
  }
}

export interface FetchRetryOptions {
  retries?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}

async function fetchWithRetry(
  input: RequestInfo,
  init: RequestInit & FetchRetryOptions = {},
): Promise<Response> {
  const { retries = 2, timeoutMs = 15000, retryDelayMs = 500, ...fetchInit } = init;

  const doFetch = async (): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...fetchInit, signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await doFetch();
      if (response.ok) return response;
      if (response.status >= 500) {
        lastError = new Error(`Server error ${response.status}`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
          continue;
        }
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export function createApiClient(baseUrl: string) {
  const apiBase = baseUrl.replace(/\/$/, '');

  async function getJson(path: string) {
    const response = await fetchWithRetry(`${apiBase}${path}`);
    const body = await response.json();
    assertOk(response, body, path);
    return body;
  }

  async function postJson(path: string, payload?: unknown) {
    const response = await fetchWithRetry(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const body = await response.json();
    assertOk(response, body, path);
    return body;
  }

  async function delJson(path: string) {
    const response = await fetchWithRetry(`${apiBase}${path}`, { method: 'DELETE' });
    const body = await response.json();
    assertOk(response, body, path);
    return body;
  }

  return {
    health: () => getJson('/health'),
    listTrackings: () => getJson('/trackings'),
    getProductDetail: (asin: string) => getJson(`/products/${encodeURIComponent(asin)}/detail`),
    getDashboard: (chatId: string, options?: { includeCardPreview?: boolean }) => {
      const includeCardPreview = options?.includeCardPreview !== false;
      const query = includeCardPreview ? '?include=card-preview' : '';
      return getJson(`/api/dashboard/${encodeURIComponent(String(chatId))}${query}`);
    },
    getTrackings: (chatId: string) => getJson(`/api/trackings/${encodeURIComponent(String(chatId))}`),
    getSettings: (chatId: string) => getJson(`/api/settings/${encodeURIComponent(String(chatId))}`),
    updateThresholds: (asin: string, payload: unknown) =>
      postJson(`/trackings/${encodeURIComponent(asin)}/thresholds`, payload),
    setDropPct: (chatId: string, asin: string, dropPct: number | null) =>
      postJson(`/api/trackings/${encodeURIComponent(String(chatId))}/${encodeURIComponent(asin)}/drop-pct`, { dropPct }),
    refreshTracking: (asin: string) => postJson(`/api/refresh-all/${encodeURIComponent(asin)}`),
    snoozeTracking: (chatId: string, asin: string, minutes = 60) =>
      postJson(`/api/trackings/${encodeURIComponent(String(chatId))}/${encodeURIComponent(asin)}/snooze`, { minutes }),
    unsnoozeTracking: (chatId: string, asin: string) =>
      delJson(`/api/trackings/${encodeURIComponent(String(chatId))}/${encodeURIComponent(asin)}/snooze`),
    deleteTracking: (chatId: string, asin: string) =>
      delJson(`/api/trackings/${encodeURIComponent(String(chatId))}/${encodeURIComponent(asin)}`),
    setProductInterval: (chatId: string, productIntervalMin: number) =>
      postJson(`/api/settings/${encodeURIComponent(String(chatId))}/product-interval`, { productIntervalMin }),
    setScanInterval: (chatId: string, scanIntervalMin: number) =>
      postJson(`/api/settings/${encodeURIComponent(String(chatId))}/scan-interval`, { scanIntervalMin }),
    setNotifications: (chatId: string, enabled: boolean) =>
      postJson(`/api/settings/${encodeURIComponent(String(chatId))}/notifications`, { notifications: { enabled } }),
    getAlertProfiles: (chatId: string) =>
      getJson(`/api/settings/${encodeURIComponent(String(chatId))}/alert-profiles`),
    setAlertProfiles: (chatId: string, alertProfiles: unknown) =>
      postJson(`/api/settings/${encodeURIComponent(String(chatId))}/alert-profiles`, { alert_profiles: alertProfiles }),
    setNotificationChannels: (chatId: string, channels: unknown) =>
      postJson(`/api/settings/${encodeURIComponent(String(chatId))}/notification-channels`, { notification_channels: channels }),
    savePreferences: (chatId: string, preferences: unknown) =>
      postJson(`/api/settings/${encodeURIComponent(String(chatId))}/preferences`, preferences),
    getDeals: () => getJson('/api/keepa/deals'),
    addProduct: (payload: unknown) => postJson('/api/add-product', payload),
    getAlerts: (chatId: string) => getJson(`/api/alerts/${encodeURIComponent(String(chatId))}`),
    getScanKpi: () => getJson('/api/scan-kpi'),
    getKeepaStatus: () => getJson('/api/keepa/status'),
    getKeepaTokenUsage: () => getJson('/api/keepa/token-usage'),
    runScanNow: () => postJson('/api/scan/run-now'),
    getHunterConfig: () => getJson('/api/hunter-config'),
    getAlertDeliveryMetrics: (chatId: string) =>
      getJson(`/api/alerts/${encodeURIComponent(String(chatId))}/delivery-metrics`),
  };
}
