/**
 * LOLER equipment service — LOLEREquipment + LOLERSchedules workbook tabs.
 * Dedicated module: never reads or writes the general Schedules sheet.
 */
import {
  LOLER_EQUIPMENT_TAB,
  LOLER_EQUIPMENT_TAB_COLUMNS,
  LOLER_EXAMINATIONS_TAB,
  LOLER_EXAMINATIONS_TAB_COLUMNS,
  LOLER_SCHEDULES_TAB,
  LOLER_SCHEDULES_TAB_COLUMNS,
  buildLolerEquipmentId,
  buildLolerExaminationId,
  buildLolerScheduleId,
  calculateNextExaminationDueDate,
  isOpenLolerScheduleStatus,
  lolerEquipmentComplianceStatus,
  lolerScheduleStatusForDueDate,
  mapLolerEquipmentRecord,
  mapLolerExaminationRecord,
  mapLolerScheduleRecord,
  normalizeLolerDateKey,
  resolveLolerReminderSchedule,
  summarizeLolerEquipment,
  validateLolerEquipmentInput,
  validateLolerExaminationInput,
} from "../shared/loler.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import { isCompanyInviteActor, isGodmodeInviteSession } from "../shared/company-invite-permissions.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";
import { createCalendarItem } from "./calendar-service.mjs";
import { createOperationalMessage } from "./operational-messages-service.mjs";
import { uploadLolerExaminationReportToDrive } from "./loler-examination-upload.mjs";

export {
  LOLER_EQUIPMENT_TAB,
  LOLER_EQUIPMENT_TAB_COLUMNS,
  LOLER_EXAMINATIONS_TAB,
  LOLER_EXAMINATIONS_TAB_COLUMNS,
  LOLER_SCHEDULES_TAB,
  LOLER_SCHEDULES_TAB_COLUMNS,
};

export const LOLER_ROUTE_TIMEOUT_MS = 90_000;

const CHANGE_LOG_LIMIT = 25;

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

/** All signed-in company roles may view LOLER (auditors see assigned equipment only). */
export function canViewLoler(actor) {
  if (!actor?.email) {
    return false;
  }
  return actor.kind === "company" || actor.kind === "godmode" || isCompanyInviteActor(actor);
}

/** Add / edit / archive / assign — Master, Admin, Manager (mirrors briefings management). */
export function canManageLoler(actor) {
  if (!canViewLoler(actor)) {
    return false;
  }
  const role = trim(actor.role);
  return role === "Master" || role === "Admin" || role === "Manager";
}

/**
 * Record examination — managers always; auditors only when equipment is assigned to them.
 */
export function canRecordLolerExamination(actor, equipment = {}) {
  if (canManageLoler(actor)) {
    return true;
  }
  if (!canViewLoler(actor) || trim(actor?.role) !== "Auditor") {
    return false;
  }
  const email = normalizeEmail(actor?.email);
  if (!email) {
    return false;
  }
  return normalizeEmail(equipment.assignedPersonId) === email;
}

/** Actor company must match the resolved company (godmode may act on any resolved company). */
export function actorCanAccessCompanyLoler(actor, companyFolderId, alternateIds = []) {
  if (!canViewLoler(actor)) {
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

export function lolerApiFailure(code, error, httpStatus = 400, details = "") {
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

function parseChangeLog(record = {}) {
  const raw = trim(record.ChangeLog || record.changeLog);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Change history entry — actor, timestamp, equipment id, asset id, change type. */
export function buildLolerChangeEntry(changeType, actor, equipment = {}) {
  return {
    at: nowIso(),
    by: normalizeEmail(actor?.email) || "unknown",
    type: trim(changeType),
    equipmentId: trim(equipment.id || equipment.EquipmentId),
    assetId: trim(equipment.assetId || equipment.AssetId),
  };
}

function appendChangeLog(existingLog, entry) {
  return JSON.stringify([...existingLog, entry].slice(-CHANGE_LOG_LIMIT));
}

async function ensureLolerTabs(auth, deps, masterSheetId) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  await ensureTabColumns(auth, deps, masterSheetId, LOLER_EQUIPMENT_TAB, LOLER_EQUIPMENT_TAB_COLUMNS);
  await ensureTabColumns(auth, deps, masterSheetId, LOLER_SCHEDULES_TAB, LOLER_SCHEDULES_TAB_COLUMNS);
  await ensureTabColumns(auth, deps, masterSheetId, LOLER_EXAMINATIONS_TAB, LOLER_EXAMINATIONS_TAB_COLUMNS);
}

async function readEquipmentRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, LOLER_EQUIPMENT_TAB, {
    expectedHeaders: LOLER_EQUIPMENT_TAB_COLUMNS,
  });
  return result?.records || [];
}

async function readScheduleRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, LOLER_SCHEDULES_TAB, {
    expectedHeaders: LOLER_SCHEDULES_TAB_COLUMNS,
  });
  return result?.records || [];
}

async function readExaminationRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, LOLER_EXAMINATIONS_TAB, {
    expectedHeaders: LOLER_EXAMINATIONS_TAB_COLUMNS,
  });
  return result?.records || [];
}

/** Invalid stored rows (no EquipmentId, malformed dates) are skipped, never fatal. */
function mapEquipmentRecordsSafely(records = []) {
  const equipment = [];
  for (const record of records) {
    try {
      const mapped = mapLolerEquipmentRecord(record);
      if (mapped) {
        equipment.push(mapped);
      }
    } catch {
      /* skip malformed row */
    }
  }
  return equipment;
}

function mapScheduleRecordsSafely(records = []) {
  const schedules = [];
  for (const record of records) {
    try {
      const mapped = mapLolerScheduleRecord(record);
      if (mapped) {
        schedules.push(mapped);
      }
    } catch {
      /* skip malformed row */
    }
  }
  return schedules;
}

function isAuditorActor(actor) {
  return trim(actor?.role) === "Auditor";
}

function filterEquipmentForActor(equipmentList, actor) {
  if (!isAuditorActor(actor)) {
    return equipmentList;
  }
  const email = normalizeEmail(actor?.email);
  return equipmentList.filter((equipment) => normalizeEmail(equipment.assignedPersonId) === email);
}

function filterSchedulesForActor(schedules, actor) {
  if (!isAuditorActor(actor)) {
    return schedules;
  }
  const email = normalizeEmail(actor?.email);
  return schedules.filter((schedule) => normalizeEmail(schedule.assignedPersonId) === email);
}

function decorateEquipment(equipment, todayKey) {
  return {
    ...equipment,
    complianceStatus: lolerEquipmentComplianceStatus(equipment, todayKey),
  };
}

function decorateSchedule(schedule, todayKey) {
  const status = isOpenLolerScheduleStatus(schedule.scheduleStatus)
    ? lolerScheduleStatusForDueDate(schedule.dueDate, todayKey)
    : schedule.scheduleStatus;
  return { ...schedule, scheduleStatus: status };
}

export async function listLolerEquipment(auth, deps, context, actor, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return lolerApiFailure("LOLER_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureLolerTabs(auth, deps, masterSheetId);
  const records = await readEquipmentRecords(auth, deps, masterSheetId);
  const todayKey = trim(options.todayKey) || getUkTodayKey();
  const equipment = filterEquipmentForActor(mapEquipmentRecordsSafely(records), actor).map((item) =>
    decorateEquipment(item, todayKey),
  );
  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    equipment,
    summary: summarizeLolerEquipment(equipment, todayKey),
  };
}

export async function getLolerEquipment(auth, deps, context, actor, equipmentId, options = {}) {
  const listResult = await listLolerEquipment(auth, deps, context, actor, options);
  if (!listResult.ok) {
    return listResult;
  }
  const equipment = listResult.equipment.find((item) => trim(item.id) === trim(equipmentId));
  if (!equipment) {
    return lolerApiFailure("LOLER_EQUIPMENT_NOT_FOUND", "Equipment was not found in this company register.", 404);
  }
  return { ok: true, companyFolderId: listResult.companyFolderId, masterSheetId: listResult.masterSheetId, equipment };
}

export async function listLolerSchedules(auth, deps, context, actor, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return lolerApiFailure("LOLER_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureLolerTabs(auth, deps, masterSheetId);
  const records = await readScheduleRecords(auth, deps, masterSheetId);
  const todayKey = trim(options.todayKey) || getUkTodayKey();
  const schedules = filterSchedulesForActor(mapScheduleRecordsSafely(records), actor).map((item) =>
    decorateSchedule(item, todayKey),
  );
  return { ok: true, companyFolderId, masterSheetId, schedules };
}

function buildEquipmentRow(equipmentId, normalized, actor, changeLogJson, timestamps = {}) {
  const createdAt = timestamps.createdAt || nowIso();
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  return {
    EquipmentId: equipmentId,
    AssetId: normalized.assetId,
    EquipmentName: normalized.equipmentName,
    EquipmentType: normalized.equipmentType,
    Manufacturer: normalized.manufacturer,
    Model: normalized.model,
    SerialNumber: normalized.serialNumber,
    SiteId: normalized.siteId,
    SiteName: normalized.siteName,
    AreaId: normalized.areaId,
    AreaName: normalized.areaName,
    OwnerDepartment: normalized.ownerDepartment,
    EquipmentStatus: normalized.status,
    ExaminationIntervalMonths: String(normalized.examinationIntervalMonths),
    LastExaminationDate: normalized.lastExaminationDate,
    NextExaminationDueDate: normalized.nextExaminationDueDate,
    AssignedPersonId: normalized.assignedPersonId,
    AssignedPersonName: normalized.assignedPersonName,
    Notes: normalized.notes,
    CreatedAt: createdAt,
    CreatedBy: timestamps.createdBy || actorEmail,
    UpdatedAt: nowIso(),
    UpdatedBy: actorEmail,
    ArchivedAt: "",
    ArchivedBy: "",
    ChangeLog: changeLogJson,
  };
}

/**
 * Create or update the single open LOLER schedule row for one equipment record.
 * Open statuses: upcoming / due_soon / overdue — never more than one per EquipmentId.
 */
async function syncOpenLolerSchedule(auth, deps, masterSheetId, equipment, actor, options = {}) {
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const appendTabRows = resolveAppendTabRows(deps);
  const todayKey = trim(options.todayKey) || getUkTodayKey();
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const records = await readScheduleRecords(auth, deps, masterSheetId);
  const schedules = mapScheduleRecordsSafely(records);
  const openSchedules = schedules.filter(
    (schedule) => trim(schedule.equipmentId) === trim(equipment.id) && isOpenLolerScheduleStatus(schedule.scheduleStatus),
  );

  if (options.cancelOpen) {
    for (const schedule of openSchedules) {
      await patchTabRowByHeader(auth, deps, masterSheetId, LOLER_SCHEDULES_TAB, "LolerScheduleId", schedule.lolerScheduleId, {
        ScheduleStatus: "cancelled",
        UpdatedAt: nowIso(),
        UpdatedBy: actorEmail,
      });
    }
    return { cancelled: openSchedules.length };
  }

  const dueDate = normalizeLolerDateKey(equipment.nextExaminationDueDate);
  if (!dueDate) {
    return { skipped: true };
  }
  const scheduleStatus = lolerScheduleStatusForDueDate(dueDate, todayKey);
  const common = {
    AssetId: trim(equipment.assetId),
    EquipmentName: trim(equipment.equipmentName),
    SiteId: trim(equipment.siteId),
    SiteName: trim(equipment.siteName),
    AreaId: trim(equipment.areaId),
    AreaName: trim(equipment.areaName),
    DueDate: dueDate,
    AssignedPersonId: normalizeEmail(equipment.assignedPersonId),
    AssignedPersonName: trim(equipment.assignedPersonName),
    ScheduleStatus: scheduleStatus,
    UpdatedAt: nowIso(),
    UpdatedBy: actorEmail,
  };

  if (openSchedules.length > 0) {
    // Update the first open schedule in place; cancel accidental extras so one stays open.
    const [current, ...extras] = openSchedules;
    await patchTabRowByHeader(auth, deps, masterSheetId, LOLER_SCHEDULES_TAB, "LolerScheduleId", current.lolerScheduleId, common);
    for (const extra of extras) {
      await patchTabRowByHeader(auth, deps, masterSheetId, LOLER_SCHEDULES_TAB, "LolerScheduleId", extra.lolerScheduleId, {
        ScheduleStatus: "cancelled",
        UpdatedAt: nowIso(),
        UpdatedBy: actorEmail,
      });
    }
    return { updated: current.lolerScheduleId, cancelledExtras: extras.length };
  }

  const lolerScheduleId = buildLolerScheduleId();
  await appendTabRows(auth, deps, masterSheetId, LOLER_SCHEDULES_TAB, LOLER_SCHEDULES_TAB_COLUMNS, [
    {
      ...common,
      LolerScheduleId: lolerScheduleId,
      EquipmentId: trim(equipment.id),
      CompletedAt: "",
      CreatedAt: nowIso(),
      CreatedBy: actorEmail,
    },
  ]);
  return { created: lolerScheduleId };
}

export async function createLolerEquipment(auth, deps, context, actor, input = {}, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return lolerApiFailure("LOLER_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureLolerTabs(auth, deps, masterSheetId);

  const existingRecords = await readEquipmentRecords(auth, deps, masterSheetId);
  const existingAssetIds = mapEquipmentRecordsSafely(existingRecords).map((item) => item.assetId);
  const validation = validateLolerEquipmentInput(input, existingAssetIds);
  if (!validation.ok) {
    return lolerApiFailure("LOLER_VALIDATION_FAILED", validation.errors.join(" "), 400);
  }

  const appendTabRows = resolveAppendTabRows(deps);
  const equipmentId = buildLolerEquipmentId();
  const changeEntry = buildLolerChangeEntry("created", actor, { id: equipmentId, assetId: validation.normalized.assetId });
  const row = buildEquipmentRow(equipmentId, validation.normalized, actor, appendChangeLog([], changeEntry));
  await appendTabRows(auth, deps, masterSheetId, LOLER_EQUIPMENT_TAB, LOLER_EQUIPMENT_TAB_COLUMNS, [row]);

  const equipment = mapLolerEquipmentRecord(row);
  if (equipment.status === "active") {
    await syncOpenLolerSchedule(auth, deps, masterSheetId, equipment, actor, options);
  }
  const todayKey = trim(options.todayKey) || getUkTodayKey();
  return { ok: true, companyFolderId, masterSheetId, equipment: decorateEquipment(equipment, todayKey) };
}

export async function updateLolerEquipment(auth, deps, context, actor, equipmentId, input = {}, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return lolerApiFailure("LOLER_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureLolerTabs(auth, deps, masterSheetId);

  const records = await readEquipmentRecords(auth, deps, masterSheetId);
  const currentRecord = records.find((record) => trim(record.EquipmentId) === trim(equipmentId));
  if (!currentRecord) {
    return lolerApiFailure("LOLER_EQUIPMENT_NOT_FOUND", "Equipment was not found in this company register.", 404);
  }
  const current = mapLolerEquipmentRecord(currentRecord);
  if (current.status === "archived") {
    return lolerApiFailure("LOLER_EQUIPMENT_ARCHIVED", "Archived equipment cannot be edited. Restore it first.", 409);
  }

  const merged = {
    assetId: input.assetId !== undefined ? input.assetId : current.assetId,
    equipmentName: input.equipmentName !== undefined ? input.equipmentName : current.equipmentName,
    equipmentType: input.equipmentType !== undefined ? input.equipmentType : current.equipmentType,
    manufacturer: input.manufacturer !== undefined ? input.manufacturer : current.manufacturer,
    model: input.model !== undefined ? input.model : current.model,
    serialNumber: input.serialNumber !== undefined ? input.serialNumber : current.serialNumber,
    siteId: input.siteId !== undefined ? input.siteId : current.siteId,
    siteName: input.siteName !== undefined ? input.siteName : current.siteName,
    areaId: input.areaId !== undefined ? input.areaId : current.areaId,
    areaName: input.areaName !== undefined ? input.areaName : current.areaName,
    ownerDepartment: input.ownerDepartment !== undefined ? input.ownerDepartment : current.ownerDepartment,
    status: input.status !== undefined ? input.status : current.status,
    examinationIntervalMonths:
      input.examinationIntervalMonths !== undefined ? input.examinationIntervalMonths : current.examinationIntervalMonths,
    lastExaminationDate: input.lastExaminationDate !== undefined ? input.lastExaminationDate : current.lastExaminationDate,
    nextExaminationDueDate:
      input.nextExaminationDueDate !== undefined ? input.nextExaminationDueDate : current.nextExaminationDueDate,
    assignedPersonId: input.assignedPersonId !== undefined ? input.assignedPersonId : current.assignedPersonId,
    assignedPersonName: input.assignedPersonName !== undefined ? input.assignedPersonName : current.assignedPersonName,
    notes: input.notes !== undefined ? input.notes : current.notes,
  };

  const otherAssetIds = mapEquipmentRecordsSafely(records)
    .filter((item) => trim(item.id) !== trim(equipmentId))
    .map((item) => item.assetId);
  const validation = validateLolerEquipmentInput(merged, otherAssetIds);
  if (!validation.ok) {
    return lolerApiFailure("LOLER_VALIDATION_FAILED", validation.errors.join(" "), 400);
  }
  if (validation.normalized.status === "archived") {
    return lolerApiFailure("LOLER_USE_ARCHIVE_ROUTE", "Use the archive action to archive equipment.", 400);
  }

  const changeTypes = ["edited"];
  if (validation.normalized.nextExaminationDueDate !== current.nextExaminationDueDate) {
    changeTypes.push("due_date_changed");
  }
  if (normalizeEmail(validation.normalized.assignedPersonId) !== normalizeEmail(current.assignedPersonId)) {
    changeTypes.push("assigned_person_changed");
  }

  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  let changeLog = parseChangeLog(currentRecord);
  for (const changeType of changeTypes) {
    changeLog = [...changeLog, buildLolerChangeEntry(changeType, actor, { id: equipmentId, assetId: validation.normalized.assetId })];
  }

  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, masterSheetId, LOLER_EQUIPMENT_TAB, "EquipmentId", equipmentId, {
    AssetId: validation.normalized.assetId,
    EquipmentName: validation.normalized.equipmentName,
    EquipmentType: validation.normalized.equipmentType,
    Manufacturer: validation.normalized.manufacturer,
    Model: validation.normalized.model,
    SerialNumber: validation.normalized.serialNumber,
    SiteId: validation.normalized.siteId,
    SiteName: validation.normalized.siteName,
    AreaId: validation.normalized.areaId,
    AreaName: validation.normalized.areaName,
    OwnerDepartment: validation.normalized.ownerDepartment,
    EquipmentStatus: validation.normalized.status,
    ExaminationIntervalMonths: String(validation.normalized.examinationIntervalMonths),
    LastExaminationDate: validation.normalized.lastExaminationDate,
    NextExaminationDueDate: validation.normalized.nextExaminationDueDate,
    AssignedPersonId: validation.normalized.assignedPersonId,
    AssignedPersonName: validation.normalized.assignedPersonName,
    Notes: validation.normalized.notes,
    UpdatedAt: nowIso(),
    UpdatedBy: actorEmail,
    ChangeLog: JSON.stringify(changeLog.slice(-CHANGE_LOG_LIMIT)),
  });

  const equipment = {
    ...current,
    ...validation.normalized,
    id: trim(equipmentId),
  };
  if (equipment.status === "active") {
    await syncOpenLolerSchedule(auth, deps, masterSheetId, equipment, actor, options);
  } else if (equipment.status === "out_of_service") {
    await syncOpenLolerSchedule(auth, deps, masterSheetId, equipment, actor, { ...options, cancelOpen: true });
  }
  const todayKey = trim(options.todayKey) || getUkTodayKey();
  return { ok: true, companyFolderId, masterSheetId, equipment: decorateEquipment(equipment, todayKey) };
}

async function transitionEquipmentStatus(auth, deps, context, actor, equipmentId, transition, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return lolerApiFailure("LOLER_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureLolerTabs(auth, deps, masterSheetId);

  const records = await readEquipmentRecords(auth, deps, masterSheetId);
  const currentRecord = records.find((record) => trim(record.EquipmentId) === trim(equipmentId));
  if (!currentRecord) {
    return lolerApiFailure("LOLER_EQUIPMENT_NOT_FOUND", "Equipment was not found in this company register.", 404);
  }
  const current = mapLolerEquipmentRecord(currentRecord);
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const changeLog = parseChangeLog(currentRecord);
  const updates = { UpdatedAt: nowIso(), UpdatedBy: actorEmail };
  let equipment = { ...current };

  if (transition === "archive") {
    if (current.status === "archived") {
      return lolerApiFailure("LOLER_ALREADY_ARCHIVED", "Equipment is already archived.", 409);
    }
    updates.EquipmentStatus = "archived";
    updates.ArchivedAt = nowIso();
    updates.ArchivedBy = actorEmail;
    updates.ChangeLog = appendChangeLog(changeLog, buildLolerChangeEntry("archived", actor, current));
    equipment.status = "archived";
    equipment.archivedAt = updates.ArchivedAt;
    equipment.archivedBy = actorEmail;
  } else if (transition === "out_of_service") {
    if (current.status !== "active") {
      return lolerApiFailure("LOLER_NOT_ACTIVE", "Only active equipment can be marked out of service.", 409);
    }
    updates.EquipmentStatus = "out_of_service";
    updates.ChangeLog = appendChangeLog(changeLog, buildLolerChangeEntry("out_of_service", actor, current));
    equipment.status = "out_of_service";
  } else if (transition === "return_to_service") {
    if (current.status !== "out_of_service") {
      return lolerApiFailure("LOLER_NOT_OUT_OF_SERVICE", "Only out-of-service equipment can be returned to service.", 409);
    }
    if (trim(options.nextExaminationDueDate) && !normalizeLolerDateKey(options.nextExaminationDueDate)) {
      return lolerApiFailure("LOLER_DUE_DATE_REQUIRED", "The next examination due date is not a valid date.", 400);
    }
    if (trim(options.lastExaminationDate) && !normalizeLolerDateKey(options.lastExaminationDate)) {
      return lolerApiFailure("LOLER_DUE_DATE_REQUIRED", "The last examination date is not a valid date.", 400);
    }
    const nextDue = calculateNextExaminationDueDate({
      lastExaminationDate: normalizeLolerDateKey(options.lastExaminationDate) || current.lastExaminationDate,
      examinationIntervalMonths: current.examinationIntervalMonths,
      nextExaminationDueDate: options.nextExaminationDueDate,
    });
    if (!nextDue) {
      return lolerApiFailure(
        "LOLER_DUE_DATE_REQUIRED",
        "A valid next examination due date is required before returning equipment to service.",
        400,
      );
    }
    updates.EquipmentStatus = "active";
    updates.NextExaminationDueDate = nextDue;
    if (normalizeLolerDateKey(options.lastExaminationDate)) {
      updates.LastExaminationDate = normalizeLolerDateKey(options.lastExaminationDate);
      equipment.lastExaminationDate = updates.LastExaminationDate;
    }
    updates.ChangeLog = appendChangeLog(changeLog, buildLolerChangeEntry("returned_to_service", actor, current));
    equipment.status = "active";
    equipment.nextExaminationDueDate = nextDue;
  } else {
    return lolerApiFailure("LOLER_UNKNOWN_TRANSITION", "Unknown equipment status change.", 400);
  }

  await patchTabRowByHeader(auth, deps, masterSheetId, LOLER_EQUIPMENT_TAB, "EquipmentId", equipmentId, updates);

  if (transition === "archive" || transition === "out_of_service") {
    await syncOpenLolerSchedule(auth, deps, masterSheetId, equipment, actor, { ...options, cancelOpen: true });
  } else if (transition === "return_to_service") {
    await syncOpenLolerSchedule(auth, deps, masterSheetId, equipment, actor, options);
  }

  const todayKey = trim(options.todayKey) || getUkTodayKey();
  return { ok: true, companyFolderId, masterSheetId, equipment: decorateEquipment(equipment, todayKey) };
}

export async function archiveLolerEquipment(auth, deps, context, actor, equipmentId, options = {}) {
  return transitionEquipmentStatus(auth, deps, context, actor, equipmentId, "archive", options);
}

export async function markLolerEquipmentOutOfService(auth, deps, context, actor, equipmentId, options = {}) {
  return transitionEquipmentStatus(auth, deps, context, actor, equipmentId, "out_of_service", options);
}

export async function returnLolerEquipmentToService(auth, deps, context, actor, equipmentId, options = {}) {
  return transitionEquipmentStatus(auth, deps, context, actor, equipmentId, "return_to_service", options);
}

function mapExaminationRecordsSafely(records = []) {
  const examinations = [];
  for (const record of records) {
    try {
      const mapped = mapLolerExaminationRecord(record);
      if (mapped) {
        examinations.push(mapped);
      }
    } catch {
      /* skip malformed */
    }
  }
  return examinations;
}

function filterExaminationsForActor(examinations, equipmentById, actor) {
  if (!isAuditorActor(actor)) {
    return examinations;
  }
  const email = normalizeEmail(actor?.email);
  return examinations.filter((examination) => {
    const equipment = equipmentById.get(trim(examination.equipmentId));
    return normalizeEmail(equipment?.assignedPersonId) === email;
  });
}

export async function listLolerExaminations(auth, deps, context, actor, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return lolerApiFailure("LOLER_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureLolerTabs(auth, deps, masterSheetId);
  const [examRecords, equipmentRecords] = await Promise.all([
    readExaminationRecords(auth, deps, masterSheetId),
    readEquipmentRecords(auth, deps, masterSheetId),
  ]);
  const equipmentList = mapEquipmentRecordsSafely(equipmentRecords);
  const equipmentById = new Map(equipmentList.map((item) => [trim(item.id), item]));
  let examinations = filterExaminationsForActor(mapExaminationRecordsSafely(examRecords), equipmentById, actor);
  const equipmentId = trim(options.equipmentId);
  if (equipmentId) {
    examinations = examinations.filter((item) => trim(item.equipmentId) === equipmentId);
  }
  examinations.sort((a, b) => String(b.examinationDate || "").localeCompare(String(a.examinationDate || "")));
  return { ok: true, companyFolderId, masterSheetId, examinations };
}

export async function getLolerExamination(auth, deps, context, actor, examinationId, options = {}) {
  const listResult = await listLolerExaminations(auth, deps, context, actor, options);
  if (!listResult.ok) {
    return listResult;
  }
  const examination = listResult.examinations.find((item) => trim(item.examinationId) === trim(examinationId));
  if (!examination) {
    return lolerApiFailure("LOLER_EXAMINATION_NOT_FOUND", "Examination was not found in this company.", 404);
  }
  return {
    ok: true,
    companyFolderId: listResult.companyFolderId,
    masterSheetId: listResult.masterSheetId,
    examination,
  };
}

/**
 * Record a completed thorough examination.
 * Completes open schedule(s), updates equipment dates, creates exactly one next open schedule,
 * optionally uploads a report, sends an operational message, and creates a Calendar reminder.
 */
export async function recordLolerExamination(auth, deps, context, actor, input = {}, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return lolerApiFailure("LOLER_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureLolerTabs(auth, deps, masterSheetId);

  const equipmentId = trim(input.equipmentId);
  if (!equipmentId) {
    return lolerApiFailure("LOLER_VALIDATION_FAILED", "Equipment ID is required.", 400);
  }

  const equipmentRecords = await readEquipmentRecords(auth, deps, masterSheetId);
  const currentRecord = equipmentRecords.find((record) => trim(record.EquipmentId) === equipmentId);
  if (!currentRecord) {
    return lolerApiFailure("LOLER_EQUIPMENT_NOT_FOUND", "Equipment was not found in this company register.", 404);
  }
  const equipment = mapLolerEquipmentRecord(currentRecord);
  if (equipment.status === "archived") {
    return lolerApiFailure("LOLER_EQUIPMENT_ARCHIVED", "Archived equipment cannot receive examinations.", 409);
  }
  if (!canRecordLolerExamination(actor, equipment)) {
    return lolerApiFailure(
      "LOLER_EXAMINATION_FORBIDDEN",
      "You do not have permission to record this examination.",
      403,
    );
  }

  const validation = validateLolerExaminationInput(input);
  if (!validation.ok) {
    return lolerApiFailure("LOLER_VALIDATION_FAILED", validation.errors.join(" "), 400);
  }

  const reminderPlan = resolveLolerReminderSchedule({
    reminderOption: input.reminderOption,
    reminderDate: input.reminderDate,
    reminderTime: input.reminderTime,
    reminderDaysBefore: input.reminderDaysBefore,
    nextExaminationDueDate: validation.normalized.nextExaminationDueDate,
  });
  if (!reminderPlan.ok) {
    return lolerApiFailure("LOLER_REMINDER_INVALID", reminderPlan.errors.join(" "), 400);
  }

  const wantsMessage = Boolean(trim(input.messageSubject) || trim(input.messageBody) || trim(input.message));
  if (wantsMessage) {
    const recipientEmail = trim(input.messageRecipientEmail || input.messageRecipientPersonId).toLowerCase();
    if (!recipientEmail) {
      return lolerApiFailure("LOLER_MESSAGE_INVALID", "Message recipient is required when sending a message.", 400);
    }
  }

  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const todayKey = trim(options.todayKey) || getUkTodayKey();
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const appendTabRows = resolveAppendTabRows(deps);
  const recordedAt = nowIso();
  const examinationId = buildLolerExaminationId();

  // 1) Complete all open schedules for this equipment (preserve history).
  const scheduleRecords = await readScheduleRecords(auth, deps, masterSheetId);
  const schedules = mapScheduleRecordsSafely(scheduleRecords);
  const openSchedules = schedules.filter(
    (schedule) => trim(schedule.equipmentId) === equipmentId && isOpenLolerScheduleStatus(schedule.scheduleStatus),
  );
  let completedScheduleId = validation.normalized.currentScheduleId;
  for (const schedule of openSchedules) {
    await patchTabRowByHeader(auth, deps, masterSheetId, LOLER_SCHEDULES_TAB, "LolerScheduleId", schedule.lolerScheduleId, {
      ScheduleStatus: "completed",
      CompletedAt: recordedAt,
      UpdatedAt: recordedAt,
      UpdatedBy: actorEmail,
    });
    if (!completedScheduleId) {
      completedScheduleId = schedule.lolerScheduleId;
    }
  }

  // 2) Optional report upload (online only; failures abort before writing exam if file provided).
  let reportFileId = "";
  let reportFileName = "";
  let reportFileUrl = "";
  if (input.reportFile || (Array.isArray(input.reportFiles) && input.reportFiles[0])) {
    const uploadResult = await uploadLolerExaminationReportToDrive(auth, deps, {
      companyFolderId,
      masterSheetId,
      examinationId,
      assetId: equipment.assetId,
      file: input.reportFile || input.reportFiles[0],
    });
    if (!uploadResult.ok && !uploadResult.skipped) {
      return lolerApiFailure(uploadResult.code || "LOLER_REPORT_UPLOAD_FAILED", uploadResult.error, uploadResult.httpStatus || 502);
    }
    reportFileId = trim(uploadResult.reportFileId);
    reportFileName = trim(uploadResult.reportFileName);
    reportFileUrl = trim(uploadResult.reportFileUrl);
  }

  // 3) Append examination history row.
  const changeEntry = buildLolerChangeEntry("examination_recorded", actor, equipment);
  const examRow = {
    ExaminationId: examinationId,
    EquipmentId: equipmentId,
    AssetId: equipment.assetId,
    EquipmentName: equipment.equipmentName,
    ExaminationDate: validation.normalized.examinationDate,
    ExaminerPersonId: validation.normalized.examinerPersonId,
    ExaminerName: validation.normalized.examinerName,
    ExaminerEmail: validation.normalized.examinerEmail,
    ExaminationResult: validation.normalized.examinationResult,
    Observations: validation.normalized.observations,
    DefectsFound: validation.normalized.defectsFound,
    ReportFileId: reportFileId,
    ReportFileName: reportFileName,
    ReportFileUrl: reportFileUrl,
    NextExaminationDueDate: validation.normalized.nextExaminationDueDate,
    CurrentScheduleId: completedScheduleId || "",
    RecordedAt: recordedAt,
    RecordedBy: actorEmail,
    UpdatedAt: recordedAt,
    UpdatedBy: actorEmail,
    ChangeLog: JSON.stringify([changeEntry]),
  };
  await appendTabRows(auth, deps, masterSheetId, LOLER_EXAMINATIONS_TAB, LOLER_EXAMINATIONS_TAB_COLUMNS, [examRow]);

  // 4) Update equipment last/next dates (+ optional out-of-service on failed).
  const equipmentChangeLog = parseChangeLog(currentRecord);
  let nextChangeLog = [...equipmentChangeLog, buildLolerChangeEntry("examination_recorded", actor, equipment)];
  const equipmentUpdates = {
    LastExaminationDate: validation.normalized.examinationDate,
    NextExaminationDueDate: validation.normalized.nextExaminationDueDate,
    UpdatedAt: recordedAt,
    UpdatedBy: actorEmail,
  };
  let nextEquipmentStatus = equipment.status;
  if (validation.normalized.examinationResult === "failed" && validation.normalized.markOutOfService) {
    equipmentUpdates.EquipmentStatus = "out_of_service";
    nextChangeLog = [...nextChangeLog, buildLolerChangeEntry("out_of_service", actor, equipment)];
    nextEquipmentStatus = "out_of_service";
  } else if (validation.normalized.examinationResult === "failed") {
    const notesPrefix = "[Requires attention: failed examination] ";
    const existingNotes = trim(equipment.notes);
    if (!existingNotes.toLowerCase().includes("requires attention: failed examination")) {
      equipmentUpdates.Notes = `${notesPrefix}${existingNotes}`.trim();
    }
  }
  equipmentUpdates.ChangeLog = JSON.stringify(nextChangeLog.slice(-CHANGE_LOG_LIMIT));
  await patchTabRowByHeader(auth, deps, masterSheetId, LOLER_EQUIPMENT_TAB, "EquipmentId", equipmentId, equipmentUpdates);

  const updatedEquipment = {
    ...equipment,
    status: nextEquipmentStatus,
    lastExaminationDate: validation.normalized.examinationDate,
    nextExaminationDueDate: validation.normalized.nextExaminationDueDate,
    notes: equipmentUpdates.Notes || equipment.notes,
  };

  // 5) Create exactly one next open schedule (unless out of service).
  let nextSchedule = null;
  if (nextEquipmentStatus === "active") {
    await syncOpenLolerSchedule(auth, deps, masterSheetId, updatedEquipment, actor, { todayKey });
    const refreshedSchedules = mapScheduleRecordsSafely(await readScheduleRecords(auth, deps, masterSheetId));
    nextSchedule =
      refreshedSchedules.find(
        (schedule) =>
          trim(schedule.equipmentId) === equipmentId && isOpenLolerScheduleStatus(schedule.scheduleStatus),
      ) || null;
  } else {
    await syncOpenLolerSchedule(auth, deps, masterSheetId, updatedEquipment, actor, { todayKey, cancelOpen: true });
  }

  // 6) Optional operational message.
  let message = null;
  if (wantsMessage) {
    const messageResult = await createOperationalMessage(
      auth,
      deps,
      context,
      actor,
      {
        recipientPersonId: input.messageRecipientPersonId || input.messageRecipientEmail,
        recipientName: input.messageRecipientName,
        recipientEmail: input.messageRecipientEmail || input.messageRecipientPersonId,
        subject: input.messageSubject || `LOLER: ${equipment.equipmentName} (${equipment.assetId})`,
        messageBody: input.messageBody || input.message,
        relatedModule: "loler",
        relatedRecordId: examinationId,
        relatedEquipmentId: equipmentId,
        relatedExaminationId: examinationId,
        relatedScheduleId: completedScheduleId || nextSchedule?.lolerScheduleId || "",
      },
      { allowAsRecorder: true },
    );
    if (!messageResult.ok) {
      return lolerApiFailure(messageResult.code || "LOLER_MESSAGE_FAILED", messageResult.error, messageResult.httpStatus || 400);
    }
    message = messageResult.message;
  }

  // 7) Optional Calendar reminder (additive Related* fields; does not alter existing items).
  let reminder = null;
  if (reminderPlan.enabled) {
    const recipientEmail = normalizeEmail(
      input.reminderAssigneeEmail ||
        input.messageRecipientEmail ||
        validation.normalized.examinerEmail ||
        equipment.assignedPersonId,
    );
    const recipientName =
      trim(input.reminderAssigneeName) ||
      trim(input.messageRecipientName) ||
      validation.normalized.examinerName ||
      equipment.assignedPersonName ||
      "";
    const reminderResult = await createCalendarItem(
      auth,
      deps,
      context,
      actor,
      {
        itemType: "reminder",
        title: `LOLER examination due: ${equipment.equipmentName} (${equipment.assetId})`,
        description:
          trim(input.messageBody || input.message) ||
          `Reminder for next LOLER examination of ${equipment.equipmentName} (${equipment.assetId}).`,
        startDate: reminderPlan.startDate,
        startTime: reminderPlan.startTime,
        endDate: reminderPlan.startDate,
        allDay: reminderPlan.allDay,
        assignedPersonId: recipientEmail,
        assignedPersonName: recipientName,
        assignedPersonEmail: recipientEmail,
        siteId: equipment.siteId,
        siteName: equipment.siteName,
        areaId: equipment.areaId,
        areaName: equipment.areaName,
        priority: validation.normalized.examinationResult === "failed" ? "high" : "normal",
        relatedModule: "loler",
        relatedRecordId: examinationId,
        relatedEquipmentId: equipmentId,
        relatedExaminationId: examinationId,
        relatedScheduleId: nextSchedule?.lolerScheduleId || completedScheduleId || "",
      },
      { todayKey },
    );
    if (!reminderResult.ok) {
      return lolerApiFailure(reminderResult.code || "LOLER_REMINDER_FAILED", reminderResult.error, reminderResult.httpStatus || 400);
    }
    reminder = reminderResult.item;
  }

  const examination = mapLolerExaminationRecord(examRow);
  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    examination,
    equipment: decorateEquipment(updatedEquipment, todayKey),
    completedScheduleIds: openSchedules.map((schedule) => schedule.lolerScheduleId),
    nextSchedule,
    message,
    reminder,
    requiresAttention: validation.normalized.examinationResult === "failed",
  };
}

export async function updateLolerExamination(auth, deps, context, actor, examinationId, input = {}, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return lolerApiFailure("LOLER_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  if (!canManageLoler(actor)) {
    return lolerApiFailure("LOLER_EXAMINATION_FORBIDDEN", "Only managers can edit examination records.", 403);
  }
  await ensureLolerTabs(auth, deps, masterSheetId);
  const records = await readExaminationRecords(auth, deps, masterSheetId);
  const currentRecord = records.find((record) => trim(record.ExaminationId) === trim(examinationId));
  if (!currentRecord) {
    return lolerApiFailure("LOLER_EXAMINATION_NOT_FOUND", "Examination was not found in this company.", 404);
  }
  const current = mapLolerExaminationRecord(currentRecord);
  const merged = {
    examinationDate: input.examinationDate !== undefined ? input.examinationDate : current.examinationDate,
    examinerPersonId: input.examinerPersonId !== undefined ? input.examinerPersonId : current.examinerPersonId,
    examinerName: input.examinerName !== undefined ? input.examinerName : current.examinerName,
    examinerEmail: input.examinerEmail !== undefined ? input.examinerEmail : current.examinerEmail,
    examinationResult: input.examinationResult !== undefined ? input.examinationResult : current.examinationResult,
    observations: input.observations !== undefined ? input.observations : current.observations,
    defectsFound: input.defectsFound !== undefined ? input.defectsFound : current.defectsFound,
    nextExaminationDueDate:
      input.nextExaminationDueDate !== undefined ? input.nextExaminationDueDate : current.nextExaminationDueDate,
    currentScheduleId: current.currentScheduleId,
  };
  const validation = validateLolerExaminationInput(merged);
  if (!validation.ok) {
    return lolerApiFailure("LOLER_VALIDATION_FAILED", validation.errors.join(" "), 400);
  }
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, masterSheetId, LOLER_EXAMINATIONS_TAB, "ExaminationId", examinationId, {
    ExaminationDate: validation.normalized.examinationDate,
    ExaminerPersonId: validation.normalized.examinerPersonId,
    ExaminerName: validation.normalized.examinerName,
    ExaminerEmail: validation.normalized.examinerEmail,
    ExaminationResult: validation.normalized.examinationResult,
    Observations: validation.normalized.observations,
    DefectsFound: validation.normalized.defectsFound,
    NextExaminationDueDate: validation.normalized.nextExaminationDueDate,
    UpdatedAt: nowIso(),
    UpdatedBy: actorEmail,
  });
  void options;
  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    examination: {
      ...current,
      ...validation.normalized,
      examinationId: trim(examinationId),
    },
  };
}
