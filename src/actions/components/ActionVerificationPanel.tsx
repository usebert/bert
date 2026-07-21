import type { ActionItem } from "../../types/reportsScreenProps";
import { slatePrimaryCtaInteract } from "../../styles/interactions";

export function ActionVerificationPanel({
  action,
  onAcceptSuggestion,
  onEditSuggestion,
  onIgnoreSuggestion,
}: {
  action: ActionItem;
  onAcceptSuggestion: (actionId: string) => void;
  onEditSuggestion: (actionId: string) => void;
  onIgnoreSuggestion: (actionId: string) => void;
}) {
  if (action.suggestionStatus !== "suggested" || !action.suggestedActionTitle) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-900">Suggested fix</p>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 ring-1 ring-amber-200">
          Manager review required
        </span>
      </div>
      <p className="mt-2 text-base font-semibold text-slate-900">{action.suggestedActionTitle}</p>
      {action.suggestedActionDescription ? (
        <p className="mt-2 leading-relaxed text-slate-700">{action.suggestedActionDescription}</p>
      ) : null}
      {action.suggestionReason ? (
        <p className="mt-3 rounded-xl border border-amber-100 bg-white/80 px-3 py-2 text-slate-700">
          <span className="font-semibold text-slate-900">Why BERT suggested this. </span>
          {action.suggestionReason}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => onAcceptSuggestion(action.id)}
          className={`min-h-[44px] rounded-2xl bg-[var(--bert-signal-orange)] px-4 text-sm font-semibold text-[var(--qms-navy-950)] shadow-sm focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 ${slatePrimaryCtaInteract}`}
        >
          Use suggestion
        </button>
        <button
          type="button"
          onClick={() => onEditSuggestion(action.id)}
          className="min-h-[44px] rounded-2xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-950 focus-visible:outline focus-visible:ring-2 focus-visible:ring-amber-200"
        >
          Edit before assigning
        </button>
        <button
          type="button"
          onClick={() => onIgnoreSuggestion(action.id)}
          className="min-h-[44px] rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-300"
        >
          Ignore suggestion
        </button>
      </div>
    </section>
  );
}
