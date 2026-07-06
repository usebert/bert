/**
 * Briefings service — Briefings + BriefingRecipients workbook tabs.
 */
import { isCompanyInviteActor, isGodmodeInviteSession } from "../shared/company-invite-permissions.mjs";
import {
  BRIEFINGS_TAB,
  BRIEFINGS_TAB_COLUMNS,
  BRIEFING_RECIPIENTS_TAB,
  BRIEFING_RECIPIENTS_TAB_COLUMNS,
  BRIEFING_PRIORITIES,
  BRIEFING_RENEWAL_FREQUENCIES,
  BRIEFING_RECIPIENT_AREA_HEADERS,
  BRIEFING_RECIPIENT_DEPARTMENT_HEADERS,
  BRIEFING_RECIPIENT_EMAIL_HEADERS,
  BRIEFING_RECIPIENT_NAME_HEADERS,
  BRIEFING_RECIPIENT_ROLE_HEADERS,
  BRIEFING_RECIPIENT_SOURCE_TABS,
  BRIEFING_RECIPIENT_STATUS_HEADERS,
  BRIEFING_TARGET_MODES,
  BRIEFING_TYPES,
  isUsableBriefingRecipientStatus,
  pickBriefingRecipientField,
} from "../shared/briefings.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
  writeTabRecords as workbookWriteTabRecords,
} from "./workbook-service.mjs";
import {
  withOperationTimeout,
  DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS,
} from "./ensure-required-tabs.mjs";
import { ensureBriefingDocumentFolderId } from "./company-folder-structure.mjs";

export {
  BRIEFINGS_TAB,
  BRIEFINGS_TAB_COLUMNS,
  BRIEFING_RECIPIENTS_TAB,
  BRIEFING_RECIPIENTS_TAB_COLUMNS,
  isUsableBriefingRecipientStatus,
};

export const BRIEFINGS_ROUTE_TIMEOUT_MS = 90_000;
export const BRIEFINGS_GOOGLE_TIMEOUT_MS = Math.min(DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS, 75_000);

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function boolText(value) {
  return value === true || trim(value).toLowerCase() === "true" || trim(value).toLowerCase() === "yes" ? "Yes" : "No";
}

function parseBool(value) {
  const text = trim(value).toLowerCase();
  return text === "true" || text === "yes" || text === "1";
}

function pickRecordField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) {
      return direct;
    }
  }
  const lowerKeys = keys.map((key) => trim(key).toLowerCase());
  for (const [header, value] of Object.entries(record)) {
    if (lowerKeys.includes(trim(header).toLowerCase()) && trim(value)) {
      return trim(value);
    }
  }
  return "";
}

function nowIso() {
  return new Date().toISOString();
}

export function buildBriefingId() {
  const year = new Date().getFullYear();
  const suffix = String(Math.floor(Math.random() * 9000) + 1000);
  return `BRF-${year}-${suffix}`;
}

function resolveAppendTabRows(deps) {
  return typeof deps?.appendTabRows === "function" ? deps.appendTabRows : workbookAppendTabRows;
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

function resolvePatchTabRowByHeader(deps) {
  return typeof deps?.patchTabRowByHeader === "function" ? deps.patchTabRowByHeader : workbookPatchTabRowByHeader;
}

export function canAccessBriefings(actor) {
  if (!actor?.email) {
    return false;
  }
  return actor.kind === "company" || actor.kind === "godmode" || isCompanyInviteActor(actor);
}

export function canManageBriefings(actor) {
  if (!canAccessBriefings(actor)) {
    return false;
  }
  const role = trim(actor.role);
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canViewBriefingsTracker(actor) {
  return canManageBriefings(actor);
}

export function briefingApiFailure(code, error, details = "", httpStatus = 400) {
  const safeError = trim(error) || "Request failed.";
  const safeDetails = trim(details);
  return {
    ok: false,
    code,
    error: safeError,
    details: safeDetails || undefined,
    message: safeError,
    httpStatus,
  };
}

function normalizeContextFailure(context = {}) {
  if (context?.ok) {
    return context;
  }
  return briefingApiFailure(
    context.code || "BRIEFING_CONTEXT_FAILED",
    context.error || context.message || "Company workspace could not be resolved.",
    context.details || "",
    context.httpStatus || 404,
  );
}

export function actorCanAccessCompanyBriefings(actor, companyFolderId, alternateIds = []) {
  if (!canAccessBriefings(actor)) {
    return false;
  }
  if (isGodmodeInviteSession({ kind: actor?.kind, role: actor?.role })) {
    return Boolean(trim(companyFolderId));
  }
  const sessionCompanyId = trim(actor?.companyId || actor?.companyFolderId);
  if (!sessionCompanyId) {
    return false;
  }
  const targets = new Set(
    [companyFolderId, ...alternateIds].map((entry) => trim(entry)).filter(Boolean),
  );
  return targets.has(sessionCompanyId);
}

function normalizeDueDate(value) {
  const raw = trim(value);
  if (!raw) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const date = new Date(parsed);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isBenignTabReadError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("unable to parse range") ||
    message.includes("not found") ||
    message.includes("is empty or missing") ||
    message.includes('tab ""')
  );
}

export function mapBriefingRecord(record = {}) {
  return {
    briefingId: pickRecordField(record, "BriefingId"),
    title: pickRecordField(record, "Title"),
    type: pickRecordField(record, "Type") || "Other",
    status: pickRecordField(record, "Status") || "Sent",
    priority: pickRecordField(record, "Priority") || "Normal",
    createdByEmail: pickRecordField(record, "CreatedByEmail"),
    createdByName: pickRecordField(record, "CreatedByName"),
    createdAt: pickRecordField(record, "CreatedAt"),
    sentAt: pickRecordField(record, "SentAt"),
    dueDate: pickRecordField(record, "DueDate") || undefined,
    requiresRead: parseBool(pickRecordField(record, "RequiresRead")),
    requiresAcknowledgement: parseBool(pickRecordField(record, "RequiresAcknowledgement")),
    requiresSignature: parseBool(pickRecordField(record, "RequiresSignature")),
    requiresReply: parseBool(pickRecordField(record, "RequiresReply")),
    renewalFrequency: pickRecordField(record, "RenewalFrequency") || "None",
    renewalDueDate: pickRecordField(record, "RenewalDueDate") || undefined,
    targetMode: pickRecordField(record, "TargetMode") || "everyone",
    targetRoles: pickRecordField(record, "TargetRoles") || undefined,
    targetAreas: pickRecordField(record, "TargetAreas") || undefined,
    targetDepartments: pickRecordField(record, "TargetDepartments") || undefined,
    targetUserEmails: pickRecordField(record, "TargetUserEmails") || undefined,
    documentName: pickRecordField(record, "DocumentName") || undefined,
    documentDriveFileId: pickRecordField(record, "DocumentDriveFileId") || undefined,
    documentDriveLink: pickRecordField(record, "DocumentDriveLink") || undefined,
    message: pickRecordField(record, "Message"),
    recipientCount: Number(pickRecordField(record, "RecipientCount")) || 0,
    openedCount: Number(pickRecordField(record, "OpenedCount")) || 0,
    readCount: Number(pickRecordField(record, "ReadCount")) || 0,
    acknowledgedCount: Number(pickRecordField(record, "AcknowledgedCount")) || 0,
    signedCount: Number(pickRecordField(record, "SignedCount")) || 0,
    replyCount: Number(pickRecordField(record, "ReplyCount")) || 0,
    overdueCount: Number(pickRecordField(record, "OverdueCount")) || 0,
  };
}

export function mapRecipientRecord(record = {}) {
  return {
    briefingId: pickRecordField(record, "BriefingId"),
    recipientEmail: normalizeEmail(pickRecordField(record, "RecipientEmail")),
    recipientName: pickRecordField(record, "RecipientName"),
    role: pickRecordField(record, "Role") || undefined,
    area: pickRecordField(record, "Area") || undefined,
    department: pickRecordField(record, "Department") || undefined,
    sentAt: pickRecordField(record, "SentAt"),
    openedAt: pickRecordField(record, "OpenedAt") || undefined,
    readAt: pickRecordField(record, "ReadAt") || undefined,
    acknowledgedAt: pickRecordField(record, "AcknowledgedAt") || undefined,
    signedAt: pickRecordField(record, "SignedAt") || undefined,
    replyText: pickRecordField(record, "ReplyText") || undefined,
    replyAt: pickRecordField(record, "ReplyAt") || undefined,
    status: pickRecordField(record, "Status") || "New",
    overdue: parseBool(pickRecordField(record, "Overdue")),
    signatureName: pickRecordField(record, "SignatureName") || undefined,
    lastReminderAt: pickRecordField(record, "LastReminderAt") || undefined,
  };
}

export function recipientNeedsAction(recipient, briefing) {
  if (!recipient || !briefing) {
    return false;
  }
  if (briefing.requiresRead && !recipient.readAt) {
    return true;
  }
  if (briefing.requiresAcknowledgement && !recipient.acknowledgedAt) {
    return true;
  }
  if (briefing.requiresSignature && !recipient.signedAt) {
    return true;
  }
  if (briefing.requiresReply && !recipient.replyAt) {
    return true;
  }
  if (!briefing.requiresRead && !briefing.requiresAcknowledgement && !briefing.requiresSignature && !briefing.requiresReply) {
    return !recipient.openedAt;
  }
  return false;
}

export function computeRecipientStatus(recipient, briefing) {
  const dueDate = trim(briefing?.dueDate);
  const overdue =
    dueDate &&
    recipientNeedsAction(recipient, briefing) &&
    Date.parse(`${dueDate}T23:59:59.999Z`) < Date.now();

  if (overdue) {
    return "Overdue";
  }
  if (!recipientNeedsAction(recipient, briefing)) {
    return "Complete";
  }
  if (briefing?.requiresReply && recipient.replyAt) {
    return "Replied";
  }
  if (briefing?.requiresSignature && recipient.signedAt) {
    return "Signed";
  }
  if (briefing?.requiresAcknowledgement && recipient.acknowledgedAt) {
    return "Acknowledged";
  }
  if (briefing?.requiresRead && recipient.readAt) {
    return "Read";
  }
  if (recipient.openedAt) {
    return "Opened";
  }
  return "New";
}

export function briefingActionLabel(briefing) {
  if (briefing?.requiresSignature) {
    return "Sign";
  }
  if (briefing?.requiresAcknowledgement) {
    return "Acknowledge";
  }
  if (briefing?.requiresReply) {
    return "Reply";
  }
  if (briefing?.requiresRead) {
    return "Read";
  }
  return "Open";
}

function profileMatchesTarget(profile, input) {
  const mode = trim(input.targetMode).toLowerCase();
  if (mode === "everyone") {
    return true;
  }
  const email = normalizeEmail(profile.email);
  if (mode === "users") {
    const targets = (input.targetUserEmails || []).map(normalizeEmail);
    return targets.includes(email);
  }
  if (mode === "role") {
    const roles = (input.targetRoles || []).map((entry) => trim(entry).toLowerCase());
    return roles.includes(trim(profile.role).toLowerCase());
  }
  if (mode === "area") {
    const areas = (input.targetAreas || []).map((entry) => trim(entry).toLowerCase());
    return areas.includes(trim(profile.area || profile.siteArea).toLowerCase());
  }
  if (mode === "department") {
    const departments = (input.targetDepartments || []).map((entry) => trim(entry).toLowerCase());
    return departments.includes(trim(profile.department).toLowerCase());
  }
  return false;
}

export function validateBriefingCreateInput(input = {}) {
  const title = trim(input.title);
  if (!title) {
    return briefingApiFailure("BRIEFING_TITLE_REQUIRED", "Title is required.");
  }
  const type = trim(input.type);
  if (!BRIEFING_TYPES.includes(type)) {
    return briefingApiFailure("BRIEFING_TYPE_INVALID", "Briefing type is invalid.");
  }
  const priority = trim(input.priority || "Normal");
  if (!BRIEFING_PRIORITIES.includes(priority)) {
    return briefingApiFailure("BRIEFING_PRIORITY_INVALID", "Priority is invalid.");
  }
  const targetMode = trim(input.targetMode).toLowerCase();
  if (!BRIEFING_TARGET_MODES.includes(targetMode)) {
    return briefingApiFailure("BRIEFING_TARGET_INVALID", "Recipient target mode is invalid.");
  }
  const renewalFrequency = trim(input.renewalFrequency || "None");
  if (!BRIEFING_RENEWAL_FREQUENCIES.includes(renewalFrequency)) {
    return briefingApiFailure("BRIEFING_RENEWAL_INVALID", "Renewal frequency is invalid.");
  }
  if (targetMode === "users" && !(input.targetUserEmails || []).length) {
    return briefingApiFailure("BRIEFING_RECIPIENTS_REQUIRED", "Select at least one recipient.");
  }
  let dueDate = "";
  if (input.dueDate !== undefined && input.dueDate !== null && trim(input.dueDate)) {
    const normalized = normalizeDueDate(input.dueDate);
    if (normalized === null) {
      return briefingApiFailure(
        "BRIEFING_DUE_DATE_INVALID",
        "Due date format is invalid. Use YYYY-MM-DD.",
        trim(input.dueDate),
      );
    }
    dueDate = normalized;
  }
  return { ok: true, dueDate: dueDate || undefined, targetMode };
}

export function buildBriefingRow(input = {}) {
  const briefingId = trim(input.briefingId) || buildBriefingId();
  const sentAt = trim(input.sentAt) || nowIso();
  return {
    BriefingId: briefingId,
    Title: trim(input.title),
    Type: trim(input.type),
    Status: trim(input.status) || "Sent",
    Priority: trim(input.priority) || "Normal",
    CreatedByEmail: normalizeEmail(input.createdByEmail),
    CreatedByName: trim(input.createdByName),
    CreatedAt: trim(input.createdAt) || sentAt,
    SentAt: sentAt,
    DueDate: trim(input.dueDate),
    RequiresRead: boolText(input.requiresRead),
    RequiresAcknowledgement: boolText(input.requiresAcknowledgement),
    RequiresSignature: boolText(input.requiresSignature),
    RequiresReply: boolText(input.requiresReply),
    RenewalFrequency: trim(input.renewalFrequency) || "None",
    RenewalDueDate: trim(input.renewalDueDate),
    TargetMode: trim(input.targetMode),
    TargetRoles: (input.targetRoles || []).join(", "),
    TargetAreas: (input.targetAreas || []).join(", "),
    TargetDepartments: (input.targetDepartments || []).join(", "),
    TargetUserEmails: (input.targetUserEmails || []).map(normalizeEmail).join(", "),
    DocumentName: trim(input.documentName),
    DocumentDriveFileId: trim(input.documentDriveFileId),
    DocumentDriveLink: trim(input.documentDriveLink),
    Message: trim(input.message),
    RecipientCount: String(Number(input.recipientCount) || 0),
    OpenedCount: "0",
    ReadCount: "0",
    AcknowledgedCount: "0",
    SignedCount: "0",
    ReplyCount: "0",
    OverdueCount: "0",
  };
}

export function buildRecipientRow(input = {}) {
  const sentAt = trim(input.sentAt) || nowIso();
  return {
    BriefingId: trim(input.briefingId),
    RecipientEmail: normalizeEmail(input.recipientEmail),
    RecipientName: trim(input.recipientName),
    Role: trim(input.role),
    Area: trim(input.area),
    Department: trim(input.department),
    SentAt: sentAt,
    OpenedAt: trim(input.openedAt),
    ReadAt: trim(input.readAt),
    AcknowledgedAt: trim(input.acknowledgedAt),
    SignedAt: trim(input.signedAt),
    ReplyText: trim(input.replyText),
    ReplyAt: trim(input.replyAt),
    Status: trim(input.status) || "New",
    Overdue: boolText(input.overdue),
    SignatureName: trim(input.signatureName),
    LastReminderAt: trim(input.lastReminderAt),
  };
}

async function ensureBriefingsTabs(auth, deps, masterSheetId) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  await ensureTabColumns(auth, deps, masterSheetId, BRIEFINGS_TAB, BRIEFINGS_TAB_COLUMNS);
  await ensureTabColumns(auth, deps, masterSheetId, BRIEFING_RECIPIENTS_TAB, BRIEFING_RECIPIENTS_TAB_COLUMNS);
}

async function readAllBriefings(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  await ensureBriefingsTabs(auth, deps, masterSheetId);
  const result = await readTabRecords(auth, deps, masterSheetId, BRIEFINGS_TAB);
  return (result.records || []).map(mapBriefingRecord);
}

async function readAllRecipients(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  await ensureBriefingsTabs(auth, deps, masterSheetId);
  const result = await readTabRecords(auth, deps, masterSheetId, BRIEFING_RECIPIENTS_TAB);
  return (result.records || []).map(mapRecipientRecord);
}

async function safeReadAllBriefings(auth, deps, masterSheetId) {
  try {
    return await readAllBriefings(auth, deps, masterSheetId);
  } catch (error) {
    if (isBenignTabReadError(error)) {
      return [];
    }
    throw error;
  }
}

async function safeReadAllRecipients(auth, deps, masterSheetId) {
  try {
    return await readAllRecipients(auth, deps, masterSheetId);
  } catch (error) {
    if (isBenignTabReadError(error)) {
      return [];
    }
    throw error;
  }
}

export function mapRecordToBriefingRecipientProfile(record = {}) {
  const email = normalizeEmail(pickBriefingRecipientField(record, ...BRIEFING_RECIPIENT_EMAIL_HEADERS));
  if (!email || !email.includes("@")) {
    return null;
  }
  const status = pickBriefingRecipientField(record, ...BRIEFING_RECIPIENT_STATUS_HEADERS);
  if (!isUsableBriefingRecipientStatus(status)) {
    return null;
  }
  const name =
    pickBriefingRecipientField(record, ...BRIEFING_RECIPIENT_NAME_HEADERS) || email.split("@")[0] || email;
  const role = pickBriefingRecipientField(record, ...BRIEFING_RECIPIENT_ROLE_HEADERS);
  const area = pickBriefingRecipientField(record, ...BRIEFING_RECIPIENT_AREA_HEADERS);
  const department = pickBriefingRecipientField(record, ...BRIEFING_RECIPIENT_DEPARTMENT_HEADERS);
  return {
    email,
    name,
    displayName: name,
    role,
    area,
    siteArea: area,
    department,
    status,
  };
}

export function expandBriefingRecipientProfilesFromRecords(records = []) {
  const profiles = [];
  const seen = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    const profile = mapRecordToBriefingRecipientProfile(record);
    if (!profile || seen.has(profile.email)) {
      continue;
    }
    seen.add(profile.email);
    profiles.push(profile);
  }
  return profiles;
}

function buildBriefingRecipientExpansionDebug(tabsChecked = [], counts = {}) {
  const parts = [];
  if (tabsChecked.length) {
    parts.push(`tabs checked: ${tabsChecked.join(", ")}`);
  }
  if (typeof counts.peopleRows === "number") {
    parts.push(`People rows: ${counts.peopleRows}`);
  }
  if (typeof counts.usersRows === "number") {
    parts.push(`Users rows: ${counts.usersRows}`);
  }
  if (typeof counts.usableProfiles === "number") {
    parts.push(`usable profiles: ${counts.usableProfiles}`);
  }
  if (typeof counts.matchedProfiles === "number") {
    parts.push(`matched target: ${counts.matchedProfiles}`);
  }
  return parts.join("; ");
}

async function readBriefingRecipientSourceRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const tabsChecked = [];
  const counts = { peopleRows: 0, usersRows: 0 };
  let peopleRecords = [];
  let usersRecords = [];

  for (const tabName of BRIEFING_RECIPIENT_SOURCE_TABS) {
    tabsChecked.push(tabName);
    try {
      const result = await readTabRecords(auth, deps, masterSheetId, tabName);
      const records = result?.records || [];
      if (tabName === "People") {
        peopleRecords = records;
        counts.peopleRows = records.length;
      } else if (tabName === "Users") {
        usersRecords = records;
        counts.usersRows = records.length;
      }
    } catch (error) {
      if (!isBenignTabReadError(error)) {
        throw error;
      }
    }
  }

  const peopleProfiles = expandBriefingRecipientProfilesFromRecords(peopleRecords);
  if (peopleProfiles.length) {
    return {
      records: peopleRecords,
      profiles: peopleProfiles,
      sourceTab: "People",
      tabsChecked,
      counts: { ...counts, usableProfiles: peopleProfiles.length },
    };
  }

  const usersProfiles = expandBriefingRecipientProfilesFromRecords(usersRecords);
  return {
    records: usersRecords,
    profiles: usersProfiles,
    sourceTab: usersProfiles.length ? "Users" : null,
    tabsChecked,
    counts: { ...counts, usableProfiles: usersProfiles.length },
  };
}

async function resolveRecipientsForTarget(auth, deps, companyContext, input) {
  const masterSheetId = trim(companyContext?.masterSheetId);
  const expansion = await readBriefingRecipientSourceRecords(auth, deps, masterSheetId);
  const matched = expansion.profiles.filter((profile) => profileMatchesTarget(profile, input));
  return {
    profiles: matched,
    expansion: {
      ...expansion,
      counts: {
        ...expansion.counts,
        matchedProfiles: matched.length,
      },
    },
  };
}

function aggregateBriefingCounts(recipients = []) {
  let openedCount = 0;
  let readCount = 0;
  let acknowledgedCount = 0;
  let signedCount = 0;
  let replyCount = 0;
  let overdueCount = 0;
  recipients.forEach((recipient) => {
    if (recipient.openedAt) openedCount += 1;
    if (recipient.readAt) readCount += 1;
    if (recipient.acknowledgedAt) acknowledgedCount += 1;
    if (recipient.signedAt) signedCount += 1;
    if (recipient.replyAt) replyCount += 1;
    if (recipient.overdue || recipient.status === "Overdue") overdueCount += 1;
  });
  return { openedCount, readCount, acknowledgedCount, signedCount, replyCount, overdueCount };
}

async function refreshBriefingCounts(auth, deps, masterSheetId, briefingId, recipientsForBriefing) {
  const counts = aggregateBriefingCounts(recipientsForBriefing);
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, masterSheetId, BRIEFINGS_TAB, "BriefingId", briefingId, {
    OpenedCount: String(counts.openedCount),
    ReadCount: String(counts.readCount),
    AcknowledgedCount: String(counts.acknowledgedCount),
    SignedCount: String(counts.signedCount),
    ReplyCount: String(counts.replyCount),
    OverdueCount: String(counts.overdueCount),
    RecipientCount: String(recipientsForBriefing.length),
  });
  return counts;
}

async function resolveCompanyContext(auth, deps, actor, companyFolderId) {
  const resolver =
    typeof deps?.resolveCompanyScheduleContext === "function"
      ? deps.resolveCompanyScheduleContext
      : resolveCompanyScheduleContext;
  return resolver(auth, deps, {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(actor?.masterSheetId),
  });
}

export async function createAndSendBriefing(auth, deps, actor, companyFolderId, input = {}) {
  if (!canManageBriefings(actor)) {
    return briefingApiFailure("BRIEFING_FORBIDDEN", "You do not have permission to send briefings.", "", 403);
  }

  const validation = validateBriefingCreateInput(input);
  if (!validation.ok) {
    return validation;
  }

  const context = await resolveCompanyContext(auth, deps, actor, companyFolderId);
  if (!context?.ok) {
    return normalizeContextFailure(context);
  }
  if (!actorCanAccessCompanyBriefings(actor, companyFolderId, context.alternateIds)) {
    return briefingApiFailure(
      "BRIEFING_COMPANY_MISMATCH",
      "Briefing must be sent within your company workspace.",
      "",
      403,
    );
  }

  const briefingId = buildBriefingId();
  const sentAt = nowIso();
  const targetInput = { ...input, targetMode: validation.targetMode || input.targetMode };
  const recipientResolution = await resolveRecipientsForTarget(auth, deps, context, targetInput);
  const targetProfiles = recipientResolution.profiles || [];
  if (!targetProfiles.length) {
    const debugDetails = buildBriefingRecipientExpansionDebug(
      recipientResolution.expansion?.tabsChecked,
      recipientResolution.expansion?.counts,
    );
    return briefingApiFailure(
      "BRIEFING_NO_RECIPIENTS",
      "No recipients matched the selected target.",
      debugDetails ||
        "Add users to your company workbook or choose a different recipient group.",
    );
  }

  let documentDriveFileId = trim(input.documentDriveFileId);
  let documentDriveLink = trim(input.documentDriveLink);
  const documentName = trim(input.documentName);
  if (documentDriveFileId && !documentDriveLink) {
    documentDriveLink = `https://drive.google.com/file/d/${documentDriveFileId}/view`;
  }

  const briefingRow = buildBriefingRow({
    ...input,
    ...targetInput,
    briefingId,
    sentAt,
    dueDate: validation.dueDate ?? input.dueDate,
    createdByEmail: actor.email,
    createdByName: trim(actor.name || actor.displayName || actor.email),
    recipientCount: targetProfiles.length,
    documentDriveFileId,
    documentDriveLink,
    documentName,
  });

  const recipientRows = targetProfiles.map((profile) =>
    buildRecipientRow({
      briefingId,
      recipientEmail: profile.email,
      recipientName: trim(profile.name || profile.displayName || profile.email),
      role: profile.role,
      area: profile.area || profile.siteArea,
      department: profile.department,
      sentAt,
      status: "New",
    }),
  );

  const appendTabRows = resolveAppendTabRows(deps);
  await ensureBriefingsTabs(auth, deps, context.masterSheetId);
  await appendTabRows(auth, deps, context.masterSheetId, BRIEFINGS_TAB, BRIEFINGS_TAB_COLUMNS, [briefingRow]);
  await appendTabRows(
    auth,
    deps,
    context.masterSheetId,
    BRIEFING_RECIPIENTS_TAB,
    BRIEFING_RECIPIENTS_TAB_COLUMNS,
    recipientRows,
  );

  return {
    ok: true,
    briefing: mapBriefingRecord(briefingRow),
    recipientCount: recipientRows.length,
  };
}

export async function listMyBriefings(auth, deps, actor, companyFolderId) {
  if (!canAccessBriefings(actor)) {
    return briefingApiFailure("BRIEFING_FORBIDDEN", "You do not have permission to view briefings.", "", 403);
  }
  const context = await resolveCompanyContext(auth, deps, actor, companyFolderId);
  if (!context?.ok) {
    return normalizeContextFailure(context);
  }
  if (!actorCanAccessCompanyBriefings(actor, companyFolderId, context.alternateIds)) {
    return briefingApiFailure("BRIEFING_FORBIDDEN", "You do not have permission to view briefings.", "", 403);
  }
  const email = normalizeEmail(actor.email);
  const briefings = await safeReadAllBriefings(auth, deps, context.masterSheetId);
  const recipients = await safeReadAllRecipients(auth, deps, context.masterSheetId);
  const briefingById = new Map(briefings.map((briefing) => [briefing.briefingId, briefing]));
  const mine = recipients
    .filter((recipient) => recipient.recipientEmail === email)
    .map((recipient) => {
      const briefing = briefingById.get(recipient.briefingId);
      const status = computeRecipientStatus(recipient, briefing);
      return {
        ...recipient,
        status,
        overdue: status === "Overdue",
        briefing,
        needsAction: briefing ? recipientNeedsAction(recipient, briefing) : false,
      };
    })
    .sort((a, b) => Date.parse(b.sentAt || 0) - Date.parse(a.sentAt || 0));
  return { ok: true, items: mine };
}

export async function listBriefingsTodoPreview(auth, deps, actor, companyFolderId, limit = 5) {
  const result = await listMyBriefings(auth, deps, actor, companyFolderId);
  if (!result.ok) {
    return result;
  }
  const pending = (result.items || []).filter((item) => item.needsAction);
  return { ok: true, items: pending.slice(0, Math.max(1, Number(limit) || 5)) };
}

export async function listBriefingsTracker(auth, deps, actor, companyFolderId) {
  if (!canViewBriefingsTracker(actor)) {
    return briefingApiFailure(
      "BRIEFING_TRACKER_FORBIDDEN",
      "Tracker is available to managers and admins only.",
      "",
      403,
    );
  }
  const context = await resolveCompanyContext(auth, deps, actor, companyFolderId);
  if (!context?.ok) {
    return normalizeContextFailure(context);
  }
  if (!actorCanAccessCompanyBriefings(actor, companyFolderId, context.alternateIds)) {
    return briefingApiFailure(
      "BRIEFING_TRACKER_FORBIDDEN",
      "Tracker is available to managers and admins only.",
      "",
      403,
    );
  }
  const briefings = await safeReadAllBriefings(auth, deps, context.masterSheetId);
  const recipients = await safeReadAllRecipients(auth, deps, context.masterSheetId);
  const recipientsByBriefing = new Map();
  recipients.forEach((recipient) => {
    const list = recipientsByBriefing.get(recipient.briefingId) || [];
    list.push(recipient);
    recipientsByBriefing.set(recipient.briefingId, list);
  });
  const items = briefings
    .map((briefing) => {
      const briefingRecipients = recipientsByBriefing.get(briefing.briefingId) || [];
      const enriched = briefingRecipients.map((recipient) => ({
        ...recipient,
        status: computeRecipientStatus(recipient, briefing),
        needsAction: recipientNeedsAction(recipient, briefing),
      }));
      const counts = aggregateBriefingCounts(enriched);
      return {
        ...briefing,
        counts: { sent: briefingRecipients.length, ...counts },
        recipients: enriched,
      };
    })
    .sort((a, b) => Date.parse(b.sentAt || 0) - Date.parse(a.sentAt || 0));
  return { ok: true, items };
}

async function findRecipientRow(auth, deps, masterSheetId, briefingId, recipientEmail) {
  const recipients = await readAllRecipients(auth, deps, masterSheetId);
  const recipient = recipients.find(
    (entry) => entry.briefingId === briefingId && entry.recipientEmail === normalizeEmail(recipientEmail),
  );
  if (!recipient) {
    return briefingApiFailure("BRIEFING_RECIPIENT_NOT_FOUND", "Briefing assignment not found.");
  }
  const briefings = await safeReadAllBriefings(auth, deps, masterSheetId);
  const briefing = briefings.find((entry) => entry.briefingId === briefingId);
  if (!briefing) {
    return briefingApiFailure("BRIEFING_NOT_FOUND", "Briefing not found.");
  }
  return { ok: true, recipient, briefing };
}

async function patchRecipient(auth, deps, masterSheetId, briefingId, recipientEmail, updates = {}) {
  const readTabRecords = resolveReadTabRecords(deps);
  const writeTabRecords =
    typeof deps?.writeTabRecords === "function" ? deps.writeTabRecords : workbookWriteTabRecords;

  const result = await readTabRecords(auth, deps, masterSheetId, BRIEFING_RECIPIENTS_TAB);
  const records = result.records || [];
  const rowIndex = records.findIndex(
    (record) =>
      pickRecordField(record, "BriefingId") === briefingId &&
      normalizeEmail(pickRecordField(record, "RecipientEmail")) === normalizeEmail(recipientEmail),
  );
  if (rowIndex < 0) {
    throw new Error("Recipient row not found.");
  }

  records[rowIndex] = { ...records[rowIndex], ...updates };
  await writeTabRecords(auth, deps, masterSheetId, BRIEFING_RECIPIENTS_TAB, BRIEFING_RECIPIENTS_TAB_COLUMNS, records);
}

async function applyRecipientAction(auth, deps, actor, companyFolderId, briefingId, action, payload = {}) {
  if (!canAccessBriefings(actor)) {
    return briefingApiFailure("BRIEFING_FORBIDDEN", "You do not have permission to update this briefing.", "", 403);
  }
  const context = await resolveCompanyContext(auth, deps, actor, companyFolderId);
  if (!context?.ok) {
    return normalizeContextFailure(context);
  }
  if (!actorCanAccessCompanyBriefings(actor, companyFolderId, context.alternateIds)) {
    return briefingApiFailure("BRIEFING_FORBIDDEN", "You do not have permission to update this briefing.", "", 403);
  }
  const found = await findRecipientRow(auth, deps, context.masterSheetId, briefingId, actor.email);
  if (!found.ok) {
    return found;
  }
  const { recipient, briefing } = found;
  const timestamp = nowIso();
  const updates = {};
  if (action === "open" && !recipient.openedAt) {
    updates.OpenedAt = timestamp;
  }
  if (action === "read" && briefing.requiresRead) {
    updates.ReadAt = timestamp;
    if (!recipient.openedAt) updates.OpenedAt = timestamp;
  }
  if (action === "acknowledge" && briefing.requiresAcknowledgement) {
    updates.AcknowledgedAt = timestamp;
    if (!recipient.openedAt) updates.OpenedAt = timestamp;
  }
  if (action === "sign" && briefing.requiresSignature) {
    const signatureName = trim(payload.signatureName);
    if (!signatureName) {
      return briefingApiFailure("BRIEFING_SIGNATURE_REQUIRED", "Signature name is required.");
    }
    updates.SignedAt = timestamp;
    updates.SignatureName = signatureName;
    if (!recipient.openedAt) updates.OpenedAt = timestamp;
  }
  if (action === "reply" && briefing.requiresReply) {
    const replyText = trim(payload.replyText);
    if (!replyText) {
      return briefingApiFailure("BRIEFING_REPLY_REQUIRED", "Reply text is required.");
    }
    updates.ReplyAt = timestamp;
    updates.ReplyText = replyText;
    if (!recipient.openedAt) updates.OpenedAt = timestamp;
  }

  if (!Object.keys(updates).length) {
    return { ok: true, recipient, briefing, unchanged: true };
  }

  const nextRecipient = {
    ...recipient,
    openedAt: updates.OpenedAt || recipient.openedAt,
    readAt: updates.ReadAt || recipient.readAt,
    acknowledgedAt: updates.AcknowledgedAt || recipient.acknowledgedAt,
    signedAt: updates.SignedAt || recipient.signedAt,
    signatureName: updates.SignatureName || recipient.signatureName,
    replyAt: updates.ReplyAt || recipient.replyAt,
    replyText: updates.ReplyText || recipient.replyText,
  };
  const status = computeRecipientStatus(nextRecipient, briefing);
  updates.Status = status;
  updates.Overdue = boolText(status === "Overdue");

  await patchRecipient(auth, deps, context.masterSheetId, briefingId, actor.email, updates);

  const recipients = (await readAllRecipients(auth, deps, context.masterSheetId)).filter(
    (entry) => entry.briefingId === briefingId,
  );
  await refreshBriefingCounts(auth, deps, context.masterSheetId, briefingId, recipients);

  return {
    ok: true,
    recipient: { ...nextRecipient, status, needsAction: recipientNeedsAction(nextRecipient, briefing) },
    briefing,
  };
}

export async function openBriefing(auth, deps, actor, companyFolderId, briefingId) {
  return applyRecipientAction(auth, deps, actor, companyFolderId, briefingId, "open");
}

export async function readBriefing(auth, deps, actor, companyFolderId, briefingId) {
  return applyRecipientAction(auth, deps, actor, companyFolderId, briefingId, "read");
}

export async function acknowledgeBriefing(auth, deps, actor, companyFolderId, briefingId) {
  return applyRecipientAction(auth, deps, actor, companyFolderId, briefingId, "acknowledge");
}

export async function signBriefing(auth, deps, actor, companyFolderId, briefingId, payload = {}) {
  return applyRecipientAction(auth, deps, actor, companyFolderId, briefingId, "sign", payload);
}

export async function replyToBriefing(auth, deps, actor, companyFolderId, briefingId, payload = {}) {
  return applyRecipientAction(auth, deps, actor, companyFolderId, briefingId, "reply", payload);
}

export async function ensureBriefingDriveFolder(auth, deps, companyFolderId, briefingId) {
  const context = await resolveCompanyScheduleContext(auth, deps, { companyFolderId, companyId: companyFolderId });
  if (!context?.ok) {
    return context;
  }
  const drive = deps.google?.drive ? deps.google.drive({ version: "v3", auth }) : null;
  if (!drive) {
    return { ok: false, code: "DRIVE_UNAVAILABLE", message: "Google Drive is not available." };
  }
  const companyRootFolderId = trim(context.companyFolderId || companyFolderId);
  const ensured = await withOperationTimeout(
    () => ensureBriefingDocumentFolderId(drive, companyRootFolderId, briefingId),
    BRIEFINGS_GOOGLE_TIMEOUT_MS,
  );
  return { ok: true, folderId: ensured.folderId, path: ensured.path };
}
