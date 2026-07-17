/**
 * LOLER examination service — record / list / update examinations.
 * Orchestrates schedule completion, next-schedule sync, report upload,
 * operational messages, and Calendar reminders. Does not touch general Schedules.
 */
import {
  LOLER_EQUIPMENT_TAB,
  LOLER_EQUIPMENT_TAB_COLUMNS,
  LOLER_SCHEDULES_TAB,
  LOLER_SCHEDULES_TAB_COLUMNS,
  isOpenLolerScheduleStatus,
  lolerEquipmentComplianceStatus,
  mapLolerEquipmentRecord,
  mapLolerScheduleRecord,
  normalizeLolerDateKey,
} from "../shared/loler.mjs";
import {
  LOLER_EXAMINATIONS_TAB,
  LOLER_EXAMINATIONS_TAB_COLUMNS,
  buildLolerExaminationId,
  mapLolerExaminationRecord,
  resolveLolerReminderSchedule,
  validateLolerExaminationInput,
} from "../shared/loler-examinations.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";
import {
  buildLolerChangeEntry,
  canManageLoler,
  canViewLoler,
  lolerApiFailure,
  syncOpenLolerSchedule,
} from "./loler-service.mjs";
import { createOperationalMessage } from "./operational-messages-service.mjs";
import { createLolerLinkedReminder } from "./calendar-loler-reminder.mjs";
import { uploadLolerExaminationReportToDrive } from "./loler-examination-upload.mjs";

export {
  LOLER_EXAMINATIONS_TAB,
  LOLER_EXAMINATIONS_TAB_COLUMNS,
};

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

async function ensureLolerExaminationTabs(auth, deps, masterSheetId) {
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
      /* skip malformed */
    }
  }
  return examinations;
}

function isAuditorActor(actor) {
  return trim(actor?.role) === "Auditor";
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

function decorateEquipment(equipment, todayKey) {
  return {
    ...equipment,
    complianceStatus: lolerEquipmentComplianceStatus(equipment, todayKey),
  };
}

export async function listLolerExaminations(auth, deps, context, actor, options = {}) {
  const masterSheetId = trim(context?.masterSheetId);
  const companyFolderId = trim(context?.companyFolderId || context?.companyId);
  if (!masterSheetId || !companyFolderId) {
    return lolerApiFailure("LOLER_CONTEXT_MISSING", "Company workspace could not be resolved.", 404);
  }
  await ensureLolerExaminationTabs(auth, deps, masterSheetId);
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
  await ensureLolerExaminationTabs(auth, deps, masterSheetId);

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
    const reminderResult = await createLolerLinkedReminder(
      auth,
      deps,
      context,
      actor,
      {
        reminderPlan,
        equipment,
        examinationId,
        equipmentId,
        examinationResult: validation.normalized.examinationResult,
        examinerEmail: validation.normalized.examinerEmail,
        examinerName: validation.normalized.examinerName,
        messageBody: input.messageBody,
        message: input.message,
        messageRecipientEmail: input.messageRecipientEmail,
        messageRecipientName: input.messageRecipientName,
        reminderAssigneeEmail: input.reminderAssigneeEmail,
        reminderAssigneeName: input.reminderAssigneeName,
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
  await ensureLolerExaminationTabs(auth, deps, masterSheetId);
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
