import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  prometheusRulesPath: 'ops/monitoring/prometheus/soon-read-model-alerts.yml',
  alertmanagerPath: 'ops/monitoring/alertmanager/soon-alertmanager-discord.example.yml',
  renderedAlertmanagerPath: 'tmp/monitoring/alertmanager.strict.rendered.yml',
  promImage: 'prom/prometheus:v2.53.3',
  alertmanagerImage: 'prom/alertmanager:v0.28.1',
};

const AMTOOL_WEBHOOK_FALLBACK_URL = 'https://example.invalid/soon-discord-webhook';
const DISCORD_WEBHOOK_TOKEN = '${SOON_OPS_DISCORD_WEBHOOK_URL}';

function parseArgs(argv) {
  return { json: argv.includes('--json') };
}

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function hasBinary(binary) {
  try {
    await execFileAsync('which', [binary]);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(cmd, args) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function runPromtoolLocal(rulesPath) {
  await runCommand('promtool', ['check', 'rules', rulesPath]);
  return { mode: 'local-binary', tool: 'promtool' };
}

async function runAmtoolLocal(alertmanagerPath) {
  await runCommand('amtool', ['check-config', alertmanagerPath]);
  return { mode: 'local-binary', tool: 'amtool' };
}

async function runPromtoolDocker(repoRoot, rulesPath) {
  await runCommand('docker', [
    'run',
    '--rm',
    '-v',
    `${repoRoot}:/repo`,
    '-w',
    '/repo',
    '--entrypoint',
    'promtool',
    DEFAULTS.promImage,
    'check',
    'rules',
    rulesPath,
  ]);
  return { mode: 'docker-fallback', tool: 'promtool', image: DEFAULTS.promImage };
}

async function runAmtoolDocker(repoRoot, alertmanagerPath) {
  await runCommand('docker', [
    'run',
    '--rm',
    '-v',
    `${repoRoot}:/repo`,
    '-w',
    '/repo',
    '--entrypoint',
    'amtool',
    DEFAULTS.alertmanagerImage,
    'check-config',
    alertmanagerPath,
  ]);
  return { mode: 'docker-fallback', tool: 'amtool', image: DEFAULTS.alertmanagerImage };
}

async function prepareAlertmanagerConfig(repoRoot, alertmanagerPath) {
  const absoluteSource = resolve(repoRoot, alertmanagerPath);
  const source = await readFile(absoluteSource, 'utf8');

  if (!source.includes(DISCORD_WEBHOOK_TOKEN)) {
    return {
      configPathForCheck: alertmanagerPath,
      rendered: false,
      cleanup: async () => {},
    };
  }

  const rendered = source.replaceAll(
    DISCORD_WEBHOOK_TOKEN,
    process.env.SOON_OPS_DISCORD_WEBHOOK_URL || AMTOOL_WEBHOOK_FALLBACK_URL,
  );

  const absoluteRendered = resolve(repoRoot, DEFAULTS.renderedAlertmanagerPath);
  await mkdir(resolve(repoRoot, 'tmp/monitoring'), { recursive: true });
  await writeFile(absoluteRendered, rendered, 'utf8');

  return {
    configPathForCheck: DEFAULTS.renderedAlertmanagerPath,
    rendered: true,
    cleanup: async () => {
      await rm(absoluteRendered, { force: true });
    },
  };
}

async function strictValidate() {
  const repoRoot = process.cwd();
  const rulesPath = DEFAULTS.prometheusRulesPath;
  const alertmanagerPath = DEFAULTS.alertmanagerPath;
  const findings = [];
  const details = [];

  if (!(await fileExists(resolve(repoRoot, rulesPath)))) {
    findings.push(`missing file: ${rulesPath}`);
  }
  if (!(await fileExists(resolve(repoRoot, alertmanagerPath)))) {
    findings.push(`missing file: ${alertmanagerPath}`);
  }
  if (findings.length) {
    return { overall: 'CRIT', findings, details };
  }

  const forceDocker = process.env.SOON_MONITORING_STRICT_FORCE_DOCKER === '1';

  try {
    if (!forceDocker && (await hasBinary('promtool'))) {
      details.push(await runPromtoolLocal(rulesPath));
    } else {
      details.push(await runPromtoolDocker(repoRoot, rulesPath));
    }
  } catch (error) {
    findings.push(`promtool-check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const preparedAlertmanager = await prepareAlertmanagerConfig(repoRoot, alertmanagerPath);
  try {
    if (!forceDocker && (await hasBinary('amtool'))) {
      details.push(await runAmtoolLocal(preparedAlertmanager.configPathForCheck));
    } else {
      details.push(await runAmtoolDocker(repoRoot, preparedAlertmanager.configPathForCheck));
    }
    if (preparedAlertmanager.rendered) {
      details.push({
        mode: 'rendered-config',
        tool: 'amtool',
        source: alertmanagerPath,
        renderedPath: preparedAlertmanager.configPathForCheck,
      });
    }
  } catch (error) {
    findings.push(`amtool-check failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await preparedAlertmanager.cleanup();
  }

  return { overall: findings.length ? 'CRIT' : 'PASS', findings, details };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const validated = await strictValidate();
  const result = {
    checkedAt: new Date().toISOString(),
    paths: {
      prometheusRules: DEFAULTS.prometheusRulesPath,
      alertmanager: DEFAULTS.alertmanagerPath,
    },
    overall: validated.overall,
    details: validated.details,
    findings: validated.findings,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.overall === 'PASS') {
    console.log('[Soon/monitoring-strict] PASS');
    for (const detail of result.details) {
      console.log(
        `[Soon/monitoring-strict] ${detail.tool} via ${detail.mode}${detail.image ? ` (${detail.image})` : ''}`,
      );
    }
  } else {
    console.log('[Soon/monitoring-strict] CRIT');
    for (const finding of result.findings) {
      console.log(`[Soon/monitoring-strict] ${finding}`);
    }
  }

  process.exit(result.overall === 'PASS' ? 0 : 2);
}

main().catch((error) => {
  console.error('[Soon/monitoring-strict] CRIT CHECK_FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(2);
});
