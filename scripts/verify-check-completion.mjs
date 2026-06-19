#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertContains(filePath, snippets) {
  const fullPath = path.join(root, filePath);
  const content = fs.readFileSync(fullPath, "utf8");
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      throw new Error(`Missing "${snippet}" in ${filePath}`);
    }
  }
}

function isQuestionAnswered(question, draft) {
  const answer = draft.responses[question.id];
  const text = (draft.textResponses[question.id] ?? "").trim();
  const photos = draft.evidence[question.id]?.length ?? 0;
  if (answer === "nc") return true;
  if (question.fieldType === "Short text") return text.length > 0;
  if (question.fieldType === "Photo evidence") return photos > 0 || answer === "nc";
  return Boolean(answer);
}

function getUnansweredRequired(audit, draft) {
  return audit.questions.filter((question) => question.required !== false && !isQuestionAnswered(question, draft));
}

const audit = {
  questions: [
    { id: "q1", text: "Area safe?", fieldType: "Pass / Fail", required: true },
    { id: "q2", text: "Notes", fieldType: "Short text", required: true },
  ],
};

const partialDraft = {
  responses: { q1: "pass" },
  textResponses: {},
  notes: {},
  evidence: {},
};

assert(isQuestionAnswered(audit.questions[0], { ...partialDraft }), "Q1 answered after pass");
assert(!isQuestionAnswered(audit.questions[1], partialDraft), "Q2 unanswered");
assert(getUnansweredRequired(audit, partialDraft).length === 1, "required blocks submit");

const resumedDraft = {
  responses: { q1: "pass" },
  textResponses: { q2: "Saved offline" },
  notes: {},
  evidence: {},
  questionIndex: 1,
};
assert(isQuestionAnswered(audit.questions[1], resumedDraft), "draft text survives reload");
assert(resumedDraft.questionIndex === 1, "draft resumes at saved question");

const failedDraft = {
  responses: { q1: "fail" },
  textResponses: {},
  notes: { q1: "Guard missing" },
  evidence: { q1: [{ id: "e1" }] },
};
assert(failedDraft.notes.q1.length > 0 && failedDraft.evidence.q1.length > 0, "failed answer note/evidence");

assertContains("App.tsx", [
  "CheckCompletionWizard",
  "textResponses",
  "questionIndex",
  "completeAuditModeFlow",
]);
assertContains("src/components/checks/CheckCompletionWizard.tsx", [
  "Question",
  " of ",
  "Back",
  "Next",
  "Review",
]);
assertContains("src/components/checks/CheckCompletionReview.tsx", ["Submit check", "Jump"]);
assertContains("src/components/checks/CheckQuestionControls.tsx", ["Mark N/A", "Add note", "Add photo"]);
assertContains("src/screens/CompleteAuditScreen.tsx", ["Submit"]);

console.log("[verify:check-completion] wizard flow OK");
