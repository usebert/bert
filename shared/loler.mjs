/**
 * LOLER equipment compliance — shared tab names, columns, statuses, and date helpers.
 * Dedicated module: never routed through the general Schedules sheet.
 */

export const LOLER_EQUIPMENT_TAB = "LOLEREquipment";
export const LOLER_SCHEDULES_TAB = "LOLERSchedules";

export const LOLER_EQUIPMENT_TAB_COLUMNS = [
  "EquipmentId",
  "AssetId",
  "EquipmentName",
  "EquipmentType",
  "Manufacturer",
  "Model",
  "SerialNumber",
  "SiteId",
  "SiteName",
  "AreaId",
  "AreaName",
  "OwnerDepartment",
  "EquipmentStatus",
  "ExaminationIntervalMonths",
  "LastExaminationDate",
  "NextExaminationDueDate",
  "AssignedPersonId",
  "AssignedPersonName",
  "Notes",
  "CreatedAt",
  "CreatedBy",
  "UpdatedAt",
  "UpdatedBy",
  "ArchivedAt",
  "ArchivedBy",
  "ChangeLog",
];

export const LOLER_SCHEDULES_TAB_COLUMNS = [
  "LolerScheduleId",
  "EquipmentId",
  "AssetId",
  "EquipmentName",
  "SiteId",
  "SiteName",
  "AreaId",
  "AreaName",
  "DueDate",
  "AssignedPersonId",
  "AssignedPersonName",
  "ScheduleStatus",
  "CompletedAt",
  "CreatedAt",
  "CreatedBy",
  "UpdatedAt",
  "UpdatedBy",
];

export const LOLER_EQUIPMENT_STATUSES = ["active", "out_of_service", "archived"];
export const LOLER_SCHEDULE_STATUSES = ["upcoming", "due_soon", "overdue", "completed", "cancelled"];

/** Open (not yet resolved) LOLER schedule statuses — at most one per equipment. */
export const LOLER_OPEN_SCHEDULE_STATUSES = ["upcoming", "due_soon", "overdue"];

/** Central due-soon window (days). */
export const LOLER_DUE_SOON_DAYS = 30;

/** Quick interval options (months); custom positive integers are allowed. */
export const LOLER_QUICK_INTERVAL_MONTHS = [6, 12];

function trim(value) {
  return String(value ?? "").trim();
}

/** Strict YYYY-MM-DD calendar key, or "" when invalid. */
export function normalizeLolerDateKey(value) {
  const raw = trim(value);
  if (!raw) {
    return "";
  }
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  let year;
  let month;
  let day;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dmy) {
    year = Number(dmy[3]);
    month = Number(dmy[2]);
    day = Number(dmy[1]);
  } else {
    return "";
  }
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    return "";
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return "";
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    return "";
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year, month) {
  // month is 1-based. Day 0 of the next month = last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Calendar-safe month addition on a YYYY-MM-DD key.
 * Day is clamped to the target month end (31 Jan + 1 month → 28/29 Feb).
 * Never multiplies months into days; leap years handled by daysInMonth.
 */
export function addMonthsToDateKey(dateKey, months) {
  const normalized = normalizeLolerDateKey(dateKey);
  const monthsToAdd = Number(months);
  if (!normalized || !Number.isInteger(monthsToAdd)) {
    return "";
  }
  const [year, month, day] = normalized.split("-").map((part) => Number(part));
  const zeroBasedTarget = year * 12 + (month - 1) + monthsToAdd;
  const targetYear = Math.floor(zeroBasedTarget / 12);
  const targetMonth = (zeroBasedTarget % 12 + 12) % 12 + 1;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

/**
 * Next examination due date from last examination + interval months.
 * Missing last examination requires an explicit next due date — never guessed.
 */
export function calculateNextExaminationDueDate(input = {}) {
  const intervalMonths = Number(input.examinationIntervalMonths);
  const lastExam = normalizeLolerDateKey(input.lastExaminationDate);
  const explicitDue = normalizeLolerDateKey(input.nextExaminationDueDate);
  if (lastExam && Number.isInteger(intervalMonths) && intervalMonths > 0) {
    return addMonthsToDateKey(lastExam, intervalMonths);
  }
  return explicitDue;
}

/** Whole calendar days from `fromKey` to `toKey` (positive when `toKey` is later). */
export function calendarDaysBetween(fromKey, toKey) {
  const from = normalizeLolerDateKey(fromKey);
  const to = normalizeLolerDateKey(toKey);
  if (!from || !to) {
    return null;
  }
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * Compliance status for an equipment record on a local calendar day.
 * archived / out_of_service take precedence over date-driven states.
 */
export function lolerEquipmentComplianceStatus(equipment = {}, todayKey) {
  const status = trim(equipment.status || equipment.EquipmentStatus).toLowerCase();
  if (status === "archived") {
    return "archived";
  }
  if (status === "out_of_service") {
    return "out_of_service";
  }
  return lolerDueStatusForDate(
    equipment.nextExaminationDueDate || equipment.NextExaminationDueDate,
    todayKey,
  );
}

/** compliant / due_soon / overdue for a due-date key relative to a local today key. */
export function lolerDueStatusForDate(dueDateKey, todayKey, dueSoonDays = LOLER_DUE_SOON_DAYS) {
  const days = calendarDaysBetween(todayKey, dueDateKey);
  if (days === null) {
    return "overdue";
  }
  if (days < 0) {
    return "overdue";
  }
  if (days <= dueSoonDays) {
    return "due_soon";
  }
  return "compliant";
}

/** Open-schedule status (upcoming / due_soon / overdue) for a due-date key. */
export function lolerScheduleStatusForDueDate(dueDateKey, todayKey, dueSoonDays = LOLER_DUE_SOON_DAYS) {
  const due = lolerDueStatusForDate(dueDateKey, todayKey, dueSoonDays);
  if (due === "compliant") {
    return "upcoming";
  }
  return due;
}

export function isOpenLolerScheduleStatus(status) {
  return LOLER_OPEN_SCHEDULE_STATUSES.includes(trim(status).toLowerCase());
}

/**
 * Validate create/update equipment input. Returns { ok, errors: string[], normalized }.
 * `existingAssetIds` is other equipment asset ids (lowercased) in the same company.
 */
export function validateLolerEquipmentInput(input = {}, existingAssetIds = []) {
  const errors = [];
  const assetId = trim(input.assetId);
  const equipmentName = trim(input.equipmentName);
  const equipmentType = trim(input.equipmentType);
  const intervalRaw = input.examinationIntervalMonths;
  const intervalMonths = Number(intervalRaw);
  const status = trim(input.status || "active").toLowerCase();

  if (!assetId) {
    errors.push("Asset ID is required.");
  }
  if (assetId && existingAssetIds.map((id) => trim(id).toLowerCase()).includes(assetId.toLowerCase())) {
    errors.push(`Asset ID "${assetId}" already exists in this company.`);
  }
  if (!equipmentName) {
    errors.push("Equipment name is required.");
  }
  if (!equipmentType) {
    errors.push("Equipment type is required.");
  }
  if (!Number.isInteger(intervalMonths) || intervalMonths <= 0 || String(intervalRaw).includes(".")) {
    errors.push("Examination interval must be a positive whole number of months.");
  }
  if (!LOLER_EQUIPMENT_STATUSES.includes(status)) {
    errors.push(`Status must be one of: ${LOLER_EQUIPMENT_STATUSES.join(", ")}.`);
  }

  const lastExaminationDate = normalizeLolerDateKey(input.lastExaminationDate);
  if (trim(input.lastExaminationDate) && !lastExaminationDate) {
    errors.push("Last examination date is not a valid date.");
  }
  const nextExaminationDueDate = calculateNextExaminationDueDate({
    lastExaminationDate,
    examinationIntervalMonths: intervalMonths,
    nextExaminationDueDate: input.nextExaminationDueDate,
  });
  if (status !== "archived" && !nextExaminationDueDate) {
    errors.push("A valid next examination due date is required (set a last examination date or an explicit next due date).");
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      assetId,
      equipmentName,
      equipmentType,
      manufacturer: trim(input.manufacturer),
      model: trim(input.model),
      serialNumber: trim(input.serialNumber),
      siteId: trim(input.siteId),
      siteName: trim(input.siteName),
      areaId: trim(input.areaId),
      areaName: trim(input.areaName),
      ownerDepartment: trim(input.ownerDepartment),
      status,
      examinationIntervalMonths: intervalMonths,
      lastExaminationDate,
      nextExaminationDueDate,
      assignedPersonId: trim(input.assignedPersonId).toLowerCase(),
      assignedPersonName: trim(input.assignedPersonName),
      notes: trim(input.notes),
    },
  };
}

export function buildLolerEquipmentId(now = Date.now()) {
  const suffix = Math.floor(Math.random() * 46_656).toString(36).padStart(3, "0");
  return `LOL-${now.toString(36).toUpperCase()}-${suffix.toUpperCase()}`;
}

export function buildLolerScheduleId(now = Date.now()) {
  const suffix = Math.floor(Math.random() * 46_656).toString(36).padStart(3, "0");
  return `LSC-${now.toString(36).toUpperCase()}-${suffix.toUpperCase()}`;
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

/** Workbook row → equipment object. Returns null for rows without an EquipmentId. */
export function mapLolerEquipmentRecord(record = {}) {
  const id = pickField(record, "EquipmentId");
  if (!id) {
    return null;
  }
  const intervalMonths = Number(pickField(record, "ExaminationIntervalMonths"));
  return {
    id,
    assetId: pickField(record, "AssetId"),
    equipmentName: pickField(record, "EquipmentName"),
    equipmentType: pickField(record, "EquipmentType"),
    manufacturer: pickField(record, "Manufacturer") || undefined,
    model: pickField(record, "Model") || undefined,
    serialNumber: pickField(record, "SerialNumber") || undefined,
    siteId: pickField(record, "SiteId") || undefined,
    siteName: pickField(record, "SiteName") || undefined,
    areaId: pickField(record, "AreaId") || undefined,
    areaName: pickField(record, "AreaName") || undefined,
    ownerDepartment: pickField(record, "OwnerDepartment") || undefined,
    status: (pickField(record, "EquipmentStatus") || "active").toLowerCase(),
    examinationIntervalMonths: Number.isInteger(intervalMonths) && intervalMonths > 0 ? intervalMonths : 0,
    lastExaminationDate: normalizeLolerDateKey(pickField(record, "LastExaminationDate")) || undefined,
    nextExaminationDueDate: normalizeLolerDateKey(pickField(record, "NextExaminationDueDate")),
    assignedPersonId: pickField(record, "AssignedPersonId").toLowerCase() || undefined,
    assignedPersonName: pickField(record, "AssignedPersonName") || undefined,
    notes: pickField(record, "Notes") || undefined,
    createdAt: pickField(record, "CreatedAt"),
    createdBy: pickField(record, "CreatedBy"),
    updatedAt: pickField(record, "UpdatedAt"),
    updatedBy: pickField(record, "UpdatedBy"),
    archivedAt: pickField(record, "ArchivedAt") || undefined,
    archivedBy: pickField(record, "ArchivedBy") || undefined,
  };
}

/** Workbook row → schedule object. Returns null for rows without a LolerScheduleId. */
export function mapLolerScheduleRecord(record = {}) {
  const id = pickField(record, "LolerScheduleId");
  if (!id) {
    return null;
  }
  return {
    lolerScheduleId: id,
    equipmentId: pickField(record, "EquipmentId"),
    assetId: pickField(record, "AssetId"),
    equipmentName: pickField(record, "EquipmentName"),
    siteId: pickField(record, "SiteId") || undefined,
    siteName: pickField(record, "SiteName") || undefined,
    areaId: pickField(record, "AreaId") || undefined,
    areaName: pickField(record, "AreaName") || undefined,
    dueDate: normalizeLolerDateKey(pickField(record, "DueDate")),
    assignedPersonId: pickField(record, "AssignedPersonId").toLowerCase() || undefined,
    assignedPersonName: pickField(record, "AssignedPersonName") || undefined,
    scheduleStatus: (pickField(record, "ScheduleStatus") || "upcoming").toLowerCase(),
    completedAt: pickField(record, "CompletedAt") || undefined,
    createdAt: pickField(record, "CreatedAt"),
    createdBy: pickField(record, "CreatedBy"),
    updatedAt: pickField(record, "UpdatedAt"),
    updatedBy: pickField(record, "UpdatedBy"),
  };
}

/** Summary counts for dashboards — active compliance excludes archived and out-of-service. */
export function summarizeLolerEquipment(equipmentList = [], todayKey) {
  const summary = {
    totalActive: 0,
    compliant: 0,
    dueSoon: 0,
    overdue: 0,
    outOfService: 0,
    archived: 0,
  };
  for (const equipment of equipmentList) {
    if (!equipment) {
      continue;
    }
    const status = lolerEquipmentComplianceStatus(equipment, todayKey);
    if (status === "archived") {
      summary.archived += 1;
      continue;
    }
    if (status === "out_of_service") {
      summary.outOfService += 1;
      continue;
    }
    summary.totalActive += 1;
    if (status === "overdue") {
      summary.overdue += 1;
    } else if (status === "due_soon") {
      summary.dueSoon += 1;
    } else {
      summary.compliant += 1;
    }
  }
  return summary;
}

/** Temporary re-exports — examination helpers live in shared/loler-examinations.mjs. */
export {
  LOLER_EXAMINATIONS_TAB,
  LOLER_EXAMINATIONS_TAB_COLUMNS,
  LOLER_EXAMINATION_RESULTS,
  LOLER_REMINDER_OFFSET_OPTIONS,
  buildLolerExaminationId,
  subtractDaysFromDateKey,
  resolveLolerReminderSchedule,
  validateLolerExaminationInput,
  mapLolerExaminationRecord,
} from "./loler-examinations.mjs";
