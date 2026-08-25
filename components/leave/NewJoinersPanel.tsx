'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserRoundPlus, X } from 'lucide-react';
import AddEmployeeForm, { type PendingSignup } from '@/app/leave/admin/employees/AddEmployeeForm';

type SignupRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
};

// Simplified onboarding flow: shows the queue of people who've already
// signed in with Google but have no employees record yet (see
// app/api/auth/callback/route.ts and 0017_pending_signups_and_
// probation.sql). Renders nothing at all if the queue is empty — this
// is meant to disappear from the Admin panel entirely on a normal day,
// not sit there as permanent chrome.
//
// Design note: rows share ONE list container with hairline dividers
// rather than each being its own bordered card — a queue of related
// items reads as one list, not N separate boxes fighting for the same
// attention. Icon use is deliberately minimal (a single header icon +
// the standard close icon already used everywhere else in this app —
// see e.g. components/leave/CalendarDayDrawer.tsx) rather than one per
// row. The modal's entrance transition matches the exact
// mount/Escape/transition pattern components/leave/ApplyLeaveDrawer.tsx
// already established, rather than introducing a different animation
// technique (e.g. styled-jsx/@keyframes) not used anywhere else here.
//
// Only the FIRST row's Acknowledge button gets the `pulse-attention`
// glow (see globals.css) — it's the one HR should act on next. Pulsing
// every row in the queue would turn a "look here" signal into visual
// noise the moment there's more than one pending sign-in.
export default function NewJoinersPanel() {
  const router = useRouter();
  const [signups, setSignups] = useState<SignupRow[] | null>(null);
  const [acking, setAcking] = useState<PendingSignup | null>(null);
  const [mounted, setMounted] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/leave/admin/pending-signups');
      if (!res.ok) return;
      const data = await res.json();
      setSignups(data.signups ?? []);
    } catch {
      // Silently leave the panel absent — this is a nice-to-have queue,
      // not something that should break the rest of the Admin page.
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!acking) {
      setMounted(false);
      return;
    }
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, [acking]);

  useEffect(() => {
    if (!acking) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAcking(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [acking]);

  if (!signups || signups.length === 0) return null;

  return (
    <>
      <div className="relative overflow-hidden bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl mb-6">
        {/* Left accent bar signals "needs attention" without tinting the
            whole surface amber — same restraint as a single status dot
            rather than a colored box. */}
        <div className="absolute inset-y-0 left-0 w-1 bg-amber-500/70" />

        <div className="pl-5 pr-4 pt-4 pb-1 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-amber-500/15 flex items-center justify-center">
              <UserRoundPlus size={15} className="text-amber-600 dark:text-amber-400" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                New sign-ins awaiting setup
              </h2>
              <p className="text-[var(--text-muted)] text-xs mt-0.5 max-w-md leading-relaxed">
                Already signed in with Google — waiting on their team, role, and joining date.
              </p>
            </div>
          </div>
          <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-full px-2 py-0.5 mt-0.5">
            {signups.length}
          </span>
        </div>

        <div className="divide-y divide-[var(--border)]/60 mt-2">
          {signups.map((s, index) => (
            <div
              key={s.id}
              className="pl-5 pr-4 py-2.5 flex items-center justify-between gap-3 transition-colors hover:bg-[var(--bg-surface)]/60"
            >
              <div className="flex items-center gap-3 min-w-0">
                {s.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.avatar_url}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover ring-1 ring-[var(--border)]"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[var(--bg-surface)] ring-1 ring-[var(--border)] flex items-center justify-center text-xs font-semibold text-[var(--text-muted)]">
                    {(s.full_name || s.email)[0]?.toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                    {s.full_name || s.email}
                  </p>
                  <p className="text-[var(--text-muted)] text-[11px] truncate">
                    {s.email} · signed in {timeAgo(s.created_at)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setAcking({ id: s.id, email: s.email, fullName: s.full_name || s.email, avatarUrl: s.avatar_url })
                }
                className={`shrink-0 border border-emerald-600/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 text-xs font-medium px-3.5 py-1.5 rounded-full transition-colors ${
                  index === 0 ? 'pulse-attention' : ''
                }`}
              >
                Acknowledge
              </button>
            </div>
          ))}
        </div>
      </div>

      {acking && (
        <div
          className={`fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-start sm:items-center justify-center p-4 overflow-y-auto transition-opacity duration-150 ease-out ${
            mounted ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={() => setAcking(null)}
        >
          <div
            className={`relative w-full max-w-2xl my-8 transition-all duration-150 ease-out ${
              mounted ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-1 scale-[0.98]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setAcking(null)}
              aria-label="Close"
              className="absolute -top-2 -right-2 z-10 w-8 h-8 rounded-full bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] shadow-sm transition-colors"
            >
              <X size={16} />
            </button>
            <AddEmployeeForm
              pendingSignup={acking}
              onCreated={() => {
                setAcking(null);
                load();
                router.refresh();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

// Small, dependency-free relative-time label — "just now" / "5m ago" /
// "3h ago" / "2d ago". Falls back to a plain date past a week so this
// never turns into a distracting "37d ago".
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}