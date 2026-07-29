import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

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
// the same unified vars; the distinct `sb-leave-auth` cookie name below
// is unrelated to this bug and stays as-is (that's what keeps the two
// apps' sessions from colliding, per PROGRESS.md point 5).
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