import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores, userStore } from './_mocks';
import { hash } from '@/lib/auth/password';

process.env.SESSION_PASSWORD = 'test_session_password_at_least_32_chars_long_xx';

async function seedUser(password: string): Promise<void> {
  const h = await hash(password);
  userStore.rows.push({ id: 1, passwordHash: h });
  userStore.nextId = 2;
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    resetStores();
  });

  it('returns 401 on wrong password', async () => {
    await seedUser('Abcdef1234567!');
    const { POST } = await import('@/app/api/auth/login/route');
    const res = await POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
        body: JSON.stringify({ password: 'WrongPassword12!' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 200 on correct password and sets a session cookie', async () => {
    await seedUser('Abcdef1234567!');
    const { POST } = await import('@/app/api/auth/login/route');
    const res = await POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
        body: JSON.stringify({ password: 'Abcdef1234567!' }),
      }),
    );
    expect(res.status).toBe(200);
    const { cookieJar } = await import('./_mocks');
    expect(cookieJar.value).toBeTruthy();
  });

  it('rate-limits after 5 failed attempts within window', async () => {
    await seedUser('Abcdef1234567!');
    const { POST } = await import('@/app/api/auth/login/route');
    const ip = '9.9.9.9';
    for (let i = 0; i < 5; i++) {
      const r = await POST(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ password: 'WrongPassword12!' }),
        }),
      );
      expect(r.status).toBe(401);
    }
    const sixth = await POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ password: 'Abcdef1234567!' }),
      }),
    );
    expect(sixth.status).toBe(429);
  });

  it('returns 400 on missing password', async () => {
    await seedUser('Abcdef1234567!');
    const { POST } = await import('@/app/api/auth/login/route');
    const res = await POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});
