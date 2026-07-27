import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import {
  getAttendanceExceptions,
  getAttendanceExceptionsRange,
  getAttendanceExceptionsAllPending,
} from '@/lib/attendanceExceptions';

// Backs the Absentees and Half Day / Missed Punch tabs on the Leave
// Tracker. All the actual classification logic lives in
// lib/attendanceExceptions.ts (kept out of the route so it can be
// unit-tested without an HTTP round trip).
//
// Three query shapes:
//   (no params)                   — HR hasn't picked a date yet. Returns
//                                    every pending absentee/half-day row
//                                    across the WHOLE uploaded history
//                                    (see getAttendanceExceptionsAllPending),
//                                    not just the latest single day —
//                                    once HR records a leave for a row it
//                                    drops out here into Leave History, so
//                                    this is meant to surface everything
//                                    still unresolved.
//   ?date=YYYY-MM-DD              — single day.
//   ?start_date=...&end_date=...  — a period; returns every absentee/
//                                    half-day row across that whole range
//                                    in one response, each tagged with its
//                                    own `date`. Takes priority over
//                                    `date` if both are present. This
//                                    fetches every table it needs ONCE for
//                                    the whole range (see
//                                    getAttendanceExceptionsRange), not
//                                    once per day, so a wide range doesn't
//                                    mean a slow load.
export async function GET(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const startDateParam = req.nextUrl.searchParams.get('start_date') || undefined;
  const endDateParam = req.nextUrl.searchParams.get('end_date') || undefined;
  const dateParam = req.nextUrl.searchParams.get('date') || undefined;

  try {
    if (startDateParam && endDateParam) {
      const result = await getAttendanceExceptionsRange(supabase, startDateParam, endDateParam);
      return NextResponse.json(result);
    }
    if (!dateParam) {
      // No date picked yet — show every pending row across the whole
      // uploaded history, not just the latest single day.
      const result = await getAttendanceExceptionsAllPending(supabase);
      return NextResponse.json(result);
    }
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