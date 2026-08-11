import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// Server Components / Route Handlers under app/leave/** only.
//
// This is the Leave Tracker's OWN Supabase project — NEXT_PUBLIC_LEAVE_SUPABASE_URL
// / NEXT_PUBLIC_LEAVE_SUPABASE_ANON_KEY, not the dashboard's
// NEXT_PUBLIC_SUPABASE_URL. These two used to point at the same
// (merged) project — see old PROGRESS.md entries — but .env.local now
// has them split back into separate projects (LEAVE_-prefixed vs plain),
// and this file had fallen out of sync with that, silently pointing the
// entire Leave Tracker app at the dashboard's project instead of its own.
// Fixed here: bulk-created employee auth accounts live in the
// LEAVE-prefixed project, so that's the one this must use.
export async function createLeaveClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_LEAVE_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_LEAVE_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: 'sb-leave-auth' },
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

// Service-role client — bypasses RLS. Use only inside app/leave/api/*
// route handlers, e.g. for scheduled jobs like the 25-March annual reset.
// Never import into client-side code. Uses the Leave Tracker project's
// OWN service role key (LEAVE_SUPABASE_SERVICE_ROLE_KEY) — see note above
// on createLeaveClient for why this must not be the dashboard's key/URL.
export function createLeaveServiceClient() {
  return createSupabaseJsClient(
    process.env.NEXT_PUBLIC_LEAVE_SUPABASE_URL!,
    process.env.LEAVE_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}