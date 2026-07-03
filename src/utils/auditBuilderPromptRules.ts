import type { AuditBuilderQuestion, AuditBuilderSection } from "../types/auditBuilder";
import type { PromptRule } from "../types/promptRules";
import { normalizePromptRules } from "./promptRules";

export function createEmptyPromptRule(triggerValue = "Yes"): PromptRule {
  return {
    when: { operator: "equals", value: triggerValue },
    actions: [
      {
        type: "followUpQuestion",
        id: `follow-up-${Date.now()}`,
        label: "",
        inputType: "text",
        required: true,
      },
      { type: "instruction", text: "" },
      { type: "escalate", message: "", managerReview: true, evidenceRequired: false },
    ],
  };
}

export function updateQuestionPromptRules(
  sections: AuditBuilderSection[],
  sectionIndex: number,
  questionIndex: number,
  promptRules: PromptRule[],
) {
  return sections.map((section, currentSectionIndex) => {
    if (currentSectionIndex !== sectionIndex) return section;
    return {
      ...section,
      questions: section.questions.map((question, currentQuestionIndex) =>
        currentQuestionIndex === questionIndex
          ? { ...question, prompt_rules: promptRules.length > 0 ? promptRules : undefined }
          : question,
      ),
    };
  });
}

export function updateQuestionAnswerType(
  sections: AuditBuilderSection[],
  sectionIndex: number,
  questionIndex: number,
  answerType: AuditBuilderQuestion["answer_type"],
) {
  return sections.map((section, currentSectionIndex) => {
    if (currentSectionIndex !== sectionIndex) return section;
    return {
      ...section,
      questions: section.questions.map((question, currentQuestionIndex) => {
        if (currentQuestionIndex !== questionIndex) return question;
        const options =
          answerType === "yes_no"
            ? ["Yes", "No"]
            : ["Compliant", "Non-compliant", "Not applicable"];
        return { ...question, answer_type: answerType, options };
      }),
    };
  });
}
