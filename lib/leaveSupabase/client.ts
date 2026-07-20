import { createBrowserClient } from '@supabase/ssr';

// Deliberately separate from lib/supabase/client.ts. This points at the
// LEAVE TRACKER's own Supabase project — a different DB/project entirely
// from the one the main biometric dashboard uses. Do not merge these.
//
// Requires LEAVE_SUPABASE_URL / LEAVE_SUPABASE_ANON_KEY to be set as
// NEXT_PUBLIC_ vars so they're readable in the browser (see note in
// server.ts about why we still prefix them, matching Next.js convention).
export function createLeaveClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_LEAVE_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_LEAVE_SUPABASE_ANON_KEY!
  );
}