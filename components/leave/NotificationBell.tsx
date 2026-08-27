'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  Ban,
  Bell,
  BellOff,
  BellRing,
  CalendarPlus,
  Check,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  ThumbsDown,
  ThumbsUp,
  X,
  XCircle,
} from 'lucide-react';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
  leave_request_id: string | null;
};

const PANEL_HEIGHT = 520;
const PANEL_WIDTH = 380;
const VIEWPORT_MARGIN = 12;
const GAP = 8;

type PanelStyle = React.CSSProperties;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

function iconFor(type: string, title: string): { Icon: React.ComponentType<{ size?: number; className?: string }>; className: string } {
  const t = (type + ' ' + title).toLowerCase();
  if (t.includes('reminder') || t.includes('absent') || t.includes('waiting')) {
    return { Icon: BellRing, className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' };
  }
  if (t.includes('approv') || t.includes('regularis')) {
    return { Icon: CheckCircle2, className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' };
  }
  if (t.includes('reject') || t.includes('declin')) {
    return { Icon: XCircle, className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30' };
  }
  if (t.includes('cancel')) {
    return { Icon: Ban, className: 'bg-slate-500/15 text-[var(--text-muted)] border-slate-500/30' };
  }
  return { Icon: Bell, className: 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30' };
}

export default function NotificationBell({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [panelStyle, setPanelStyle] = useState<PanelStyle>({});
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    load();
    const id = setInterval(load, 45000);
    return () => clearInterval(id);
  }, [load]);

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

  const computePlacement = useCallback(() => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();

    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - VIEWPORT_MARGIN;
    const dropUp = spaceBelow < 250 && spaceAbove > spaceBelow;
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

    const maxHeight = Math.max(200, Math.min(PANEL_HEIGHT, availableHeight));
    const maxWidth = Math.max(280, Math.min(PANEL_WIDTH, availableWidth));

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

  // Handle "Apply for Leave" action from reminder notification
  function handleOpenApply(n: Notification) {
    ackOne(n.id);
    setOpen(false);

    // Extract any ISO date from the notification body (e.g. "2026-08-27")
    const dateMatch = n.body.match(/\b\d{4}-\d{2}-\d{2}\b/);
    const prefillDate = dateMatch ? dateMatch[0] : undefined;

    window.dispatchEvent(
      new CustomEvent('leave:open', {
        detail: prefillDate ? { startDate: prefillDate, endDate: prefillDate } : undefined,
      })
    );
  }

  // Handle Quick Approve
  async function handleQuickApprove(requestId: string, notificationId: string) {
    setActionInProgress(requestId);
    try {
      const res = await fetch(`/api/leave/approvals/${requestId}/approve`, { method: 'POST' });
      if (res.ok) {
        ackOne(notificationId);
        router.refresh();
      }
    } finally {
      setActionInProgress(null);
    }
  }

  // Handle Quick Reject redirect/navigate
  function handleReviewRequest(requestId: string, notificationId: string) {
    ackOne(notificationId);
    setOpen(false);
    router.push(`/leave/approvals?requestId=${requestId}`);
  }

  const unreadItems = items.filter((n) => !n.is_read);
  const displayItems = tab === 'unread' ? unreadItems : items;

  const panel = open && (
    <div
      ref={panelRef}
      style={panelStyle}
      className="z-[999] flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl space-y-0"
    >
      {/* ── Header with Tabs & Ack All ────────────────────────────── */}
      <div className="flex flex-col gap-2.5 shrink-0 bg-[var(--bg-surface)] border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-[10px] font-bold text-white bg-amber-500 rounded-full px-1.5 py-0.5 leading-none">
                {unreadCount} new
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={ackAll}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)] px-2 py-1 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors"
                title="Mark all notifications as acknowledged"
              >
                <CheckCheck size={13} />
                Ack All
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close notifications"
              className="w-6 h-6 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 bg-[var(--bg-elevated)] p-0.5 rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setTab('unread')}
            className={`flex-1 py-1 text-xs font-semibold rounded-md transition-all ${
              tab === 'unread'
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Unread {unreadItems.length > 0 && `(${unreadItems.length})`}
          </button>
          <button
            type="button"
            onClick={() => setTab('all')}
            className={`flex-1 py-1 text-xs font-semibold rounded-md transition-all ${
              tab === 'all'
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            All ({items.length})
          </button>
        </div>
      </div>

      {/* ── Notification List ─────────────────────────────────────── */}
      <div className="overflow-y-auto scroll-thin flex-1 min-h-0">
        {loading && items.length === 0 ? (
          <div className="p-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3 animate-pulse">
                <div className="w-8 h-8 rounded-xl bg-[var(--bg-elevated)] shrink-0" />
                <div className="flex-1 space-y-1.5 pt-0.5">
                  <div className="h-3 w-3/4 rounded bg-[var(--bg-elevated)]" />
                  <div className="h-2.5 w-full rounded bg-[var(--bg-elevated)]/60" />
                </div>
              </div>
            ))}
          </div>
        ) : displayItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 px-4 text-center">
            <span className="w-11 h-11 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] shadow-sm">
              <BellOff size={18} />
            </span>
            <p className="text-sm font-semibold text-[var(--text-primary)] mt-1">
              {tab === 'unread' ? "You're all caught up!" : 'No notifications yet'}
            </p>
            <p className="text-xs text-[var(--text-muted)] max-w-xs leading-relaxed">
              {tab === 'unread'
                ? 'All pending reminders and approvals have been acknowledged.'
                : 'Leave requests, reminders, and status updates will show up here.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {displayItems.map((n) => {
              const { Icon, className } = iconFor(n.type, n.title);
              const isPendingForEmployee = n.title.toLowerCase().includes('your leave request is still pending') || (n.title.toLowerCase().includes('pending') && !n.title.toLowerCase().includes('waiting on you'));
              const isMissingApplicationForEmp = n.title.toLowerCase().includes('apply for your leave') || n.title.toLowerCase().includes('unrecorded absence');
              const isManagerApprovalAction = (n.type === 'leave_submitted' || n.title.toLowerCase().includes('waiting on you') || n.title.toLowerCase().includes('applied for leave')) && !!n.leave_request_id;

              return (
                <li
                  key={n.id}
                  className={`p-4 transition-all duration-150 hover:bg-[var(--bg-elevated)]/40 ${
                    n.is_read ? 'opacity-85' : 'bg-[var(--accent)]/[0.04]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center border shadow-xs ${className}`}>
                      <Icon size={15} />
                    </span>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-bold text-[var(--text-primary)] leading-tight">
                          {n.title}
                        </p>
                        <span className="shrink-0 text-[10px] text-[var(--text-muted)] whitespace-nowrap">
                          {timeAgo(n.created_at)}
                        </span>
                      </div>

                      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                        {n.body}
                      </p>

                      {/* ── Contextual Action Buttons ──────────────── */}
                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        {/* 1. Missing application -> Open Apply Leave drawer directly */}
                        {isMissingApplicationForEmp ? (
                          <button
                            type="button"
                            onClick={() => handleOpenApply(n)}
                            className="inline-flex items-center gap-1.5 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] hover:opacity-95 text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow-sm transition-all"
                          >
                            <CalendarPlus size={13} />
                            Apply for Leave
                          </button>
                        ) : isPendingForEmployee ? (
                          /* 2. Employee with already-applied leave -> Just info status, NO apply button */
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                            ⏳ Pending Approval
                          </span>
                        ) : isManagerApprovalAction ? (
                          /* 3. Manager with pending approval request -> Review & Quick Approve */
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleReviewRequest(n.leave_request_id!, n.id)}
                              className="inline-flex items-center gap-1 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow-sm transition-all"
                            >
                              <ExternalLink size={12} />
                              Review
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickApprove(n.leave_request_id!, n.id)}
                              disabled={actionInProgress === n.leave_request_id}
                              className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-2.5 py-1.5 rounded-xl shadow-sm transition-all disabled:opacity-50"
                              title="Quick Approve"
                            >
                              <ThumbsUp size={12} />
                              Approve
                            </button>
                          </div>
                        ) : null}

                        {/* Ack single button */}
                        {!n.is_read && (
                          <button
                            type="button"
                            onClick={() => ackOne(n.id)}
                            className="inline-flex items-center gap-1 border border-[var(--border)] hover:border-[var(--text-muted)] text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs font-medium px-2.5 py-1 rounded-xl transition-all ml-auto hover:bg-[var(--bg-surface)]"
                            title="Acknowledge & dismiss"
                          >
                            <Check size={12} />
                            Ack
                          </button>
                        )}
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
        className={`relative flex items-center justify-center rounded-xl transition-all ${
          open
            ? 'bg-[var(--accent)] text-white shadow-md shadow-[var(--accent)]/30'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
        } ${collapsed ? 'w-full h-9' : 'h-9 w-9'}`}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-black px-1 ring-2 ring-[var(--bg-surface)] shadow-sm animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {mounted && panel && createPortal(panel, document.body)}
    </div>
  );
}