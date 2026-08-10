import { ReactNode } from 'react';

// Single source of truth for the top-of-page title block on every
// /leave/** page. Before this existed, each page hand-rolled its own
// h1 + optional "← Back to X" link + optional subtitle, each with
// slightly different classes/spacing/wording — the header looked
// different on every screen even though the underlying pattern (title,
// short description, a couple of primary actions on the right) was
// identical everywhere.
//
// The "← Back to ..." links are gone on purpose: navigation between
// Leave Tracker sections now lives permanently in LeaveShell's sidebar
// (desktop) / tab strip (mobile), so a per-page back link was redundant
// at best and, when a page landed on it from a different sidebar tab
// than the one that "back" pointed to, actively misleading.
export default function LeavePageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-7">
      <div className="min-w-0">
        <h1 className="text-[22px] sm:text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-[var(--text-muted)] mt-1.5 max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}
