import LeaveThemeSync from '@/components/leave/LeaveThemeSync';

// Wraps every /leave/** route (admin, me, team, approvals, login) —
// Next.js nests each subtree's own layout.tsx (auth guards) inside this
// one. This file itself does NOT gate anything; it only mounts the theme
// toggle once so it doesn't need to be added to every individual page.
// Deliberately not a full nav bar (no links) — that's Sprint B/C scope
// when the self-service/approval pages actually get built out; this is
// theme-foundation only.
//
// bg-[var(--bg-surface)] here isn't cosmetic — see globals.css's comment
// on --background/--foreground for why: without an explicit background,
// this strip fell through to <body>'s color, which used to be a
// hardcoded near-black regardless of theme (fixed there too, but this is
// the visible seam that made it obvious — a black bar above every Leave
// Tracker page's own themed content, un-affected by the toggle).
export default function LeaveRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="flex justify-end px-4 sm:px-6 pt-3 bg-[var(--bg-surface)]">
        <LeaveThemeSync />
      </div>
      {children}
    </>
  );
}
