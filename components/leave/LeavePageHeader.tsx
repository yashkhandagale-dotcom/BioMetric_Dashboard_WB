import { ReactNode } from 'react';

export default function LeavePageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-7">
      <div className="min-w-0 flex items-start gap-3">
        {icon && (
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-[22px] sm:text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-[var(--text-muted)] mt-1.5 max-w-2xl leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}