#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  FRIDGE_PROMPT_EXAMPLE,
  buildCheckAnswersPayload,
  buildPromptRuleFindings,
  getActivePromptRules,
  resolveTriggerAnswerLabel,
} from "../shared/prompt-rules.mjs";

const root = process.cwd();
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8");
}

function assertContains(filePath, snippets) {
  const content = read(filePath);
  for (const snippet of snippets) {
    assert(content.includes(snippet), `Missing "${snippet}" in ${filePath}`);
  }
}

const fridgeQuestion = FRIDGE_PROMPT_EXAMPLE.sections[0].questions[0];
assert(fridgeQuestion.question_text.includes("fridge door"), "fridge example question present");
assert(Array.isArray(fridgeQuestion.prompt_rules) && fridgeQuestion.prompt_rules.length === 1, "fridge prompt rule present");

const auditQuestion = {
  id: "q-fridge",
  text: fridgeQuestion.question_text,
  fieldType: "Yes / No",
  promptRules: fridgeQuestion.prompt_rules,
};

const yesRules = getActivePromptRules(auditQuestion, "pass");
assert(yesRules.length === 1, "Yes trigger activates prompt rules");
assert(getActivePromptRules(auditQuestion, "fail").length === 0, "No answer does not activate prompt rules");
assert(resolveTriggerAnswerLabel(auditQuestion, "pass") === "Yes", "pass maps to Yes label");

const inRangeFindings = buildPromptRuleFindings(
  { questions: [auditQuestion] },
  { "q-fridge": "pass" },
  {},
  { "q-fridge": { temperature: "4" } },
  {},
);
assert(inRangeFindings.length === 0, "in-range temperature does not create manager review finding");

const outOfRangeFindings = buildPromptRuleFindings(
  { questions: [auditQuestion] },
  { "q-fridge": "pass" },
  {},
  { "q-fridge": { temperature: "9" } },
  {},
);
assert(outOfRangeFindings.length === 1, "out-of-range temperature creates manager review finding");
assert(outOfRangeFindings[0].requiresManagerReview === true, "finding flagged for manager review");
assert(outOfRangeFindings[0].source === "promptRule", "finding source is promptRule");

const answersPayload = buildCheckAnswersPayload({
  responses: { "q-fridge": "pass" },
  notes: {},
  promptFollowUps: { "q-fridge": { temperature: "9" } },
});
assert(answersPayload.promptFollowUps["q-fridge"].temperature === "9", "follow-up saved in answers payload");
assert(answersPayload.responses["q-fridge"] === "pass", "responses preserved in answers payload");

assertContains("src/types/auditBuilder.ts", ["prompt_rules?: PromptRule[]"]);
assertContains("src/types/reportsScreenProps.ts", ["promptRules?: PromptRule[]"]);
assertContains("src/types/promptRules.ts", ["type: \"followUpQuestion\"", "type: \"escalate\""]);
assertContains("server/audit-builder.mjs", ["prompt_rules"]);
assertContains("src/utils/auditBuilderMapping.ts", ["promptRules", "yes_no"]);
assertContains("src/components/auditBuilder/QuestionPromptRulesEditor.tsx", [
  "Manager review flag",
  "Follow-up question",
  "Instruction",
]);
assertContains("src/screens/AuditBuilderScreen.tsx", ["Paste fridge example", "QuestionPromptRulesEditor"]);
assertContains("src/components/checks/CheckQuestionControls.tsx", [
  "Follow-up prompts",
  "getActivePromptRules",
]);
assertContains("App.tsx", [
  "buildPromptRuleFindings",
  "buildCheckAnswersPayload",
  "promptFollowUps",
  "onPromptFollowUpChange",
]);
assertContains("src/utils/auditSheetRows.ts", ["promptFollowUps", "buildPromptRuleFindings"]);
assertContains("src/utils/checkCompletionHelpers.ts", ["promptFollowUps", "getActivePromptRules"]);
assertContains("package.json", ["verify:form-prompts-escalation"]);

const legacyTemplate = {
  sections: [
    {
      name: "General",
      questions: [
        {
          question_text: "Area tidy?",
          answer_type: "compliance",
          options: ["Compliant", "Non-compliant", "Not applicable"],
        },
      ],
    },
  ],
};
assert(!legacyTemplate.sections[0].questions[0].prompt_rules, "legacy templates omit prompt_rules");

console.log(`[verify:form-prompts-escalation] ${checks} checks OK`);
