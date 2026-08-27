import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { cache } from 'react';

// Server Components / Route Handlers under app/leave/** only.
//
// Post-Sprint-2 pivot (see PROGRESS.md, "Post-Sprint-2 pivot: single-DB
// architecture"): the Dashboard and Leave Tracker were merged onto ONE
// Supabase project, with ONE set of env vars — NEXT_PUBLIC_SUPABASE_URL /
// NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example, which only defines
// those, and lib/supabase/server.ts which already reads them correctly).
//
// This file had drifted from that: it was reading NEXT_PUBLIC_LEAVE_
// SUPABASE_URL / NEXT_PUBLIC_LEAVE_SUPABASE_ANON_KEY, which do not exist
// anywhere in .env.example or in the actual deployed env — those names
// belonged to the pre-pivot split-project setup and were never removed
// from here when the pivot landed. That undefined URL/key is why every
// Leave Tracker auth call (sign-in, getUser, the employees lookup) was
// failing while the Dashboard's own login kept working fine — it reads
// the correct unified vars via lib/supabase/server.ts. Fixed here to read
// the same unified vars.
//
// Single-login pivot: the cookie name below is now 'sb-auth', shared
// with lib/supabase/server.ts, instead of a separate 'sb-leave-auth'.
// That separate-cookie split is exactly what PROGRESS.md point 5 flagged
// as "Auth is flagged, not silently merged" — it was why signing into
// the Dashboard didn't also sign you into the Leave Tracker (and vice
// versa) even though both already read the same auth.users pool. One
// cookie now means one login. Role-based authorization is unaffected —
// still enforced per-route by middleware.ts and each layout guard.
// PERF FIX: wrapped in React's cache() — this file's whole reason to exist
// (single-DB pivot) means the SAME client config/cookies are now used by
// middleware, every /leave/** layout, and every /leave/** page for a single
// request. Without cache(), each of those call sites built its own client
// object and — much more importantly — every downstream `.auth.getUser()`
// call is a REAL network round trip to Supabase's Auth server (it validates
// the token remotely, it does not just decode the cookie locally). A single
// page render (layout + page + any nested data calls) used to pay for 2-3 of
// those round trips back to back. cache() memoizes the *result* of this
// function for the lifetime of one request/render pass, so every caller in
// that same request gets back the exact same client instance and — because
// getCurrentEmployee() below is also cached — the exact same already-fetched
// user, instead of re-authenticating from scratch each time. This resets
// automatically on the next request, so there's no risk of ever serving a
// stale session across different requests/users.
export const createLeaveClient = cache(async function createLeaveClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: 'sb-auth' },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render — safe to ignore.
          }
        },
      },
    }
  );
});

// Service-role client — bypasses RLS. Use only inside app/leave/api/*
// route handlers, e.g. for scheduled jobs like the 25-March annual reset.
// Never import into client-side code. Same unified-project fix as
// createLeaveClient above: uses SUPABASE_SERVICE_ROLE_KEY (the one
// service role key for the single merged project), not a LEAVE_-prefixed
// key that no longer exists anywhere in the deployed env.
export function createLeaveServiceClient() {
  return createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}