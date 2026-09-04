'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';

// Pulls the logged-in employee's saved theme_preference from the DB
// (via app/api/leave/theme) ONCE per visit to the /leave section, and
// applies it via next-themes.
//
// Mounted a single time in app/leave/layout.tsx — the one layout that
// does NOT remount when navigating between /leave/me, /leave/approvals,
// /leave/team, /leave/admin, etc. (those are separate route segments,
// each with their own layout.tsx, so anything mounted inside THEM gets
// torn down and rebuilt on every switch between tabs).
//
// This used to live inside LeaveThemeSync, which was rendered from
// LeaveShell — itself re-instantiated by every one of those sub-layouts.
// That meant switching tabs re-ran this exact fetch-and-setTheme on
// every navigation, stomping whatever theme was already showing
// (including a theme just set on the Dashboard side, which never talks
// to this same DB value) — the "theme flips when I switch tabs" bug.
// Hoisting the fetch up here, so it only runs once per section-entry,
// fixes that. See LeaveThemeSync.tsx for the toggle button itself,
// which now only handles writing changes back, not reading on mount.
export default function LeaveThemeInit() {
  const { setTheme } = useTheme();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    fetch('/api/leave/theme')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        // Only override when the employee has an *explicitly saved* preference.
        // If the API returns null (no DB row set yet, not logged in, or DB error)
        // we leave next-themes alone — it will already have the correct value from
        // localStorage (which persists across Ctrl+Shift+R hard reloads).
        if (body?.theme === 'dark' || body?.theme === 'light') {
          setTheme(body.theme);
        }
      })
      .catch(() => {
        // Network failure — next-themes localStorage value stays active.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}