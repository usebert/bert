import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { AnimatedButton } from "../components/animation/AnimatedButton";
import { SuccessTick } from "../components/animation/SuccessTick";
import { bertFieldComplete, bertGuidancePanel, bertScreenEnter } from "../components/animation/animationClasses";
import { usePrefersReducedMotion } from "../components/animation/usePrefersReducedMotion";
import { StatusBadge } from "../components/dashboard/DashboardPrimitives";
import type { AuditModeScreenProps } from "../types/auditModeScreenProps";
import type { Answer } from "../types/reportsScreenProps";
import { getAuditTrafficStatus, getDueWarning } from "../utils/dashboardHealth";
import { darkPanelDescription, darkPanelEyebrow, darkPanelShell, darkPanelTitleLg } from "../styles/darkPanel";
import { getPlainEnglishSyncStatus } from "../utils/plainEnglishSync";
import { EvidenceUploadChoice } from "../components/evidence/EvidenceUploadChoice";
import { bertSecondaryButtonInteract } from "../styles/interactions";

export function AuditModeScreen({
  audit,
  responses,
  notes,
  evidence,
  evidenceDebugLabel,
  questionIndex,
  offlineMode,
  pendingSyncCount,
  failedSyncCount,
  slatePrimaryCtaInteract,
  onAnswerSelect,
  onJumpToQuestion,
  onNoteChange,
  onAddEvidence,
  onComplete,
  onSaveAndExit,
}: AuditModeScreenProps) {
  const { t } = useTranslation();
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const showEvidenceGuidance = (questionId: string) => {
    const answer = responses[questionId];
    return (answer === "fail" || answer === "nc") && (evidence[questionId]?.length ?? 0) === 0;
  };

  if (audit.questions.length === 0) {
    return (
        <div className="space-y-4">
          <section className={darkPanelShell}>
            <p className={darkPanelEyebrow}>{t("audits.auditMode")}</p>
            <h2 className={darkPanelTitleLg}>{audit.name}</h2>
            <p className={["mt-1", darkPanelDescription].join(" ")}>{getDueWarning(audit.dueHours)}</p>
          </section>
          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-base font-semibold text-slate-900">{t("audits.noQuestionsAvailable")}</p>
            <p className="mt-1 text-sm text-slate-300">{t("audits.saveAndExitHint")}</p>
            <AnimatedButton
              type="button"
              onClick={onSaveAndExit}
              className={`mt-4 h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 ${bertSecondaryButtonInteract}`}
            >
              {t("audits.saveAndExit")}
            </AnimatedButton>
          </section>
        </div>
    );
  }
  const safeIndex = Math.max(0, Math.min(questionIndex, audit.questions.length - 1));
  const currentQuestion = audit.questions[safeIndex];
  const answeredCount = audit.questions.filter((question) => Boolean(responses[question.id])).length;
  const syncPlain = getPlainEnglishSyncStatus({
    offlineQueueCount: 0,
    pendingSyncCount,
    failedSyncCount,
  });
  const syncBadgeClass =
    syncPlain.tone === "problem"
      ? "bg-rose-100 text-rose-800"
      : syncPlain.tone === "waiting"
        ? "bg-amber-100 text-amber-800"
        : "bg-emerald-50 text-emerald-900";
  const syncLabel = syncPlain.summary;
  const options: Answer[] = currentQuestion.fieldType === "Traffic light" ? ["pass", "nc", "fail"] : ["pass", "fail", "nc"];
  const needsEvidencePanel = showEvidenceGuidance(currentQuestion.id);

  return (
      <div key={`audit-${audit.id}-q${safeIndex}`} className={reducedMotion ? "space-y-4" : ["space-y-4", bertScreenEnter].join(" ")}>
        <section className={darkPanelShell}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={darkPanelEyebrow}>{t("audits.auditMode")}</p>
              <h2 className={darkPanelTitleLg}>{audit.name}</h2>
              <p className={["mt-1", darkPanelDescription].join(" ")}>{getDueWarning(audit.dueHours)}</p>
            </div>
            <StatusBadge status={getAuditTrafficStatus(audit.dueHours)} dark />
          </div>
          <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3">
            <p className="text-sm font-semibold">{t("audits.questionProgress", { current: safeIndex + 1, total: audit.questions.length })}</p>
            <div className="mt-2 h-2 rounded-full bg-white/15">
              <div className="h-2 rounded-full bg-white transition-all duration-200" style={{ width: `${(answeredCount / audit.questions.length) * 100}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-300">{t("audits.answeredCount", { count: answeredCount })}</p>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t("audits.riskLevel", { level: currentQuestion.riskLevel || "Medium" })}</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">{currentQuestion.text}</p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {options.map((option) => {
              const selected = responses[currentQuestion.id] === option;
              const complete = selected && (option === "pass" || (evidence[currentQuestion.id]?.length ?? 0) > 0);
              return (
                <AnimatedButton
                  key={option}
                  type="button"
                  onClick={() => onAnswerSelect(currentQuestion, option)}
                  className={[
                    "relative h-16 rounded-2xl border text-lg font-semibold",
                    selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-900",
                    complete && !reducedMotion ? bertFieldComplete : "",
                  ].join(" ")}
                >
                  {complete ? (
                    <span className="absolute right-2 top-2">
                      <SuccessTick className="h-5 w-5" label={t("audits.answerComplete")} />
                    </span>
                  ) : null}
                  {option === "pass" ? t("audits.pass") : option === "nc" ? t("audits.noConformance") : t("audits.fail")}
                </AnimatedButton>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <AnimatedButton
              type="button"
              onClick={() => noteInputRef.current?.focus()}
              className={`h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 ${bertSecondaryButtonInteract}`}
            >
              {t("audits.addNote")}
            </AnimatedButton>
            <EvidenceUploadChoice
              triggerLabel={t("audits.uploadEvidence")}
              triggerClassName={`min-h-[48px] rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
              onFiles={(files) => onAddEvidence(currentQuestion.id, files)}
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <textarea
            ref={noteInputRef}
            value={notes[currentQuestion.id] || ""}
            onChange={(event) => onNoteChange(currentQuestion.id, event.target.value)}
            placeholder={t("audits.addNotePlaceholder")}
            className="min-h-[7rem] rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-slate-400"
          />
          {needsEvidencePanel ? (
            <div
              className={[
                "flex min-h-[7rem] flex-col justify-center rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-4 py-4",
                "border-l-4 border-l-amber-500",
                !reducedMotion ? bertGuidancePanel : "",
              ].join(" ")}
            >
              <p className="text-sm font-semibold text-amber-950">{t("audits.photoEvidenceGuidanceTitle")}</p>
              <p className="mt-1 text-sm leading-relaxed text-amber-900">{t("audits.photoEvidenceGuidanceBody")}</p>
              <div className="mt-4">
                <EvidenceUploadChoice
                  triggerLabel={t("audits.uploadEvidence")}
                  triggerClassName={`min-h-[48px] rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
                  onFiles={(files) => onAddEvidence(currentQuestion.id, files)}
                />
              </div>
            </div>
          ) : (
            <div className="flex min-h-[7rem] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4">
              <EvidenceUploadChoice
                triggerLabel={t("audits.uploadEvidence")}
                triggerClassName={`min-h-[48px] rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
                onFiles={(files) => onAddEvidence(currentQuestion.id, files)}
              />
            </div>
          )}
          </div>
          <p className="mt-2 text-xs text-slate-500">{t("audits.photosAttached", { count: evidence[currentQuestion.id]?.length || 0 })}</p>
          {evidenceDebugLabel && <p className="mt-1 text-xs text-sky-700">{evidenceDebugLabel}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <AnimatedButton
              type="button"
              onClick={onSaveAndExit}
              className={`h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 ${bertSecondaryButtonInteract}`}
            >
              {t("audits.saveAndExit")}
            </AnimatedButton>
            <AnimatedButton
              type="button"
              showArrow
              onClick={() => {
                if (safeIndex === audit.questions.length - 1) onComplete();
                else onJumpToQuestion(safeIndex + 1);
              }}
              className={`h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
            >
              {safeIndex === audit.questions.length - 1 ? t("audits.completeAudit") : t("audits.nextQuestion")}
            </AnimatedButton>
            <div className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${syncBadgeClass}`}>{syncLabel}</div>
          </div>
          {offlineMode && <p className="mt-3 text-sm font-medium text-amber-700">{t("audits.offlineSavedTablet")}</p>}
        </section>
      </div>
  );
}
