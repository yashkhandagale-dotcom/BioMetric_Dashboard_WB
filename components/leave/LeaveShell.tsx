'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Wallet,
  LayoutGrid,
  CalendarDays,
  ClipboardCheck,
  BarChart3,
  ShieldAlert,
  Building2,
  Users,
  ArrowLeft,
  ChevronDown,
  Lock,
  LogOut,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  CalendarPlus,
  Home,
  CalendarClock,
} from 'lucide-react';
import LeaveThemeSync from './LeaveThemeSync';
import NotificationBell from './NotificationBell';
import ApplyLeaveDrawer from './ApplyLeaveDrawer';
import WfhApplyDrawer from './WfhApplyDrawer';
import type { ApplySubmitResult, ApplyLeaveInitialValues } from './ApplyLeaveForm';
import type { WfhSubmitResult, WfhApplyInitialValues } from './WfhApplyForm';

export type LeaveRole = 'employee' | 'lead' | 'manager' | 'hr' | 'hr_super_admin';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  exact?: boolean;
  badge?: number;
};

type NavGroup = { label: string; items: NavItem[] };

// One place that decides which tabs a role gets to see. Every subtree
// layout (me/team/approvals/admin) renders this same shell with the
// signed-in employee's role — so the set of tabs, their order, their
// icons, and the active-state logic are identical no matter which page
// of the feature you're actually looking at.
function navGroups(role: LeaveRole, pendingApprovalsCount: number): NavGroup[] {
  const isApprover = role === 'manager' || role === 'lead';
  const isHr = role === 'hr' || role === 'hr_super_admin';
  const showPersonal = role !== 'hr_super_admin';

  const groups: NavGroup[] = [];
  if (showPersonal) {
    groups.push({
      label: 'Personal',
      items: [
        { href: '/leave/me', label: 'My Leave', icon: Wallet, exact: true },
        { href: '/leave/attendance', label: 'Attendance', icon: CalendarClock },
      ],
    });
  }

  if (isApprover) {
    groups.push({
      label: 'Team',
      items: [
        { href: '/leave/approvals', label: 'Approvals', icon: ClipboardCheck, badge: pendingApprovalsCount },
        { href: '/leave/team', label: 'My Team', icon: Users },
      ],
    });
  }

  if (isHr) {
    groups.push({
      label: 'Organization-wide',
      items: [
        { href: '/leave/admin', label: 'Leave Balances', icon: LayoutGrid, exact: true },
        { href: '/leave/admin/history', label: 'Leave Tracker', icon: CalendarDays },
        { href: '/leave/approvals', label: 'Approvals', icon: ClipboardCheck, badge: pendingApprovalsCount },
        { href: '/leave/admin/analytics', label: 'Analytics', icon: BarChart3 },
        { href: '/leave/admin/violations', label: 'Violations', icon: ShieldAlert },
        { href: '/leave/admin/organization', label: 'Organization', icon: Building2 },
        { href: '/leave/admin/config', label: 'Leave Configuration', icon: Settings },
        // "Create Login" nav item hidden per HR's request — the
        // Acknowledge & Set Up flow (NewJoinersPanel on /leave/admin)
        // now links a login automatically for anyone who signed in
        // with Google, and Add Employee (also hidden, same reasoning)
        // covers the rest. Still accessible at /leave/admin/bulk-logins.
        // { href: '/leave/admin/bulk-logins', label: 'Create Login', icon: KeyRound },
      ],
    });
  }

  return groups;
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

function NavLink({ item, pathname, collapsed }: { item: NavItem; pathname: string; collapsed: boolean }) {
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={`relative flex items-center gap-2 rounded-xl px-2.5 py-2.5 text-sm font-medium transition-all duration-150 ${
        collapsed ? 'justify-center' : 'justify-between'
      } ${
        active
          ? 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-lg shadow-[var(--accent)]/20'
          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] hover:shadow-sm'
      }`}
    >
      <span className={`flex items-center ${collapsed ? '' : 'gap-3'}`}>
        <Icon size={16} className={active ? 'text-white' : 'text-[var(--text-muted)]'} />
        {!collapsed && item.label}
      </span>
      {!!item.badge && !collapsed && (
        <span
          className={`inline-flex min-w-[1.25rem] h-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
            active ? 'bg-white/30 text-white' : 'bg-amber-500 text-white shadow-sm'
          }`}
        >
          {item.badge}
        </span>
      )}
      {!!item.badge && collapsed && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 shadow" />}
    </Link>
  );
}

const ROLE_LABEL: Record<LeaveRole, string> = {
  employee: 'Employee',
  lead: 'Lead',
  manager: 'Manager',
  hr: 'HR',
  hr_super_admin: 'HR Admin',
};

export default function LeaveShell({
  employeeName,
  role,
  pendingApprovalsCount = 0,
  children,
}: {
  employeeName: string;
  role: LeaveRole;
  pendingApprovalsCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const groups = navGroups(role, pendingApprovalsCount);
  const flatItems = groups.flatMap((g) => g.items);
  const canReturnToDashboard = role !== 'employee';
  // hr_super_admin has no personal leave/WFH of their own — same
  // condition navGroups() uses to decide whether to show the
  // "Personal" nav group, reused here to decide whether to show the
  // quick-apply actions.
  const showPersonal = role !== 'hr_super_admin';

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // "Apply for Leave" / "Apply for WFH" — available from any /leave/** page.
  const [applyLeaveOpen, setApplyLeaveOpen] = useState(false);
  const [applyLeavePrefill, setApplyLeavePrefill] = useState<ApplyLeaveInitialValues | undefined>(undefined);
  const [applyWfhOpen, setApplyWfhOpen] = useState(false);
  const [applyWfhPrefill, setApplyWfhPrefill] = useState<WfhApplyInitialValues | undefined>(undefined);

  // "Apply" and "Reapply" flows dispatch these custom events
  useEffect(() => {
    function onLeaveOpen(e: Event) {
      const detail = (e as CustomEvent<ApplyLeaveInitialValues | undefined>).detail;
      setApplyLeavePrefill(detail);
      setApplyLeaveOpen(true);
    }
    function onWfhReapply(e: Event) {
      const detail = (e as CustomEvent<WfhApplyInitialValues>).detail;
      setApplyWfhPrefill(detail);
      setApplyWfhOpen(true);
    }
    window.addEventListener('leave:open', onLeaveOpen as EventListener);
    window.addEventListener('leave:reapply', onLeaveOpen as EventListener);
    window.addEventListener('wfh:reapply', onWfhReapply as EventListener);
    return () => {
      window.removeEventListener('leave:open', onLeaveOpen as EventListener);
      window.removeEventListener('leave:reapply', onLeaveOpen as EventListener);
      window.removeEventListener('wfh:reapply', onWfhReapply as EventListener);
    };
  }, []);

  function openApplyLeave() {
    setApplyLeavePrefill(undefined);
    setApplyLeaveOpen(true);
  }
  function closeApplyLeave() {
    setApplyLeaveOpen(false);
    setApplyLeavePrefill(undefined);
  }
  function handleApplyLeaveSuccess(_result: ApplySubmitResult) {
    router.refresh();
  }

  function openApplyWfh() {
    setApplyWfhPrefill(undefined);
    setApplyWfhOpen(true);
  }
  function closeApplyWfh() {
    setApplyWfhOpen(false);
    setApplyWfhPrefill(undefined);
  }
  function handleApplyWfhSuccess(_result: WfhSubmitResult) {
    router.refresh();
    window.dispatchEvent(new CustomEvent('wfh:applied'));
  }

  // Collapsed = icon-only rail
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const stored = window.localStorage.getItem('leave-sidebar-collapsed');
    if (stored === '1') setCollapsed(true);
  }, []);
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem('leave-sidebar-collapsed', next ? '1' : '0');
      return next;
    });
  }

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  async function handleSignOut() {
    await fetch('/api/auth/signout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const UserMenu = (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        title={collapsed ? employeeName : undefined}
        className={`flex items-center rounded-xl text-left hover:bg-[var(--bg-elevated)] transition-all ${
          collapsed ? 'justify-center w-full py-1.5' : 'w-full gap-2.5 px-2 py-1.5'
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] text-xs font-bold text-white shadow-md shadow-[var(--accent)]/30">
          {initials(employeeName)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{employeeName}</span>
              <span className="block truncate text-[11px] text-[var(--text-muted)]">{ROLE_LABEL[role]}</span>
            </span>
            <ChevronDown size={14} className={`shrink-0 text-[var(--text-muted)] transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {menuOpen && (
        <div className={`absolute bottom-full mb-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-1.5 shadow-2xl z-50 ${collapsed ? 'left-0 w-[190px]' : 'left-0 w-full min-w-[190px]'}`}>
          <Link
            href="/leave/change-password"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <Lock size={14} className="text-[var(--text-muted)]" />
            Change Password
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] md:flex md:overflow-hidden">
      {/* ────────── Desktop sidebar ────────────────────────────────── */}
      <aside
        className={`hidden md:sticky md:top-0 md:flex h-screen shrink-0 flex-col border-r border-[var(--border)] transition-[width] duration-200 ${
          collapsed ? 'w-[70px]' : 'w-[260px]'
        }`}
        style={{
          background: 'linear-gradient(180deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
        }}
      >
        {/* Brand header */}
        <div className={`pt-5 pb-4 ${collapsed ? 'px-2' : 'px-5'}`}>
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] text-sm font-bold text-white shadow-lg shadow-[var(--accent)]/30 shrink-0">
              L
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[var(--text-primary)] tracking-tight">Leave Tracker</p>
                <p className="truncate text-[11px] text-[var(--text-muted)]">WonderBiz Technologies</p>
              </div>
            )}
          </div>
          {canReturnToDashboard && (
            <Link
              href="/"
              title={collapsed ? 'Dashboard' : undefined}
              className={`mt-4 flex items-center gap-1.5 rounded-xl border border-[var(--border)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 transition-all ${
                collapsed ? 'justify-center w-full py-2' : 'px-3 py-1.5'
              }`}
            >
              <ArrowLeft size={12} />
              {!collapsed && 'Dashboard'}
            </Link>
          )}
        </div>

        {/* Quick-apply CTA buttons */}
        {showPersonal && !collapsed && (
          <div className="px-3 mb-3">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={openApplyLeave}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] px-3 py-2 text-xs font-semibold text-white shadow-md shadow-[var(--accent)]/25 hover:shadow-lg hover:shadow-[var(--accent)]/30 transition-all"
              >
                <CalendarPlus size={13} />
                Leave
              </button>
              <button
                type="button"
                onClick={openApplyWfh}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent)]/50 hover:bg-[var(--bg-surface)] transition-all"
              >
                <Home size={13} />
                WFH
              </button>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className={`scroll-thin flex-1 overflow-y-auto py-2 space-y-4 ${collapsed ? 'px-2' : 'px-3'}`}>
          {groups
            .filter((g) => g.label === 'Personal')
            .map((group) => (
              <div key={group.label}>
                {!collapsed && (
                  <p className="px-2.5 pb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]/60">
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink key={item.href + item.label} item={item} pathname={pathname} collapsed={collapsed} />
                  ))}
                </div>
              </div>
            ))}

          {/* Collapsed quick-apply icons */}
          {showPersonal && collapsed && (
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={openApplyLeave}
                title="Leave"
                className="flex w-full items-center justify-center rounded-xl px-2.5 py-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                <CalendarPlus size={16} />
              </button>
              <button
                type="button"
                onClick={openApplyWfh}
                title="WFH"
                className="flex w-full items-center justify-center rounded-xl px-2.5 py-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                <Home size={16} />
              </button>
            </div>
          )}

          {groups
            .filter((g) => g.label !== 'Personal')
            .map((group) => (
              <div key={group.label}>
                {!collapsed && (
                  <p className="px-2.5 pb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]/60">
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink key={item.href + item.label} item={item} pathname={pathname} collapsed={collapsed} />
                  ))}
                </div>
              </div>
            ))}
        </nav>

        {/* Footer */}
        <div className={`border-t border-[var(--border)] py-3 space-y-2 ${collapsed ? 'px-2' : 'px-3'}`}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`flex items-center gap-2 rounded-xl text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-all w-full py-1.5 ${
              collapsed ? 'justify-center px-0' : 'px-2'
            }`}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <><PanelLeftClose size={15} /> Collapse</>}
          </button>
          <div className={`flex items-center gap-2 ${collapsed ? 'flex-col' : ''}`}>
            <div className={collapsed ? '' : 'flex-1 min-w-0'}>{UserMenu}</div>
            <NotificationBell collapsed={collapsed} />
            <LeaveThemeSync />
          </div>
        </div>
      </aside>

      {/* ────────── Mobile top bar + tab strip ─────────────────────── */}
      <div className="md:hidden sticky top-0 z-30 border-b border-[var(--border)]" style={{ background: 'var(--bg-card)', backdropFilter: 'blur(16px)' }}>
        <div className="flex items-center justify-between gap-3 px-4 h-14">
          <div className="flex items-center gap-2.5 min-w-0">
            {canReturnToDashboard && (
              <Link
                href="/"
                aria-label="Back to Dashboard"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/40 transition-all"
              >
                <ArrowLeft size={14} />
              </Link>
            )}
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] text-[10px] font-bold text-white">
                L
              </span>
              <p className="truncate text-sm font-bold text-[var(--text-primary)]">Leave Tracker</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {showPersonal && (
              <>
                <button
                  type="button"
                  onClick={openApplyLeave}
                  aria-label="Apply for Leave"
                  title="Apply for Leave"
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-md shadow-[var(--accent)]/25"
                >
                  <CalendarPlus size={14} />
                </button>
                <button
                  type="button"
                  onClick={openApplyWfh}
                  aria-label="Apply for WFH"
                  title="Apply for WFH"
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/40 transition-all"
                >
                  <Home size={14} />
                </button>
              </>
            )}
            <NotificationBell collapsed={false} />
            <LeaveThemeSync />
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Account menu"
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] text-[11px] font-bold text-white shadow-md shadow-[var(--accent)]/25"
              >
                {initials(employeeName)}
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-1.5 shadow-2xl z-50">
                  <div className="px-3 py-2.5 border-b border-[var(--border)] mb-1">
                    <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{employeeName}</p>
                    <p className="truncate text-[11px] text-[var(--text-muted)]">{ROLE_LABEL[role]}</p>
                  </div>
                  <Link
                    href="/leave/change-password"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    <Lock size={14} className="text-[var(--text-muted)]" />
                    Change Password
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut size={14} />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-2.5 pt-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {flatItems.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  active
                    ? 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-md shadow-[var(--accent)]/25'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon size={12} className={active ? 'text-white' : 'text-[var(--text-muted)]'} />
                {item.label}
                {!!item.badge && (
                  <span
                    className={`inline-flex min-w-[1rem] h-[1rem] items-center justify-center rounded-full px-1 text-[9px] font-bold ${
                      active ? 'bg-white/30 text-white' : 'bg-amber-500 text-white'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* ────────── Page content ────────────────────────────────────── */}
      <main className="scroll-thin flex-1 min-w-0 md:h-screen md:min-h-0 md:overflow-y-auto">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 sm:py-8">{children}</div>
      </main>

      {applyLeaveOpen && (
        <ApplyLeaveDrawer onClose={closeApplyLeave} onSuccess={handleApplyLeaveSuccess} initialValues={applyLeavePrefill} />
      )}
      {applyWfhOpen && (
        <WfhApplyDrawer onClose={closeApplyWfh} onSuccess={handleApplyWfhSuccess} initialValues={applyWfhPrefill} />
      )}
    </div>
  );
}
