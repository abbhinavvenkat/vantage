import { NextResponse, type NextRequest } from 'next/server';
import { getIronSession } from 'iron-session';
import { getSessionOptions, type SessionData } from '@/lib/auth/session';
import { CSRF_HEADER, constantTimeEqual } from '@/lib/auth/csrf';

const PUBLIC_PREFIXES = ['/login', '/setup', '/api/auth'];
const PUBLIC_EXACT = new Set<string>(['/favicon.ico']);
const ALWAYS_ALLOW_PREFIXES = ['/_next/', '/static/'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (ALWAYS_ALLOW_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, getSessionOptions());

  const authed = Boolean(session.userId);

  if (pathname.startsWith('/api/')) {
    const method = req.method.toUpperCase();
    const isAuthRoute = pathname.startsWith('/api/auth/');
    if (!isAuthRoute && !authed) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const exemptCsrf = pathname === '/api/auth/login' || pathname === '/api/auth/setup';
      if (!exemptCsrf) {
        const header = req.headers.get(CSRF_HEADER);
        if (!header || !session.csrfToken || !constantTimeEqual(header, session.csrfToken)) {
          return NextResponse.json({ error: 'csrf_invalid' }, { status: 403 });
        }
      }
    }
    return res;
  }

  if (isPublic(pathname)) {
    return res;
  }

  if (!authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
