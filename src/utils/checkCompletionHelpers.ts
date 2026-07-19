import type { Answer, Audit, AuditQuestion } from "../types/reportsScreenProps";
import type { EvidenceItem } from "../types/dashboardScreenProps";
import type { PromptFollowUpAnswers } from "../types/promptRules";
import {
  getActivePromptRules,
  getPromptFollowUpActions,
  getPromptInstructionTexts,
  promptRuleEvidenceRequired,
} from "./promptRules";

export type CheckFieldType =
  | "Traffic light"
  | "Pass / Fail"
  | "Yes / No"
  | "Photo evidence"
  | "Text note"
  | "Short text"
  | "Paragraph"
  | "Number"
  | "Date"
  | "Single choice"
  | "Multiple choice";

export type CheckCompletionDraftSlice = {
  responses: Record<string, Answer>;
  textResponses: Record<string, string>;
  notes: Record<string, string>;
  evidence: Record<string, EvidenceItem[]>;
  promptFollowUps?: PromptFollowUpAnswers;
  questionIndex?: number;
};

export function resolveCheckFieldType(question: AuditQuestion): CheckFieldType {
  const raw = question.fieldType || "Traffic light";
  if (raw === "Text note") return "Short text";
  return raw as CheckFieldType;
}

export function isQuestionRequired(question: AuditQuestion): boolean {
  return question.required !== false;
}

export function isNegativeAnswer(answer: Answer | undefined): boolean {
  return answer === "fail" || answer === "nc";
}

export function getChoiceOptions(question: AuditQuestion): string[] {
  const fromPrompts = [
    ...(question.answerPrompts?.pass ?? []),
    ...(question.answerPrompts?.fail ?? []),
    ...(question.answerPrompts?.nc ?? []),
  ].filter(Boolean);
  if (fromPrompts.length > 0) {
    return fromPrompts;
  }
  if (resolveCheckFieldType(question) === "Yes / No") {
    return ["Yes", "No"];
  }
  return ["Option 1", "Option 2"];
}

export function mapChoiceToAnswer(question: AuditQuestion, choice: string): Answer {
  const failOptions = question.answerPrompts?.fail ?? [];
  const ncOptions = question.answerPrompts?.nc ?? [];
  if (failOptions.some((item) => item.toLowerCase() === choice.toLowerCase())) return "fail";
  if (ncOptions.some((item) => item.toLowerCase() === choice.toLowerCase())) return "nc";
  if (choice.toLowerCase() === "no") return "fail";
  if (choice.toLowerCase() === "yes") return "pass";
  return "pass";
}

/** Whether Pass / N/A may auto-advance after a local save (Fail never advances). */
export function canRapidAdvanceAfterAnswer(
  question: AuditQuestion,
  answer: Answer,
  draft: CheckCompletionDraftSlice,
): boolean {
  if (answer === "fail") return false;
  // Preserve existing required-photo rules for Pass; N/A ("nc") remains answered without photos.
  if (
    answer === "pass" &&
    question.requiresPhotoEvidence &&
    (draft.evidence[question.id]?.length ?? 0) === 0
  ) {
    return false;
  }
  return isQuestionAnswered(question, draft);
}

export function isQuestionAnswered(
  question: AuditQuestion,
  draft: CheckCompletionDraftSlice,
): boolean {
  const fieldType = resolveCheckFieldType(question);
  const answer = draft.responses[question.id];
  const text = (draft.textResponses[question.id] ?? "").trim();
  const photos = draft.evidence[question.id]?.length ?? 0;
  const promptFollowUps = draft.promptFollowUps ?? {};

  if (answer === "nc") return true;

  let baseAnswered = false;
  switch (fieldType) {
    case "Photo evidence":
      baseAnswered = photos > 0;
      break;
    case "Short text":
    case "Paragraph":
    case "Number":
    case "Date":
    case "Text note":
      baseAnswered = text.length > 0;
      break;
    case "Single choice":
      baseAnswered = text.length > 0;
      break;
    case "Multiple choice": {
      const selected = text.split("||").filter(Boolean);
      baseAnswered = selected.length > 0;
      break;
    }
    default:
      baseAnswered = Boolean(answer);
  }

  if (!baseAnswered) return false;

  const activeRules = getActivePromptRules(question, answer, draft.textResponses[question.id]);
  if (activeRules.length === 0) return true;

  for (const followUp of getPromptFollowUpActions(activeRules)) {
    if (followUp.required === false) continue;
    const value = String(promptFollowUps[question.id]?.[followUp.id] ?? "").trim();
    if (!value) return false;
  }

  if (promptRuleEvidenceRequired(activeRules)) {
    return photos > 0;
  }

  return true;
}

export function getUnansweredRequiredQuestions(
  audit: Audit,
  draft: CheckCompletionDraftSlice,
): AuditQuestion[] {
  return audit.questions.filter((question) => isQuestionRequired(question) && !isQuestionAnswered(question, draft));
}

export function getFailedQuestions(
  audit: Audit,
  draft: CheckCompletionDraftSlice,
): AuditQuestion[] {
  return audit.questions.filter((question) => isNegativeAnswer(draft.responses[question.id]));
}

export function getCompletionStats(audit: Audit, draft: CheckCompletionDraftSlice) {
  const answeredCount = audit.questions.filter((question) => isQuestionAnswered(question, draft)).length;
  const unansweredRequired = getUnansweredRequiredQuestions(audit, draft);
  const failed = getFailedQuestions(audit, draft);
  const evidenceCount = Object.values(draft.evidence).reduce((total, items) => total + items.length, 0);
  return {
    total: audit.questions.length,
    answeredCount,
    unansweredRequired,
    failed,
    evidenceCount,
  };
}

export function canSubmitCheck(audit: Audit, draft: CheckCompletionDraftSlice): boolean {
  return getUnansweredRequiredQuestions(audit, draft).length === 0;
}

export function formatAnswerLabel(answer: Answer | undefined): string {
  if (answer === "pass") return "Pass";
  if (answer === "fail") return "Fail";
  if (answer === "nc") return "N/A";
  return "Unanswered";
}

export function mergeTextIntoNotes(
  audit: Audit,
  responses: Record<string, Answer>,
  textResponses: Record<string, string>,
  notes: Record<string, string>,
): Record<string, string> {
  const merged = { ...notes };
  for (const question of audit.questions) {
    const fieldType = resolveCheckFieldType(question);
    const text = (textResponses[question.id] ?? "").trim();
    if (!text) continue;
    if (fieldType === "Short text" || fieldType === "Paragraph" || fieldType === "Number" || fieldType === "Date") {
      merged[question.id] = text;
    } else if (fieldType === "Single choice" || fieldType === "Multiple choice") {
      const prefix = merged[question.id]?.trim();
      merged[question.id] = prefix ? `${prefix}\nChoice: ${text.replace(/\|\|/g, ", ")}` : `Choice: ${text.replace(/\|\|/g, ", ")}`;
    }
    void responses;
  }
  return merged;
}

export function syncTextResponsesToAnswers(
  audit: Audit,
  responses: Record<string, Answer>,
  textResponses: Record<string, string>,
  evidence: Record<string, EvidenceItem[]>,
): Record<string, Answer> {
  const next = { ...responses };
  for (const question of audit.questions) {
    const fieldType = resolveCheckFieldType(question);
    if (fieldType === "Photo evidence") {
      if ((evidence[question.id]?.length ?? 0) > 0 && next[question.id] !== "nc") {
        next[question.id] = "pass";
      }
      continue;
    }
    const text = (textResponses[question.id] ?? "").trim();
    if (fieldType === "Single choice" && text) {
      next[question.id] = mapChoiceToAnswer(question, text);
      continue;
    }
    if (fieldType === "Multiple choice" && text) {
      const choices = text.split("||").filter(Boolean);
      const hasFail = choices.some((choice) => mapChoiceToAnswer(question, choice) === "fail");
      const hasNc = choices.some((choice) => mapChoiceToAnswer(question, choice) === "nc");
      next[question.id] = hasFail ? "fail" : hasNc ? "nc" : "pass";
      continue;
    }
    if (fieldType === "Short text" || fieldType === "Paragraph" || fieldType === "Number" || fieldType === "Date") {
      if (text) next[question.id] = "pass";
    }
  }
  return next;
}
