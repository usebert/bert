import type { AuditBuilderTemplateDraft } from "../types/auditBuilder";
import type { Answer, Audit, AuditQuestion } from "../types/reportsScreenProps";
import type {
  PromptFollowUpAnswers,
  PromptRule,
  PromptRuleAction,
  PromptRuleEscalateAction,
  PromptRuleFinding,
  PromptRuleFollowUpAction,
} from "../types/promptRules";
import { resolveCheckFieldType } from "./checkCompletionHelpers";

export const FRIDGE_PROMPT_EXAMPLE: AuditBuilderTemplateDraft = {
  template_name: "Fridge temperature check",
  description: "Example template with conditional prompts when the fridge door has been open too long.",
  category: "Health & Safety",
  sections: [
    {
      name: "Cold storage",
      questions: [
        {
          question_text: "Has the fridge door been open for more than 15 minutes?",
          answer_type: "yes_no",
          options: ["Yes", "No"],
          requires_comment_on_failure: false,
          requires_action_on_failure: false,
          allows_photo_evidence: false,
          prompt_rules: [
            {
              when: { operator: "equals" as const, value: "Yes" },
              actions: [
                {
                  type: "followUpQuestion" as const,
                  id: "temperature",
                  label: "What is the temperature?",
                  inputType: "number" as const,
                  unit: "°C",
                  required: true,
                },
                {
                  type: "instruction" as const,
                  text: "Close the fridge door and check again in 15 minutes.",
                },
                {
                  type: "escalate" as const,
                  message: "If temperature is outside safe range, alert a manager.",
                  managerReview: true,
                  safeMin: 0,
                  safeMax: 5,
                  followUpId: "temperature",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export function normalizePromptRules(raw: unknown): PromptRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: PromptRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const when = (entry as PromptRule).when;
    const triggerValue = String(when?.value ?? "").trim();
    if (!triggerValue) continue;
    const actions = normalizePromptRuleActions((entry as PromptRule).actions);
    if (actions.length === 0) continue;
    rules.push({
      when: { operator: "equals", value: triggerValue },
      actions,
    });
  }
  return rules;
}

function normalizePromptRuleActions(raw: unknown): PromptRuleAction[] {
  if (!Array.isArray(raw)) return [];
  const actions: PromptRuleAction[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const type = String((entry as { type?: string }).type || "").trim();
    if (type === "instruction") {
      const text = String((entry as { text?: string }).text || "").trim();
      if (text) actions.push({ type: "instruction", text });
      continue;
    }
    if (type === "followUpQuestion") {
      const id = String((entry as { id?: string }).id || "").trim() || `follow-up-${actions.length + 1}`;
      const label = String((entry as { label?: string }).label || "").trim();
      if (!label) continue;
      const inputType = String((entry as { inputType?: string }).inputType || "text").trim();
      const normalizedInputType =
        inputType === "number" || inputType === "paragraph" || inputType === "short_text" ? inputType : "text";
      actions.push({
        type: "followUpQuestion",
        id,
        label,
        inputType: normalizedInputType,
        unit: String((entry as { unit?: string }).unit || "").trim() || undefined,
        required: (entry as { required?: boolean }).required !== false,
      });
      continue;
    }
    if (type === "escalate") {
      const message = String((entry as { message?: string }).message || "").trim();
      if (!message) continue;
      const safeMin = (entry as { safeMin?: number }).safeMin;
      const safeMax = (entry as { safeMax?: number }).safeMax;
      actions.push({
        type: "escalate",
        message,
        managerReview: Boolean((entry as { managerReview?: boolean }).managerReview),
        evidenceRequired: Boolean((entry as { evidenceRequired?: boolean }).evidenceRequired),
        followUpId: String((entry as { followUpId?: string }).followUpId || "").trim() || undefined,
        safeMin: Number.isFinite(safeMin) ? Number(safeMin) : undefined,
        safeMax: Number.isFinite(safeMax) ? Number(safeMax) : undefined,
      });
    }
  }
  return actions;
}

export function resolveTriggerAnswerLabel(
  question: AuditQuestion,
  answer: Answer | undefined,
  textResponse?: string,
): string {
  const trimmedText = String(textResponse ?? "").trim();
  if (trimmedText) return trimmedText;
  if (resolveCheckFieldType(question) === "Yes / No") {
    if (answer === "pass") return "Yes";
    if (answer === "fail") return "No";
  }
  if (resolveCheckFieldType(question) === "Pass / Fail") {
    if (answer === "pass") return question.answerPrompts?.pass?.[0] || "Pass";
    if (answer === "fail") return question.answerPrompts?.fail?.[0] || "Fail";
    if (answer === "nc") return question.answerPrompts?.nc?.[0] || "N/A";
  }
  if (answer === "pass") return question.answerPrompts?.pass?.[0] || "Yes";
  if (answer === "fail") return question.answerPrompts?.fail?.[0] || "No";
  if (answer === "nc") return question.answerPrompts?.nc?.[0] || "N/A";
  return "";
}

export function getActivePromptRules(
  question: AuditQuestion,
  answer: Answer | undefined,
  textResponse?: string,
): PromptRule[] {
  const rules = question.promptRules ?? [];
  if (rules.length === 0 || !answer || answer === "nc") return [];
  const label = resolveTriggerAnswerLabel(question, answer, textResponse);
  if (!label) return [];
  return rules.filter((rule) => rule.when.value.toLowerCase() === label.toLowerCase());
}

export function getPromptFollowUpActions(rules: PromptRule[]): PromptRuleFollowUpAction[] {
  return rules.flatMap((rule) =>
    rule.actions.filter((action): action is PromptRuleFollowUpAction => action.type === "followUpQuestion"),
  );
}

export function getPromptInstructionTexts(rules: PromptRule[]): string[] {
  return rules
    .flatMap((rule) => rule.actions)
    .filter((action) => action.type === "instruction")
    .map((action) => action.text)
    .filter(Boolean);
}

export function getPromptEscalateActions(rules: PromptRule[]): PromptRuleEscalateAction[] {
  return rules.flatMap((rule) =>
    rule.actions.filter((action): action is PromptRuleEscalateAction => action.type === "escalate"),
  );
}

export function promptRuleEvidenceRequired(rules: PromptRule[]): boolean {
  return getPromptEscalateActions(rules).some((action) => action.evidenceRequired);
}

function shouldEscalateForManagerReview(
  escalate: PromptRuleEscalateAction,
  followUpAnswers: Record<string, string>,
): boolean {
  if (!escalate.managerReview) return false;
  const hasRange = escalate.safeMin != null || escalate.safeMax != null;
  if (!hasRange || !escalate.followUpId) return true;
  const raw = String(followUpAnswers[escalate.followUpId] ?? "").trim();
  const value = Number(raw);
  if (!Number.isFinite(value)) return false;
  const min = escalate.safeMin ?? Number.NEGATIVE_INFINITY;
  const max = escalate.safeMax ?? Number.POSITIVE_INFINITY;
  return value < min || value > max;
}

export function buildPromptRuleFindings(
  audit: Audit,
  responses: Record<string, Answer>,
  textResponses: Record<string, string>,
  promptFollowUps: PromptFollowUpAnswers,
  mergedNotes: Record<string, string>,
): PromptRuleFinding[] {
  const findings: PromptRuleFinding[] = [];
  for (const question of audit.questions) {
    const answer = responses[question.id];
    const activeRules = getActivePromptRules(question, answer, textResponses[question.id]);
    if (activeRules.length === 0) continue;
    const followUpAnswers = promptFollowUps[question.id] ?? {};
    for (const escalate of getPromptEscalateActions(activeRules)) {
      if (!shouldEscalateForManagerReview(escalate, followUpAnswers)) continue;
      findings.push({
        questionId: question.id,
        questionText: question.text,
        answer: resolveTriggerAnswerLabel(question, answer, textResponses[question.id]),
        note: mergedNotes[question.id] || "",
        requiresManagerReview: true,
        escalationMessage: escalate.message,
        source: "promptRule",
      });
    }
  }
  return findings;
}

export function buildCheckAnswersPayload(input: {
  responses: Record<string, Answer>;
  notes: Record<string, string>;
  promptFollowUps: PromptFollowUpAnswers;
  evidenceIds?: Record<string, string[]>;
}): Record<string, unknown> {
  return {
    responses: input.responses,
    notes: input.notes,
    promptFollowUps: input.promptFollowUps,
    ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
  };
}

export function countPromptRuleIssues(findings: PromptRuleFinding[]): number {
  return findings.filter((finding) => finding.requiresManagerReview).length;
}
