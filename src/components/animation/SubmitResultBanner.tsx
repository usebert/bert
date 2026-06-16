import { SuccessTick } from "./SuccessTick";
import { StatusPulse } from "./StatusPulse";
import { bertSubmitSuccess } from "./animationClasses";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

type Props = {
  online: boolean;
  title: string;
  subtitle: string;
  queuedCount?: number;
};

export function SubmitResultBanner({ online, title, subtitle, queuedCount = 0 }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const successMessage = online ? "Check saved successfully." : subtitle;
  const offlineSyncMessage =
    !online && queuedCount > 0
      ? `${queuedCount} check${queuedCount === 1 ? "" : "s"} queued — will sync when online`
      : !online
        ? "It will sync automatically when internet returns."
        : null;

  return (
    <div
      className={[
        "flex items-start gap-3 rounded-2xl border px-4 py-4",
        online ? "border-emerald-200 bg-emerald-50/80" : "border-amber-200 bg-amber-50/90",
        reducedMotion ? "" : bertSubmitSuccess,
      ].join(" ")}
      role="status"
    >
      {online ? (
        <SuccessTick className="h-11 w-11 text-base" label="Submitted" />
      ) : (
        <StatusPulse
          state={queuedCount > 0 ? "waiting" : "synced"}
          label={queuedCount > 0 ? `${queuedCount} waiting to sync` : "Saved on tablet"}
          className="shrink-0"
        />
      )}
      <div className="min-w-0">
        <p className="text-base font-bold tracking-tight text-slate-900">{online ? "Submitted" : "Saved on this tablet"}</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-800">{online ? successMessage : title}</p>
        {!online ? (
          <>
            <p className="mt-1 text-sm text-slate-600">{successMessage}</p>
            {offlineSyncMessage ? <p className="mt-2 text-xs font-semibold text-amber-900">{offlineSyncMessage}</p> : null}
          </>
        ) : (
          <p className="mt-1 text-xs text-slate-600">{title}</p>
        )}
      </div>
    </div>
  );
}
