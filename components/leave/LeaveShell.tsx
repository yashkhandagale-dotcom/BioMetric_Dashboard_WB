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
} from 'lucide-react';
import LeaveThemeSync from './LeaveThemeSync';

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

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--bg-elevated)] transition-colors"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white">
          {initials(employeeName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{employeeName}</span>
          <span className="block truncate text-[11px] text-[var(--text-muted)]">{ROLE_LABEL[role]}</span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-[var(--text-muted)] transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
      </button>

      {menuOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-full min-w-[190px] rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-xl z-50">
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
      <aside className="hidden md:sticky md:top-0 md:flex h-screen w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)]/40">
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-bold text-white">
              L
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--text-primary)]">Leave Tracker</p>
              <p className="truncate text-[11px] text-[var(--text-muted)]">WonderBiz Technologies</p>
            </div>
          </div>
          {canReturnToDashboard && (
            <Link
              href="/"
              className="mt-4 flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors w-fit"
            >
              <ArrowLeft size={12} />
              Dashboard
            </Link>
          )}
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto px-3 py-2 space-y-5">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-[var(--accent)] text-white'
                          : 'text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon size={16} className={active ? 'text-white' : 'text-[var(--text-muted)]'} />
                        {item.label}
                      </span>
                      {!!item.badge && (
                        <span
                          className={`inline-flex min-w-[1.1rem] h-[1.1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
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
          ))}
        </nav>

        <div className="border-t border-[var(--border)] px-3 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">{UserMenu}</div>
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
    </div>
  );
}
