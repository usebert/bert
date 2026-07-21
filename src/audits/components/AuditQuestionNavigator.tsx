import type { Audit, Answer } from "../../types/reportsScreenProps";
import type { EvidenceItem } from "../../types/dashboardScreenProps";
import type { PromptFollowUpAnswers } from "../../types/promptRules";
import { isNegativeAnswer, isQuestionAnswered } from "../../utils/checkCompletionHelpers";
import { Button } from "../../components/ui/Button";

type AuditDraftSlice = {
  responses: Record<string, Answer>;
  textResponses: Record<string, string>;
  notes: Record<string, string>;
  evidence: Record<string, EvidenceItem[]>;
  promptFollowUps: PromptFollowUpAnswers;
};

type QuestionState = "answered" | "unanswered" | "failed" | "evidence";

function questionState(
  question: Audit["questions"][number],
  draft: AuditDraftSlice,
): QuestionState {
  const answer = draft.responses[question.id];
  if (isNegativeAnswer(answer)) return "failed";
  if (!isQuestionAnswered(question, draft)) return "unanswered";
  if (question.requiresPhotoEvidence && (draft.evidence[question.id]?.length ?? 0) === 0 && answer === "pass") {
    return "evidence";
  }
  return "answered";
}

const stateLabel: Record<QuestionState, string> = {
  answered: "Answered",
  unanswered: "Unanswered",
  failed: "Failed",
  evidence: "Needs evidence",
};

export function AuditQuestionNavigator({
  audit,
  draft,
  currentIndex,
  open,
  onToggle,
  onJump,
}: {
  audit: Audit;
  draft: AuditDraftSlice;
  currentIndex: number;
  open: boolean;
  onToggle: () => void;
  onJump: (index: number) => void;
}) {
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={onToggle} aria-expanded={open}>
        Questions
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="presentation" onClick={onToggle}>
          <aside
            className="h-full w-full max-w-sm overflow-y-auto border-l border-[var(--ui-border)] bg-[var(--ui-bg-surface)] p-4 shadow-xl"
            role="dialog"
            aria-label="Question navigator"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-[var(--ui-text-primary)]">Questions</h2>
              <Button type="button" variant="ghost" size="sm" onClick={onToggle}>
                Close
              </Button>
            </div>
            <ol className="space-y-2">
              {audit.questions.map((question, index) => {
                const state = questionState(question, draft);
                const selected = index === currentIndex;
                return (
                  <li key={question.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onJump(index);
                        onToggle();
                      }}
                      className={[
                        "flex w-full flex-col gap-1 rounded-[var(--ui-radius-sm)] border px-3 py-2 text-left",
                        selected
                          ? "border-[var(--ui-border-focus)] bg-[var(--ui-bg-muted)]"
                          : "border-[var(--ui-border)] bg-white",
                      ].join(" ")}
                    >
                      <span className="text-xs font-semibold text-[var(--ui-text-muted)]">Q{index + 1}</span>
                      <span className="text-sm font-medium text-[var(--ui-text-primary)]">{question.text}</span>
                      <span className="text-xs text-[var(--ui-text-secondary)]">{stateLabel[state]}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>
        </div>
      ) : null}
    </>
  );
}
