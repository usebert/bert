import type { Role } from "../../permissions";
import { getRoleTheme } from "../../config/roleTheme";

const STEPS = ["Provision", "Evaluate", "Action", "Verify", "Report"] as const;

type ControlLoopStripProps = {
  /** Index 0–4 of the highlighted “current” step (role accent). Earlier steps show a blue check. */
  currentStepIndex: number;
  tone?: "onDark" | "onLight";
  className?: string;
  role?: Role;
};

function StepCheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function deriveControlLoopState(input: {
  workspaceLinked: boolean;
  hasAssignedAudits: boolean;
  openOrInProgressActions: number;
  awaitingVerificationCount: number;
  recentCompletionCount: number;
}): { currentStepIndex: number } {
  const { workspaceLinked, hasAssignedAudits, openOrInProgressActions, awaitingVerificationCount, recentCompletionCount } = input;

  if (!workspaceLinked) {
    return { currentStepIndex: 0 };
  }
  if (!hasAssignedAudits) {
    return { currentStepIndex: 1 };
  }
  if (openOrInProgressActions > 0) {
    return { currentStepIndex: 2 };
  }
  if (awaitingVerificationCount > 0) {
    return { currentStepIndex: 3 };
  }
  if (recentCompletionCount > 0) {
    return { currentStepIndex: 4 };
  }
  return { currentStepIndex: 2 };
}

export function ControlLoopStrip({ currentStepIndex, tone = "onDark", className = "", role = "Manager" }: ControlLoopStripProps) {
  const onLight = tone === "onLight";
  const theme = getRoleTheme(role);

  return (
    <ol
      className={`mt-3 flex list-none flex-wrap items-center gap-x-1 gap-y-2 text-[11px] font-medium sm:gap-x-2 ${onLight ? "text-slate-600" : "text-slate-500"} ${className}`.trim()}
      aria-label="Quality control loop"
    >
      {STEPS.map((label, index) => {
        const done = index < currentStepIndex;
        const current = index === currentStepIndex;

        const shell = onLight
          ? current
            ? theme.controlLoopCurrentOnLight
            : done
              ? "border-sky-200 bg-sky-50 text-sky-900 ring-1 ring-sky-200/80"
              : "border-slate-200 bg-slate-100 text-slate-500 ring-1 ring-slate-200/60"
          : current
            ? theme.controlLoopCurrentOnDark
            : done
              ? "border-sky-400/50 bg-sky-500/10 text-sky-100 ring-1 ring-sky-400/30"
              : "border-slate-500/30 bg-slate-950/35 text-slate-400 ring-1 ring-white/5";

        return (
          <li key={label} className="flex items-center gap-1 sm:gap-2">
            {index > 0 ? (
              <span className={`px-0.5 sm:px-1 ${onLight ? "text-slate-400" : "text-slate-500"}`} aria-hidden>
                →
              </span>
            ) : null}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${shell}`.trim()}
              aria-current={current ? "step" : undefined}
            >
              {done ? (
                <span className={onLight ? "text-sky-600" : "text-sky-300"} title="Completed">
                  <StepCheckIcon className="h-3.5 w-3.5 shrink-0" />
                </span>
              ) : current ? (
                <span className={`h-2 w-2 shrink-0 rounded-full ${theme.controlLoopCurrentDot}`} aria-hidden />
              ) : (
                <span className={`h-2 w-2 shrink-0 rounded-full ${onLight ? "bg-slate-300" : "bg-slate-500/70"}`} aria-hidden />
              )}
              <span className={current || done ? "font-semibold" : "font-medium"}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
