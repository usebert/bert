import type { ReactNode } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { bertSectionEnter } from "./animationClasses";

type Props = {
  screenKey: string;
  children: ReactNode;
  className?: string;
};

/** Subtle fade + slide on screen changes. Key must change when the visible screen changes. */
export function AnimatedScreen({ screenKey, children, className = "" }: Props) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div
      key={screenKey}
      className={[reducedMotion ? "" : bertSectionEnter, className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}
