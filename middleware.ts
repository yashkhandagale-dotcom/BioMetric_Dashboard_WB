import { NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// ── Auth model ────────────────────────────────────────────────────────────
// HR users log in via Supabase Auth (email/password) at /login. Every other
// route requires a session, EXCEPT:
//   - /login itself
//   - the manager's read-only shared view (`/?view=1&token=...`) — by design
//     (FR-10) managers never need to log in, they're gated by the unguessable
//     shared-link token instead (see lib/sharedLink.ts / app/api/shared-link)
//   - the shared-link API route it calls
export async function middleware(req: NextRequest) {
  const isSharedView = req.nextUrl.searchParams.get('view') === '1';
  const isSharedLinkApi = req.nextUrl.pathname.startsWith('/api/shared-link');
  const isLoginPage = req.nextUrl.pathname.startsWith('/login');
  const isAuthApi = req.nextUrl.pathname.startsWith('/api/auth');

  const { response, user } = await updateSession(req);

  if (isSharedView || isSharedLinkApi || isLoginPage || isAuthApi) {
    return response;
  }

  if (!user) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
