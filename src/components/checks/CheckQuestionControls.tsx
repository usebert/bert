import { AnimatedButton } from "../animation/AnimatedButton";
import { EvidenceUploadChoice } from "../evidence/EvidenceUploadChoice";
import type { CheckQuestionControlsProps } from "../../types/checkCompletion";
import type { Answer } from "../../types/reportsScreenProps";
import {
  getChoiceOptions,
  isNegativeAnswer,
  mapChoiceToAnswer,
  resolveCheckFieldType,
} from "../../utils/checkCompletionHelpers";
import {
  getActivePromptRules,
  getPromptEscalateActions,
  getPromptFollowUpActions,
  getPromptInstructionTexts,
  promptRuleEvidenceRequired,
} from "../../utils/promptRules";

export function CheckQuestionControls({
  question,
  questionNumber,
  responses,
  textResponses,
  notes,
  evidence,
  promptFollowUps,
  slatePrimaryCtaInteract,
  onAnswerChange,
  onTextResponseChange,
  onNoteChange,
  onPromptFollowUpChange,
  onAddEvidence,
  onRemoveEvidence,
}: CheckQuestionControlsProps) {
  const fieldType = resolveCheckFieldType(question);
  const answer = responses[question.id];
  const questionEvidence = evidence[question.id] ?? [];
  const showFailedFollowUp = isNegativeAnswer(answer) && (question.promptRules?.length ?? 0) === 0;
  const activePromptRules = getActivePromptRules(question, answer, textResponses[question.id]);
  const promptInstructions = getPromptInstructionTexts(activePromptRules);
  const promptFollowUpActions = getPromptFollowUpActions(activePromptRules);
  const promptEscalations = getPromptEscalateActions(activePromptRules);
  const promptEvidenceRequired = promptRuleEvidenceRequired(activePromptRules);
  const questionPromptAnswers = promptFollowUps[question.id] ?? {};

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Question {questionNumber}
          {question.required !== false ? " • Required" : ""}
        </p>
        <p className="mt-2 text-xl font-semibold leading-snug text-slate-900">{question.text}</p>
      </div>

      <AnswerControls
        fieldType={fieldType}
        question={question}
        answer={answer}
        textValue={textResponses[question.id] ?? ""}
        evidenceCount={questionEvidence.length}
        onAnswerChange={onAnswerChange}
        onTextResponseChange={onTextResponseChange}
      />

      {activePromptRules.length > 0 ? (
        <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/80 p-4">
          <p className="text-sm font-semibold text-sky-950">Follow-up prompts</p>
          {promptInstructions.map((instruction, index) => (
            <p key={`instruction-${index}`} className="text-sm text-sky-900">
              {instruction}
            </p>
          ))}
          {promptFollowUpActions.map((followUp) => (
            <label key={followUp.id} className="block text-sm font-semibold text-sky-950">
              {followUp.label}
              {followUp.inputType === "number" ? (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={questionPromptAnswers[followUp.id] ?? ""}
                    onChange={(event) => onPromptFollowUpChange(question.id, followUp.id, event.target.value)}
                    className="min-h-[48px] w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                  />
                  {followUp.unit ? <span className="text-sm text-sky-800">{followUp.unit}</span> : null}
                </div>
              ) : followUp.inputType === "paragraph" ? (
                <textarea
                  value={questionPromptAnswers[followUp.id] ?? ""}
                  onChange={(event) => onPromptFollowUpChange(question.id, followUp.id, event.target.value)}
                  className="mt-2 min-h-[5rem] w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                />
              ) : (
                <input
                  type="text"
                  value={questionPromptAnswers[followUp.id] ?? ""}
                  onChange={(event) => onPromptFollowUpChange(question.id, followUp.id, event.target.value)}
                  className="mt-2 min-h-[48px] w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                />
              )}
            </label>
          ))}
          {promptEscalations.map((escalate, index) =>
            escalate.message ? (
              <p key={`escalate-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
                {escalate.message}
              </p>
            ) : null,
          )}
          {promptEvidenceRequired ? (
            <div className="rounded-xl border border-sky-200 bg-white p-3">
              <p className="text-xs font-semibold text-sky-900">Evidence required for this prompt</p>
              <p className="mt-1 text-xs text-sky-800">
                Use Add photo below. {questionEvidence.length} photo(s) attached.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {showFailedFollowUp ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4">
          <p className="text-sm font-semibold text-rose-900">Follow-up required</p>
          <p className="mt-1 text-xs text-rose-800">
            Add a brief note{question.requiresPhotoEvidence ? " and photo evidence" : ""} for this finding.
          </p>
          <textarea
            value={notes[question.id] ?? ""}
            onChange={(event) => onNoteChange(question.id, event.target.value)}
            placeholder="Add note"
            className="mt-3 min-h-[5rem] w-full rounded-xl border border-rose-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-rose-400"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-rose-800">{questionEvidence.length} photo(s)</span>
            {question.autoActionRequired ? (
              <span className="rounded-full bg-rose-100 px-2 py-1 text-[11px] font-semibold text-rose-800">
                Action required
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <EvidencePanel
        questionId={question.id}
        items={questionEvidence}
        slatePrimaryCtaInteract={slatePrimaryCtaInteract}
        onAddEvidence={onAddEvidence}
        onRemoveEvidence={onRemoveEvidence}
      />
    </div>
  );
}

function AnswerControls({
  fieldType,
  question,
  answer,
  textValue,
  evidenceCount,
  onAnswerChange,
  onTextResponseChange,
}: {
  fieldType: ReturnType<typeof resolveCheckFieldType>;
  question: CheckQuestionControlsProps["question"];
  answer: Answer | undefined;
  textValue: string;
  evidenceCount: number;
  onAnswerChange: (questionId: string, answer: Answer) => void;
  onTextResponseChange: (questionId: string, value: string) => void;
}) {
  const markNa = () => onAnswerChange(question.id, "nc");

  if (fieldType === "Yes / No") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <ChoiceButton label="Yes" selected={answer === "pass"} onClick={() => onAnswerChange(question.id, "pass")} />
        <ChoiceButton label="No" selected={answer === "fail"} onClick={() => onAnswerChange(question.id, "fail")} />
        <NaButton onClick={markNa} selected={answer === "nc"} />
      </div>
    );
  }

  if (fieldType === "Pass / Fail") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <ChoiceButton label="Pass" selected={answer === "pass"} tone="green" onClick={() => onAnswerChange(question.id, "pass")} />
        <ChoiceButton label="Fail" selected={answer === "fail"} tone="red" onClick={() => onAnswerChange(question.id, "fail")} />
        <NaButton onClick={markNa} selected={answer === "nc"} />
      </div>
    );
  }

  if (fieldType === "Traffic light") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ChoiceButton label="Pass" selected={answer === "pass"} tone="green" onClick={() => onAnswerChange(question.id, "pass")} />
        <ChoiceButton label="No Conformance" selected={answer === "nc"} tone="amber" onClick={() => onAnswerChange(question.id, "nc")} />
        <ChoiceButton label="Fail" selected={answer === "fail"} tone="red" onClick={() => onAnswerChange(question.id, "fail")} />
      </div>
    );
  }

  if (fieldType === "Single choice") {
    const options = getChoiceOptions(question);
    return (
      <div className="grid gap-2">
        {options.map((option) => (
          <ChoiceButton
            key={option}
            label={option}
            selected={textValue === option}
            onClick={() => {
              onTextResponseChange(question.id, option);
              onAnswerChange(question.id, mapChoiceToAnswer(question, option));
            }}
          />
        ))}
        <NaButton onClick={markNa} selected={answer === "nc"} />
      </div>
    );
  }

  if (fieldType === "Multiple choice") {
    const options = getChoiceOptions(question);
    const selected = new Set(textValue.split("||").filter(Boolean));
    return (
      <div className="grid gap-2">
        {options.map((option) => {
          const isSelected = selected.has(option);
          return (
            <ChoiceButton
              key={option}
              label={option}
              selected={isSelected}
              onClick={() => {
                if (isSelected) selected.delete(option);
                else selected.add(option);
                const next = Array.from(selected).join("||");
                onTextResponseChange(question.id, next);
                if (next) {
                  const choices = next.split("||").filter(Boolean);
                  const hasFail = choices.some((choice) => mapChoiceToAnswer(question, choice) === "fail");
                  const hasNc = choices.some((choice) => mapChoiceToAnswer(question, choice) === "nc");
                  onAnswerChange(question.id, hasFail ? "fail" : hasNc ? "nc" : "pass");
                } else {
                  onAnswerChange(question.id, "pass");
                }
              }}
            />
          );
        })}
        <NaButton onClick={markNa} selected={answer === "nc"} />
      </div>
    );
  }

  if (fieldType === "Paragraph") {
    return (
      <textarea
        value={textValue}
        onChange={(event) => onTextResponseChange(question.id, event.target.value)}
        placeholder="Enter your answer"
        className="min-h-[8rem] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
      />
    );
  }

  if (fieldType === "Number") {
    return (
      <input
        type="number"
        inputMode="decimal"
        value={textValue}
        onChange={(event) => onTextResponseChange(question.id, event.target.value)}
        placeholder="Enter a number"
        className="min-h-[52px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-400"
      />
    );
  }

  if (fieldType === "Date") {
    return (
      <input
        type="date"
        value={textValue}
        onChange={(event) => onTextResponseChange(question.id, event.target.value)}
        className="min-h-[52px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-400"
      />
    );
  }

  if (fieldType === "Photo evidence") {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-900">Photo or file evidence</p>
        <p className="mt-1 text-xs text-slate-500">{evidenceCount} file(s) attached</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <NaButton onClick={markNa} selected={answer === "nc"} />
        </div>
      </div>
    );
  }

  return (
    <input
      type="text"
      value={textValue}
      onChange={(event) => onTextResponseChange(question.id, event.target.value)}
      placeholder="Enter your answer"
      className="min-h-[52px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-400"
    />
  );
}

function EvidencePanel({
  questionId,
  items,
  slatePrimaryCtaInteract,
  onAddEvidence,
  onRemoveEvidence,
}: {
  questionId: string;
  items: CheckQuestionControlsProps["evidence"][string];
  slatePrimaryCtaInteract: string;
  onAddEvidence: (questionId: string, files: FileList) => void;
  onRemoveEvidence: (questionId: string, evidenceId: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">Evidence</p>
        <EvidenceUploadChoice
          triggerLabel="Add photo"
          triggerClassName={`min-h-[48px] rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
          onFiles={(files) => onAddEvidence(questionId, files)}
        />
      </div>
      {items.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {items.map((item) => (
            <div key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {/\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(item.name) ? (
                <img src={item.previewUrl} alt={item.name} className="h-24 w-full object-cover" />
              ) : (
                <div className="flex h-24 items-center justify-center bg-slate-100 px-3">
                  <p className="truncate text-xs font-semibold text-slate-600">{item.name}</p>
                </div>
              )}
              <div className="p-2">
                <p className="truncate text-xs font-semibold text-slate-900">{item.name}</p>
                <button
                  type="button"
                  onClick={() => onRemoveEvidence(questionId, item.id)}
                  className="mt-1 text-[11px] font-semibold text-rose-600"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChoiceButton({
  label,
  selected,
  tone,
  onClick,
}: {
  label: string;
  selected: boolean;
  tone?: "green" | "amber" | "red";
  onClick: () => void;
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-600 bg-emerald-600 text-white"
      : tone === "amber"
        ? "border-amber-500 bg-amber-500 text-white"
        : tone === "red"
          ? "border-rose-600 bg-rose-600 text-white"
          : selected
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-200 bg-slate-50 text-slate-900";

  return (
    <AnimatedButton
      type="button"
      onClick={onClick}
      className={`min-h-[56px] rounded-2xl border px-4 text-base font-semibold ${toneClass}`}
    >
      {label}
    </AnimatedButton>
  );
}

function NaButton({ onClick, selected }: { onClick: () => void; selected: boolean }) {
  return (
    <AnimatedButton
      type="button"
      onClick={onClick}
      className={[
        "min-h-[48px] rounded-2xl border px-4 text-sm font-semibold",
        selected ? "border-slate-700 bg-slate-700 text-white" : "border-slate-200 bg-white text-slate-700",
      ].join(" ")}
    >
      Mark N/A
    </AnimatedButton>
  );
}
