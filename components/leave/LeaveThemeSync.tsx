'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import ThemeToggle from '@/components/ThemeToggle';

// Wraps the shared ThemeToggle for every /leave/** route: on mount, pulls
// the logged-in employee's saved theme_preference from the DB (via
// app/api/leave/theme) and applies it only when no local theme is already
// persisted. This avoids overwriting a user's resolved preference when
// they toggle theme from the Dashboard first.
export default function LeaveThemeSync() {
  const { setTheme } = useTheme();
  const appliedServerValue = useRef(false);

  useEffect(() => {
    if (appliedServerValue.current) return;
    appliedServerValue.current = true;

    const localTheme = typeof window !== 'undefined' ? window.localStorage.getItem('theme') : null;
    if (localTheme === 'dark' || localTheme === 'light') {
      return;
    }

    fetch('/api/leave/theme')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body?.theme === 'dark' || body?.theme === 'light') {
          setTheme(body.theme);
        }
      })
      .catch(() => {
        // Not logged in yet, or the fetch failed — fall back to whatever
        // next-themes already resolved locally. Not surfaced to the user.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncToServer = (theme: 'dark' | 'light') => {
    fetch('/api/leave/theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    }).catch(() => {
      // Theme still applies locally via next-themes even if the server
      // sync fails.
    });
  };

  return <ThemeToggle onChange={syncToServer} />;
}
