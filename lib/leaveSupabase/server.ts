import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// Server Components / Route Handlers under app/leave/** only. This is a
// SEPARATE Supabase project from the main dashboard's — different DB,
// different auth users, different everything. That separation is
// deliberate: the leave tracker is new and still evolving, and this way
// nothing it does can ever touch the already-deployed dashboard's data
// or its Supabase project's quotas/connections.
//
// Uses its own cookie names (via a distinct storageKey below) so a leave
// session and a dashboard session can coexist in the same browser without
// colliding.
export async function createLeaveClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_LEAVE_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_LEAVE_SUPABASE_ANON_KEY!,
    {
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
}

// Service-role client — bypasses RLS on the LEAVE project only. Use only
// inside app/leave/api/* route handlers, e.g. for scheduled jobs like the
// 25-March annual reset. Never import into client-side code.
export function createLeaveServiceClient() {
  return createSupabaseJsClient(
    process.env.NEXT_PUBLIC_LEAVE_SUPABASE_URL!,
    process.env.LEAVE_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}