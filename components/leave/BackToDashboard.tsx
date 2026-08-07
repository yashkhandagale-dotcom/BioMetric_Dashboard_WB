import { ArrowLeft } from 'lucide-react';

// Single source of truth for the "← Back to Dashboard" link so every
// /leave/** page looks and behaves the same way (Phase 6 of the UI
// audit): same position, same styling, keyboard-accessible, visible
// in both themes, with a small hover animation.
export default function BackToDashboard({ className = '' }: { className?: string }) {
  return (
    <a
      href="/"
      className={`inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-md ${className}`}
    >
      <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
      Back to Dashboard
    </a>
  );
}
