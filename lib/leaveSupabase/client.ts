import { createBrowserClient } from '@supabase/ssr';

// Post-Sprint-2 pivot (see PROGRESS.md, "Post-Sprint-2 pivot: single-DB
// architecture"): Dashboard and Leave Tracker share ONE Supabase project
// now, via NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (see
// .env.example — there is no separate "leave" URL/key set anymore).
//
// Single-login pivot (resolves PROGRESS.md point 5, "Auth is flagged, not
// silently merged"): this used to additionally keep its OWN cookie name
// ('sb-leave-auth'), separate from the Dashboard's ('sb-dashboard-auth'),
// which meant a real person had to sign in twice — once per app — even
// though it's the same auth.users pool underneath. Both now use the same
// cookie ('sb-auth'), so the single /login page authenticates both apps
// in one request. Role-based access (who's allowed to see what once
// signed in) is enforced separately — see middleware.ts and each
// app/leave/**/layout.tsx guard — this file only controls the session.
export function createLeaveClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { name: 'sb-auth' } }
  );
}
