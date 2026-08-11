'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';

// Workstream 2, step 2 — the toggle itself. Persistence for the
// attendance dashboard side is automatic (next-themes writes the choice
// to localStorage on its own, matching that app's existing no-backend
// design). The leave tracker needs the choice to follow an employee
// across devices/logins instead, so it wraps this component in
// components/leave/LeaveThemeSync.tsx and passes `onChange` to also
// write the choice to their employees row.
export default function ThemeToggle({
  onChange,
}: {
  onChange?: (theme: 'dark' | 'light') => void;
}) {
  const { theme, setTheme } = useTheme();
  // next-themes can't know the persisted theme until after hydration, so
  // rendering the icon before `mounted` risks a server/client mismatch
  // (this is the standard workaround the next-themes docs recommend).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const isDark = theme === 'dark';
  const next: 'dark' | 'light' = isDark ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => {
        setTheme(next);
        onChange?.(next);
      }}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex items-center justify-center p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:opacity-80 transition-opacity"
    >
      {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
    </button>
  );
}
