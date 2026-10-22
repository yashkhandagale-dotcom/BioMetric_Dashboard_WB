'use client';

import { useState, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { ShieldX } from 'lucide-react';
import { AttendanceRecord } from '@/lib/types';
import { getTeamRecords } from '@/lib/storage';
import { readSharedData } from '@/lib/sharedLink';
import DashboardSkeleton from '@/components/dashboard/DashboardSkeleton';
import ManagerView from '@/components/dashboard/ManagerView';

const HRDashboard = dynamic(() => import('@/components/dashboard/HRDashboard'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-[var(--bg-surface)] p-6 md:p-8">
      <DashboardSkeleton />
    </div>
  ),
});

type ViewMode = 'loading' | 'hr' | 'manager' | 'team' | 'denied';

// Single-login pivot: this used to be the page's default export and
// decided everything itself from the URL (?view=1&token=... vs plain
// hit = HR). Now app/page.tsx (a Server Component) does the auth/role
// lookup first and hands the result down as props — `role` is null only
// for the legacy unauthenticated share-link case (?view=1&token=...,
// still handled entirely client-side below, unchanged); for every other
// hit, app/page.tsx has already confirmed the session and resolved the
// role (a plain `employee` never reaches here at all — redirected server-
// side to /leave/me before this component is ever rendered).
export default function DashboardClient({
  role,
  teamCodes,
  managedDepartments,
  teamError,
}: {
  role: 'hr' | 'manager' | 'lead' | null;
  teamCodes?: string[];
  managedDepartments?: string[];
  teamError?: string | null;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>('loading');
  const [managerRecords, setManagerRecords] = useState<AttendanceRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const qp = new URLSearchParams(window.location.search);
    const isView = qp.get('view') === '1';
    if (isView) {
      (async () => {
        const records = await readSharedData();
        if (records && records.length > 0) {
          setManagerRecords(records);
          setViewMode('manager');
        } else {
          setViewMode('denied');
        }
      })();
      return;
    }

    if (role === 'manager' || role === 'lead') {
      const codes = teamCodes ?? [];
      (async () => {
        if (codes.length === 0) {
          setManagerRecords([]);
        } else {
          try {
            // PERF: Filter by team codes directly at the database level
            const recs = await getTeamRecords(codes);
            setManagerRecords(recs);
          } catch (err) {
            // Previously a failed load was swallowed and rendered as an
            // empty dashboard — indistinguishable from "no data".
            console.error('getTeamRecords failed:', err);
            setManagerRecords([]);
            setLoadError(`Could not load attendance data: ${err instanceof Error ? err.message : 'unknown error'}.`);
          }
        }
        setViewMode('team');
      })();
      return;
    }

    setViewMode('hr');
  }, [role, teamCodes]);

  if (viewMode === 'loading') {
    return (
      <div className="min-h-screen bg-[var(--bg-surface)] p-6 md:p-8">
        <DashboardSkeleton />
      </div>
    );
  }

  if (viewMode === 'denied') {
    return (
      <div className="min-h-screen bg-[var(--bg-surface)] flex flex-col items-center justify-center gap-4">
        <ShieldX className="w-12 h-12 text-red-400" />
        <p className="text-[var(--text-muted)] text-sm">Access denied — shared link is invalid or expired.</p>
      </div>
    );
  }

  if (viewMode === 'manager') {
    return <ManagerView records={managerRecords} />;
  }

  if (viewMode === 'team') {
    return (
      <ManagerView
        records={managerRecords}
        teamMode
        teamCodes={teamCodes}
        managedDepartments={managedDepartments}
        teamError={teamError ?? loadError}
      />
    );
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--bg-surface)] p-6 md:p-8">
          <DashboardSkeleton />
        </div>
      }
    >
      <HRDashboard />
    </Suspense>
  );
}
