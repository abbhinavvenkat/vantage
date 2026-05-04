import { createHash } from 'node:crypto';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type Attempt = { ts: number };

const memory = new Map<string, Attempt[]>();

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

export function ipFromRequest(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

function pruneAndPersist(ipHash: string, list: Attempt[]): Attempt[] {
  const cutoff = Date.now() - WINDOW_MS;
  const fresh = list.filter((a) => a.ts > cutoff);
  if (fresh.length === 0) {
    memory.delete(ipHash);
  } else {
    memory.set(ipHash, fresh);
  }
  return fresh;
}

async function getDbAttempts(ipHash: string): Promise<Attempt[]> {
  try {
    const { getRawSqlite } = await import('@/lib/db/client');
    const sqlite = getRawSqlite();
    const cutoff = Date.now() - WINDOW_MS;
    const rows = sqlite
      .prepare('SELECT ts FROM login_attempts WHERE ip_hash = ? AND ts > ?')
      .all(ipHash, cutoff) as Array<{ ts: number }>;
    return rows.map((r) => ({ ts: r.ts }));
  } catch {
    return [];
  }
}

async function persistAttempt(ipHash: string, ts: number): Promise<void> {
  try {
    const { getRawSqlite } = await import('@/lib/db/client');
    const sqlite = getRawSqlite();
    sqlite.prepare('INSERT INTO login_attempts (ip_hash, ts) VALUES (?, ?)').run(ipHash, ts);
  } catch {
    // DB not ready yet; in-memory store still enforces limit.
  }
}

async function clearPersisted(ipHash: string): Promise<void> {
  try {
    const { getRawSqlite } = await import('@/lib/db/client');
    const sqlite = getRawSqlite();
    sqlite.prepare('DELETE FROM login_attempts WHERE ip_hash = ?').run(ipHash);
  } catch {
    // ignore
  }
}

export async function checkLoginRate(
  ipHash: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const inMem = memory.get(ipHash) ?? [];
  const persisted = await getDbAttempts(ipHash);
  const merged = pruneAndPersist(ipHash, [...inMem, ...persisted]);
  const remaining = Math.max(0, MAX_ATTEMPTS - merged.length);
  return { allowed: merged.length < MAX_ATTEMPTS, remaining };
}

export async function recordLoginAttempt(ipHash: string): Promise<void> {
  const ts = Date.now();
  const list = memory.get(ipHash) ?? [];
  list.push({ ts });
  pruneAndPersist(ipHash, list);
  await persistAttempt(ipHash, ts);
}

export async function resetLoginRate(ipHash: string): Promise<void> {
  memory.delete(ipHash);
  await clearPersisted(ipHash);
}
