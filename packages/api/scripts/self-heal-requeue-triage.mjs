import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:3100',
  requestTimeoutMs: 8000,
  limit: 20,
  days: 7,
  outPath: null,
};

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv) {
  const limitIndex = argv.indexOf('--limit');
  const daysIndex = argv.indexOf('--days');
  const outIndex = argv.indexOf('--out');
  return {
    json: argv.includes('--json'),
    limit: limitIndex >= 0 ? toNumber(argv[limitIndex + 1], DEFAULTS.limit) : null,
    days: daysIndex >= 0 ? toNumber(argv[daysIndex + 1], DEFAULTS.days) : null,
    outPath: outIndex >= 0 ? String(argv[outIndex + 1] ?? '').trim() || null : null,
    skipRequeue: argv.includes('--skip-requeue'),
  };
}

function pickBaseUrl() {
  return (process.env.SOON_ALERT_BASE_URL || process.env.SOON_DOCTOR_BASE_URL || DEFAULTS.baseUrl).replace(/\/$/, '');
}

function pickTimeoutMs() {
  return toNumber(process.env.SOON_ALERT_REQUEST_TIMEOUT_MS || process.env.SOON_DOCTOR_REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

async function fetchJson(baseUrl, path, timeoutMs, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, { ...(init || {}), signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function evaluate(result, { warnAsError = false } = {}) {
  const findings = [];
  const bulkSummary = result.bulk?.summary ?? null;
  const operationalAlert = result.bulk?.operationalAlert ?? null;

  if (operationalAlert) {
    findings.push({
      severity: 'WARN',
      code: operationalAlert.code || 'SELF_HEAL_BULK_REQUEUE_ALERT',
      message: operationalAlert.message || 'bulk requeue returned operational alert',
    });
  }

  if (bulkSummary && Number(bulkSummary.conflicts ?? 0) > 0) {
    findings.push({
      severity: 'WARN',
      code: 'SELF_HEAL_REQUEUE_CONFLICTS',
      message: `conflicts=${bulkSummary.conflicts}`,
    });
  }

  if (bulkSummary && Number(bulkSummary.missing ?? 0) > 0) {
    findings.push({
      severity: 'WARN',
      code: 'SELF_HEAL_REQUEUE_MISSING',
      message: `missing=${bulkSummary.missing}`,
    });
  }

  const hasWarn = findings.some((item) => item.severity === 'WARN');
  return {
    overall: hasWarn ? 'WARN' : 'PASS',
    exitCode: hasWarn ? (warnAsError ? 2 : 0) : 0,
    findings,
  };
}

function printHuman(result) {
  console.log(`[Soon/self-heal-triage] ${result.overall}`);
  console.log(`[Soon/self-heal-triage] baseUrl=${result.baseUrl} checkedAt=${result.checkedAt}`);
  console.log(`[Soon/self-heal-triage] policy warnAsError=${result.policy?.warnAsError ? '1' : '0'}`);
  console.log(
    `[Soon/self-heal-triage] retryStatus pending=${result.retryStatus?.queuePending ?? 0} deadLetter=${result.retryStatus?.deadLetterCount ?? 0}`,
  );
  console.log(`[Soon/self-heal-triage] deadLetter listed=${result.deadLetter?.count ?? 0}`);
  if (result.bulk) {
    const summary = result.bulk.summary ?? {};
    console.log(
      `[Soon/self-heal-triage] bulk requested=${summary.requested ?? 0} requeued=${summary.requeued ?? 0} conflicts=${summary.conflicts ?? 0} missing=${summary.missing ?? 0}`,
    );
  } else {
    console.log('[Soon/self-heal-triage] bulk skipped');
  }
  console.log(`[Soon/self-heal-triage] audit count=${result.audit?.count ?? 0} summary.total=${result.auditSummary?.total ?? 0}`);
  if (!result.findings.length) {
    console.log('[Soon/self-heal-triage] no findings');
    return;
  }
  for (const finding of result.findings) {
    console.log(`[Soon/self-heal-triage] ${finding.severity} ${finding.code}: ${finding.message}`);
  }
  if (result.artifactPath) {
    console.log(`[Soon/self-heal-triage] artifact=${result.artifactPath}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = pickBaseUrl();
  const timeoutMs = pickTimeoutMs();
  const warnAsError = parseBoolean(process.env.SOON_SELF_HEAL_TRIAGE_WARN_AS_ERROR, false);
  const limit = Math.max(1, Math.min(100, toNumber(args.limit ?? process.env.SOON_SELF_HEAL_TRIAGE_LIMIT, DEFAULTS.limit)));
  const days = Math.max(1, Math.min(365, toNumber(args.days ?? process.env.SOON_SELF_HEAL_TRIAGE_DAYS, DEFAULTS.days)));
  const outPath = args.outPath || process.env.SOON_SELF_HEAL_TRIAGE_OUT || DEFAULTS.outPath;
  const resolvedOutPath = outPath ? resolve(outPath) : null;

  const retryStatus = await fetchJson(baseUrl, '/self-heal/retry/status', timeoutMs);
  const deadLetter = await fetchJson(baseUrl, `/self-heal/dead-letter?limit=${limit}`, timeoutMs);
  const bulk = args.skipRequeue
    ? null
    : await fetchJson(baseUrl, '/self-heal/dead-letter/requeue-bulk', timeoutMs, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit }),
      });
  const audit = await fetchJson(baseUrl, `/self-heal/requeue-audit?limit=${limit}`, timeoutMs);
  const auditSummary = await fetchJson(baseUrl, `/self-heal/requeue-audit/summary?days=${days}`, timeoutMs);

  const evaluated = evaluate({ bulk }, { warnAsError });
  const result = {
    checkedAt: new Date().toISOString(),
    baseUrl,
    limit,
    days,
    policy: {
      warnAsError,
    },
    retryStatus,
    deadLetter,
    bulk,
    audit,
    auditSummary,
    overall: evaluated.overall,
    findings: evaluated.findings,
    artifactPath: resolvedOutPath,
  };

  if (resolvedOutPath) {
    await mkdir(dirname(resolvedOutPath), { recursive: true });
    await writeFile(resolvedOutPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  process.exit(evaluated.exitCode);
}

main().catch((error) => {
  console.error('[Soon/self-heal-triage] CRIT CHECK_FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(2);
});
