import { AnimatedButton } from "../animation/AnimatedButton";
import type { CheckCompletionReviewProps } from "../../types/checkCompletion";
import {
  formatAnswerLabel,
  getCompletionStats,
  isNegativeAnswer,
  isQuestionAnswered,
  resolveCheckFieldType,
} from "../../utils/checkCompletionHelpers";
import { bertSecondaryButtonInteract } from "../../styles/interactions";

export function CheckCompletionReview({
  audit,
  responses,
  textResponses,
  notes,
  evidence,
  promptFollowUps,
  canSubmit,
  offlineMode,
  submitting = false,
  submitError,
  onJumpToQuestion,
  onBack,
  onSubmit,
}: CheckCompletionReviewProps) {
  const stats = getCompletionStats(audit, { responses, textResponses, notes, evidence, promptFollowUps });

  return (
    <div className="space-y-4 pb-28">
      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Review</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">{audit.name}</h2>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ReviewMetric label="Answered" value={`${stats.answeredCount}/${stats.total}`} />
          <ReviewMetric label="Required missing" value={String(stats.unansweredRequired.length)} tone={stats.unansweredRequired.length ? "warn" : "ok"} />
          <ReviewMetric label="Failed answers" value={String(stats.failed.length)} tone={stats.failed.length ? "warn" : "ok"} />
          <ReviewMetric label="Evidence" value={String(stats.evidenceCount)} />
        </div>
        {offlineMode ? (
          <p className="mt-3 text-sm font-medium text-amber-700">
            You are offline. Submit check will queue on this tablet until internet returns.
          </p>
        ) : null}
        {submitError ? (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900">
            {submitError}
          </p>
        ) : null}
        {submitting ? (
          <p className="mt-3 text-sm font-medium text-slate-600">Submitting your check…</p>
        ) : null}
      </section>

      {stats.unansweredRequired.length > 0 ? (
        <section className="rounded-[1.75rem] border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-950">Required questions still unanswered</p>
          <ul className="mt-3 space-y-2">
            {stats.unansweredRequired.map((question) => {
              const index = audit.questions.findIndex((item) => item.id === question.id);
              return (
                <li key={question.id} className="flex items-start justify-between gap-3 rounded-xl bg-white/70 px-3 py-2">
                  <p className="text-sm text-amber-950">{question.text}</p>
                  <button
                    type="button"
                    onClick={() => onJumpToQuestion(index)}
                    className="shrink-0 text-xs font-semibold text-amber-900 underline"
                  >
                    Jump
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2">
        {audit.questions.map((question, index) => {
          const answered = isQuestionAnswered(question, { responses, textResponses, notes, evidence, promptFollowUps });
          const answer = responses[question.id];
          const failed = isNegativeAnswer(answer);
          const fieldType = resolveCheckFieldType(question);
          const text = textResponses[question.id];
          const photoCount = evidence[question.id]?.length ?? 0;
          const followUpSummary = Object.entries(promptFollowUps[question.id] ?? {})
            .map(([, value]) => value)
            .filter(Boolean)
            .join(", ");
          return (
            <div
              key={question.id}
              className={[
                "rounded-2xl border p-4",
                failed ? "border-rose-200 bg-rose-50/60" : "border-slate-200 bg-white",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Q{index + 1}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{question.text}</p>
                  <p className="mt-2 text-xs text-slate-600">
                    {answered ? formatAnswerLabel(answer) : "Unanswered"}
                    {text && fieldType !== "Traffic light" && fieldType !== "Pass / Fail" && fieldType !== "Yes / No"
                      ? ` • ${text.replace(/\|\|/g, ", ")}`
                      : ""}
                    {photoCount ? ` • ${photoCount} photo(s)` : ""}
                    {followUpSummary ? ` • Follow-up: ${followUpSummary}` : ""}
                    {notes[question.id]?.trim() ? " • Note added" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onJumpToQuestion(index)}
                  className="shrink-0 text-xs font-semibold text-slate-700 underline"
                >
                  Edit
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-3">
          <AnimatedButton
            type="button"
            onClick={onBack}
            className={`min-h-[56px] flex-1 rounded-2xl border border-slate-300 bg-white text-base font-semibold text-slate-700 ${bertSecondaryButtonInteract}`}
          >
            Back
          </AnimatedButton>
          <AnimatedButton
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit || submitting}
            className={[
              "min-h-[56px] flex-[1.4] rounded-2xl text-base font-semibold text-white",
              canSubmit && !submitting ? "bg-slate-900" : "bg-slate-300",
            ].join(" ")}
          >
            {submitting ? "Submitting…" : "Submit check"}
          </AnimatedButton>
        </div>
      </div>
    </div>
  );
}

function ReviewMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-slate-900";
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
