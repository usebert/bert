import { SuccessTick } from "./SuccessTick";
import { StatusPulse } from "./StatusPulse";
import { bertSubmitSuccess } from "./animationClasses";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { queueAddedMessage, SUBMISSION_QUEUE_MESSAGES } from "../../utils/submissionQueueMessages";

type Props = {
  online: boolean;
  title: string;
  subtitle: string;
  queuedCount?: number;
  confirmed?: boolean;
  hasEvidence?: boolean;
};

export function SubmitResultBanner({ online, title, subtitle, queuedCount = 0, confirmed = false, hasEvidence = false }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const queuedMessage = queueAddedMessage({ online, hasEvidence });
  const successMessage = confirmed ? SUBMISSION_QUEUE_MESSAGES.success : queuedMessage;

  return (
    <div
      className={[
        "flex items-start gap-3 rounded-2xl border px-4 py-4",
        confirmed ? "border-emerald-200 bg-emerald-50/80" : "border-amber-200 bg-amber-50/90",
        reducedMotion ? "" : bertSubmitSuccess,
      ].join(" ")}
      role="status"
    >
      {confirmed ? (
        <SuccessTick className="h-11 w-11 text-base" label="Submitted successfully" />
      ) : (
        <StatusPulse
          state={queuedCount > 0 || !online ? "waiting" : "syncing"}
          label={queuedCount > 0 ? `${queuedCount} waiting to sync` : "Added to queue"}
          className="shrink-0"
        />
      )}
      <div className="min-w-0">
        <p className="text-base font-bold tracking-tight text-slate-900">
          {confirmed ? SUBMISSION_QUEUE_MESSAGES.success : "Added to queue"}
        </p>
        <p className="mt-0.5 text-sm font-semibold text-slate-800">{confirmed ? title : successMessage}</p>
        {!confirmed ? <p className="mt-1 text-sm text-slate-600">{subtitle || title}</p> : null}
      </div>
    </div>
  );
}
