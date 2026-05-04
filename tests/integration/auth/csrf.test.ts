import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores, userStore, cookieJar } from './_mocks';
import { hash } from '@/lib/auth/password';

process.env.SESSION_PASSWORD = 'test_session_password_at_least_32_chars_long_xx';

async function loginAndGetCsrf(): Promise<string> {
  const h = await hash('Abcdef1234567!');
  userStore.rows.push({ id: 1, passwordHash: h });
  userStore.nextId = 2;
  const { POST: login } = await import('@/app/api/auth/login/route');
  const res = await login(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify({ password: 'Abcdef1234567!' }),
    }),
  );
  expect(res.status).toBe(200);
  const { GET: csrfGet } = await import('@/app/api/auth/csrf/route');
  const csrfRes = await csrfGet();
  expect(csrfRes.status).toBe(200);
  const body = (await csrfRes.json()) as { token: string };
  return body.token;
}

describe('CSRF protection', () => {
  beforeEach(() => {
    resetStores();
  });

  it('rejects POST /api/auth/logout without csrf header (403)', async () => {
    await loginAndGetCsrf();
    const { POST } = await import('@/app/api/auth/logout/route');
    const res = await POST(new Request('http://localhost/api/auth/logout', { method: 'POST' }));
    expect(res.status).toBe(403);
  });

  it('accepts POST /api/auth/logout with valid csrf header (200)', async () => {
    const token = await loginAndGetCsrf();
    const { POST } = await import('@/app/api/auth/logout/route');
    const res = await POST(
      new Request('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': token },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('rejects /api/auth/csrf when no session', async () => {
    cookieJar.value = null;
    const { GET } = await import('@/app/api/auth/csrf/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
