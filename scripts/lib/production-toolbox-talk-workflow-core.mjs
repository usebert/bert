/**
 * Production Toolbox Talk workflow checks — Briefings Type extension (Phase 3.11).
 * Toolbox Talks reuse the Briefings API, routes, workbook tabs, and Phase 3.5 verifier core.
 */
import {
  BRIEFING_VERIFIER_BUDGET_MS,
  CHECK_KEYS,
  CHECK_LABELS,
  formatBriefingWorkflowReport,
  loadBriefingWorkflowConfig,
  runProductionBriefingWorkflowChecks,
  TOOLBOX_TALK_VERIFICATION_PROFILE,
} from "./production-briefing-workflow-core.mjs";

export {
  BRIEFING_VERIFIER_BUDGET_MS as TOOLBOX_TALK_VERIFIER_BUDGET_MS,
  CHECK_KEYS,
  performProductionSmokeLogin,
  maskEmail,
  attemptVerificationBriefingCleanup,
  redactSafeResponseBody,
  TOOLBOX_TALK_VERIFICATION_PROFILE,
} from "./production-briefing-workflow-core.mjs";

export const TOOLBOX_TALK_CHECK_LABELS = {
  ...CHECK_LABELS,
  briefingsApi: "Toolbox Talks API",
  recipientAssignment: "Assign Recipient",
  recipientTodo: "Recipient To-Do",
  sign: "Sign / Attendance",
  completion: "Completion Verification",
  dashboard: "Dashboard / Overview",
};

const TOOLBOX_REPORT_OPTIONS = {
  reportTitle: "BERT Production Toolbox Talk Workflow",
  stageLabels: TOOLBOX_TALK_CHECK_LABELS,
  recordIdLabel: "Talk ID",
};

export function loadToolboxTalkWorkflowConfig(env = process.env) {
  const base = loadBriefingWorkflowConfig(env);
  const allowToolboxTalkMutation =
    trim(env.BERT_SMOKE_ALLOW_TOOLBOX_TALK_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_TOOLBOX_TALK_MUTATION).toLowerCase() === "true";
  const recipientUsername =
    trim(env.BERT_SMOKE_TOOLBOX_RECIPIENT_USERNAME) || trim(env.BERT_SMOKE_BRIEFING_RECIPIENT_USERNAME);
  const recipientPassword =
    trim(env.BERT_SMOKE_TOOLBOX_RECIPIENT_PASSWORD) || trim(env.BERT_SMOKE_BRIEFING_RECIPIENT_PASSWORD);
  const recipientExpectedEmail = trim(
    env.BERT_SMOKE_TOOLBOX_RECIPIENT_EXPECTED_EMAIL || env.BERT_SMOKE_BRIEFING_RECIPIENT_EXPECTED_EMAIL,
  ).toLowerCase();
  const hasRecipientCredentials = Boolean(recipientUsername && recipientPassword);
  return {
    ...base,
    allowBriefingMutation: allowToolboxTalkMutation,
    allowToolboxTalkMutation,
    recipientUsername,
    recipientPassword,
    recipientExpectedEmail,
    hasRecipientCredentials,
    selfRecipientMode: !hasRecipientCredentials,
    totalBudgetMs: BRIEFING_VERIFIER_BUDGET_MS,
  };
}

function trim(value) {
  return String(value ?? "").trim();
}

export function formatToolboxTalkWorkflowReport(result) {
  return formatBriefingWorkflowReport(result, TOOLBOX_REPORT_OPTIONS);
}

export async function runProductionToolboxTalkWorkflowChecks(config, transport, options = {}) {
  return runProductionBriefingWorkflowChecks(config, transport, {
    ...options,
    verificationProfile: TOOLBOX_TALK_VERIFICATION_PROFILE,
    stageLabels: TOOLBOX_TALK_CHECK_LABELS,
    logPrefix: options.logPrefix || "[toolbox-talk-workflow]",
  });
}
