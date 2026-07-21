import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedButton } from "../animation/AnimatedButton";
import { AnimatedScreen } from "../animation/AnimatedScreen";
import { StatusBadge } from "../dashboard/DashboardPrimitives";
import { bertScreenEnter } from "../animation/animationClasses";
import { usePrefersReducedMotion } from "../animation/usePrefersReducedMotion";
import type { CheckCompletionPhase, CheckCompletionWizardProps } from "../../types/checkCompletion";
import type { Answer } from "../../types/reportsScreenProps";
import { getAuditTrafficStatus, getDueWarning } from "../../utils/dashboardHealth";
import { getPlainEnglishSyncStatus } from "../../utils/plainEnglishSync";
import {
  canRapidAdvanceAfterAnswer,
  canSubmitCheck,
  getCompletionStats,
} from "../../utils/checkCompletionHelpers";
import { darkPanelDescription, darkPanelEyebrow, darkPanelShell, darkPanelTitleLg } from "../../styles/darkPanel";
import { bertSecondaryButtonInteract } from "../../styles/interactions";
import { CheckQuestionControls } from "./CheckQuestionControls";
import { CheckCompletionReview } from "./CheckCompletionReview";
import { AuditCentreBackButton } from "../auditCentre/AuditCentreBackButton";
import { AuditProgress } from "../../audits/components/AuditProgress";
import { AuditQuestionNavigator } from "../../audits/components/AuditQuestionNavigator";

export function CheckCompletionWizard({
  audit,
  responses,
  textResponses,
  notes,
  evidence,
  promptFollowUps,
  questionIndex,
  offlineMode,
  pendingSyncCount,
  failedSyncCount,
  savedAt,
  slatePrimaryCtaInteract,
  onQuestionIndexChange,
  onAnswerChange,
  onTextResponseChange,
  onNoteChange,
  onPromptFollowUpChange,
  onAddEvidence,
  onRemoveEvidence,
  onSaveAndExit,
  onSubmit,
  onBackToAuditCentre,
  submitting = false,
  submitError,
}: CheckCompletionWizardProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<CheckCompletionPhase>("questions");
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const rapidAnswerLockRef = useRef(false);
  const safeIndex = Math.max(0, Math.min(questionIndex, Math.max(audit.questions.length - 1, 0)));
  const currentQuestion = audit.questions[safeIndex];
  const draftSlice = useMemo(
    () => ({ responses, textResponses, notes, evidence, promptFollowUps }),
    [responses, textResponses, notes, evidence, promptFollowUps],
  );
  const stats = getCompletionStats(audit, draftSlice);

  // Release after the question index transition has been applied (or after Back/Next).
  useEffect(() => {
    rapidAnswerLockRef.current = false;
  }, [questionIndex]);

  const handleAnswerChange = (questionId: string, answer: Answer) => {
    if (rapidAnswerLockRef.current) return;
    rapidAnswerLockRef.current = true;

    // Capture before any index change so the answer cannot land on the next question.
    const answeredQuestionId = questionId;
    const answeredIndex = safeIndex;
    const answeredQuestion = currentQuestion;

    onAnswerChange(answeredQuestionId, answer);

    if (!answeredQuestion || answeredQuestionId !== answeredQuestion.id || answer === "fail") {
      rapidAnswerLockRef.current = false;
      return;
    }

    const nextDraft = {
      ...draftSlice,
      responses: { ...draftSlice.responses, [answeredQuestionId]: answer },
    };
    if (!canRapidAdvanceAfterAnswer(answeredQuestion, answer, nextDraft)) {
      rapidAnswerLockRef.current = false;
      return;
    }

    const nextIndex = Math.min(answeredIndex + 1, audit.questions.length - 1);
    if (nextIndex === answeredIndex) {
      rapidAnswerLockRef.current = false;
      return;
    }

    onQuestionIndexChange(nextIndex);
    // Lock stays set until questionIndex updates (see effect above).
  };
  const syncPlain = getPlainEnglishSyncStatus({ offlineQueueCount: 0, pendingSyncCount, failedSyncCount });

  if (audit.questions.length === 0) {
    return (
      <div className="space-y-4">
        <section className={darkPanelShell}>
          <p className={darkPanelEyebrow}>Check completion</p>
          <h2 className={darkPanelTitleLg}>{audit.name}</h2>
          <p className={["mt-1", darkPanelDescription].join(" ")}>No questions are available for this check.</p>
        </section>
        <AnimatedButton type="button" onClick={onSaveAndExit} className={`h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 ${bertSecondaryButtonInteract}`}>
          Save &amp; exit
        </AnimatedButton>
      </div>
    );
  }

  if (phase === "review") {
    return (
      <AnimatedScreen screenKey={`check-review-${audit.id}`}>
        {onBackToAuditCentre ? (
          <div className="mb-4">
            <AuditCentreBackButton onClick={onBackToAuditCentre} />
          </div>
        ) : null}
        <CheckCompletionReview
          audit={audit}
          responses={responses}
          textResponses={textResponses}
          notes={notes}
          evidence={evidence}
          promptFollowUps={promptFollowUps}
          canSubmit={canSubmitCheck(audit, draftSlice)}
          offlineMode={offlineMode}
          submitting={submitting}
          submitError={submitError}
          onJumpToQuestion={(index) => {
            onQuestionIndexChange(index);
            setPhase("questions");
          }}
          onBack={() => {
            onQuestionIndexChange(audit.questions.length - 1);
            setPhase("questions");
          }}
          onSubmit={onSubmit}
        />
      </AnimatedScreen>
    );
  }

  return (
    <AnimatedScreen screenKey={`check-wizard-${audit.id}-q${safeIndex}`}>
      <div className={reducedMotion ? "space-y-4 pb-28" : ["space-y-4 pb-28", bertScreenEnter].join(" ")}>
        {onBackToAuditCentre ? <AuditCentreBackButton onClick={onBackToAuditCentre} /> : null}
        <section className={darkPanelShell}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className={darkPanelEyebrow}>Check completion</p>
              <h2 className={darkPanelTitleLg}>{audit.name}</h2>
              <p className={["mt-1", darkPanelDescription].join(" ")}>
                {[audit.siteArea, getDueWarning(audit.dueHours)].filter(Boolean).join(" • ")}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <AuditQuestionNavigator
                audit={audit}
                draft={{ responses, textResponses, notes, evidence, promptFollowUps }}
                currentIndex={safeIndex}
                open={navigatorOpen}
                onToggle={() => setNavigatorOpen((current) => !current)}
                onJump={onQuestionIndexChange}
              />
              <StatusBadge status={getAuditTrafficStatus(audit.dueHours)} dark />
            </div>
          </div>
          <div className="mt-4">
            <AuditProgress
              current={safeIndex + 1}
              total={audit.questions.length}
              answered={stats.answeredCount}
              savedAt={savedAt ?? undefined}
              syncLabel={syncPlain.summary}
              offlineMode={offlineMode}
            />
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
          <CheckQuestionControls
            question={currentQuestion}
            questionNumber={safeIndex + 1}
            responses={responses}
            textResponses={textResponses}
            notes={notes}
            evidence={evidence}
            promptFollowUps={promptFollowUps}
            slatePrimaryCtaInteract={slatePrimaryCtaInteract}
            onAnswerChange={handleAnswerChange}
            onTextResponseChange={onTextResponseChange}
            onNoteChange={onNoteChange}
            onPromptFollowUpChange={onPromptFollowUpChange}
            onAddEvidence={onAddEvidence}
            onRemoveEvidence={onRemoveEvidence}
          />
        </section>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl gap-3">
            <AnimatedButton
              type="button"
              onClick={() => onQuestionIndexChange(Math.max(0, safeIndex - 1))}
              disabled={safeIndex === 0}
              className={`min-h-[56px] flex-1 rounded-2xl border border-slate-300 bg-white text-base font-semibold text-slate-700 disabled:opacity-40 ${bertSecondaryButtonInteract}`}
            >
              Back
            </AnimatedButton>
            {safeIndex === audit.questions.length - 1 ? (
              <AnimatedButton
                type="button"
                showArrow
                onClick={() => setPhase("review")}
                className={`min-h-[56px] flex-[1.4] rounded-2xl bg-slate-900 text-base font-semibold text-white ${slatePrimaryCtaInteract}`}
              >
                Review
              </AnimatedButton>
            ) : (
              <AnimatedButton
                type="button"
                showArrow
                onClick={() => onQuestionIndexChange(Math.min(audit.questions.length - 1, safeIndex + 1))}
                className={`min-h-[56px] flex-[1.4] rounded-2xl bg-slate-900 text-base font-semibold text-white ${slatePrimaryCtaInteract}`}
              >
                Next
              </AnimatedButton>
            )}
          </div>
          <div className="mx-auto mt-2 flex max-w-3xl justify-between gap-3">
            <button type="button" onClick={onSaveAndExit} className="text-sm font-semibold text-slate-600 underline">
              Save &amp; exit
            </button>
          </div>
        </div>
      </div>
    </AnimatedScreen>
  );
}
