'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Ban, Bell, BellOff, BellRing, Check, CheckCheck, CheckCircle2, X, XCircle } from 'lucide-react';

// Surfaces the `notifications` table (lib/leaveSupabase/notifyLeaveEvent.ts)
// for the signed-in employee — approvals/rejections/cancellations, and
// critically, "Send Reminder" from HR. Those reminders were already
// being written to the DB correctly; there was just no UI anywhere
// reading them back out, so they were invisible to the employee and
// manager they were meant for. This is that missing read side, wired
// into LeaveShell so it's one click away from every /leave/** page.
//
// ── Actionable notifications (this pass) ────────────────────────────
// Some notifications need the person to actually DO something —
// "apply for leave" for an employee who got a reminder, "review this
// request" for an admin/manager with something pending. Those get a
// primary button (and the whole row is clickable) that navigates
// straight to the right screen instead of just being a passive message.
// Everything else (approved/rejected/cancelled — pure FYI) gets a plain
// per-row "Ack" affordance, plus an "Ack all" in the header, replacing
// the old behavior of silently marking everything read the instant the
// panel opened (that doesn't make sense anymore now that opening an
// actionable item is supposed to navigate the person away, not quietly
// dismiss it).
//
// ⚠️ CONFIG BLOCK BELOW IS PLACEHOLDER DATA — see the chat message this
// shipped with for the full list of what needs verifying:
//   - The exact `type` string(s) notifyLeaveEvent.ts actually writes
//     for "reminder to apply" and "pending your approval" cases.
//   - The real route for an employee's Apply Leave screen.
//   - The real route for the admin/manager Approvals screen.
//   - Whether PATCH /api/leave/notifications already accepts a single
//     `{ id }` body for per-notification ack, or needs that added.
type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
  leave_request_id: string | null;
};

// ── Routes ─────────────────────────────────────────────────────────
// ADMIN_APPROVALS is inferred from this codebase's existing convention
// (AddEmployeeForm lives at app/leave/admin/employees/ — Approvals is
// assumed to follow the same /leave/admin/<section> pattern based on
// the sidebar's "Approvals" nav item). EMPLOYEE_APPLY_LEAVE is a guess
// with no evidence behind it — there was no "apply leave" page/route
// anywhere in what's been shared so far. Both need a one-line fix here
// once confirmed; nothing else in this file needs to change.
const ROUTES = {
  EMPLOYEE_APPLY_LEAVE: '/leave/apply',
  ADMIN_APPROVALS: '/leave/admin/approvals',
};

// ── Which notification types are "actionable" vs. plain FYI ────────
// `leave_reminder` is the only type name confirmed to exist
// (REMINDER_TYPES elsewhere in this codebase). `leave_pending_approval`
// is a placeholder key — until the real type string for "something is
// waiting on your approval" is confirmed, nothing will match it, and
// those notifications will just fall back to the plain Ack treatment
// (safe default: worst case is a missing shortcut button, not a broken
// link).
type ActionConfig = { label: string; buildHref: (n: Notification) => string };

const ACTIONABLE_TYPES: Record<string, ActionConfig> = {
  leave_reminder: {
    label: 'Apply',
    buildHref: () => ROUTES.EMPLOYEE_APPLY_LEAVE,
  },
  leave_pending_approval: {
    label: 'Review',
    buildHref: (n) =>
      n.leave_request_id ? `${ROUTES.ADMIN_APPROVALS}?requestId=${n.leave_request_id}` : ROUTES.ADMIN_APPROVALS,
  },
};

function getAction(type: string): ActionConfig | null {
  return ACTIONABLE_TYPES[type] ?? null;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Only `leave_reminder` is a type we know for certain. The rest of this
// app's notification `type` values weren't in scope here, so
// approved/rejected/cancelled icon matching below is a best-effort
// substring heuristic, not a hardcoded enum — anything that doesn't
// match falls back to a plain bell rather than guessing wrong.
const REMINDER_TYPES = new Set(['leave_reminder']);

function iconFor(type: string): { Icon: typeof Bell; className: string } {
  if (REMINDER_TYPES.has(type)) return { Icon: BellRing, className: 'bg-amber-500/15 text-amber-500' };
  const t = type.toLowerCase();
  if (t.includes('approv')) return { Icon: CheckCircle2, className: 'bg-emerald-500/15 text-emerald-500' };
  if (t.includes('reject') || t.includes('declin')) return { Icon: XCircle, className: 'bg-red-500/15 text-red-500' };
  if (t.includes('cancel')) return { Icon: Ban, className: 'bg-[var(--text-muted)]/15 text-[var(--text-muted)]' };
  return { Icon: Bell, className: 'bg-[var(--accent)]/15 text-[var(--accent)]' };
}

// Comfortable panel height/width when there's room for them. The actual
// max-height/alignment used is clamped to whatever space is really
// available around the bell (see `computePlacement`), so these are
// ceilings, not fixed sizes.
const PANEL_HEIGHT = 460;
const PANEL_WIDTH = 360;
const VIEWPORT_MARGIN = 12; // keep the panel from touching the screen edge
const GAP = 8; // gap between the bell and the panel

type PanelStyle = React.CSSProperties;

export default function NotificationBell({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false); // portals need a client-only guard (SSR has no document.body to render into)
  const [panelStyle, setPanelStyle] = useState<PanelStyle>({});
  const wrapperRef = useRef<HTMLDivElement>(null); // wraps just the bell button
  const panelRef = useRef<HTMLDivElement>(null); // the portaled dropdown

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leave/notifications');
      if (!res.ok) return;
      const body = await res.json();
      setItems(body.notifications ?? []);
      setUnreadCount(body.unreadCount ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll every 60s so a reminder HR just sent shows up without a full
  // page reload — cheap enough for a small in-app count, not meant to
  // replace real push delivery.
  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  // The panel is portaled to document.body (see the render below), so
  // a click inside it would otherwise look like a click "outside" the
  // bell and close the menu instantly. Both refs are checked before
  // treating a click as away-from-the-menu.
  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  // Measures space around the bell on all four sides and decides where
  // the panel should render — vertically (drop down vs. flip up) and
  // horizontally (hang from the left edge vs. the right edge of the
  // button) — then converts that into fixed pixel coordinates, since a
  // portaled element positions itself relative to the viewport, not to
  // its original DOM parent.
  const computePlacement = useCallback(() => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();

    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - VIEWPORT_MARGIN;
    const dropUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const availableHeight = dropUp ? spaceAbove : spaceBelow;

    const spaceToLeftOfButtonRight = rect.right - VIEWPORT_MARGIN;
    const spaceToRightOfButtonLeft = window.innerWidth - rect.left - VIEWPORT_MARGIN;

    let alignRight = !collapsed;
    let availableWidth = alignRight ? spaceToLeftOfButtonRight : spaceToRightOfButtonLeft;
    if (availableWidth < PANEL_WIDTH) {
      const otherSideWidth = alignRight ? spaceToRightOfButtonLeft : spaceToLeftOfButtonRight;
      if (otherSideWidth > availableWidth) {
        alignRight = !alignRight;
        availableWidth = otherSideWidth;
      }
    }

    const maxHeight = Math.max(160, Math.min(PANEL_HEIGHT, availableHeight));
    const maxWidth = Math.max(260, Math.min(PANEL_WIDTH, availableWidth));

    const style: PanelStyle = { position: 'fixed', maxHeight, width: maxWidth };
    if (dropUp) style.bottom = window.innerHeight - rect.top + GAP;
    else style.top = rect.bottom + GAP;
    if (alignRight) style.right = window.innerWidth - rect.right;
    else style.left = rect.left;

    setPanelStyle(style);
  }, [collapsed]);

  useEffect(() => {
    if (!open) return;
    computePlacement();
    window.addEventListener('resize', computePlacement);
    window.addEventListener('scroll', computePlacement, true);
    return () => {
      window.removeEventListener('resize', computePlacement);
      window.removeEventListener('scroll', computePlacement, true);
    };
  }, [open, computePlacement]);

  // Marks one notification read, locally and on the server. Used both
  // by the explicit "Ack" button on plain FYI items and (optimistically)
  // the moment someone follows an actionable item's button — see
  // handleAction below for why that's optimistic rather than confirmed.
  const ackOne = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((n) => n.id === id);
      if (target && !target.is_read) setUnreadCount((c) => Math.max(0, c - 1));
      return prev.map((n) => (n.id === id ? { ...n, is_read: true } : n));
    });
    fetch('/api/leave/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, []);

  const ackAll = useCallback(() => {
    setUnreadCount(0);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    fetch('/api/leave/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
  }, []);

  // Following an actionable notification navigates the person away
  // from this page entirely, so there's no later moment to confirm
  // "did they actually apply / actually review it" — the frontend
  // can't see what happens on the screen it's sending them to. This
  // marks it read optimistically on click rather than leaving it
  // unread forever. If you'd rather this only clear once the
  // underlying leave request actually changes state, that has to
  // happen server-side (in whatever route handles leave submission/
  // approval), not here — flagged in the chat message this shipped with.
  function handleAction(n: Notification) {
    const action = getAction(n.type);
    if (!action) return;
    ackOne(n.id);
    setOpen(false);
    router.push(action.buildHref(n));
  }

  const unresolvedExists = items.some((n) => !n.is_read);

  const panel = open && (
    <div
      ref={panelRef}
      style={panelStyle}
      className="z-[999] flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl shadow-black/20"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 shrink-0 bg-[var(--bg-surface)] border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Notifications</h3>
          {items.length > 0 && (
            <span className="text-[10px] font-medium text-[var(--text-muted)] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-full px-1.5 py-0.5">
              {items.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unresolvedExists && (
            <button
              type="button"
              onClick={ackAll}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1 rounded-md hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <CheckCheck size={12} />
              Ack all
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close notifications"
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="overflow-y-auto scroll-thin">
        {loading && items.length === 0 ? (
          <div className="p-3 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-[var(--bg-surface)] shrink-0" />
                <div className="flex-1 space-y-1.5 pt-0.5">
                  <div className="h-2.5 w-3/4 rounded bg-[var(--bg-surface)]" />
                  <div className="h-2.5 w-full rounded bg-[var(--bg-surface)]" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 px-4 text-center">
            <span className="w-10 h-10 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-[var(--text-muted)]">
              <BellOff size={16} />
            </span>
            <p className="text-xs font-medium text-[var(--text-primary)]">You&apos;re all caught up</p>
            <p className="text-[11px] text-[var(--text-muted)]">New approvals and reminders will show up here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {items.map((n) => {
              const { Icon, className } = iconFor(n.type);
              const action = getAction(n.type);
              return (
                <li
                  key={n.id}
                  onClick={action ? () => handleAction(n) : undefined}
                  className={`px-4 py-3 transition-colors ${action ? 'cursor-pointer' : ''} hover:bg-[var(--bg-surface)] ${
                    n.is_read ? '' : 'bg-[var(--accent)]/[0.06]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${className}`}>
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex-1 min-w-0 text-xs font-medium text-[var(--text-primary)] leading-snug">{n.title}</p>
                        <span className="shrink-0 text-[10px] text-[var(--text-muted)] mt-0.5 whitespace-nowrap">
                          {timeAgo(n.created_at)}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-relaxed">{n.body}</p>

                      {/* Actionable → primary button that jumps straight to the
                          relevant screen. Plain FYI → a quiet per-row Ack,
                          only shown while still unread. */}
                      <div className="mt-2 flex items-center gap-2">
                        {action ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAction(n);
                            }}
                            className="inline-flex items-center bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors"
                          >
                            {action.label}
                          </button>
                        ) : !n.is_read ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              ackOne(n.id);
                            }}
                            className="inline-flex items-center gap-1 border border-[var(--border)] hover:border-[var(--text-muted)] text-[var(--text-muted)] hover:text-[var(--text-primary)] text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors"
                          >
                            <Check size={11} />
                            Ack
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        className={`relative flex items-center justify-center rounded-lg transition-colors ${
          open
            ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
        } ${collapsed ? 'w-full h-9' : 'h-9 w-9'}`}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1.5 min-w-[0.9rem] h-[0.9rem] flex items-center justify-center rounded-full bg-amber-500 text-white text-[9px] font-bold px-0.5 ring-2 ring-[var(--bg-surface)]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {mounted && panel && createPortal(panel, document.body)}
    </div>
  );
}