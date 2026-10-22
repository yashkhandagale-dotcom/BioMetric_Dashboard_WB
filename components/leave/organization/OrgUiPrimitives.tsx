import React from 'react';
import { roleColor, ROLE_LABEL, initials } from './orgTypes';

export function Avatar({ name, role }: { name: string; role: string }) {
  const c = roleColor(role);
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-[10px] font-bold shrink-0"
      style={{ background: c.bg, color: c.text }}
    >
      {initials(name)}
    </span>
  );
}

export function RoleChip({ role }: { role: string }) {
  const c = roleColor(role);
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 whitespace-nowrap"
      style={{ background: c.bg, color: c.text }}
    >
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

export function StatCard({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{
        borderColor: warn ? 'rgba(251,146,60,0.35)' : 'var(--border)',
        background: warn ? 'rgba(251,146,60,0.08)' : 'var(--bg-elevated)',
      }}
    >
      <div className="text-xl font-extrabold tabular-nums" style={{ color: warn ? 'var(--accent)' : 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
    </div>
  );
}

export function Select({
  value,
  onChange,
  disabled,
  saving,
  children,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  saving?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative w-full min-w-[9rem]">
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="appearance-none w-full rounded-lg pl-3 pr-8 py-2 text-xs font-medium cursor-pointer transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-wait truncate"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          colorScheme: 'dark',
        }}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path d="M2.5 4.5L6 8l3.5-3.5" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {saving && (
        <span
          className="absolute -right-1 -top-1 w-2 h-2 rounded-full animate-pulse"
          style={{ background: 'var(--accent)' }}
        />
      )}
    </div>
  );
}
