import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_PATH = 'ops/reports/doctor/latest.json';

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

async function main() {
  const pathArg = process.argv[2] || DEFAULT_PATH;
  const path = resolve(pathArg);
  const raw = await readFile(path, 'utf8');
  const report = JSON.parse(raw);
  const markdown = buildMarkdown(report, pathArg);
  process.stdout.write(`${markdown}\n`);
}

main().catch((error) => {
  console.error('[Soon/doctor-summary] FAIL:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
