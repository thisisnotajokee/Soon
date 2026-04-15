import { Pool } from 'pg';

import { applyRuntimeMigrations } from '../src/runtime/db-migrations.mjs';

async function main() {
  const connectionString = process.env.SOON_DATABASE_URL;
  if (!connectionString) {
    throw new Error('SOON_DATABASE_URL is required');
  }

  const ssl = process.env.SOON_DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString, ssl });

  try {
    await applyRuntimeMigrations(pool);
    console.log('[Soon/api] DB migrations applied successfully');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[Soon/api] DB migrations failed', error);
  process.exit(1);
});
