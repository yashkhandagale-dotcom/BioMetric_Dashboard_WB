'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Wallet,
  CalendarDays,
  ClipboardCheck,
  BarChart3,
  ShieldAlert,
  Building2,
  KeyRound,
  Lock,
} from 'lucide-react';

// Replaces the old single row of ~8 text links that used to sit at the
// top of every /leave/admin/** page (see app/leave/admin/page.tsx's own
// header comment history) — "worst design ever seen", "confusing",
// "all looking same" were all pointing at that same flat link bar. This
// groups the same destinations into one persistent left rail instead, so
// which section you're in is always visible (active-state highlight)
// and HR isn't re-scanning eight look-alike buttons on every page.
//
// Deliberately NOT collapsible/responsive-hidden below a breakpoint yet
// — this subtree is desk/HR-workstation-first (bulk CSV uploads, wide
// tables), same assumption the rest of /leave/admin already makes.
const NAV_ITEMS = [
  { href: '/leave/admin', label: 'Leave Balances', icon: Wallet, exact: true },
  { href: '/leave/admin/history', label: 'Leave Tracker', icon: CalendarDays },
  { href: '/leave/approvals', label: 'Pending Approvals', icon: ClipboardCheck },
  { href: '/leave/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/leave/admin/violations', label: 'Violations', icon: ShieldAlert },
  { href: '/leave/admin/organization', label: 'Organization', icon: Building2 },
  { href: '/leave/admin/bulk-logins', label: 'Create Login', icon: KeyRound },
  { href: '/leave/change-password', label: 'Change Password', icon: Lock },
];

export default function LeaveAdminSidebar({ pendingApprovalsCount }: { pendingApprovalsCount?: number }) {
  const pathname = usePathname();

  return (
    <nav className="hidden md:flex w-56 shrink-0 flex-col gap-1 border-r border-[var(--border)] bg-[var(--bg-elevated)]/30 px-3 py-6">
      <Link href="/" className="px-2 pb-4 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
        ← Dashboard
      </Link>
      <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        Leave Tracker
      </p>
      {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
              active
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
            }`}
          >
            <span className="flex items-center gap-2">
              <Icon size={16} />
              {label}
            </span>
            {href === '/leave/approvals' && !!pendingApprovalsCount && (
              <span
                className={`inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] rounded-full px-1 text-[10px] font-bold ${
                  active ? 'bg-white/25 text-white' : 'bg-amber-500 text-white'
                }`}
              >
                {pendingApprovalsCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
