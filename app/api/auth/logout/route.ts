import { destroySession } from '@/lib/auth/session';
import { requireCsrf } from '@/lib/auth/csrf';

export async function POST(req: Request): Promise<Response> {
  const csrfFail = await requireCsrf(req);
  if (csrfFail) return csrfFail;
  await destroySession();
  return Response.json({ ok: true }, { status: 200 });
}
