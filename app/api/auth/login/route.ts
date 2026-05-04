import { z } from 'zod';
import { verify } from '@/lib/auth/password';
import { setSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getSingleUser } from '@/lib/db/queries/users';
import {
  checkLoginRate,
  hashIp,
  ipFromRequest,
  recordLoginAttempt,
  resetLoginRate,
} from '@/lib/auth/rateLimit';

const Body = z.object({
  password: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  const ip = ipFromRequest(req);
  const ipHash = hashIp(ip);

  const rate = await checkLoginRate(ipHash);
  if (!rate.allowed) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_input' }, { status: 400 });
  }

  const user = getSingleUser(db);
  if (!user) {
    await recordLoginAttempt(ipHash);
    return Response.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const ok = await verify(user.passwordHash, parsed.data.password);
  if (!ok) {
    await recordLoginAttempt(ipHash);
    return Response.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  await resetLoginRate(ipHash);
  await setSession(user.id);
  return Response.json({ ok: true }, { status: 200 });
}
