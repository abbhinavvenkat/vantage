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

function state(): NonNullable<typeof globalThis.__authTestState> {
  if (!globalThis.__authTestState) throw new Error('auth test state not initialized');
  return globalThis.__authTestState;
}

export const userStore = new Proxy(
  {},
  {
    get: (_t, k) => (state().userStore as Record<string | symbol, unknown>)[k],
    set: (_t, k, v) => {
      (state().userStore as Record<string | symbol, unknown>)[k] = v;
      return true;
    },
  },
) as { rows: UserRow[]; nextId: number };

export const cookieJar = new Proxy(
  {},
  {
    get: (_t, k) => (state().cookieJar as Record<string | symbol, unknown>)[k],
    set: (_t, k, v) => {
      (state().cookieJar as Record<string | symbol, unknown>)[k] = v;
      return true;
    },
  },
) as { value: string | null };

export function resetStores(): void {
  const s = state();
  s.userStore.rows = [];
  s.userStore.nextId = 1;
  s.rateStore.rows = [];
  s.cookieJar.value = null;
}
