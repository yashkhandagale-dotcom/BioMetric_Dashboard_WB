'use client';

/* ────────────────────────────────────────────────────────────────────────
   INFORMATION ARCHITECTURE PLAN (spec §2)
   ────────────────────────────────────────────────────────────────────────
   Top-level groups and why they're grouped this way
   ---------------------------------------------------------------------
   • "Overview"  — Overview/KPIs, Employees, Departments. These three are
     just different scroll positions within the SAME dashboard page (this
     product, unlike the Leave Tracker, has never had per-section routes —
     it's one continuous page of KPI cards → charts → tables). Grouping
     them together signals "these are views onto one dataset", not three
     separate destinations.
   • "Analysis" — Comparison (team-vs-team, employee-month-vs-month). Kept
     separate from "Overview" because it's a genuinely different task
     (drilling into a deliberate side-by-side, not just scanning the
     current period) and — for HR specifically — because it's the one
     item that isn't always present (it only exists once uploaded data
     spans a range with 2+ departments or 2+ months; the nav item is
     omitted rather than shown-disabled when there's nothing to compare).
   • "Admin" — Upload, Export, Settings, Holidays. Everything here changes
     what data exists or how it's computed, rather than just viewing it.
     HR-only. A plain manager/lead reading a read-only team view gets
     Export (they're still allowed to pull their own team's numbers out)
     but not Upload/Settings/Holidays — those mutate org-wide state.

   Role-gating
   ---------------------------------------------------------------------
   • HR ('hr' variant): every group, every item.
   • Manager/Lead reading their team ('team' variant, authenticated,
     landed on '/' directly): Overview group in full, no Analysis group
     (this view has never rendered the comparison panels — they're an
     HR-only tool), Admin group trimmed to just Export. Gets a
     "Leave Tracker" group with Approvals + My Leave, same links the old
     inline header buttons pointed at.
   • Anonymous share-link viewer ('shared' variant, the unauthenticated
     ?view=1&token=... path): Overview group only. Nothing else — this
     visitor isn't logged into anything else in the app to navigate to,
     same reasoning LeaveShell already applies to its own
     canReturnToDashboard check.

   Relationship to the Leave Tracker's nav
   ---------------------------------------------------------------------
   Deliberately NOT a single merged top-level switcher between
   "Attendance" and "Leave" — they stay two separate shells, each with
   its own link back to the other (this shell's "Leave Tracker" link
   near the brand; LeaveShell's existing "Dashboard" link in the same
   spot). Reasons:
     1. LeaveShell already ships and is keyed on a *Leave* role
        (employee/lead/manager/hr/hr_super_admin) which doesn't line up
        1:1 with this dashboard's role prop (hr/manager/lead, no
        `employee`) — a single switcher would need a third role mapping
        layer for no real benefit.
     2. A plain `employee` never reaches this dashboard at all (redirected
        server-side to /leave/me before DashboardClient renders), so
        "switch products" only ever needs to go one direction from here
        anyway — a lightweight link is all that's actually used.
     3. Keeping them as two shells with a mutual cross-link matches what
        was already there (the old header already had a "Leave Tracker"
        button pointing out, and LeaveShell already had a "Dashboard"
        button pointing back) — this is a structural upgrade of an
        existing pattern, not a new product decision.

   Full page vs modal/drawer
   ---------------------------------------------------------------------
   Settings and Holidays stay exactly what they already were — an
   in-place modal/drawer triggered from a click — rather than becoming
   their own routed page. There's nowhere to route them TO (this
   dashboard has no sub-routes), and the Leave Tracker's own equivalents
   (Leave Configuration, Organization) that behave similarly are the
   heavier org-wide admin screens, whereas Settings/Holidays here are
   quick, scoped-to-current-office adjustments — a modal fits the weight
   of the task. Export also stays exactly what it already was (its own
   button + dialog, ExportPanel) rather than being reimplemented as a
   sidebar-triggered panel — it already owns real async state (loading
   spinners per format) that doesn't need reinventing.

   Upload is included as an Admin item even though the original spec's
   nav-item list didn't name it explicitly, because dropping it would
   remove existing functionality (the primary way HR gets new data in) —
   see spec §2 "Preserve all existing functionality".
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  LayoutGrid,
  Users,
  Building2,
  GitCompareArrows,
  Upload,
  Download,
  Settings,
  Calendar,
  ClipboardList,
  ClipboardCheck,
  LogOut,
  Eye,
} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';

export type DashboardVariant = 'hr' | 'team' | 'shared';
export type DashboardSectionId = 'overview' | 'employees' | 'departments' | 'comparison';

type NavItem =
  | { kind: 'scroll'; id: DashboardSectionId; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }
  | { kind: 'action'; id: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; onClick: () => void; badge?: number }
  | { kind: 'link'; id: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; href: string }
  | { kind: 'node'; id: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; node: React.ReactNode };

type NavGroup = { label: string; items: NavItem[] };

const SECTION_META: Record<DashboardSectionId, { label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  overview: { label: 'Overview / KPIs', icon: LayoutGrid },
  employees: { label: 'Employees', icon: Users },
  departments: { label: 'Departments', icon: Building2 },
  comparison: { label: 'Comparison', icon: GitCompareArrows },
};

function scrollToSection(id: DashboardSectionId) {
  document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncThemeToServer(theme: 'dark' | 'light') {
  fetch('/api/leave/theme', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme }),
  }).catch(() => {
    // Non-blocking; theme still applies locally.
  });
}

function buildNavGroups(opts: {
  variant: DashboardVariant;
  availableSections: DashboardSectionId[];
  holidayCount: number;
  onOpenHolidays?: () => void;
  onOpenSettings?: () => void;
  onUpload?: () => void;
  exportSlot?: React.ReactNode;
}): NavGroup[] {
  const { variant, availableSections, holidayCount, onOpenHolidays, onOpenSettings, onUpload, exportSlot } = opts;
  const groups: NavGroup[] = [];

  // ── Overview — same three items for every variant, just filtered to
  // whichever section anchors actually exist in the current page state
  // (e.g. "Comparison" only exists once there's data to compare).
  const overviewItems: NavItem[] = (['overview', 'employees', 'departments'] as DashboardSectionId[])
    .filter((id) => availableSections.includes(id))
    .map((id) => ({ kind: 'scroll', id, label: SECTION_META[id].label, icon: SECTION_META[id].icon }));
  if (overviewItems.length > 0) {
    groups.push({ label: 'Overview', items: overviewItems });
  }

  // ── Analysis — HR only, and only once a comparison view actually exists.
  if (variant === 'hr' && availableSections.includes('comparison')) {
    groups.push({
      label: 'Analysis',
      items: [{ kind: 'scroll', id: 'comparison', label: SECTION_META.comparison.label, icon: SECTION_META.comparison.icon }],
    });
  }

  // ── Admin — HR gets everything; team gets Export only; shared gets nothing.
  if (variant === 'hr') {
    const adminItems: NavItem[] = [];
    if (onUpload) adminItems.push({ kind: 'action', id: 'upload', label: 'Upload CSV', icon: Upload, onClick: onUpload });
    if (exportSlot) adminItems.push({ kind: 'node', id: 'export', label: 'Export', icon: Download, node: exportSlot });
    if (onOpenSettings) adminItems.push({ kind: 'action', id: 'settings', label: 'Settings', icon: Settings, onClick: onOpenSettings });
    if (onOpenHolidays) {
      adminItems.push({ kind: 'action', id: 'holidays', label: 'Holidays', icon: Calendar, onClick: onOpenHolidays, badge: holidayCount });
    }
    if (adminItems.length > 0) groups.push({ label: 'Admin', items: adminItems });
  } else if (variant === 'team' && exportSlot) {
    groups.push({ label: 'Admin', items: [{ kind: 'node', id: 'export', label: 'Export', icon: Download, node: exportSlot }] });
  }

  // ── Leave Tracker — HR and team both have access to both products;
  // the anonymous share-link viewer isn't logged into anything.
  if (variant === 'hr') {
    groups.push({
      label: 'Leave Tracker',
      items: [{ kind: 'link', id: 'leave-admin', label: 'Open Leave Tracker', icon: ClipboardList, href: '/leave/admin' }],
    });
  } else if (variant === 'team') {
    groups.push({
      label: 'Leave Tracker',
      items: [
        { kind: 'link', id: 'leave-approvals', label: 'Approve Team Leaves', icon: ClipboardCheck, href: '/leave/approvals' },
        { kind: 'link', id: 'leave-me', label: 'My Leave', icon: ClipboardList, href: '/leave/me' },
      ],
    });
  }

  return groups;
}

function NavItemButton({ item, active }: { item: NavItem; active: boolean }) {
  if (item.kind === 'node') return <>{item.node}</>;

  const Icon = item.icon;
  const baseClass = `flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
    active ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
  }`;
  const inner = (
    <>
      <span className="flex items-center gap-2.5">
        <Icon size={16} className={active ? 'text-white' : 'text-[var(--text-muted)]'} />
        {item.label}
      </span>
      {item.kind === 'action' && !!item.badge && (
        <span
          className={`inline-flex min-w-[1.1rem] h-[1.1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
            active ? 'bg-white/25 text-white' : 'bg-amber-500 text-white'
          }`}
        >
          {item.badge}
        </span>
      )}
    </>
  );

  if (item.kind === 'link') {
    return (
      <Link href={item.href} className={baseClass}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={item.kind === 'scroll' ? () => scrollToSection(item.id) : item.onClick} className={baseClass}>
      {inner}
    </button>
  );
}

export default function DashboardShell({
  variant,
  availableSections,
  holidayCount = 0,
  onOpenHolidays,
  onOpenSettings,
  onUpload,
  onSignOut,
  exportSlot,
  recordCount,
  children,
}: {
  variant: DashboardVariant;
  availableSections: DashboardSectionId[];
  holidayCount?: number;
  onOpenHolidays?: () => void;
  onOpenSettings?: () => void;
  onUpload?: () => void;
  onSignOut?: () => void;
  exportSlot?: React.ReactNode;
  recordCount?: number;
  children: React.ReactNode;
}) {
  const groups = buildNavGroups({ variant, availableSections, holidayCount, onOpenHolidays, onOpenSettings, onUpload, exportSlot });
  const scrollableGroups = groups.filter((g) => g.items.some((i) => i.kind === 'scroll'));
  const flatScrollItems = scrollableGroups.flatMap((g) => g.items).filter((i): i is Extract<NavItem, { kind: 'scroll' }> => i.kind === 'scroll');

  // ── Scroll-spy: the analog of LeaveShell's pathname-based isActive(),
  // adapted for a single page with in-page section anchors instead of
  // real routes. Only watches sections that are actually in the nav.
  const [activeId, setActiveId] = useState<DashboardSectionId | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (flatScrollItems.length === 0) return;
    const root = mainRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const id = visible[0].target.getAttribute('id')?.replace('section-', '') as DashboardSectionId | undefined;
          if (id) setActiveId(id);
        }
      },
      { root, rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );
    const els = flatScrollItems
      .map((item) => document.getElementById(`section-${item.id}`))
      .filter((el): el is HTMLElement => !!el);
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatScrollItems.map((i) => i.id).join(',')]);

  const VARIANT_LABEL: Record<DashboardVariant, string> = {
    hr: 'HR View',
    team: 'Team View',
    shared: 'Management View',
  };

  return (
    <div className="h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] md:flex md:overflow-hidden">
      {/* ---------- Desktop sidebar ---------- */}
      <aside className="hidden md:sticky md:top-0 md:flex h-screen w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)]/40">
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">WB</span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--text-primary)]">Attendance Dashboard</p>
              <p className="truncate text-[11px] text-[var(--text-muted)]">WonderBiz Technologies</p>
            </div>
          </div>
          {variant !== 'hr' && recordCount !== undefined && (
            <div className="mt-4 flex items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border)] px-2.5 py-1.5 rounded-lg w-fit">
              <Eye className="w-3.5 h-3.5 text-[var(--accent)] flex-shrink-0" />
              <span className="text-[var(--text-muted)] text-[11px]">Read-only · {recordCount.toLocaleString()} records</span>
            </div>
          )}
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto px-3 py-2 space-y-5">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <div key={item.id}>
                    <NavItemButton item={item} active={item.kind === 'scroll' && activeId === item.id} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--border)] px-3 py-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--text-muted)] truncate">{VARIANT_LABEL[variant]}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <ThemeToggle onChange={syncThemeToServer} />
              {onSignOut && (
                <button
                  type="button"
                  onClick={onSignOut}
                  aria-label="Sign out"
                  title="Sign out"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <LogOut size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* ---------- Mobile top bar + horizontal tab strip ---------- */}
      <div className="md:hidden sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-surface)]/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 h-14">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[10px] font-bold">WB</span>
            </div>
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">Attendance Dashboard</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle onChange={syncThemeToServer} />
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                aria-label="Sign out"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)]"
              >
                <LogOut size={14} />
              </button>
            )}
          </div>
        </div>
        {variant !== 'hr' && recordCount !== undefined && (
          <div className="flex items-center gap-2 px-4 pb-2">
            <Eye className="w-3.5 h-3.5 text-[var(--accent)] flex-shrink-0" />
            <span className="text-[var(--text-muted)] text-[11px]">Read-only · {recordCount.toLocaleString()} records</span>
          </div>
        )}
        <div className="flex gap-1 overflow-x-auto px-3 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {groups.flatMap((g) => g.items).map((item) => {
            if (item.kind === 'node') return <div key={item.id}>{item.node}</div>;
            const Icon = item.icon;
            const active = item.kind === 'scroll' && activeId === item.id;
            const pillClass = `flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              active ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)]'
            }`;
            if (item.kind === 'link') {
              return (
                <Link key={item.id} href={item.href} className={pillClass}>
                  <Icon size={13} className={active ? 'text-white' : 'text-[var(--text-muted)]'} />
                  {item.label}
                </Link>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.kind === 'scroll' ? () => scrollToSection(item.id) : item.onClick}
                className={pillClass}
              >
                <Icon size={13} className={active ? 'text-white' : 'text-[var(--text-muted)]'} />
                {item.label}
                {item.kind === 'action' && !!item.badge && (
                  <span className="inline-flex min-w-[1rem] h-[1rem] items-center justify-center rounded-full px-1 text-[9px] font-bold bg-amber-500 text-white">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------- Page content ---------- */}
      <main ref={mainRef} className="scroll-thin flex-1 min-w-0 md:h-screen md:min-h-0 md:overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
