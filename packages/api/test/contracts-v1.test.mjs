import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoonApiServer } from '../src/runtime/server.mjs';
import { createInMemoryStore } from '../src/runtime/in-memory-store.mjs';

async function withServer(fn, options = {}) {
  const server = createSoonApiServer(options);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readJson(response) {
  const body = await response.json();
  return { status: response.status, body };
}

const TEST_DAY_SEED = Math.floor(Math.random() * 10000);
function testDay(offset = 0) {
  return new Date(Date.UTC(2036, 0, 1) + (TEST_DAY_SEED + offset) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

test('GET /health returns service status and modules', async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await readJson(await fetch(`${baseUrl}/health`));

    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'soon-api');
    assert.ok(Array.isArray(body.modules));
    assert.ok(body.modules.includes('tracking-core'));
    assert.ok(body.modules.includes('hunter-core'));
  });
});

test('P0-C: core auth/session compatibility endpoints', async () => {
  const store = createInMemoryStore();
  const previousAdminId = process.env.SOON_ADMIN_ID;
  process.env.SOON_ADMIN_ID = '2041';

  try {
    await withServer(
      async (baseUrl) => {
        const whoami = await readJson(
          await fetch(`${baseUrl}/api/auth/whoami`, {
            headers: { 'x-telegram-user-id': '2041', 'x-request-id': 'req-whoami' },
          }),
        );
        assert.equal(whoami.status, 200);
        assert.equal(whoami.body.userId, '2041');
        assert.equal(whoami.body.adminId, '2041');
        assert.equal(whoami.body.isAdmin, true);
        assert.equal(whoami.body.requestId, 'req-whoami');

        const status = await readJson(await fetch(`${baseUrl}/api/status`));
        assert.equal(status.status, 200);
        assert.ok(status.body.scheduler);
        assert.ok(Number.isFinite(Number(status.body.products)));
        assert.ok(Number.isFinite(Number(status.body.trackings)));
        assert.ok(Number.isFinite(Number(status.body.uptime)));

        const refreshUnauthorized = await readJson(await fetch(`${baseUrl}/api/session/refresh`, { method: 'POST' }));
        assert.equal(refreshUnauthorized.status, 401);
        assert.equal(refreshUnauthorized.body.error, 'Unauthorized');

        const refreshOk = await readJson(
          await fetch(`${baseUrl}/api/session/refresh`, {
            method: 'POST',
            headers: { 'x-telegram-user-id': '2041', 'x-request-id': 'req-refresh' },
          }),
        );
        assert.equal(refreshOk.status, 200);
        assert.equal(refreshOk.body.ok, true);
        assert.equal(refreshOk.body.userId, '2041');
        assert.ok(typeof refreshOk.body.webToken === 'string' && refreshOk.body.webToken.length > 16);
        assert.equal(refreshOk.body.requestId, 'req-refresh');

        const sessionsNowForbidden = await readJson(
          await fetch(`${baseUrl}/api/sessions/now`, { headers: { 'x-telegram-user-id': '9999' } }),
        );
        assert.equal(sessionsNowForbidden.status, 403);
        assert.equal(sessionsNowForbidden.body.error, 'forbidden');

        const sessionsNow = await readJson(
          await fetch(`${baseUrl}/api/sessions/now`, {
            headers: { 'x-telegram-user-id': '2041', 'x-request-id': 'req-now' },
          }),
        );
        assert.equal(sessionsNow.status, 200);
        assert.equal(sessionsNow.body.status, 'ok');
        assert.equal(sessionsNow.body.adminId, '2041');
        assert.equal(sessionsNow.body.requestId, 'req-now');
        assert.ok(sessionsNow.body.summary);
        assert.ok(sessionsNow.body.guard);

        const logoutOthers = await readJson(
          await fetch(`${baseUrl}/api/sessions/logout-others`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-telegram-user-id': '2041',
              'x-client-session-id': 'session-compat-2041',
              'x-request-id': 'req-logout',
            },
            body: JSON.stringify({ keepCurrent: true }),
          }),
        );
        assert.equal(logoutOthers.status, 200);
        assert.equal(logoutOthers.body.ok, true);
        assert.equal(logoutOthers.body.keepCurrent, true);
        assert.equal(logoutOthers.body.keepClientSessionIdSet, true);
        assert.equal(logoutOthers.body.requestId, 'req-logout');
      },
      { store },
    );
  } finally {
    if (previousAdminId === undefined) delete process.env.SOON_ADMIN_ID;
    else process.env.SOON_ADMIN_ID = previousAdminId;
  }
});

test('P0-C: core system/version/config compatibility endpoints', async () => {
  const store = createInMemoryStore();
  const previousAdminId = process.env.SOON_ADMIN_ID;
  process.env.SOON_ADMIN_ID = '2041';

  try {
    await withServer(
      async (baseUrl) => {
        const version = await readJson(await fetch(`${baseUrl}/api/version`, { headers: { 'x-request-id': 'req-version' } }));
        assert.equal(version.status, 200);
        assert.ok(typeof version.body.version === 'string');
        assert.ok(typeof version.body.serverTime === 'string');
        assert.ok(Number.isFinite(Number(version.body.uptime)));
        assert.equal(version.body.requestId, 'req-version');

        const configAdmin = await readJson(
          await fetch(`${baseUrl}/api/config`, { headers: { 'x-telegram-user-id': '2041' } }),
        );
        assert.equal(configAdmin.status, 200);
        assert.ok(configAdmin.body.adminPermissions);
        assert.equal(configAdmin.body.adminPermissions.isAdmin, true);
        assert.ok(typeof configAdmin.body.webToken === 'string' && configAdmin.body.webToken.length > 16);

        const launchForbidden = await readJson(
          await fetch(`${baseUrl}/api/launch-readiness`, { headers: { 'x-telegram-user-id': '9999' } }),
        );
        assert.equal(launchForbidden.status, 403);
        assert.equal(launchForbidden.body.error, 'Forbidden');

        const launchReady = await readJson(
          await fetch(`${baseUrl}/api/launch-readiness?windowSec=600`, { headers: { 'x-telegram-user-id': '2041' } }),
        );
        assert.equal(launchReady.status, 200);
        assert.ok(Array.isArray(launchReady.body.blockers));
        assert.ok(typeof launchReady.body.ready === 'boolean');

        const systemHealthPublic = await readJson(await fetch(`${baseUrl}/api/system-health`));
        assert.equal(systemHealthPublic.status, 200);
        assert.equal(systemHealthPublic.body.status, 'ok');
        assert.ok(!('modules' in systemHealthPublic.body));

        const systemHealthAdmin = await readJson(
          await fetch(`${baseUrl}/api/system-health`, { headers: { 'x-telegram-user-id': '2041' } }),
        );
        assert.equal(systemHealthAdmin.status, 200);
        assert.ok(Array.isArray(systemHealthAdmin.body.modules));
        assert.ok(systemHealthAdmin.body.operationalReadiness);

        const systemStatsForbidden = await readJson(await fetch(`${baseUrl}/api/system-stats`));
        assert.equal(systemStatsForbidden.status, 403);
        assert.equal(systemStatsForbidden.body.error, 'Forbidden');

        const systemStats = await readJson(
          await fetch(`${baseUrl}/api/system-stats`, { headers: { 'x-telegram-user-id': '2041' } }),
        );
        assert.equal(systemStats.status, 200);
        assert.ok(systemStats.body.cpu);
        assert.ok(systemStats.body.memory);
        assert.ok(typeof systemStats.body.capturedAt === 'string');

        const systemStatsHistory = await readJson(
          await fetch(`${baseUrl}/api/system-stats/history?range=1h`, { headers: { 'x-telegram-user-id': '2041' } }),
        );
        assert.equal(systemStatsHistory.status, 200);
        assert.equal(systemStatsHistory.body.range, '1h');
        assert.ok(Array.isArray(systemStatsHistory.body.points));
        assert.ok(Number.isFinite(Number(systemStatsHistory.body.totalCount)));

        const systemHealthHistory = await readJson(
          await fetch(`${baseUrl}/api/system-health/history`, { headers: { 'x-telegram-user-id': '2041' } }),
        );
        assert.equal(systemHealthHistory.status, 200);
        assert.ok(Array.isArray(systemHealthHistory.body.rows));
        assert.ok(Number.isFinite(Number(systemHealthHistory.body.count)));
      },
      { store },
    );
  } finally {
    if (previousAdminId === undefined) delete process.env.SOON_ADMIN_ID;
    else process.env.SOON_ADMIN_ID = previousAdminId;
  }
});

test('P0-C: mobile v1 auth/session compatibility endpoints', async () => {
  const store = createInMemoryStore();
  const previousAdminId = process.env.SOON_ADMIN_ID;
  process.env.SOON_ADMIN_ID = '2041';

  try {
    await withServer(
      async (baseUrl) => {
        const unauthorizedSession = await readJson(await fetch(`${baseUrl}/api/mobile/v1/session`));
        assert.equal(unauthorizedSession.status, 401);
        assert.equal(unauthorizedSession.body.error, 'Unauthorized');

        const login1 = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/auth/telegram`, {
            method: 'POST',
            headers: { 'x-telegram-user-id': '2041', 'x-request-id': 'req-mobile-login-1' },
          }),
        );
        assert.equal(login1.status, 200);
        assert.equal(login1.body.apiVersion, 'v1');
        assert.equal(login1.body.tokenType, 'Bearer');
        assert.equal(login1.body.userId, 2041);
        assert.equal(login1.body.isAdmin, true);
        assert.ok(typeof login1.body.accessToken === 'string' && login1.body.accessToken.length > 24);
        assert.ok(typeof login1.body.refreshToken === 'string' && login1.body.refreshToken.length > 24);
        assert.ok(Number.isInteger(login1.body.expiresIn));
        assert.ok(Number.isInteger(login1.body.refreshExpiresIn));
        assert.ok(Number.isInteger(login1.body.maxSessionsPerUser));
        assert.ok(Array.isArray(login1.body.revokedSessionIds));

        const refreshBad = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-request-id': 'req-mobile-refresh-bad' },
            body: JSON.stringify({ refreshToken: 'bad-token' }),
          }),
        );
        assert.equal(refreshBad.status, 401);
        assert.equal(refreshBad.body.error, 'Unauthorized');
        assert.equal(refreshBad.body.requestId, 'req-mobile-refresh-bad');

        const refreshOk = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-request-id': 'req-mobile-refresh-ok' },
            body: JSON.stringify({ refreshToken: login1.body.refreshToken }),
          }),
        );
        assert.equal(refreshOk.status, 200);
        assert.equal(refreshOk.body.apiVersion, 'v1');
        assert.equal(refreshOk.body.tokenType, 'Bearer');
        assert.ok(typeof refreshOk.body.accessToken === 'string' && refreshOk.body.accessToken.length > 24);
        assert.ok(typeof refreshOk.body.refreshToken === 'string' && refreshOk.body.refreshToken.length > 24);

        const sessionOk = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/session`, {
            headers: { authorization: `Bearer ${refreshOk.body.accessToken}` },
          }),
        );
        assert.equal(sessionOk.status, 200);
        assert.equal(sessionOk.body.apiVersion, 'v1');
        assert.equal(sessionOk.body.userId, 2041);
        assert.equal(sessionOk.body.isAdmin, true);
        assert.ok(typeof sessionOk.body.serverTime === 'string');

        const sessions1 = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/auth/sessions`, {
            headers: { authorization: `Bearer ${refreshOk.body.accessToken}` },
          }),
        );
        assert.equal(sessions1.status, 200);
        assert.equal(sessions1.body.apiVersion, 'v1');
        assert.ok(Number.isInteger(sessions1.body.maxSessionsPerUser));
        assert.ok(Array.isArray(sessions1.body.items));
        assert.ok(sessions1.body.items.length >= 1);
        const current1 = sessions1.body.items.find((item) => item.isCurrent);
        assert.ok(current1);
        assert.ok(current1.sessionId);

        const login2 = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/auth/telegram`, {
            method: 'POST',
            headers: { 'x-telegram-user-id': '2041', 'x-request-id': 'req-mobile-login-2' },
          }),
        );
        assert.equal(login2.status, 200);
        assert.ok(typeof login2.body.accessToken === 'string' && login2.body.accessToken.length > 24);

        const sessions2 = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/auth/sessions`, {
            headers: { authorization: `Bearer ${login2.body.accessToken}` },
          }),
        );
        assert.equal(sessions2.status, 200);
        const current2 = sessions2.body.items.find((item) => item.isCurrent);
        assert.ok(current2 && current2.sessionId);
        const previousSession = sessions2.body.items.find((item) => item.sessionId !== current2.sessionId && item.isActive);
        assert.ok(previousSession && previousSession.sessionId);

        const revokeMissing = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/auth/sessions/revoke`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${login2.body.accessToken}`,
              'content-type': 'application/json',
              'x-request-id': 'req-mobile-revoke-missing',
            },
            body: JSON.stringify({}),
          }),
        );
        assert.equal(revokeMissing.status, 400);
        assert.equal(revokeMissing.body.error, 'sessionId required');
        assert.equal(revokeMissing.body.requestId, 'req-mobile-revoke-missing');

        const revokeOk = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/auth/sessions/revoke`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${login2.body.accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ sessionId: previousSession.sessionId }),
          }),
        );
        assert.equal(revokeOk.status, 200);
        assert.equal(revokeOk.body.apiVersion, 'v1');
        assert.equal(revokeOk.body.ok, true);

        const logoutAll = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/auth/logout-all`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${login2.body.accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ includeCurrent: false }),
          }),
        );
        assert.equal(logoutAll.status, 200);
        assert.equal(logoutAll.body.apiVersion, 'v1');
        assert.equal(logoutAll.body.ok, true);
        assert.ok(Number.isInteger(logoutAll.body.revokedCount));

        const logout = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/auth/logout`, {
            method: 'POST',
            headers: { authorization: `Bearer ${login2.body.accessToken}` },
          }),
        );
        assert.equal(logout.status, 200);
        assert.equal(logout.body.apiVersion, 'v1');
        assert.equal(logout.body.ok, true);

        const sessionAfterLogout = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/session`, {
            headers: { authorization: `Bearer ${login2.body.accessToken}` },
          }),
        );
        assert.equal(sessionAfterLogout.status, 401);
        assert.equal(sessionAfterLogout.body.error, 'Unauthorized');
      },
      { store },
    );
  } finally {
    if (previousAdminId === undefined) delete process.env.SOON_ADMIN_ID;
    else process.env.SOON_ADMIN_ID = previousAdminId;
  }
});

test('P0-C: mobile v1 data compatibility endpoints (dashboard/trackings/detail)', async () => {
  const store = createInMemoryStore();
  const previousAdminId = process.env.SOON_ADMIN_ID;
  process.env.SOON_ADMIN_ID = '2041';

  try {
    await withServer(
      async (baseUrl) => {
        const login = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/auth/telegram`, {
            method: 'POST',
            headers: { 'x-telegram-user-id': '2041' },
          }),
        );
        assert.equal(login.status, 200);
        const accessToken = login.body.accessToken;
        assert.ok(typeof accessToken === 'string' && accessToken.length > 24);

        const dashboard = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/dashboard`, {
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        );
        assert.equal(dashboard.status, 200);
        assert.equal(dashboard.body.apiVersion, 'v1');
        assert.ok(Number.isInteger(dashboard.body.trackedProducts));
        assert.ok(dashboard.body.summary);

        const trackings = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/trackings?limit=2&offset=0`, {
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        );
        assert.equal(trackings.status, 200);
        assert.equal(trackings.body.apiVersion, 'v1');
        assert.ok(trackings.body.pagination);
        assert.ok(Array.isArray(trackings.body.items));
        assert.ok(trackings.body.items.length >= 1);

        const first = trackings.body.items[0];
        assert.ok(first.asin);
        assert.ok(Object.prototype.hasOwnProperty.call(first, 'marketPrices'));
        assert.ok(Object.prototype.hasOwnProperty.call(first, 'marketPricesUsed'));
        assert.ok(Array.isArray(first.priceTrend));

        const detail = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/products/${encodeURIComponent(first.asin)}/detail`, {
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        );
        assert.equal(detail.status, 200);
        assert.equal(detail.body.apiVersion, 'v1');
        assert.equal(detail.body.asin, first.asin);
        assert.ok(detail.body.thresholds);
        assert.ok(Array.isArray(detail.body.historyPoints));

        const deals = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/deals?limit=2`, {
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        );
        assert.equal(deals.status, 200);
        assert.equal(deals.body.apiVersion, 'v1');
        assert.ok(Array.isArray(deals.body.items));
        assert.ok(deals.body.pagination);
        assert.ok(deals.body.filters);

        const preferences = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/trackings/${encodeURIComponent(first.asin)}/preferences`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              targetPrice: 1999.99,
              targetPriceUsed: 1799.99,
              alertDropPct: 12,
              enabledDomains: ['de', 'nl'],
              scanInterval: 6,
            }),
          }),
        );
        assert.equal(preferences.status, 200);
        assert.equal(preferences.body.apiVersion, 'v1');
        assert.equal(preferences.body.ok, true);
        assert.equal(preferences.body.item.asin, first.asin);
        assert.equal(preferences.body.item.targetPrice, 1999.99);
        assert.equal(preferences.body.item.targetPriceUsed, 1799.99);
        assert.equal(preferences.body.item.alertDropPct, 12);

        const snooze = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/trackings/${encodeURIComponent(first.asin)}/snooze`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ days: 3 }),
          }),
        );
        assert.equal(snooze.status, 200);
        assert.equal(snooze.body.apiVersion, 'v1');
        assert.equal(snooze.body.ok, true);
        assert.equal(snooze.body.days, 3);
        assert.ok(snooze.body.item.snoozedUntil);

        const unsnooze = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/trackings/${encodeURIComponent(first.asin)}/snooze`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        );
        assert.equal(unsnooze.status, 200);
        assert.equal(unsnooze.body.apiVersion, 'v1');
        assert.equal(unsnooze.body.ok, true);
        assert.equal(unsnooze.body.item.snoozedUntil, null);

        const webDealsHistory = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/web-deals/history?limit=5`, {
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        );
        assert.equal(webDealsHistory.status, 200);
        assert.equal(webDealsHistory.body.apiVersion, 'v1');
        assert.ok(Array.isArray(webDealsHistory.body.rows));
        assert.ok(webDealsHistory.body.meta);

        const mobileDelete = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/trackings/${encodeURIComponent(first.asin)}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        );
        assert.equal(mobileDelete.status, 200);
        assert.equal(mobileDelete.body.apiVersion, 'v1');
        assert.equal(mobileDelete.body.ok, true);
        assert.equal(mobileDelete.body.deleted, 1);

        const trackingsAfterDelete = await readJson(
          await fetch(`${baseUrl}/api/mobile/v1/trackings?limit=20`, {
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        );
        assert.equal(trackingsAfterDelete.status, 200);
        assert.ok(trackingsAfterDelete.body.items.every((item) => item.asin !== first.asin));

        const unauthorizedTrackings = await readJson(await fetch(`${baseUrl}/api/mobile/v1/trackings`));
        assert.equal(unauthorizedTrackings.status, 401);
        assert.equal(unauthorizedTrackings.body.error, 'Unauthorized');
      },
      { store },
    );
  } finally {
    if (previousAdminId === undefined) delete process.env.SOON_ADMIN_ID;
    else process.env.SOON_ADMIN_ID = previousAdminId;
  }
});

test('P0-C: core live logs compatibility endpoint', async () => {
  const store = createInMemoryStore();
  const previousAdminId = process.env.SOON_ADMIN_ID;
  process.env.SOON_ADMIN_ID = '2041';

  try {
    await withServer(
      async (baseUrl) => {
        const forbidden = await readJson(
          await fetch(`${baseUrl}/api/logs?limit=20`, {
            headers: { 'x-telegram-user-id': '9999', 'x-request-id': 'req-logs-forbidden' },
          }),
        );
        assert.equal(forbidden.status, 403);
        assert.equal(forbidden.body.error, 'forbidden');
        assert.equal(forbidden.body.requestId, 'req-logs-forbidden');

        const first = await readJson(
          await fetch(`${baseUrl}/api/logs?limit=20`, {
            headers: { 'x-telegram-user-id': '2041', 'x-request-id': 'req-logs-1' },
          }),
        );
        assert.equal(first.status, 200);
        assert.ok(Array.isArray(first.body.items));
        assert.ok(first.body.items.length >= 1);
        assert.ok(Number.isFinite(Number(first.body.nextId)));
        assert.equal(first.body.maxEntries, 1200);
        const sample = first.body.items[first.body.items.length - 1];
        assert.ok(Number.isFinite(Number(sample.id)));
        assert.ok(typeof sample.ts === 'string' && sample.ts.length > 10);
        assert.ok(typeof sample.level === 'string');
        assert.ok(typeof sample.message === 'string');

        const second = await readJson(
          await fetch(`${baseUrl}/api/logs?sinceId=${encodeURIComponent(first.body.nextId)}&limit=50`, {
            headers: { 'x-telegram-user-id': '2041', 'x-request-id': 'req-logs-2' },
          }),
        );
        assert.equal(second.status, 200);
        assert.ok(Array.isArray(second.body.items));
        assert.ok(second.body.nextId >= first.body.nextId);
      },
      { store },
    );
  } finally {
    if (previousAdminId === undefined) delete process.env.SOON_ADMIN_ID;
    else process.env.SOON_ADMIN_ID = previousAdminId;
  }
});

test('GET /trackings returns seeded list', async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await readJson(await fetch(`${baseUrl}/trackings`));

    assert.equal(status, 200);
    assert.ok(Array.isArray(body.items));
    assert.ok(body.items.length >= 1);
    assert.ok(body.items[0].asin);
    assert.ok(body.items[0].pricesNew);
  });
});

test('POST /trackings/:asin/thresholds persists values', async () => {
  await withServer(async (baseUrl) => {
    const trackings = await readJson(await fetch(`${baseUrl}/trackings`));
    const asin = trackings.body.items[0].asin;

    const updateRes = await readJson(
      await fetch(`${baseUrl}/trackings/${asin}/thresholds`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thresholdDropPct: 22,
          thresholdRisePct: 14,
          targetPriceNew: 199.99,
          targetPriceUsed: 179.99,
        }),
      }),
    );

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.thresholds.thresholdDropPct, 22);

    const detail = await readJson(await fetch(`${baseUrl}/products/${asin}/detail`));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.thresholds.thresholdDropPct, 22);
    assert.equal(detail.body.thresholds.targetPriceUsed, 179.99);
  });
});

test('P0-C: /api/trackings/save + /api/dashboard/:chatId + DELETE /api/trackings/:chatId/:asin', async () => {
  await withServer(async (baseUrl) => {
    const asin = 'B0P0CTRACK01';
    const asinAlias = 'B0P0CADD001';
    const chatId = '2041';

    const saved = await readJson(
      await fetch(`${baseUrl}/api/trackings/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          asin,
          title: 'P0-C Tracking',
          pricesNew: { de: 123.45 },
          pricesUsed: { de: 111.11 },
          thresholdDropPct: 9,
        }),
      }),
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.status, 'saved');
    assert.equal(saved.body.item.asin, asin);

    const savedAlias = await readJson(
      await fetch(`${baseUrl}/api/add-product`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          asin: asinAlias,
          title: 'P0-C Add Product Alias',
          pricesNew: { de: 222.22 },
          thresholdDropPct: 12,
        }),
      }),
    );
    assert.equal(savedAlias.status, 200);
    assert.equal(savedAlias.body.status, 'saved');
    assert.equal(savedAlias.body.item.asin, asinAlias);

    const dashboard = await readJson(await fetch(`${baseUrl}/api/dashboard/${chatId}`));
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.chatId, chatId);
    assert.ok(Array.isArray(dashboard.body.items));
    assert.ok(dashboard.body.items.some((item) => item.asin === asin));
    assert.ok(dashboard.body.items.some((item) => item.asin === asinAlias));

    const trackingsCompat = await readJson(await fetch(`${baseUrl}/api/trackings/${chatId}`));
    assert.equal(trackingsCompat.status, 200);
    assert.ok(Array.isArray(trackingsCompat.body));
    assert.ok(trackingsCompat.body.some((item) => item.asin === asin));
    assert.ok(trackingsCompat.body.some((item) => item.asin === asinAlias));
    const sampleCompat = trackingsCompat.body.find((item) => item.asin === asinAlias);
    assert.equal(sampleCompat?.last_checked, null);
    assert.equal(sampleCompat?.chat_id, chatId);

    const removed = await readJson(await fetch(`${baseUrl}/api/trackings/${chatId}/${asin}`, { method: 'DELETE' }));
    assert.equal(removed.status, 200);
    assert.equal(removed.body.status, 'deleted');

    const dashboardAfterDelete = await readJson(await fetch(`${baseUrl}/api/dashboard/${chatId}`));
    assert.equal(dashboardAfterDelete.status, 200);
    assert.ok(!dashboardAfterDelete.body.items.some((item) => item.asin === asin));
    assert.ok(dashboardAfterDelete.body.items.some((item) => item.asin === asinAlias));
  });
});

test('P0-C: /api/history/:asin + /api/refresh/:asin + /api/refresh-all/:chatId', async () => {
  const previousAdminId = process.env.SOON_ADMIN_ID;
  process.env.SOON_ADMIN_ID = '2041';

  try {
    await withServer(async (baseUrl) => {
      const trackings = await readJson(await fetch(`${baseUrl}/trackings`));
      const asin = trackings.body.items[0].asin;

      const history = await readJson(await fetch(`${baseUrl}/api/history/${asin}`));
      assert.equal(history.status, 200);
      assert.equal(history.body.asin, asin);
      assert.ok(Array.isArray(history.body.items));
      assert.ok(history.body.count >= 1);

      const refreshed = await readJson(await fetch(`${baseUrl}/api/refresh/${asin}`, { method: 'POST' }));
      assert.equal(refreshed.status, 200);
      assert.equal(refreshed.body.status, 'refreshed');
      assert.equal(refreshed.body.asin, asin);

      const refreshAll = await readJson(await fetch(`${baseUrl}/api/refresh-all/2041`, { method: 'POST' }));
      assert.equal(refreshAll.status, 200);
      assert.equal(refreshAll.body.status, 'queued');
      assert.equal(refreshAll.body.chatId, '2041');
      assert.ok(refreshAll.body.jobId);

      const refreshAllStatus = await readJson(
        await fetch(`${baseUrl}/api/refresh-all/2041/status/${encodeURIComponent(refreshAll.body.jobId)}`),
      );
      assert.equal(refreshAllStatus.status, 200);
      assert.equal(refreshAllStatus.body.status, 'completed');
      assert.equal(refreshAllStatus.body.chatId, '2041');
      assert.equal(refreshAllStatus.body.jobId, refreshAll.body.jobId);
      assert.equal(refreshAllStatus.body.total, refreshAll.body.total);
      assert.equal(refreshAllStatus.body.pending, 0);

      const refreshBudgetRestricted = await readJson(await fetch(`${baseUrl}/api/refresh-budget/9999`));
      assert.equal(refreshBudgetRestricted.status, 200);
      assert.equal(refreshBudgetRestricted.body.restricted, true);
      assert.equal(refreshBudgetRestricted.body.reason, 'free_plan_no_manual_refresh');

      const refreshBudgetAdmin = await readJson(await fetch(`${baseUrl}/api/refresh-budget/2041`));
      assert.equal(refreshBudgetAdmin.status, 200);
      assert.ok(Number.isFinite(Number(refreshBudgetAdmin.body.budget)));
      assert.ok(Number.isFinite(Number(refreshBudgetAdmin.body.used)));
      assert.ok(Number.isFinite(Number(refreshBudgetAdmin.body.remaining)));
      assert.ok(Number.isFinite(Number(refreshBudgetAdmin.body.retryInSec)));
      assert.ok(typeof refreshBudgetAdmin.body.bucket === 'string' && refreshBudgetAdmin.body.bucket.length >= 10);
    });
  } finally {
    if (previousAdminId === undefined) delete process.env.SOON_ADMIN_ID;
    else process.env.SOON_ADMIN_ID = previousAdminId;
  }
});

test('P0-C: /api/trackings/:chatId/:asin/drop-pct updates per-item threshold', async () => {
  await withServer(async (baseUrl) => {
    const trackings = await readJson(await fetch(`${baseUrl}/trackings`));
    const asin = trackings.body.items[0].asin;
    const chatId = '2041';

    const updated = await readJson(
      await fetch(`${baseUrl}/api/trackings/${chatId}/${asin}/drop-pct`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dropPct: 17 }),
      }),
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.status, 'updated');
    assert.equal(updated.body.chatId, chatId);
    assert.equal(updated.body.asin, asin);
    assert.equal(updated.body.dropPct, 17);
    assert.equal(updated.body.thresholdDropPct, 17);

    const detail = await readJson(await fetch(`${baseUrl}/products/${asin}/detail`));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.thresholds.thresholdDropPct, 17);
  });
});

test('P0-C: snooze + product interval settings contracts', async () => {
  await withServer(async (baseUrl) => {
    const trackings = await readJson(await fetch(`${baseUrl}/trackings`));
    const asin = trackings.body.items[0].asin;
    const chatId = '777';

    const snooze = await readJson(
      await fetch(`${baseUrl}/api/trackings/${chatId}/${asin}/snooze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minutes: 30, reason: 'test' }),
      }),
    );
    assert.equal(snooze.status, 200);
    assert.equal(snooze.body.status, 'snoozed');
    assert.equal(snooze.body.chatId, chatId);
    assert.equal(snooze.body.asin, asin);

    const settings = await readJson(
      await fetch(`${baseUrl}/api/settings/${chatId}/product-interval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productIntervalMin: 45 }),
      }),
    );
    assert.equal(settings.status, 200);
    assert.equal(settings.body.status, 'updated');
    assert.equal(settings.body.chatId, chatId);
    assert.equal(settings.body.productIntervalMin, 45);

    const scanSettings = await readJson(
      await fetch(`${baseUrl}/api/settings/${chatId}/scan-interval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scanIntervalMin: 30 }),
      }),
    );
    assert.equal(scanSettings.status, 200);
    assert.equal(scanSettings.body.status, 'updated');
    assert.equal(scanSettings.body.chatId, chatId);
    assert.equal(scanSettings.body.scanIntervalMin, 30);

    const settingsRead = await readJson(await fetch(`${baseUrl}/api/settings/${chatId}`));
    assert.equal(settingsRead.status, 200);
    assert.equal(settingsRead.body.chatId, chatId);
    assert.equal(settingsRead.body.productIntervalMin, 45);
    assert.equal(settingsRead.body.scanIntervalMin, 30);
    assert.equal(settingsRead.body.notificationsEnabled, true);

    const dashboard = await readJson(await fetch(`${baseUrl}/api/dashboard/${chatId}`));
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.settings.productIntervalMin, 45);
    const tracked = dashboard.body.items.find((item) => item.asin === asin);
    assert.ok(tracked?.snooze);
    assert.equal(tracked.snooze.chatId, chatId);

    const unsnooze = await readJson(await fetch(`${baseUrl}/api/trackings/${chatId}/${asin}/snooze`, { method: 'DELETE' }));
    assert.equal(unsnooze.status, 200);
    assert.equal(unsnooze.body.status, 'unsnoozed');
  });
});

test('P0-C: /api/settings/:chatId/trackings-cache-runtime requires admin and returns runtime payload', async () => {
  const previousAdminId = process.env.SOON_ADMIN_ID;
  process.env.SOON_ADMIN_ID = '2041';

  try {
    await withServer(async (baseUrl) => {
      const forbidden = await readJson(
        await fetch(`${baseUrl}/api/settings/2041/trackings-cache-runtime`, {
          headers: { 'x-telegram-user-id': '9999', 'x-request-id': 'req-cache-runtime-forbidden' },
        }),
      );
      assert.equal(forbidden.status, 403);
      assert.equal(forbidden.body.error, 'forbidden');
      assert.equal(forbidden.body.requestId, 'req-cache-runtime-forbidden');

      const ok = await readJson(
        await fetch(`${baseUrl}/api/settings/2041/trackings-cache-runtime`, {
          headers: { 'x-telegram-user-id': '2041', 'x-request-id': 'req-cache-runtime-ok' },
        }),
      );
      assert.equal(ok.status, 200);
      assert.equal(ok.body.success, true);
      assert.equal(ok.body.chatId, '2041');
      assert.ok(ok.body.runtime && typeof ok.body.runtime === 'object');
      assert.ok(Array.isArray(ok.body.history));
      assert.ok(ok.body.history.length >= 1);
      assert.ok(ok.body.autotune === null || typeof ok.body.autotune === 'object');

      const ttlForbidden = await readJson(
        await fetch(`${baseUrl}/api/settings/2041/trackings-cache-ttl`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-telegram-user-id': '9999',
            'x-request-id': 'req-cache-ttl-forbidden',
          },
          body: JSON.stringify({ ttl_ms: 45000 }),
        }),
      );
      assert.equal(ttlForbidden.status, 403);
      assert.equal(ttlForbidden.body.error, 'forbidden');
      assert.equal(ttlForbidden.body.requestId, 'req-cache-ttl-forbidden');

      const ttlUpdated = await readJson(
        await fetch(`${baseUrl}/api/settings/2041/trackings-cache-ttl`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-telegram-user-id': '2041',
            'x-request-id': 'req-cache-ttl-ok',
          },
          body: JSON.stringify({ ttl_ms: 45000 }),
        }),
      );
      assert.equal(ttlUpdated.status, 200);
      assert.equal(ttlUpdated.body.success, true);
      assert.equal(ttlUpdated.body.chatId, '2041');
      assert.equal(ttlUpdated.body.runtime.ttlMs, 45000);

      const runtimeAfterTtl = await readJson(
        await fetch(`${baseUrl}/api/settings/2041/trackings-cache-runtime`, {
          headers: { 'x-telegram-user-id': '2041' },
        }),
      );
      assert.equal(runtimeAfterTtl.status, 200);
      assert.equal(runtimeAfterTtl.body.runtime.ttlMs, 45000);
    });
  } finally {
    if (previousAdminId === undefined) delete process.env.SOON_ADMIN_ID;
    else process.env.SOON_ADMIN_ID = previousAdminId;
  }
});

test('P0-C: /api/settings/:chatId/global-scan-interval requires admin and validates payload', async () => {
  const previousAdminId = process.env.SOON_ADMIN_ID;
  process.env.SOON_ADMIN_ID = '2041';

  try {
    await withServer(async (baseUrl) => {
      const forbidden = await readJson(
        await fetch(`${baseUrl}/api/settings/2041/global-scan-interval`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '9999', 'x-request-id': 'req-gsi-forbidden' },
          body: JSON.stringify({ hours: 6 }),
        }),
      );
      assert.equal(forbidden.status, 403);
      assert.equal(forbidden.body.error, 'forbidden');
      assert.equal(forbidden.body.requestId, 'req-gsi-forbidden');

      const invalid = await readJson(
        await fetch(`${baseUrl}/api/settings/2041/global-scan-interval`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041', 'x-request-id': 'req-gsi-invalid' },
          body: JSON.stringify({}),
        }),
      );
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.error, 'Global interval invalid');
      assert.equal(invalid.body.requestId, 'req-gsi-invalid');

      const ok = await readJson(
        await fetch(`${baseUrl}/api/settings/2041/global-scan-interval`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041', 'x-request-id': 'req-gsi-ok' },
          body: JSON.stringify({ hours: 8 }),
        }),
      );
      assert.equal(ok.status, 200);
      assert.equal(ok.body.success, true);
      assert.equal(ok.body.chatId, '2041');
      assert.equal(ok.body.scan_interval_hours, 8);
      assert.ok(typeof ok.body.next_scan_at === 'string' && ok.body.next_scan_at.length > 10);
    });
  } finally {
    if (previousAdminId === undefined) delete process.env.SOON_ADMIN_ID;
    else process.env.SOON_ADMIN_ID = previousAdminId;
  }
});

test('P0-C: /api/settings/:chatId/drop-pct validates payload and persists default', async () => {
  await withServer(async (baseUrl) => {
    const invalid = await readJson(
      await fetch(`${baseUrl}/api/settings/777/drop-pct`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-drop-invalid' },
        body: JSON.stringify({}),
      }),
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'Pct invalid');
    assert.equal(invalid.body.requestId, 'req-drop-invalid');

    const ok = await readJson(
      await fetch(`${baseUrl}/api/settings/777/drop-pct`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-drop-ok' },
        body: JSON.stringify({ pct: 24 }),
      }),
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    assert.equal(ok.body.chatId, '777');
    assert.equal(ok.body.default_drop_pct, 24);

    const settings = await readJson(await fetch(`${baseUrl}/api/settings/777`));
    assert.equal(settings.status, 200);
    assert.equal(settings.body.chatId, '777');
    assert.equal(settings.body.default_drop_pct, 24);
  });
});

test('P0-C: /api/settings/:chatId/notifications validates payload and persists', async () => {
  await withServer(async (baseUrl) => {
    const invalid = await readJson(
      await fetch(`${baseUrl}/api/settings/777/notifications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(null),
      }),
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'Invalid notifications payload');

    const ok = await readJson(
      await fetch(`${baseUrl}/api/settings/777/notifications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          price_drop: true,
          stock_back: 1,
          silent_mode: 0,
        }),
      }),
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
  });
});

test('P0-C: /api/settings/:chatId/notification-channels validates payload and persists', async () => {
  await withServer(async (baseUrl) => {
    const invalid = await readJson(
      await fetch(`${baseUrl}/api/settings/777/notification-channels`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notification_channels: [] }),
      }),
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'notification_channels invalid');

    const ok = await readJson(
      await fetch(`${baseUrl}/api/settings/777/notification-channels`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          notification_channels: {
            telegram: true,
            discord: false,
            web: true,
          },
        }),
      }),
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    assert.deepEqual(ok.body.notification_channels, {
      telegram: true,
      discord: false,
      web: true,
    });
  });
});

test('P0-C: /api/settings/:chatId/alert-profiles read/write compatibility', async () => {
  await withServer(async (baseUrl) => {
    const initial = await readJson(await fetch(`${baseUrl}/api/settings/777/alert-profiles`));
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.alert_profiles, {});

    const invalid = await readJson(
      await fetch(`${baseUrl}/api/settings/777/alert-profiles`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alert_profiles: [] }),
      }),
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'Invalid alert_profiles payload');

    const payload = {
      buy_box: { enabled: true, min_drop_pct: 12 },
      warehouse: { enabled: false, min_drop_pct: 20 },
    };
    const saved = await readJson(
      await fetch(`${baseUrl}/api/settings/777/alert-profiles`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alert_profiles: payload }),
      }),
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.success, true);
    assert.deepEqual(saved.body.alert_profiles, payload);

    const reread = await readJson(await fetch(`${baseUrl}/api/settings/777/alert-profiles`));
    assert.equal(reread.status, 200);
    assert.deepEqual(reread.body.alert_profiles, payload);
  });
});

test('P0-C: /api/settings/:chatId/scan-policy read/write compatibility with admin guard', async () => {
  const previousAdminId = process.env.SOON_ADMIN_ID;
  process.env.SOON_ADMIN_ID = '2041';

  try {
    await withServer(async (baseUrl) => {
      const initial = await readJson(await fetch(`${baseUrl}/api/settings/2041/scan-policy`));
      assert.equal(initial.status, 200);
      assert.equal(initial.body.success, true);
      assert.equal(typeof initial.body.canEdit, 'boolean');
      assert.ok(initial.body.scanPolicy && typeof initial.body.scanPolicy === 'object');
      assert.equal(typeof initial.body.scanPolicy.scanEnabled, 'boolean');
      assert.equal(typeof initial.body.scanPolicy.forceFullEachCycle, 'boolean');

      const forbidden = await readJson(
        await fetch(`${baseUrl}/api/settings/2041/scan-policy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '9999' },
          body: JSON.stringify({ forceFullEachCycle: true, postScanTokenRechargeMin: 10, idleScavengerMinWindowMin: 30 }),
        }),
      );
      assert.equal(forbidden.status, 403);
      assert.equal(forbidden.body.error, 'Forbidden');

      const invalid = await readJson(
        await fetch(`${baseUrl}/api/settings/2041/scan-policy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041' },
          body: JSON.stringify({ forceFullEachCycle: 'yes', postScanTokenRechargeMin: 10, idleScavengerMinWindowMin: 30 }),
        }),
      );
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.error, 'forceFullEachCycle must be boolean');

      const saved = await readJson(
        await fetch(`${baseUrl}/api/settings/2041/scan-policy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041' },
          body: JSON.stringify({
            scanEnabled: false,
            forceFullEachCycle: true,
            postScanTokenRechargeMin: 11,
            idleScavengerMinWindowMin: 33,
          }),
        }),
      );
      assert.equal(saved.status, 200);
      assert.equal(saved.body.success, true);
      assert.deepEqual(saved.body.scanPolicy, {
        scanEnabled: false,
        forceFullEachCycle: true,
        postScanTokenRechargeMin: 11,
        idleScavengerMinWindowMin: 33,
      });

      const reread = await readJson(
        await fetch(`${baseUrl}/api/settings/2041/scan-policy`, {
          headers: { 'x-telegram-user-id': '2041' },
        }),
      );
      assert.equal(reread.status, 200);
      assert.equal(reread.body.success, true);
      assert.equal(reread.body.canEdit, true);
      assert.deepEqual(reread.body.scanPolicy, {
        scanEnabled: false,
        forceFullEachCycle: true,
        postScanTokenRechargeMin: 11,
        idleScavengerMinWindowMin: 33,
      });
    });
  } finally {
    if (previousAdminId === undefined) delete process.env.SOON_ADMIN_ID;
    else process.env.SOON_ADMIN_ID = previousAdminId;
  }
});

test('P0-C: /api/settings/:chatId/preferences validates payload and persists', async () => {
  await withServer(async (baseUrl) => {
    const invalid = await readJson(
      await fetch(`${baseUrl}/api/settings/777/preferences`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([]),
      }),
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'Invalid preferences payload');

    const ok = await readJson(
      await fetch(`${baseUrl}/api/settings/777/preferences`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          alert_delivery_mode: 'instant',
          quiet_hours_start: 22,
          quiet_hours_end: 7,
          notification_channels: { telegram: true, discord: false },
          alert_profiles: { buy_box: { enabled: true } },
        }),
      }),
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);

    const profiles = await readJson(await fetch(`${baseUrl}/api/settings/777/alert-profiles`));
    assert.equal(profiles.status, 200);
    assert.deepEqual(profiles.body.alert_profiles, { buy_box: { enabled: true } });
  });
});

test('P0-C: admin bulk tracking compatibility endpoints', async () => {
  const previousAdminId = process.env.SOON_ADMIN_ID;
  process.env.SOON_ADMIN_ID = '2041';

  try {
    await withServer(async (baseUrl) => {
      const forbidden = await readJson(
        await fetch(`${baseUrl}/admin-api/trackings/deactivate-all`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '9999' },
          body: JSON.stringify({ confirm: true }),
        }),
      );
      assert.equal(forbidden.status, 403);
      assert.equal(forbidden.body.error, 'forbidden');

      const badConfirm = await readJson(
        await fetch(`${baseUrl}/admin-api/trackings/deactivate-all`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041' },
          body: JSON.stringify({ confirm: false }),
        }),
      );
      assert.equal(badConfirm.status, 400);
      assert.equal(badConfirm.body.error, 'confirm must be true');

      const deactivateAll = await readJson(
        await fetch(`${baseUrl}/admin-api/trackings/deactivate-all`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041' },
          body: JSON.stringify({ confirm: true }),
        }),
      );
      assert.equal(deactivateAll.status, 200);
      assert.equal(deactivateAll.body.success, true);
      assert.equal(deactivateAll.body.action, 'global_trackings_deactivate');
      assert.ok(Number.isFinite(Number(deactivateAll.body.total_trackings)));
      assert.ok(Number.isFinite(Number(deactivateAll.body.active_before)));
      assert.ok(Number.isFinite(Number(deactivateAll.body.deactivated)));

      const badDomains = await readJson(
        await fetch(`${baseUrl}/admin-api/trackings/deactivate-domains`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041' },
          body: JSON.stringify({ confirm: true, domains: ['xyz'] }),
        }),
      );
      assert.equal(badDomains.status, 400);
      assert.equal(badDomains.body.error, 'domains must include at least one of: de,it,fr,es,uk,nl');

      const deactivateDomains = await readJson(
        await fetch(`${baseUrl}/admin-api/trackings/deactivate-domains`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041' },
          body: JSON.stringify({ confirm: true, domains: ['de', 'nl', 'de'] }),
        }),
      );
      assert.equal(deactivateDomains.status, 200);
      assert.equal(deactivateDomains.body.success, true);
      assert.equal(deactivateDomains.body.action, 'global_trackings_deactivate_domains');
      assert.deepEqual(deactivateDomains.body.domains, ['de', 'nl']);
      assert.ok(Number.isFinite(Number(deactivateDomains.body.affected_rows)));

      const activateDomains = await readJson(
        await fetch(`${baseUrl}/admin-api/trackings/activate-domains`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041' },
          body: JSON.stringify({ confirm: true, domains: ['de'] }),
        }),
      );
      assert.equal(activateDomains.status, 200);
      assert.equal(activateDomains.body.success, true);
      assert.equal(activateDomains.body.action, 'global_trackings_activate_domains');
      assert.deepEqual(activateDomains.body.domains, ['de']);
      assert.ok(Number.isFinite(Number(activateDomains.body.affected_rows)));

      const activateAll = await readJson(
        await fetch(`${baseUrl}/admin-api/trackings/activate-all`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041' },
          body: JSON.stringify({ confirm: true }),
        }),
      );
      assert.equal(activateAll.status, 200);
      assert.equal(activateAll.body.success, true);
      assert.equal(activateAll.body.action, 'global_trackings_activate');
      assert.ok(Number.isFinite(Number(activateAll.body.affected_rows)));
      assert.ok(Number.isFinite(Number(activateAll.body.reactivated_rows)));
      assert.ok(Number.isFinite(Number(activateAll.body.domains_backfilled_rows)));
    });
  } finally {
    if (previousAdminId === undefined) delete process.env.SOON_ADMIN_ID;
    else process.env.SOON_ADMIN_ID = previousAdminId;
  }
});

test('P0-C: admin catalog delete compatibility endpoints', async () => {
  const previousAdminId = process.env.SOON_ADMIN_ID;
  process.env.SOON_ADMIN_ID = '2041';

  try {
    await withServer(async (baseUrl) => {
      const all = await readJson(await fetch(`${baseUrl}/trackings`));
      assert.equal(all.status, 200);
      assert.ok(all.body.count >= 1);
      const asin = all.body.items[0].asin;

      const badConfirm = await readJson(
        await fetch(`${baseUrl}/admin-api/data/products-global`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041' },
          body: JSON.stringify({ confirmText: 'WRONG' }),
        }),
      );
      assert.equal(badConfirm.status, 400);
      assert.equal(badConfirm.body.error, 'confirmText must be DELETE_ALL_PRODUCTS');

      const deleteSingle = await readJson(
        await fetch(`${baseUrl}/admin-api/data/products/${asin}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041' },
          body: JSON.stringify({ purgeAlertHistory: true }),
        }),
      );
      assert.equal(deleteSingle.status, 200);
      assert.equal(deleteSingle.body.success, true);
      assert.equal(deleteSingle.body.action, 'global_catalog_delete_single');
      assert.equal(deleteSingle.body.asin, asin);
      assert.equal(deleteSingle.body.mode, 'product_with_alert_history');
      assert.ok(Number.isFinite(Number(deleteSingle.body.deleted.products)));
      assert.ok(Number.isFinite(Number(deleteSingle.body.deleted.trackings)));

      const afterSingle = await readJson(await fetch(`${baseUrl}/trackings`));
      assert.equal(afterSingle.status, 200);
      assert.ok(!afterSingle.body.items.some((item) => item.asin === asin));

      const deleteGlobal = await readJson(
        await fetch(`${baseUrl}/admin-api/data/products-global`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json', 'x-telegram-user-id': '2041' },
          body: JSON.stringify({ confirmText: 'DELETE_ALL_PRODUCTS', mode: 'catalog_keep_alert_history' }),
        }),
      );
      assert.equal(deleteGlobal.status, 200);
      assert.equal(deleteGlobal.body.success, true);
      assert.equal(deleteGlobal.body.action, 'global_catalog_delete');
      assert.equal(deleteGlobal.body.mode, 'catalog_keep_alert_history');
      assert.ok(deleteGlobal.body.deleted);

      const afterGlobal = await readJson(await fetch(`${baseUrl}/trackings`));
      assert.equal(afterGlobal.status, 200);
      assert.equal(afterGlobal.body.count, 0);
    });
  } finally {
    if (previousAdminId === undefined) delete process.env.SOON_ADMIN_ID;
    else process.env.SOON_ADMIN_ID = previousAdminId;
  }
});

test('P0-D: keepa watch-state ingest + status endpoint', async () => {
  await withServer(async (baseUrl) => {
    const ingest = await readJson(
      await fetch(`${baseUrl}/api/keepa/watch-state/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [
            { asin: 'B0BYW7MMBR', market: 'de', watched: true, lastSeenPrice: 3799 },
            { asin: 'B09JRYMSD5', market: 'nl', watched: true, lastSeenPrice: 60 },
          ],
        }),
      }),
    );
    assert.equal(ingest.status, 200);
    assert.equal(ingest.body.status, 'ok');
    assert.equal(ingest.body.ingested, 2);
    assert.equal(ingest.body.watchedAsins, 2);

    const status = await readJson(await fetch(`${baseUrl}/api/keepa/status`));
    assert.equal(status.status, 200);
    assert.equal(status.body.status, 'ok');
    assert.equal(status.body.provider, 'keepa');
    assert.equal(status.body.watchedAsins, 2);
    assert.ok(status.body.lastWatchStateIngestAt);

    const summary = await readJson(await fetch(`${baseUrl}/api/keepa/watch-state/summary?limit=5`));
    assert.equal(summary.status, 200);
    assert.equal(summary.body.status, 'ok');
    assert.equal(summary.body.watchedAsins, 2);
    assert.ok(Array.isArray(summary.body.items));
    assert.equal(summary.body.count, 2);
    assert.ok(summary.body.items.every((item) => item.asin));
  });
});

test('P0-D: keepa events ingest + deals + token-usage endpoints', async () => {
  await withServer(async (baseUrl) => {
    const ingest = await readJson(
      await fetch(`${baseUrl}/api/keepa/events/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          events: [
            {
              asin: 'B0BYW7MMBR',
              kind: 'deal',
              market: 'nl',
              price: 2042.48,
              discountPct: 48,
              title: 'ASUS ROG',
              ts: '2026-04-17T10:00:00.000Z',
            },
            {
              asin: 'B09JRYMSD5',
              kind: 'price',
              market: 'de',
              price: 57.99,
              ts: '2026-04-17T10:01:00.000Z',
            },
          ],
          tokenUsage: {
            limit: 5000,
            used: 125,
            remaining: 4875,
            refreshedAt: '2026-04-17T10:02:00.000Z',
          },
        }),
      }),
    );
    assert.equal(ingest.status, 200);
    assert.equal(ingest.body.status, 'ok');
    assert.equal(ingest.body.ingested, 2);
    assert.equal(ingest.body.deals, 1);

    const deals = await readJson(await fetch(`${baseUrl}/api/keepa/deals?limit=10`));
    assert.equal(deals.status, 200);
    assert.equal(deals.body.status, 'ok');
    assert.equal(deals.body.source, 'ingest');
    assert.ok(deals.body.count >= 1);
    assert.equal(deals.body.items[0].asin, 'B0BYW7MMBR');

    const tokenUsage = await readJson(await fetch(`${baseUrl}/api/keepa/token-usage`));
    assert.equal(tokenUsage.status, 200);
    assert.equal(tokenUsage.body.status, 'ok');
    assert.equal(tokenUsage.body.limit, 5000);
    assert.equal(tokenUsage.body.used, 125);
    assert.equal(tokenUsage.body.remaining, 4875);
    assert.equal(tokenUsage.body.usagePct, 2.5);
  });
});

test('P0-D: keepa history alias returns timeline for existing ASIN', async () => {
  await withServer(async (baseUrl) => {
    const trackings = await readJson(await fetch(`${baseUrl}/trackings`));
    const asin = trackings.body.items[0].asin;

    const history = await readJson(await fetch(`${baseUrl}/api/keepa/history/${asin}?limit=60`));
    assert.equal(history.status, 200);
    assert.equal(history.body.status, 'ok');
    assert.equal(history.body.asin, asin);
    assert.ok(Array.isArray(history.body.items));
    assert.ok(history.body.count >= 1);
  });
});

test('P0-D: keepa nl-reliability exposes coverage summary', async () => {
  await withServer(async (baseUrl) => {
    const reliability = await readJson(await fetch(`${baseUrl}/api/keepa/nl-reliability`));
    assert.equal(reliability.status, 200);
    assert.equal(reliability.body.status, 'ok');
    assert.equal(reliability.body.market, 'nl');
    assert.ok(reliability.body.totals);
    assert.ok(reliability.body.coverage);
    assert.ok(Number.isFinite(Number(reliability.body.coverage.newPct)));
    assert.ok(Number.isFinite(Number(reliability.body.coverage.usedPct)));
    assert.ok(Number.isFinite(Number(reliability.body.reliabilityScore)));
    assert.ok(['good', 'warn', 'bad'].includes(reliability.body.health));
  });
});

test('P0-E: hunter config endpoint supports custom override', async () => {
  await withServer(async (baseUrl) => {
    const initial = await readJson(await fetch(`${baseUrl}/api/hunter-config`));
    assert.equal(initial.status, 200);
    assert.equal(initial.body.status, 'ok');
    assert.ok(initial.body.config);
    assert.ok(initial.body.config.tokenPolicy);

    const updated = await readJson(
      await fetch(`${baseUrl}/api/hunter-config/custom`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actor: 'contracts-test',
          config: {
            cadenceMin: 15,
            confidenceThreshold: 0.82,
            minDealScore: 0.71,
            tokenPolicy: { mode: 'capped', budgetTokens: 42 },
            ai: { enabled: true, model: 'gpt-test' },
          },
        }),
      }),
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.status, 'ok');
    assert.equal(updated.body.config.cadenceMin, 15);
    assert.equal(updated.body.config.confidenceThreshold, 0.82);
    assert.equal(updated.body.config.minDealScore, 0.71);
    assert.equal(updated.body.config.tokenPolicy.mode, 'capped');
    assert.equal(updated.body.config.tokenPolicy.budgetTokens, 42);
    assert.equal(updated.body.config.ai.model, 'gpt-test');

    const after = await readJson(await fetch(`${baseUrl}/api/hunter-config`));
    assert.equal(after.status, 200);
    assert.equal(after.body.config.cadenceMin, 15);
    assert.equal(after.body.config.confidenceThreshold, 0.82);
    assert.equal(after.body.config.tokenPolicy.mode, 'capped');
    assert.equal(after.body.config.tokenPolicy.budgetTokens, 42);

    const recommendation = await readJson(await fetch(`${baseUrl}/api/hunter-config/recommendation`));
    assert.equal(recommendation.status, 200);
    assert.ok(recommendation.body.recommendation && typeof recommendation.body.recommendation === 'object');
    assert.ok(['safe', 'balanced', 'aggressive'].includes(String(recommendation.body.recommendation.preset)));
    assert.ok(Number.isFinite(Number(recommendation.body.recommendation.confidence)));
    assert.ok(Array.isArray(recommendation.body.recommendation.reasons));
    assert.ok(recommendation.body.autoApply && typeof recommendation.body.autoApply === 'object');
    assert.ok(Number.isFinite(Number(recommendation.body.autoApply.minConfidence)));
    assert.ok(Number.isFinite(Number(recommendation.body.autoApply.minRuns)));

    const presetBad = await readJson(
      await fetch(`${baseUrl}/api/hunter-config/preset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preset: 'invalid' }),
      }),
    );
    assert.equal(presetBad.status, 400);
    assert.equal(presetBad.body.error, 'Invalid preset');

    const presetSet = await readJson(
      await fetch(`${baseUrl}/api/hunter-config/preset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preset: 'balanced' }),
      }),
    );
    assert.equal(presetSet.status, 200);
    assert.equal(presetSet.body.success, true);
    assert.equal(presetSet.body.preset, 'balanced');
    assert.ok(presetSet.body.effective && typeof presetSet.body.effective === 'object');

    const autoApplyRun = await readJson(
      await fetch(`${baseUrl}/api/hunter-config/auto-apply-run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      }),
    );
    assert.equal(autoApplyRun.status, 200);
    assert.equal(autoApplyRun.body.success, true);
    assert.equal(autoApplyRun.body.forced, true);
    assert.ok(typeof autoApplyRun.body.applied === 'boolean');
    assert.ok(Array.isArray(autoApplyRun.body.changed));
    assert.ok(autoApplyRun.body.recommendation && typeof autoApplyRun.body.recommendation === 'object');

    const momentumRun = await readJson(
      await fetch(`${baseUrl}/api/hunter-config/momentum-run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      }),
    );
    assert.equal(momentumRun.status, 200);
    assert.equal(momentumRun.body.success, true);
    assert.equal(momentumRun.body.skipped, false);
    assert.ok(Number.isFinite(Number(momentumRun.body.scanned)));
    assert.ok(Number.isFinite(Number(momentumRun.body.injected)));
    assert.ok(Number.isFinite(Number(momentumRun.body.decisions)));

    const presetDelete = await readJson(await fetch(`${baseUrl}/api/hunter-config/preset`, { method: 'DELETE' }));
    assert.equal(presetDelete.status, 200);
    assert.equal(presetDelete.body.success, true);
    assert.ok(presetDelete.body.effective && typeof presetDelete.body.effective === 'object');
  });
});

test('P0-E: hunter run-now + slo + smart-engine + autonomy-health endpoints', async () => {
  await withServer(async (baseUrl) => {
    const runNow = await readJson(
      await fetch(`${baseUrl}/api/hunter-config/run-now`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokenPolicy: { mode: 'capped', budgetTokens: 20 },
          triggeredBy: 'contracts-test',
        }),
      }),
    );
    assert.equal(runNow.status, 200);
    assert.equal(runNow.body.status, 'ok');
    assert.equal(runNow.body.triggered, true);
    assert.ok(runNow.body.runId);
    assert.ok(Array.isArray(runNow.body.decisions));
    assert.ok(Array.isArray(runNow.body.alerts));
    assert.ok(runNow.body.tokenPolicyConfig);

    const slo = await readJson(await fetch(`${baseUrl}/api/hunter-slo`));
    assert.equal(slo.status, 200);
    assert.equal(slo.body.status, 'ok');
    assert.ok(['PASS', 'WARN', 'CRIT'].includes(slo.body.overall));
    assert.ok(slo.body.window);
    assert.ok(slo.body.metrics);
    assert.ok(slo.body.checks);

    const smartEngine = await readJson(await fetch(`${baseUrl}/api/hunter-smart-engine`));
    assert.equal(smartEngine.status, 200);
    assert.equal(smartEngine.body.status, 'ok');
    assert.ok(smartEngine.body.engine);
    assert.ok(Array.isArray(smartEngine.body.topCandidates));

    const autonomyHealth = await readJson(await fetch(`${baseUrl}/api/hunter-autonomy-decision-health`));
    assert.equal(autonomyHealth.status, 200);
    assert.equal(autonomyHealth.body.status, 'ok');
    assert.ok(['PASS', 'WARN', 'CRIT'].includes(autonomyHealth.body.overall));
    assert.ok(autonomyHealth.body.metrics);
    assert.ok(Array.isArray(autonomyHealth.body.signals));

    const efficiency = await readJson(await fetch(`${baseUrl}/api/hunter-efficiency?hours=336`));
    assert.equal(efficiency.status, 200);
    assert.equal(efficiency.body.status, 'ok');
    assert.equal(efficiency.body.windowHours, 336);
    assert.ok(Array.isArray(efficiency.body.runs));
    assert.ok(Array.isArray(efficiency.body.presets));
    assert.ok(efficiency.body.triggers && typeof efficiency.body.triggers === 'object');

    const banditContext = await readJson(await fetch(`${baseUrl}/api/hunter-bandit-context`));
    assert.equal(banditContext.status, 200);
    assert.ok(Object.hasOwn(banditContext.body, 'last'));
    assert.ok(Object.hasOwn(banditContext.body, 'status'));
    assert.ok(Object.hasOwn(banditContext.body, 'replay'));
    assert.ok(Object.hasOwn(banditContext.body, 'schedulerHunter'));
    assert.ok(Object.hasOwn(banditContext.body, 'schedulerRuntime'));

    const keywordStats = await readJson(await fetch(`${baseUrl}/api/hunter-keyword-stats?limit=50`));
    assert.equal(keywordStats.status, 200);
    assert.ok(Number.isFinite(Number(keywordStats.body.count)));
    assert.ok(Array.isArray(keywordStats.body.rows));
    assert.ok(Array.isArray(keywordStats.body.groupSuggestions));
    if (keywordStats.body.rows.length > 0) {
      const sample = keywordStats.body.rows[0];
      assert.ok(typeof sample.group === 'string' && sample.group.length > 0);
      assert.ok(typeof sample.keyword === 'string' && sample.keyword.length > 0);
      assert.ok(Number.isFinite(Number(sample.queries)));
      assert.ok(Number.isFinite(Number(sample.hits)));
      assert.ok(Number.isFinite(Number(sample.hitRate)));
    }

    const signals = await readJson(await fetch(`${baseUrl}/api/hunter-signals`));
    assert.equal(signals.status, 200);
    assert.equal(signals.body.windowHours, 24);
    assert.ok(signals.body.runs && typeof signals.body.runs === 'object');
    assert.ok(signals.body.policy && typeof signals.body.policy === 'object');
    assert.ok(Number.isFinite(Number(signals.body.runs.total)));
    assert.ok(Number.isFinite(Number(signals.body.runs.successRate)));
    assert.ok(signals.body.runs.priceQuality && typeof signals.body.runs.priceQuality === 'object');
    assert.ok(Object.hasOwn(signals.body.policy, 'samples24h'));
    assert.ok(Object.hasOwn(signals.body.policy, 'dominantStrategy'));
    assert.ok(Object.hasOwn(signals.body.policy, 'evaluation'));

    const trendFeatures = await readJson(
      await fetch(`${baseUrl}/api/hunter-trend-features?hours=168&limit=50&domain=de`),
    );
    assert.equal(trendFeatures.status, 200);
    assert.equal(trendFeatures.body.status, 'ok');
    assert.equal(trendFeatures.body.filtered.domain, 'de');
    assert.ok(Array.isArray(trendFeatures.body.rows));
    assert.ok(trendFeatures.body.rows.length >= 1);
    assert.ok(['down_strong', 'down', 'stable', 'up', 'up_strong'].includes(trendFeatures.body.rows[0].trendLabel));
    assert.ok(Array.isArray(trendFeatures.body.summary));

    const trendAutotuneHealth = await readJson(
      await fetch(`${baseUrl}/api/hunter-trend-autotune-health?hours=336&limit=120`),
    );
    assert.equal(trendAutotuneHealth.status, 200);
    assert.ok(['ok', 'warn', 'degraded'].includes(String(trendAutotuneHealth.body.status)));
    assert.ok(Number.isFinite(Number(trendAutotuneHealth.body.windowHours)));
    assert.ok(Number.isFinite(Number(trendAutotuneHealth.body.healthScore)));
    assert.ok(trendAutotuneHealth.body.samples && typeof trendAutotuneHealth.body.samples === 'object');
    assert.ok(trendAutotuneHealth.body.rates && typeof trendAutotuneHealth.body.rates === 'object');
    assert.ok(trendAutotuneHealth.body.runMetrics && typeof trendAutotuneHealth.body.runMetrics === 'object');
    assert.ok(Object.hasOwn(trendAutotuneHealth.body, 'latest'));

    const mlEngine = await readJson(await fetch(`${baseUrl}/api/hunter-ml-engine?hours=168`));
    assert.equal(mlEngine.status, 200);
    assert.ok(mlEngine.body.model && typeof mlEngine.body.model === 'object');
    assert.ok(mlEngine.body.summary && typeof mlEngine.body.summary === 'object');
    assert.ok(mlEngine.body.rollout && typeof mlEngine.body.rollout === 'object');
    assert.ok(Object.hasOwn(mlEngine.body, 'smartEngine'));
    assert.ok(Number.isFinite(Number(mlEngine.body.model.canaryPct)));
    assert.ok(Array.isArray(mlEngine.body.summary.decisions));

    const highValueMetrics = await readJson(await fetch(`${baseUrl}/api/hunter-high-value-metrics?hours=336`));
    assert.equal(highValueMetrics.status, 200);
    assert.ok(Number.isFinite(Number(highValueMetrics.body.windowHours)));
    assert.ok(Number.isFinite(Number(highValueMetrics.body.runs)));
    assert.ok(Number.isFinite(Number(highValueMetrics.body.deals)));
    assert.ok(Number.isFinite(Number(highValueMetrics.body.tokens)));
    assert.ok(Number.isFinite(Number(highValueMetrics.body.avgPrice)));
    assert.ok(Number.isFinite(Number(highValueMetrics.body.avgDiscount)));
    assert.ok(Number.isFinite(Number(highValueMetrics.body.highValueHits)));
    assert.ok(Number.isFinite(Number(highValueMetrics.body.tokensPerDeal)));
    assert.ok(Number.isFinite(Number(highValueMetrics.body.hitShare)));

    const dealsFeed = await readJson(await fetch(`${baseUrl}/api/hunter/deals-feed?limit=30&source=all`));
    assert.equal(dealsFeed.status, 200);
    assert.ok(Array.isArray(dealsFeed.body.rows));
    assert.ok(dealsFeed.body.meta && typeof dealsFeed.body.meta === 'object');
    assert.equal(dealsFeed.body.meta.source, 'all');
    assert.equal(dealsFeed.body.meta.limit, 30);
    assert.ok(Number.isFinite(Number(dealsFeed.body.meta.total)));
    assert.ok(Number.isFinite(Number(dealsFeed.body.meta.hotCount)));
    assert.ok(Number.isFinite(Number(dealsFeed.body.meta.momentumCount)));
    assert.ok(Number.isFinite(Number(dealsFeed.body.meta.fallbackCount)));
    if (dealsFeed.body.rows.length > 0) {
      const sample = dealsFeed.body.rows[0];
      assert.ok(typeof sample.asin === 'string' && sample.asin.length === 10);
      assert.ok(typeof sample.updatedAt === 'string');
      assert.ok(sample.price && typeof sample.price === 'object');
      assert.ok(Object.hasOwn(sample.price, 'de'));
    }
  });
});

test('P0-E: hunter category pauses read + unpause contracts', async () => {
  const store = createInMemoryStore();
  await store.setRuntimeState('hunter:cat:pause:v1:laptops', {
    until: '2099-01-01T00:00:00.000Z',
    reason: 'low_hit_rate',
    queries24h: 40,
    hitRate24h: 0.02,
  });
  await store.setRuntimeState('hunter:cat:pause:v1:gaming', {
    until: '2000-01-01T00:00:00.000Z',
    reason: 'expired_pause',
    queries24h: 10,
    hitRate24h: 0.2,
  });

  await withServer(async (baseUrl) => {
    const before = await readJson(await fetch(`${baseUrl}/api/hunter-category-pauses`));
    assert.equal(before.status, 200);
    assert.ok(Number.isFinite(Number(before.body.totalGroups)));
    assert.ok(Number.isFinite(Number(before.body.pausedCount)));
    assert.ok(Array.isArray(before.body.rows));
    assert.ok(Array.isArray(before.body.paused));
    const laptops = before.body.rows.find((row) => row.group === 'laptops');
    assert.ok(laptops);
    assert.equal(laptops.isPaused, true);

    const bad = await readJson(
      await fetch(`${baseUrl}/api/hunter-category-pauses/unpause`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ group: 'invalid-group' }),
      }),
    );
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'Invalid group');

    const unpause = await readJson(
      await fetch(`${baseUrl}/api/hunter-category-pauses/unpause`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ group: 'laptops' }),
      }),
    );
    assert.equal(unpause.status, 200);
    assert.equal(unpause.body.success, true);
    assert.equal(unpause.body.group, 'laptops');
    assert.equal(unpause.body.unpaused, true);

    const after = await readJson(await fetch(`${baseUrl}/api/hunter-category-pauses`));
    assert.equal(after.status, 200);
    const laptopsAfter = after.body.rows.find((row) => row.group === 'laptops');
    assert.ok(laptopsAfter);
    assert.equal(laptopsAfter.isPaused, false);
  }, { store });
});

test('POST /api/token-control/allocate ranks candidates and applies token budget cap', async () => {
  await withServer(async (baseUrl) => {
    const allocation = await readJson(
      await fetch(`${baseUrl}/api/token-control/allocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          budgetTokens: 12,
          items: [
            { asin: 'A-LOW', expectedValue: 100, confidence: 0.5, tokenCost: 50 },
            { asin: 'B-HIGH', expectedValue: 60, confidence: 0.9, tokenCost: 10 },
            { asin: 'C-MID', expectedValue: 50, confidence: 0.4, tokenCost: 5 },
          ],
        }),
      }),
    );

    assert.equal(allocation.status, 200);
    assert.equal(allocation.body.status, 'ok');
    assert.equal(allocation.body.budgetMode, 'capped');
    assert.ok(allocation.body.snapshotId);
    assert.equal(allocation.body.summary.requested, 3);
    assert.equal(allocation.body.summary.selected, 1);
    assert.equal(allocation.body.summary.skipped, 2);
    assert.equal(allocation.body.summary.totalTokenCostSelected, 10);
    assert.equal(allocation.body.summary.remainingBudgetTokens, 2);
    assert.equal(allocation.body.plan[0].asin, 'B-HIGH');
    assert.equal(allocation.body.plan[0].selected, true);
    assert.equal(allocation.body.plan[1].asin, 'C-MID');
    assert.equal(allocation.body.plan[1].selected, false);
    assert.equal(allocation.body.plan[1].skipReason, 'budget_exceeded');
  });
});

test('GET /token-control/snapshots/latest returns persisted token allocation snapshots', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/token-control/allocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          budgetTokens: 30,
          items: [
            { asin: 'B0AAATEST1', expectedValue: 120, confidence: 0.7, tokenCost: 12 },
            { asin: 'B0AAATEST2', expectedValue: 80, confidence: 0.6, tokenCost: 8 },
          ],
        }),
      }),
    );

    const snapshots = await readJson(await fetch(`${baseUrl}/api/token-control/snapshots/latest?limit=5`));
    assert.equal(snapshots.status, 200);
    assert.ok(Array.isArray(snapshots.body.items));
    assert.ok(snapshots.body.count >= 1);
    assert.ok(snapshots.body.items[0].snapshotId);
    assert.ok(['unbounded', 'capped'].includes(snapshots.body.items[0].budgetMode));
    assert.ok(Array.isArray(snapshots.body.items[0].plan));
    assert.ok(snapshots.body.items[0].plan.length >= 1);
    assert.ok(typeof snapshots.body.items[0].summary.requested === 'number');
  });
});

test('GET /api/token-control/budget/status returns daily token budget status and window reset', async () => {
  await withServer(async (baseUrl) => {
    const dayOne = testDay(0);
    const dayTwo = testDay(1);

    const initial = await readJson(
      await fetch(`${baseUrl}/api/token-control/budget/status?mode=capped&budgetTokens=20&day=${dayOne}`),
    );
    assert.equal(initial.status, 200);
    assert.equal(initial.body.tokenBudgetStatus.day, dayOne);
    assert.equal(initial.body.tokenBudgetStatus.mode, 'capped');
    assert.equal(initial.body.tokenBudgetStatus.budgetTokens, 20);
    assert.equal(initial.body.tokenBudgetStatus.consumedTokens, 0);
    assert.equal(initial.body.tokenBudgetStatus.remainingTokens, 20);

    const runOne = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${dayOne}T08:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 20 },
        }),
      }),
    );
    assert.equal(runOne.status, 200);
    assert.ok(Number(runOne.body.tokenPolicy.totalTokenCostSelected) > 0);

    const afterOne = await readJson(
      await fetch(`${baseUrl}/api/token-control/budget/status?mode=capped&budgetTokens=20&day=${dayOne}`),
    );
    assert.equal(afterOne.status, 200);
    assert.ok(afterOne.body.tokenBudgetStatus.consumedTokens > 0);
    assert.ok(afterOne.body.tokenBudgetStatus.remainingTokens < 20);

    const runTwo = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${dayOne}T12:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 20 },
        }),
      }),
    );
    assert.equal(runTwo.status, 200);

    const afterTwo = await readJson(
      await fetch(`${baseUrl}/api/token-control/budget/status?mode=capped&budgetTokens=20&day=${dayOne}`),
    );
    assert.equal(afterTwo.status, 200);
    assert.ok(afterTwo.body.tokenBudgetStatus.consumedTokens >= afterOne.body.tokenBudgetStatus.consumedTokens);
    assert.ok(afterTwo.body.tokenBudgetStatus.remainingTokens <= afterOne.body.tokenBudgetStatus.remainingTokens);

    const nextDay = await readJson(
      await fetch(`${baseUrl}/api/token-control/budget/status?mode=capped&budgetTokens=20&day=${dayTwo}`),
    );
    assert.equal(nextDay.status, 200);
    assert.equal(nextDay.body.tokenBudgetStatus.day, dayTwo);
    assert.equal(nextDay.body.tokenBudgetStatus.consumedTokens, 0);
    assert.equal(nextDay.body.tokenBudgetStatus.remainingTokens, 20);
  });
});

test('GET /api/token-control/probe-policy returns current config and auto-tune diagnostics', async () => {
  await withServer(async (baseUrl) => {
    const day = testDay(20);
    const previousDay = testDay(19);

    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${previousDay}T08:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 300,
            maxProbesPerDay: 4,
            autoTuneProbePolicy: true,
          },
        }),
      }),
    );

    const firstRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T08:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 300,
            maxProbesPerDay: 4,
            autoTuneProbePolicy: true,
          },
        }),
      }),
    );
    assert.equal(firstRun.status, 200);

    const secondRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 300,
            maxProbesPerDay: 4,
            autoTuneProbePolicy: true,
          },
        }),
      }),
    );
    assert.equal(secondRun.status, 200);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.action, 'smart_probe');

    const diagnostics = await readJson(
      await fetch(
        `${baseUrl}/api/token-control/probe-policy?day=${day}&mode=capped&budgetTokens=12&probeCooldownSec=300&maxProbesPerDay=4&autoTuneProbePolicy=1`,
      ),
    );
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.body.status, 'ok');
    assert.equal(diagnostics.body.day, day);
    assert.equal(diagnostics.body.tokenPolicyConfig?.autoTuneProbePolicy, true);
    assert.equal(diagnostics.body.derivedAutoTuneDecision?.enabled, true);
    assert.equal(diagnostics.body.derivedAutoTuneDecision?.pressureBand, 'critical');
    assert.ok(diagnostics.body.derivedAutoTuneDecision?.probeCooldownSec >= 43200);
    assert.equal(diagnostics.body.derivedAutoTuneDecision?.maxProbesPerDay, 1);
    assert.equal(diagnostics.body.lastAutoTuneDecision?.found, true);
    assert.equal(diagnostics.body.lastAutoTuneDecision?.autoTuneEnabled, true);
    assert.equal(diagnostics.body.lastAutoTuneDecision?.autoTuneApplied, true);
    assert.equal(diagnostics.body.lastAutoTuneDecision?.pressureBand, 'critical');
  });
});

test('POST /api/token-control/probe-policy/reset resets probe runtime state with guardrails and audit', async () => {
  await withServer(async (baseUrl) => {
    const day = testDay(40);

    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T08:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12, probeBudgetTokens: 10 },
        }),
      }),
    );
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12, probeBudgetTokens: 10 },
        }),
      }),
    );

    const badConfirm = await readJson(
      await fetch(`${baseUrl}/api/token-control/probe-policy/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T11:00:00.000Z`,
          confirm: 'wrong',
          reason: 'manual reset for test',
          actor: 'contracts-test',
        }),
      }),
    );
    assert.equal(badConfirm.status, 400);
    assert.equal(badConfirm.body.error, 'reset_confirmation_required');

    const reset = await readJson(
      await fetch(`${baseUrl}/api/token-control/probe-policy/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T11:00:00.000Z`,
          confirm: 'RESET_TOKEN_BUDGET_PROBE_STATE',
          reason: 'manual reset for test',
          actor: 'contracts-test',
        }),
      }),
    );
    assert.equal(reset.status, 200);
    assert.equal(reset.body.reset, true);
    assert.equal(reset.body.probeRuntimeState?.stateValue?.reason, 'manual_probe_runtime_state_reset');
    assert.equal(reset.body.probeRuntimeState?.stateValue?.probesForDay, 0);
    assert.equal(reset.body.probeRuntimeState?.stateValue?.cooldownSec, 0);
    assert.equal(reset.body.probeRuntimeState?.stateValue?.resetBy, 'contracts-test');

    const runtimeState = await readJson(
      await fetch(`${baseUrl}/api/self-heal/runtime-state?key=token_budget_last_probe_at`),
    );
    assert.equal(runtimeState.status, 200);
    assert.equal(runtimeState.body.found, true);
    assert.equal(runtimeState.body.runtimeState?.stateValue?.reason, 'manual_probe_runtime_state_reset');
    assert.equal(runtimeState.body.runtimeState?.stateValue?.probesForDay, 0);

    const cooldownBlocked = await readJson(
      await fetch(`${baseUrl}/api/token-control/probe-policy/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T11:01:00.000Z`,
          confirm: 'RESET_TOKEN_BUDGET_PROBE_STATE',
          reason: 'manual reset for test second try',
          actor: 'contracts-test',
        }),
      }),
    );
    assert.equal(cooldownBlocked.status, 409);
    assert.equal(cooldownBlocked.body.error, 'reset_cooldown_active');

    const diagnostics = await readJson(
      await fetch(`${baseUrl}/api/token-control/probe-policy?day=${day}&mode=capped&budgetTokens=12`),
    );
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.body.lastProbeResetAudit?.found, true);
    assert.equal(diagnostics.body.lastProbeResetAudit?.actor, 'contracts-test');
    assert.equal(diagnostics.body.lastProbeResetAudit?.action, 'token_budget_probe_state_reset');
  });
});

test('POST /api/token-control/probe-policy/reset enforces ops key when configured', async () => {
  const previousOpsKey = process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY;
  process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY = 'contracts-ops-reset-key';
  try {
    await withServer(async (baseUrl) => {
      const day = testDay(41);

      const missingKey = await readJson(
        await fetch(`${baseUrl}/api/token-control/probe-policy/reset`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            now: `${day}T11:00:00.000Z`,
            confirm: 'RESET_TOKEN_BUDGET_PROBE_STATE',
            reason: 'manual reset for test with ops key',
            actor: 'contracts-test',
          }),
        }),
      );
      assert.equal(missingKey.status, 401);
      assert.equal(missingKey.body.error, 'ops_key_required');

      const badKey = await readJson(
        await fetch(`${baseUrl}/api/token-control/probe-policy/reset`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-soon-ops-key': 'wrong-key' },
          body: JSON.stringify({
            now: `${day}T11:00:00.000Z`,
            confirm: 'RESET_TOKEN_BUDGET_PROBE_STATE',
            reason: 'manual reset for test with wrong ops key',
            actor: 'contracts-test',
          }),
        }),
      );
      assert.equal(badKey.status, 403);
      assert.equal(badKey.body.error, 'ops_key_invalid');

      const goodKey = await readJson(
        await fetch(`${baseUrl}/api/token-control/probe-policy/reset`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-soon-ops-key': 'contracts-ops-reset-key',
          },
          body: JSON.stringify({
            now: `${day}T11:00:00.000Z`,
            confirm: 'RESET_TOKEN_BUDGET_PROBE_STATE',
            reason: 'manual reset for test with valid ops key',
            actor: 'contracts-test',
          }),
        }),
      );
      assert.equal(goodKey.status, 200);
      assert.equal(goodKey.body.reset, true);
    });
  } finally {
    if (previousOpsKey === undefined) {
      delete process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY;
    } else {
      process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY = previousOpsKey;
    }
  }
});

test('GET /api/token-control/probe-policy/reset-auth/status reports auth guard mode', async () => {
  const previousOpsKey = process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY;
  try {
    delete process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY;
    await withServer(async (baseUrl) => {
      const openMode = await readJson(await fetch(`${baseUrl}/api/token-control/probe-policy/reset-auth/status`));
      assert.equal(openMode.status, 200);
      assert.equal(openMode.body.status, 'ok');
      assert.equal(openMode.body.endpoint, 'token-control/probe-policy/reset');
      assert.equal(openMode.body.auth?.opsKeyRequired, false);
      assert.ok(Array.isArray(openMode.body.auth?.acceptedHeaders));
    });

    process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY = 'contracts-ops-reset-key';
    await withServer(async (baseUrl) => {
      const guardedMode = await readJson(await fetch(`${baseUrl}/api/token-control/probe-policy/reset-auth/status`));
      assert.equal(guardedMode.status, 200);
      assert.equal(guardedMode.body.auth?.opsKeyRequired, true);
      assert.ok(Array.isArray(guardedMode.body.auth?.acceptedHeaders));
    });
  } finally {
    if (previousOpsKey === undefined) {
      delete process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY;
    } else {
      process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY = previousOpsKey;
    }
  }
});

test('POST /api/token-control/probe-policy/reset-auth/rotate stages next ops key with grace window', async () => {
  const previousOpsKey = process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY;
  process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY = 'contracts-ops-reset-key-old';
  try {
    await withServer(async (baseUrl) => {
      const day = testDay(42);
      const stagedOpsKey = 'contracts-ops-reset-key-next';

      const missingKey = await readJson(
        await fetch(`${baseUrl}/api/token-control/probe-policy/reset-auth/rotate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            now: `${day}T08:00:00.000Z`,
            confirm: 'ROTATE_TOKEN_BUDGET_PROBE_RESET_OPS_KEY',
            reason: 'rotate probe reset ops key for contracts',
            actor: 'contracts-test',
            nextOpsKey: stagedOpsKey,
            graceSec: 90,
          }),
        }),
      );
      assert.equal(missingKey.status, 401);
      assert.equal(missingKey.body.error, 'ops_key_required');

      const badKey = await readJson(
        await fetch(`${baseUrl}/api/token-control/probe-policy/reset-auth/rotate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-soon-ops-key': 'wrong-key' },
          body: JSON.stringify({
            now: `${day}T08:00:00.000Z`,
            confirm: 'ROTATE_TOKEN_BUDGET_PROBE_RESET_OPS_KEY',
            reason: 'rotate probe reset ops key for contracts',
            actor: 'contracts-test',
            nextOpsKey: stagedOpsKey,
            graceSec: 90,
          }),
        }),
      );
      assert.equal(badKey.status, 403);
      assert.equal(badKey.body.error, 'ops_key_invalid');

      const rotate = await readJson(
        await fetch(`${baseUrl}/api/token-control/probe-policy/reset-auth/rotate`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-soon-ops-key': 'contracts-ops-reset-key-old',
          },
          body: JSON.stringify({
            now: `${day}T08:00:00.000Z`,
            confirm: 'ROTATE_TOKEN_BUDGET_PROBE_RESET_OPS_KEY',
            reason: 'rotate probe reset ops key for contracts',
            actor: 'contracts-test',
            nextOpsKey: stagedOpsKey,
            graceSec: 90,
          }),
        }),
      );
      assert.equal(rotate.status, 200);
      assert.equal(rotate.body.rotated, true);
      assert.equal(rotate.body.rotation?.active, true);
      assert.equal(rotate.body.rotation?.graceSec, 90);

      const status = await readJson(await fetch(`${baseUrl}/api/token-control/probe-policy/reset-auth/status`));
      assert.equal(status.status, 200);
      assert.equal(status.body.auth?.opsKeyRequired, true);
      assert.equal(status.body.rotation?.active, true);
      assert.equal(status.body.lastRotationAudit?.found, true);

      const stagedKeyWorks = await readJson(
        await fetch(`${baseUrl}/api/token-control/probe-policy/reset`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-soon-ops-key': stagedOpsKey,
          },
          body: JSON.stringify({
            now: `${day}T08:01:00.000Z`,
            confirm: 'RESET_TOKEN_BUDGET_PROBE_STATE',
            reason: 'manual reset with staged key in grace window',
            actor: 'contracts-test',
            dryRun: true,
          }),
        }),
      );
      assert.equal(stagedKeyWorks.status, 200);
      assert.equal(stagedKeyWorks.body.dryRun, true);

      const stagedKeyExpired = await readJson(
        await fetch(`${baseUrl}/api/token-control/probe-policy/reset`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-soon-ops-key': stagedOpsKey,
          },
          body: JSON.stringify({
            now: `${day}T08:03:00.000Z`,
            confirm: 'RESET_TOKEN_BUDGET_PROBE_STATE',
            reason: 'manual reset with staged key after grace expiry',
            actor: 'contracts-test',
            dryRun: true,
          }),
        }),
      );
      assert.equal(stagedKeyExpired.status, 403);
      assert.equal(stagedKeyExpired.body.error, 'ops_key_invalid');
    });
  } finally {
    if (previousOpsKey === undefined) {
      delete process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY;
    } else {
      process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY = previousOpsKey;
    }
  }
});

test('POST /token-control/allocate validates payload shape', async () => {
  await withServer(async (baseUrl) => {
    const missingItems = await readJson(
      await fetch(`${baseUrl}/token-control/allocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    assert.equal(missingItems.status, 400);
    assert.equal(missingItems.body.error, 'items_required');

    const invalidBudget = await readJson(
      await fetch(`${baseUrl}/token-control/allocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          budgetTokens: -1,
          items: [{ asin: 'B0TEST1', expectedValue: 10, confidence: 0.5, tokenCost: 5 }],
        }),
      }),
    );
    assert.equal(invalidBudget.status, 400);
    assert.equal(invalidBudget.body.error, 'budget_tokens_invalid');

    const invalidItem = await readJson(
      await fetch(`${baseUrl}/token-control/allocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [{ asin: '', expectedValue: 10, confidence: 0.5, tokenCost: 5 }],
        }),
      }),
    );
    assert.equal(invalidItem.status, 400);
    assert.equal(invalidItem.body.error, 'invalid_item');
    assert.equal(invalidItem.body.reason, 'asin_required');
  });
});

test('POST /automation/cycle enforces alert channel policy', async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.ok(body.tokenSnapshotId);
    assert.ok(body.tokenPolicy);
    assert.ok(['unbounded', 'capped'].includes(body.tokenPolicy.mode));
    assert.ok(Array.isArray(body.alerts));
    assert.ok(body.alerts.length >= 1);

    for (const alert of body.alerts) {
      if (alert.kind === 'purchase') {
        assert.equal(alert.channel, 'telegram');
      }
      if (alert.kind === 'technical') {
        assert.equal(alert.channel, 'discord');
      }
    }
  });
});

test('POST /automation/cycle applies capped token budget and skips over-budget candidates', async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${testDay(2)}T12:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12 },
        }),
      }),
    );

    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.tokenPolicy.mode, 'capped');
    assert.equal(body.tokenPolicy.budgetTokens, 12);
    assert.ok(body.tokenPolicy.selectedCount >= 0);
    assert.ok(body.tokenPolicy.skippedCount >= 1);
    assert.ok(Array.isArray(body.tokenPlan));
    assert.ok(body.tokenPlan.some((item) => item.selected === false));
    assert.ok(body.tokenPlan.some((item) => item.skipReason === 'budget_exceeded'));

    const selectedAsins = new Set(body.tokenPlan.filter((item) => item.selected).map((item) => item.asin));
    assert.ok(body.decisions.every((decision) => selectedAsins.has(decision.asin)));
  });
});

test('POST /automation/cycle triggers smart deferral when daily token budget is exhausted', async () => {
  await withServer(async (baseUrl) => {
    const day = testDay(50);

    const firstRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T08:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12 },
        }),
      }),
    );

    assert.equal(firstRun.status, 200);
    assert.equal(firstRun.body.tokenPolicy.mode, 'capped');
    assert.equal(firstRun.body.tokenBudgetStatus?.remainingTokens, 0);

    const secondRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12 },
        }),
      }),
    );

    assert.equal(secondRun.status, 200);
    assert.equal(secondRun.body.tokenPolicy.mode, 'capped');
    assert.equal(secondRun.body.tokenPolicy.budgetTokens, 0);
    assert.equal(secondRun.body.tokenPolicy.selectedCount, 0);
    assert.ok(Array.isArray(secondRun.body.decisions));
    assert.equal(secondRun.body.decisions.length, 0);
    assert.ok(secondRun.body.tokenPlan.every((item) => item.selected === false));
    assert.ok(secondRun.body.tokenPlan.every((item) => item.skipReason === 'budget_exceeded'));
    assert.equal(secondRun.body.degradation?.active, true);
    assert.equal(secondRun.body.degradation?.mode, 'token_budget_exhausted_deferral');
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.triggered, true);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.action, 'smart_deferral');
    assert.ok(secondRun.body.alerts.some((alert) => alert.reason === 'token_budget_exhausted_deferral'));

    const runtimeState = await readJson(
      await fetch(`${baseUrl}/api/self-heal/runtime-state?key=token_budget_last_deferral_at`),
    );
    assert.equal(runtimeState.status, 200);
    assert.equal(runtimeState.body.found, true);
    assert.equal(runtimeState.body.runtimeState?.stateValue?.reason, 'daily_token_budget_exhausted');
    assert.equal(runtimeState.body.runtimeState?.stateValue?.day, day);
  });
});

test('POST /automation/cycle uses one-shot smart probe before fallback deferral when budget is exhausted', async () => {
  await withServer(async (baseUrl) => {
    const day = testDay(51);

    const firstRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T08:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12, probeBudgetTokens: 10 },
        }),
      }),
    );

    assert.equal(firstRun.status, 200);
    assert.equal(firstRun.body.tokenBudgetStatus?.remainingTokens, 0);

    const secondRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12, probeBudgetTokens: 10 },
        }),
      }),
    );

    assert.equal(secondRun.status, 200);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.triggered, true);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.action, 'smart_probe');
    assert.equal(secondRun.body.degradation?.active, true);
    assert.equal(secondRun.body.degradation?.mode, 'token_budget_exhausted_probe');
    assert.equal(secondRun.body.degradation?.probeBudgetTokens, 10);
    assert.ok(secondRun.body.tokenBudgetAutoRemediation?.probeCooldownSec > 0);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probeBlockedByCooldown, false);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.maxProbesPerDay, 1);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probesUsedToday, 0);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probesUsedAfterAction, 1);
    assert.equal(secondRun.body.tokenPolicy?.budgetTokens, 10);
    assert.ok(secondRun.body.alerts.some((alert) => alert.reason === 'token_budget_exhausted_probe'));

    const probeRuntimeState = await readJson(
      await fetch(`${baseUrl}/api/self-heal/runtime-state?key=token_budget_last_probe_at`),
    );
    assert.equal(probeRuntimeState.status, 200);
    assert.equal(probeRuntimeState.body.found, true);
    assert.equal(probeRuntimeState.body.runtimeState?.stateValue?.day, day);
    assert.equal(probeRuntimeState.body.runtimeState?.stateValue?.probeBudgetTokens, 10);
    assert.equal(probeRuntimeState.body.runtimeState?.stateValue?.probesForDay, 1);

    const thirdRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T12:00:00.000Z`,
          tokenPolicy: { mode: 'capped', budgetTokens: 12, probeBudgetTokens: 10 },
        }),
      }),
    );

    assert.equal(thirdRun.status, 200);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.triggered, true);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.action, 'smart_deferral');
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probeBlockedByDailyCap, true);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probesUsedToday, 1);
    assert.equal(thirdRun.body.degradation?.mode, 'token_budget_exhausted_deferral');
    assert.ok(thirdRun.body.alerts.some((alert) => alert.reason === 'token_budget_exhausted_deferral'));
  });
});

test('POST /automation/cycle allows second smart probe after cooldown elapses', async () => {
  await withServer(async (baseUrl) => {
    const day = testDay(52);

    const firstRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T08:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 2,
          },
        }),
      }),
    );
    assert.equal(firstRun.status, 200);
    assert.equal(firstRun.body.tokenBudgetStatus?.remainingTokens, 0);

    const secondRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 2,
          },
        }),
      }),
    );
    assert.equal(secondRun.status, 200);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.action, 'smart_probe');
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probeCooldownSec, 3600);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.maxProbesPerDay, 2);

    const thirdRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:30:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 2,
          },
        }),
      }),
    );
    assert.equal(thirdRun.status, 200);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.action, 'smart_deferral');
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probeBlockedByCooldown, true);
    assert.ok(thirdRun.body.tokenBudgetAutoRemediation?.probeCooldownRemainingSec > 0);

    const fourthRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T11:15:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 2,
          },
        }),
      }),
    );
    assert.equal(fourthRun.status, 200);
    assert.equal(fourthRun.body.tokenBudgetAutoRemediation?.action, 'smart_probe');
    assert.equal(fourthRun.body.degradation?.mode, 'token_budget_exhausted_probe');
  });
});

test('POST /automation/cycle blocks probe by daily cap even after cooldown elapsed', async () => {
  await withServer(async (baseUrl) => {
    const day = testDay(53);

    const firstRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T08:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 1,
          },
        }),
      }),
    );
    assert.equal(firstRun.status, 200);
    assert.equal(firstRun.body.tokenBudgetStatus?.remainingTokens, 0);

    const secondRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 1,
          },
        }),
      }),
    );
    assert.equal(secondRun.status, 200);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.action, 'smart_probe');

    const thirdRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T11:30:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 3600,
            maxProbesPerDay: 1,
          },
        }),
      }),
    );
    assert.equal(thirdRun.status, 200);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.action, 'smart_deferral');
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probeBlockedByCooldown, false);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probeBlockedByDailyCap, true);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probesUsedToday, 1);
  });
});

test('POST /automation/cycle autotunes probe policy under high token-pressure conditions', async () => {
  await withServer(async (baseUrl) => {
    const day = testDay(54);

    const firstRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T08:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 300,
            maxProbesPerDay: 4,
            autoTuneProbePolicy: true,
          },
        }),
      }),
    );
    assert.equal(firstRun.status, 200);
    assert.equal(firstRun.body.tokenBudgetStatus?.remainingTokens, 0);

    const secondRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:00:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 300,
            maxProbesPerDay: 4,
            autoTuneProbePolicy: true,
          },
        }),
      }),
    );
    assert.equal(secondRun.status, 200);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.action, 'smart_probe');
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.configuredProbeCooldownSec, 300);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.configuredMaxProbesPerDay, 4);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probePolicyAutoTuneEnabled, true);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probePolicyAutoTuneApplied, true);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probePolicyPressureBand, 'critical');
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.probePolicyAutoTuneReason, 'critical_budget_pressure');
    assert.ok(secondRun.body.tokenBudgetAutoRemediation?.probePolicyUsagePct >= 95);
    assert.ok(secondRun.body.tokenBudgetAutoRemediation?.probeCooldownSec >= 43200);
    assert.equal(secondRun.body.tokenBudgetAutoRemediation?.maxProbesPerDay, 1);

    const thirdRun = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: `${day}T10:30:00.000Z`,
          tokenPolicy: {
            mode: 'capped',
            budgetTokens: 12,
            probeBudgetTokens: 10,
            probeCooldownSec: 300,
            maxProbesPerDay: 4,
            autoTuneProbePolicy: true,
          },
        }),
      }),
    );
    assert.equal(thirdRun.status, 200);
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.action, 'smart_deferral');
    assert.equal(thirdRun.body.tokenBudgetAutoRemediation?.probeBlockedByCooldown, true);
    assert.ok(thirdRun.body.tokenBudgetAutoRemediation?.probeCooldownRemainingSec > 0);
  });
});

test('GET /automation/runs/latest returns persisted runs', async () => {
  await withServer(async (baseUrl) => {
    const cycle = await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );
    assert.equal(cycle.status, 200);
    assert.ok(cycle.body.runId);

    const latest = await readJson(await fetch(`${baseUrl}/automation/runs/latest?limit=5`));
    assert.equal(latest.status, 200);
    assert.ok(Array.isArray(latest.body.items));
    assert.ok(latest.body.count >= 1);
    assert.ok(latest.body.items[0].runId);

    for (const alert of latest.body.items[0].alerts ?? []) {
      if (alert.kind === 'purchase') {
        assert.equal(alert.channel, 'telegram');
      }
      if (alert.kind === 'technical') {
        assert.equal(alert.channel, 'discord');
      }
    }
  });
});

test('GET /automation/runs/summary returns run KPI aggregates', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    const summary = await readJson(await fetch(`${baseUrl}/automation/runs/summary?limit=5`));
    assert.equal(summary.status, 200);
    assert.ok(summary.body.window.runs >= 1);
    assert.ok(summary.body.kpi.avgAlertCount >= 0);
    assert.ok(summary.body.kpi.purchaseAlertRatePct >= 0);
    assert.ok(summary.body.kpi.technicalAlertRatePct >= 0);
    assert.ok(summary.body.alertsByChannel.discord >= 1);
  });
});

test('GET /automation/runs/trends returns 24h/7d/30d windows', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    const trends = await readJson(await fetch(`${baseUrl}/automation/runs/trends?days=30`));
    assert.equal(trends.status, 200);
    assert.equal(trends.body.source, 'daily-read-model');
    assert.ok(Array.isArray(trends.body.windows));
    assert.equal(trends.body.windows.length, 3);

    const names = trends.body.windows.map((item) => item.window);
    assert.ok(names.includes('24h'));
    assert.ok(names.includes('7d'));
    assert.ok(names.includes('30d'));

    for (const window of trends.body.windows) {
      assert.ok(window.runs >= 0);
      assert.ok(window.kpi.avgAlertCount >= 0);
      assert.ok(window.kpi.purchaseAlertRatePct >= 0);
      assert.ok(window.kpi.technicalAlertRatePct >= 0);
    }
  });
});

test('GET /automation/runs/daily returns day-level read model', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    const daily = await readJson(await fetch(`${baseUrl}/automation/runs/daily?days=30`));
    assert.equal(daily.status, 200);
    assert.ok(Array.isArray(daily.body.items));
    assert.ok(daily.body.items.length >= 1);
    assert.ok(daily.body.items[0].day);
    assert.ok(daily.body.items[0].runs >= 1);
    assert.ok(daily.body.items[0].sums.alertCount >= 1);
    assert.ok(daily.body.items[0].kpi.avgTrackingCount >= 0);
    assert.ok(daily.body.items[0].alertsByChannel.discord >= 1);
  });
});

test('GET /automation/read-model/status returns refresh queue metrics', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    const status = await readJson(await fetch(`${baseUrl}/automation/read-model/status`));
    assert.equal(status.status, 200);
    assert.ok(typeof status.body.mode === 'string');
    assert.ok(typeof status.body.pendingCount === 'number');
    assert.ok(Array.isArray(status.body.pendingDays));
    assert.ok(typeof status.body.inFlight === 'boolean');
    assert.ok(typeof status.body.totalRuns === 'number');
    assert.ok(typeof status.body.totalErrors === 'number');
  });
});

test('GET /api/runtime-self-heal-status returns retry queue operational view', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/self-heal/run`, {
        method: 'POST',
      }),
    );

    const status = await readJson(await fetch(`${baseUrl}/api/runtime-self-heal-status`));
    assert.equal(status.status, 200);
    assert.equal(status.body.status, 'ok');
    assert.ok(['PASS', 'WARN', 'CRIT'].includes(status.body.overall));
    assert.ok(status.body.retryQueue);
    assert.ok(typeof status.body.retryQueue.scheduler === 'string');
    assert.ok(Number.isFinite(status.body.retryQueue.queuePending));
    assert.ok(Number.isFinite(status.body.retryQueue.deadLetterCount));
    assert.ok(Array.isArray(status.body.signals));
  });
});

test('GET /self-heal/runtime-state exposes allowlisted remediation state and cooldown snapshot', async () => {
  const store = createInMemoryStore();
  const now = new Date().toISOString();

  await store.recordAutomationCycle({
    cycle: {
      executedSteps: ['test-runtime-state-drift'],
      tokenPlan: [],
      decisions: [
        {
          asin: 'B0BYW7MMBR',
          score: 81,
          confidence: 0.8,
          shouldAlert: true,
          reason: 'runtime-state-drift-injected-for-test',
        },
      ],
      alerts: [
        {
          asin: 'B0BYW7MMBR',
          kind: 'purchase',
          channel: 'discord',
          reason: 'runtime-state-drift-injected-for-test',
        },
      ],
    },
    trackingCount: 1,
    startedAt: now,
    finishedAt: now,
  });

  await withServer(async (baseUrl) => {
    const missingKey = await readJson(await fetch(`${baseUrl}/self-heal/runtime-state`));
    assert.equal(missingKey.status, 400);
    assert.equal(missingKey.body.error, 'key_required');

    const invalidKey = await readJson(await fetch(`${baseUrl}/self-heal/runtime-state?key=unknown_key`));
    assert.equal(invalidKey.status, 400);
    assert.equal(invalidKey.body.error, 'key_not_allowed');

    const heal = await readJson(
      await fetch(`${baseUrl}/self-heal/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          alertRoutingRemediation: { mode: 'window', limit: 5, cooldownSec: 3600 },
        }),
      }),
    );
    assert.equal(heal.status, 200);
    assert.equal(heal.body.alertRoutingAutoRemediation.triggered, true);

    const runtimeState = await readJson(
      await fetch(`${baseUrl}/api/self-heal/runtime-state?key=alert_routing_last_remediation_at`),
    );
    assert.equal(runtimeState.status, 200);
    assert.equal(runtimeState.body.status, 'ok');
    assert.equal(runtimeState.body.key, 'alert_routing_last_remediation_at');
    assert.equal(runtimeState.body.found, true);
    assert.ok(runtimeState.body.runtimeState?.stateValue?.timestamp);
    assert.equal(runtimeState.body.runtimeState?.stateValue?.cooldownSec, 3600);
    assert.equal(runtimeState.body.cooldown?.cooldownActive, true);
    assert.ok(runtimeState.body.cooldown?.cooldownRemainingSec > 0);
  }, { store });
});

test('GET /api/check-alert-status enforces channel policy telemetry', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    const status = await readJson(await fetch(`${baseUrl}/api/check-alert-status?limit=5`));
    assert.equal(status.status, 200);
    assert.equal(status.body.status, 'ok');
    assert.equal(status.body.policy.purchase, 'telegram');
    assert.equal(status.body.policy.technical, 'discord');
    assert.ok(status.body.window.runs >= 1);
    assert.equal(status.body.violations.total, 0);
    assert.equal(status.body.overall, 'PASS');
    assert.ok(Number.isFinite(status.body.alertsByChannel.telegram));
    assert.ok(Number.isFinite(status.body.alertsByChannel.discord));
  });
});

test('GET /metrics exports read-model Prometheus metrics', async () => {
  await withServer(async (baseUrl) => {
    await readJson(
      await fetch(`${baseUrl}/automation/cycle`, {
        method: 'POST',
      }),
    );

    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /soon_read_model_refresh_pending_count/);
    assert.match(body, /soon_read_model_refresh_total_runs/);
    assert.match(body, /soon_read_model_refresh_total_errors/);
    assert.match(body, /soon_read_model_refresh_info\{mode="/);
    assert.match(body, /soon_self_heal_retry_queue_pending/);
    assert.match(body, /soon_self_heal_retry_queue_done/);
    assert.match(body, /soon_self_heal_retry_queue_dead_letter/);
    assert.match(body, /soon_self_heal_retry_exhausted_total/);
    assert.match(body, /soon_self_heal_retry_backoff_seconds/);
    assert.match(body, /soon_self_heal_dead_letter_total/);
    assert.match(body, /soon_self_heal_manual_requeue_total/);
    assert.match(body, /soon_runtime_self_heal_overall_score/);
    assert.match(body, /soon_runtime_self_heal_signals_total/);
    assert.match(body, /soon_alert_routing_overall_score/);
    assert.match(body, /soon_alert_routing_violations_total/);
    assert.match(body, /soon_alert_routing_purchase_non_telegram_total/);
    assert.match(body, /soon_alert_routing_technical_non_discord_total/);
    assert.match(body, /soon_alert_routing_remediation_cooldown_remaining_seconds/);
    assert.match(body, /soon_token_control_snapshot_present/);
    assert.match(body, /soon_token_control_selected_count\{budget_mode="/);
    assert.match(body, /soon_token_control_skipped_count\{budget_mode="/);
    assert.match(body, /soon_token_control_budget_usage_pct\{budget_mode="/);
    assert.match(body, /soon_token_budget_daily_limit_tokens\{mode="/);
    assert.match(body, /soon_token_budget_consumed_tokens\{mode="/);
    assert.match(body, /soon_token_budget_remaining_tokens\{mode="/);
    assert.match(body, /soon_token_budget_usage_pct\{mode="/);
    assert.match(body, /soon_token_budget_exhausted\{mode="/);
    assert.match(body, /soon_token_budget_policy_fallback_active\{mode="/);
    assert.match(body, /soon_token_budget_deferral_active\{mode="/);
    assert.match(body, /soon_token_budget_last_deferral_unixtime/);
    assert.match(body, /soon_token_budget_probe_active\{mode="/);
    assert.match(body, /soon_token_budget_last_probe_unixtime/);
    assert.match(body, /soon_token_budget_probe_cooldown_remaining_seconds\{mode="/);
    assert.match(body, /soon_token_budget_probe_daily_cap\{mode="/);
    assert.match(body, /soon_token_budget_probe_daily_used\{mode="/);
  });
});

test('POST /self-heal/run persists self-heal run and playbooks', async () => {
  await withServer(async (baseUrl) => {
    const run = await readJson(
      await fetch(`${baseUrl}/self-heal/run`, {
        method: 'POST',
      }),
    );

    assert.equal(run.status, 200);
    assert.equal(run.body.status, 'ok');
    assert.equal(run.body.worker, 'self-heal');
    assert.ok(typeof run.body.anomalyCount === 'number');
    assert.ok(Array.isArray(run.body.anomalies));
    assert.ok(typeof run.body.playbookCount === 'number');
    assert.ok(Array.isArray(run.body.executedPlaybooks));
    assert.ok(run.body.executedPlaybooks.length >= 1);
    assert.ok(typeof run.body.executedPlaybooks[0].playbookId === 'string');
    assert.ok(['success', 'rollback', 'failed'].includes(run.body.executedPlaybooks[0].status));
    assert.ok(Number.isFinite(run.body.executedPlaybooks[0].attempts));
    assert.ok(Number.isFinite(run.body.executedPlaybooks[0].maxRetries));
    assert.ok(Number.isFinite(run.body.executedPlaybooks[0].retriesUsed));
    assert.ok(Number.isFinite(run.body.executedPlaybooks[0].priorityScore));
    assert.ok(Number.isFinite(run.body.executedPlaybooks[0].retryBackoffSec));
    assert.ok(Array.isArray(run.body.executedPlaybooks[0].matchedAnomalyCodes));
    assert.ok(run.body.runId);
    assert.ok(run.body.retryQueue);
    assert.ok(Number.isFinite(run.body.retryQueue.enqueued));

    const latest = await readJson(await fetch(`${baseUrl}/self-heal/runs/latest?limit=5`));
    assert.equal(latest.status, 200);
    assert.ok(latest.body.count >= 1);
    assert.ok(Array.isArray(latest.body.items));
    assert.ok(latest.body.items[0].runId);
    assert.ok(Array.isArray(latest.body.items[0].executedPlaybooks));
    assert.ok(latest.body.items[0].executedPlaybooks.length >= 1);
    assert.ok(typeof latest.body.items[0].executedPlaybooks[0].playbookId === 'string');
    assert.ok(['success', 'rollback', 'failed'].includes(latest.body.items[0].executedPlaybooks[0].status));
    assert.ok(Number.isFinite(latest.body.items[0].executedPlaybooks[0].attempts));
    assert.ok(Number.isFinite(latest.body.items[0].executedPlaybooks[0].priorityScore));

    const retryStatus = await readJson(await fetch(`${baseUrl}/self-heal/retry/status`));
    assert.equal(retryStatus.status, 200);
    assert.ok(Number.isFinite(retryStatus.body.queuePending));
    assert.ok(Number.isFinite(retryStatus.body.deadLetterCount));

    const deadLetter = await readJson(await fetch(`${baseUrl}/self-heal/dead-letter?limit=5`));
    assert.equal(deadLetter.status, 200);
    assert.ok(Array.isArray(deadLetter.body.items));
    assert.ok(Number.isFinite(deadLetter.body.count));
  });
});

test('POST /self-heal/retry/process drains queued retries created from anomaly run', async () => {
  await withServer(async (baseUrl) => {
    const run = await readJson(
      await fetch(`${baseUrl}/self-heal/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          readModelStatusOverride: {
            mode: 'async',
            pendingCount: 12,
            pendingDays: [],
            inFlight: false,
            lastQueuedAt: null,
            lastStartedAt: null,
            lastFinishedAt: new Date().toISOString(),
            lastDurationMs: 20000,
            lastBatchDays: 1,
            totalRuns: 10,
            totalErrors: 1,
            lastError: { message: 'refresh failed' },
          },
        }),
      }),
    );

    assert.equal(run.status, 200);
    assert.ok(run.body.retryQueue.enqueued >= 1);

    const process = await readJson(
      await fetch(`${baseUrl}/self-heal/retry/process`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 10, now: Date.now() + 120000 }),
      }),
    );
    assert.equal(process.status, 200);
    assert.ok(process.body.summary.processed >= 1);
    assert.ok(
      process.body.summary.completed + process.body.summary.rescheduled + process.body.summary.deadLettered >= 1,
    );

    const retryStatus = await readJson(await fetch(`${baseUrl}/self-heal/retry/status`));
    assert.equal(retryStatus.status, 200);
    assert.ok(retryStatus.body.queuePending >= 0);
  });
});

test('POST /self-heal/retry/process stores retry_budget_exhausted dead-letter reason', async () => {
  const store = createInMemoryStore();
  await store.enqueueSelfHealRetryJobs({
    runId: 'run-retry-budget-exhausted-test',
    source: 'test-suite',
    jobs: [
      {
        playbookId: 'alert-router-backlog',
        status: 'failed',
        attempts: 1,
        maxRetries: 1,
        retriesUsed: 0,
        retryBackoffSec: 20,
        priorityScore: 100,
        matchedAnomalyCodes: ['PENDING_BACKLOG_CRIT'],
      },
    ],
  });

  await withServer(
    async (baseUrl) => {
      const process = await readJson(
        await fetch(`${baseUrl}/self-heal/retry/process`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ limit: 10, now: Date.now() + 120000 }),
        }),
      );
      assert.equal(process.status, 200);
      assert.ok(process.body.summary.deadLettered >= 1);
      assert.ok(process.body.summary.retryExhausted >= 1);

      const retryStatus = await readJson(await fetch(`${baseUrl}/self-heal/retry/status`));
      assert.equal(retryStatus.status, 200);
      assert.ok(retryStatus.body.retryExhaustedTotal >= 1);
      assert.ok(Number.isFinite(retryStatus.body.retryBackoffSeconds));

      const deadLetter = await readJson(await fetch(`${baseUrl}/self-heal/dead-letter?limit=10`));
      assert.equal(deadLetter.status, 200);
      assert.ok(deadLetter.body.items.some((item) => item.reason === 'retry_budget_exhausted'));
    },
    { store },
  );
});

test('POST /self-heal/dead-letter/requeue validates input and handles missing item', async () => {
  await withServer(async (baseUrl) => {
    const missingId = await readJson(
      await fetch(`${baseUrl}/self-heal/dead-letter/requeue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    assert.equal(missingId.status, 400);
    assert.equal(missingId.body.error, 'dead_letter_id_required');

    const notFound = await readJson(
      await fetch(`${baseUrl}/self-heal/dead-letter/requeue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deadLetterId: '999999' }),
      }),
    );
    assert.equal(notFound.status, 404);
    assert.equal(notFound.body.error, 'dead_letter_not_found');

    const invalidBulk = await readJson(
      await fetch(`${baseUrl}/self-heal/dead-letter/requeue-bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deadLetterIds: [] }),
      }),
    );
    assert.equal(invalidBulk.status, 400);
    assert.equal(invalidBulk.body.error, 'dead_letter_ids_invalid');

    const invalidFrom = await readJson(await fetch(`${baseUrl}/self-heal/requeue-audit?from=invalid-date`));
    assert.equal(invalidFrom.status, 400);
    assert.equal(invalidFrom.body.error, 'invalid_from_timestamp');
  });
});

test('POST /self-heal/dead-letter/requeue restores dead-letter item back to queue', async () => {
  const store = createInMemoryStore();
  await store.enqueueSelfHealRetryJobs({
    runId: 'run-dead-letter-test',
    source: 'test-suite',
    jobs: [
      {
        playbookId: 'unknown-playbook',
        status: 'failed',
        attempts: 1,
        maxRetries: 1,
        retriesUsed: 0,
        retryBackoffSec: 0,
        priorityScore: 100,
        matchedAnomalyCodes: ['TEST_UNKNOWN_PLAYBOOK'],
      },
    ],
  });
  await store.processSelfHealRetryQueue({ limit: 10, now: Date.now() + 1000 });
  const deadLetters = await store.listSelfHealDeadLetters(10);
  assert.ok(deadLetters.length >= 1);

  await withServer(
    async (baseUrl) => {
      const requeue = await readJson(
        await fetch(`${baseUrl}/self-heal/dead-letter/requeue`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deadLetterId: deadLetters[0].deadLetterId }),
        }),
      );
      assert.equal(requeue.status, 200);
      assert.equal(requeue.body.status, 'ok');
      assert.equal(requeue.body.requeue.status, 'queued');
      assert.ok(requeue.body.retryStatus.queuePending >= 1);
      assert.ok(requeue.body.retryStatus.manualRequeueTotal >= 1);

      const secondRequeue = await readJson(
        await fetch(`${baseUrl}/self-heal/dead-letter/requeue`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deadLetterId: deadLetters[0].deadLetterId }),
        }),
      );
      assert.equal(secondRequeue.status, 409);
      assert.equal(secondRequeue.body.error, 'dead_letter_not_pending');
      assert.equal(secondRequeue.body.currentStatus, 'queued');

      const audit = await readJson(await fetch(`${baseUrl}/self-heal/requeue-audit?limit=5`));
      assert.equal(audit.status, 200);
      assert.ok(Array.isArray(audit.body.items));
      assert.ok(audit.body.items.length >= 1);
      assert.equal(audit.body.items[0].reason, 'manual_requeue');
      assert.ok(audit.body.items[0].playbookId);

      const process = await readJson(
        await fetch(`${baseUrl}/self-heal/retry/process`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ limit: 10, now: Date.now() + 120000 }),
        }),
      );
      assert.equal(process.status, 200);
      assert.ok(process.body.summary.processed >= 1);
    },
    { store },
  );
});

test('POST /self-heal/dead-letter/requeue-bulk requeues latest dead-letter entries', async () => {
  const store = createInMemoryStore();
  await store.enqueueSelfHealRetryJobs({
    runId: 'run-dead-letter-bulk-test',
    source: 'test-suite',
    jobs: [
      {
        playbookId: 'unknown-playbook-A',
        status: 'failed',
        attempts: 1,
        maxRetries: 1,
        retriesUsed: 0,
        retryBackoffSec: 0,
        priorityScore: 100,
        matchedAnomalyCodes: ['TEST_UNKNOWN_PLAYBOOK_A'],
      },
      {
        playbookId: 'unknown-playbook-B',
        status: 'failed',
        attempts: 1,
        maxRetries: 1,
        retriesUsed: 0,
        retryBackoffSec: 0,
        priorityScore: 99,
        matchedAnomalyCodes: ['TEST_UNKNOWN_PLAYBOOK_B'],
      },
    ],
  });
  await store.processSelfHealRetryQueue({ limit: 10, now: Date.now() + 1000 });
  const deadLetters = await store.listSelfHealDeadLetters(10);
  assert.ok(deadLetters.length >= 2);

  await withServer(
    async (baseUrl) => {
      const selectedIds = [deadLetters[0].deadLetterId, deadLetters[1].deadLetterId];
      const bulk = await readJson(
        await fetch(`${baseUrl}/self-heal/dead-letter/requeue-bulk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deadLetterIds: selectedIds }),
        }),
      );
      assert.equal(bulk.status, 200);
      assert.equal(bulk.body.status, 'ok');
      assert.equal(bulk.body.summary.requested, 2);
      assert.equal(bulk.body.summary.requeued, 2);
      assert.equal(bulk.body.summary.conflicts, 0);
      assert.equal(bulk.body.summary.missing, 0);
      assert.ok(Array.isArray(bulk.body.summary.items));
      assert.equal(bulk.body.summary.items.length, 2);
      assert.equal(bulk.body.operationalAlert, null);
      assert.ok(bulk.body.retryStatus.queuePending >= 2);
      assert.ok(bulk.body.retryStatus.manualRequeueTotal >= 2);

      const secondBulk = await readJson(
        await fetch(`${baseUrl}/self-heal/dead-letter/requeue-bulk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deadLetterIds: selectedIds }),
        }),
      );
      assert.equal(secondBulk.status, 200);
      assert.equal(secondBulk.body.summary.requested, 2);
      assert.equal(secondBulk.body.summary.requeued, 0);
      assert.equal(secondBulk.body.summary.conflicts, 2);
      assert.equal(secondBulk.body.summary.missing, 0);
      assert.equal(secondBulk.body.operationalAlert?.level, 'warn');
      assert.equal(secondBulk.body.operationalAlert?.code, 'self_heal_bulk_requeue_partial');
      assert.ok(Array.isArray(secondBulk.body.operationalAlert?.reasons));
      assert.ok(secondBulk.body.operationalAlert.reasons.includes('conflicts'));

      const audit = await readJson(await fetch(`${baseUrl}/self-heal/requeue-audit?limit=5`));
      assert.equal(audit.status, 200);
      assert.ok(Array.isArray(audit.body.items));
      assert.ok(audit.body.items.length >= 2);
      assert.equal(audit.body.items[0].reason, 'manual_requeue');

      const filteredByReason = await readJson(
        await fetch(`${baseUrl}/self-heal/requeue-audit?limit=5&reason=manual_requeue`),
      );
      assert.equal(filteredByReason.status, 200);
      assert.ok(filteredByReason.body.count >= 2);

      const filteredMissingReason = await readJson(
        await fetch(`${baseUrl}/self-heal/requeue-audit?limit=5&reason=unknown_reason`),
      );
      assert.equal(filteredMissingReason.status, 200);
      assert.equal(filteredMissingReason.body.count, 0);

      const futureFrom = encodeURIComponent(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
      const filteredFuture = await readJson(await fetch(`${baseUrl}/self-heal/requeue-audit?limit=5&from=${futureFrom}`));
      assert.equal(filteredFuture.status, 200);
      assert.equal(filteredFuture.body.count, 0);

      const summary = await readJson(await fetch(`${baseUrl}/self-heal/requeue-audit/summary?days=30`));
      assert.equal(summary.status, 200);
      assert.ok(Number.isFinite(summary.body.total));
      assert.ok(Array.isArray(summary.body.byReason));
      assert.ok(summary.body.byReason.every((item) => typeof item.reason === 'string' && Number.isFinite(item.count)));
      assert.ok(Array.isArray(summary.body.byPlaybook));
      assert.ok(summary.body.byPlaybook.every((item) => typeof item.playbookId === 'string' && Number.isFinite(item.count)));
      assert.ok(Array.isArray(summary.body.daily));
      assert.ok(summary.body.daily.every((item) => typeof item.day === 'string' && Number.isFinite(item.count)));
    },
    { store },
  );
});

test('GET /products/:asin/detail returns 404 for unknown ASIN', async () => {
  await withServer(async (baseUrl) => {
    const { status, body } = await readJson(await fetch(`${baseUrl}/products/UNKNOWN_ASIN/detail`));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });
});
