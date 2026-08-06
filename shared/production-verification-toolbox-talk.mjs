/**
 * Production smoke verification Toolbox Talk — a Briefings Type value, not a separate module.
 * Reuses Briefings workbook tabs, routes, and lifecycle (Phase 3.5 extension).
 */
import { getUkTodayKey } from "./uk-date-time.mjs";

export const PRODUCTION_VERIFICATION_TOOLBOX_TALK_ID_PREFIX = "bert-smoke-toolbox-";
export const PRODUCTION_VERIFICATION_TOOLBOX_TALK_TITLE = "BERT Verification Toolbox Talk";
export const PRODUCTION_VERIFICATION_TOOLBOX_TALK_TOPIC = "Manual Handling Awareness";
export const PRODUCTION_VERIFICATION_TOOLBOX_TALK_SUMMARY =
  "Automated production Toolbox Talk verification. Safe to remove.";
export const PRODUCTION_VERIFICATION_TOOLBOX_TALK_TYPE = "Toolbox Talk";
export const PRODUCTION_VERIFICATION_TOOLBOX_TALK_CATEGORY = "Health and Safety";
export const PRODUCTION_VERIFICATION_TOOLBOX_TALK_DURATION_MINUTES = 10;
export const PRODUCTION_VERIFICATION_TOOLBOX_TALK_MARKER = "verification";
export const PRODUCTION_VERIFICATION_TOOLBOX_TALK_SOURCE = "production-toolbox-talk-workflow";

function trim(value) {
  return String(value ?? "").trim();
}

export function isVerificationToolboxTalkId(talkId = "") {
  return trim(talkId).startsWith(PRODUCTION_VERIFICATION_TOOLBOX_TALK_ID_PREFIX);
}

export function buildProductionVerificationToolboxTalkId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_TOOLBOX_TALK_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationToolboxTalk(input = {}) {
  const runId = input.runId ?? Date.now();
  const briefingId = trim(input.briefingId) || buildProductionVerificationToolboxTalkId(runId);
  const creatorEmail = trim(input.createdByEmail);
  const creatorName = trim(input.createdByName) || "Smoke Verifier";
  const message = [
    PRODUCTION_VERIFICATION_TOOLBOX_TALK_SUMMARY,
    `Topic: ${PRODUCTION_VERIFICATION_TOOLBOX_TALK_TOPIC}`,
    `Duration: ${PRODUCTION_VERIFICATION_TOOLBOX_TALK_DURATION_MINUTES} minutes`,
    `Category: ${PRODUCTION_VERIFICATION_TOOLBOX_TALK_CATEGORY}`,
    `marker=${PRODUCTION_VERIFICATION_TOOLBOX_TALK_MARKER}`,
  ].join(" ");

  return {
    briefingId,
    title: PRODUCTION_VERIFICATION_TOOLBOX_TALK_TITLE,
    type: PRODUCTION_VERIFICATION_TOOLBOX_TALK_TYPE,
    status: trim(input.status) || "Draft",
    priority: "Normal",
    message,
    verificationSource: PRODUCTION_VERIFICATION_TOOLBOX_TALK_SOURCE,
    verificationMarker: PRODUCTION_VERIFICATION_TOOLBOX_TALK_MARKER,
    dueDate: trim(input.dueDate) || getUkTodayKey(),
    requiresRead: true,
    requiresAcknowledgement: true,
    requiresSignature: input.requiresSignature !== false,
    requiresReply: false,
    targetMode: "users",
    targetUserEmails: (input.targetUserEmails || []).map((email) => trim(email).toLowerCase()).filter(Boolean),
    createdByEmail: creatorEmail,
    createdByName: creatorName,
    renewalFrequency: "None",
  };
}
