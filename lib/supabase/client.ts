import { createBrowserClient } from '@supabase/ssr';

// Used from Client Components ('use client'). Reads the session from cookies
// that middleware.ts keeps refreshed.
//
// Single-login pivot: this now shares ONE cookie ('sb-auth') with
// lib/leaveSupabase/client.ts. Both files already pointed at the same
// Supabase project/auth pool (see lib/leaveSupabase/client.ts's own
// comment); they used to additionally split into two different cookie
// names ('sb-dashboard-auth' / 'sb-leave-auth'), which was the whole
// reason someone had to log in twice — once at /login, once again at
// /leave/login — even though it was the same account both times. Signing
// in once at the single /login now authenticates both the Dashboard and
// the Leave Tracker in the same request. See PROGRESS.md, "Post-Sprint-2
// pivot" point 5, for the access-control decision this resolves.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { name: 'sb-auth' } }
  );
}
