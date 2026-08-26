'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import ApprovalCard, { PendingApprovalRequest } from './ApprovalCard';
import WfhApprovalCard, { PendingWfhRequest } from './WfhApprovalCard';
import RegularisationApprovalCard, { PendingRegularisationRequest } from './RegularisationApprovalCard';

type RequestKind = 'all' | 'leave' | 'wfh' | 'regularisation';

type CombinedItem =
  | { kind: 'leave'; id: string; data: PendingApprovalRequest }
  | { kind: 'wfh'; id: string; data: PendingWfhRequest }
  | { kind: 'regularisation'; id: string; data: PendingRegularisationRequest };

const PAGE_SIZE = 9;

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;

  // Compact page list: first, last, current ±1, with ellipses between gaps.
  const pages: (number | 'ellipsis')[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== 'ellipsis') {
      pages.push('ellipsis');
    }
  }

  return (
    <div className="flex items-center justify-center gap-1 pt-1">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        aria-label="Previous page"
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-40 hover:text-[var(--text-primary)] hover:border-[var(--text-muted)]/40 transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>

      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span key={`e-${i}`} className="w-7 text-center text-xs text-[var(--text-muted)]">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-medium transition-colors ${
              p === page
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/40'
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        aria-label="Next page"
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-40 hover:text-[var(--text-primary)] hover:border-[var(--text-muted)]/40 transition-colors"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// Extracted so HR's org-wide queue (potentially long) can be searched /
// filtered by department client-side without a round trip — a manager's
// queue is already short (direct department only) so the filter bar just
// won't show anything worth filtering, but stays available for
// consistency.
//
// Layout: all pending items (leave/WFH/regularisation) are merged into
// one combined, filtered list and rendered as a responsive grid
// (1 col mobile, 2 tablet, 3 wide desktop) with client-side pagination,
// rather than one full-width card per row — most cards are far narrower
// than the page, so a single-column stack wasted a lot of horizontal
// space and pushed later requests below the fold unnecessarily.
export default function ApprovalsList({
  requests,
  wfhRequests = [],
  regularisationRequests = [],
  isHr,
  canApprove,
  canRemind,
}: {
  requests: PendingApprovalRequest[];
  // Feedback items #5/#6 — WFH requests rendered in the same queue,
  // below leave requests, each with its own small "Work From Home"
  // sub-heading so the two request types stay visually distinct without
  // needing a separate tab/page.
  wfhRequests?: PendingWfhRequest[];
  // Part C, §C.2 — pending, employee-initiated regularisation requests,
  // same treatment as WFH above. No department field on this type (see
  // RegularisationApprovalCard's header comment) so the department
  // filter below only narrows leave/WFH — search still works on it.
  regularisationRequests?: PendingRegularisationRequest[];
  isHr: boolean;
  // hr_super_admin (HR Admin) is remind-only; manager/lead/hr approve
  // directly and don't see a remind button — see ApprovalCard.
  canApprove: boolean;
  canRemind: boolean;
}) {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [kind, setKind] = useState<RequestKind>('all');
  const [page, setPage] = useState(1);

  const departments = useMemo(
    () => Array.from(new Set([...requests.map((r) => r.department), ...wfhRequests.map((r) => r.department)])).sort(),
    [requests, wfhRequests]
  );

  const filtered = requests.filter((r) => {
    if (department && r.department !== department) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return r.employeeName.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q);
  });

  const filteredWfh = wfhRequests.filter((r) => {
    if (department && r.department !== department) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return r.employeeName.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q);
  });

  const filteredRegularisations = regularisationRequests.filter((r) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return r.employeeName.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q);
  });

  const totalCount = requests.length + wfhRequests.length + regularisationRequests.length;
  const nothingAtAll = totalCount === 0;

  const TABS: { key: RequestKind; label: string; count: number }[] = (
    [
      { key: 'all', label: 'All', count: totalCount },
      { key: 'leave', label: 'Leave', count: requests.length },
      { key: 'wfh', label: 'Work From Home', count: wfhRequests.length },
      { key: 'regularisation', label: 'Regularisation', count: regularisationRequests.length },
    ] as { key: RequestKind; label: string; count: number }[]
  ).filter((t) => t.key === 'all' || t.count > 0 || (t.key === 'leave' && requests.length === 0 && wfhRequests.length === 0 && regularisationRequests.length === 0));

  const showLeave = kind === 'all' || kind === 'leave';
  const showWfh = kind === 'all' || kind === 'wfh';
  const showReg = kind === 'all' || kind === 'regularisation';

  const visibleLeave = showLeave ? filtered : [];
  const visibleWfh = showWfh ? filteredWfh : [];
  const visibleReg = showReg ? filteredRegularisations : [];
  const nothingToShow = visibleLeave.length === 0 && visibleWfh.length === 0 && visibleReg.length === 0;

  // Single combined, ordered list (leave, then WFH, then regularisation)
  // so the grid + pagination below only has to deal with one array,
  // regardless of which tab is active.
  const combined: CombinedItem[] = useMemo(
    () => [
      ...visibleLeave.map((data) => ({ kind: 'leave' as const, id: data.id, data })),
      ...visibleWfh.map((data) => ({ kind: 'wfh' as const, id: data.id, data })),
      ...visibleReg.map((data) => ({ kind: 'regularisation' as const, id: data.id, data })),
    ],
    [visibleLeave, visibleWfh, visibleReg]
  );

  const totalPages = Math.max(1, Math.ceil(combined.length / PAGE_SIZE));

  // Any change to tab/search/department reshuffles what "page 1" even
  // means, so jump back to it rather than leaving the user stranded on
  // a now-irrelevant page number.
  useEffect(() => {
    setPage(1);
  }, [kind, search, department]);

  // Keep page in range if the list shrinks (e.g. approving the last
  // item on the last page).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return combined.slice(start, start + PAGE_SIZE);
  }, [combined, page]);

  const rangeStart = combined.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, combined.length);

  return (
    <div className="space-y-4">
      {!nothingAtAll && (
        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] pb-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setKind(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                kind === t.key
                  ? 'border-[var(--accent)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t.label}
              <span
                className={`inline-flex min-w-[1.1rem] h-[1.1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                  kind === t.key ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                }`}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {isHr && !nothingAtAll && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[10rem]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or code…"
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-7 pr-3 py-1.5 text-xs text-[var(--text-primary)]"
            />
          </div>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)]"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}

      {nothingToShow ? (
        <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-8 text-center space-y-1">
          <p className="text-[var(--text-primary)] text-sm font-medium">
            {nothingAtAll ? 'All caught up' : 'No requests match your filters'}
          </p>
          <p className="text-[var(--text-muted)] text-xs">
            {nothingAtAll ? 'No pending requests right now.' : 'Try a different search term or department.'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-[var(--text-muted)]">
            Showing {rangeStart}–{rangeEnd} of {combined.length} request{combined.length === 1 ? '' : 's'}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {pageItems.map((item) => {
              if (item.kind === 'leave') {
                return <ApprovalCard key={item.id} request={item.data} canApprove={canApprove} canRemind={canRemind} />;
              }
              if (item.kind === 'wfh') {
                return <WfhApprovalCard key={item.id} request={item.data} canApprove={canApprove} />;
              }
              return <RegularisationApprovalCard key={item.id} request={item.data} canApprove={canApprove} />;
            })}
          </div>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}