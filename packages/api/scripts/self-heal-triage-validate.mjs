import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_PATH = 'ops/reports/doctor/self-heal-triage.json';

function isFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed);
}

function validateTriageArtifact(data) {
  const errors = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['root must be an object'];
  }

  if (typeof data.overall !== 'string' || !['PASS', 'WARN', 'CRIT'].includes(data.overall)) {
    errors.push('overall must be one of: PASS|WARN|CRIT');
  }

  if (!data.policy || typeof data.policy !== 'object' || Array.isArray(data.policy)) {
    errors.push('policy must be an object');
  } else if (typeof data.policy.warnAsError !== 'boolean') {
    errors.push('policy.warnAsError must be boolean');
  }

  if (!Array.isArray(data.findings)) {
    errors.push('findings must be an array');
  }

  const summary = data.bulk?.summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    errors.push('bulk.summary must be an object');
  } else {
    if (!isFiniteNumber(summary.requested)) errors.push('bulk.summary.requested must be numeric');
    if (!isFiniteNumber(summary.requeued)) errors.push('bulk.summary.requeued must be numeric');
    if (!isFiniteNumber(summary.conflicts)) errors.push('bulk.summary.conflicts must be numeric');
    if (!isFiniteNumber(summary.missing)) errors.push('bulk.summary.missing must be numeric');
  }

  return errors;
}

async function main() {
  const pathArg = process.argv[2] || DEFAULT_PATH;
  const path = resolve(pathArg);

  const raw = await readFile(path, 'utf8');
  const data = JSON.parse(raw);
  const errors = validateTriageArtifact(data);

  if (errors.length > 0) {
    console.error('[Soon/self-heal-triage-validate] FAIL');
    for (const error of errors) {
      console.error(`[Soon/self-heal-triage-validate] ${error}`);
    }
    process.exit(2);
  }

  console.log(
    `[Soon/self-heal-triage-validate] PASS overall=${data.overall} warnAsError=${data.policy.warnAsError} conflicts=${data.bulk.summary.conflicts} missing=${data.bulk.summary.missing}`,
  );
}

main().catch((error) => {
  console.error('[Soon/self-heal-triage-validate] FAIL:', error instanceof Error ? error.message : String(error));
  process.exit(2);
});
