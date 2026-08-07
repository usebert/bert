/**
 * Production smoke verification notifications — stable IDs and operational-message markers.
 * Server-backed notifications use the OperationalMessages workbook tab.
 */
import { mapOperationalMessageRecord } from "./operational-messages.mjs";

export const PRODUCTION_VERIFICATION_NOTIFICATION_ID_PREFIX = "bert-smoke-notification-";
export const PRODUCTION_VERIFICATION_NOTIFICATION_SOURCE_ID_PREFIX = "bert-smoke-notify-source-";
export const PRODUCTION_VERIFICATION_NOTIFICATION_SUBJECT = "BERT Verification Notification";
export const PRODUCTION_VERIFICATION_NOTIFICATION_BODY =
  "Automated production Notifications workflow verification. Safe to remove.";
export const PRODUCTION_VERIFICATION_NOTIFICATION_SOURCE = "production-notifications-workflow";
export const PRODUCTION_VERIFICATION_NOTIFICATION_MARKER = "verification";
export const PRODUCTION_VERIFICATION_NOTIFICATION_CLEANED_STATUS = "archived";

export const CLIENT_DERIVED_NOTIFICATION_FAMILIES = [
  "action",
  "incident",
  "briefing",
  "document",
  "schedule",
  "risk-assessment",
  "loler",
  "coshh",
  "risk-register",
  "ncr",
  "audit",
  "sync",
  "onboarding",
];

export const CLIENT_DERIVED_SKIP_REASON =
  "Client-derived Notification Centre only; no server-persisted notification API.";

export const ESCALATION_SKIP_REASON =
  "No server-backed notification escalation engine; audit prompt escalation is email-only.";

export const SEARCH_SKIP_REASON =
  "No server-side notification search API; inbox list is the canonical read path.";

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

export function buildProductionVerificationNotificationId(runId = Date.now(), sourceType = "action") {
  const typeSlug = normalize(sourceType).replace(/[^a-z0-9]+/g, "-");
  return `${PRODUCTION_VERIFICATION_NOTIFICATION_ID_PREFIX}${runId}-${typeSlug}`;
}

export function buildProductionVerificationNotificationSourceId(runId = Date.now(), sourceType = "action") {
  const typeSlug = normalize(sourceType).replace(/[^a-z0-9]+/g, "-");
  return `${PRODUCTION_VERIFICATION_NOTIFICATION_SOURCE_ID_PREFIX}${runId}-${typeSlug}`;
}

export function isVerificationNotificationId(messageId = "") {
  return trim(messageId).startsWith(PRODUCTION_VERIFICATION_NOTIFICATION_ID_PREFIX);
}

export function isVerificationNotificationSourceId(sourceId = "") {
  return trim(sourceId).startsWith(PRODUCTION_VERIFICATION_NOTIFICATION_SOURCE_ID_PREFIX);
}

export function isVerificationNotificationMessage(record = {}) {
  const directId = trim(record.messageId || record.MessageId);
  if (isVerificationNotificationId(directId)) {
    return true;
  }
  const mapped = mapOperationalMessageRecord(record);
  if (!mapped) {
    const subject = normalize(record.subject || record.Subject);
    const body = normalize(record.messageBody || record.MessageBody);
    const relatedRecordId = trim(record.relatedRecordId || record.RelatedRecordId);
    return (
      subject.includes(normalize(PRODUCTION_VERIFICATION_NOTIFICATION_SUBJECT)) ||
      body.includes(PRODUCTION_VERIFICATION_NOTIFICATION_MARKER) ||
      body.includes(normalize(PRODUCTION_VERIFICATION_NOTIFICATION_SOURCE)) ||
      isVerificationNotificationSourceId(relatedRecordId)
    );
  }
  if (isVerificationNotificationId(mapped.messageId)) {
    return true;
  }
  const subject = normalize(mapped.subject);
  const body = normalize(mapped.messageBody);
  const relatedRecordId = trim(mapped.relatedRecordId);
  return (
    subject.includes(normalize(PRODUCTION_VERIFICATION_NOTIFICATION_SUBJECT)) ||
    body.includes(PRODUCTION_VERIFICATION_NOTIFICATION_MARKER) ||
    body.includes(normalize(PRODUCTION_VERIFICATION_NOTIFICATION_SOURCE)) ||
    isVerificationNotificationSourceId(relatedRecordId)
  );
}

export function isActiveVerificationNotificationMessage(record = {}) {
  if (!isVerificationNotificationMessage(record)) {
    return false;
  }
  const mapped = mapOperationalMessageRecord(record);
  if (!mapped) {
    return false;
  }
  return mapped.status !== PRODUCTION_VERIFICATION_NOTIFICATION_CLEANED_STATUS && mapped.status !== "archived";
}

export function isOperationalNotificationMessage(record = {}) {
  return !isVerificationNotificationMessage(record);
}

export function countNotificationBaselines(messages = [], viewerEmail = "") {
  const list = (Array.isArray(messages) ? messages : [])
    .map((item) => mapOperationalMessageRecord(item) || item)
    .filter(Boolean);
  const email = normalize(viewerEmail);
  const verification = list.filter((item) => isVerificationNotificationMessage(item));
  const activeVerification = list.filter((item) => isActiveVerificationNotificationMessage(item));
  const operational = list.filter((item) => isOperationalNotificationMessage(item));
  const mine = email
    ? list.filter(
        (item) =>
          normalize(item.recipientEmail) === email || normalize(item.recipientPersonId) === email,
      )
    : list;
  const unreadVerification = activeVerification.filter((item) => item.status === "unread");
  const unreadMine = mine.filter((item) => item.status === "unread");
  return {
    totalRows: list.length,
    operationalCount: operational.length,
    verificationCount: verification.length,
    activeVerificationCount: activeVerification.length,
    unreadVerificationCount: unreadVerification.length,
    unreadCount: unreadMine.length,
    escalationCount: 0,
    queueCount: 0,
  };
}

export function listActiveVerificationNotificationMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((item) => mapOperationalMessageRecord(item) || item)
    .filter((item) => item && isActiveVerificationNotificationMessage(item));
}

export function findVerificationNotificationById(messages = [], messageId = "") {
  const target = trim(messageId).toLowerCase();
  return listActiveVerificationNotificationMessages(messages).find(
    (item) => trim(item.messageId).toLowerCase() === target,
  );
}

export function buildVerificationNotificationMessageInput(input = {}) {
  const runId = input.runId ?? Date.now();
  const sourceType = normalize(input.sourceType || "action");
  const messageId = trim(input.messageId) || buildProductionVerificationNotificationId(runId, sourceType);
  const sourceId = trim(input.sourceId) || buildProductionVerificationNotificationSourceId(runId, sourceType);
  const recipientEmail = trim(input.recipientEmail).toLowerCase();
  const recipientName = trim(input.recipientName) || "Smoke Verifier";
  return {
    messageId,
    recipientEmail,
    recipientPersonId: recipientEmail,
    recipientName,
    subject: PRODUCTION_VERIFICATION_NOTIFICATION_SUBJECT,
    messageBody: `${PRODUCTION_VERIFICATION_NOTIFICATION_BODY} [${PRODUCTION_VERIFICATION_NOTIFICATION_MARKER}] [${PRODUCTION_VERIFICATION_NOTIFICATION_SOURCE}] [${sourceType}]`,
    relatedModule: "loler",
    relatedRecordId: sourceId,
    relatedEquipmentId: trim(input.relatedEquipmentId),
    relatedExaminationId: trim(input.relatedExaminationId),
    relatedScheduleId: trim(input.relatedScheduleId),
    sourceType,
    sourceId,
  };
}

export function verificationNotificationDeepLinkInput(message = {}, companyFolderId = "") {
  const mapped = mapOperationalMessageRecord(message) || message;
  const sourceType = normalize(mapped.sourceType || mapped.relatedModule || "equipment");
  const sourceId = trim(mapped.sourceId || mapped.relatedRecordId || mapped.relatedEquipmentId);
  if (sourceType === "action") {
    return { recordType: "action", recordId: sourceId, companyFolderId, screen: "actions" };
  }
  if (sourceType === "incident") {
    return { recordType: "incident", recordId: sourceId, companyFolderId, screen: "incidents" };
  }
  if (sourceType === "briefing") {
    return { recordType: "briefing", recordId: sourceId, companyFolderId, screen: "briefings" };
  }
  if (sourceType === "document") {
    return { recordType: "document", recordId: sourceId, companyFolderId, screen: "documents" };
  }
  if (sourceType === "schedule" || sourceType === "assigned-check") {
    return { recordType: "assigned-check", recordId: sourceId, companyFolderId, screen: "audits" };
  }
  if (sourceType === "risk-assessment") {
    return { recordType: "risk-assessment", recordId: sourceId, companyFolderId, screen: "riskAssessments" };
  }
  return {
    recordType: "equipment",
    recordId: trim(mapped.relatedEquipmentId) || sourceId,
    companyFolderId,
    screen: "loler",
  };
}
