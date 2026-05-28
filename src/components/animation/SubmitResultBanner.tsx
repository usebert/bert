import { SuccessTick } from "./SuccessTick";
import { StatusPulse } from "./StatusPulse";

type Props = {
  online: boolean;
  title: string;
  subtitle: string;
  queuedCount?: number;
};

export function SubmitResultBanner({ online, title, subtitle, queuedCount = 0 }: Props) {
  return (
    <div className="bert-fade-in flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      {online ? (
        <SuccessTick className="h-10 w-10" label="Submitted" />
      ) : (
        <StatusPulse
          state="waiting"
          label={queuedCount > 0 ? `${queuedCount} waiting to sync` : "Saved on tablet"}
          className="shrink-0"
        />
      )}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{online ? "Submitted" : "Saved on this tablet"}</p>
        <p className="mt-0.5 text-sm text-slate-600">{title}</p>
        <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        {!online && queuedCount > 0 ? (
          <p className="mt-2 text-xs font-medium text-amber-800">{queuedCount} check{queuedCount === 1 ? "" : "s"} in the sync queue</p>
        ) : null}
      </div>
    </div>
  );
}
