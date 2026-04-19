function assertOk(response, body, context) {
  if (!response.ok) {
    throw new Error(`${context} failed (${response.status}): ${JSON.stringify(body)}`);
  }
}

export function createApiClient(baseUrl) {
  const apiBase = baseUrl.replace(/\/$/, '');

  return {
    async health() {
      const response = await fetch(`${apiBase}/health`);
      const body = await response.json();
      assertOk(response, body, 'health');
      return body;
    },

    async listTrackings() {
      const response = await fetch(`${apiBase}/trackings`);
      const body = await response.json();
      assertOk(response, body, 'listTrackings');
      return body;
    },

    async getProductDetail(asin) {
      const response = await fetch(`${apiBase}/products/${encodeURIComponent(asin)}/detail`);
      const body = await response.json();
      assertOk(response, body, 'getProductDetail');
      return body;
    },

    async getDashboard(chatId, options = {}) {
      const includeCardPreview = options?.includeCardPreview !== false;
      const query = includeCardPreview ? '?include=card-preview' : '';
      const response = await fetch(`${apiBase}/api/dashboard/${encodeURIComponent(String(chatId))}${query}`);
      const body = await response.json();
      assertOk(response, body, 'getDashboard');
      return body;
    },

    async getTrackings(chatId) {
      const response = await fetch(`${apiBase}/api/trackings/${encodeURIComponent(String(chatId))}`);
      const body = await response.json();
      assertOk(response, body, 'getTrackings');
      return body;
    },

    async getSettings(chatId) {
      const response = await fetch(`${apiBase}/api/settings/${encodeURIComponent(String(chatId))}`);
      const body = await response.json();
      assertOk(response, body, 'getSettings');
      return body;
    },

    async updateThresholds(asin, payload) {
      const response = await fetch(`${apiBase}/trackings/${encodeURIComponent(asin)}/thresholds`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      assertOk(response, body, 'updateThresholds');
      return body;
    },

    async setDropPct(chatId, asin, dropPct) {
      const response = await fetch(
        `${apiBase}/api/trackings/${encodeURIComponent(String(chatId))}/${encodeURIComponent(asin)}/drop-pct`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dropPct }),
        },
      );
      const body = await response.json();
      assertOk(response, body, 'setDropPct');
      return body;
    },

    async refreshTracking(asin) {
      const response = await fetch(`${apiBase}/api/refresh/${encodeURIComponent(asin)}`, {
        method: 'POST',
      });
      const body = await response.json();
      assertOk(response, body, 'refreshTracking');
      return body;
    },

    async snoozeTracking(chatId, asin, minutes = 60) {
      const response = await fetch(
        `${apiBase}/api/trackings/${encodeURIComponent(String(chatId))}/${encodeURIComponent(asin)}/snooze`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ minutes }),
        },
      );
      const body = await response.json();
      assertOk(response, body, 'snoozeTracking');
      return body;
    },

    async unsnoozeTracking(chatId, asin) {
      const response = await fetch(
        `${apiBase}/api/trackings/${encodeURIComponent(String(chatId))}/${encodeURIComponent(asin)}/snooze`,
        {
          method: 'DELETE',
        },
      );
      const body = await response.json();
      assertOk(response, body, 'unsnoozeTracking');
      return body;
    },

    async deleteTracking(chatId, asin) {
      const response = await fetch(
        `${apiBase}/api/trackings/${encodeURIComponent(String(chatId))}/${encodeURIComponent(asin)}`,
        {
          method: 'DELETE',
        },
      );
      const body = await response.json();
      assertOk(response, body, 'deleteTracking');
      return body;
    },

    async setProductInterval(chatId, productIntervalMin) {
      const response = await fetch(`${apiBase}/api/settings/${encodeURIComponent(String(chatId))}/product-interval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productIntervalMin }),
      });
      const body = await response.json();
      assertOk(response, body, 'setProductInterval');
      return body;
    },

    async setScanInterval(chatId, scanIntervalMin) {
      const response = await fetch(`${apiBase}/api/settings/${encodeURIComponent(String(chatId))}/scan-interval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scanIntervalMin }),
      });
      const body = await response.json();
      assertOk(response, body, 'setScanInterval');
      return body;
    },

    async setNotifications(chatId, enabled) {
      const response = await fetch(`${apiBase}/api/settings/${encodeURIComponent(String(chatId))}/notifications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          notifications: { enabled: Boolean(enabled) },
        }),
      });
      const body = await response.json();
      assertOk(response, body, 'setNotifications');
      return body;
    },

    async getAlertProfiles(chatId) {
      const response = await fetch(`${apiBase}/api/settings/${encodeURIComponent(String(chatId))}/alert-profiles`);
      const body = await response.json();
      assertOk(response, body, 'getAlertProfiles');
      return body;
    },

    async setAlertProfiles(chatId, alertProfiles) {
      const response = await fetch(`${apiBase}/api/settings/${encodeURIComponent(String(chatId))}/alert-profiles`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alert_profiles: alertProfiles }),
      });
      const body = await response.json();
      assertOk(response, body, 'setAlertProfiles');
      return body;
    },

    async setNotificationChannels(chatId, channels) {
      const response = await fetch(
        `${apiBase}/api/settings/${encodeURIComponent(String(chatId))}/notification-channels`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ notification_channels: channels }),
        },
      );
      const body = await response.json();
      assertOk(response, body, 'setNotificationChannels');
      return body;
    },

    async runAutomationCycle() {
      const response = await fetch(`${apiBase}/automation/cycle`, { method: 'POST' });
      const body = await response.json();
      assertOk(response, body, 'runAutomationCycle');
      return body;
    },

    async getLatestAutomationRuns(limit = 20) {
      const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 20;
      const response = await fetch(
        `${apiBase}/automation/runs/latest?limit=${encodeURIComponent(String(safeLimit))}`,
      );
      const body = await response.json();
      assertOk(response, body, 'getLatestAutomationRuns');
      return body;
    },

    async getAutomationRunsSummary(limit = 20) {
      const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 20;
      const response = await fetch(
        `${apiBase}/automation/runs/summary?limit=${encodeURIComponent(String(safeLimit))}`,
      );
      const body = await response.json();
      assertOk(response, body, 'getAutomationRunsSummary');
      return body;
    },

    async getAutomationRunsTrends(days = 30) {
      const safeDays = Number.isFinite(Number(days)) ? Number(days) : 30;
      const response = await fetch(
        `${apiBase}/automation/runs/trends?days=${encodeURIComponent(String(safeDays))}`,
      );
      const body = await response.json();
      assertOk(response, body, 'getAutomationRunsTrends');
      return body;
    },

    async getAutomationRunsDaily(days = 30) {
      const safeDays = Number.isFinite(Number(days)) ? Number(days) : 30;
      const response = await fetch(
        `${apiBase}/automation/runs/daily?days=${encodeURIComponent(String(safeDays))}`,
      );
      const body = await response.json();
      assertOk(response, body, 'getAutomationRunsDaily');
      return body;
    },

    async getReadModelStatus() {
      const response = await fetch(`${apiBase}/automation/read-model/status`);
      const body = await response.json();
      assertOk(response, body, 'getReadModelStatus');
      return body;
    },

    async getRuntimeSelfHealStatus() {
      const response = await fetch(`${apiBase}/api/runtime-self-heal-status`);
      const body = await response.json();
      assertOk(response, body, 'getRuntimeSelfHealStatus');
      return body;
    },

    async getAlertRoutingStatus(limit = 20) {
      const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 20;
      const response = await fetch(`${apiBase}/api/check-alert-status?limit=${encodeURIComponent(String(safeLimit))}`);
      const body = await response.json();
      assertOk(response, body, 'getAlertRoutingStatus');
      return body;
    },

    async runSelfHealCycle() {
      const response = await fetch(`${apiBase}/self-heal/run`, { method: 'POST' });
      const body = await response.json();
      assertOk(response, body, 'runSelfHealCycle');
      return body;
    },

    async getLatestSelfHealRuns(limit = 20) {
      const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 20;
      const response = await fetch(
        `${apiBase}/self-heal/runs/latest?limit=${encodeURIComponent(String(safeLimit))}`,
      );
      const body = await response.json();
      assertOk(response, body, 'getLatestSelfHealRuns');
      return body;
    },

    async processSelfHealRetryQueue(limit = 20) {
      const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 20;
      const response = await fetch(`${apiBase}/self-heal/retry/process`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: safeLimit }),
      });
      const body = await response.json();
      assertOk(response, body, 'processSelfHealRetryQueue');
      return body;
    },

    async getSelfHealRetryStatus() {
      const response = await fetch(`${apiBase}/self-heal/retry/status`);
      const body = await response.json();
      assertOk(response, body, 'getSelfHealRetryStatus');
      return body;
    },

    async getSelfHealDeadLetter(limit = 20) {
      const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 20;
      const response = await fetch(
        `${apiBase}/self-heal/dead-letter?limit=${encodeURIComponent(String(safeLimit))}`,
      );
      const body = await response.json();
      assertOk(response, body, 'getSelfHealDeadLetter');
      return body;
    },

    async requeueSelfHealDeadLetter(deadLetterId) {
      const response = await fetch(`${apiBase}/self-heal/dead-letter/requeue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deadLetterId }),
      });
      const body = await response.json();
      assertOk(response, body, 'requeueSelfHealDeadLetter');
      return body;
    },

    async requeueSelfHealDeadLettersBulk(input = 20) {
      const requestBody = Array.isArray(input)
        ? { deadLetterIds: input }
        : typeof input === 'object' && input !== null
          ? {
              limit: Number.isFinite(Number(input.limit)) ? Number(input.limit) : 20,
              deadLetterIds: Array.isArray(input.deadLetterIds) ? input.deadLetterIds : undefined,
            }
          : { limit: Number.isFinite(Number(input)) ? Number(input) : 20 };
      const response = await fetch(`${apiBase}/self-heal/dead-letter/requeue-bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const responseBody = await response.json();
      assertOk(response, responseBody, 'requeueSelfHealDeadLettersBulk');
      return responseBody;
    },

    async getSelfHealRequeueAudit(input = 20) {
      const params = new URLSearchParams();
      const safeLimit =
        typeof input === 'object' && input !== null
          ? Number.isFinite(Number(input.limit))
            ? Number(input.limit)
            : 20
          : Number.isFinite(Number(input))
            ? Number(input)
            : 20;
      params.set('limit', String(safeLimit));

      if (typeof input === 'object' && input !== null) {
        if (typeof input.reason === 'string' && input.reason.trim()) {
          params.set('reason', input.reason.trim());
        }
        if (typeof input.from === 'string' && input.from.trim()) {
          params.set('from', input.from.trim());
        }
        if (typeof input.to === 'string' && input.to.trim()) {
          params.set('to', input.to.trim());
        }
      }

      const response = await fetch(`${apiBase}/self-heal/requeue-audit?${params.toString()}`);
      const body = await response.json();
      assertOk(response, body, 'getSelfHealRequeueAudit');
      return body;
    },

    async getSelfHealRequeueAuditSummary(days = 7) {
      const safeDays = Number.isFinite(Number(days)) ? Number(days) : 7;
      const response = await fetch(
        `${apiBase}/self-heal/requeue-audit/summary?days=${encodeURIComponent(String(safeDays))}`,
      );
      const body = await response.json();
      assertOk(response, body, 'getSelfHealRequeueAuditSummary');
      return body;
    },

    async getPrometheusMetrics() {
      const response = await fetch(`${apiBase}/metrics`);
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`getPrometheusMetrics failed (${response.status}): ${body}`);
      }
      return body;
    },
  };
}
