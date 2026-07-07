import { NextRequest, NextResponse } from 'next/server';

// ── Credentials ────────────────────────────────────────────────────────────
// Read from environment variables — never hardcode credentials in source.
// Set DASHBOARD_AUTH_USER / DASHBOARD_AUTH_PASS in a local .env file (see
// .env.example). If either is unset, the app fails closed: every request
// is rejected rather than falling back to a guessable default.
const AUTH_USER = process.env.DASHBOARD_AUTH_USER;
const AUTH_PASS = process.env.DASHBOARD_AUTH_PASS;

// ── Network exposure ─────────────────────────────────────────────────────────
// `npm start` binds to 0.0.0.0 by default (all interfaces), which is what
// makes LAN sharing with a manager on the same WiFi possible — this basic-auth
// check is the actual access control in that case, not the network binding.
// If you only ever want this reachable from the machine it runs on, use
// `npm run start:local` instead, which binds Next.js to 127.0.0.1 only.
function isAuthorizedByPassword(req: NextRequest): boolean {
  if (!AUTH_USER || !AUTH_PASS) return false;

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('basic ')) {
    return false;
  }
  const base64Part = authHeader.split(' ')[1];
  const decoded = atob(base64Part);
  const separatorIndex = decoded.indexOf(':');
  const user = decoded.slice(0, separatorIndex).trim();
  const pass = decoded.slice(separatorIndex + 1).trim();

  return user === AUTH_USER && pass === AUTH_PASS;
}

export function middleware(req: NextRequest) {
  // The manager's read-only shared-link view (`/?view=1&token=...`) must be
  // reachable without the HR login — that's the whole point of FR-10 ("no
  // login required for the manager"). It only ever exposes data guarded by
  // its own short-lived, unguessable token (see lib/sharedLink.ts and
  // app/api/shared-link), so it's safe to exempt from basic-auth here.
  // Same for the API route it calls to fetch that data.
  const isSharedView = req.nextUrl.searchParams.get('view') === '1';
  const isSharedLinkApi = req.nextUrl.pathname.startsWith('/api/shared-link');
  if (isSharedView || isSharedLinkApi) {
    return NextResponse.next();
  }

  if (isAuthorizedByPassword(req)) {
    return NextResponse.next();
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Restricted"' },
  });
}

// Apply to every route (adjust matcher if you want some pages public)
export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
