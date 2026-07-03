/** Shared prompt-rule helpers for verifiers (no TypeScript runtime). */

export const FRIDGE_PROMPT_EXAMPLE = {
  template_name: "Fridge temperature check",
  sections: [
    {
      name: "Cold storage",
      questions: [
        {
          question_text: "Has the fridge door been open for more than 15 minutes?",
          answer_type: "yes_no",
          options: ["Yes", "No"],
          prompt_rules: [
            {
              when: { operator: "equals", value: "Yes" },
              actions: [
                {
                  type: "followUpQuestion",
                  id: "temperature",
                  label: "What is the temperature?",
                  inputType: "number",
                  unit: "°C",
                },
                {
                  type: "instruction",
                  text: "Close the fridge door and check again in 15 minutes.",
                },
                {
                  type: "escalate",
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

export function resolveTriggerAnswerLabel(question, answer, textResponse = "") {
  const trimmedText = String(textResponse || "").trim();
  if (trimmedText) return trimmedText;
  const fieldType = question.fieldType || "Traffic light";
  if (fieldType === "Yes / No") {
    if (answer === "pass") return "Yes";
    if (answer === "fail") return "No";
  }
  if (answer === "pass") return "Yes";
  if (answer === "fail") return "No";
  return "";
}

export function getActivePromptRules(question, answer, textResponse = "") {
  const rules = Array.isArray(question.promptRules) ? question.promptRules : [];
  if (rules.length === 0 || !answer || answer === "nc") return [];
  const label = resolveTriggerAnswerLabel(question, answer, textResponse);
  if (!label) return [];
  return rules.filter((rule) => String(rule?.when?.value || "").toLowerCase() === label.toLowerCase());
}

function shouldEscalateForManagerReview(escalate, followUpAnswers) {
  if (!escalate?.managerReview) return false;
  const hasRange = escalate.safeMin != null || escalate.safeMax != null;
  if (!hasRange || !escalate.followUpId) return true;
  const value = Number(String(followUpAnswers[escalate.followUpId] ?? "").trim());
  if (!Number.isFinite(value)) return false;
  const min = escalate.safeMin ?? Number.NEGATIVE_INFINITY;
  const max = escalate.safeMax ?? Number.POSITIVE_INFINITY;
  return value < min || value > max;
}

export function buildPromptRuleFindings(audit, responses, textResponses, promptFollowUps, mergedNotes) {
  const findings = [];
  for (const question of audit.questions || []) {
    const answer = responses[question.id];
    const activeRules = getActivePromptRules(question, answer, textResponses[question.id]);
    if (activeRules.length === 0) continue;
    const followUpAnswers = promptFollowUps[question.id] || {};
    for (const rule of activeRules) {
      for (const action of rule.actions || []) {
        if (action.type !== "escalate") continue;
        if (!shouldEscalateForManagerReview(action, followUpAnswers)) continue;
        findings.push({
          questionId: question.id,
          questionText: question.text,
          answer: resolveTriggerAnswerLabel(question, answer, textResponses[question.id]),
          note: mergedNotes[question.id] || "",
          requiresManagerReview: true,
          escalationMessage: action.message,
          source: "promptRule",
        });
      }
    }
  }
  return findings;
}

export function buildCheckAnswersPayload({ responses, notes, promptFollowUps, evidenceIds }) {
  return {
    responses,
    notes,
    promptFollowUps,
    ...(evidenceIds ? { evidenceIds } : {}),
  };
}
