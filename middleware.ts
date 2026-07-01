import { NextRequest, NextResponse } from 'next/server';

// ── Hardcoded credentials ─────────────────────────────────────────────────
const AUTH_USER = 'admin';
const AUTH_PASS = 'admin@123';

// NOTE: No IP check here. The server itself is bound to 127.0.0.1 (see
// package.json "start:local" script), so it is physically unreachable from
// any other device on the network — only someone using this laptop directly
// can ever load it. The login below is the protection for THAT case
// (e.g. someone else using her laptop).

function isAuthorizedByPassword(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('basic ')) {
    console.log('[auth] no Authorization header received yet');
    return false;
  }
  const base64Part = authHeader.split(' ')[1];
  const decoded = atob(base64Part);
  const separatorIndex = decoded.indexOf(':');
  const user = decoded.slice(0, separatorIndex).trim();
  const pass = decoded.slice(separatorIndex + 1).trim();

  // TEMP DEBUG: prints to your terminal (the cmd window), never to the browser.
  // Remove these two lines once login works.
  console.log('[auth] received username:', JSON.stringify(user));
  console.log('[auth] received password:', JSON.stringify(pass));

  return user === AUTH_USER && pass === AUTH_PASS;
}

export function middleware(req: NextRequest) {
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