import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the Supabase auth session cookie on every request (required for
// SSR auth to keep working) and reports whether the request is authenticated.
//
// Single-login pivot: also returns the `supabase` client itself now (not
// just `user`), so middleware.ts can do a cheap follow-up `employees.role`
// lookup on the same request instead of only checking "is there a
// session" — this is the role check PROGRESS.md point 5 flagged as
// "Still open" ("if a regular employee's Leave Tracker session cookie
// were ever presented to the Dashboard's check, today it's blocked only
// because the cookie names differ, not because of a role check"). Now
// that both apps share one cookie, that role check is required, not
// optional — see middleware.ts.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: 'sb-auth' },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user, supabase };
}
