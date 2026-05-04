/**
 * Reset the single user's password (local CLI only — requires SQLite file access).
 * Usage: npx tsx scripts/reset-password.ts
 */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import { hash } from '@/lib/auth/password';
import { getSingleUser } from '@/lib/db/queries/users';
import * as schema from '@/lib/db/schema';
import { users } from '@/lib/db/schema';

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/app.db';
  if (url.startsWith('file:')) return resolve(url.slice('file:'.length));
  return resolve(url);
}

async function main() {
  const dbPath = resolveDbPath();
  const sqlite = new Database(dbPath);
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const user = getSingleUser(db);
  if (!user) {
    console.error('[reset-password] no user found — run npm run setup first');
    process.exit(1);
  }

  const rl = createInterface({ input, output });
  const password = await rl.question('New password (min 12 chars): ');
  rl.close();

  if (password.length < 12) {
    console.error('[reset-password] password too short');
    process.exit(1);
  }

  const passwordHash = await hash(password);
  db.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run();
  console.log('[reset-password] password updated');
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
