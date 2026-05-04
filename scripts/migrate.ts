import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/app.db';
  if (url === ':memory:') return ':memory:';
  if (url.startsWith('file:')) return resolve(url.slice('file:'.length));
  return resolve(url);
}

function main(): void {
  const dbPath = resolveDbPath();
  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  if (dbPath !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite);
  const migrationsFolder = resolve('./drizzle');

  console.log(`[migrate] db=${dbPath} migrations=${migrationsFolder}`);
  migrate(db, { migrationsFolder });
  console.log('[migrate] done');

  sqlite.close();
}

main();
