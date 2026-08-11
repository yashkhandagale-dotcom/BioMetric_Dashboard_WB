'use client';

import ThemeToggle from '@/components/ThemeToggle';

// The theme toggle button used across every /leave/** page. Persists
// the choice back to the logged-in employee's row (so it follows them
// across devices/logins), via a PUT to app/api/leave/theme.
//
// Reading the saved value FROM the DB on mount used to also happen
// here, but that ran every time this component (rendered from
// LeaveShell) got remounted — which is every time you switch between
// /leave/me, /leave/approvals, /leave/team, /leave/admin, since those
// are separate layouts. That caused the theme to visibly flip on every
// tab switch. The one-time read now lives in LeaveThemeInit.tsx,
// mounted once in app/leave/layout.tsx (which doesn't remount on
// internal navigation) — this component only ever writes, never reads.
export default function LeaveThemeSync() {
  const syncToServer = (theme: 'dark' | 'light') => {
    fetch('/api/leave/theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
      // keepalive lets this request finish even if the toggle is
      // immediately followed by navigating away.
      keepalive: true,
    }).catch(() => {
      // Theme still applies locally via next-themes even if the server
      // sync fails (e.g. a transient network issue) — just won't follow
      // the employee to their next device until a later successful sync.
    });
  };

  return <ThemeToggle onChange={syncToServer} />;
}