import type { CSSProperties, ReactNode } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { bertCardEnter } from "./animationClasses";

type Props = {
  children: ReactNode;
  className?: string;
  /** Stagger index for dashboard card reveal (0-based). */
  index?: number;
  style?: CSSProperties;
  as?: "div" | "li" | "section" | "article";
};

/** Gentle appear once per mount — stagger via index, not scroll replay. */
export function AnimatedCard({ children, className = "", index = 0, style, as: Tag = "div" }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const staggerStyle: CSSProperties = reducedMotion
    ? style ?? {}
    : {
        ...style,
        animationDelay: `${Math.min(index, 12) * 45}ms`,
      };

  return (
    <Tag
      className={[className, reducedMotion ? "" : bertCardEnter].filter(Boolean).join(" ")}
      style={staggerStyle}
    >
      {children}
    </Tag>
  );
}
