import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from '@/lib/db/schema';

export default async function globalSetup() {
  const url = process.env.DATABASE_URL ?? 'file:./data/test.db';
  const dbPath = url.startsWith('file:') ? resolve(url.slice(5)) : resolve(url);

  // Always start fresh for E2E
  if (existsSync(dbPath)) rmSync(dbPath);
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  if (existsSync(walPath)) rmSync(walPath);
  if (existsSync(shmPath)) rmSync(shmPath);

  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('./drizzle') });

  sqlite.close();
  console.log(`[e2e global-setup] fresh test DB at ${dbPath}`);
}
