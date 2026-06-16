import type { AuditBuilderQuestion, AuditBuilderSection } from "../types/auditBuilder";

const DEFAULT_OPTIONS = ["Compliant", "Non-compliant", "Not applicable"];

export function createEmptyQuestion(): AuditBuilderQuestion {
  return {
    question_text: "",
    answer_type: "compliance",
    options: [...DEFAULT_OPTIONS],
    requires_comment_on_failure: true,
    requires_action_on_failure: true,
    allows_photo_evidence: true,
  };
}

export function createEmptySection(name = "New section"): AuditBuilderSection {
  return {
    name,
    questions: [createEmptyQuestion()],
  };
}

export function moveSectionUp(sections: AuditBuilderSection[], index: number): AuditBuilderSection[] {
  if (index <= 0) return sections;
  const next = [...sections];
  [next[index - 1], next[index]] = [next[index], next[index - 1]];
  return next;
}

export function moveSectionDown(sections: AuditBuilderSection[], index: number): AuditBuilderSection[] {
  if (index >= sections.length - 1) return sections;
  const next = [...sections];
  [next[index], next[index + 1]] = [next[index + 1], next[index]];
  return next;
}

export function moveQuestionUp(
  sections: AuditBuilderSection[],
  sectionIndex: number,
  questionIndex: number,
): AuditBuilderSection[] {
  if (questionIndex <= 0) return sections;
  return sections.map((section, currentSectionIndex) => {
    if (currentSectionIndex !== sectionIndex) return section;
    const questions = [...section.questions];
    [questions[questionIndex - 1], questions[questionIndex]] = [
      questions[questionIndex],
      questions[questionIndex - 1],
    ];
    return { ...section, questions };
  });
}

export function moveQuestionDown(
  sections: AuditBuilderSection[],
  sectionIndex: number,
  questionIndex: number,
): AuditBuilderSection[] {
  const section = sections[sectionIndex];
  if (!section || questionIndex >= section.questions.length - 1) return sections;
  return sections.map((currentSection, currentSectionIndex) => {
    if (currentSectionIndex !== sectionIndex) return currentSection;
    const questions = [...currentSection.questions];
    [questions[questionIndex], questions[questionIndex + 1]] = [
      questions[questionIndex + 1],
      questions[questionIndex],
    ];
    return { ...currentSection, questions };
  });
}

export function removeSection(sections: AuditBuilderSection[], index: number): AuditBuilderSection[] {
  if (sections.length <= 1) return sections;
  return sections.filter((_, sectionIndex) => sectionIndex !== index);
}

export function removeQuestion(
  sections: AuditBuilderSection[],
  sectionIndex: number,
  questionIndex: number,
): AuditBuilderSection[] {
  return sections
    .map((section, currentSectionIndex) => {
      if (currentSectionIndex !== sectionIndex) return section;
      const questions = section.questions.filter((_, currentQuestionIndex) => currentQuestionIndex !== questionIndex);
      return { ...section, questions };
    })
    .filter((section) => section.questions.length > 0);
}

export function addQuestionToSection(sections: AuditBuilderSection[], sectionIndex: number): AuditBuilderSection[] {
  return sections.map((section, currentSectionIndex) =>
    currentSectionIndex === sectionIndex
      ? { ...section, questions: [...section.questions, createEmptyQuestion()] }
      : section,
  );
}

export function addSection(sections: AuditBuilderSection[]): AuditBuilderSection[] {
  return [...sections, createEmptySection(`Section ${sections.length + 1}`)];
}

export function updateSectionName(sections: AuditBuilderSection[], index: number, name: string): AuditBuilderSection[] {
  return sections.map((section, sectionIndex) => (sectionIndex === index ? { ...section, name } : section));
}

export function updateQuestionField<K extends keyof AuditBuilderQuestion>(
  sections: AuditBuilderSection[],
  sectionIndex: number,
  questionIndex: number,
  field: K,
  value: AuditBuilderQuestion[K],
): AuditBuilderSection[] {
  return sections.map((section, currentSectionIndex) => {
    if (currentSectionIndex !== sectionIndex) return section;
    return {
      ...section,
      questions: section.questions.map((question, currentQuestionIndex) =>
        currentQuestionIndex === questionIndex ? { ...question, [field]: value } : question,
      ),
    };
  });
}

export function updateQuestionOptions(
  sections: AuditBuilderSection[],
  sectionIndex: number,
  questionIndex: number,
  optionsText: string,
): AuditBuilderSection[] {
  const options = optionsText
    .split("\n")
    .map((option) => option.trim())
    .filter(Boolean);
  return updateQuestionField(sections, sectionIndex, questionIndex, "options", options.length > 0 ? options : DEFAULT_OPTIONS);
}

export function validateTemplateDraft(draft: {
  template_name: string;
  sections: AuditBuilderSection[];
}): string | null {
  if (!draft.template_name.trim()) {
    return "Template name is required.";
  }
  const questionCount = draft.sections.reduce((sum, section) => sum + section.questions.length, 0);
  if (questionCount === 0) {
    return "Add at least one question.";
  }
  const hasEmptyQuestion = draft.sections.some((section) =>
    section.questions.some((question) => !question.question_text.trim()),
  );
  if (hasEmptyQuestion) {
    return "Every question needs wording.";
  }
  return null;
}
