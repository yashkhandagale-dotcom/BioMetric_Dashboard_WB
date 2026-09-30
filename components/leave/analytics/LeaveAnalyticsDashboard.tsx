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

// Dynamic import for Weekend & Holiday Bridge section
const BridgeSection = dynamic(() => import('./BridgeSection'), {
  ssr: false,
  loading: () => (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-72 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
        <div className="h-72 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
      </div>
    </div>
  ),
});

// Dynamic import for Frequency & Bradford section
const FrequencySection = dynamic(() => import('./FrequencySection'), {
  ssr: false,
  loading: () => (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
        ))}
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
    <div className="space-y-10">
      {/* Sticky Filter Bar */}
      <AnalyticsFilterBar filters={filters} onChange={setFilters} />

      {/* ── Section 1: Overview ────────────────────────────────────────── */}
      <section aria-labelledby="section-overview">
        <OverviewSection filters={filters} />
      </section>

      {/* ── Section 2: Weekend & Holiday Bridges ────────────────────────── */}
      <section aria-labelledby="section-bridge" className="border-t border-[var(--border)] pt-8">
        <BridgeSection filters={filters} />
      </section>

      {/* ── Section 3: Frequent Leave & Bradford Factor ─────────────────── */}
      <section aria-labelledby="section-frequency" className="border-t border-[var(--border)] pt-8">
        <FrequencySection filters={filters} />
      </section>

      {/* Sections 4-5 will be hooked in Phase 5 */}
    </div>
  );
}
