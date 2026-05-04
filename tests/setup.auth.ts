import { vi } from 'vitest';

if (!process.env.SESSION_PASSWORD) {
  process.env.SESSION_PASSWORD = 'test_session_password_at_least_32_chars_long_xx';
}

type UserRow = { id: number; passwordHash: string };
type RateRow = { ipHash: string; ts: number };

declare global {
  var __authTestState:
    | {
        userStore: { rows: UserRow[]; nextId: number };
        rateStore: { rows: RateRow[] };
        cookieJar: { value: string | null };
      }
    | undefined;
}

globalThis.__authTestState = {
  userStore: { rows: [], nextId: 1 },
  rateStore: { rows: [] },
  cookieJar: { value: null },
};

vi.mock('@/lib/db/queries/users', () => ({
  userCount: (_db: unknown) => globalThis.__authTestState!.userStore.rows.length,
  createUser: (_db: unknown, passwordHash: string) => {
    const s = globalThis.__authTestState!.userStore;
    const row: UserRow = { id: s.nextId++, passwordHash };
    s.rows.push(row);
    return { id: row.id, passwordHash };
  },
  getSingleUser: (_db: unknown) => globalThis.__authTestState!.userStore.rows[0] ?? null,
  getUserById: (_db: unknown, id: number) =>
    globalThis.__authTestState!.userStore.rows.find((r) => r.id === id) ?? null,
}));

vi.mock('@/lib/db/client', () => {
  const stubSqlite = {
    prepare: () => ({ run: () => undefined, get: () => undefined, all: () => [] }),
    pragma: () => undefined,
    close: () => undefined,
  };
  const stubDb = {
    // minimal drizzle surface; queries that hit it are fully mocked separately
    select: () => ({ from: () => ({ where: () => [], all: () => [] }) }),
    insert: () => ({ values: () => ({ run: () => undefined }) }),
    update: () => ({ set: () => ({ where: () => ({ run: () => undefined }) }) }),
    delete: () => ({ where: () => ({ run: () => undefined }) }),
  };
  return {
    db: stubDb,
    sqlite: stubSqlite,
    getDb: () => stubDb,
    getRawSqlite: () => stubSqlite,
    openDb: () => ({ db: stubDb, sqlite: stubSqlite }),
  };
});

vi.mock('@/lib/auth/rateLimit', async () => {
  const WINDOW_MS = 15 * 60 * 1000;
  const LIMIT = 5;
  return {
    hashIp: (ip: string) => ip,
    ipFromRequest: (req: Request) => {
      const fwd = req.headers.get('x-forwarded-for');
      if (fwd) return fwd.split(',')[0]!.trim();
      return 'unknown';
    },
    checkLoginRate: async (ipHash: string) => {
      const s = globalThis.__authTestState!.rateStore;
      const now = Date.now();
      s.rows = s.rows.filter((r) => now - r.ts < WINDOW_MS);
      const recent = s.rows.filter((r) => r.ipHash === ipHash);
      return { allowed: recent.length < LIMIT, remaining: Math.max(0, LIMIT - recent.length) };
    },
    recordLoginAttempt: async (ipHash: string) => {
      globalThis.__authTestState!.rateStore.rows.push({ ipHash, ts: Date.now() });
    },
    resetLoginRate: async (ipHash: string) => {
      const s = globalThis.__authTestState!.rateStore;
      s.rows = s.rows.filter((r) => r.ipHash !== ipHash);
    },
  };
});

vi.mock('next/headers', () => {
  return {
    cookies: async () => {
      const jar = globalThis.__authTestState!.cookieJar;
      return {
        get: (name: string) => {
          if (!jar.value) return undefined;
          const match = jar.value.split(/;\s*/).find((p) => p.startsWith(name + '='));
          if (!match) return undefined;
          return { name, value: decodeURIComponent(match.slice(name.length + 1)) };
        },
        set: (...args: unknown[]) => {
          const first = args[0];
          if (typeof first === 'string') {
            const name = first;
            const value = args[1] as string;
            jar.value = `${name}=${encodeURIComponent(value)}`;
          } else if (first && typeof first === 'object' && 'name' in first) {
            const obj = first as { name: string; value: string };
            jar.value = `${obj.name}=${encodeURIComponent(obj.value)}`;
          }
        },
        delete: () => {
          jar.value = null;
        },
      };
    },
  };
});
