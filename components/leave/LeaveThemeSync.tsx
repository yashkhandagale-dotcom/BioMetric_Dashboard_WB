'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import ThemeToggle from '@/components/ThemeToggle';

// Wraps the shared ThemeToggle for every /leave/** route: on mount, pulls
// the logged-in employee's saved theme_preference from the DB (via
// app/api/leave/theme) and applies it, so the choice follows them across
// devices/logins — not just this browser's next-themes localStorage copy.
// On every toggle click, also PUTs the new choice back to the same row.
export default function LeaveThemeSync() {
  const { setTheme } = useTheme();
  const appliedServerValue = useRef(false);

  useEffect(() => {
    if (appliedServerValue.current) return;
    appliedServerValue.current = true;
    fetch('/api/leave/theme')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body?.theme === 'dark' || body?.theme === 'light') {
          setTheme(body.theme);
        }
      })
      .catch(() => {
        // Not logged in yet, or the fetch failed — fall back to whatever
        // next-themes already resolved locally. Not surfaced to the user,
        // this is a best-effort sync for a cosmetic preference.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncToServer = (theme: 'dark' | 'light') => {
    fetch('/api/leave/theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
      // keepalive lets this request finish even if the toggle is
      // immediately followed by navigating away (before Link/<a> nav
      // conversion, that's exactly what caused the "reverts to dark on
      // navigation" bug: a full page reload could interrupt this PUT
      // mid-flight, so the next page's GET read the old DB value).
      keepalive: true,
    }).catch(() => {
      // Theme still applies locally via next-themes even if the server
      // sync fails (e.g. a transient network issue) — just won't follow
      // the employee to their next device until a later successful sync.
    });
  };

  return <ThemeToggle onChange={syncToServer} />;
}
