import { createBrowserClient } from '@supabase/ssr';

// Used from Client Components ('use client'). Reads the session from cookies
// that middleware.ts keeps refreshed.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
