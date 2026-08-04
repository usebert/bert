/**
 * Production verification LOLER mutations — idempotent create, examination, restore, cleanup.
 */
import {
  LOLER_EQUIPMENT_TAB,
  LOLER_EQUIPMENT_TAB_COLUMNS,
  LOLER_EXAMINATIONS_TAB,
  LOLER_EXAMINATIONS_TAB_COLUMNS,
  LOLER_SCHEDULES_TAB,
  LOLER_SCHEDULES_TAB_COLUMNS,
  calculateNextExaminationDueDate,
  isOpenLolerScheduleStatus,
  mapLolerEquipmentRecord,
  mapLolerScheduleRecord,
  normalizeLolerDateKey,
  validateLolerEquipmentInput,
  validateLolerExaminationInput,
} from "../shared/loler.mjs";
import { mapLolerExaminationRecord } from "../shared/loler-examinations.mjs";
import {
  buildProductionVerificationLolerEquipment,
  isActiveVerificationLolerEquipment,
  isVerificationLolerEquipment,
  isVerificationLolerEquipmentId,
  isVerificationLolerExaminationId,
  PRODUCTION_VERIFICATION_LOLER_CLEANED_MARKER,
  PRODUCTION_VERIFICATION_LOLER_OBSERVATIONS_MARKER,
  PRODUCTION_VERIFICATION_LOLER_SOURCE,
} from "../shared/production-verification-loler.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  archiveLolerEquipment,
  buildLolerChangeEntry,
  canManageLoler,
  lolerApiFailure,
  returnLolerEquipmentToService,
  syncOpenLolerSchedule,
} from "./loler-service.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

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

export function logLolerMutationTiming(operation, stage, details = {}) {
  console.info("[loler:mutation-timing]", {
    operation,
    stage,
    equipmentId: trim(details.equipmentId) || undefined,
    examinationId: trim(details.examinationId) || undefined,
    workbookId: trim(details.workbookId) || undefined,
    updatedRows: Number(details.updatedRows) || 0,
    durationMs: Number(details.durationMs) || 0,
    totalMs: Number(details.totalMs) || 0,
  });
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

function mapExaminationRecordsSafely(records = []) {
  const examinations = [];
  for (const record of records) {
    try {
      const mapped = mapLolerExaminationRecord(record);
      if (mapped) {
        examinations.push(mapped);
      }
    } catch {
      /* skip malformed row */
    }
  }
  return examinations;
}

async function loadLolerContext(auth, deps, input = {}) {
  const resolved = await resolveCompanyScheduleContext(auth, deps, input);
  if (!resolved.ok) {
    return resolved;
  }
  const masterSheetId = trim(resolved.masterSheetId);
  await ensureLolerTabs(auth, deps, masterSheetId);
  const [equipmentRecords, scheduleRecords, examinationRecords] = await Promise.all([
    readEquipmentRecords(auth, deps, masterSheetId),
    readScheduleRecords(auth, deps, masterSheetId),
    readExaminationRecords(auth, deps, masterSheetId),
  ]);
  return {
    ok: true,
    companyFolderId: resolved.companyFolderId,
    masterSheetId,
    equipment: mapEquipmentRecordsSafely(equipmentRecords),
    schedules: mapScheduleRecordsSafely(scheduleRecords),
    examinations: mapExaminationRecordsSafely(examinationRecords),
    equipmentRecords,
    scheduleRecords,
    examinationRecords,
  };
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

export async function createVerificationLolerEquipment(auth, deps, actor, companyFolderId, input = {}) {
  const startedAt = Date.now();
  if (!canManageLoler(actor)) {
    return lolerApiFailure("LOLER_FORBIDDEN", "You do not have permission to manage LOLER equipment.", 403);
  }
  const equipmentId = trim(input.equipmentId);
  if (!isVerificationLolerEquipmentId(equipmentId)) {
    return lolerApiFailure(
      "LOLER_VERIFICATION_ID_REQUIRED",
      "Verification equipment must use the bert-smoke-loler- ID prefix.",
      403,
    );
  }
  const contextInput = {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(input.masterSheetId),
    companyName: trim(input.companyName),
  };
  const loaded = await loadLolerContext(auth, deps, contextInput);
  if (!loaded.ok) {
    return loaded;
  }

  const existing = loaded.equipment.find((item) => trim(item.id) === equipmentId);
  if (existing) {
    if (!isVerificationLolerEquipment(existing)) {
      return lolerApiFailure("LOLER_ID_CONFLICT", "Equipment ID is already used by a non-verification record.", 409);
    }
    logLolerMutationTiming("create", "idempotent", {
      equipmentId,
      workbookId: loaded.masterSheetId,
      updatedRows: 0,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return {
      ok: true,
      equipment: existing,
      equipmentId,
      alreadyExists: true,
      updatedRows: 0,
      masterSheetId: loaded.masterSheetId,
    };
  }

  const payload = buildProductionVerificationLolerEquipment({ ...input, equipmentId });
  const otherAssetIds = loaded.equipment.map((item) => item.assetId);
  const validation = validateLolerEquipmentInput(payload, otherAssetIds);
  if (!validation.ok) {
    return lolerApiFailure("LOLER_VALIDATION_FAILED", validation.errors.join(" "), 400);
  }

  const appendTabRows = resolveAppendTabRows(deps);
  const changeEntry = buildLolerChangeEntry("created", actor, { id: equipmentId, assetId: validation.normalized.assetId });
  const row = buildEquipmentRow(equipmentId, validation.normalized, actor, appendChangeLog([], changeEntry));
  const appendResult = await appendTabRows(auth, deps, loaded.masterSheetId, LOLER_EQUIPMENT_TAB, LOLER_EQUIPMENT_TAB_COLUMNS, [row]);
  const written = Number(appendResult?.written ?? appendResult?.updatedRows ?? 0);
  if (written <= 0) {
    return lolerApiFailure("LOLER_WRITE_ZERO_ROWS", "Equipment create returned zero-row acknowledgement.", 500);
  }

  const equipment = mapLolerEquipmentRecord(row);
  const todayKey = trim(input.todayKey) || getUkTodayKey();
  await syncOpenLolerSchedule(auth, deps, loaded.masterSheetId, equipment, actor, { todayKey });

  logLolerMutationTiming("create", "create", {
    equipmentId,
    workbookId: loaded.masterSheetId,
    updatedRows: written,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return {
    ok: true,
    equipment,
    equipmentId,
    masterSheetId: loaded.masterSheetId,
    updatedRows: written,
  };
}

export async function patchVerificationLolerEquipment(auth, deps, actor, companyFolderId, equipmentId, input = {}) {
  const startedAt = Date.now();
  if (!canManageLoler(actor)) {
    return lolerApiFailure("LOLER_FORBIDDEN", "You do not have permission to manage LOLER equipment.", 403);
  }
  if (!isVerificationLolerEquipmentId(equipmentId)) {
    return lolerApiFailure(
      "LOLER_VERIFICATION_ID_REQUIRED",
      "Only verification equipment can be patched through this path.",
      403,
    );
  }
  const contextInput = {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(input.masterSheetId),
  };
  const loaded = await loadLolerContext(auth, deps, contextInput);
  if (!loaded.ok) {
    return loaded;
  }
  const currentRecord = loaded.equipmentRecords.find((record) => trim(record.EquipmentId) === trim(equipmentId));
  if (!currentRecord) {
    return lolerApiFailure("LOLER_EQUIPMENT_NOT_FOUND", "Equipment was not found in this company register.", 404);
  }
  const current = mapLolerEquipmentRecord(currentRecord);
  if (!isVerificationLolerEquipment(current)) {
    return lolerApiFailure("LOLER_NOT_VERIFICATION", "Only verification equipment can be patched through this path.", 403);
  }
  if (current.status === "archived") {
    return lolerApiFailure("LOLER_EQUIPMENT_ARCHIVED", "Archived equipment cannot be edited.", 409);
  }

  const merged = {
    assetId: current.assetId,
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

  const otherAssetIds = loaded.equipment.filter((item) => trim(item.id) !== trim(equipmentId)).map((item) => item.assetId);
  const validation = validateLolerEquipmentInput(merged, otherAssetIds);
  if (!validation.ok) {
    return lolerApiFailure("LOLER_VALIDATION_FAILED", validation.errors.join(" "), 400);
  }
  if (validation.normalized.status === "archived") {
    return lolerApiFailure("LOLER_USE_ARCHIVE_ROUTE", "Use the verification cleanup route to archive equipment.", 400);
  }

  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  let changeLog = parseChangeLog(currentRecord);
  changeLog = [...changeLog, buildLolerChangeEntry("edited", actor, { id: equipmentId, assetId: validation.normalized.assetId })];
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, LOLER_EQUIPMENT_TAB, "EquipmentId", equipmentId, {
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

  const equipment = { ...current, ...validation.normalized, id: equipmentId };
  const todayKey = trim(input.todayKey) || getUkTodayKey();
  if (equipment.status === "active") {
    await syncOpenLolerSchedule(auth, deps, loaded.masterSheetId, equipment, actor, { todayKey });
  }

  logLolerMutationTiming("patch", "patch", {
    equipmentId,
    workbookId: loaded.masterSheetId,
    updatedRows: 1,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, equipment, equipmentId, masterSheetId: loaded.masterSheetId, updatedRows: 1 };
}

async function recordVerificationExaminationInternal(auth, deps, actor, companyFolderId, input = {}) {
  const startedAt = Date.now();
  const examinationId = trim(input.examinationId);
  const equipmentId = trim(input.equipmentId);
  if (!isVerificationLolerExaminationId(examinationId)) {
    return lolerApiFailure(
      "LOLER_VERIFICATION_EXAM_ID_REQUIRED",
      "Verification examinations must use bert-smoke-loler-exam- or bert-smoke-loler-fail- prefixes.",
      403,
    );
  }
  if (!isVerificationLolerEquipmentId(equipmentId)) {
    return lolerApiFailure(
      "LOLER_VERIFICATION_EQUIPMENT_REQUIRED",
      "Verification examinations must link to verification equipment only.",
      403,
    );
  }

  const contextInput = {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(input.masterSheetId),
  };
  const loaded = await loadLolerContext(auth, deps, contextInput);
  if (!loaded.ok) {
    return loaded;
  }

  const existingExam = loaded.examinations.find((item) => trim(item.examinationId) === examinationId);
  if (existingExam) {
  const result = trim(existingExam.examinationResult);
    if (result === trim(input.examinationResult || input.result).toLowerCase()) {
      logLolerMutationTiming("complete", "idempotent", {
        equipmentId,
        examinationId,
        workbookId: loaded.masterSheetId,
        updatedRows: 0,
        durationMs: Date.now() - startedAt,
        totalMs: Date.now() - startedAt,
      });
      return {
        ok: true,
        examination: existingExam,
        examinationId,
        alreadyCompleted: true,
        updatedRows: 0,
        masterSheetId: loaded.masterSheetId,
      };
    }
    return lolerApiFailure("LOLER_EXAMINATION_ID_CONFLICT", "Examination ID already exists with a different result.", 409);
  }

  const currentRecord = loaded.equipmentRecords.find((record) => trim(record.EquipmentId) === equipmentId);
  if (!currentRecord) {
    return lolerApiFailure("LOLER_EQUIPMENT_NOT_FOUND", "Equipment was not found in this company register.", 404);
  }
  const equipment = mapLolerEquipmentRecord(currentRecord);
  if (!isVerificationLolerEquipment(equipment)) {
    return lolerApiFailure("LOLER_NOT_VERIFICATION", "Only verification equipment can receive verification examinations.", 403);
  }
  if (equipment.status === "archived") {
    return lolerApiFailure("LOLER_EQUIPMENT_ARCHIVED", "Archived equipment cannot receive examinations.", 409);
  }

  const validation = validateLolerExaminationInput({
    ...input,
    examinationDate: input.examinationDate || getUkTodayKey(),
    examinerPersonId: input.examinerPersonId || actor?.email,
    examinerName: input.examinerName || actor?.name || "Smoke Verifier",
    examinerEmail: input.examinerEmail || actor?.email,
    observations: trim(input.observations) || PRODUCTION_VERIFICATION_LOLER_OBSERVATIONS_MARKER,
    defectsFound: trim(input.defectsFound),
    nextExaminationDueDate:
      input.nextExaminationDueDate ||
      calculateNextExaminationDueDate({
        lastExaminationDate: input.examinationDate || getUkTodayKey(),
        examinationIntervalMonths: equipment.examinationIntervalMonths,
      }),
  });
  if (!validation.ok) {
    return lolerApiFailure("LOLER_VALIDATION_FAILED", validation.errors.join(" "), 400);
  }

  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const todayKey = trim(input.todayKey) || getUkTodayKey();
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const appendTabRows = resolveAppendTabRows(deps);
  const recordedAt = nowIso();

  const openSchedules = loaded.schedules.filter(
    (schedule) => trim(schedule.equipmentId) === equipmentId && isOpenLolerScheduleStatus(schedule.scheduleStatus),
  );
  let completedScheduleId = validation.normalized.currentScheduleId;
  for (const schedule of openSchedules) {
    await patchTabRowByHeader(auth, deps, loaded.masterSheetId, LOLER_SCHEDULES_TAB, "LolerScheduleId", schedule.lolerScheduleId, {
      ScheduleStatus: "completed",
      CompletedAt: recordedAt,
      UpdatedAt: recordedAt,
      UpdatedBy: actorEmail,
    });
    if (!completedScheduleId) {
      completedScheduleId = schedule.lolerScheduleId;
    }
  }

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
    ReportFileId: "",
    ReportFileName: "",
    ReportFileUrl: "",
    NextExaminationDueDate: validation.normalized.nextExaminationDueDate,
    CurrentScheduleId: completedScheduleId || "",
    RecordedAt: recordedAt,
    RecordedBy: actorEmail,
    UpdatedAt: recordedAt,
    UpdatedBy: actorEmail,
    ChangeLog: JSON.stringify([changeEntry]),
  };
  const appendResult = await appendTabRows(auth, deps, loaded.masterSheetId, LOLER_EXAMINATIONS_TAB, LOLER_EXAMINATIONS_TAB_COLUMNS, [examRow]);
  const written = Number(appendResult?.written ?? appendResult?.updatedRows ?? 0);
  if (written <= 0) {
    return lolerApiFailure("LOLER_WRITE_ZERO_ROWS", "Examination create returned zero-row acknowledgement.", 500);
  }

  const equipmentChangeLog = parseChangeLog(currentRecord);
  let nextChangeLog = [...equipmentChangeLog, buildLolerChangeEntry("examination_recorded", actor, equipment)];
  const equipmentUpdates = {
    LastExaminationDate: validation.normalized.examinationDate,
    NextExaminationDueDate: validation.normalized.nextExaminationDueDate,
    UpdatedAt: recordedAt,
    UpdatedBy: actorEmail,
  };
  let nextEquipmentStatus = equipment.status;
  if (validation.normalized.examinationResult === "failed" && Boolean(input.markOutOfService)) {
    equipmentUpdates.EquipmentStatus = "out_of_service";
    nextChangeLog = [...nextChangeLog, buildLolerChangeEntry("out_of_service", actor, equipment)];
    nextEquipmentStatus = "out_of_service";
  }
  equipmentUpdates.ChangeLog = JSON.stringify(nextChangeLog.slice(-CHANGE_LOG_LIMIT));
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, LOLER_EQUIPMENT_TAB, "EquipmentId", equipmentId, equipmentUpdates);

  const updatedEquipment = {
    ...equipment,
    status: nextEquipmentStatus,
    lastExaminationDate: validation.normalized.examinationDate,
    nextExaminationDueDate: validation.normalized.nextExaminationDueDate,
  };

  if (nextEquipmentStatus === "active") {
    await syncOpenLolerSchedule(auth, deps, loaded.masterSheetId, updatedEquipment, actor, { todayKey });
  } else {
    await syncOpenLolerSchedule(auth, deps, loaded.masterSheetId, updatedEquipment, actor, { todayKey, cancelOpen: true });
  }

  const stage = validation.normalized.examinationResult === "failed" ? "fail" : "pass";
  logLolerMutationTiming("complete", stage, {
    equipmentId,
    examinationId,
    workbookId: loaded.masterSheetId,
    updatedRows: written,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return {
    ok: true,
    examination: mapLolerExaminationRecord(examRow),
    equipment: updatedEquipment,
    examinationId,
    masterSheetId: loaded.masterSheetId,
    updatedRows: written,
  };
}

export async function recordVerificationLolerPassExamination(auth, deps, actor, companyFolderId, input = {}) {
  if (!canManageLoler(actor)) {
    return lolerApiFailure("LOLER_FORBIDDEN", "You do not have permission to record examinations.", 403);
  }
  return recordVerificationExaminationInternal(auth, deps, actor, companyFolderId, {
    ...input,
    examinationResult: "passed",
    defectsFound: trim(input.defectsFound) || "None",
    observations: trim(input.observations) || `Satisfactory. ${PRODUCTION_VERIFICATION_LOLER_OBSERVATIONS_MARKER}`,
  });
}

export async function recordVerificationLolerFailExamination(auth, deps, actor, companyFolderId, input = {}) {
  if (!canManageLoler(actor)) {
    return lolerApiFailure("LOLER_FORBIDDEN", "You do not have permission to record examinations.", 403);
  }
  return recordVerificationExaminationInternal(auth, deps, actor, companyFolderId, {
    ...input,
    examinationResult: "failed",
    defectsFound: trim(input.defectsFound) || "Verification-only minor defect",
    observations: trim(input.observations) || `Defect found during verification. ${PRODUCTION_VERIFICATION_LOLER_OBSERVATIONS_MARKER}`,
    markOutOfService: input.markOutOfService !== false,
  });
}

export async function restoreVerificationLolerEquipment(auth, deps, actor, companyFolderId, equipmentId, input = {}) {
  const startedAt = Date.now();
  if (!canManageLoler(actor)) {
    return lolerApiFailure("LOLER_FORBIDDEN", "You do not have permission to restore equipment.", 403);
  }
  if (!isVerificationLolerEquipmentId(equipmentId)) {
    return lolerApiFailure(
      "LOLER_VERIFICATION_ID_REQUIRED",
      "Only verification equipment can be restored through this path.",
      403,
    );
  }
  const contextInput = {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(input.masterSheetId),
  };
  const loaded = await loadLolerContext(auth, deps, contextInput);
  if (!loaded.ok) {
    return loaded;
  }
  const current = loaded.equipment.find((item) => trim(item.id) === trim(equipmentId));
  if (!current) {
    return lolerApiFailure("LOLER_EQUIPMENT_NOT_FOUND", "Equipment was not found.", 404);
  }
  if (!isVerificationLolerEquipment(current)) {
    return lolerApiFailure("LOLER_NOT_VERIFICATION", "Only verification equipment can be restored through this path.", 403);
  }
  if (current.status === "active") {
    return { ok: true, equipment: current, alreadyActive: true, updatedRows: 0, masterSheetId: loaded.masterSheetId };
  }
  if (current.status !== "out_of_service") {
    return lolerApiFailure("LOLER_NOT_OUT_OF_SERVICE", "Only out-of-service verification equipment can be restored.", 409);
  }

  const todayKey = trim(input.todayKey) || getUkTodayKey();
  const nextDue =
    trim(input.nextExaminationDueDate) ||
    calculateNextExaminationDueDate({
      lastExaminationDate: current.lastExaminationDate || todayKey,
      examinationIntervalMonths: current.examinationIntervalMonths,
    });
  const result = await returnLolerEquipmentToService(
    auth,
    deps,
    { companyFolderId, masterSheetId: loaded.masterSheetId },
    actor,
    equipmentId,
    {
      nextExaminationDueDate: nextDue,
      lastExaminationDate: current.lastExaminationDate,
      todayKey,
    },
  );
  if (!result.ok) {
    return result;
  }
  logLolerMutationTiming("restore", "restore", {
    equipmentId,
    workbookId: loaded.masterSheetId,
    updatedRows: 1,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ...result, updatedRows: 1 };
}

async function markVerificationExaminationsCleaned(auth, deps, masterSheetId, equipmentId, actor) {
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const records = await readExaminationRecords(auth, deps, masterSheetId);
  let updatedRows = 0;
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const timestamp = nowIso();
  for (const record of records) {
    if (trim(record.EquipmentId) !== trim(equipmentId)) {
      continue;
    }
    const examinationId = trim(record.ExaminationId);
    if (!examinationId) {
      continue;
    }
    const observations = trim(record.Observations);
    if (normalize(observations).includes(PRODUCTION_VERIFICATION_LOLER_CLEANED_MARKER)) {
      continue;
    }
    await patchTabRowByHeader(auth, deps, masterSheetId, LOLER_EXAMINATIONS_TAB, "ExaminationId", examinationId, {
      Observations: `${observations} ${PRODUCTION_VERIFICATION_LOLER_CLEANED_MARKER}`.trim(),
      UpdatedAt: timestamp,
      UpdatedBy: actorEmail,
    });
    updatedRows += 1;
  }
  return updatedRows;
}

function normalize(value) {
  return trim(value).toLowerCase();
}

export async function cleanupVerificationLolerEquipment(auth, deps, actor, companyFolderId, equipmentId, input = {}) {
  const startedAt = Date.now();
  if (!canManageLoler(actor)) {
    return lolerApiFailure("LOLER_FORBIDDEN", "You do not have permission to clean up verification equipment.", 403);
  }
  if (!isVerificationLolerEquipmentId(equipmentId)) {
    return lolerApiFailure(
      "CLEANUP_NOT_VERIFICATION_LOLER",
      "Only verification equipment with the bert-smoke-loler- prefix can be cleaned up through this path.",
      403,
    );
  }
  const contextInput = {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(input.masterSheetId),
  };
  const loaded = await loadLolerContext(auth, deps, contextInput);
  if (!loaded.ok) {
    return loaded;
  }
  const currentRecord = loaded.equipmentRecords.find((record) => trim(record.EquipmentId) === trim(equipmentId));
  if (!currentRecord) {
    return {
      ok: true,
      cleaned: true,
      alreadyCleaned: true,
      equipmentId,
      masterSheetId: loaded.masterSheetId,
      updatedRows: 0,
    };
  }
  const current = mapLolerEquipmentRecord(currentRecord);
  if (!isVerificationLolerEquipment(current)) {
    return lolerApiFailure(
      "CLEANUP_NOT_VERIFICATION_LOLER",
      "Only verification equipment can be cleaned up through this path.",
      403,
    );
  }
  if (current.status === "archived" && normalize(current.notes).includes(PRODUCTION_VERIFICATION_LOLER_CLEANED_MARKER)) {
    return {
      ok: true,
      cleaned: true,
      alreadyCleaned: true,
      equipmentId,
      masterSheetId: loaded.masterSheetId,
      updatedRows: 0,
    };
  }

  let updatedRows = 0;
  if (current.status !== "archived") {
    const archiveResult = await archiveLolerEquipment(
      auth,
      deps,
      { companyFolderId, masterSheetId: loaded.masterSheetId },
      actor,
      equipmentId,
    );
    if (!archiveResult.ok && archiveResult.code !== "LOLER_ALREADY_ARCHIVED") {
      return archiveResult;
    }
    updatedRows += 1;
  }

  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const actorEmail = normalizeEmail(actor?.email) || "unknown";
  const timestamp = nowIso();
  const notes = `${trim(current.notes)} ${PRODUCTION_VERIFICATION_LOLER_CLEANED_MARKER} source=${PRODUCTION_VERIFICATION_LOLER_SOURCE}`.trim();
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, LOLER_EQUIPMENT_TAB, "EquipmentId", equipmentId, {
    Notes: notes,
    UpdatedAt: timestamp,
    UpdatedBy: actorEmail,
  });
  updatedRows += 1;

  updatedRows += await markVerificationExaminationsCleaned(auth, deps, loaded.masterSheetId, equipmentId, actor);

  logLolerMutationTiming("cleanup", "single", {
    equipmentId,
    workbookId: loaded.masterSheetId,
    updatedRows,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return {
    ok: true,
    cleaned: true,
    equipmentId,
    masterSheetId: loaded.masterSheetId,
    updatedRows,
  };
}

export async function cleanupStaleVerificationLoler(auth, deps, actor, companyFolderId, input = {}) {
  const startedAt = Date.now();
  if (!canManageLoler(actor)) {
    return lolerApiFailure("LOLER_FORBIDDEN", "You do not have permission to clean up verification equipment.", 403);
  }
  const contextInput = {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(input.masterSheetId),
  };
  const loaded = await loadLolerContext(auth, deps, contextInput);
  if (!loaded.ok) {
    return loaded;
  }
  const keepEquipmentId = trim(input.keepEquipmentId);
  const stale = loaded.equipment.filter((item) => {
    if (!isActiveVerificationLolerEquipment(item)) {
      return false;
    }
    if (keepEquipmentId && trim(item.id) === keepEquipmentId) {
      return false;
    }
    return true;
  });
  const results = [];
  for (const equipment of stale) {
    const cleaned = await cleanupVerificationLolerEquipment(auth, deps, actor, companyFolderId, equipment.id, input);
    results.push({
      equipmentId: equipment.id,
      ok: cleaned.ok,
      alreadyCleaned: Boolean(cleaned.alreadyCleaned),
    });
  }
  logLolerMutationTiming("cleanup", "stale-cleanup", {
    workbookId: loaded.masterSheetId,
    updatedRows: results.filter((item) => item.ok).length,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return {
    ok: true,
    companyFolderId: loaded.companyFolderId,
    masterSheetId: loaded.masterSheetId,
    cleanedCount: results.filter((item) => item.ok).length,
    results,
  };
}
