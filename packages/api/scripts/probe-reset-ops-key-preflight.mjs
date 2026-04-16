const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:3100',
  requestTimeoutMs: 8000,
};

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isProdLikeEnv() {
  const candidates = [
    process.env.NODE_ENV,
    process.env.SOON_ENV,
    process.env.DEPLOY_ENV,
    process.env.ENVIRONMENT,
  ];
  return candidates.some((value) => ['prod', 'production'].includes(String(value ?? '').toLowerCase()));
}

function parseBoolean(raw, fallback) {
  const normalized = String(raw ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseSettingsFromEnv() {
  const fallbackRequireGuard = Boolean(process.env.CI) || isProdLikeEnv();
  return {
    baseUrl: process.env.SOON_ALERT_BASE_URL || DEFAULTS.baseUrl,
    requestTimeoutMs: toNumber(process.env.SOON_ALERT_REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs),
    opsKey: String(process.env.SOON_TOKEN_PROBE_RESET_OPS_KEY ?? '').trim(),
    requireGuard: parseBoolean(process.env.SOON_PROBE_RESET_PREFLIGHT_REQUIRE_GUARD, fallbackRequireGuard),
  };
}

function parseArgs(argv) {
  return { json: argv.includes('--json') };
}

async function fetchJson(baseUrl, path, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function runAuthSanityCheck(settings) {
  if (!settings.opsKey) {
    return {
      attempted: false,
      status: null,
      ok: false,
      code: 'PROBE_RESET_OPS_KEY_NOT_PROVIDED',
      message: 'SOON_TOKEN_PROBE_RESET_OPS_KEY is empty; auth sanity check skipped',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/api/token-control/probe-policy/reset`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-soon-ops-key': settings.opsKey,
      },
      body: JSON.stringify({
        confirm: '__preflight_invalid_confirm__',
        reason: 'probe-reset-ops-key-preflight',
        dryRun: true,
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.status === 401) {
      return {
        attempted: true,
        status: 401,
        ok: false,
        code: 'PROBE_RESET_AUTH_REQUIRED',
        message: `reset endpoint requires auth: ${JSON.stringify(body)}`,
      };
    }
    if (response.status === 403) {
      return {
        attempted: true,
        status: 403,
        ok: false,
        code: 'PROBE_RESET_AUTH_INVALID',
        message: `provided ops key is invalid: ${JSON.stringify(body)}`,
      };
    }
    if ([200, 400, 409].includes(response.status)) {
      return {
        attempted: true,
        status: response.status,
        ok: true,
        code: 'PROBE_RESET_AUTH_OK',
        message: `auth accepted (status=${response.status})`,
      };
    }
    return {
      attempted: true,
      status: response.status,
      ok: false,
      code: 'PROBE_RESET_AUTH_UNEXPECTED_STATUS',
      message: `unexpected reset status=${response.status}: ${JSON.stringify(body)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function evaluate(statusPayload, authSanity, settings) {
  const findings = [];
  const opsKeyRequired = Boolean(statusPayload?.auth?.opsKeyRequired);

  if (!opsKeyRequired) {
    findings.push({
      severity: settings.requireGuard ? 'CRIT' : 'WARN',
      code: settings.requireGuard ? 'PROBE_RESET_GUARD_REQUIRED_BUT_DISABLED' : 'PROBE_RESET_GUARD_DISABLED',
      message: `status auth.opsKeyRequired=${opsKeyRequired}`,
    });
  }

  if (opsKeyRequired && !settings.opsKey) {
    findings.push({
      severity: 'CRIT',
      code: 'PROBE_RESET_OPS_KEY_MISSING',
      message: 'SOON_TOKEN_PROBE_RESET_OPS_KEY is required but not provided to preflight script',
    });
  }

  if (authSanity.attempted && !authSanity.ok) {
    findings.push({
      severity: 'CRIT',
      code: authSanity.code,
      message: authSanity.message,
    });
  }

  const hasCrit = findings.some((finding) => finding.severity === 'CRIT');
  const hasWarn = findings.some((finding) => finding.severity === 'WARN');
  const overall = hasCrit ? 'CRIT' : hasWarn ? 'WARN' : 'PASS';
  const exitCode = hasCrit ? 2 : hasWarn ? 1 : 0;

  return { overall, exitCode, findings };
}

function printHuman(result) {
  console.log(`[Soon/probe-reset-preflight] ${result.overall}`);
  console.log(
    `[Soon/probe-reset-preflight] baseUrl=${result.baseUrl} opsKeyRequired=${result.status?.auth?.opsKeyRequired ? '1' : '0'} localOpsKey=${result.auth.localOpsKeyConfigured ? '1' : '0'} requireGuard=${result.policy.requireGuard ? '1' : '0'}`,
  );
  console.log(
    `[Soon/probe-reset-preflight] authSanity attempted=${result.auth.sanity.attempted ? '1' : '0'} ok=${result.auth.sanity.ok ? '1' : '0'} status=${result.auth.sanity.status ?? 'n/a'}`,
  );
  if (!result.findings.length) {
    console.log('[Soon/probe-reset-preflight] no findings');
    return;
  }
  for (const finding of result.findings) {
    console.log(`[Soon/probe-reset-preflight] ${finding.severity} ${finding.code}: ${finding.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const settings = parseSettingsFromEnv();
  const status = await fetchJson(
    settings.baseUrl,
    '/api/token-control/probe-policy/reset-auth/status',
    settings.requestTimeoutMs,
  );
  const authSanity = await runAuthSanityCheck(settings);
  const evaluated = evaluate(status, authSanity, settings);

  const result = {
    checkedAt: new Date().toISOString(),
    baseUrl: settings.baseUrl,
    policy: {
      requireGuard: settings.requireGuard,
    },
    auth: {
      localOpsKeyConfigured: Boolean(settings.opsKey),
      sanity: authSanity,
    },
    status,
    overall: evaluated.overall,
    findings: evaluated.findings,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
  process.exit(evaluated.exitCode);
}

main().catch((error) => {
  console.error('[Soon/probe-reset-preflight] CRIT CHECK_FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(2);
});
