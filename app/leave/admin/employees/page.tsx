import { redirect } from 'next/navigation';

// This page's content (employee grid, Add Employee form) was folded
// directly into /leave/admin — see that page's header comment for why.
// Kept as a redirect rather than deleting the route outright, in case
// anyone has this URL bookmarked or linked from elsewhere.
export default function EmployeesPageRedirect() {
  redirect('/leave/admin');
}