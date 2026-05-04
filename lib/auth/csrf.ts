import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getSession } from '@/lib/auth/session';

export const CSRF_HEADER = 'x-csrf-token';

export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function verifyCsrfFromRequest(req: Request): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const header = req.headers.get(CSRF_HEADER);
  if (!header) return false;
  return constantTimeEqual(header, session.csrfToken);
}

export async function requireCsrf(req: Request): Promise<Response | null> {
  const ok = await verifyCsrfFromRequest(req);
  if (!ok) {
    return Response.json({ error: 'csrf_invalid' }, { status: 403 });
  }
  return null;
}
