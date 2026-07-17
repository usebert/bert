/**
 * LOLER examination records — shared tab columns, validation, and reminder date helpers.
 * Extracted from shared/loler.mjs; sheet headers and payload fields are unchanged.
 */
import { normalizeLolerDateKey } from "./loler.mjs";

export const LOLER_EXAMINATIONS_TAB = "LOLERExaminations";

export const LOLER_EXAMINATIONS_TAB_COLUMNS = [
  "ExaminationId",
  "EquipmentId",
  "AssetId",
  "EquipmentName",
  "ExaminationDate",
  "ExaminerPersonId",
  "ExaminerName",
  "ExaminerEmail",
  "ExaminationResult",
  "Observations",
  "DefectsFound",
  "ReportFileId",
  "ReportFileName",
  "ReportFileUrl",
  "NextExaminationDueDate",
  "CurrentScheduleId",
  "RecordedAt",
  "RecordedBy",
  "UpdatedAt",
  "UpdatedBy",
  "ChangeLog",
];

export const LOLER_EXAMINATION_RESULTS = ["passed", "passed_with_observations", "failed"];

/** Reminder offsets supported when linking a timed Calendar reminder to an examination. */
export const LOLER_REMINDER_OFFSET_OPTIONS = ["none", "at_datetime", "1", "7", "30", "custom"];

function trim(value) {
  return String(value ?? "").trim();
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

export function buildLolerExaminationId(now = Date.now()) {
  const suffix = Math.floor(Math.random() * 46_656).toString(36).padStart(3, "0");
  return `LEX-${now.toString(36).toUpperCase()}-${suffix.toUpperCase()}`;
}

/** Subtract whole days from a YYYY-MM-DD key (clamped; returns "" when invalid). */
export function subtractDaysFromDateKey(dateKey, days) {
  const normalized = normalizeLolerDateKey(dateKey);
  const dayCount = Number(days);
  if (!normalized || !Number.isInteger(dayCount) || dayCount < 0) {
    return "";
  }
  const [year, month, day] = normalized.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day) - dayCount * 86_400_000;
  const date = new Date(utc);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Resolve reminder StartDate from examination due date + reminder option.
 * Returns { ok, startDate, startTime, allDay, errors }.
 */
export function resolveLolerReminderSchedule(input = {}) {
  const errors = [];
  const option = trim(input.reminderOption || "none").toLowerCase();
  const dueDate = normalizeLolerDateKey(input.nextExaminationDueDate || input.dueDate);
  if (option === "none" || !option) {
    return { ok: true, enabled: false, startDate: "", startTime: "", allDay: true, errors: [] };
  }
  if (option === "at_datetime") {
    const startDate = normalizeLolerDateKey(input.reminderDate);
    const startTime = trim(input.reminderTime);
    if (!startDate) {
      errors.push("Reminder date is required when scheduling at a selected date/time.");
    }
    return {
      ok: errors.length === 0,
      enabled: true,
      startDate,
      startTime: startTime || "09:00",
      allDay: !startTime,
      errors,
    };
  }
  let daysBefore = 0;
  if (option === "custom") {
    daysBefore = Number(input.reminderDaysBefore);
    if (!Number.isInteger(daysBefore) || daysBefore < 0) {
      errors.push("Custom reminder days before must be a whole number of 0 or more.");
    }
  } else {
    daysBefore = Number(option);
    if (![1, 7, 30].includes(daysBefore)) {
      errors.push("Reminder option must be none, at_datetime, 1, 7, 30, or custom.");
    }
  }
  if (!dueDate) {
    errors.push("A next examination due date is required to schedule a relative reminder.");
  }
  const startDate = dueDate && errors.length === 0 ? subtractDaysFromDateKey(dueDate, daysBefore) : "";
  if (dueDate && daysBefore >= 0 && !startDate && errors.length === 0) {
    errors.push("Could not calculate reminder date.");
  }
  return {
    ok: errors.length === 0,
    enabled: errors.length === 0,
    startDate,
    startTime: "",
    allDay: true,
    errors,
  };
}

/**
 * Validate record-examination input. Returns { ok, errors, normalized }.
 */
export function validateLolerExaminationInput(input = {}) {
  const errors = [];
  const examinationDate = normalizeLolerDateKey(input.examinationDate);
  const nextExaminationDueDate = normalizeLolerDateKey(input.nextExaminationDueDate);
  const examinationResult = trim(input.examinationResult || input.result).toLowerCase();
  const examinerPersonId = trim(input.examinerPersonId || input.examinerEmail).toLowerCase();
  const examinerName = trim(input.examinerName);
  const examinerEmail = trim(input.examinerEmail || examinerPersonId).toLowerCase();

  if (!examinationDate) {
    errors.push("A valid examination date is required.");
  }
  if (!examinerPersonId && !examinerEmail) {
    errors.push("Examiner is required.");
  }
  if (!LOLER_EXAMINATION_RESULTS.includes(examinationResult)) {
    errors.push(`Examination result must be one of: ${LOLER_EXAMINATION_RESULTS.join(", ")}.`);
  }
  if (!nextExaminationDueDate) {
    errors.push("A valid next examination due date is required.");
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      examinationDate,
      examinerPersonId: examinerPersonId || examinerEmail,
      examinerName,
      examinerEmail: examinerEmail || examinerPersonId,
      examinationResult,
      observations: trim(input.observations),
      defectsFound: trim(input.defectsFound),
      nextExaminationDueDate,
      currentScheduleId: trim(input.currentScheduleId || input.lolerScheduleId),
      markOutOfService: Boolean(input.markOutOfService),
    },
  };
}

/** Workbook row → examination object. Returns null for rows without an ExaminationId. */
export function mapLolerExaminationRecord(record = {}) {
  const id = pickField(record, "ExaminationId");
  if (!id) {
    return null;
  }
  return {
    examinationId: id,
    equipmentId: pickField(record, "EquipmentId"),
    assetId: pickField(record, "AssetId"),
    equipmentName: pickField(record, "EquipmentName"),
    examinationDate: normalizeLolerDateKey(pickField(record, "ExaminationDate")),
    examinerPersonId: pickField(record, "ExaminerPersonId").toLowerCase() || undefined,
    examinerName: pickField(record, "ExaminerName") || undefined,
    examinerEmail: pickField(record, "ExaminerEmail").toLowerCase() || undefined,
    examinationResult: (pickField(record, "ExaminationResult") || "").toLowerCase(),
    observations: pickField(record, "Observations") || undefined,
    defectsFound: pickField(record, "DefectsFound") || undefined,
    reportFileId: pickField(record, "ReportFileId") || undefined,
    reportFileName: pickField(record, "ReportFileName") || undefined,
    reportFileUrl: pickField(record, "ReportFileUrl") || undefined,
    nextExaminationDueDate: normalizeLolerDateKey(pickField(record, "NextExaminationDueDate")) || undefined,
    currentScheduleId: pickField(record, "CurrentScheduleId") || undefined,
    recordedAt: pickField(record, "RecordedAt"),
    recordedBy: pickField(record, "RecordedBy"),
    updatedAt: pickField(record, "UpdatedAt"),
    updatedBy: pickField(record, "UpdatedBy"),
  };
}
