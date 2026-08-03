/**
 * Live operational dashboard — aggregate EXISTING company workbook tabs into
 * an actionable "where do we need to act today?" payload.
 *
 * Pure logic only (no Google I/O). The server service reads tabs and passes the
 * raw records here; the verifier exercises these functions directly with fixtures.
 *
 * Reuses the same folder-first scoping and field-extraction conventions as the
 * reports dashboard so one company can never see another company's rows.
 */
import {
  isCompanyInviteActor,
  isGodmodeInviteSession,
} from "./company-invite-permissions.mjs";
import { parseCompanyScheduleListFromRecords } from "./schedule-list.mjs";
import { enrichSchedulesWithDueOccurrence } from "./schedule-due.mjs";
import { getScheduleAssignedEmails } from "./schedule-assignment.mjs";
import { getUkTodayKey, isUkOverdue, isUkToday, ukDateKeyFromTimestamp } from "./uk-date-time.mjs";
import { isWorkbookRowArchived } from "./archive.mjs";
import { isOperationalAuditResult, isVerificationSchedule } from "./production-verification-audit.mjs";
import { isOperationalAction } from "./production-verification-action.mjs";
import { isOperationalWorkbookIncidentRow } from "./production-verification-incident.mjs";

/** Workbook tabs the live dashboard reads. All are existing tabs — no new storage. */
export const LIVE_DASHBOARD_TABS = [
  "Schedules",
  "AuditResults",
  "AuditFindings",
  "Actions",
  "Incidents",
  "NCRs",
  "Briefings",
  "BriefingRecipients",
  "Areas",
  "Sites",
  "Departments",
  "SyncLog",
];

export const LIVE_DASHBOARD_EMPTY_MESSAGE =
  "Nothing needs action right now. New due checks, actions, incidents, and briefings will appear here.";
export const LIVE_DASHBOARD_NO_RISK_DATA =
  "No site/department data yet.";
export const LIVE_DASHBOARD_LOAD_ERROR =
  "Could not load the live dashboard right now. Try again.";

const DAY_MS = 24 * 60 * 60 * 1000;

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

/** Header-agnostic field read: matches "Company ID", "companyId", "company_id", etc. */
function extractField(record, keys) {
  const normalizedKeys = keys.map((key) => normalize(key).replace(/[^a-z0-9]/g, ""));
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = normalize(header).replace(/[^a-z0-9]/g, "");
    if (normalizedKeys.some((key) => normalizedHeader === key || normalizedHeader.includes(key))) {
      const text = trim(value);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function parseDate(value) {
  const text = trim(value);
  if (!text) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSameLocalDay(ms, nowMs) {
  if (ms === null) {
    return false;
  }
  return isUkToday(ms, nowMs);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Rows without a company id belong to the workbook company (legacy safe). */
function rowBelongsToCompany(record = {}, companyFolderId = "", alternateIds = []) {
  const rowCompanyId = extractField(record, ["company folder id", "company id", "folder id", "companyid"]);
  if (!rowCompanyId) {
    return true;
  }
  const targets = new Set(
    [companyFolderId, ...alternateIds].map((entry) => trim(entry)).filter(Boolean),
  );
  return targets.size === 0 ? true : targets.has(rowCompanyId);
}

function filterCompanyRows(rows, companyFolderId, alternateIds) {
  return toArray(rows).filter((row) => rowBelongsToCompany(row, companyFolderId, alternateIds));
}

function normalizeRiskLevel(raw) {
  const lower = normalize(raw);
  if (lower === "critical") return "Critical";
  if (lower === "high") return "High";
  if (lower === "medium" || lower === "moderate") return "Medium";
  return "Low";
}

const RISK_WEIGHT = { Low: 1, Medium: 3, High: 6, Critical: 10 };

function normalizeActionStatus(rawStatus, dueDate, nowMs) {
  const lower = normalize(rawStatus);
  if (
    lower === "closed" ||
    lower === "rejected" ||
    lower === "complete" ||
    lower === "completed" ||
    lower === "verification-cleaned"
  ) {
    return "Closed";
  }
  const dueMs = parseDate(dueDate);
  const isOpenish = lower === "open" || lower === "in progress" || lower === "awaiting verification" || lower === "";
  if ((isUkOverdue(dueDate, nowMs) || (dueMs !== null && dueMs < nowMs)) && isOpenish) {
    return "Overdue";
  }
  if (lower === "in progress" || lower === "awaiting verification") {
    return "In progress";
  }
  return "Open";
}

function isOpenActionBucket(bucket) {
  return bucket === "Open" || bucket === "In progress" || bucket === "Overdue";
}

function incidentIsOpen(record) {
  const status = normalize(extractField(record, ["status"]));
  if (!status) {
    return true;
  }
  return !["closed", "resolved", "complete", "completed", "cancelled"].includes(status);
}

function ncrIsOpen(record) {
  const status = normalize(extractField(record, ["status"]));
  if (!status) {
    return true;
  }
  return !["closed", "resolved", "complete", "completed", "cancelled", "verified"].includes(status);
}

// ---------------------------------------------------------------------------
// Role visibility
// ---------------------------------------------------------------------------

function sessionCompanyId(actor = {}) {
  return trim(actor.companyId || actor.companyFolderId);
}

const LIVE_DASHBOARD_COMPANY_ROLES = new Set(["Admin", "Manager", "Auditor", "User"]);

/** Master/Godmode + any signed-in company actor for their own company may view. */
export function canViewLiveDashboard(actor, companyFolderId, alternateIds = []) {
  if (!actor) {
    return false;
  }
  if (isGodmodeInviteSession({ kind: actor.kind, role: actor.role })) {
    return true;
  }
  const role = trim(actor.role);
  const isCompanyRole =
    LIVE_DASHBOARD_COMPANY_ROLES.has(role) ||
    isCompanyInviteActor({ role: actor.role, accessLevel: actor.accessLevel });
  if (!isCompanyRole) {
    return false;
  }
  const targets = new Set(
    [companyFolderId, ...alternateIds].map((entry) => trim(entry)).filter(Boolean),
  );
  if (targets.size === 0) {
    return true;
  }
  return targets.has(sessionCompanyId(actor));
}

/** Auditors see their own / assigned / personal outstanding work only. */
export function shouldScopeLiveDashboardToOwn(actor = {}) {
  return trim(actor.role) === "Auditor";
}

/** Master/Admin/Manager see the full operational picture. */
export function canViewFullOperationalDashboard(actor = {}) {
  if (isGodmodeInviteSession({ kind: actor.kind, role: actor.role })) {
    return true;
  }
  const role = trim(actor.role);
  return role === "Admin" || role === "Manager";
}

function actorEmailMatches(record, actorEmail, keyGroups) {
  if (!actorEmail) {
    return true;
  }
  for (const keys of keyGroups) {
    if (normalize(extractField(record, keys)) === actorEmail) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Area/site naming
// ---------------------------------------------------------------------------

function buildAreaNameMap(areas = [], sites = []) {
  const map = new Map();
  for (const row of toArray(sites)) {
    const id = extractField(row, ["site id", "id"]);
    const name = extractField(row, ["name", "site name"]);
    if (id) {
      map.set(id, name || id);
    }
  }
  for (const row of toArray(areas)) {
    const id = extractField(row, ["area id", "id"]);
    const name = extractField(row, ["name", "area name"]);
    if (id) {
      map.set(id, name || id);
    }
  }
  return map;
}

function resolveAreaLabel(record, areaNameMap) {
  const areaId = extractField(record, ["area id"]);
  if (areaId) {
    return areaNameMap.get(areaId) || areaId;
  }
  const site = extractField(record, ["site", "site id"]);
  if (site) {
    return areaNameMap.get(site) || site;
  }
  const department = extractField(record, ["department", "department / area", "location"]);
  return department || "";
}

// ---------------------------------------------------------------------------
// Compliance score
// ---------------------------------------------------------------------------

/**
 * Operational compliance score = 100 minus penalties. Each category is capped so
 * a single noisy source cannot dominate. Returns score, label and what reduced it.
 */
export function computeComplianceScore(input = {}) {
  const penalties = [
    { key: "overdueInspections", label: "Overdue inspections", per: 5, cap: 30, count: Number(input.overdueInspections) || 0 },
    { key: "overdueActions", label: "Overdue actions", per: 4, cap: 30, count: Number(input.overdueActions) || 0 },
    { key: "openHighRiskIncidents", label: "Open high-risk incidents", per: 6, cap: 30, count: Number(input.openHighRiskIncidents) || 0 },
    { key: "unsignedMandatoryBriefings", label: "Unsigned mandatory briefings", per: 2, cap: 20, count: Number(input.unsignedMandatoryBriefings) || 0 },
    { key: "openNcrs", label: "Open NCRs", per: 3, cap: 20, count: Number(input.openNcrs) || 0 },
  ];

  const reductions = [];
  let totalPenalty = 0;
  for (const penalty of penalties) {
    if (penalty.count <= 0) {
      continue;
    }
    const points = Math.min(penalty.per * penalty.count, penalty.cap);
    totalPenalty += points;
    reductions.push({ key: penalty.key, label: penalty.label, count: penalty.count, points });
  }

  const score = Math.max(0, Math.min(100, 100 - totalPenalty));
  let label = "Good";
  if (score < 60) {
    label = "Critical";
  } else if (score < 85) {
    label = "Needs attention";
  }

  return {
    score,
    label,
    reductions: reductions.sort((a, b) => b.points - a.points),
  };
}

// ---------------------------------------------------------------------------
// Sync / offline warning
// ---------------------------------------------------------------------------

export function buildSyncWarning(syncQueue = {}) {
  const queued = Number(syncQueue.queued) || 0;
  const failed = Number(syncQueue.failed) || 0;
  const lastStatus = trim(syncQueue.lastStatus) || (failed > 0 ? "error" : queued > 0 ? "pending" : "ok");
  const lastSyncAt = trim(syncQueue.lastSyncAt);
  const hasIssue = queued > 0 || failed > 0;
  let message = "All work is synced.";
  if (failed > 0) {
    message = `${failed} item${failed === 1 ? "" : "s"} failed to sync${queued > 0 ? `, ${queued} queued` : ""}.`;
  } else if (queued > 0) {
    message = `${queued} item${queued === 1 ? "" : "s"} waiting to sync.`;
  }
  return { queued, failed, lastStatus, lastSyncAt, hasIssue, message };
}

// ---------------------------------------------------------------------------
// Overdue inspections
// ---------------------------------------------------------------------------

function scheduleIsOverdue(schedule) {
  const health = normalize(schedule.healthState);
  if (health === "overdue" || health === "failing") {
    return true;
  }
  if (Number(schedule.missedAuditCount || 0) > 0) {
    return true;
  }
  return schedule.dueRejectReason === "window_closed" || schedule.rejectReason === "window_closed";
}

function scheduleDueToday(schedule, nowMs) {
  if (schedule.isDueNow) {
    return true;
  }
  const dueMs = parseDate(schedule.dueAt);
  return isSameLocalDay(dueMs, nowMs);
}

function hoursLate(schedule, nowMs) {
  const windowEnd = parseDate(schedule.windowEnd) ?? parseDate(schedule.dueAt);
  if (windowEnd === null) {
    return 0;
  }
  return Math.max(0, Math.round((nowMs - windowEnd) / 3.6e6));
}

// ---------------------------------------------------------------------------
// Risk by site / department
// ---------------------------------------------------------------------------

export function buildRiskByArea(input = {}) {
  const {
    overdueSchedules = [],
    openActions = [],
    openIncidents = [],
    openFindings = [],
    areaNameMap = new Map(),
    nowMs = Date.now(),
  } = input;

  const byArea = new Map();
  const ensure = (label) => {
    const key = label || "Unassigned";
    if (!byArea.has(key)) {
      byArea.set(key, {
        area: key,
        overdueInspections: 0,
        openActions: 0,
        incidents: 0,
        criticalFindings: 0,
        score: 0,
      });
    }
    return byArea.get(key);
  };

  let hasAnyAreaSignal = false;

  for (const schedule of overdueSchedules) {
    const label = trim(schedule.areaLabel);
    if (!label) continue;
    hasAnyAreaSignal = true;
    const entry = ensure(label);
    entry.overdueInspections += 1;
    entry.score += 6;
  }
  for (const action of openActions) {
    const label = resolveAreaLabel(action, areaNameMap);
    if (!label) continue;
    hasAnyAreaSignal = true;
    const entry = ensure(label);
    entry.openActions += 1;
    entry.score += normalize(normalizeActionStatus(extractField(action, ["status"]), extractField(action, ["due date"]), nowMs)) === "overdue" ? 5 : 3;
  }
  for (const incident of openIncidents) {
    const label = resolveAreaLabel(incident, areaNameMap);
    if (!label) continue;
    hasAnyAreaSignal = true;
    const entry = ensure(label);
    entry.incidents += 1;
    entry.score += RISK_WEIGHT[normalizeRiskLevel(extractField(incident, ["severity", "risk level"]))] || 3;
  }
  for (const finding of openFindings) {
    const label = resolveAreaLabel(finding, areaNameMap);
    if (!label) continue;
    const level = normalizeRiskLevel(extractField(finding, ["risk level", "severity"]));
    hasAnyAreaSignal = true;
    const entry = ensure(label);
    if (level === "Critical" || level === "High") {
      entry.criticalFindings += 1;
    }
    entry.score += RISK_WEIGHT[level] || 1;
  }

  if (!hasAnyAreaSignal) {
    return [];
  }

  const ranked = [...byArea.values()].sort((a, b) => b.score - a.score);
  return ranked.map((entry) => ({
    ...entry,
    level: riskLevelForScore(entry.score),
  }));
}

function riskLevelForScore(score) {
  if (score >= 18) return "Critical";
  if (score >= 10) return "High";
  if (score >= 4) return "Medium";
  return "Low";
}

// ---------------------------------------------------------------------------
// Act Today ranked list
// ---------------------------------------------------------------------------

const ACT_TODAY_BASE = {
  overdueInspection: 100,
  currentIncident: 90,
  overdueAction: 80,
  pendingBriefing: 55,
  dueToday: 60,
  openAction: 40,
};

function severityBoost(level) {
  if (level === "Critical") return 12;
  if (level === "High") return 8;
  if (level === "Medium") return 3;
  return 0;
}

export function buildActToday(input = {}) {
  const {
    overdueInspections = [],
    currentIncidents = [],
    overdueActions = [],
    openActions = [],
    dueTodayInspections = [],
    pendingBriefings = [],
    limit = 12,
  } = input;

  const items = [];

  for (const item of overdueInspections) {
    items.push({
      id: `insp-overdue-${item.id}`,
      type: "overdue-inspection",
      title: item.title,
      subtitle: item.subtitle,
      area: item.area || "",
      owner: item.owner || "",
      priority: "High",
      dueLabel: item.dueLabel || "Overdue",
      score: ACT_TODAY_BASE.overdueInspection + severityBoost("High"),
    });
  }

  for (const item of currentIncidents) {
    const level = normalizeRiskLevel(item.severity);
    items.push({
      id: `incident-${item.id}`,
      type: "incident",
      title: item.title,
      subtitle: item.subtitle,
      area: item.area || "",
      owner: item.owner || "",
      priority: level,
      dueLabel: item.dueLabel || "Open incident",
      score: ACT_TODAY_BASE.currentIncident + severityBoost(level),
    });
  }

  for (const item of overdueActions) {
    const level = normalizeRiskLevel(item.severity);
    items.push({
      id: `action-overdue-${item.id}`,
      type: "overdue-action",
      title: item.title,
      subtitle: item.subtitle,
      area: item.area || "",
      owner: item.owner || "",
      priority: level === "Low" ? "High" : level,
      dueLabel: item.dueLabel || "Overdue",
      score: ACT_TODAY_BASE.overdueAction + severityBoost(level),
    });
  }

  for (const item of pendingBriefings) {
    items.push({
      id: `briefing-${item.id}`,
      type: "briefing",
      title: item.title,
      subtitle: item.subtitle,
      area: "",
      owner: item.owner || "",
      priority: item.priority || "Medium",
      dueLabel: item.dueLabel || "Needs sign-off",
      score: ACT_TODAY_BASE.pendingBriefing + severityBoost(item.priority || "Medium"),
    });
  }

  for (const item of dueTodayInspections) {
    items.push({
      id: `insp-today-${item.id}`,
      type: "due-today",
      title: item.title,
      subtitle: item.subtitle,
      area: item.area || "",
      owner: item.owner || "",
      priority: "Medium",
      dueLabel: item.dueLabel || "Due today",
      score: ACT_TODAY_BASE.dueToday,
    });
  }

  for (const item of openActions) {
    const level = normalizeRiskLevel(item.severity);
    items.push({
      id: `action-open-${item.id}`,
      type: "open-action",
      title: item.title,
      subtitle: item.subtitle,
      area: item.area || "",
      owner: item.owner || "",
      priority: level,
      dueLabel: item.dueLabel || "Open",
      score: ACT_TODAY_BASE.openAction + severityBoost(level),
    });
  }

  return items
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function dayLabel(ms) {
  return ukDateKeyFromTimestamp(ms);
}

function monthLabel(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Briefings pending
// ---------------------------------------------------------------------------

function briefingRequiresBool(record, keys) {
  const raw = normalize(extractField(record, keys));
  return raw === "true" || raw === "yes" || raw === "1";
}

function recipientNeedsBriefingAction(recipient, briefing) {
  if (!briefing) {
    return false;
  }
  const briefingStatus = normalize(extractField(briefing, ["status"]));
  if (briefingStatus && briefingStatus !== "sent" && briefingStatus !== "active") {
    return false;
  }
  const requiresRead = briefingRequiresBool(briefing, ["requires read", "requiresread"]);
  const requiresAck = briefingRequiresBool(briefing, ["requires acknowledgement", "requiresacknowledgement"]);
  const requiresSign = briefingRequiresBool(briefing, ["requires signature", "requiressignature"]);
  const requiresReply = briefingRequiresBool(briefing, ["requires reply", "requiresreply"]);
  if (!requiresRead && !requiresAck && !requiresSign && !requiresReply) {
    // No explicit requirement — treat an incomplete status as needing action.
    const recipientStatus = normalize(extractField(recipient, ["status"]));
    return recipientStatus !== "" && !["complete", "completed", "done", "signed", "acknowledged"].includes(recipientStatus);
  }
  if (requiresRead && !extractField(recipient, ["read at", "readat"])) return true;
  if (requiresAck && !extractField(recipient, ["acknowledged at", "acknowledgedat"])) return true;
  if (requiresSign && !extractField(recipient, ["signed at", "signedat"])) return true;
  if (requiresReply && !extractField(recipient, ["reply at", "replyat"])) return true;
  return false;
}

function briefingIsMandatory(briefing) {
  return (
    briefingRequiresBool(briefing, ["requires acknowledgement", "requiresacknowledgement"]) ||
    briefingRequiresBool(briefing, ["requires signature", "requiressignature"]) ||
    briefingRequiresBool(briefing, ["requires read", "requiresread"])
  );
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the whole live dashboard payload from raw workbook tab records.
 * @param {object} sources raw arrays keyed by domain (schedules, auditResults, …)
 * @param {object} options { companyFolderId, alternateIds, actor, now, syncQueue, failedSources, warnings }
 */
export function buildLiveDashboardFromSources(sources = {}, options = {}) {
  const companyFolderId = trim(options.companyFolderId);
  const alternateIds = toArray(options.alternateIds);
  const actor = options.actor || {};
  const nowMs = options.now instanceof Date ? options.now.getTime() : Number(options.now) || Date.now();
  const ownOnly = shouldScopeLiveDashboardToOwn(actor);
  const actorEmail = normalize(actor.email);
  const warnings = [...toArray(options.warnings)];
  for (const failed of toArray(options.failedSources)) {
    warnings.push({ source: failed, message: `Could not load ${failed}. Showing the rest of the dashboard.` });
  }

  const areaNameMap = buildAreaNameMap(sources.areas, sources.sites);

  // --- Schedules → due today / overdue inspections ---------------------------
  const scheduleRows = filterCompanyRows(sources.schedules, companyFolderId, alternateIds);
  let schedules = parseCompanyScheduleListFromRecords(scheduleRows, companyFolderId, alternateIds).filter(
    (schedule) => schedule.lifecycle !== "Archived" && !isVerificationSchedule(schedule),
  );
  schedules = enrichSchedulesWithDueOccurrence(schedules, new Date(nowMs)).map((schedule) => ({
    ...schedule,
    areaLabel: resolveAreaLabel(scheduleRows.find((row) => extractField(row, ["schedule id"]) === schedule.id) || {}, areaNameMap),
  }));

  if (ownOnly && actorEmail) {
    schedules = schedules.filter((schedule) => getScheduleAssignedEmails(schedule).map(normalize).includes(actorEmail));
  }

  // --- AuditResults → completed today ---------------------------------------
  let results = filterCompanyRows(sources.auditResults, companyFolderId, alternateIds).filter((row) =>
    isOperationalAuditResult(row),
  );
  if (ownOnly && actorEmail) {
    results = results.filter((row) =>
      actorEmailMatches(row, actorEmail, [["completed by email", "completed by"], ["completed by name"]]),
    );
  }
  const completedTodayResults = results.filter((row) =>
    isSameLocalDay(parseDate(extractField(row, ["completed at", "created at"])), nowMs),
  );
  const completedTodayScheduleIds = new Set(
    completedTodayResults.map((row) => extractField(row, ["schedule id"])).filter(Boolean),
  );

  const dueTodaySchedules = schedules.filter((schedule) => scheduleDueToday(schedule, nowMs));
  const overdueSchedules = schedules.filter((schedule) => scheduleIsOverdue(schedule));
  const outstandingSchedules = dueTodaySchedules.filter((schedule) => !completedTodayScheduleIds.has(schedule.id));

  // --- Actions --------------------------------------------------------------
  let actions = filterCompanyRows(sources.actions, companyFolderId, alternateIds).filter(
    (row) => !isWorkbookRowArchived(row, "action") && isOperationalAction(row),
  );
  if (ownOnly && actorEmail) {
    actions = actions.filter((row) =>
      actorEmailMatches(row, actorEmail, [
        ["assigned to user id", "assigned to name", "assigned to"],
        ["created by user id", "created by"],
      ]),
    );
  }
  const actionBuckets = { Open: 0, "In progress": 0, Overdue: 0, Closed: 0 };
  const openActionRows = [];
  const overdueActionRows = [];
  for (const row of actions) {
    const bucket = normalizeActionStatus(extractField(row, ["status"]), extractField(row, ["due date"]), nowMs);
    actionBuckets[bucket] = (actionBuckets[bucket] || 0) + 1;
    if (bucket === "Overdue") {
      overdueActionRows.push(row);
    }
    if (isOpenActionBucket(bucket)) {
      openActionRows.push(row);
    }
  }

  // --- Incidents ------------------------------------------------------------
  let incidents = filterCompanyRows(sources.incidents, companyFolderId, alternateIds).filter(
    (row) => !isWorkbookRowArchived(row, "incident") && isOperationalWorkbookIncidentRow(row),
  );
  if (ownOnly && actorEmail) {
    incidents = incidents.filter((row) =>
      actorEmailMatches(row, actorEmail, [["assigned to email", "assigned to"], ["reporter email"]]),
    );
  }
  const openIncidents = incidents.filter((row) => incidentIsOpen(row));
  const openHighRiskIncidents = openIncidents.filter((row) => {
    const level = normalizeRiskLevel(extractField(row, ["severity", "risk level"]));
    return level === "High" || level === "Critical";
  });

  // --- NCRs -----------------------------------------------------------------
  const ncrs = filterCompanyRows(sources.ncrs, companyFolderId, alternateIds).filter(
    (row) => !isWorkbookRowArchived(row, "ncr"),
  );
  const openNcrs = ncrs.filter((row) => ncrIsOpen(row));

  // --- Findings -------------------------------------------------------------
  const findings = filterCompanyRows(sources.auditFindings, companyFolderId, alternateIds);
  const openFindings = findings;

  // --- Briefings ------------------------------------------------------------
  const briefingRows = filterCompanyRows(sources.briefings, companyFolderId, alternateIds).filter(
    (row) => !isWorkbookRowArchived(row, "briefing"),
  );
  const briefingById = new Map();
  for (const row of briefingRows) {
    const id = extractField(row, ["briefing id", "briefingid"]);
    if (id) {
      briefingById.set(id, row);
    }
  }
  let recipientRows = toArray(sources.briefingRecipients);
  if (ownOnly && actorEmail) {
    recipientRows = recipientRows.filter((row) => normalize(extractField(row, ["recipient email", "recipientemail"])) === actorEmail);
  }
  const pendingBriefingRecipients = recipientRows.filter((recipient) => {
    const briefingId = extractField(recipient, ["briefing id", "briefingid"]);
    const briefing = briefingById.get(briefingId);
    if (!briefing) {
      return false;
    }
    return recipientNeedsBriefingAction(recipient, briefing);
  });
  const unsignedMandatoryBriefings = pendingBriefingRecipients.filter((recipient) => {
    const briefing = briefingById.get(extractField(recipient, ["briefing id", "briefingid"]));
    return briefingIsMandatory(briefing);
  }).length;

  // --- Build detail lists for Act Today -------------------------------------
  const overdueInspectionItems = overdueSchedules.map((schedule) => ({
    id: schedule.id,
    title: schedule.scheduleName || "Scheduled inspection",
    subtitle: [schedule.areaLabel, `${hoursLate(schedule, nowMs)}h late`].filter(Boolean).join(" • "),
    area: schedule.areaLabel || "",
    owner: getScheduleAssignedEmails(schedule)[0] || "",
    hoursLate: hoursLate(schedule, nowMs),
    priority: "High",
    dueLabel: "Overdue",
  }));

  const dueTodayItems = outstandingSchedules.map((schedule) => ({
    id: schedule.id,
    title: schedule.scheduleName || "Scheduled inspection",
    subtitle: [schedule.areaLabel, getScheduleAssignedEmails(schedule)[0]].filter(Boolean).join(" • "),
    area: schedule.areaLabel || "",
    owner: getScheduleAssignedEmails(schedule)[0] || "",
    dueLabel: "Due today",
  }));

  const currentIncidentItems = openIncidents.map((row) => {
    const startedMs = parseDate(extractField(row, ["incident date", "created at"]));
    const daysOpen = startedMs === null ? 0 : Math.max(0, Math.floor((nowMs - startedMs) / DAY_MS));
    return {
      id: extractField(row, ["incident id", "incident record id"]) || extractField(row, ["created at"]) || String(startedMs),
      title: extractField(row, ["incident type", "type"]) || "Incident",
      subtitle: [resolveAreaLabel(row, areaNameMap), `${daysOpen}d open`].filter(Boolean).join(" • "),
      area: resolveAreaLabel(row, areaNameMap),
      owner: extractField(row, ["assigned to name", "assigned to", "reporter name"]),
      severity: normalizeRiskLevel(extractField(row, ["severity", "risk level"])),
      status: extractField(row, ["status"]) || "Open",
      daysOpen,
      dueLabel: `${daysOpen}d open`,
    };
  });

  const actionRowToItem = (row) => ({
    id: extractField(row, ["action id", "actionid"]) || extractField(row, ["source question id"]) || extractField(row, ["created at"]),
    title: extractField(row, ["source question text", "description", "corrective action"]) || "Action",
    subtitle: [extractField(row, ["assigned to name", "assigned to user id"]), extractField(row, ["due date"]) && `due ${extractField(row, ["due date"]).slice(0, 10)}`].filter(Boolean).join(" • "),
    area: resolveAreaLabel(row, areaNameMap),
    owner: extractField(row, ["assigned to name", "assigned to user id"]),
    severity: normalizeRiskLevel(extractField(row, ["severity", "risk category"])),
    dueDate: extractField(row, ["due date"]),
    dueLabel: "",
  });
  const overdueActionItems = overdueActionRows.map((row) => ({ ...actionRowToItem(row), dueLabel: "Overdue" }));
  const openNonOverdueActionItems = openActionRows
    .filter((row) => normalizeActionStatus(extractField(row, ["status"]), extractField(row, ["due date"]), nowMs) !== "Overdue")
    .map((row) => ({ ...actionRowToItem(row), dueLabel: "Open" }));

  const pendingBriefingItems = pendingBriefingRecipients.map((recipient) => {
    const briefing = briefingById.get(extractField(recipient, ["briefing id", "briefingid"]));
    return {
      id: `${extractField(recipient, ["briefing id", "briefingid"])}::${extractField(recipient, ["recipient email", "recipientemail"])}`,
      title: extractField(briefing || {}, ["title"]) || "Briefing",
      subtitle: extractField(recipient, ["recipient name", "recipient email"]),
      owner: extractField(recipient, ["recipient name", "recipient email"]),
      priority: extractField(briefing || {}, ["priority"]) === "Urgent" ? "High" : extractField(briefing || {}, ["priority"]) === "Important" ? "Medium" : "Low",
      mandatory: briefingIsMandatory(briefing),
      dueLabel: "Needs sign-off",
    };
  });

  // --- Metrics --------------------------------------------------------------
  const metrics = {
    todayDue: dueTodaySchedules.length,
    todayCompleted: completedTodayResults.length,
    todayOutstanding: outstandingSchedules.length,
    overdueInspections: overdueSchedules.length,
    openActions: openActionRows.length,
    overdueActions: overdueActionRows.length,
    currentIncidents: openIncidents.length,
    pendingBriefings: pendingBriefingRecipients.length,
    openNcrs: openNcrs.length,
    complianceScore: 0,
  };

  const compliance = computeComplianceScore({
    overdueInspections: metrics.overdueInspections,
    overdueActions: metrics.overdueActions,
    openHighRiskIncidents: openHighRiskIncidents.length,
    unsignedMandatoryBriefings,
    openNcrs: openNcrs.length,
  });
  metrics.complianceScore = compliance.score;

  // --- Act Today ------------------------------------------------------------
  const actToday = buildActToday({
    overdueInspections: overdueInspectionItems,
    currentIncidents: currentIncidentItems.filter((item) => item.severity === "High" || item.severity === "Critical").concat(
      currentIncidentItems.filter((item) => item.severity !== "High" && item.severity !== "Critical"),
    ),
    overdueActions: overdueActionItems,
    openActions: openNonOverdueActionItems,
    dueTodayInspections: dueTodayItems,
    pendingBriefings: pendingBriefingItems,
  });

  // --- Risk by area ---------------------------------------------------------
  const riskByArea = buildRiskByArea({
    overdueSchedules,
    openActions: openActionRows,
    openIncidents,
    openFindings,
    areaNameMap,
    nowMs,
  });

  // --- Charts ---------------------------------------------------------------
  const auditTrendMap = new Map();
  for (const row of results) {
    const ms = parseDate(extractField(row, ["completed at", "created at"]));
    if (ms === null) continue;
    const label = dayLabel(ms);
    auditTrendMap.set(label, (auditTrendMap.get(label) || 0) + 1);
  }
  const auditTrend = [...auditTrendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));

  const actionBreakdown = Object.entries(actionBuckets).map(([label, value]) => ({ label, value }));

  const incidentTrendMap = new Map();
  for (const row of incidents) {
    const ms = parseDate(extractField(row, ["incident date", "created at"]));
    if (ms === null) continue;
    const label = monthLabel(ms);
    incidentTrendMap.set(label, (incidentTrendMap.get(label) || 0) + 1);
  }
  const incidentTrend = [...incidentTrendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));

  const briefingStatusBuckets = { Pending: pendingBriefingRecipients.length, Read: 0, Acknowledged: 0, Signed: 0 };
  for (const recipient of recipientRows) {
    if (extractField(recipient, ["signed at", "signedat"])) briefingStatusBuckets.Signed += 1;
    else if (extractField(recipient, ["acknowledged at", "acknowledgedat"])) briefingStatusBuckets.Acknowledged += 1;
    else if (extractField(recipient, ["read at", "readat"])) briefingStatusBuckets.Read += 1;
  }
  const briefingStatus = Object.entries(briefingStatusBuckets).map(([label, value]) => ({ label, value }));

  const charts = { auditTrend, actionBreakdown, incidentTrend, briefingStatus };

  // --- Sync -----------------------------------------------------------------
  const syncLogRows = filterCompanyRows(sources.syncLog, companyFolderId, alternateIds);
  const failedSyncLog = syncLogRows.filter((row) => {
    const status = normalize(extractField(row, ["status"]));
    return status === "failed" || status === "error";
  }).length;
  const sync = buildSyncWarning({
    queued: Number(options.syncQueue?.queued) || 0,
    failed: (Number(options.syncQueue?.failed) || 0) + failedSyncLog,
    lastStatus: options.syncQueue?.lastStatus,
    lastSyncAt: options.syncQueue?.lastSyncAt,
  });
  if (sync.hasIssue) {
    warnings.push({ source: "sync", message: sync.message });
  }

  // --- Today panel context --------------------------------------------------
  const today = {
    dateLabel: getUkTodayKey(nowMs),
    due: metrics.todayDue,
    completed: metrics.todayCompleted,
    outstanding: metrics.todayOutstanding,
    overdue: metrics.overdueInspections,
    missedChecks: overdueSchedules.reduce((total, schedule) => total + Math.max(0, Number(schedule.missedAuditCount || 0)), 0),
  };

  const hasAnyData =
    scheduleRows.length > 0 ||
    results.length > 0 ||
    actions.length > 0 ||
    incidents.length > 0 ||
    ncrs.length > 0 ||
    briefingRows.length > 0;

  const emptyState = actToday.length === 0 && metrics.todayDue === 0 && metrics.openActions === 0 && metrics.currentIncidents === 0
    ? (hasAnyData ? "all-clear" : "no-data")
    : null;

  return {
    metrics,
    today,
    actToday,
    compliance,
    riskByArea,
    riskEmptyMessage: riskByArea.length === 0 ? LIVE_DASHBOARD_NO_RISK_DATA : "",
    sections: {
      outstandingActions: [...overdueActionItems, ...openNonOverdueActionItems],
      overdueInspections: overdueInspectionItems.sort((a, b) => b.hoursLate - a.hoursLate),
      currentIncidents: currentIncidentItems.sort((a, b) => b.daysOpen - a.daysOpen),
      briefings: pendingBriefingItems,
    },
    charts,
    sync,
    warnings,
    emptyState,
  };
}
