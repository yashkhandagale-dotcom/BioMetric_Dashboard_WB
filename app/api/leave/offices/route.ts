import { NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';

// Returns the canonical list of offices from the database.
// Used across the app (such as AddEmployeeForm) to ensure office codes
// strictly adhere to canonical entries (e.g. MUM, HYD) and prevent typo'd duplicates.
export async function GET() {
  try {
    const supabase = await createLeaveClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('offices')
      .select('code, name')
      .order('name');

    if (error) {
      // Fallback to default canonical offices if table hasn't been migrated yet
      return NextResponse.json({
        offices: [
          { code: 'MUM', name: 'Mumbai' },
          { code: 'HYD', name: 'Hyderabad' },
        ],
      });
    }

    // If table exists but empty, provide defaults
    const offices = (data && data.length > 0)
      ? data
      : [
          { code: 'MUM', name: 'Mumbai' },
          { code: 'HYD', name: 'Hyderabad' },
        ];

    return NextResponse.json({ offices });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      {
        error: `Failed to load offices: ${message}`,
        offices: [
          { code: 'MUM', name: 'Mumbai' },
          { code: 'HYD', name: 'Hyderabad' },
        ],
      },
      { status: 500 }
    );
  }
}
