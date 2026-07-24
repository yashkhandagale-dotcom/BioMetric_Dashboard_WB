import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// Server Components / Route Handlers under app/leave/** only.
//
// Post-DB-merge: same Supabase project as lib/supabase/server.ts now, kept
// on its own cookie name ("sb-leave-auth") so a Leave Tracker session and a
// Dashboard session stay independent in the same browser — see
// lib/leaveSupabase/client.ts for the full reasoning and the open question
// about role-based access this raised.
export async function createLeaveClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
// Never import into client-side code. Same project as the Dashboard's
// service client (lib/supabase/server.ts:createServiceClient) now — both
// bypass RLS on the same unified DB, so both can technically touch any
// table. Keep using the right one for the right app anyway, for clarity.
export function createLeaveServiceClient() {
  return createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}