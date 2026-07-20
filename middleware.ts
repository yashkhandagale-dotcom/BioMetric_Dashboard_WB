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
//   - everything under /leave and /api/leave — the Leave Tracker is a
//     separate app with its own Supabase project, its own session cookies,
//     and its own auth check (app/leave/admin/layout.tsx guards the pages;
//     each /api/leave route checks its own session). It must never be
//     gated by this middleware's main-dashboard session check: doing so
//     previously bounced an unauthenticated visitor to the dashboard's
//     /login instead of /leave/login, making /leave/login unreachable.
export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isLeaveRoute = pathname.startsWith('/leave') || pathname.startsWith('/api/leave');

  if (isLeaveRoute) {
    return NextResponse.next();
  }

  const isSharedView = req.nextUrl.searchParams.get('view') === '1';
  const isSharedLinkApi = pathname.startsWith('/api/shared-link');
  const isLoginPage = pathname.startsWith('/login');
  const isAuthApi = pathname.startsWith('/api/auth');

  const { response, user } = await updateSession(req);

  if (isSharedView || isSharedLinkApi || isLoginPage || isAuthApi) {
    return response;
  }

  if (!user) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};