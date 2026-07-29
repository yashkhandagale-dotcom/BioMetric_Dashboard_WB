import { createBrowserClient } from '@supabase/ssr';

// Post-Sprint-2 pivot (see PROGRESS.md, "Post-Sprint-2 pivot: single-DB
// architecture"): Dashboard and Leave Tracker share ONE Supabase project
// now, via NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (see
// .env.example — there is no separate "leave" URL/key set anymore).
//
// This file had drifted from that pivot, still reading
// NEXT_PUBLIC_LEAVE_SUPABASE_URL / NEXT_PUBLIC_LEAVE_SUPABASE_ANON_KEY —
// vars that don't exist in .env.example or the real deployed env — which
// silently broke every Leave Tracker sign-in call (undefined project
// URL/key). Fixed here to read the same unified vars as
// lib/supabase/client.ts. Kept as its own file — rather than just
// re-exporting the main client — so the Leave Tracker's session still
// stays on its OWN cookie name ("sb-leave-auth") instead of colliding
// with the Dashboard's ("sb-dashboard-auth"); that part of the original
// design was correct and is unrelated to this bug.
//
// Per PROGRESS.md point 5: since both apps now share one `auth.users`
// pool, a Dashboard account and a Leave Tracker account with the same
// email are technically capable of colliding if ever cross-referenced —
// they're kept apart today only by which employees row (if any)
// auth_user_id links to, not by separate identity stores. Worth keeping
// in mind for Sprint D (notifications/email) email-based matching.
export function createLeaveClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { name: 'sb-leave-auth' } }
  );
}