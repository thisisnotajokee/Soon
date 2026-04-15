import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_PATH = 'ops/reports/doctor/latest.json';
const DEFAULT_TRIAGE_PATH = 'ops/reports/doctor/self-heal-triage.json';

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function validateTriageShape(triage) {
  if (!triage || typeof triage !== 'object' || Array.isArray(triage)) return false;
  if (typeof triage.overall !== 'string') return false;
  if (!triage.policy || typeof triage.policy !== 'object') return false;
  if (typeof triage.policy.warnAsError !== 'boolean') return false;
  if (!triage.bulk || typeof triage.bulk !== 'object') return false;
  if (!triage.bulk.summary || typeof triage.bulk.summary !== 'object') return false;
  return true;
}

function formatList(items) {
  if (!Array.isArray(items) || items.length === 0) return '_none_';
  return items.map((item) => `\`${item}\``).join(', ');
}

function buildMarkdown(report, path) {
  const status = report?.readModel?.status ?? {};
  const metrics = report?.metrics ?? {};
  const checker = report?.alertCheck ?? {};
  const checkerResult = checker?.result ?? {};
  const checkerFindings = checkerResult?.findings ?? [];
  const expectations = report?.expectations ?? {};
  const checks = expectations?.checks ?? {};
  const expectationFindings = expectations?.findings ?? [];

  return [
    '## Soon Doctor Report',
    '',
    `- Overall: **${report?.overall ?? 'unknown'}**`,
    `- Checked at: \`${report?.checkedAt ?? 'n/a'}\``,
    `- Artifact: \`${path}\``,
    '',
    '### Health',
    `- Status: \`${report?.health?.status ?? 'unknown'}\``,
    `- Storage: \`${report?.health?.storage ?? 'unknown'}\``,
    `- Service: \`${report?.health?.service ?? 'unknown'}\``,
    '',
    '### Read Model',
    `- Mode: \`${status.mode ?? 'unknown'}\``,
    `- Pending: \`${status.pendingCount ?? 'n/a'}\``,
    `- In flight: \`${status.inFlight ?? 'n/a'}\``,
    `- Total errors: \`${status.totalErrors ?? 'n/a'}\``,
    '',
    '### Metrics',
    `- Refresh mode: \`${metrics.refreshMode ?? 'unknown'}\``,
    `- Found: ${Array.isArray(metrics.found) ? metrics.found.length : 0}`,
    `- Missing: ${formatList(metrics.missing)}`,
    '',
    '### Alert Checker',
    `- Runner status: \`${checker.ok ? 'ok' : 'failed'}\``,
    `- Overall: \`${checkerResult.overall ?? 'n/a'}\``,
    `- Findings: \`${checkerFindings.length}\``,
    '',
    '### Expectations',
    `- Expected storage: \`${checks.expectedStorage ?? 'n/a'}\``,
    `- Storage matches: \`${checks.storageMatches ?? 'n/a'}\``,
    `- Expected read-model mode: \`${checks.expectedReadModelMode ?? 'n/a'}\``,
    `- Read-model mode matches: \`${checks.readModelModeMatches ?? 'n/a'}\``,
    `- Expectation findings: \`${expectationFindings.length}\``,
  ].join('\n');
}

function buildTriageMarkdown(triage, triagePathArg) {
  if (!triage) {
    return [
      '',
      '### Self-heal Requeue Triage',
      '- Status: `n/a`',
      `- Artifact: \`${triagePathArg}\` (missing)`,
    ].join('\n');
  }

  const summary = triage.bulk?.summary ?? {};
  const findings = Array.isArray(triage.findings) ? triage.findings : [];

  return [
    '',
    '### Self-heal Requeue Triage',
    `- Overall: \`${triage.overall ?? 'unknown'}\``,
    `- Warn as error: \`${triage.policy?.warnAsError ?? 'n/a'}\``,
    `- Findings: \`${findings.length}\``,
    `- Bulk requested/requeued: \`${summary.requested ?? 0}/${summary.requeued ?? 0}\``,
    `- Bulk conflicts/missing: \`${summary.conflicts ?? 0}/${summary.missing ?? 0}\``,
    `- Artifact: \`${triagePathArg}\``,
  ].join('\n');
}

async function readJsonOrNull(path) {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const pathArg = process.argv[2] || DEFAULT_PATH;
  const triagePathArg = process.argv[3] || DEFAULT_TRIAGE_PATH;
  const requireTriage = parseBoolean(process.env.SOON_DOCTOR_SUMMARY_REQUIRE_TRIAGE, false);
  const path = resolve(pathArg);
  const triagePath = resolve(triagePathArg);
  const raw = await readFile(path, 'utf8');
  const report = JSON.parse(raw);
  const triage = await readJsonOrNull(triagePath);
  if (requireTriage && !triage) {
    throw new Error(`required triage artifact missing: ${triagePathArg}`);
  }
  if (requireTriage && !validateTriageShape(triage)) {
    throw new Error(`required triage artifact has invalid shape: ${triagePathArg}`);
  }
  const markdown = `${buildMarkdown(report, pathArg)}\n${buildTriageMarkdown(triage, triagePathArg)}`;
  process.stdout.write(`${markdown}\n`);
}

main().catch((error) => {
  console.error('[Soon/doctor-summary] FAIL:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
