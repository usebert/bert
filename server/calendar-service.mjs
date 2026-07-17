/**
 * Calendar service — CalendarItems workbook tab.
 * Dedicated module: never reads or writes the general Schedules sheet or LOLERSchedules.
 */
import {
  CALENDAR_ITEMS_TAB,
  CALENDAR_ITEMS_TAB_COLUMNS,
  buildCalendarItemId,
  calendarItemStatusForDate,
  formatCalendarAllDay,
  isCalendarTerminalStatus,
  mapCalendarItemRecord,
  summarizeCalendarItems,
  validateCalendarItemInput,
} from "../shared/calendar.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import { isCompanyInviteActor, isGodmodeInviteSession } from "../shared/company-invite-permissions.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

export { CALENDAR_ITEMS_TAB, CALENDAR_ITEMS_TAB_COLUMNS };

export const CALENDAR_ROUTE_TIMEOUT_MS = 90_000;

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

/** All signed-in company roles may view Calendar (auditors see assigned items only). */
export function canViewCalendar(actor) {
  if (!actor?.email) {
    return false;
  }
  return actor.kind === "company" || actor.kind === "godmode" || isCompanyInviteActor(actor);
}

/** Create / edit / archive — Master, Admin, Manager. */
export function canManageCalendar(actor) {
  if (!canViewCalendar(actor)) {
    return false;
  }
  const role = trim(actor.role);
  return role === "Master" || role === "Admin" || role === "Manager";
}

/** Actor company must match the resolved company (godmode may act on any resolved company). */
export function actorCanAccessCompanyCalendar(actor, companyFolderId, alternateIds = []) {
  if (!canViewCalendar(actor)) {
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

/** Managers may complete any reminder; assignees may complete their own. */
export function canCompleteCalendarItem(actor, item) {
  if (canManageCalendar(actor)) {
    return true;
  }
  if (!canViewCalendar(actor) || !item) {
    return false;
  }
  const email = normalizeEmail(actor?.email);
  if (!email) {
    return false;
  }
  return (
    normalizeEmail(item.assignedPersonId) === email ||
    normalizeEmail(item.assignedPersonEmail) === email
  );
}

export function calendarApiFailure(code, error, httpStatus = 400, details = "") {
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

async function ensureCalendarTabs(auth, deps, masterSheetId) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  await ensureTabColumns(auth, deps, masterSheetId, CALENDAR_ITEMS_TAB, CALENDAR_ITEMS_TAB_COLUMNS);
}

async function readCalendarRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, CALENDAR_ITEMS_TAB, {
    expectedHeaders: CALENDAR_ITEMS_TAB_COLUMNS,
  });
  return result?.records || [];
}

function mapCalendarRecordsSafely(records = []) {
  const items = [];
  for (const record of records) {
    try {
      const mapped = mapCalendarItemRecord(record);
      if (mapped) {
        items.push(mapped);
      }
    } catch {
      /* skip malformed row */
    }
  }
  return items;
}

function isAuditorActor(actor) {
  return trim(actor?.role) === "Auditor";
}

function filterItemsForActor(items, actor) {
  if (!isAuditorActor(actor)) {
    return items;
  }
  const email = normalizeEmail(actor?.email);
  return items.filter(
    (item) =>
      normalizeEmail(item.assignedPersonId) === email || normalizeEmail(item.assignedPersonEmail) === email,
  );
}

function decorateItem(item, todayKey) {
  return {
    ...item,
    status: calendarItemStatusForDate(item, todayKey),
  };
}

function buildCalendarRow(itemId, normalized, actor, timestamps = {}) {
  const createdAt = timestamps.createdAt || nowIso();
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  return {
    CalendarItemId: itemId,
    ItemType: normalized.itemType,
    Title: normalized.title,
    Description: normalized.description,
    StartDate: normalized.startDate,
    StartTime: normalized.startTime,
    EndDate: normalized.endDate,
    EndTime: normalized.endTime,
    AllDay: formatCalendarAllDay(normalized.allDay),
    AssignedPersonId: normalized.assignedPersonId,
    AssignedPersonName: normalized.assignedPersonName,
    AssignedPersonEmail: normalized.assignedPersonEmail,
    SiteId: normalized.siteId,
    SiteName: normalized.siteName,
    AreaId: normalized.areaId,
    AreaName: normalized.areaName,
    Department: normalized.department,
    Status: timestamps.status || "upcoming",
    Priority: normalized.priority,
    CompletedAt: timestamps.completedAt || "",
    CompletedBy: timestamps.completedBy || "",
    CreatedAt: createdAt,
    CreatedBy: timestamps.createdBy || actorEmail,
    UpdatedAt: nowIso(),
    UpdatedBy: actorEmail,
    ArchivedAt: timestamps.archivedAt || "",
    ArchivedBy: timestamps.archivedBy || "",
    RelatedModule: normalized.relatedModule || "",
    RelatedRecordId: normalized.relatedRecordId || "",
    RelatedEquipmentId: normalized.relatedEquipmentId || "",
    RelatedExaminationId: normalized.relatedExaminationId || "",
    RelatedScheduleId: normalized.relatedScheduleId || "",
  };
}

export async function listCalendarItems(auth, deps, context, actor, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return calendarApiFailure("CALENDAR_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureCalendarTabs(auth, deps, masterSheetId);
  const records = await readCalendarRecords(auth, deps, masterSheetId);
  const todayKey = trim(options.todayKey) || getUkTodayKey();
  const items = filterItemsForActor(mapCalendarRecordsSafely(records), actor).map((item) =>
    decorateItem(item, todayKey),
  );
  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    items,
    summary: summarizeCalendarItems(items, todayKey),
  };
}

export async function getCalendarItem(auth, deps, context, actor, itemId, options = {}) {
  const listResult = await listCalendarItems(auth, deps, context, actor, options);
  if (!listResult.ok) {
    return listResult;
  }
  const item = listResult.items.find((entry) => trim(entry.id) === trim(itemId));
  if (!item) {
    return calendarApiFailure("CALENDAR_ITEM_NOT_FOUND", "Calendar item was not found in this company.", 404);
  }
  return {
    ok: true,
    companyFolderId: listResult.companyFolderId,
    masterSheetId: listResult.masterSheetId,
    item,
  };
}

export async function createCalendarItem(auth, deps, context, actor, input = {}, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return calendarApiFailure("CALENDAR_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureCalendarTabs(auth, deps, masterSheetId);

  const validation = validateCalendarItemInput(input);
  if (!validation.ok) {
    return calendarApiFailure("CALENDAR_VALIDATION_FAILED", validation.errors.join(" "), 400);
  }

  const appendTabRows = resolveAppendTabRows(deps);
  const itemId = buildCalendarItemId();
  const todayKey = trim(options.todayKey) || getUkTodayKey();
  const initialStatus = calendarItemStatusForDate(
    { ...validation.normalized, status: "upcoming" },
    todayKey,
  );
  const row = buildCalendarRow(itemId, validation.normalized, actor, { status: initialStatus });
  await appendTabRows(auth, deps, masterSheetId, CALENDAR_ITEMS_TAB, CALENDAR_ITEMS_TAB_COLUMNS, [row]);

  const item = decorateItem(mapCalendarItemRecord(row), todayKey);
  return { ok: true, companyFolderId, masterSheetId, item };
}

export async function updateCalendarItem(auth, deps, context, actor, itemId, input = {}, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return calendarApiFailure("CALENDAR_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureCalendarTabs(auth, deps, masterSheetId);

  const records = await readCalendarRecords(auth, deps, masterSheetId);
  const currentRecord = records.find((record) => trim(record.CalendarItemId) === trim(itemId));
  if (!currentRecord) {
    return calendarApiFailure("CALENDAR_ITEM_NOT_FOUND", "Calendar item was not found in this company.", 404);
  }
  const current = mapCalendarItemRecord(currentRecord);
  if (isCalendarTerminalStatus(current.status) && current.status === "archived") {
    return calendarApiFailure("CALENDAR_ITEM_ARCHIVED", "Archived calendar items cannot be edited.", 409);
  }
  if (current.status === "completed") {
    return calendarApiFailure("CALENDAR_ITEM_COMPLETED", "Completed reminders cannot be edited. Create a new item instead.", 409);
  }

  const merged = {
    itemType: input.itemType !== undefined ? input.itemType : current.itemType,
    title: input.title !== undefined ? input.title : current.title,
    description: input.description !== undefined ? input.description : current.description,
    startDate: input.startDate !== undefined ? input.startDate : current.startDate,
    startTime: input.startTime !== undefined ? input.startTime : current.startTime,
    endDate: input.endDate !== undefined ? input.endDate : current.endDate,
    endTime: input.endTime !== undefined ? input.endTime : current.endTime,
    allDay: input.allDay !== undefined ? input.allDay : current.allDay,
    assignedPersonId: input.assignedPersonId !== undefined ? input.assignedPersonId : current.assignedPersonId,
    assignedPersonName: input.assignedPersonName !== undefined ? input.assignedPersonName : current.assignedPersonName,
    assignedPersonEmail: input.assignedPersonEmail !== undefined ? input.assignedPersonEmail : current.assignedPersonEmail,
    siteId: input.siteId !== undefined ? input.siteId : current.siteId,
    siteName: input.siteName !== undefined ? input.siteName : current.siteName,
    areaId: input.areaId !== undefined ? input.areaId : current.areaId,
    areaName: input.areaName !== undefined ? input.areaName : current.areaName,
    department: input.department !== undefined ? input.department : current.department,
    priority: input.priority !== undefined ? input.priority : current.priority,
  };

  const validation = validateCalendarItemInput(merged);
  if (!validation.ok) {
    return calendarApiFailure("CALENDAR_VALIDATION_FAILED", validation.errors.join(" "), 400);
  }

  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const todayKey = trim(options.todayKey) || getUkTodayKey();
  const nextStatus = calendarItemStatusForDate(
    { ...validation.normalized, status: current.status === "cancelled" ? "cancelled" : "upcoming" },
    todayKey,
  );

  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, masterSheetId, CALENDAR_ITEMS_TAB, "CalendarItemId", itemId, {
    ItemType: validation.normalized.itemType,
    Title: validation.normalized.title,
    Description: validation.normalized.description,
    StartDate: validation.normalized.startDate,
    StartTime: validation.normalized.startTime,
    EndDate: validation.normalized.endDate,
    EndTime: validation.normalized.endTime,
    AllDay: formatCalendarAllDay(validation.normalized.allDay),
    AssignedPersonId: validation.normalized.assignedPersonId,
    AssignedPersonName: validation.normalized.assignedPersonName,
    AssignedPersonEmail: validation.normalized.assignedPersonEmail,
    SiteId: validation.normalized.siteId,
    SiteName: validation.normalized.siteName,
    AreaId: validation.normalized.areaId,
    AreaName: validation.normalized.areaName,
    Department: validation.normalized.department,
    Status: current.status === "cancelled" ? "cancelled" : nextStatus,
    Priority: validation.normalized.priority,
    UpdatedAt: nowIso(),
    UpdatedBy: actorEmail,
  });

  const item = decorateItem(
    {
      ...current,
      ...validation.normalized,
      id: trim(itemId),
      status: current.status === "cancelled" ? "cancelled" : nextStatus,
    },
    todayKey,
  );
  return { ok: true, companyFolderId, masterSheetId, item };
}

export async function completeCalendarItem(auth, deps, context, actor, itemId, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return calendarApiFailure("CALENDAR_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureCalendarTabs(auth, deps, masterSheetId);

  const records = await readCalendarRecords(auth, deps, masterSheetId);
  const currentRecord = records.find((record) => trim(record.CalendarItemId) === trim(itemId));
  if (!currentRecord) {
    return calendarApiFailure("CALENDAR_ITEM_NOT_FOUND", "Calendar item was not found in this company.", 404);
  }
  const current = mapCalendarItemRecord(currentRecord);
  if (!canCompleteCalendarItem(actor, current)) {
    return calendarApiFailure("CALENDAR_COMPLETE_FORBIDDEN", "You do not have permission to complete this item.", 403);
  }
  if (current.itemType !== "reminder") {
    return calendarApiFailure("CALENDAR_NOT_REMINDER", "Only reminders can be marked complete.", 400);
  }
  if (current.status === "completed") {
    return calendarApiFailure("CALENDAR_ALREADY_COMPLETED", "This reminder is already completed.", 409);
  }
  if (current.status === "archived" || current.status === "cancelled") {
    return calendarApiFailure("CALENDAR_ITEM_NOT_OPEN", "This reminder cannot be completed.", 409);
  }

  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const completedAt = nowIso();
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, masterSheetId, CALENDAR_ITEMS_TAB, "CalendarItemId", itemId, {
    Status: "completed",
    CompletedAt: completedAt,
    CompletedBy: actorEmail,
    UpdatedAt: completedAt,
    UpdatedBy: actorEmail,
  });

  const todayKey = trim(options.todayKey) || getUkTodayKey();
  const item = decorateItem(
    {
      ...current,
      status: "completed",
      completedAt,
      completedBy: actorEmail,
      updatedAt: completedAt,
      updatedBy: actorEmail,
    },
    todayKey,
  );
  return { ok: true, companyFolderId, masterSheetId, item };
}

export async function archiveCalendarItem(auth, deps, context, actor, itemId, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return calendarApiFailure("CALENDAR_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureCalendarTabs(auth, deps, masterSheetId);

  const records = await readCalendarRecords(auth, deps, masterSheetId);
  const currentRecord = records.find((record) => trim(record.CalendarItemId) === trim(itemId));
  if (!currentRecord) {
    return calendarApiFailure("CALENDAR_ITEM_NOT_FOUND", "Calendar item was not found in this company.", 404);
  }
  const current = mapCalendarItemRecord(currentRecord);
  if (current.status === "archived") {
    return calendarApiFailure("CALENDAR_ALREADY_ARCHIVED", "Calendar item is already archived.", 409);
  }

  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const archivedAt = nowIso();
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, masterSheetId, CALENDAR_ITEMS_TAB, "CalendarItemId", itemId, {
    Status: "archived",
    ArchivedAt: archivedAt,
    ArchivedBy: actorEmail,
    UpdatedAt: archivedAt,
    UpdatedBy: actorEmail,
  });

  const todayKey = trim(options.todayKey) || getUkTodayKey();
  const item = decorateItem(
    {
      ...current,
      status: "archived",
      archivedAt,
      archivedBy: actorEmail,
      updatedAt: archivedAt,
      updatedBy: actorEmail,
    },
    todayKey,
  );
  return { ok: true, companyFolderId, masterSheetId, item };
}
