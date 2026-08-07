import { redirect } from 'next/navigation';

// Single-login pivot: there is now only ONE login page, at /login (see
// its own comment, and middleware.ts's header comment, for why). This
// route is kept only so old bookmarks/emails/deep-links pointing at
// /leave/login (and anything that redirects a logged-out visitor here —
// e.g. app/leave/*/layout.tsx guards) still land somewhere useful,
// instead of 404ing or dead-ending on a page that used to have its own
// separate sign-in form. Any `?next=` is preserved so a deep link into
// e.g. /leave/approvals still returns there after signing in once.
export default async function LeaveLoginRedirect({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
}
