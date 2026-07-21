import { SAVE_FEEDBACK, type SaveFeedbackKey } from "../../presentation/saveFeedback";

type Props = {
  state: "idle" | "saving" | "saved" | "queued" | "syncing" | "awaiting" | "failed";
  className?: string;
};

const STATE_LABEL: Record<Props["state"], SaveFeedbackKey | null> = {
  idle: null,
  saving: "saving",
  saved: "saved",
  queued: "addedToQueue",
  syncing: "syncing",
  awaiting: "awaitingSync",
  failed: "syncFailed",
};

export function SaveFeedback({ state, className = "" }: Props) {
  const key = STATE_LABEL[state];
  if (!key) return null;

  return (
    <span
      className={["inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ui-text-secondary)]", className].join(" ")}
      role="status"
      aria-live="polite"
    >
      {state === "saving" || state === "syncing" ? (
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden />
      ) : null}
      {SAVE_FEEDBACK[key]}
    </span>
  );
}
