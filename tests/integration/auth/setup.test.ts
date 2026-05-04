import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores, userStore } from './_mocks';

process.env.SESSION_PASSWORD = 'test_session_password_at_least_32_chars_long_xx';

describe('POST /api/auth/setup', () => {
  beforeEach(() => {
    resetStores();
  });

  it('creates the first user when none exist and returns 201', async () => {
    const { POST } = await import('@/app/api/auth/setup/route');
    const req = new Request('http://localhost/api/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'Abcdef1234567!', confirm: 'Abcdef1234567!' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(userStore.rows.length).toBe(1);
    expect(userStore.rows[0]!.passwordHash).toMatch(/^\$argon2/);
  });

  it('rejects when a user already exists with 409', async () => {
    const { POST } = await import('@/app/api/auth/setup/route');
    const body = JSON.stringify({ password: 'Abcdef1234567!', confirm: 'Abcdef1234567!' });
    const first = await POST(
      new Request('http://localhost/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );
    expect(first.status).toBe(201);

    const second = await POST(
      new Request('http://localhost/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );
    expect(second.status).toBe(409);
  });

  it('rejects weak passwords with 400', async () => {
    const { POST } = await import('@/app/api/auth/setup/route');
    const res = await POST(
      new Request('http://localhost/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'short', confirm: 'short' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects mismatched confirmation with 400', async () => {
    const { POST } = await import('@/app/api/auth/setup/route');
    const res = await POST(
      new Request('http://localhost/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'Abcdef1234567!', confirm: 'Different1234!' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
