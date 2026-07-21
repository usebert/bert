import type { NavItemId } from "../../types/navigation";
import type { OnboardingStep } from "../../hooks/useOnboardingChecklist";
import { Button } from "../ui/Button";

type Props = {
  steps: OnboardingStep[];
  completed: number;
  total: number;
  percent: number;
  onNavigate: (screen: NavItemId) => void;
  onDismiss: () => void;
};

export function OnboardingChecklistCard({ steps, completed, total, percent, onNavigate, onDismiss }: Props) {
  if (percent >= 100) {
    return null;
  }

  return (
    <section className="rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] p-4 shadow-sm motion-reduce:transition-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]">Getting started</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--ui-text-primary)]">Set up your company workspace</h2>
          <p className="mt-1 text-sm text-[var(--ui-text-secondary)]">
            {completed} of {total} required steps complete ({percent}%)
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-11 rounded-full px-3 text-xs font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)]"
        >
          Dismiss
        </button>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--ui-bg-muted)]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-[var(--bert-signal-orange)] transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>

      <ol className="mt-4 space-y-2">
        {steps.map((step) => (
          <li
            key={step.id}
            className={[
              "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5",
              step.done ? "border-emerald-200 bg-emerald-50/70" : "border-[var(--ui-border)] bg-[var(--ui-bg-muted)]",
            ].join(" ")}
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--ui-text-primary)]">
                <span aria-hidden className="mr-2">
                  {step.done ? "✓" : "○"}
                </span>
                {step.title}
                {step.optional ? <span className="ml-1 text-xs font-medium text-[var(--ui-text-muted)]">(optional)</span> : null}
              </p>
              {!step.done ? <p className="mt-0.5 text-xs text-[var(--ui-text-secondary)]">{step.description}</p> : null}
            </div>
            {!step.done ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onNavigate(step.screen)}>
                Continue
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
