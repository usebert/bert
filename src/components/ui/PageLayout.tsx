import type { ReactNode } from "react";
import { cn } from "../../styles/ui-foundation";

export function PageContainer({
  children,
  fullWidth = false,
  className,
}: {
  children: ReactNode;
  fullWidth?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-[var(--ui-page-padding-x)] py-[var(--ui-page-padding-y)]",
        !fullWidth && "max-w-[var(--ui-page-max-width)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryActions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mb-4 flex flex-col gap-3 border-b border-[var(--ui-border)] pb-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ui-text-muted)]">{eyebrow}</p>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-[var(--ui-text-primary)] sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm leading-6 text-[var(--ui-text-secondary)]">{description}</p> : null}
      </div>
      {(primaryAction || secondaryActions) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || description || actions) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="text-lg font-semibold text-[var(--ui-text-primary)]">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-[var(--ui-text-secondary)]">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

export function Toolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] p-3 sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      {children}
    </div>
  );
}
