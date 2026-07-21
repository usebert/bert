import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../styles/ui-foundation";

export type CardVariant = "default" | "interactive" | "muted" | "attention";

const cardVariantClasses: Record<CardVariant, string> = {
  default: "bg-[var(--ui-bg-surface)] border-[var(--ui-border)] shadow-[var(--ui-shadow-sm)]",
  interactive:
    "bg-[var(--ui-bg-surface)] border-[var(--ui-border)] shadow-[var(--ui-shadow-sm)] transition-[border-color,box-shadow,transform] duration-[var(--ui-transition)] hover:border-[var(--ui-border-strong)] hover:shadow-[var(--ui-shadow-md)] focus-within:border-[var(--ui-border-focus)]",
  muted: "bg-[var(--ui-bg-muted)] border-[var(--ui-border)] shadow-none",
  attention:
    "bg-[var(--ui-accent-subtle)] border-[color-mix(in_srgb,var(--ui-accent)_35%,var(--ui-border))] shadow-[var(--ui-shadow-sm)]",
};

export function Card({
  variant = "default",
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant }) {
  return (
    <div
      className={cn("rounded-[var(--ui-radius-md)] border p-4 sm:p-5", cardVariantClasses[variant], className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mb-3 flex flex-col gap-1", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("text-base font-semibold text-[var(--ui-text-primary)]", className)} {...rest}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, children, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm leading-6 text-[var(--ui-text-secondary)]", className)} {...rest}>
      {children}
    </p>
  );
}

export function CardContent({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-3", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mt-4 flex flex-wrap items-center gap-2", className)} {...rest}>
      {children}
    </div>
  );
}

export type CardShellProps = {
  variant?: CardVariant;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function CardShell({ variant, header, footer, children, className }: CardShellProps) {
  return (
    <Card variant={variant} className={className}>
      {header}
      <CardContent>{children}</CardContent>
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}
