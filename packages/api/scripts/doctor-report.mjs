import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:3100',
  requestTimeoutMs: 8000,
  outPath: 'ops/reports/doctor/latest.json',
};

const REQUIRED_METRICS = [
  'soon_read_model_refresh_pending_count',
  'soon_read_model_refresh_in_flight',
  'soon_read_model_refresh_total_errors',
  'soon_read_model_refresh_last_duration_ms',
];

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv) {
  const outIndex = argv.indexOf('--out');
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : null;
  const jsonOnly = argv.includes('--json-only');
  return { outPath, jsonOnly };
}

function pickBaseUrl() {
  return (process.env.SOON_ALERT_BASE_URL || process.env.SOON_DOCTOR_BASE_URL || DEFAULTS.baseUrl).replace(/\/$/, '');
}

function pickTimeoutMs() {
  return toNumber(process.env.SOON_ALERT_REQUEST_TIMEOUT_MS || process.env.SOON_DOCTOR_REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs);
}

async function fetchJson(baseUrl, path, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(baseUrl, path, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`${path} failed (${response.status}): ${body}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function extractMetricValue(metricsText, metricName) {
  const line = metricsText
    .split('\n')
    .find((item) => item.startsWith(`${metricName} `) || item.startsWith(`${metricName}{`));
  if (!line) return null;
  const valuePart = line.trim().split(/\s+/).pop();
  const numericValue = Number(valuePart);
  return Number.isFinite(numericValue) ? numericValue : valuePart;
}

function extractRefreshMode(metricsText) {
  const line = metricsText.split('\n').find((item) => item.startsWith('soon_read_model_refresh_info{'));
  if (!line) return null;
  const match = line.match(/mode="([^"]+)"/);
  return match?.[1] ?? null;
}

async function runAlertCheckerJson() {
  const scriptPath = fileURLToPath(new URL('./read-model-alert-check.mjs', import.meta.url));
  try {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, '--json'], {
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, result: JSON.parse(stdout) };
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr) : '';
    const stdout = error?.stdout ? String(error.stdout) : '';
    const raw = `${stdout}\n${stderr}`.trim();
    return {
      ok: false,
      result: null,
      error: raw || (error instanceof Error ? error.message : String(error)),
      exitCode: typeof error?.code === 'number' ? error.code : 2,
    };
  }
}

function computeOverall({ healthOk, metricsComplete, checker }) {
  if (!healthOk || !metricsComplete || !checker.ok) return { overall: 'CRIT', exitCode: 2 };
  const checkerOverall = checker.result?.overall ?? 'CRIT';
  if (checkerOverall === 'CRIT') return { overall: 'CRIT', exitCode: 2 };
  if (checkerOverall === 'WARN') return { overall: 'WARN', exitCode: 1 };
  return { overall: 'PASS', exitCode: 0 };
}

function printHuman(report) {
  console.log(`[Soon/doctor] ${report.overall}`);
  console.log(`[Soon/doctor] baseUrl=${report.baseUrl} checkedAt=${report.checkedAt}`);
  console.log(`[Soon/doctor] health status=${report.health.status} storage=${report.health.storage}`);
  console.log(
    `[Soon/doctor] readModel mode=${report.readModel.status.mode} pending=${report.readModel.status.pendingCount} inFlight=${report.readModel.status.inFlight} totalErrors=${report.readModel.status.totalErrors}`,
  );
  console.log(
    `[Soon/doctor] metrics mode=${report.metrics.refreshMode ?? 'n/a'} required=${report.metrics.required.length} found=${report.metrics.found.length}`,
  );
  if (report.metrics.missing.length) {
    console.log(`[Soon/doctor] metrics missing: ${report.metrics.missing.join(', ')}`);
  }
  if (!report.alertCheck.ok) {
    console.log(`[Soon/doctor] alertCheck CRIT: ${report.alertCheck.error}`);
  } else {
    console.log(
      `[Soon/doctor] alertCheck ${report.alertCheck.result.overall} findings=${report.alertCheck.result.findings.length}`,
    );
  }
  console.log(`[Soon/doctor] artifact=${report.artifactPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = pickBaseUrl();
  const timeoutMs = pickTimeoutMs();
  const outPath = resolve(args.outPath || process.env.SOON_DOCTOR_OUT || DEFAULTS.outPath);

  const health = await fetchJson(baseUrl, '/health', timeoutMs);
  const readModelStatus = await fetchJson(baseUrl, '/automation/read-model/status', timeoutMs);
  const metricsText = await fetchText(baseUrl, '/metrics', timeoutMs);

  const found = REQUIRED_METRICS.filter((name) => extractMetricValue(metricsText, name) !== null);
  const missing = REQUIRED_METRICS.filter((name) => !found.includes(name));
  const values = Object.fromEntries(REQUIRED_METRICS.map((name) => [name, extractMetricValue(metricsText, name)]));
  const refreshMode = extractRefreshMode(metricsText);

  const checker = await runAlertCheckerJson();
  const evaluated = computeOverall({
    healthOk: health?.status === 'ok',
    metricsComplete: missing.length === 0,
    checker,
  });

  const report = {
    checkedAt: new Date().toISOString(),
    baseUrl,
    overall: evaluated.overall,
    health: {
      status: health?.status ?? 'unknown',
      service: health?.service ?? null,
      storage: health?.storage ?? null,
      modules: Array.isArray(health?.modules) ? health.modules : [],
      raw: health,
    },
    readModel: {
      status: readModelStatus,
    },
    metrics: {
      required: REQUIRED_METRICS,
      found,
      missing,
      refreshMode,
      values,
    },
    alertCheck: checker,
    artifactPath: outPath,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (args.jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }

  process.exit(evaluated.exitCode);
}

main().catch((error) => {
  console.error('[Soon/doctor] CRIT CHECK_FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(2);
});
