import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TRIAGE_SCRIPT = resolve(__dirname, '../scripts/self-heal-requeue-triage.mjs');
const DOCTOR_SUMMARY_SCRIPT = resolve(__dirname, '../scripts/doctor-summary.mjs');
const TRIAGE_VALIDATE_SCRIPT = resolve(__dirname, '../scripts/self-heal-triage-validate.mjs');

async function withMockTriageServer(fn) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const { pathname } = url;

    let body = {};
    if (pathname === '/self-heal/retry/status') {
      body = { queuePending: 1, deadLetterCount: 1 };
    } else if (pathname === '/self-heal/dead-letter') {
      body = { count: 1, items: [{ deadLetterId: 'dead-1' }] };
    } else if (pathname === '/self-heal/dead-letter/requeue-bulk') {
      body = {
        status: 'ok',
        summary: { requested: 1, requeued: 0, conflicts: 1, missing: 0, items: [] },
        operationalAlert: {
          level: 'warn',
          code: 'self_heal_bulk_requeue_partial',
          message: 'bulk requeue partial',
          reasons: ['conflicts'],
        },
      };
    } else if (pathname === '/self-heal/requeue-audit') {
      body = { count: 0, items: [] };
    } else if (pathname === '/self-heal/requeue-audit/summary') {
      body = { days: 7, total: 0, byReason: [], byPlaybook: [], daily: [] };
    } else {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', pathname }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function runTriageCli(baseUrl, warnAsError) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [TRIAGE_SCRIPT], {
      env: {
        ...process.env,
        SOON_ALERT_BASE_URL: baseUrl,
        SOON_SELF_HEAL_TRIAGE_WARN_AS_ERROR: warnAsError ? '1' : '0',
      },
    });
    return { code: 0, stdout };
  } catch (error) {
    return {
      code: typeof error?.code === 'number' ? error.code : 1,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? ''),
    };
  }
}

test('self-heal-requeue-triage returns WARN but exits 0 when warn-as-error is disabled', async () => {
  await withMockTriageServer(async (baseUrl) => {
    const result = await runTriageCli(baseUrl, false);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /\[Soon\/self-heal-triage\] WARN/);
    assert.match(result.stdout, /warnAsError=0/);
  });
});

test('self-heal-requeue-triage exits 2 when warn-as-error is enabled', async () => {
  await withMockTriageServer(async (baseUrl) => {
    const result = await runTriageCli(baseUrl, true);
    assert.equal(result.code, 2);
    assert.match(result.stdout, /\[Soon\/self-heal-triage\] WARN/);
    assert.match(result.stdout, /warnAsError=1/);
  });
});

test('doctor-summary renders self-heal triage section from triage artifact', async () => {
  const tmpDir = await mkdtemp(join(os.tmpdir(), 'soon-doctor-summary-'));
  const doctorPath = join(tmpDir, 'doctor.json');
  const triagePath = join(tmpDir, 'triage.json');

  const doctorReport = {
    overall: 'PASS',
    checkedAt: new Date().toISOString(),
    health: { status: 'ok', storage: 'postgres', service: 'soon-api' },
    readModel: { status: { mode: 'async', pendingCount: 0, inFlight: false, totalErrors: 0 } },
    metrics: { refreshMode: 'async', found: ['a'], missing: [] },
    alertCheck: { ok: true, result: { overall: 'PASS', findings: [] } },
    expectations: {
      checks: {
        expectedStorage: 'postgres',
        storageMatches: true,
        expectedReadModelMode: 'async',
        readModelModeMatches: true,
      },
      findings: [],
    },
  };

  const triageReport = {
    overall: 'WARN',
    policy: { warnAsError: true },
    findings: [{ severity: 'WARN', code: 'SELF_HEAL_REQUEUE_CONFLICTS', message: 'conflicts=1' }],
    bulk: { summary: { requested: 1, requeued: 0, conflicts: 1, missing: 0 } },
  };

  await writeFile(doctorPath, `${JSON.stringify(doctorReport, null, 2)}\n`, 'utf8');
  await writeFile(triagePath, `${JSON.stringify(triageReport, null, 2)}\n`, 'utf8');

  const { stdout } = await execFileAsync(process.execPath, [DOCTOR_SUMMARY_SCRIPT, doctorPath, triagePath], {
    env: process.env,
  });

  assert.match(stdout, /### Self-heal Requeue Triage/);
  assert.match(stdout, /Overall: `WARN`/);
  assert.match(stdout, /Warn as error: `true`/);
  assert.match(stdout, /Bulk conflicts\/missing: `1\/0`/);
});

test('doctor-summary fails in strict mode when triage artifact is missing', async () => {
  const tmpDir = await mkdtemp(join(os.tmpdir(), 'soon-doctor-summary-strict-'));
  const doctorPath = join(tmpDir, 'doctor.json');

  const doctorReport = {
    overall: 'PASS',
    checkedAt: new Date().toISOString(),
    health: { status: 'ok', storage: 'postgres', service: 'soon-api' },
    readModel: { status: { mode: 'async', pendingCount: 0, inFlight: false, totalErrors: 0 } },
    metrics: { refreshMode: 'async', found: ['a'], missing: [] },
    alertCheck: { ok: true, result: { overall: 'PASS', findings: [] } },
    expectations: { checks: {}, findings: [] },
  };
  await writeFile(doctorPath, `${JSON.stringify(doctorReport, null, 2)}\n`, 'utf8');

  await assert.rejects(
    execFileAsync(process.execPath, [DOCTOR_SUMMARY_SCRIPT, doctorPath, join(tmpDir, 'missing-triage.json')], {
      env: { ...process.env, SOON_DOCTOR_SUMMARY_REQUIRE_TRIAGE: '1' },
    }),
    /required triage artifact missing/,
  );
});

test('self-heal-triage-validate fails when required fields are missing', async () => {
  const tmpDir = await mkdtemp(join(os.tmpdir(), 'soon-triage-validate-'));
  const triagePath = join(tmpDir, 'triage-invalid.json');
  await writeFile(triagePath, `${JSON.stringify({ overall: 'WARN' }, null, 2)}\n`, 'utf8');

  await assert.rejects(
    execFileAsync(process.execPath, [TRIAGE_VALIDATE_SCRIPT, triagePath], { env: process.env }),
    /policy must be an object|bulk.summary must be an object/,
  );
});

const MONITORING_STRICT_SCRIPT = resolve(__dirname, '../scripts/monitoring-config-strict.mjs');
const REPO_ROOT = resolve(__dirname, '../../..');
const STRICT_RENDERED_PATH = 'tmp/monitoring/alertmanager.strict.rendered.yml';
const STRICT_FALLBACK_WEBHOOK = 'https://example.invalid/soon-discord-webhook';

async function createStrictMockTools(tmpDir) {
  const { chmod } = await import('node:fs/promises');
  const promtoolPath = join(tmpDir, 'promtool');
  const amtoolPath = join(tmpDir, 'amtool');

  await writeFile(
    promtoolPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" != "check" || "\${2:-}" != "rules" ]]; then
  echo "promtool bad args" >&2
  exit 91
fi
exit 0
`,
    'utf8',
  );

  await writeFile(
    amtoolPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" != "check-config" ]]; then
  echo "amtool bad args" >&2
  exit 92
fi
config_path="\${2:-}"
if [[ -n "\${STRICT_OBS_BASE:-}" ]]; then
  printf "%s" "$config_path" > "\${STRICT_OBS_BASE}.path"
  cat "$config_path" > "\${STRICT_OBS_BASE}.config"
fi
if grep -q '\${SOON_OPS_DISCORD_WEBHOOK_URL}' "$config_path"; then
  echo "placeholder not rendered" >&2
  exit 93
fi
if [[ -n "\${STRICT_EXPECTED_WEBHOOK:-}" ]] && ! grep -Fq "$STRICT_EXPECTED_WEBHOOK" "$config_path"; then
  echo "expected webhook missing" >&2
  exit 94
fi
exit 0
`,
    'utf8',
  );

  await chmod(promtoolPath, 0o755);
  await chmod(amtoolPath, 0o755);
}

test('monitoring-config-strict json output matches snapshot with rendered-config details', async () => {
  const { access } = await import('node:fs/promises');
  const tmpDir = await mkdtemp(join(os.tmpdir(), 'soon-monitoring-strict-snapshot-'));
  const obsBase = join(tmpDir, 'amtool-observed');
  await createStrictMockTools(tmpDir);

  const { stdout } = await execFileAsync(process.execPath, [MONITORING_STRICT_SCRIPT, '--json'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PATH: `${tmpDir}:${process.env.PATH ?? ''}`,
      STRICT_OBS_BASE: obsBase,
      STRICT_EXPECTED_WEBHOOK: STRICT_FALLBACK_WEBHOOK,
    },
  });

  const parsed = JSON.parse(stdout);
  assert.match(parsed.checkedAt, /^\d{4}-\d{2}-\d{2}T/);

  const normalized = { ...parsed, checkedAt: '<ISO>' };
  assert.deepEqual(normalized, {
    checkedAt: '<ISO>',
    paths: {
      prometheusRules: 'ops/monitoring/prometheus/soon-read-model-alerts.yml',
      alertmanager: 'ops/monitoring/alertmanager/soon-alertmanager-discord.example.yml',
    },
    overall: 'PASS',
    details: [
      { mode: 'local-binary', tool: 'promtool' },
      { mode: 'local-binary', tool: 'amtool' },
      {
        mode: 'rendered-config',
        tool: 'amtool',
        source: 'ops/monitoring/alertmanager/soon-alertmanager-discord.example.yml',
        renderedPath: STRICT_RENDERED_PATH,
      },
    ],
    findings: [],
  });

  await assert.rejects(access(resolve(REPO_ROOT, STRICT_RENDERED_PATH)), /ENOENT/);
});

test('monitoring-config-strict renders custom webhook into temporary alertmanager config and cleans up', async () => {
  const { access, readFile } = await import('node:fs/promises');
  const tmpDir = await mkdtemp(join(os.tmpdir(), 'soon-monitoring-strict-regression-'));
  const obsBase = join(tmpDir, 'amtool-observed');
  const expectedWebhook = 'https://hooks.example.invalid/soon-test-webhook';
  await createStrictMockTools(tmpDir);

  const { stdout } = await execFileAsync(process.execPath, [MONITORING_STRICT_SCRIPT, '--json'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PATH: `${tmpDir}:${process.env.PATH ?? ''}`,
      STRICT_OBS_BASE: obsBase,
      STRICT_EXPECTED_WEBHOOK: expectedWebhook,
      SOON_OPS_DISCORD_WEBHOOK_URL: expectedWebhook,
    },
  });

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.overall, 'PASS');

  const observedPath = (await readFile(`${obsBase}.path`, 'utf8')).trim();
  const observedConfig = await readFile(`${obsBase}.config`, 'utf8');

  assert.equal(observedPath, STRICT_RENDERED_PATH);
  assert.match(observedConfig, new RegExp(expectedWebhook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(observedConfig, /\$\{SOON_OPS_DISCORD_WEBHOOK_URL\}/);

  await assert.rejects(access(resolve(REPO_ROOT, STRICT_RENDERED_PATH)), /ENOENT/);
});
