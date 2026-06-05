import type { AuditBuilderTemplateDraft, AuditBuilderTemplateRecord } from "../types/auditBuilder";
import type { AuditQuestion, AuditTemplate } from "../types/reportsScreenProps";

export function auditBuilderTemplateToBertQuestions(
  template: AuditBuilderTemplateDraft | AuditBuilderTemplateRecord,
): AuditQuestion[] {
  const questions: AuditQuestion[] = [];
  let index = 0;
  for (const section of template.sections) {
    for (const question of section.questions) {
      index += 1;
      questions.push({
        id: `ab-q-${index}`,
        text: question.question_text,
        fieldType: "Pass / Fail",
        riskLevel: "Medium",
        riskCategory: "Health & Safety",
        autoActionRequired: question.requires_action_on_failure,
        requiresPhotoEvidence: question.allows_photo_evidence,
        requiresManagerReview: question.requires_comment_on_failure,
        answerPrompts: {
          pass: [question.options[0] || "Compliant"],
          fail: [question.options[1] || "Non-compliant"],
          nc: [question.options[2] || "Not applicable"],
        },
      });
    }
    void section.name;
  }
  return questions;
}

export function auditBuilderTemplateToBertTemplate(
  record: AuditBuilderTemplateRecord,
): AuditTemplate {
  return {
    id: record.id,
    name: record.template_name,
    active: true,
    questions: auditBuilderTemplateToBertQuestions(record),
    source: "Built in app",
    category: record.category,
    language: "en",
    defaultLanguage: "en",
    translationStatus: "Original",
  };
}
