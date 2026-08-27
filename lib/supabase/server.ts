import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { cache } from 'react';

// Used from Server Components, Route Handlers (app/api/*), and Server Actions.
// Ties into the same cookie-based session as the browser client.
//
// Single-login pivot: cookie name is now 'sb-auth', shared with
// lib/leaveSupabase/server.ts — see lib/supabase/client.ts's comment for
// why (one login now authenticates both the Dashboard and Leave Tracker).
// PERF FIX: wrapped in React's cache() so every Server Component / Route
// Handler that calls createClient() during the SAME request shares one
// client instance instead of building a fresh one each time. This matters
// because any subsequent `.auth.getUser()` call on that client is a real
// network round trip to Supabase's Auth server — memoizing the client here
// (combined with the same fix in lib/leaveSupabase/server.ts) is what lets
// getCurrentEmployee()'s own cache() wrapper actually dedupe auth calls
// across a layout + its page instead of each building an independent client
// and re-authenticating from scratch. Resets automatically on every new
// request, so there's no cross-request/cross-user staleness risk.
export const createClient = cache(async function createClient() {
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
            // Called from a Server Component render — safe to ignore since
            // middleware.ts already refreshes the session on every request.
          }
        },
      },
    }
  );
});

// Service-role client — bypasses RLS. Only ever use this inside app/api/*
// Route Handlers for operations that must run regardless of the caller's
// session (e.g. resolving a shared-link token for the un-authenticated
// manager view). Never import this into client-side code.
export function createServiceClient() {
  return createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}