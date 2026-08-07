'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Users,
  CheckCircle2,
  BarChart3,
  Clock3,
  AlertTriangle,
  Layers,
  LayoutGrid,
  LogIn,
  Menu,
  X,
} from 'lucide-react';

const SECTIONS = [
  {
    label: 'Overview',
    items: [
      { label: 'Employees', href: '/leave/admin', Icon: Users },
    ],
  },
  {
    label: 'Approvals',
    items: [
      { label: 'Pending approvals', href: '/leave/approvals', Icon: CheckCircle2 },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Analytics', href: '/leave/admin/analytics', Icon: BarChart3 },
      { label: 'History', href: '/leave/admin/history', Icon: Clock3 },
      { label: 'Violations', href: '/leave/admin/violations', Icon: AlertTriangle },
    ],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Bulk events', href: '/leave/admin/bulk-events', Icon: Layers },
      { label: 'Organization', href: '/leave/admin/organization', Icon: LayoutGrid },
      { label: 'Bulk logins', href: '/leave/admin/bulk-logins', Icon: LogIn },
    ],
  },
];

function NavItem({ href, label, Icon, active, onClick }: {
  href: string;
  label: string;
  Icon: typeof Users;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition ${
        active
          ? 'bg-[var(--accent)]/10 text-[var(--accent)] shadow-sm'
          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-[var(--border)] transition ${
          active ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30' : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
        }`}
      >
        <Icon className="w-4 h-4" />
      </span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

export default function LeaveAdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const activePath = useMemo(() => pathname ?? '', [pathname]);

  const isActive = (href: string) => activePath === href || activePath.startsWith(href + '/');

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)]">
      <div className="md:flex">
        <aside className="hidden md:flex md:w-80 md:flex-col md:justify-between md:border-r md:border-[var(--border)] md:bg-[var(--bg-elevated)]">
          <div className="flex h-full flex-col justify-between p-6">
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[var(--text-muted)] text-xs uppercase tracking-[0.2em]">Leave Tracker</p>
                    <h2 className="text-lg font-semibold">HR Workspace</h2>
                  </div>
                </div>
                <p className="text-sm text-[var(--text-muted)]">
                  One place for employee balances, approvals, reports, and admin actions.
                </p>
              </div>

              <div className="space-y-4">
                {SECTIONS.map((section) => (
                  <div key={section.label} className="space-y-3">
                    <p className="text-[var(--text-muted)] text-[11px] uppercase tracking-[0.2em]">{section.label}</p>
                    <div className="space-y-1">
                      {section.items.map((item) => (
                        <NavItem
                          key={item.href}
                          href={item.href}
                          label={item.label}
                          Icon={item.Icon}
                          active={isActive(item.href)}
                          onClick={() => setMobileOpen(false)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-6 border-t border-[var(--border)]">
              <Link
                href="/"
                className="group flex items-center gap-3 rounded-2xl bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated)]"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] group-hover:text-[var(--text-primary)]">
                  <Home className="w-4 h-4" />
                </span>
                <span>Attendance Dashboard</span>
              </Link>
            </div>
          </div>
        </aside>

        <div className="flex-1">
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-surface)] p-4 md:hidden">
            <div>
              <p className="text-xs text-[var(--text-muted)]">Leave Tracker</p>
              <h2 className="text-sm font-semibold">HR Workspace</h2>
            </div>
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>

          {mobileOpen && (
            <div className="fixed inset-0 z-50 bg-black/30 md:hidden">
              <div className="absolute left-0 top-0 flex h-full w-4/5 max-w-xs flex-col bg-[var(--bg-elevated)] p-5 shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <p className="text-[var(--text-muted)] text-[11px] uppercase tracking-[0.2em]">Leave Tracker</p>
                    <h2 className="text-lg font-semibold">Navigation</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                    aria-label="Close navigation"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4 overflow-y-auto pb-6">
                  {SECTIONS.map((section) => (
                    <div key={section.label} className="space-y-3">
                      <p className="text-[var(--text-muted)] text-[11px] uppercase tracking-[0.2em]">{section.label}</p>
                      <div className="space-y-1">
                        {section.items.map((item) => (
                          <NavItem
                            key={item.href}
                            href={item.href}
                            label={item.label}
                            Icon={item.Icon}
                            active={isActive(item.href)}
                            onClick={() => setMobileOpen(false)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-auto border-t border-[var(--border)] pt-5">
                  <Link
                    href="/"
                    onClick={() => setMobileOpen(false)}
                    className="group flex items-center gap-3 rounded-2xl bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated)]"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] group-hover:text-[var(--text-primary)]">
                      <Home className="w-4 h-4" />
                    </span>
                    <span>Attendance Dashboard</span>
                  </Link>
                </div>
              </div>
            </div>
          )}

          <main>{children}</main>
        </div>
      </div>
    </div>
  );
}
