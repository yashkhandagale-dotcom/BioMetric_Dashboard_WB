// Wraps every /leave/** route (admin, me, team, approvals, login,
// change-password) — Next.js nests each subtree's own layout.tsx (auth
// guards + the shared LeaveShell nav) inside this one. This file itself
// does NOT gate anything and does NOT render any chrome of its own.
//
// It used to also mount a full-width row containing nothing but the
// theme toggle, above every single /leave/** page (including the ones
// that already had their own header) — that stray bar was the "the
// dark/light toggle is taking up the whole header" issue: a full-bleed
// strip whose only content was one small icon button. The toggle now
// lives inside LeaveShell (sidebar footer on desktop, top bar on
// mobile), sized like the compact icon button it always was, so this
// layout has nothing left to render beyond the themed background.
export default function LeaveRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="bg-[var(--bg-surface)] min-h-screen">{children}</div>;
}
