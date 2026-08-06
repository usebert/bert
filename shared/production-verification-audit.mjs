/**
 * Dedicated production smoke verification audit for Dovecote Manufacturing Ltd.
 * Idempotent row builders — safe to rerun; upserts by stable Audit ID / Schedule ID.
 */
import { isVerificationOfflineRunId } from "./production-verification-offline-sync.mjs";
import { demoEmail } from "./demo-company-seed.mjs";
import { buildSchedulesTabRows } from "./schedule-save.mjs";

export const PRODUCTION_VERIFICATION_AUDIT_ID = "bert-verify-audit-v1";
export const PRODUCTION_VERIFICATION_SCHEDULE_ID = "bert-sch-production-verification";
export const PRODUCTION_VERIFICATION_AUDIT_NAME = "BERT Verification Audit";
export const PRODUCTION_VERIFICATION_FORM_NUMBER = "BERT-VERIFY-001";
export const PRODUCTION_VERIFICATION_PURPOSE =
  "Automated production smoke verification — not for operational reporting.";

export const PRODUCTION_VERIFICATION_SMOKE_USERNAME = "mr.important";
export const PRODUCTION_VERIFICATION_SMOKE_EMAIL = demoEmail(PRODUCTION_VERIFICATION_SMOKE_USERNAME);
export const PRODUCTION_VERIFICATION_SMOKE_NAME = "Mr Important";
export const PRODUCTION_VERIFICATION_SMOKE_ROLE = "Admin";
export const PRODUCTION_VERIFICATION_SMOKE_LOCAL_SUBMISSION_PREFIX = "bert-smoke-";
export const PRODUCTION_VERIFICATION_RESULT_STATUS = "verification";
export const PRODUCTION_VERIFICATION_CLEANED_STATUS = "verification-cleaned";

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

function extractField(record, keys) {
  const normalizedKeys = keys.map((key) => normalize(key).replace(/[^a-z0-9]/g, ""));
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = normalize(header).replace(/[^a-z0-9]/g, "");
    if (normalizedKeys.some((key) => normalizedHeader === key || normalizedHeader.includes(key))) {
      const text = trim(value);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

export function isVerificationScheduleId(scheduleId = "") {
  return trim(scheduleId) === PRODUCTION_VERIFICATION_SCHEDULE_ID;
}

export function isVerificationAuditId(auditId = "") {
  return trim(auditId) === PRODUCTION_VERIFICATION_AUDIT_ID;
}

export function isVerificationSchedule(schedule = {}) {
  const scheduleId = trim(schedule.id || schedule.scheduleId);
  const scheduleName = trim(schedule.scheduleName || schedule.name);
  if (isVerificationScheduleId(scheduleId)) {
    return true;
  }
  return /bert\s+verification/i.test(scheduleName) || /verification\s+audit/i.test(scheduleName);
}

export function isVerificationAuditResult(record = {}) {
  const status = normalize(extractField(record, ["status"]));
  if (status === PRODUCTION_VERIFICATION_RESULT_STATUS || status === PRODUCTION_VERIFICATION_CLEANED_STATUS) {
    return true;
  }
  if (isVerificationScheduleId(extractField(record, ["schedule id", "scheduleid"]))) {
    return true;
  }
  if (isVerificationAuditId(extractField(record, ["audit id", "auditid"]))) {
    return true;
  }
  const localSubmissionId = extractField(record, ["local submission id", "localsubmissionid"]);
  if (localSubmissionId.startsWith(PRODUCTION_VERIFICATION_SMOKE_LOCAL_SUBMISSION_PREFIX) || isVerificationOfflineRunId(localSubmissionId)) {
    return true;
  }
  const auditName = extractField(record, ["audit name", "auditname"]);
  return /bert\s+verification/i.test(auditName);
}

export function isOperationalAuditResult(record = {}) {
  return !isVerificationAuditResult(record);
}

export const PRODUCTION_VERIFICATION_QUESTIONS = [
  {
    id: "bert-verify-q1",
    text: "Is the automated verification checklist area accessible?",
    fieldType: "Pass / Fail",
    section: "General",
    requires_action_on_failure: false,
    requires_comment_on_failure: false,
    allows_photo_evidence: false,
  },
  {
    id: "bert-verify-q2",
    text: "Are required safety notices visible in the verification area?",
    fieldType: "Pass / Fail",
    section: "General",
    requires_action_on_failure: false,
    requires_comment_on_failure: false,
    allows_photo_evidence: false,
  },
  {
    id: "bert-verify-q3",
    text: "Is the verification walk route clear of obstructions?",
    fieldType: "Pass / Fail",
    section: "General",
    requires_action_on_failure: false,
    requires_comment_on_failure: false,
    allows_photo_evidence: false,
  },
];

export function buildProductionVerificationAuditTemplateRow({ now = new Date(), companyFolderId = "" } = {}) {
  const iso = now.toISOString();
  const revisionId = `${PRODUCTION_VERIFICATION_FORM_NUMBER}-REV-1`;
  return {
    "Audit ID": PRODUCTION_VERIFICATION_AUDIT_ID,
    "Audit Name": PRODUCTION_VERIFICATION_AUDIT_NAME,
    Category: "Verification",
    Status: "active",
    "Default Frequency": "Weekly",
    "Created At": iso,
    "Google Form ID": "",
    "Google Form Template Status": "Audit Builder",
    Language: "en",
    "Default Language": "en",
    "Translation Status": "Approved",
    "Form Number": PRODUCTION_VERIFICATION_FORM_NUMBER,
    "Revision Number": "1",
    "Revision ID": revisionId,
    "Supersedes Revision ID": "",
    "Superseded By Revision ID": "",
    "Revision Reason": PRODUCTION_VERIFICATION_PURPOSE,
    "Copy Reason": "",
    Archived: "false",
    ArchivedAt: "",
    ArchivedBy: "",
    ArchiveReason: "",
    Notes: PRODUCTION_VERIFICATION_PURPOSE,
    "Company Folder ID": companyFolderId,
  };
}

export function buildProductionVerificationTranslationRow({ now = new Date(), updatedBy = "" } = {}) {
  const iso = now.toISOString();
  return {
    "BERT Template ID": PRODUCTION_VERIFICATION_AUDIT_ID,
    Language: "en",
    "Translation Status": "Original",
    Title: PRODUCTION_VERIFICATION_AUDIT_NAME,
    Description: PRODUCTION_VERIFICATION_PURPOSE,
    "Section JSON": JSON.stringify([{ name: "General", questions: PRODUCTION_VERIFICATION_QUESTIONS.length }]),
    "Questions JSON": JSON.stringify(
      PRODUCTION_VERIFICATION_QUESTIONS.map((question) => ({
        section: question.section,
        question_text: question.text,
        text: question.text,
        id: question.id,
        answer_type: "compliance",
        options: ["Compliant", "Non-compliant", "Not applicable"],
        requires_comment_on_failure: false,
        requires_action_on_failure: false,
        allows_photo_evidence: false,
      })),
    ),
    "Options JSON": "",
    "Guidance JSON": "",
    "Updated At": iso,
    "Updated By": updatedBy || PRODUCTION_VERIFICATION_SMOKE_EMAIL,
  };
}

export function buildProductionVerificationUserAuditAccessRow() {
  return {
    Email: PRODUCTION_VERIFICATION_SMOKE_EMAIL,
    "Audit ID": PRODUCTION_VERIFICATION_AUDIT_ID,
    Access: "can_complete",
  };
}

export function buildProductionVerificationSchedulePayload({
  companyFolderId = "",
  now = new Date(),
} = {}) {
  const iso = now.toISOString();
  const today = getUkTodayKey(now);
  return {
    id: PRODUCTION_VERIFICATION_SCHEDULE_ID,
    companyFolderId,
    companyId: companyFolderId,
    scheduleName: PRODUCTION_VERIFICATION_AUDIT_NAME,
    lifecycle: "Live",
    status: "ACTIVE",
    startDate: today,
    endDate: "",
    completionMode: "repeatable",
    createdAt: iso,
    updatedAt: iso,
    createdByEmail: PRODUCTION_VERIFICATION_SMOKE_EMAIL,
    createdByRole: PRODUCTION_VERIFICATION_SMOKE_ROLE,
    assignedUsers: [
      {
        email: PRODUCTION_VERIFICATION_SMOKE_EMAIL,
        name: PRODUCTION_VERIFICATION_SMOKE_NAME,
        role: PRODUCTION_VERIFICATION_SMOKE_ROLE,
        accessLevel: "full",
      },
    ],
    audits: [
      {
        auditId: PRODUCTION_VERIFICATION_AUDIT_ID,
        auditName: PRODUCTION_VERIFICATION_AUDIT_NAME,
        frequency: "Weekly",
        days: [],
        liveTime: "08:00",
        completionHours: 24,
      },
    ],
  };
}

export function buildProductionVerificationScheduleRows(options = {}) {
  const payload = buildProductionVerificationSchedulePayload(options);
  return buildSchedulesTabRows(payload, payload.assignedUsers);
}
