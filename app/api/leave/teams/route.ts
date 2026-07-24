import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';

// Backs the Team dropdown(s) in AdjustBalanceButton's Details tab.
// GET returns every team plus its current manager (id + name), so the UI
// can show "Platform Team — managed by Aditi Rao" without a second
// round trip. POST is the "create on the fly" path — there's no separate
// Manage Teams screen (deliberate, per the product decision this
// migration implements): typing a new team name in the combobox creates
// it here, then the caller selects it immediately.
export async function GET() {
  try {
    const supabase = await createLeaveClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: teams, error } = await supabase
      .from('teams')
      .select('id, name, manager_id')
      .order('name');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const managerIds = Array.from(
      new Set((teams ?? []).map((t) => t.manager_id).filter((id): id is string => !!id))
    );

    let managerNames: Record<string, string> = {};
    if (managerIds.length > 0) {
      const { data: managers } = await supabase
        .from('employees')
        .select('id, full_name')
        .in('id', managerIds);
      managerNames = Object.fromEntries((managers ?? []).map((m) => [m.id, m.full_name]));
    }

    return NextResponse.json({
      teams: (teams ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        managerId: t.manager_id,
        managerName: t.manager_id ? managerNames[t.manager_id] ?? null : null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to load teams: ${message}`, teams: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const sessionClient = await createLeaveClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json();
  const name = (body.name || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Team name is required.' }, { status: 400 });
  }

  const service = createLeaveServiceClient();
  const { data: team, error } = await service
    .from('teams')
    .insert({ name })
    .select('id, name, manager_id')
    .single();

  if (error) {
    // unique violation on name — treat as "already exists", not a hard failure
    if (error.code === '23505') {
      const { data: existing } = await service.from('teams').select('id, name, manager_id').eq('name', name).maybeSingle();
      if (existing) {
        return NextResponse.json({ team: { id: existing.id, name: existing.name, managerId: existing.manager_id, managerName: null } });
      }
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { team: { id: team.id, name: team.name, managerId: team.manager_id, managerName: null } },
    { status: 201 }
  );
}