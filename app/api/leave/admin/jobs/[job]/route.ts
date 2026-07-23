import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear } from '@/lib/leaveSupabase/fyHelpers';
import type { SupabaseClient } from '@supabase/supabase-js';

const JOBS = ['probation-accrual', 'annual-reset'] as const;
type Job = (typeof JOBS)[number];

// D7-1: these two SQL functions already exist (schema.sql migration
// 002) and already do the right math — this route is purely the
// "wiring a scheduler" MoSCoW called for, not a reimplementation.
//
// Neither function is idempotent by itself: fn_apply_probation_month_
// accrual does `accrued = accrued + v_credit` and fn_annual_leave_reset
// does `opening_balance = opening_balance + v_carry_forward` — calling
// either twice for the same period really would double-credit, which is
// exactly what the Day 7 AC ("hitting a job endpoint twice in a row does
// not double-credit or double-reset anything") is checking. So this
// route checks balance_transactions for a matching audit row from a
// previous run BEFORE calling the RPC, and skips if one already exists,
// rather than modifying the SQL functions themselves.

function monthsSinceDOJ(doj: string, asOf: Date): number {
  const d = new Date(`${doj}T00:00:00Z`);
  let months = (asOf.getUTCFullYear() - d.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - d.getUTCMonth());
  if (asOf.getUTCDate() < d.getUTCDate()) months -= 1;
  return Math.max(months, 0);
}

async function runProbationAccrual(service: SupabaseClient, asOf: Date) {
  const { data: employees, error: empError } = await service
    .from('employees')
    .select('id, date_of_joining')
    .not('date_of_joining', 'is', null);
  if (empError) throw new Error(empError.message);

  const { data: plType, error: plError } = await service.from('leave_types').select('id').eq('code', 'PL').single();
  if (plError || !plType) throw new Error(plError?.message ?? 'PL leave type not found');

  const results: { employeeId: string; completedMonth: number; ran: boolean; reason: string }[] = [];

  for (const emp of employees ?? []) {
    const completedMonth = monthsSinceDOJ(emp.date_of_joining, asOf);
    if (completedMonth < 1) {
      results.push({ employeeId: emp.id, completedMonth, ran: false, reason: 'Not yet 1 full month since joining' });
      continue;
    }

    const { data: balance } = await service
      .from('leave_balances')
      .select('id')
      .eq('employee_id', emp.id)
      .eq('leave_type_id', plType.id)
      .order('fy_start_year', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!balance) {
      results.push({ employeeId: emp.id, completedMonth, ran: false, reason: 'No PL balance row yet — not seeded/prorated' });
      continue;
    }

    // Idempotency guard: fn_apply_probation_month_accrual always writes a
    // balance_transactions note containing "month <N>" for this exact
    // completed_month — if one's already there, this month was already run.
    const { data: existing } = await service
      .from('balance_transactions')
      .select('id')
      .eq('leave_balance_id', balance.id)
      .ilike('note', `%month ${completedMonth}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      results.push({ employeeId: emp.id, completedMonth, ran: false, reason: 'Already recorded for this month' });
      continue;
    }

    const { error: rpcError } = await service.rpc('fn_apply_probation_month_accrual', {
      p_employee_id: emp.id,
      p_completed_month: completedMonth,
    });

    results.push({
      employeeId: emp.id,
      completedMonth,
      ran: !rpcError,
      reason: rpcError ? rpcError.message : 'Accrual applied',
    });
  }

  return { job: 'probation-accrual', ranCount: results.filter((r) => r.ran).length, results };
}

async function runAnnualReset(service: SupabaseClient, asOf: Date) {
  // The FY that just ended, rolling into the current one — same 25-Mar
  // cutover as everywhere else (getFYStartYear(asOf) - 1).
  const oldFyStartYear = getFYStartYear(asOf) - 1;

  const { data: employees, error: empError } = await service.from('employees').select('id');
  if (empError) throw new Error(empError.message);

  const { data: plType, error: plError } = await service.from('leave_types').select('id').eq('code', 'PL').single();
  if (plError || !plType) throw new Error(plError?.message ?? 'PL leave type not found');

  const results: { employeeId: string; ran: boolean; reason: string }[] = [];

  for (const emp of employees ?? []) {
    const { data: oldBalance } = await service
      .from('leave_balances')
      .select('id')
      .eq('employee_id', emp.id)
      .eq('leave_type_id', plType.id)
      .eq('fy_start_year', oldFyStartYear)
      .maybeSingle();

    if (!oldBalance) {
      results.push({ employeeId: emp.id, ran: false, reason: `No FY${oldFyStartYear} PL balance to reset` });
      continue;
    }

    const { data: newBalance } = await service
      .from('leave_balances')
      .select('id')
      .eq('employee_id', emp.id)
      .eq('leave_type_id', plType.id)
      .eq('fy_start_year', oldFyStartYear + 1)
      .maybeSingle();

    if (!newBalance) {
      results.push({
        employeeId: emp.id,
        ran: false,
        reason: `FY${oldFyStartYear + 1} balances not provisioned yet — run pro-ration/seeding first`,
      });
      continue;
    }

    // Idempotency guard: fn_annual_leave_reset always logs against the
    // OLD fy's balance row with a note mentioning that FY, whether or not
    // there was anything to carry forward/encash/lapse (all three reasons
    // share the same "FY<old> close" phrasing) — so any existing
    // carry_forward/encashment/lapse row for this balance means this
    // employee's reset already ran.
    const { data: existing } = await service
      .from('balance_transactions')
      .select('id')
      .eq('leave_balance_id', oldBalance.id)
      .in('reason', ['carry_forward', 'encashment', 'lapse'])
      .limit(1);

    if (existing && existing.length > 0) {
      results.push({ employeeId: emp.id, ran: false, reason: `FY${oldFyStartYear} already reset` });
      continue;
    }

    const { error: rpcError } = await service.rpc('fn_annual_leave_reset', {
      p_employee_id: emp.id,
      p_old_fy_start_year: oldFyStartYear,
    });

    results.push({ employeeId: emp.id, ran: !rpcError, reason: rpcError ? rpcError.message : 'Reset applied' });
  }

  return { job: 'annual-reset', oldFyStartYear, ranCount: results.filter((r) => r.ran).length, results };
}

async function runJob(job: Job) {
  const service = createLeaveServiceClient();
  const now = new Date();
  if (job === 'probation-accrual') return runProbationAccrual(service, now);
  return runAnnualReset(service, now);
}

// D7-2: GET is the path Vercel Cron actually calls (crons can only issue
// GET requests) — gated by CRON_SECRET instead of a browser session,
// since there is no logged-in HR user behind a scheduled trigger. See
// vercel.json.
export async function GET(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  if (!JOBS.includes(job as Job)) {
    return NextResponse.json({ error: `Unknown job "${job}". Valid jobs: ${JOBS.join(', ')}` }, { status: 404 });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Not authorized — this endpoint is for the scheduler only' }, { status: 401 });
  }

  try {
    const result = await runJob(job as Job);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Job "${job}" failed: ${message}` }, { status: 500 });
  }
}

// Interactive path for an HR admin to trigger a job manually (e.g. to
// catch up after a missed cron run) — session-gated, restricted to the
// 'hr' / 'hr_super_admin' roles.
export async function POST(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  if (!JOBS.includes(job as Job)) {
    return NextResponse.json({ error: `Unknown job "${job}". Valid jobs: ${JOBS.join(', ')}` }, { status: 404 });
  }

  const sessionClient = await createLeaveClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: caller } = await sessionClient
    .from('employees')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!caller || (caller.role !== 'hr' && caller.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'HR admin role required to run scheduled jobs' }, { status: 403 });
  }

  try {
    const result = await runJob(job as Job);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Job "${job}" failed: ${message}` }, { status: 500 });
  }
}