import { z } from 'zod';
import { hash } from '@/lib/auth/password';
import { setSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { createUser, userCount } from '@/lib/db/queries/users';

const PasswordSchema = z
  .string()
  .min(12)
  .refine((p) => /[a-z]/.test(p), 'must contain a lowercase letter')
  .refine((p) => /[A-Z]/.test(p), 'must contain an uppercase letter')
  .refine((p) => /\d/.test(p), 'must contain a digit');

const Body = z
  .object({
    password: PasswordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'passwords do not match',
    path: ['confirm'],
  });

export async function POST(req: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  }

  const count = userCount(db);
  if (count > 0) {
    return Response.json({ error: 'already_initialized' }, { status: 409 });
  }

  let passwordHash: string;
  try {
    passwordHash = await hash(parsed.data.password);
  } catch (e) {
    console.error('[setup] hash failed:', e);
    return Response.json({ error: 'hash_failed', detail: String(e) }, { status: 500 });
  }

  let user: Awaited<ReturnType<typeof createUser>>;
  try {
    user = createUser(db, passwordHash);
  } catch (e) {
    console.error('[setup] createUser failed:', e);
    return Response.json({ error: 'db_failed', detail: String(e) }, { status: 500 });
  }

  try {
    await setSession(user.id);
  } catch (e) {
    console.error('[setup] setSession failed:', e);
    return Response.json({ error: 'session_failed', detail: String(e) }, { status: 500 });
  }

  return Response.json({ ok: true, userId: user.id }, { status: 201 });
}
