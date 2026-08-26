import { NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// ── Auth model (single-login pivot) ─────────────────────────────────────
// ONE login page (/login) authenticates against the single Supabase auth
// pool that already backs both apps (see unified_schema.sql / PROGRESS.md
// "Post-Sprint-2 pivot"). Session lives in one cookie ('sb-auth', see
// lib/supabase/middleware.ts) so signing in once is enough for both the
// Dashboard and the Leave Tracker — no more separate /leave/login.
//
//
// Role (hr / hr_super_admin / manager / lead / employee) comes from the
// `employees` table, keyed by `auth_user_id`. What each role can reach:
//   - hr / hr_super_admin : full Dashboard ('/') + full Leave Tracker
//     admin ('/leave/admin', read/write).
//   - manager / lead       : NOT the Dashboard's upload/settings-owning
//     HR view — app/page.tsx itself renders them a read-only, team-scoped
//     view instead of blocking them outright (see app/page.tsx). They
//     also get '/leave/me' (own leave), '/leave/approvals' (approve their
//     team), and '/leave/team' (read-only team leave records).
//   - employee              : '/leave/me' ONLY. No Dashboard access at
//     all — bounced to '/leave/me' below, not shown any filtered view.
//
// Exceptions (unchanged from before this pivot):
//   - /login itself, and /api/auth/*
//   - the legacy unauthenticated manager share-link view
//     (`/?view=1&token=...` — FR-10, gated by an unguessable token, not a
//     login at all; see lib/sharedLink.ts) and its API route
//   - everything under /leave and /api/leave — the Leave Tracker guards
//     itself per-route (see each app/leave/**/layout.tsx and every
//     app/api/leave/** route's own `supabase.auth.getUser()` check). It
//     must never be gated here: doing so previously bounced a logged-out
//     visitor to '/login' instead of letting them reach the Leave
//     Tracker's own login, making it unreachable.
export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isLeaveRoute = pathname.startsWith('/leave') || pathname.startsWith('/api/leave');

  // IMPORTANT: this must still call updateSession() — it must only skip
  // the redirect/role-gating logic below, not the session refresh itself.
  // updateSession() is what calls supabase.auth.getUser(), which is what
  // actually refreshes an expiring access token and re-writes the
  // refreshed session back into the 'sb-auth' cookie. Supabase rotates
  // refresh tokens (each one is single-use) — every layout/route under
  // /leave/** also calls auth.getUser() via createLeaveClient(), but
  // Server Components (e.g. app/leave/admin/layout.tsx) are NOT allowed
  // to write cookies, so any refresh that happens there is silently
  // dropped (see lib/leaveSupabase/server.ts's catch block). Until this
  // fix, /leave and /api/leave requests never got the one place that CAN
  // persist a refreshed cookie (this middleware), so the very first
  // token refresh anywhere in the Leave Tracker would consume the
  // refresh token without saving the new one — the next request would
  // then present an already-used refresh token, get rejected, and the
  // employee would be bounced back to /leave/login. That's the "frequent
  // logout" bug: it was never really "sessions expiring", it was the
  // refreshed session never getting saved for this entire route tree.
  if (isLeaveRoute) {
    const { response } = await updateSession(req);
    return response;
  }

  const isSharedView = req.nextUrl.searchParams.get('view') === '1';
  const isSharedLinkApi = pathname.startsWith('/api/shared-link');
  const isLoginPage = pathname.startsWith('/login');
  const isAuthApi = pathname.startsWith('/api/auth');

  if (isSharedView || isSharedLinkApi || isLoginPage || isAuthApi) {
    const { response } = await updateSession(req);
    return response;
  }

  const { response, user, supabase } = await updateSession(req);

  if (!user) {
    // For API consumers, return JSON 401 instead of redirecting to the
    // HTML login page — a fetch/XHR expecting JSON will otherwise get an
    // HTML document (login page) which leads to JSON.parse errors client-side.
    const wantsJson = pathname.startsWith('/api') || req.headers.get('accept')?.includes('application/json') || req.headers.get('x-requested-with') === 'XMLHttpRequest';
    if (wantsJson) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Role check — the piece PROGRESS.md point 5 explicitly left as "not
  // implemented now, a real access-control decision, not something to
  // guess at." Decision: plain `employee` role never sees the Dashboard,
  // full stop — sent to their own leave page instead. Every other role
  // (hr / hr_super_admin / manager / lead) is let through; app/page.tsx
  // decides what they actually get to see (full HR view vs. read-only
  // team-scoped view).
  const { data: employee } = await supabase
    .from('employees')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (employee?.role === 'employee') {
    return NextResponse.redirect(new URL('/leave/me', req.url));
  }

  return response;
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
