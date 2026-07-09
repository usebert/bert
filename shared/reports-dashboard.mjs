/**
 * Reports dashboard — aggregate company workbook tabs into summary + charts.
 */
import { getScheduleAssignedEmails } from "./schedule-assignment.mjs";
import { parseCompanyScheduleListFromRecords } from "./schedule-list.mjs";
import { isWorkbookRowArchived } from "./archive.mjs";
import {
  isCompanyInviteActor,
  isGodmodeInviteSession,
} from "./company-invite-permissions.mjs";
import { isUkOverdue, ukDateKeyFromTimestamp } from "./uk-date-time.mjs";

export const REPORTS_DASHBOARD_TABS = [
  "Schedules",
  "AuditResults",
  "AuditFindings",
  "Actions",
  "Evidence",
  "Reports",
  "Areas",
];

export const REPORTS_DATE_RANGE_OPTIONS = ["7", "30", "90", "all"];
export const REPORTS_EMPTY_NO_DATA =
  "No report data yet. Complete a check to start building live reports.";
export const REPORTS_EMPTY_SCHEDULES_ONLY =
  "Schedules are set up. Reports will appear once checks are completed.";
export const REPORTS_LOAD_ERROR = "Could not load reports right now. Try again.";

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function extractField(record, keys) {
  const normalizedKeys = keys.map((key) => normalize(key).replace(/[^a-z0-9]/g, ""));
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = normalize(header).replace(/[^a-z0-9]/g, "");
    if (normalizedKeys.some((key) => normalizedHeader === key || normalizedHeader.includes(key))) {
      return String(value ?? "").trim();
    }
  }
  return "";
}

function parseIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowBelongsToCompany(record = {}, companyFolderId = "", alternateIds = []) {
  const rowCompanyId = extractField(record, ["company id", "company folder id", "folder id"]);
  if (!rowCompanyId) {
    return true;
  }
  const targets = new Set(
    [companyFolderId, ...alternateIds].map((entry) => String(entry || "").trim()).filter(Boolean),
  );
  return targets.has(rowCompanyId);
}

function dateRangeStart(dateRange = "30") {
  const key = String(dateRange || "30").trim().toLowerCase();
  if (key === "all") {
    return null;
  }
  const days = Number.parseInt(key, 10);
  if (!Number.isFinite(days) || days <= 0) {
    return Date.now() - 30 * 24 * 60 * 60 * 1000;
  }
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function inDateRange(value, rangeStart) {
  if (rangeStart === null) {
    return true;
  }
  const parsed = parseIsoDate(value);
  if (parsed === null) {
    return true;
  }
  return parsed >= rangeStart;
}

function normalizeRiskLevel(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "Low";
  }
  const lower = value.toLowerCase();
  if (lower === "critical") return "Critical";
  if (lower === "high") return "High";
  if (lower === "medium") return "Medium";
  return "Low";
}

function normalizeActionStatus(raw, dueDate) {
  const status = String(raw || "").trim();
  const lower = status.toLowerCase();
  if (lower === "closed" || lower === "rejected") {
    return "Closed";
  }
  const dueMs = parseIsoDate(dueDate);
  if ((isUkOverdue(dueDate) || (dueMs !== null && dueMs < Date.now())) && (lower === "open" || lower === "in progress" || lower === "awaiting verification")) {
    return "Overdue";
  }
  if (lower === "in progress" || lower === "awaiting verification") {
    return "In progress";
  }
  return "Open";
}

function isOpenActionStatus(bucket) {
  return bucket === "Open" || bucket === "In progress" || bucket === "Overdue";
}

function resultOutcome(record) {
  const status = normalize(extractField(record, ["status"]));
  if (status.includes("fail")) {
    return "fail";
  }
  if (status.includes("risk") || status.includes("amber") || status.includes("nc")) {
    return "fail";
  }
  return "pass";
}

function formatDayLabel(ms) {
  return ukDateKeyFromTimestamp(ms);
}

function formatMonthLabel(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function sessionCompanyId(actor = {}) {
  return String(actor.companyId || actor.companyFolderId || "").trim();
}

export function canViewReportsDashboard(actor, companyFolderId, alternateIds = []) {
  if (!actor) {
    return false;
  }
  if (isGodmodeInviteSession({ kind: actor.kind, role: actor.role })) {
    return true;
  }
  if (!isCompanyInviteActor({ role: actor.role, accessLevel: actor.accessLevel })) {
    return false;
  }
  const role = String(actor.role || "").trim();
  if (role === "Admin" || role === "Manager" || role === "User") {
    const targets = new Set(
      [companyFolderId, ...alternateIds].map((entry) => String(entry || "").trim()).filter(Boolean),
    );
    return targets.has(sessionCompanyId(actor));
  }
  if (role === "Auditor") {
    const targets = new Set(
      [companyFolderId, ...alternateIds].map((entry) => String(entry || "").trim()).filter(Boolean),
    );
    return targets.has(sessionCompanyId(actor));
  }
  return false;
}

export function shouldScopeReportsToOwnHistory(actor = {}) {
  const role = String(actor.role || "").trim();
  return role === "Auditor" || role === "User";
}

export function managerAreaScope(actor = {}) {
  if (String(actor.role || "").trim() !== "Manager") {
    return null;
  }
  const areas = Array.isArray(actor.companyAreas) ? actor.companyAreas : [];
  const normalized = areas.map((entry) => String(entry || "").trim()).filter(Boolean);
  return normalized.length > 0 ? new Set(normalized) : null;
}

function buildAreaNameMap(areas = []) {
  const map = new Map();
  for (const row of areas) {
    const id = extractField(row, ["area id", "id"]);
    const name = extractField(row, ["name", "area name"]);
    if (id) {
      map.set(id, name || id);
    }
  }
  return map;
}

function matchesFilters(record, filters = {}, areaNameMap = new Map()) {
  const site = String(filters.site || "").trim();
  const area = String(filters.area || "").trim();
  const assignee = normalize(filters.assignee);
  const status = String(filters.status || "").trim();

  const areaId = extractField(record, ["area id"]);
  const areaName = areaNameMap.get(areaId) || areaId;
  const completedBy = normalize(extractField(record, ["completed by", "created by"]));
  const assignedTo = normalize(extractField(record, ["assigned to user id", "assigned to name", "assigned user"]));
  const recordStatus = extractField(record, ["status"]);

  if (site && !normalize(areaName).includes(normalize(site)) && !normalize(areaId).includes(normalize(site))) {
    return false;
  }
  if (area && areaId !== area && normalize(areaName) !== normalize(area)) {
    return false;
  }
  if (assignee && completedBy !== assignee && assignedTo !== assignee) {
    return false;
  }
  if (status && normalize(recordStatus) !== normalize(status)) {
    return false;
  }
  return true;
}

function scheduleOutstandingForAssignee(schedule, results, assigneeEmail) {
  const emails = getScheduleAssignedEmails(schedule);
  if (assigneeEmail && !emails.includes(assigneeEmail)) {
    return 0;
  }
  const auditIds = (schedule.audits || []).map((audit) => String(audit.auditId || audit.auditName || "").trim()).filter(Boolean);
  if (auditIds.length === 0) {
    return emails.length > 0 ? 1 : 0;
  }
  let outstanding = 0;
  for (const auditId of auditIds) {
    const completed = results.some(
      (result) =>
        extractField(result, ["audit id"]) === auditId &&
        (!assigneeEmail || normalize(extractField(result, ["completed by"])) === assigneeEmail),
    );
    if (!completed) {
      outstanding += 1;
    }
  }
  return outstanding;
}

/**
 * Build dashboard payload from workbook tab records.
 */
export function buildReportsDashboardFromTabs(tabData = {}, options = {}) {
  const companyFolderId = String(options.companyFolderId || "").trim();
  const alternateIds = Array.isArray(options.alternateIds) ? options.alternateIds : [];
  const rangeStart = dateRangeStart(options.dateRange || "30");
  const filters = options.filters || {};
  const actor = options.actor || {};
  const ownHistoryOnly = shouldScopeReportsToOwnHistory(actor);
  const actorEmail = normalize(actor.email);
  const areaScope = managerAreaScope(actor);
  const areaNameMap = buildAreaNameMap(tabData.Areas || []);
  const missingTabs = REPORTS_DASHBOARD_TABS.filter((tab) => !Array.isArray(tabData[tab]));

  const scheduleRows = (tabData.Schedules || []).filter((row) => rowBelongsToCompany(row, companyFolderId, alternateIds));
  const schedules = parseCompanyScheduleListFromRecords(scheduleRows, companyFolderId, alternateIds).filter(
    (schedule) => schedule.lifecycle !== "Archived",
  );

  const results = (tabData.AuditResults || [])
    .filter((row) => rowBelongsToCompany(row, companyFolderId, alternateIds))
    .filter((row) => inDateRange(extractField(row, ["completed at", "created at"]), rangeStart))
    .filter((row) => matchesFilters(row, filters, areaNameMap))
    .filter((row) => {
      if (!ownHistoryOnly) {
        return true;
      }
      return normalize(extractField(row, ["completed by"])) === actorEmail;
    })
    .filter((row) => {
      if (!areaScope) {
        return true;
      }
      const areaId = extractField(row, ["area id"]);
      return areaScope.has(areaId) || areaScope.has(areaNameMap.get(areaId) || "");
    });

  const findings = (tabData.AuditFindings || [])
    .filter((row) => rowBelongsToCompany(row, companyFolderId, alternateIds))
    .filter((row) => inDateRange(extractField(row, ["created at"]), rangeStart))
    .filter((row) => matchesFilters(row, filters, areaNameMap))
    .filter((row) => {
      if (!ownHistoryOnly) {
        return true;
      }
      return normalize(extractField(row, ["created by"])) === actorEmail;
    })
    .filter((row) => {
      if (!areaScope) {
        return true;
      }
      const areaId = extractField(row, ["area id"]);
      return areaScope.has(areaId) || areaScope.has(areaNameMap.get(areaId) || "");
    });

  const actions = (tabData.Actions || [])
    .filter((row) => rowBelongsToCompany(row, companyFolderId, alternateIds))
    .filter((row) => !isWorkbookRowArchived(row, "action"))
    .filter((row) => inDateRange(extractField(row, ["created at"]), rangeStart))
    .filter((row) => {
      if (!ownHistoryOnly) {
        return true;
      }
      const assigned = normalize(extractField(row, ["assigned to user id", "assigned to name"]));
      const createdBy = normalize(extractField(row, ["created by user id", "created by"]));
      return assigned === actorEmail || createdBy === actorEmail;
    });

  const closedActionKeys = new Set(
    actions
      .filter((row) => normalizeActionStatus(extractField(row, ["status"]), extractField(row, ["due date"])) === "Closed")
      .map((row) => `${extractField(row, ["source audit id"])}::${extractField(row, ["source question id"])}`),
  );

  const openFindings = findings.filter((row) => {
    const key = `${extractField(row, ["audit id"])}::${extractField(row, ["question id"])}`;
    return !closedActionKeys.has(key);
  });

  const completedCount = results.length;
  const scheduledCount = schedules.reduce((total, schedule) => total + Math.max(1, (schedule.audits || []).length), 0);
  const overdueScheduleIds = new Set();
  for (const schedule of schedules) {
    const health = String(schedule.healthState || "").trim();
    if (health === "Overdue" || health === "Failing" || Number(schedule.missedAuditCount || 0) > 0) {
      overdueScheduleIds.add(schedule.id);
    }
  }
  for (const row of scheduleRows) {
    const scheduleId = extractField(row, ["schedule id"]);
    const rowHealth = normalize(extractField(row, ["health state"]));
    if (rowHealth === "overdue" || rowHealth === "failing" || Number(extractField(row, ["missed audit count"])) > 0) {
      if (scheduleId) {
        overdueScheduleIds.add(scheduleId);
      }
    }
  }
  const overdueCount = overdueScheduleIds.size;

  const openActionsCount = actions.filter(
    (row) => isOpenActionStatus(normalizeActionStatus(extractField(row, ["status"]), extractField(row, ["due date"]))),
  ).length;

  const completionRatePercent =
    scheduledCount > 0 ? Math.round((completedCount / scheduledCount) * 100) : completedCount > 0 ? 100 : 0;

  const checksByDay = new Map();
  for (const row of results) {
    const completedAt = parseIsoDate(extractField(row, ["completed at", "created at"]));
    if (completedAt === null) {
      continue;
    }
    const label = formatDayLabel(completedAt);
    checksByDay.set(label, (checksByDay.get(label) || 0) + 1);
  }
  const checksCompletedOverTime = [...checksByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));

  const completionByArea = new Map();
  for (const row of results) {
    const areaId = extractField(row, ["area id"]);
    const label = areaNameMap.get(areaId) || areaId || "Unassigned";
    completionByArea.set(label, (completionByArea.get(label) || 0) + 1);
  }
  const completionRateBySiteArea = [...completionByArea.entries()]
    .map(([label, completed]) => {
      const scheduledForArea = Math.max(completed, 1);
      return { label, value: Math.round((completed / scheduledForArea) * 100) };
    })
    .sort((a, b) => b.value - a.value);

  const severityBuckets = { Low: 0, Medium: 0, High: 0, Critical: 0 };
  for (const row of openFindings) {
    const level = normalizeRiskLevel(extractField(row, ["risk level", "severity"]));
    severityBuckets[level] = (severityBuckets[level] || 0) + 1;
  }
  const openFindingsBySeverity = Object.entries(severityBuckets).map(([label, value]) => ({ label, value }));

  const actionBuckets = { Open: 0, "In progress": 0, Overdue: 0, Closed: 0 };
  for (const row of actions) {
    const bucket = normalizeActionStatus(extractField(row, ["status"]), extractField(row, ["due date"]));
    actionBuckets[bucket] = (actionBuckets[bucket] || 0) + 1;
  }
  const openActionsByStatus = Object.entries(actionBuckets).map(([label, value]) => ({ label, value }));

  const assigneeOutstanding = new Map();
  for (const schedule of schedules) {
    const emails = getScheduleAssignedEmails(schedule);
    const targets = emails.length > 0 ? emails : ["Unassigned"];
    for (const email of targets) {
      const count = scheduleOutstandingForAssignee(schedule, results, email === "Unassigned" ? "" : email);
      if (count > 0) {
        assigneeOutstanding.set(email, (assigneeOutstanding.get(email) || 0) + count);
      }
    }
  }
  const outstandingChecksByAssignee = [...assigneeOutstanding.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const passFailByMonth = new Map();
  for (const row of results) {
    const completedAt = parseIsoDate(extractField(row, ["completed at", "created at"]));
    if (completedAt === null) {
      continue;
    }
    const label = formatMonthLabel(completedAt);
    const current = passFailByMonth.get(label) || { pass: 0, fail: 0 };
    if (resultOutcome(row) === "fail") {
      current.fail += 1;
    } else {
      current.pass += 1;
    }
    passFailByMonth.set(label, current);
  }
  const passFailTrend = [...passFailByMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, counts]) => ({ label, pass: counts.pass, fail: counts.fail }));

  const sites = [...new Set([...areaNameMap.values()].filter(Boolean))];
  const areas = [...areaNameMap.entries()].map(([id, name]) => ({ id, name }));
  const assignees = [
    ...new Set(
      schedules
        .flatMap((schedule) => getScheduleAssignedEmails(schedule))
        .concat(results.map((row) => extractField(row, ["completed by"])))
        .filter(Boolean),
    ),
  ];
  const statuses = [...new Set(results.map((row) => extractField(row, ["status"])).filter(Boolean))];

  let emptyState = null;
  if (completedCount === 0 && openFindings.length === 0 && openActionsCount === 0) {
    emptyState = schedules.length > 0 ? "schedules-only" : "no-data";
  }

  return {
    summary: {
      totalChecksScheduled: scheduledCount,
      completedChecks: completedCount,
      overdueChecks: overdueCount,
      openFindings: openFindings.length,
      openActions: openActionsCount,
      completionRatePercent,
    },
    charts: {
      checksCompletedOverTime,
      completionRateBySiteArea,
      openFindingsBySeverity,
      openActionsByStatus,
      outstandingChecksByAssignee,
      passFailTrend,
    },
    filters: {
      dateRanges: REPORTS_DATE_RANGE_OPTIONS,
      sites,
      areas,
      assignees,
      statuses,
    },
    emptyState,
    missingTabs,
  };
}
