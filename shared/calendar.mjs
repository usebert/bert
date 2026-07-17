/**
 * Bert Calendar — shared tab name, columns, statuses, and helpers.
 * Dedicated module: never routed through the general Schedules sheet or LOLERSchedules.
 */

export const CALENDAR_ITEMS_TAB = "CalendarItems";

export const CALENDAR_ITEMS_TAB_COLUMNS = [
  "CalendarItemId",
  "ItemType",
  "Title",
  "Description",
  "StartDate",
  "StartTime",
  "EndDate",
  "EndTime",
  "AllDay",
  "AssignedPersonId",
  "AssignedPersonName",
  "AssignedPersonEmail",
  "SiteId",
  "SiteName",
  "AreaId",
  "AreaName",
  "Department",
  "Status",
  "Priority",
  "CompletedAt",
  "CompletedBy",
  "CreatedAt",
  "CreatedBy",
  "UpdatedAt",
  "UpdatedBy",
  "ArchivedAt",
  "ArchivedBy",
  "RelatedModule",
  "RelatedRecordId",
  "RelatedEquipmentId",
  "RelatedExaminationId",
  "RelatedScheduleId",
];

export const CALENDAR_ITEM_TYPES = ["event", "reminder"];

/** Terminal / stored statuses that are not re-derived from StartDate. */
export const CALENDAR_TERMINAL_STATUSES = ["completed", "cancelled", "archived"];

/** Open statuses derived from StartDate relative to today. */
export const CALENDAR_OPEN_STATUSES = ["upcoming", "due_soon", "overdue"];

export const CALENDAR_STATUSES = [...CALENDAR_OPEN_STATUSES, ...CALENDAR_TERMINAL_STATUSES];

export const CALENDAR_PRIORITIES = ["low", "normal", "high"];

/** Due-soon window for calendar items (days). */
export const CALENDAR_DUE_SOON_DAYS = 7;

function trim(value) {
  return String(value ?? "").trim();
}

/** Strict YYYY-MM-DD calendar key, or "" when invalid. */
export function normalizeCalendarDateKey(value) {
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
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
    return "";
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Normalize to HH:MM (24h), or "" when empty/invalid. */
export function normalizeCalendarTime(value) {
  const raw = trim(value);
  if (!raw) {
    return "";
  }
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return "";
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return "";
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseCalendarAllDay(value) {
  const raw = trim(value).toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "y" || value === true;
}

export function formatCalendarAllDay(value) {
  return parseCalendarAllDay(value) ? "true" : "false";
}

/** Whole calendar days from `fromKey` to `toKey` (positive when `toKey` is later). */
export function calendarDaysBetween(fromKey, toKey) {
  const from = normalizeCalendarDateKey(fromKey);
  const to = normalizeCalendarDateKey(toKey);
  if (!from || !to) {
    return null;
  }
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function isCalendarTerminalStatus(status) {
  return CALENDAR_TERMINAL_STATUSES.includes(trim(status).toLowerCase());
}

export function isCalendarOpenStatus(status) {
  return CALENDAR_OPEN_STATUSES.includes(trim(status).toLowerCase());
}

/**
 * Derive open status from StartDate relative to today.
 * Terminal stored statuses (completed / cancelled / archived) are returned as-is.
 */
export function calendarItemStatusForDate(item = {}, todayKey, dueSoonDays = CALENDAR_DUE_SOON_DAYS) {
  const stored = trim(item.status || item.Status).toLowerCase();
  if (isCalendarTerminalStatus(stored)) {
    return stored;
  }
  const startDate = normalizeCalendarDateKey(item.startDate || item.StartDate);
  const days = calendarDaysBetween(todayKey, startDate);
  if (days === null) {
    return "overdue";
  }
  if (days < 0) {
    return "overdue";
  }
  if (days <= dueSoonDays) {
    return "due_soon";
  }
  return "upcoming";
}

/**
 * Validate create/update calendar item input.
 * Returns { ok, errors: string[], normalized }.
 */
export function validateCalendarItemInput(input = {}) {
  const errors = [];
  const itemType = trim(input.itemType || input.ItemType || "event").toLowerCase();
  const title = trim(input.title || input.Title);
  const priority = trim(input.priority || input.Priority || "normal").toLowerCase();
  const allDay = parseCalendarAllDay(input.allDay ?? input.AllDay ?? false);
  const startDate = normalizeCalendarDateKey(input.startDate || input.StartDate);
  let endDate = normalizeCalendarDateKey(input.endDate || input.EndDate);
  const startTime = normalizeCalendarTime(input.startTime || input.StartTime);
  const endTime = normalizeCalendarTime(input.endTime || input.EndTime);

  if (!CALENDAR_ITEM_TYPES.includes(itemType)) {
    errors.push(`Item type must be one of: ${CALENDAR_ITEM_TYPES.join(", ")}.`);
  }
  if (!title) {
    errors.push("Title is required.");
  }
  if (!startDate) {
    errors.push("A valid start date is required.");
  }
  if (trim(input.endDate || input.EndDate) && !endDate) {
    errors.push("End date is not a valid date.");
  }
  if (!endDate && startDate) {
    endDate = startDate;
  }
  if (startDate && endDate && calendarDaysBetween(startDate, endDate) < 0) {
    errors.push("End date cannot be before start date.");
  }
  if (!allDay) {
    if (trim(input.startTime || input.StartTime) && !startTime) {
      errors.push("Start time must be HH:MM.");
    }
    if (trim(input.endTime || input.EndTime) && !endTime) {
      errors.push("End time must be HH:MM.");
    }
  }
  if (!CALENDAR_PRIORITIES.includes(priority)) {
    errors.push(`Priority must be one of: ${CALENDAR_PRIORITIES.join(", ")}.`);
  }

  const assignedPersonId = trim(input.assignedPersonId || input.AssignedPersonId).toLowerCase();
  const assignedPersonEmail =
    trim(input.assignedPersonEmail || input.AssignedPersonEmail).toLowerCase() || assignedPersonId;
  const assignedPersonName = trim(input.assignedPersonName || input.AssignedPersonName);

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      itemType,
      title,
      description: trim(input.description || input.Description),
      startDate,
      startTime: allDay ? "" : startTime,
      endDate,
      endTime: allDay ? "" : endTime,
      allDay,
      assignedPersonId,
      assignedPersonName,
      assignedPersonEmail,
      siteId: trim(input.siteId || input.SiteId),
      siteName: trim(input.siteName || input.SiteName),
      areaId: trim(input.areaId || input.AreaId),
      areaName: trim(input.areaName || input.AreaName),
      department: trim(input.department || input.Department),
      priority,
      relatedModule: trim(input.relatedModule || input.RelatedModule).toLowerCase(),
      relatedRecordId: trim(input.relatedRecordId || input.RelatedRecordId),
      relatedEquipmentId: trim(input.relatedEquipmentId || input.RelatedEquipmentId),
      relatedExaminationId: trim(input.relatedExaminationId || input.RelatedExaminationId),
      relatedScheduleId: trim(input.relatedScheduleId || input.RelatedScheduleId),
    },
  };
}

export function buildCalendarItemId(now = Date.now()) {
  const suffix = Math.floor(Math.random() * 46_656)
    .toString(36)
    .padStart(3, "0");
  return `CAL-${now.toString(36).toUpperCase()}-${suffix.toUpperCase()}`;
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

/** Workbook row → calendar item object. Returns null for rows without a CalendarItemId. */
export function mapCalendarItemRecord(record = {}) {
  const id = pickField(record, "CalendarItemId");
  if (!id) {
    return null;
  }
  const assignedPersonId = pickField(record, "AssignedPersonId").toLowerCase();
  const assignedPersonEmail =
    pickField(record, "AssignedPersonEmail").toLowerCase() || assignedPersonId || undefined;
  return {
    id,
    itemType: (pickField(record, "ItemType") || "event").toLowerCase(),
    title: pickField(record, "Title"),
    description: pickField(record, "Description") || undefined,
    startDate: normalizeCalendarDateKey(pickField(record, "StartDate")),
    startTime: normalizeCalendarTime(pickField(record, "StartTime")) || undefined,
    endDate: normalizeCalendarDateKey(pickField(record, "EndDate")) || undefined,
    endTime: normalizeCalendarTime(pickField(record, "EndTime")) || undefined,
    allDay: parseCalendarAllDay(pickField(record, "AllDay")),
    assignedPersonId: assignedPersonId || undefined,
    assignedPersonName: pickField(record, "AssignedPersonName") || undefined,
    assignedPersonEmail,
    siteId: pickField(record, "SiteId") || undefined,
    siteName: pickField(record, "SiteName") || undefined,
    areaId: pickField(record, "AreaId") || undefined,
    areaName: pickField(record, "AreaName") || undefined,
    department: pickField(record, "Department") || undefined,
    status: (pickField(record, "Status") || "upcoming").toLowerCase(),
    priority: (pickField(record, "Priority") || "normal").toLowerCase(),
    completedAt: pickField(record, "CompletedAt") || undefined,
    completedBy: pickField(record, "CompletedBy") || undefined,
    createdAt: pickField(record, "CreatedAt"),
    createdBy: pickField(record, "CreatedBy"),
    updatedAt: pickField(record, "UpdatedAt"),
    updatedBy: pickField(record, "UpdatedBy"),
    archivedAt: pickField(record, "ArchivedAt") || undefined,
    archivedBy: pickField(record, "ArchivedBy") || undefined,
    relatedModule: pickField(record, "RelatedModule").toLowerCase() || undefined,
    relatedRecordId: pickField(record, "RelatedRecordId") || undefined,
    relatedEquipmentId: pickField(record, "RelatedEquipmentId") || undefined,
    relatedExaminationId: pickField(record, "RelatedExaminationId") || undefined,
    relatedScheduleId: pickField(record, "RelatedScheduleId") || undefined,
  };
}

/** Summary counts for calendar lists / filters. */
export function summarizeCalendarItems(items = [], todayKey) {
  const summary = {
    total: 0,
    events: 0,
    reminders: 0,
    upcoming: 0,
    dueSoon: 0,
    overdue: 0,
    completed: 0,
    archived: 0,
  };
  for (const item of items) {
    if (!item) {
      continue;
    }
    const status = calendarItemStatusForDate(item, todayKey);
    if (status === "archived") {
      summary.archived += 1;
      continue;
    }
    if (status === "cancelled") {
      continue;
    }
    summary.total += 1;
    if (item.itemType === "reminder") {
      summary.reminders += 1;
    } else {
      summary.events += 1;
    }
    if (status === "completed") {
      summary.completed += 1;
    } else if (status === "overdue") {
      summary.overdue += 1;
    } else if (status === "due_soon") {
      summary.dueSoon += 1;
    } else if (status === "upcoming") {
      summary.upcoming += 1;
    }
  }
  return summary;
}
