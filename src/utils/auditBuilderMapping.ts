import type { AuditBuilderSection, AuditBuilderTemplateDraft, AuditBuilderTemplateRecord, AuditBuilderTemplateStatus } from "../types/auditBuilder";
import type { AuditQuestion, AuditTemplate } from "../types/reportsScreenProps";
import { normalizePromptRules } from "./promptRules";

export function auditBuilderTemplateToBertQuestions(
  template: AuditBuilderTemplateDraft | AuditBuilderTemplateRecord,
): AuditQuestion[] {
  const questions: AuditQuestion[] = [];
  let index = 0;
  for (const section of template.sections) {
    for (const question of section.questions) {
      index += 1;
      const answerType = String(question.answer_type || "compliance");
      const isYesNo = answerType === "yes_no";
      const passLabel = question.options[0] || (isYesNo ? "Yes" : "Compliant");
      const failLabel = question.options[1] || (isYesNo ? "No" : "Non-compliant");
      const ncLabel = question.options[2] || "Not applicable";
      const promptRules = normalizePromptRules(question.prompt_rules);
      questions.push({
        id: `ab-q-${index}`,
        text: question.question_text,
        fieldType: isYesNo ? "Yes / No" : "Pass / Fail",
        riskLevel: "Medium",
        riskCategory: "Health & Safety",
        autoActionRequired: question.requires_action_on_failure,
        requiresPhotoEvidence: question.allows_photo_evidence,
        requiresManagerReview: question.requires_comment_on_failure,
        answerPrompts: isYesNo
          ? { pass: [passLabel], fail: [failLabel] }
          : {
              pass: [passLabel],
              fail: [failLabel],
              nc: [ncLabel],
            },
        ...(promptRules.length > 0 ? { promptRules } : {}),
      });
    }
    void section.name;
  }
  return questions;
}

export function auditBuilderTemplateToBertTemplate(
  record: AuditBuilderTemplateRecord,
): AuditTemplate {
  const status = record.status || "active";
  return {
    id: record.id,
    name: record.template_name,
    active: status === "active",
    questions: auditBuilderTemplateToBertQuestions(record),
    source: "Built in app",
    category: record.category,
    language: "en",
    defaultLanguage: "en",
    translationStatus: "Original",
  };
}

export function bertTemplateToEditorDraft(template: AuditTemplate): AuditBuilderTemplateDraft {
  const sections: AuditBuilderSection[] = [
    {
      name: "General",
      questions: template.questions.map((question) => ({
        question_text: question.text,
        answer_type: question.fieldType === "Yes / No" ? "yes_no" : "compliance",
        options: [
          question.answerPrompts?.pass?.[0] || (question.fieldType === "Yes / No" ? "Yes" : "Compliant"),
          question.answerPrompts?.fail?.[0] || (question.fieldType === "Yes / No" ? "No" : "Non-compliant"),
          question.answerPrompts?.nc?.[0] || "Not applicable",
        ],
        requires_comment_on_failure: question.requiresManagerReview !== false,
        requires_action_on_failure: question.autoActionRequired !== false,
        allows_photo_evidence: question.requiresPhotoEvidence !== false,
        ...(question.promptRules && question.promptRules.length > 0
          ? { prompt_rules: question.promptRules }
          : {}),
      })),
    },
  ];
  return {
    template_name: template.name,
    description: "",
    category: template.category || "Audits",
    sections: sections.filter((section) => section.questions.length > 0),
  };
}

export function auditBuilderStatusToBertActive(status?: AuditBuilderTemplateStatus): boolean {
  return (status || "active") === "active";
}
