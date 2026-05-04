/**
 * First-run setup script.
 * Usage: npx tsx scripts/setup.ts
 * - Runs DB migrations
 * - Creates the initial user (prompts for password interactively, or reads SETUP_PASSWORD env)
 */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hash } from '@/lib/auth/password';
import { createUser, userCount } from '@/lib/db/queries/users';
import * as schema from '@/lib/db/schema';

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/app.db';
  if (url.startsWith('file:')) return resolve(url.slice('file:'.length));
  return resolve(url);
}

async function main() {
  const dbPath = resolveDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('./drizzle') });
  console.log('[setup] migrations applied');

  const count = userCount(db);
  if (count > 0) {
    console.log('[setup] user already exists — skipping user creation');
    sqlite.close();
    return;
  }

  let password = process.env.SETUP_PASSWORD ?? '';
  if (!password) {
    const rl = createInterface({ input, output });
    password = await rl.question('Enter password (min 12 chars): ');
    rl.close();
  }

  if (password.length < 12) {
    console.error('[setup] password must be at least 12 characters');
    process.exit(1);
  }

  const passwordHash = await hash(password);
  const user = createUser(db, passwordHash);
  console.log(`[setup] user created (id=${user.id})`);
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
