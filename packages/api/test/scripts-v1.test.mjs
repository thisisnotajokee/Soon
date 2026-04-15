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
