import { Pool } from 'pg';

function parseArgs(argv) {
  const args = {
    retentionDays: 30,
    execute: false,
  };

  for (const token of argv) {
    if (token === '--execute') {
      args.execute = true;
      continue;
    }

    if (token.startsWith('--retention-days=')) {
      const value = Number(token.split('=')[1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('Invalid --retention-days value');
      }
      args.retentionDays = value;
      continue;
    }
  }

  return args;
}

async function main() {
  const { retentionDays, execute } = parseArgs(process.argv.slice(2));

  const connectionString = process.env.SOON_DATABASE_URL;
  if (!connectionString) {
    throw new Error('SOON_DATABASE_URL is required');
  }

  const ssl = process.env.SOON_DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString, ssl });

  try {
    const res = await pool.query(
      'SELECT * FROM soon_cleanup_legacy_backup($1::int, $2::boolean)',
      [retentionDays, execute],
    );

    const row = res.rows[0];
    console.log('[Soon/api] legacy backup cleanup result', {
      mode: execute ? 'execute' : 'preview',
      retentionDays: row.retention_days,
      cutoff: row.cutoff,
      eligibleRows: Number(row.eligible_rows),
      deletedRows: Number(row.deleted_rows),
    });
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[Soon/api] legacy backup cleanup failed', error);
  process.exit(1);
});
