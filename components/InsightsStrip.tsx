'use client';
import { useMemo } from 'react';
import { EmployeeSummary, DailyTrend, DeptAttendance, AttendanceRecord } from '@/lib/types';

interface InsightsStripProps {
  summaries: EmployeeSummary[];
  dailyTrend: DailyTrend[];
  deptAttendance: DeptAttendance[];
  records: AttendanceRecord[];
  selectedDepts: string[];
}

interface Insight {
  icon: string;
  text: string;
  type: 'warn' | 'info' | 'danger';
}

export default function InsightsStrip({ summaries, dailyTrend, deptAttendance, records, selectedDepts }: InsightsStripProps) {
  const insights: Insight[] = useMemo(() => {
    const result: Insight[] = [];

    if (selectedDepts.length === 0) {
      // 1. Dept with highest absenteeism
      const worstDept = [...deptAttendance].sort((a, b) => a.rate - b.rate)[0];
      if (worstDept && worstDept.rate < 70) {
        result.push({ icon: '⚠', text: `${worstDept.department} has the lowest attendance at ${worstDept.rate}% this period.`, type: 'warn' });
      }

      // 2. Employee with most late days
      const mostLate = [...summaries].sort((a, b) => b.lateCount - a.lateCount)[0];
      if (mostLate && mostLate.lateCount > 5) {
        result.push({ icon: '🕐', text: `${mostLate.employeeName} was late ${mostLate.lateCount} days — highest on the team.`, type: 'warn' });
      }

      // 3. Date with lowest attendance
      const lowestDay = [...dailyTrend].sort((a, b) => a.attendanceRate - b.attendanceRate)[0];
      if (lowestDay && lowestDay.attendanceRate < 70) {
        result.push({ icon: '📉', text: `Attendance dropped to ${lowestDay.attendanceRate}% on ${lowestDay.date} — check for events or issues.`, type: 'danger' });
      }

      // 4. Missing out-punches
      const missingOut = records.filter(r => {
        const s = r.status.toLowerCase();
        return s.includes('present') && !s.includes('absent') && (!r.outTime || r.outTime === '--');
      }).length;
      const presentTotal = records.filter(r => r.status.toLowerCase().includes('present') && !r.status.toLowerCase().includes('absent')).length;
      if (presentTotal > 0 && missingOut / presentTotal > 0.05) {
        result.push({ icon: '⚠', text: `${missingOut} employees have missing out-punch records this month. Durations for these records are unreliable.`, type: 'warn' });
      }

      // 5. Short days
      const shortDays = summaries.reduce((s, e) => s + e.shortDayCount, 0);
      if (shortDays > 0) {
        result.push({ icon: '🔴', text: `${shortDays} Short Day record${shortDays > 1 ? 's' : ''} detected — employees who exited within 5 minutes of arrival.`, type: 'danger' });
      }
    } else if (selectedDepts.length === 1) {
      const dept = selectedDepts[0];
      const deptData = deptAttendance.find(d => d.department === dept);
      const companyAvg = deptAttendance.length > 0 ? deptAttendance.reduce((s, d) => s + d.rate, 0) / deptAttendance.length : 0;
      if (deptData) {
        const diff = deptData.rate - companyAvg;
        result.push({
          icon: diff >= 0 ? '✅' : '⚠',
          text: `${dept} attendance: ${deptData.rate}% (${diff >= 0 ? '+' : ''}${diff.toFixed(1)}% vs company avg ${companyAvg.toFixed(1)}%)`,
          type: diff >= 0 ? 'info' : 'warn',
        });
      }
      const topAbsentee = summaries.filter(s => s.department === dept).sort((a, b) => b.absentDays - a.absentDays)[0];
      if (topAbsentee && topAbsentee.absentDays > 0) {
        result.push({ icon: '👤', text: `Top absentee in ${dept}: ${topAbsentee.employeeName} with ${topAbsentee.absentDays} absent days.`, type: 'info' });
      }
    } else if (selectedDepts.length >= 2) {
      const sorted = [...deptAttendance.filter(d => selectedDepts.includes(d.department))].sort((a, b) => b.rate - a.rate);
      if (sorted.length >= 2) {
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];
        const ratio = worst.rate > 0 ? (best.rate / worst.rate).toFixed(1) : '∞';
        result.push({ icon: '📊', text: `${best.department} (${best.rate}%) has ${ratio}× the attendance rate of ${worst.department} (${worst.rate}%) this period.`, type: 'info' });
      }
    }

    return result.slice(0, 3);
  }, [summaries, dailyTrend, deptAttendance, records, selectedDepts]);

  if (insights.length === 0) return null;

  const typeColors: Record<string, string> = {
    warn: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
    danger: 'bg-red-500/10 border-red-500/20 text-red-300',
    info: 'bg-blue-500/10 border-blue-500/20 text-blue-300',
  };

  return (
    <div className="space-y-2">
      <h3 className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Insights</h3>
      <div className="flex flex-col gap-2">
        {insights.map((insight, i) => (
          <div key={i} className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border text-sm ${typeColors[insight.type]}`}>
            <span className="text-base leading-none mt-0.5">{insight.icon}</span>
            <span className="leading-relaxed">{insight.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
