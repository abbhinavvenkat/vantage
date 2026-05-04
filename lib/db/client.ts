import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import * as schema from '@/lib/db/schema';

type Sqlite = Database.Database;
export type Db = BetterSQLite3Database<typeof schema>;

type Cached = { sqlite: Sqlite; db: Db; path: string };

const GLOBAL_KEY = Symbol.for('stock-platform.db.singleton');

type GlobalWithDb = typeof globalThis & {
  [GLOBAL_KEY]?: Cached;
};

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/app.db';
  if (url === ':memory:') return ':memory:';
  if (url.startsWith('file:')) {
    const raw = url.slice('file:'.length);
    return resolve(raw);
  }
  return resolve(url);
}

function ensureDir(path: string): void {
  if (path === ':memory:') return;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function build(path: string): Cached {
  ensureDir(path);
  const sqlite = new Database(path);
  if (path !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db, path };
}

function getCached(): Cached {
  const g = globalThis as GlobalWithDb;
  const path = resolveDbPath();
  const cached = g[GLOBAL_KEY];
  if (cached && cached.path === path) return cached;
  if (cached && cached.path !== path) {
    try {
      cached.sqlite.close();
    } catch {
      /* ignore */
    }
  }
  const built = build(path);
  g[GLOBAL_KEY] = built;
  return built;
}

export const sqlite: Sqlite = getCached().sqlite;
export const db: Db = getCached().db;

export function getDb(): Db {
  return getCached().db;
}

export function getRawSqlite(): Sqlite {
  return getCached().sqlite;
}

/**
 * Open a fresh DB at an explicit path or `:memory:`. Bypasses the singleton.
 * Used by tests and migration scripts that need a non-default DB.
 */
export function openDb(path: string): { sqlite: Sqlite; db: Db } {
  const built = build(path);
  return { sqlite: built.sqlite, db: built.db };
}
