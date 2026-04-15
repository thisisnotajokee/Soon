import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

async function loadMigrations() {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  const migrations = [];
  for (const file of files) {
    const migrationId = file.replace(/\.sql$/, '');
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    migrations.push({ migrationId, sql });
  }

  return migrations;
}

export async function applyRuntimeMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS soon_schema_migration (
      migration_id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrations = await loadMigrations();

  for (const migration of migrations) {
    const exists = await pool.query(
      'SELECT 1 FROM soon_schema_migration WHERE migration_id = $1',
      [migration.migrationId],
    );

    if (exists.rowCount > 0) {
      continue;
    }

    await pool.query('BEGIN');
    try {
      await pool.query(migration.sql);
      await pool.query(
        'INSERT INTO soon_schema_migration (migration_id) VALUES ($1)',
        [migration.migrationId],
      );
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
}
