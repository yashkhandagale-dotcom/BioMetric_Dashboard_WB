import LeaveThemeSync from '@/components/leave/LeaveThemeSync';

// Wraps every /leave/** route (admin, me, team, approvals, login) —
// Next.js nests each subtree's own layout.tsx (auth guards) inside this
// one. This file itself does NOT gate anything; it only mounts the theme
// toggle once so it doesn't need to be added to every individual page.
// Deliberately not a full nav bar (no links) — that's Sprint B/C scope
// when the self-service/approval pages actually get built out; this is
// theme-foundation only.
export default function LeaveRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="flex justify-end px-4 sm:px-6 pt-3">
        <LeaveThemeSync />
      </div>
      {children}
    </>
  );
}
