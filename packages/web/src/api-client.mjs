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
