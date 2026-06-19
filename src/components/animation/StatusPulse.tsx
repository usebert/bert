import type { ReactNode } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { SuccessTick } from "./SuccessTick";

export type SyncVisualState = "waiting" | "syncing" | "synced" | "failed" | "idle";

type Props = {
  state: SyncVisualState;
  label: string;
  className?: string;
};

function SyncSpinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        d="M12 3a9 9 0 1 0 9 9"
        strokeLinecap="round"
        className="bert-sync-spinner-stroke origin-center"
      />
    </svg>
  );
}

export function StatusPulse({ state, label, className = "" }: Props) {
  const reducedMotion = usePrefersReducedMotion();

  let indicator: ReactNode = null;
  if (state === "waiting") {
    indicator = (
      <span
        className={["h-2 w-2 rounded-full bg-amber-500", reducedMotion ? "" : "bert-status-pulse"].join(" ")}
        aria-hidden
      />
    );
  } else if (state === "syncing") {
    indicator = (
      <span className={["text-blue-700", reducedMotion ? "" : "bert-sync-spinner"].join(" ")} aria-hidden>
        <SyncSpinner />
      </span>
    );
  } else if (state === "synced") {
    indicator = <SuccessTick className="h-5 w-5" label="Synced" />;
  } else if (state === "failed") {
    indicator = (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-xs font-bold text-rose-700" aria-hidden>
        !
      </span>
    );
  }

  const toneClass =
    state === "failed"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : state === "synced"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : state === "syncing"
          ? "border-blue-200 bg-blue-50 text-blue-900"
          : state === "waiting"
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-slate-200 bg-white text-slate-700";

  return (
    <span
      className={[
        "inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-snug",
        toneClass,
        className,
      ].join(" ")}
    >
      {indicator}
      <span>{label}</span>
    </span>
  );
}
