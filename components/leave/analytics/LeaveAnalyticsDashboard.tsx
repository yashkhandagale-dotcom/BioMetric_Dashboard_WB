'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import AnalyticsFilterBar from './AnalyticsFilterBar';
import { AnalyticsFilterState } from './types';

// Dynamic imports with custom skeletons for all chart-heavy and complex sections
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

const AttentionSection = dynamic(() => import('./AttentionSection'), {
  ssr: false,
  loading: () => (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-60 rounded-xl bg-[var(--bg-elevated)]" />
      <div className="h-72 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
    </div>
  ),
});

const PlannerSection = dynamic(() => import('./PlannerSection'), {
  ssr: false,
  loading: () => (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-60 rounded-xl bg-[var(--bg-elevated)]" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-52 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)]" />
        ))}
      </div>
    </div>
  ),
});

const BalancesSection = dynamic(() => import('./BalancesSection'), {
  ssr: false,
  loading: () => (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-60 rounded-xl bg-[var(--bg-elevated)]" />
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
    <div className="space-y-12">
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

      {/* ── Section 4: HR Attention List ─────────────────────────────────── */}
      <section aria-labelledby="section-attention" className="border-t border-[var(--border)] pt-8">
        <AttentionSection filters={filters} />
      </section>

      {/* ── Section 5: Long Weekend & Bridge Day Planner ─────────────────── */}
      <section aria-labelledby="section-planner" className="border-t border-[var(--border)] pt-8">
        <PlannerSection filters={filters} />
      </section>

      {/* ── Section 6: Balances & Ledger Reconciliation ─────────────────── */}
      <section aria-labelledby="section-balances" className="border-t border-[var(--border)] pt-8">
        <BalancesSection filters={filters} />
      </section>
    </div>
  );
}
