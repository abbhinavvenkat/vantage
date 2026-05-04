import { getSession } from '@/lib/auth/session';

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return Response.json({ token: session.csrfToken }, { status: 200 });
}
