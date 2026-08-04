import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';

// GET: current employee's saved theme_preference (Workstream 2, step 2).
// Returns 'dark' as a soft fallback if there's no session, rather than a
// 401 — this is called on every /leave/** page load purely to sync a
// cosmetic preference, so a logged-out visitor (e.g. someone on
// /leave/login) shouldn't see a console error over it.
export async function GET() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ theme: 'dark' });
  }

  const supabase = await createLeaveClient();
  const { data, error } = await supabase
    .from('employees')
    .select('theme_preference')
    .eq('id', employee.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ theme: 'dark' });
  }

  return NextResponse.json({ theme: data?.theme_preference ?? 'dark' });
}

// PUT: persist a theme choice against the logged-in employee's row.
export async function PUT(req: Request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const theme = body?.theme;
  if (theme !== 'dark' && theme !== 'light') {
    return NextResponse.json(
      { error: 'theme must be "dark" or "light"' },
      { status: 400 }
    );
  }

  const supabase = await createLeaveClient();
  const { error } = await supabase
    .from('employees')
    .update({ theme_preference: theme })
    .eq('id', employee.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ theme });
}
