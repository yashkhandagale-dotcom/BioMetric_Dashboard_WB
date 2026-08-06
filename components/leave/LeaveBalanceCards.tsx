import type { LeaveBalanceBreakdown } from '@/lib/leaveSupabase/getEmployeeBalances';

// A3 — one card per leave type (entitled/used/remaining). The
// entitled/used/remaining split isn't in EmployeeBalances (which only
// has the pivoted closing_balance per type — see
// lib/leaveSupabase/getEmployeeBalances.ts's own comment: "do not
// re-derive this pivot elsewhere"), so this component takes
// getEmployeeBalanceBreakdown's raw leave_balances rows
// (opening+accrued+manual_adjustment = entitled, used, closing_balance
// = remaining) directly rather than adding new balance math on top of
// the already-pivoted EmployeeBalances shape.

const CARD_COLOR: Record<string, string> = {
  SL: 'text-violet-400',
  CL: 'text-cyan-400',
  PL: 'text-blue-400',
  LWP: 'text-orange-400',
};

export default function LeaveBalanceCards({ balances }: { balances: LeaveBalanceBreakdown[] }) {
  if (balances.length === 0) {
    return (
      <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl px-4 py-6 text-center text-[var(--text-muted)] text-sm">
        No leave balances found for this financial year yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {balances.map((b) => (
        <div key={b.code} className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4">
          <p className="text-[var(--text-muted)] text-xs mb-2">{b.label}</p>
          <p className={`text-2xl font-bold ${CARD_COLOR[b.code] ?? 'text-[var(--text-primary)]'}`}>
            {b.remaining.toFixed(1)}
            <span className="text-xs text-[var(--text-muted)] font-normal"> remaining</span>
          </p>
          <div className="flex justify-between text-[11px] text-[var(--text-muted)] mt-2">
            <span>Entitled {b.entitled.toFixed(1)}</span>
            <span>Used {b.used.toFixed(1)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}