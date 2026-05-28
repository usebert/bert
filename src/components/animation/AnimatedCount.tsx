import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

type Props = {
  value: number;
  /** Animation duration in ms (default 600). */
  durationMs?: number;
  className?: string;
};

/** Counts from 0 → value on mount and when value changes; respects reduced motion. */
export function AnimatedCount({ value, durationMs = 600, className = "" }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const [display, setDisplay] = useState(reducedMotion ? value : 0);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (reducedMotion) {
      setDisplay(value);
      return;
    }

    fromRef.current = display;
    startRef.current = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(fromRef.current + (value - fromRef.current) * eased);
      setDisplay(next);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animate from current display on value change
  }, [value, durationMs, reducedMotion]);

  return <span className={["tabular-nums", className].filter(Boolean).join(" ")}>{display}</span>;
}
