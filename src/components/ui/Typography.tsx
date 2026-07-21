import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../styles/ui-foundation";

type TextProps = HTMLAttributes<HTMLElement> & { children: ReactNode; as?: keyof HTMLElementTagNameMap };

export function PageTitle({ className, children, as: Tag = "h1", ...rest }: TextProps) {
  return (
    <Tag className={cn("text-xl font-semibold tracking-tight text-[var(--ui-text-primary)] sm:text-2xl", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function SectionTitle({ className, children, as: Tag = "h2", ...rest }: TextProps) {
  return (
    <Tag className={cn("text-lg font-semibold text-[var(--ui-text-primary)]", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardTitle({ className, children, as: Tag = "h3", ...rest }: TextProps) {
  return (
    <Tag className={cn("text-base font-semibold text-[var(--ui-text-primary)]", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function BodyText({ className, children, as: Tag = "p", ...rest }: TextProps) {
  return (
    <Tag className={cn("text-sm leading-6 text-[var(--ui-text-primary)]", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function SecondaryText({ className, children, as: Tag = "p", ...rest }: TextProps) {
  return (
    <Tag className={cn("text-sm leading-6 text-[var(--ui-text-secondary)]", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function LabelText({ className, children, as: Tag = "span", ...rest }: TextProps) {
  return (
    <Tag className={cn("text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-text-secondary)]", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CaptionText({ className, children, as: Tag = "span", ...rest }: TextProps) {
  return (
    <Tag className={cn("text-xs text-[var(--ui-text-muted)]", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function MetricValue({ className, children, as: Tag = "p", ...rest }: TextProps) {
  return (
    <Tag className={cn("text-3xl font-semibold tracking-tight text-[var(--ui-text-primary)]", className)} {...rest}>
      {children}
    </Tag>
  );
}
