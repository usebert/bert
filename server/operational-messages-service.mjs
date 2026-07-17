/**
 * Operational messages — company-scoped one-way internal messages (LOLER-linked first).
 * Recipient isolation enforced server-side. Never loaded during login.
 */
import {
  OPERATIONAL_MESSAGES_TAB,
  OPERATIONAL_MESSAGES_TAB_COLUMNS,
  buildOperationalMessageId,
  mapOperationalMessageRecord,
  summarizeOperationalMessages,
  validateOperationalMessageInput,
} from "../shared/operational-messages.mjs";
import { isCompanyInviteActor, isGodmodeInviteSession } from "../shared/company-invite-permissions.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

export { OPERATIONAL_MESSAGES_TAB, OPERATIONAL_MESSAGES_TAB_COLUMNS };

export const MESSAGES_ROUTE_TIMEOUT_MS = 60_000;

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveAppendTabRows(deps) {
  return typeof deps?.appendTabRows === "function" ? deps.appendTabRows : workbookAppendTabRows;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

function resolvePatchTabRowByHeader(deps) {
  return typeof deps?.patchTabRowByHeader === "function" ? deps.patchTabRowByHeader : workbookPatchTabRowByHeader;
}

export function canViewMessages(actor) {
  if (!actor?.email) {
    return false;
  }
  return actor.kind === "company" || actor.kind === "godmode" || isCompanyInviteActor(actor);
}

export function canSendMessages(actor) {
  if (!canViewMessages(actor)) {
    return false;
  }
  const role = trim(actor.role);
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function actorCanAccessCompanyMessages(actor, companyFolderId, alternateIds = []) {
  if (!canViewMessages(actor)) {
    return false;
  }
  if (isGodmodeInviteSession({ kind: actor?.kind, role: actor?.role }) || actor.kind === "godmode") {
    return Boolean(trim(companyFolderId));
  }
  const sessionCompanyId = trim(actor?.companyId || actor?.companyFolderId);
  if (!sessionCompanyId) {
    return false;
  }
  const targets = new Set([companyFolderId, ...alternateIds].map((entry) => trim(entry)).filter(Boolean));
  return targets.has(sessionCompanyId);
}

export function messagesApiFailure(code, error, httpStatus = 400, details = "") {
  const safeError = trim(error) || "Request failed.";
  return {
    ok: false,
    code,
    error: safeError,
    message: safeError,
    details: trim(details) || undefined,
    httpStatus,
  };
}

async function ensureMessagesTab(auth, deps, masterSheetId) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  await ensureTabColumns(auth, deps, masterSheetId, OPERATIONAL_MESSAGES_TAB, OPERATIONAL_MESSAGES_TAB_COLUMNS);
}

async function readMessageRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, OPERATIONAL_MESSAGES_TAB, {
    expectedHeaders: OPERATIONAL_MESSAGES_TAB_COLUMNS,
  });
  return result?.records || [];
}

function mapMessagesSafely(records = []) {
  const messages = [];
  for (const record of records) {
    try {
      const mapped = mapOperationalMessageRecord(record);
      if (mapped) {
        messages.push(mapped);
      }
    } catch {
      /* skip */
    }
  }
  return messages;
}

function isManagerViewer(actor) {
  const role = trim(actor?.role);
  return role === "Master" || role === "Admin" || role === "Manager" || actor?.kind === "godmode";
}

function filterMessagesForActor(messages, actor, companyFolderId) {
  const email = normalizeEmail(actor?.email);
  const companyId = trim(companyFolderId);
  const inCompany = messages.filter((message) => {
    const messageCompany = trim(message.companyFolderId);
    return !messageCompany || messageCompany === companyId;
  });
  if (isManagerViewer(actor)) {
    // Managers see messages they sent or received; still never cross company.
    return inCompany.filter(
      (message) =>
        normalizeEmail(message.recipientEmail) === email ||
        normalizeEmail(message.recipientPersonId) === email ||
        normalizeEmail(message.senderEmail) === email ||
        normalizeEmail(message.senderPersonId) === email,
    );
  }
  // Auditors / others: only messages addressed to them.
  return inCompany.filter(
    (message) =>
      normalizeEmail(message.recipientEmail) === email || normalizeEmail(message.recipientPersonId) === email,
  );
}

function actorIsRecipient(actor, message) {
  const email = normalizeEmail(actor?.email);
  return (
    normalizeEmail(message.recipientEmail) === email || normalizeEmail(message.recipientPersonId) === email
  );
}

export async function listOperationalMessages(auth, deps, context, actor, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return messagesApiFailure("MESSAGES_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureMessagesTab(auth, deps, masterSheetId);
  const records = await readMessageRecords(auth, deps, masterSheetId);
  const messages = filterMessagesForActor(mapMessagesSafely(records), actor, companyFolderId).filter((message) => {
    if (options.includeArchived) {
      return true;
    }
    return message.status !== "archived";
  });
  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    messages,
    summary: summarizeOperationalMessages(messages, actor?.email),
  };
}

export async function createOperationalMessage(auth, deps, context, actor, input = {}, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return messagesApiFailure("MESSAGES_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  if (!canSendMessages(actor) && !options.allowAsRecorder) {
    return messagesApiFailure("MESSAGES_FORBIDDEN", "You do not have permission to send messages.", 403);
  }
  await ensureMessagesTab(auth, deps, masterSheetId);

  const validation = validateOperationalMessageInput(input);
  if (!validation.ok) {
    return messagesApiFailure("MESSAGES_VALIDATION_FAILED", validation.errors.join(" "), 400);
  }

  const appendTabRows = resolveAppendTabRows(deps);
  const messageId = buildOperationalMessageId();
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const sentAt = nowIso();
  const row = {
    MessageId: messageId,
    CompanyFolderId: companyFolderId,
    RecipientPersonId: validation.normalized.recipientPersonId,
    RecipientName: validation.normalized.recipientName,
    RecipientEmail: validation.normalized.recipientEmail,
    SenderPersonId: actorEmail,
    SenderName: trim(actor?.name || actor?.displayName || ""),
    SenderEmail: actorEmail,
    Subject: validation.normalized.subject,
    MessageBody: validation.normalized.messageBody,
    RelatedModule: validation.normalized.relatedModule,
    RelatedRecordId: validation.normalized.relatedRecordId,
    RelatedEquipmentId: validation.normalized.relatedEquipmentId,
    RelatedExaminationId: validation.normalized.relatedExaminationId,
    RelatedScheduleId: validation.normalized.relatedScheduleId,
    SentAt: sentAt,
    ReadAt: "",
    Status: "unread",
    ArchivedAt: "",
    ArchivedBy: "",
  };
  await appendTabRows(auth, deps, masterSheetId, OPERATIONAL_MESSAGES_TAB, OPERATIONAL_MESSAGES_TAB_COLUMNS, [row]);
  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    message: mapOperationalMessageRecord(row),
  };
}

export async function markOperationalMessageRead(auth, deps, context, actor, messageId) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return messagesApiFailure("MESSAGES_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureMessagesTab(auth, deps, masterSheetId);
  const records = await readMessageRecords(auth, deps, masterSheetId);
  const currentRecord = records.find((record) => trim(record.MessageId) === trim(messageId));
  if (!currentRecord) {
    return messagesApiFailure("MESSAGES_NOT_FOUND", "Message was not found.", 404);
  }
  const current = mapOperationalMessageRecord(currentRecord);
  if (trim(current.companyFolderId) && trim(current.companyFolderId) !== companyFolderId) {
    return messagesApiFailure("MESSAGES_COMPANY_MISMATCH", "Message does not belong to this company.", 403);
  }
  if (!actorIsRecipient(actor, current) && !isManagerViewer(actor)) {
    return messagesApiFailure("MESSAGES_FORBIDDEN", "You cannot read this message.", 403);
  }
  if (!actorIsRecipient(actor, current)) {
    // Managers who are not recipients still cannot mark another person's private message read
    // unless they are the recipient.
    return messagesApiFailure("MESSAGES_FORBIDDEN", "Only the recipient can mark this message read.", 403);
  }
  if (current.status === "archived") {
    return messagesApiFailure("MESSAGES_ARCHIVED", "Archived messages cannot be marked read.", 409);
  }

  const readAt = nowIso();
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, masterSheetId, OPERATIONAL_MESSAGES_TAB, "MessageId", messageId, {
    Status: "read",
    ReadAt: readAt,
  });
  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    message: { ...current, status: "read", readAt, needsAction: false },
  };
}

export async function archiveOperationalMessage(auth, deps, context, actor, messageId) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return messagesApiFailure("MESSAGES_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureMessagesTab(auth, deps, masterSheetId);
  const records = await readMessageRecords(auth, deps, masterSheetId);
  const currentRecord = records.find((record) => trim(record.MessageId) === trim(messageId));
  if (!currentRecord) {
    return messagesApiFailure("MESSAGES_NOT_FOUND", "Message was not found.", 404);
  }
  const current = mapOperationalMessageRecord(currentRecord);
  if (trim(current.companyFolderId) && trim(current.companyFolderId) !== companyFolderId) {
    return messagesApiFailure("MESSAGES_COMPANY_MISMATCH", "Message does not belong to this company.", 403);
  }
  if (!actorIsRecipient(actor, current) && !canSendMessages(actor)) {
    return messagesApiFailure("MESSAGES_FORBIDDEN", "You cannot archive this message.", 403);
  }
  if (current.status === "archived") {
    return messagesApiFailure("MESSAGES_ALREADY_ARCHIVED", "Message is already archived.", 409);
  }

  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const archivedAt = nowIso();
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, masterSheetId, OPERATIONAL_MESSAGES_TAB, "MessageId", messageId, {
    Status: "archived",
    ArchivedAt: archivedAt,
    ArchivedBy: actorEmail,
  });
  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    message: { ...current, status: "archived", archivedAt, archivedBy: actorEmail, needsAction: false },
  };
}
