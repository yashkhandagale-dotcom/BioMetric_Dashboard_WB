'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

// Surfaces the `notifications` table (lib/leaveSupabase/notifyLeaveEvent.ts)
// for the signed-in employee — approvals/rejections/cancellations, and
// critically, "Send Reminder" from HR. Those reminders were already
// being written to the DB correctly; there was just no UI anywhere
// reading them back out, so they were invisible to the employee and
// manager they were meant for. This is that missing read side, wired
// into LeaveShell so it's one click away from every /leave/** page.
type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
  leave_request_id: string | null;
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const REMINDER_TYPES = new Set(['leave_reminder']);

export default function NotificationBell({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  async function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) {
      setUnreadCount(0);
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      await fetch('/api/leave/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      }).catch(() => {});
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={handleOpen}
        title="Notifications"
        className={`relative flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors ${
          collapsed ? 'w-full h-9' : 'h-9 w-9'
        }`}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1.5 min-w-[0.9rem] h-[0.9rem] flex items-center justify-center rounded-full bg-amber-500 text-white text-[9px] font-bold px-0.5">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-2 w-[320px] max-h-[420px] overflow-y-auto scroll-thin rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl ${
            collapsed ? 'left-0' : 'right-0'
          }`}
        >
          <div className="sticky top-0 bg-[var(--bg-elevated)] border-b border-[var(--border)] px-3.5 py-2.5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Notifications</h3>
          </div>

          {loading && items.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-6">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-6">You're all caught up.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {items.map((n) => (
                <li key={n.id} className={`px-3.5 py-2.5 ${n.is_read ? '' : 'bg-[var(--accent)]/5'}`}>
                  <div className="flex items-start gap-2">
                    {REMINDER_TYPES.has(n.type) && (
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--text-primary)] leading-snug">{n.title}</p>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">{n.body}</p>
                      <p className="text-[10px] text-[var(--text-muted)] mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
