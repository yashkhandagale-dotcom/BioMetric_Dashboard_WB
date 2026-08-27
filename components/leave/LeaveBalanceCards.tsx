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

const CARD_STYLE: Record<string, { accent: string; bg: string; bar: string; icon: string }> = {
  SL: {
    accent: 'text-violet-600 dark:text-violet-300',
    bg: 'bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/25',
    bar: 'bg-violet-500',
    icon: '🏥',
  },
  CL: {
    accent: 'text-cyan-600 dark:text-cyan-300',
    bg: 'bg-cyan-50 dark:bg-cyan-500/10 border-cyan-200 dark:border-cyan-500/25',
    bar: 'bg-cyan-500',
    icon: '🌴',
  },
  PL: {
    accent: 'text-orange-600 dark:text-orange-300',
    bg: 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/25',
    bar: 'bg-orange-500',
    icon: '📅',
  },
  LWP: {
    accent: 'text-rose-600 dark:text-rose-300',
    bg: 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/25',
    bar: 'bg-rose-500',
    icon: '⚠️',
  },
};

export default function LeaveBalanceCards({ balances }: { balances: LeaveBalanceBreakdown[] }) {
  return (
    <div
      className="border border-[var(--border)] rounded-2xl p-5 space-y-4 h-full shadow-md"
      style={{ background: 'linear-gradient(160deg, var(--bg-card) 0%, var(--bg-elevated) 100%)' }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--text-primary)] tracking-tight">Leave Balances</h2>
        <span className="text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border)] px-2 py-0.5 rounded-full font-medium">
          FY {new Date().getFullYear()}–{String(new Date().getFullYear() + 1).slice(-2)}
        </span>
      </div>
      {balances.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
          <span className="text-3xl">📋</span>
          <p className="text-[var(--text-muted)] text-sm font-medium">No leave balances yet</p>
          <p className="text-[var(--text-dim)] text-xs">Balances appear once seeded for this financial year.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {balances.map((b) => {
            const style = CARD_STYLE[b.code] ?? CARD_STYLE.SL;
            const usedPct = b.entitled > 0 ? Math.min(100, (b.used / b.entitled) * 100) : 0;
            return (
              <div key={b.code} className={`rounded-xl p-3.5 border ${style.bg}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{style.icon}</span>
                    <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{b.label}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-2xl font-black tabular-nums leading-none ${style.accent}`}>
                      {b.remaining.toFixed(1)}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] font-medium ml-1">left</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 bg-[var(--bg-surface)] rounded-full overflow-hidden mb-2">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${style.bar}`}
                    style={{ width: `${usedPct}%` }}
                  />
                </div>

                <div className="flex justify-between text-[11px] text-[var(--text-muted)]">
                  <span>Entitled: <strong className="text-[var(--text-primary)]">{b.entitled.toFixed(1)}</strong></span>
                  <span>Used: <strong className="text-[var(--text-primary)]">{b.used.toFixed(1)}</strong></span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}