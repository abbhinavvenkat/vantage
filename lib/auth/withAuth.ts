import { getSession, type Session } from '@/lib/auth/session';

type RouteHandler<Ctx> = (req: Request, ctx: Ctx, session: Session) => Promise<Response> | Response;

export function withAuth<Ctx = unknown>(handler: RouteHandler<Ctx>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const session = await getSession();
    if (!session) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    return handler(req, ctx, session);
  };
}
