import { redirect } from 'next/navigation';

// Bulk Events moved from its own page into a modal (BulkEventsModal,
// triggered from the "Bulk Events" button on /leave/admin) — a full
// page navigation for what's a short, one-shot form was unnecessary.
// Kept as a redirect so any old bookmark/link still lands somewhere
// useful instead of 404ing.
export default function BulkEventsPageRedirect() {
  redirect('/leave/admin');
}
