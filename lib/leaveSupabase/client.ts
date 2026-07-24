import { createBrowserClient } from '@supabase/ssr';

// Post-DB-merge: this now points at the SAME Supabase project as
// lib/supabase/client.ts (see unified_schema.sql / PROGRESS.md for why).
// Kept as its own file — rather than just re-exporting the main client —
// so the Leave Tracker's session stays on its OWN cookie name
// ("sb-leave-auth") instead of colliding with the Dashboard's
// ("sb-dashboard-auth"). Sharing one project means sharing one
// `auth.users` table, but this keeps the two apps' *sessions* independent:
// logging into one does not silently log you into the other.
//
// OPEN QUESTION (flagged, not decided here): now that both apps share one
// auth pool, should a Leave Tracker login (an ordinary employee) also be
// allowed into the Dashboard? Right now, no — middleware.ts only checks
// "is there a session", not role, so if an employee ever obtained a
// Dashboard session cookie they'd get in. Since sessions are kept separate
// here, this isn't currently reachable, but if that ever changes, add a
// role check (employees.role via auth_user_id) to middleware.ts first.
export function createLeaveClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { name: 'sb-leave-auth' } }
  );
}