import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

/** Chạy migration SQL theo thứ tự tên file, mỗi file trong một transaction. */
export async function runMigrations(databaseUrl: string, dir = join(__dirname, '../migrations')): Promise<string[]> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const applied: string[] = [];
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file]);
      if (done.rows[0]) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
  return applied;
}
