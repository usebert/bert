import type { SVGAttributes } from "react";
import { cn } from "../../styles/ui-foundation";

export type IconSize = "sm" | "md" | "lg";

const sizeClasses: Record<IconSize, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

type IconProps = SVGAttributes<SVGSVGElement> & {
  size?: IconSize;
};

/** Standardised stroke icon wrapper — single family (inline SVG, 24 viewBox). */
export function Icon({ size = "md", className, children, viewBox = "0 0 24 24", ...rest }: IconProps) {
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("inline-block shrink-0 align-middle", sizeClasses[size], className)}
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconSearch(props: Omit<IconProps, "children">) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Icon>
  );
}

export function IconCheck(props: Omit<IconProps, "children">) {
  return (
    <Icon {...props}>
      <path d="m5 12 4 4 10-10" />
    </Icon>
  );
}

export function IconAlert(props: Omit<IconProps, "children">) {
  return (
    <Icon {...props}>
      <path d="M12 4.75 20.25 19.25H3.75L12 4.75z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="16.35" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconInbox(props: Omit<IconProps, "children">) {
  return (
    <Icon {...props}>
      <path d="M4 6h16v12H4z" />
      <path d="M4 13h4l1.5 2h5L16 13h4" />
    </Icon>
  );
}

export function IconBell(props: Omit<IconProps, "children">) {
  return (
    <Icon {...props}>
      <path d="M12 3a5 5 0 0 0-5 5v2.2c0 .8-.3 1.6-.8 2.2L4.5 15.5A1 1 0 0 0 5.4 17H18.6a1 1 0 0 0 .9-1.5l-1.7-3.1a4 4 0 0 1-.8-2.2V8a5 5 0 0 0-5-5z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </Icon>
  );
}
