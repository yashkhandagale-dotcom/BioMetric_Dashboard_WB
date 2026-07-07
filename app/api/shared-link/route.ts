import { NextRequest, NextResponse } from 'next/server';

// ── In-memory, expiring shared-link store ────────────────────────────────────
// Previously the manager's shared link embedded the *entire* employee record
// set, base64-encoded, directly in the URL fragment — a copy-pasteable link
// that carried full employee PII (names, codes, timestamps) forever, with no
// expiry. That URL could end up in browser history, chat logs, or screenshots.
//
// Instead, HR generates a link with an unguessable random token; the actual
// data lives only in this server-side store (in-process memory — no DB, no
// disk, in keeping with this app's "no backend" design) and expires
// automatically. The manager's browser fetches the payload same-origin via
// GET, so it's never present in the shareable URL itself.
//
// Note: this store is per server process. Restarting the server (or a
// multi-instance deployment) clears it — acceptable for this POC's LAN/local
// usage model, and consistent with "the link only works while HR's server
// is running" already called out in the UI.

interface SharedEntry {
  data: unknown;
  expiresAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const store = new Map<string, SharedEntry>();

function cleanupExpired() {
  const now = Date.now();
  for (const [token, entry] of store) {
    if (entry.expiresAt <= now) store.delete(token);
  }
}

export async function POST(req: NextRequest) {
  cleanupExpired();
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.records)) {
    return NextResponse.json({ error: 'records array required' }, { status: 400 });
  }

  const token = crypto.randomUUID();
  store.set(token, { data: body.records, expiresAt: Date.now() + TTL_MS });

  return NextResponse.json({ token, expiresAt: Date.now() + TTL_MS });
}

export async function GET(req: NextRequest) {
  cleanupExpired();
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'token required' }, { status: 400 });
  }

  const entry = store.get(token);
  if (!entry) {
    return NextResponse.json({ error: 'not found or expired' }, { status: 404 });
  }

  return NextResponse.json({ records: entry.data });
}
