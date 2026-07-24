import { createBrowserClient } from '@supabase/ssr';

// Used from Client Components ('use client'). Reads the session from cookies
// that middleware.ts keeps refreshed.
//
// Post-DB-merge: explicit cookie name so this session stays independent of
// the Leave Tracker's (lib/leaveSupabase/client.ts) even though both now
// point at the same Supabase project/auth pool — see that file's comment.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { name: 'sb-dashboard-auth' } }
  );
}