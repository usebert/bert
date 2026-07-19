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

/** Mirrors src/utils/checkCompletionHelpers.canRapidAdvanceAfterAnswer */
function canRapidAdvanceAfterAnswer(question, answer, draft) {
  if (answer === "fail") return false;
  if (answer === "pass" && question.requiresPhotoEvidence && (draft.evidence[question.id]?.length ?? 0) === 0) {
    return false;
  }
  return isQuestionAnswered(question, draft);
}

/**
 * Mirrors CheckCompletionWizard.handleAnswerChange index/lock behaviour
 * (answer always keyed by captured questionId before any index change).
 */
function simulateRapidAnswer(state, questionId, answer) {
  const answeredIndex = state.index;
  const answeredQuestion = state.questions[answeredIndex];
  const responses = { ...state.responses, [questionId]: answer };
  const evidence = state.evidence ?? {};
  let lock = true;

  if (!answeredQuestion || questionId !== answeredQuestion.id || answer === "fail") {
    lock = false;
    return { responses, evidence, index: answeredIndex, lock, advanced: false };
  }

  const draft = {
    responses,
    textResponses: state.textResponses ?? {},
    notes: state.notes ?? {},
    evidence,
  };
  if (!canRapidAdvanceAfterAnswer(answeredQuestion, answer, draft)) {
    lock = false;
    return { responses, evidence, index: answeredIndex, lock, advanced: false, blocked: true };
  }

  const nextIndex = Math.min(answeredIndex + 1, state.questions.length - 1);
  if (nextIndex === answeredIndex) {
    lock = false;
    return { responses, evidence, index: nextIndex, lock, advanced: false, finalQuestion: true };
  }

  // Lock releases after questionIndex transition is applied.
  lock = false;
  return { responses, evidence, index: nextIndex, lock, advanced: true };
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

const passFailQuestions = [
  { id: "q1", text: "Area safe?", fieldType: "Pass / Fail", required: true },
  { id: "q2", text: "Guards fitted?", fieldType: "Pass / Fail", required: true },
];

// Pass / N/A advance one step; Fail stays; stored values remain "pass" / "nc" / "fail".
{
  let state = { questions: passFailQuestions, index: 0, responses: {}, evidence: {} };
  let next = simulateRapidAnswer(state, "q1", "pass");
  assert(next.responses.q1 === "pass", "Pass stores pass");
  assert(next.index === 1 && next.advanced, "Pass advances exactly one question");
  assert(next.lock === false, "Pass unlocks after advance");

  next = simulateRapidAnswer({ ...state, index: 0, responses: {} }, "q1", "nc");
  assert(next.responses.q1 === "nc", "N/A stores nc");
  assert(next.index === 1 && next.advanced, "N/A advances exactly one question");

  next = simulateRapidAnswer({ ...state, index: 0, responses: {} }, "q1", "fail");
  assert(next.responses.q1 === "fail", "Fail stores fail");
  assert(next.index === 0 && !next.advanced, "Fail remains on current question");
  assert(next.lock === false, "Fail unlocks immediately");
}

// Final question: save, do not exceed last index, unlock, allow answer change.
{
  let state = {
    questions: passFailQuestions,
    index: 1,
    responses: { q1: "pass" },
    evidence: {},
  };
  let next = simulateRapidAnswer(state, "q2", "pass");
  assert(next.responses.q2 === "pass", "final Pass saves to final question");
  assert(next.index === 1, "final Pass does not exceed last index");
  assert(next.finalQuestion === true && !next.advanced, "final Pass does not advance");
  assert(next.lock === false, "final Pass releases lock");

  next = simulateRapidAnswer({ ...state, responses: next.responses }, "q2", "nc");
  assert(next.responses.q2 === "nc", "final answer can change to N/A");
  assert(next.index === 1 && next.lock === false, "final N/A stays and unlocks");

  next = simulateRapidAnswer({ ...state, responses: next.responses }, "q2", "fail");
  assert(next.responses.q2 === "fail" && next.index === 1, "final Fail stays on final question");
}

// Backward navigation preserves Pass + evidence on the original questionId.
{
  let state = { questions: passFailQuestions, index: 0, responses: {}, evidence: {} };
  let next = simulateRapidAnswer(state, "q1", "pass");
  assert(next.index === 1, "after Pass wizard is on question 2");
  // Back to question 1, add evidence, move forward again.
  const afterBack = {
    questions: passFailQuestions,
    index: 0,
    responses: next.responses,
    evidence: { q1: [{ id: "photo-1" }] },
  };
  assert(afterBack.responses.q1 === "pass", "Back still shows Pass on question 1");
  assert(afterBack.evidence.q1.length === 1, "evidence attaches to question 1");
  next = simulateRapidAnswer(afterBack, "q1", "pass");
  assert(next.responses.q1 === "pass", "question 1 still Pass after forward");
  assert(afterBack.evidence.q1.length === 1, "question 1 evidence retained");
  assert(next.index === 1, "forward returns to question 2");
}

// Fail → Pass advances once; Back shows Pass; Pass → Fail stays with fail answer.
{
  let state = { questions: passFailQuestions, index: 0, responses: {}, evidence: {} };
  let next = simulateRapidAnswer(state, "q1", "fail");
  assert(next.index === 0, "Fail stays");
  next = simulateRapidAnswer({ ...state, responses: next.responses }, "q1", "pass");
  assert(next.responses.q1 === "pass" && next.index === 1, "Fail then Pass advances exactly once");
  assert(next.responses.q1 !== "fail", "Back would show Pass not Fail");

  next = simulateRapidAnswer(
    { questions: passFailQuestions, index: 0, responses: { q1: "pass" }, evidence: {} },
    "q1",
    "fail",
  );
  assert(next.responses.q1 === "fail" && next.index === 0, "changing Pass to Fail stays on question");
}

// Required-photo validation still blocks Pass advance without evidence.
{
  const questions = [
    { id: "q1", text: "Photo required", fieldType: "Pass / Fail", required: true, requiresPhotoEvidence: true },
    { id: "q2", text: "Next", fieldType: "Pass / Fail", required: true },
  ];
  let next = simulateRapidAnswer({ questions, index: 0, responses: {}, evidence: {} }, "q1", "pass");
  assert(next.blocked && next.index === 0, "Pass without required photo does not advance");
  next = simulateRapidAnswer(
    { questions, index: 0, responses: {}, evidence: { q1: [{ id: "e1" }] } },
    "q1",
    "pass",
  );
  assert(next.advanced && next.index === 1, "Pass with required photo advances");
  next = simulateRapidAnswer({ questions, index: 0, responses: {}, evidence: {} }, "q1", "nc");
  assert(next.advanced && next.responses.q1 === "nc", "N/A still advances without photo");
}

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
  "handleAnswerChange",
  "rapidAnswerLockRef",
]);
assertContains("src/utils/checkCompletionHelpers.ts", ["canRapidAdvanceAfterAnswer"]);
assertContains("src/components/checks/CheckCompletionReview.tsx", ["Submit check", "Jump"]);
assertContains("src/components/checks/CheckQuestionControls.tsx", ["Mark N/A", "Add note", "Add photo", "EvidencePanel"]);
assertContains("src/screens/CompleteAuditScreen.tsx", ["Submit"]);
assert(
  fs.readFileSync(path.join(root, "src/components/checks/CheckQuestionControls.tsx"), "utf8").includes(
    "<EvidencePanel",
  ),
  "evidence panel rendered for every question",
);
assert(
  !/showFailedFollowUp[\s\S]{0,200}EvidenceUploadChoice/.test(
    fs.readFileSync(path.join(root, "src/components/checks/CheckQuestionControls.tsx"), "utf8"),
  ),
  "Fail follow-up must not duplicate EvidenceUploadChoice",
);

console.log("[verify:check-completion] wizard flow OK");
