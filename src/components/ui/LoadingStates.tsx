import type { ReactNode } from "react";
import { cn } from "../../styles/ui-foundation";
import { Button } from "./Button";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-[var(--ui-radius-sm)] bg-[var(--ui-neutral-border)] motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function SkeletonLine({ className }: { className?: string }) {
  return <Skeleton className={cn("h-3 w-full", className)} />;
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] p-4", className)}>
      <Skeleton className="h-4 w-1/3" />
      <SkeletonLine />
      <SkeletonLine className="w-5/6" />
    </div>
  );
}

export function SkeletonTableRow({ columns = 4, className }: { columns?: number; className?: string }) {
  return (
    <div className={cn("flex gap-3 py-2", className)}>
      {Array.from({ length: columns }).map((_, index) => (
        <Skeleton key={index} className="h-4 flex-1" />
      ))}
    </div>
  );
}

export function SkeletonMetric({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-24" />
    </div>
  );
}

export function InlineLoading({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm text-[var(--ui-text-secondary)]", className)} role="status">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />
      {label}
    </span>
  );
}

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--ui-radius-md)] border border-dashed border-[var(--ui-border-strong)] bg-[var(--ui-bg-muted)] px-4 py-6 text-center sm:px-6",
        className,
      )}
    >
      {icon ? <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center text-[var(--ui-text-muted)]">{icon}</div> : null}
      <p className="text-sm font-semibold text-[var(--ui-text-primary)]">{title}</p>
      {description ? <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ui-text-secondary)]">{description}</p> : null}
      {(primaryAction || secondaryAction) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {secondaryAction ? (
            <Button variant="outline" size="default" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          ) : null}
          {primaryAction ? (
            <Button variant="primary" size="default" onClick={primaryAction.onClick}>
              {primaryAction.label}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
