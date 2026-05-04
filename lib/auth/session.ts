import { cookies } from 'next/headers';
import { getIronSession, type IronSession, type SessionOptions } from 'iron-session';
import { randomBytes } from 'node:crypto';

export type SessionData = {
  userId?: string;
  csrfToken?: string;
  createdAt?: number;
};

export type Session = {
  userId: string;
  csrfToken: string;
};

const COOKIE_NAME = 'stock_platform_session';
const TTL_SECONDS = 60 * 60 * 24 * 7;

export function getSessionOptions(): SessionOptions {
  const password = process.env.SESSION_PASSWORD;
  if (!password || password.length < 32) {
    throw new Error('SESSION_PASSWORD env var must be set and at least 32 characters');
  }
  return {
    cookieName: COOKIE_NAME,
    password,
    ttl: TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test',
      path: '/',
    },
  };
}

export async function getIron(): Promise<IronSession<SessionData>> {
  const store = await cookies();
  return getIronSession<SessionData>(store, getSessionOptions());
}

export async function getSession(): Promise<Session | null> {
  const iron = await getIron();
  if (!iron.userId || !iron.csrfToken) return null;
  return { userId: iron.userId, csrfToken: iron.csrfToken };
}

export async function setSession(userId: string): Promise<{ csrfToken: string }> {
  const iron = await getIron();
  iron.userId = userId;
  iron.csrfToken = randomBytes(32).toString('hex');
  iron.createdAt = Date.now();
  await iron.save();
  return { csrfToken: iron.csrfToken };
}

export async function destroySession(): Promise<void> {
  const iron = await getIron();
  iron.destroy();
}
