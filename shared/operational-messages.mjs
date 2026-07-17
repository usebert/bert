/**
 * Operational messages — short internal one-way messages linked to modules (LOLER first).
 * Not a chat system: no threads, typing, or groups.
 */

export const OPERATIONAL_MESSAGES_TAB = "OperationalMessages";

export const OPERATIONAL_MESSAGES_TAB_COLUMNS = [
  "MessageId",
  "CompanyFolderId",
  "RecipientPersonId",
  "RecipientName",
  "RecipientEmail",
  "SenderPersonId",
  "SenderName",
  "SenderEmail",
  "Subject",
  "MessageBody",
  "RelatedModule",
  "RelatedRecordId",
  "RelatedEquipmentId",
  "RelatedExaminationId",
  "RelatedScheduleId",
  "SentAt",
  "ReadAt",
  "Status",
  "ArchivedAt",
  "ArchivedBy",
];

export const OPERATIONAL_MESSAGE_STATUSES = ["unread", "read", "archived"];
export const OPERATIONAL_RELATED_MODULES = ["loler"];

function trim(value) {
  return String(value ?? "").trim();
}

export function buildOperationalMessageId(now = Date.now()) {
  const suffix = Math.floor(Math.random() * 46_656)
    .toString(36)
    .padStart(3, "0");
  return `MSG-${now.toString(36).toUpperCase()}-${suffix.toUpperCase()}`;
}

export function validateOperationalMessageInput(input = {}) {
  const errors = [];
  const recipientEmail = trim(input.recipientEmail || input.recipientPersonId).toLowerCase();
  const recipientPersonId = trim(input.recipientPersonId || recipientEmail).toLowerCase();
  const subject = trim(input.subject);
  const messageBody = trim(input.messageBody || input.message);
  const relatedModule = trim(input.relatedModule || "loler").toLowerCase();

  if (!recipientEmail && !recipientPersonId) {
    errors.push("Recipient is required.");
  }
  if (!subject) {
    errors.push("Subject is required.");
  }
  if (!messageBody) {
    errors.push("Message body is required.");
  }
  if (relatedModule && !OPERATIONAL_RELATED_MODULES.includes(relatedModule)) {
    errors.push(`Related module must be one of: ${OPERATIONAL_RELATED_MODULES.join(", ")}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      recipientPersonId: recipientPersonId || recipientEmail,
      recipientName: trim(input.recipientName),
      recipientEmail: recipientEmail || recipientPersonId,
      subject,
      messageBody,
      relatedModule: relatedModule || "loler",
      relatedRecordId: trim(input.relatedRecordId),
      relatedEquipmentId: trim(input.relatedEquipmentId),
      relatedExaminationId: trim(input.relatedExaminationId),
      relatedScheduleId: trim(input.relatedScheduleId),
    },
  };
}

function pickField(record = {}, header) {
  const direct = trim(record[header]);
  if (direct) {
    return direct;
  }
  const lower = trim(header).toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (trim(key).toLowerCase() === lower && trim(value)) {
      return trim(value);
    }
  }
  return "";
}

export function mapOperationalMessageRecord(record = {}) {
  const id = pickField(record, "MessageId");
  if (!id) {
    return null;
  }
  const status = (pickField(record, "Status") || "unread").toLowerCase();
  return {
    messageId: id,
    companyFolderId: pickField(record, "CompanyFolderId"),
    recipientPersonId: pickField(record, "RecipientPersonId").toLowerCase() || undefined,
    recipientName: pickField(record, "RecipientName") || undefined,
    recipientEmail: pickField(record, "RecipientEmail").toLowerCase() || undefined,
    senderPersonId: pickField(record, "SenderPersonId").toLowerCase() || undefined,
    senderName: pickField(record, "SenderName") || undefined,
    senderEmail: pickField(record, "SenderEmail").toLowerCase() || undefined,
    subject: pickField(record, "Subject"),
    messageBody: pickField(record, "MessageBody"),
    relatedModule: (pickField(record, "RelatedModule") || "loler").toLowerCase(),
    relatedRecordId: pickField(record, "RelatedRecordId") || undefined,
    relatedEquipmentId: pickField(record, "RelatedEquipmentId") || undefined,
    relatedExaminationId: pickField(record, "RelatedExaminationId") || undefined,
    relatedScheduleId: pickField(record, "RelatedScheduleId") || undefined,
    sentAt: pickField(record, "SentAt"),
    readAt: pickField(record, "ReadAt") || undefined,
    status,
    archivedAt: pickField(record, "ArchivedAt") || undefined,
    archivedBy: pickField(record, "ArchivedBy") || undefined,
    needsAction: status === "unread",
  };
}

export function summarizeOperationalMessages(messages = [], viewerEmail = "") {
  const email = trim(viewerEmail).toLowerCase();
  const mine = email
    ? messages.filter(
        (message) =>
          trim(message.recipientEmail).toLowerCase() === email ||
          trim(message.recipientPersonId).toLowerCase() === email,
      )
    : messages;
  return {
    total: mine.length,
    unread: mine.filter((message) => message.status === "unread").length,
    archived: mine.filter((message) => message.status === "archived").length,
  };
}
