'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import AnalyticsFilterBar from './AnalyticsFilterBar';
import { AnalyticsFilterState } from './types';

// Dynamic import with custom skeleton for Overview section
const OverviewSection = dynamic(() => import('./OverviewSection'), {
  ssr: false,
  loading: () => (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-28 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-80 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
        <div className="h-80 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
      </div>
      <div className="h-80 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
    </div>
  ),
});

export default function LeaveAnalyticsDashboard({ initialFyStartYear }: { initialFyStartYear: number }) {
  const [filters, setFilters] = useState<AnalyticsFilterState>({
    fyStartYear: initialFyStartYear,
    department: 'all',
    office: 'all',
    leaveType: 'all',
    status: 'approved',
  });

  return (
    <div className="space-y-8">
      {/* Sticky Filter Bar */}
      <AnalyticsFilterBar filters={filters} onChange={setFilters} />

      {/* ── Section 1: Overview ────────────────────────────────────────── */}
      <section aria-labelledby="section-overview">
        <OverviewSection filters={filters} />
      </section>

      {/* Sections 2-6 will be hooked in upcoming phases */}
    </div>
  );
}
