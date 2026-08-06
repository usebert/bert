/**
 * Dedicated production smoke verification Briefing for Dovecote Manufacturing Ltd.
 * Stable markers — safe to rerun; identifies verification-only workbook rows.
 */
import { getUkTodayKey } from "./uk-date-time.mjs";
import {
  PRODUCTION_VERIFICATION_TOOLBOX_TALK_ID_PREFIX,
  PRODUCTION_VERIFICATION_TOOLBOX_TALK_SOURCE,
  PRODUCTION_VERIFICATION_TOOLBOX_TALK_TITLE,
  PRODUCTION_VERIFICATION_TOOLBOX_TALK_TYPE,
} from "./production-verification-toolbox-talk.mjs";

export const PRODUCTION_VERIFICATION_BRIEFING_ID_PREFIX = "bert-smoke-briefing-";
export const PRODUCTION_VERIFICATION_BRIEFING_TITLE = "BERT Verification Briefing";
export const PRODUCTION_VERIFICATION_BRIEFING_SUMMARY =
  "Automated production Briefing workflow verification. Safe to remove.";
export const PRODUCTION_VERIFICATION_BRIEFING_TYPE = "Verification";
export const PRODUCTION_VERIFICATION_BRIEFING_MARKER = "verification";
export const PRODUCTION_VERIFICATION_BRIEFING_SOURCE = "production-briefing-workflow";
export const PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS = "verification-cleaned";
export const PRODUCTION_VERIFICATION_BRIEFING_SIGNATURE_NAME = "BERT Verification Signature";

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

function pickField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) {
      return direct;
    }
  }
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = normalize(header).replace(/[^a-z0-9]/g, "");
    for (const key of keys) {
      const normalizedKey = normalize(key).replace(/[^a-z0-9]/g, "");
      if (normalizedHeader === normalizedKey || normalizedHeader.includes(normalizedKey)) {
        const text = trim(value);
        if (text) {
          return text;
        }
      }
    }
  }
  return "";
}

export function isVerificationBriefingId(briefingId = "") {
  const id = trim(briefingId);
  return id.startsWith(PRODUCTION_VERIFICATION_BRIEFING_ID_PREFIX) || id.startsWith(PRODUCTION_VERIFICATION_TOOLBOX_TALK_ID_PREFIX);
}

export function isVerificationBriefing(record = {}) {
  const briefingId = pickField(record, "briefingId", "BriefingId", "id");
  if (isVerificationBriefingId(briefingId)) {
    return true;
  }

  const verificationSource = pickField(record, "verificationSource", "VerificationSource");
  if (normalize(verificationSource) === normalize(PRODUCTION_VERIFICATION_BRIEFING_SOURCE)) {
    return true;
  }
  if (normalize(verificationSource) === normalize(PRODUCTION_VERIFICATION_TOOLBOX_TALK_SOURCE)) {
    return true;
  }

  const title = normalize(pickField(record, "title", "Title"));
  const type = normalize(pickField(record, "type", "Type"));
  const message = normalize(pickField(record, "message", "Message", "summary", "Summary"));

  if (title === normalize(PRODUCTION_VERIFICATION_BRIEFING_TITLE)) {
    return true;
  }
  if (title === normalize(PRODUCTION_VERIFICATION_TOOLBOX_TALK_TITLE)) {
    return true;
  }
  if (type === normalize(PRODUCTION_VERIFICATION_BRIEFING_TYPE) && message.includes("automated production briefing workflow verification")) {
    return true;
  }
  if (type === normalize(PRODUCTION_VERIFICATION_TOOLBOX_TALK_TYPE) && message.includes("automated production toolbox talk verification")) {
    return true;
  }

  return false;
}

export function isActiveVerificationBriefing(record = {}) {
  if (!isVerificationBriefing(record)) {
    return false;
  }
  const status = normalize(pickField(record, "status", "Status"));
  return status !== PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS;
}

export function isOperationalBriefing(record = {}) {
  return !isVerificationBriefing(record);
}

export function isOperationalToolboxTalk(record = {}) {
  return isOperationalBriefing(record);
}

export function mapWorkbookBriefingForOperationalCheck(record = {}) {
  return {
    briefingId: pickField(record, "briefingId", "BriefingId", "Briefing ID", "id"),
    status: pickField(record, "status", "Status"),
    title: pickField(record, "title", "Title"),
    type: pickField(record, "type", "Type"),
    message: pickField(record, "message", "Message", "summary", "Summary"),
    verificationSource: pickField(record, "verificationSource", "VerificationSource", "Verification Source"),
  };
}

export function isOperationalWorkbookBriefingRow(record = {}) {
  return isOperationalBriefing(mapWorkbookBriefingForOperationalCheck(record));
}

export function buildProductionVerificationBriefingId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_BRIEFING_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationBriefing(input = {}) {
  const runId = input.runId ?? Date.now();
  const briefingId = trim(input.briefingId) || buildProductionVerificationBriefingId(runId);
  const creatorEmail = trim(input.createdByEmail);
  const creatorName = trim(input.createdByName) || "Smoke Verifier";

  return {
    briefingId,
    title: PRODUCTION_VERIFICATION_BRIEFING_TITLE,
    type: PRODUCTION_VERIFICATION_BRIEFING_TYPE,
    status: trim(input.status) || "Draft",
    priority: "Normal",
    message: PRODUCTION_VERIFICATION_BRIEFING_SUMMARY,
    verificationSource: PRODUCTION_VERIFICATION_BRIEFING_SOURCE,
    verificationMarker: PRODUCTION_VERIFICATION_BRIEFING_MARKER,
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

export function countBriefingBaselines(briefings = []) {
  const list = Array.isArray(briefings) ? briefings : [];
  const operational = list.filter((item) => isOperationalBriefing(item));
  const verification = list.filter((item) => isVerificationBriefing(item));
  const activeVerification = list.filter((item) => isActiveVerificationBriefing(item));

  return {
    visibleCount: list.length,
    operationalCount: operational.length,
    draftCount: operational.filter((item) => normalize(item.status) === "draft").length,
    publishedCount: operational.filter((item) => ["sent", "active", "published"].includes(normalize(item.status))).length,
    verificationCount: verification.length,
    activeVerificationCount: activeVerification.length,
  };
}

export function listActiveVerificationBriefings(briefings = []) {
  return (Array.isArray(briefings) ? briefings : []).filter((item) => isActiveVerificationBriefing(item));
}

export function findBriefingById(briefings = [], briefingId = "") {
  const target = trim(briefingId).toLowerCase();
  return (Array.isArray(briefings) ? briefings : []).find(
    (item) => trim(item.briefingId || item.id).toLowerCase() === target,
  );
}
