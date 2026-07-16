/**
 * LOLER equipment service — LOLEREquipment + LOLERSchedules workbook tabs.
 * Dedicated module: never reads or writes the general Schedules sheet.
 */
import {
  LOLER_EQUIPMENT_TAB,
  LOLER_EQUIPMENT_TAB_COLUMNS,
  LOLER_SCHEDULES_TAB,
  LOLER_SCHEDULES_TAB_COLUMNS,
  buildLolerEquipmentId,
  buildLolerScheduleId,
  calculateNextExaminationDueDate,
  isOpenLolerScheduleStatus,
  lolerEquipmentComplianceStatus,
  lolerScheduleStatusForDueDate,
  mapLolerEquipmentRecord,
  mapLolerScheduleRecord,
  normalizeLolerDateKey,
  summarizeLolerEquipment,
  validateLolerEquipmentInput,
} from "../shared/loler.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import { isCompanyInviteActor, isGodmodeInviteSession } from "../shared/company-invite-permissions.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

export { LOLER_EQUIPMENT_TAB, LOLER_EQUIPMENT_TAB_COLUMNS, LOLER_SCHEDULES_TAB, LOLER_SCHEDULES_TAB_COLUMNS };

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
