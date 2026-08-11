import { createBrowserClient } from '@supabase/ssr';

// This is the Leave Tracker's OWN Supabase project — NEXT_PUBLIC_LEAVE_SUPABASE_URL
// / NEXT_PUBLIC_LEAVE_SUPABASE_ANON_KEY, not the dashboard's
// NEXT_PUBLIC_SUPABASE_URL/ANON_KEY. These two apps' projects were merged
// at one point (see old PROGRESS.md entries), but .env.local now has them
// split back into separate projects — this file had fallen out of sync
// with that split, silently sending the Leave Tracker's login requests to
// the dashboard's project instead of its own. Kept as its own file —
// rather than just re-exporting the main client — so the Leave Tracker's
// session stays on its OWN cookie name ("sb-leave-auth") instead of
// colliding with the Dashboard's ("sb-dashboard-auth").
//
// OPEN QUESTION (flagged, not decided here): now that the two projects
// are confirmed separate again, is a shared `auth.users` pool even a
// design option going forward, or should these always be treated as two
// fully independent identity systems? Worth settling before Sprint D
// (notifications/email), since email-based user matching assumed shared
// identity in earlier drafts.
export function createLeaveClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_LEAVE_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_LEAVE_SUPABASE_ANON_KEY!,
    { cookieOptions: { name: 'sb-leave-auth' } }
  );
}