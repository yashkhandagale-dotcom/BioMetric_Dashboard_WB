'use client';

import { useMemo, useState } from 'react';
import ApprovalCard, { PendingApprovalRequest } from './ApprovalCard';
import WfhApprovalCard, { PendingWfhRequest } from './WfhApprovalCard';
import RegularisationApprovalCard, { PendingRegularisationRequest } from './RegularisationApprovalCard';

// Extracted so HR's org-wide queue (potentially long) can be searched /
// filtered by department client-side without a round trip — a manager's
// queue is already short (direct department only) so the filter bar just
// won't show anything worth filtering, but stays available for
// consistency.
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

  const nothingToShow = filtered.length === 0 && filteredWfh.length === 0 && filteredRegularisations.length === 0;

  return (
    <div className="space-y-3">
      {(isHr && (requests.length > 0 || wfhRequests.length > 0 || regularisationRequests.length > 0)) && (
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code…"
            className="flex-1 min-w-[10rem] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)]"
          />
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
        <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-6 text-center text-[var(--text-muted)] text-sm">
          {requests.length === 0 && wfhRequests.length === 0 && regularisationRequests.length === 0
            ? 'No pending requests right now.'
            : 'No requests match your filters.'}
        </div>
      ) : (
        <>
          {filtered.map((r) => (
            <ApprovalCard key={r.id} request={r} canApprove={canApprove} canRemind={canRemind} />
          ))}
          {filteredWfh.length > 0 && (
            <div className="space-y-3">
              {filtered.length > 0 && (
                <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide pt-2">
                  Work From Home
                </h3>
              )}
              {filteredWfh.map((r) => (
                <WfhApprovalCard key={r.id} request={r} canApprove={canApprove} />
              ))}
            </div>
          )}
          {filteredRegularisations.length > 0 && (
            <div className="space-y-3">
              {(filtered.length > 0 || filteredWfh.length > 0) && (
                <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide pt-2">
                  Regularisation Requests
                </h3>
              )}
              {filteredRegularisations.map((r) => (
                <RegularisationApprovalCard key={r.id} request={r} canApprove={canApprove} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
