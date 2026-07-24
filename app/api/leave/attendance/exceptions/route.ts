import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getAttendanceExceptions } from '@/lib/attendanceExceptions';

// Backs the "Today's Absentees" and "Possible Half Day / Missed Punch"
// accordions on the Leave Management page. All the actual classification
// logic lives in lib/attendanceExceptions.ts (kept out of the route so it
// can be unit-tested without an HTTP round trip).
//
// Optional ?date=YYYY-MM-DD overrides "today" — used when HR reviews a
// past date instead of the current one. Defaults to server "today".
export async function GET(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const dateParam = req.nextUrl.searchParams.get('date') || undefined;

  try {
    const result = await getAttendanceExceptions(supabase, dateParam);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to compute attendance exceptions: ${message}`, absentees: [], halfDayCandidates: [] },
      { status: 500 }
    );
  }
}