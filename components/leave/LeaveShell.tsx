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
  KeyRound,
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
} from 'lucide-react';
import LeaveThemeSync from './LeaveThemeSync';
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
// of the feature you're actually looking at. Previously this was three
// different, only-loosely-related things: LeaveAdminSidebar (admin
// only), MeNavbar's ad hoc role-conditional buttons (me only), and
// nothing at all (team + approvals).
function navGroups(role: LeaveRole, pendingApprovalsCount: number): NavGroup[] {
  const isApprover = role === 'manager' || role === 'lead';
  const isHr = role === 'hr' || role === 'hr_super_admin';
  // hr_super_admin (HR Admin) is org-wide / remind-only and has no
  // personal leave balance of their own to track here — everyone else
  // (including plain hr, who can still apply for their own leave) gets
  // the Personal group.
  const showPersonal = role !== 'hr_super_admin';

  const groups: NavGroup[] = [];
  if (showPersonal) {
    groups.push({ label: 'Personal', items: [{ href: '/leave/me', label: 'My Leave', icon: Wallet, exact: true }] });
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
        { href: '/leave/admin/bulk-logins', label: 'Create Login', icon: KeyRound },
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
      className={`relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
        collapsed ? 'justify-center' : 'justify-between'
      } ${
        active ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
      }`}
    >
      <span className={`flex items-center ${collapsed ? '' : 'gap-2.5'}`}>
        <Icon size={16} className={active ? 'text-white' : 'text-[var(--text-muted)]'} />
        {!collapsed && item.label}
      </span>
      {!!item.badge && !collapsed && (
        <span
          className={`inline-flex min-w-[1.1rem] h-[1.1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
            active ? 'bg-white/25 text-white' : 'bg-amber-500 text-white'
          }`}
        >
          {item.badge}
        </span>
      )}
      {!!item.badge && collapsed && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500" />}
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

  // "Apply for Leave" / "Apply for WFH" — feedback item: these used to
  // be a button buried in each page's own header/card (MeNavbar,
  // WfhPanel), only reachable from /leave/me. Living here instead
  // means they're one click away from any /leave/** page, and both
  // still open as a popup (slide-over drawer), same as before.
  const [applyLeaveOpen, setApplyLeaveOpen] = useState(false);
  const [applyLeavePrefill, setApplyLeavePrefill] = useState<ApplyLeaveInitialValues | undefined>(undefined);
  const [applyWfhOpen, setApplyWfhOpen] = useState(false);
  const [applyWfhPrefill, setApplyWfhPrefill] = useState<WfhApplyInitialValues | undefined>(undefined);

  // "Reapply" flows dispatch these same two custom events they always
  // have (from LeaveHistoryTable and WfhPanel) — only the listener
  // moved, from MeNavbar to here, so it keeps working now that the
  // drawers themselves live at the shell level.
  useEffect(() => {
    function onLeaveReapply(e: Event) {
      const detail = (e as CustomEvent<ApplyLeaveInitialValues>).detail;
      setApplyLeavePrefill(detail);
      setApplyLeaveOpen(true);
    }
    function onWfhReapply(e: Event) {
      const detail = (e as CustomEvent<WfhApplyInitialValues>).detail;
      setApplyWfhPrefill(detail);
      setApplyWfhOpen(true);
    }
    window.addEventListener('leave:reapply', onLeaveReapply as EventListener);
    window.addEventListener('wfh:reapply', onWfhReapply as EventListener);
    return () => {
      window.removeEventListener('leave:reapply', onLeaveReapply as EventListener);
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
    // WfhPanel (on /leave/me) fetches its own list client-side rather
    // than via the server page, so router.refresh() alone won't update
    // it — nudge it to refetch the same way it already listens for
    // other cross-component signals.
    window.dispatchEvent(new CustomEvent('wfh:applied'));
  }

  // Collapsed = icon-only rail, mirrors DashboardShell's identical
  // pattern so both products behave the same way.
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
        className={`flex items-center rounded-lg text-left hover:bg-[var(--bg-elevated)] transition-colors ${
          collapsed ? 'justify-center w-full py-1.5' : 'w-full gap-2.5 px-2 py-1.5'
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white">
          {initials(employeeName)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{employeeName}</span>
              <span className="block truncate text-[11px] text-[var(--text-muted)]">{ROLE_LABEL[role]}</span>
            </span>
            <ChevronDown size={14} className={`shrink-0 text-[var(--text-muted)] transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {menuOpen && (
        <div className={`absolute bottom-full mb-2 w-[190px] rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-xl z-50 ${collapsed ? 'left-0' : 'left-0 w-full min-w-[190px]'}`}>
          <Link
            href="/leave/change-password"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
          >
            <Lock size={14} className="text-[var(--text-muted)]" />
            Change Password
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-[var(--danger)] hover:bg-[var(--bg-surface)] transition-colors"
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
      {/* ---------- Desktop sidebar (always visible, never a per-page thing) ----------
          h-screen + sticky here (instead of the old min-h-screen wrapper, which let
          this whole aside grow with page content) is what pins the header and the
          user-menu/theme-toggle footer in place — only the <nav> list in between
          scrolls, so switching light/dark never requires scrolling the page. */}
      <aside
        className={`hidden md:sticky md:top-0 md:flex h-screen shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)]/40 transition-[width] duration-150 ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div className={`pt-5 pb-4 ${collapsed ? 'px-2' : 'px-4'}`}>
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-bold text-white">
              L
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">Leave Tracker</p>
                <p className="truncate text-[11px] text-[var(--text-muted)]">WonderBiz Technologies</p>
              </div>
            )}
          </div>
          {canReturnToDashboard && (
            <Link
              href="/"
              title={collapsed ? 'Dashboard' : undefined}
              className={`mt-4 flex items-center gap-1.5 rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors ${
                collapsed ? 'justify-center w-full py-1.5' : 'w-fit px-2.5 py-1.5'
              }`}
            >
              <ArrowLeft size={12} />
              {!collapsed && 'Dashboard'}
            </Link>
          )}
        </div>

        <nav className={`scroll-thin flex-1 overflow-y-auto py-2 space-y-5 ${collapsed ? 'px-2' : 'px-3'}`}>
          {/* "My Leave" always comes first, then "Apply" (Leave / WFH —
              opens the popup drawers, not a navigation link), then
              everything else (Team, Organization-wide) in their usual
              order. Personal is pulled out of `groups` and rendered
              here explicitly instead of via the generic map below, so
              Apply can sit directly under it regardless of what other
              groups a given role has. */}
          {groups
            .filter((g) => g.label === 'Personal')
            .map((group) => (
              <div key={group.label}>
                {!collapsed && (
                  <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
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

          {showPersonal && (
            <div>
              {!collapsed && (
                <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  Apply
                </p>
              )}
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={openApplyLeave}
                  title={collapsed ? 'Leave' : undefined}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors ${
                    collapsed ? 'justify-center' : ''
                  }`}
                >
                  <CalendarPlus size={16} className="text-[var(--text-muted)]" />
                  {!collapsed && 'Leave'}
                </button>
                <button
                  type="button"
                  onClick={openApplyWfh}
                  title={collapsed ? 'WFH' : undefined}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors ${
                    collapsed ? 'justify-center' : ''
                  }`}
                >
                  <Home size={16} className="text-[var(--text-muted)]" />
                  {!collapsed && 'WFH'}
                </button>
              </div>
            </div>
          )}

          {groups
            .filter((g) => g.label !== 'Personal')
            .map((group) => (
              <div key={group.label}>
                {!collapsed && (
                  <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
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

        <div className={`border-t border-[var(--border)] py-3 space-y-2 ${collapsed ? 'px-2' : 'px-3'}`}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`flex items-center gap-2 rounded-lg text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors w-full py-1.5 ${
              collapsed ? 'justify-center px-0' : 'px-2'
            }`}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <><PanelLeftClose size={15} /> Collapse</>}
          </button>
          <div className={`flex items-center gap-2 ${collapsed ? 'flex-col' : ''}`}>
            <div className={collapsed ? '' : 'flex-1 min-w-0'}>{UserMenu}</div>
            <LeaveThemeSync />
          </div>
        </div>
      </aside>

      {/* ---------- Mobile top bar + horizontal tab strip ---------- */}
      <div className="md:hidden sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-surface)]/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 h-14">
          <div className="flex items-center gap-2 min-w-0">
            {canReturnToDashboard && (
              <Link
                href="/"
                aria-label="Back to Dashboard"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)]"
              >
                <ArrowLeft size={14} />
              </Link>
            )}
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">Leave Tracker</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showPersonal && (
              <>
                <button
                  type="button"
                  onClick={openApplyLeave}
                  aria-label="Apply for Leave"
                  title="Apply for Leave"
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-white"
                >
                  <CalendarPlus size={14} />
                </button>
                <button
                  type="button"
                  onClick={openApplyWfh}
                  aria-label="Apply for WFH"
                  title="Apply for WFH"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)]"
                >
                  <Home size={14} />
                </button>
              </>
            )}
            <LeaveThemeSync />
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Account menu"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-semibold text-white"
              >
                {initials(employeeName)}
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-xl z-50">
                  <div className="px-2.5 py-2 border-b border-[var(--border)] mb-1">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">{employeeName}</p>
                    <p className="truncate text-[11px] text-[var(--text-muted)]">{ROLE_LABEL[role]}</p>
                  </div>
                  <Link
                    href="/leave/change-password"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
                  >
                    <Lock size={14} className="text-[var(--text-muted)]" />
                    Change Password
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-[var(--danger)] hover:bg-[var(--bg-surface)] transition-colors"
                  >
                    <LogOut size={14} />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto px-3 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {flatItems.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                <Icon size={13} className={active ? 'text-white' : 'text-[var(--text-muted)]'} />
                {item.label}
                {!!item.badge && (
                  <span
                    className={`inline-flex min-w-[1rem] h-[1rem] items-center justify-center rounded-full px-1 text-[9px] font-bold ${
                      active ? 'bg-white/25 text-white' : 'bg-amber-500 text-white'
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

      {/* ---------- Page content — every page renders inside this, same padding, same max width ----------
          min-h-0 is required alongside flex-1 here, or this flex child refuses to
          shrink below its content height and md:overflow-hidden on the wrapper has
          nothing to clip — the page (not this pane) would end up scrolling instead. */}
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
