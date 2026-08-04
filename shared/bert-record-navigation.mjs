/**
 * Universal BERT record navigation — single source of truth for operational links.
 * Used by live dashboard APIs, search, notifications, and the React shell.
 */

export const BERT_RECORD_TYPES = [
  "audit",
  "assigned-check",
  "action",
  "incident",
  "risk-assessment",
  "briefing",
  "document",
  "schedule",
  "equipment",
  "inspection",
  "ncr",
  "report",
];

const RECORD_TYPE_ALIASES = {
  audit: "audit",
  "assigned-check": "assigned-check",
  "assigned check": "assigned-check",
  check: "assigned-check",
  action: "action",
  incident: "incident",
  "risk-assessment": "risk-assessment",
  "risk assessment": "risk-assessment",
  briefing: "briefing",
  document: "document",
  schedule: "schedule",
  equipment: "equipment",
  inspection: "inspection",
  "overdue-inspection": "inspection",
  "due-today": "assigned-check",
  ncr: "ncr",
  report: "report",
  "open-action": "action",
  "overdue-action": "action",
};

const RECORD_TYPE_TO_SCREEN = {
  audit: "audits",
  "assigned-check": "audits",
  action: "actions",
  incident: "incidents",
  "risk-assessment": "riskAssessments",
  briefing: "briefings",
  document: "documents",
  schedule: "schedules",
  equipment: "loler",
  inspection: "audits",
  ncr: "nonConformance",
  report: "reports",
};

const FILTER_TO_ACTION_FILTER = {
  open: "Open",
  overdue: "Overdue",
  "awaiting-verification": "Awaiting Verification",
  closed: "Closed",
};

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeRecordType(value) {
  const key = trim(value).toLowerCase();
  return RECORD_TYPE_ALIASES[key] || key;
}

function parseBriefingRecordId(value) {
  const id = trim(value);
  if (!id) return "";
  const composite = id.includes("::") ? id.slice(0, id.indexOf("::")) : id.replace(/^briefing-/, "");
  return composite;
}

function buildQueryRoute(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const text = trim(value);
    if (text) search.set(key, text);
  }
  const query = search.toString();
  return query ? `/?${query}` : "/";
}

/**
 * @param {object} input
 * @returns {object}
 */
export function buildBertRecordLink(input = {}) {
  const recordType = normalizeRecordType(input.recordType || input.itemType);
  const recordId = trim(input.recordId || input.id);
  const companyFolderId = trim(input.companyFolderId);
  const scheduleId = trim(input.scheduleId);
  const templateId = trim(input.templateId);
  const sourceId = trim(input.sourceId);
  const sourceType = sourceId ? normalizeRecordType(input.sourceType) : "";
  const filter = trim(input.filter || input.statusFilter);
  const screen = trim(input.screen) || RECORD_TYPE_TO_SCREEN[recordType] || "dashboard";

  const routeParams = { screen };
  if (recordId) routeParams.id = recordId;
  if (filter) routeParams.filter = filter;
  if (scheduleId && (recordType === "assigned-check" || recordType === "inspection" || recordType === "schedule")) {
    routeParams.scheduleId = scheduleId;
  }
  if (templateId && (recordType === "assigned-check" || recordType === "inspection" || recordType === "audit")) {
    routeParams.templateId = templateId;
  }

  const route = buildQueryRoute(routeParams);
  const navigate = {
    screen,
    ...(recordType === "action" && recordId ? { actionId: recordId } : {}),
    ...(recordType === "incident" && recordId ? { incidentId: recordId } : {}),
    ...(recordType === "briefing" && recordId ? { briefingId: parseBriefingRecordId(recordId) } : {}),
    ...(recordType === "document" && recordId ? { documentId: recordId } : {}),
    ...(recordType === "schedule" && recordId ? { scheduleId: recordId } : {}),
    ...(recordType === "ncr" && recordId ? { ncrId: recordId } : {}),
    ...(recordType === "risk-assessment" && recordId ? { riskAssessmentId: recordId } : {}),
    ...((recordType === "assigned-check" || recordType === "inspection" || recordType === "audit") && (templateId || recordId)
      ? { auditId: templateId || recordId, openAudit: true }
      : {}),
    ...(scheduleId && (recordType === "assigned-check" || recordType === "inspection") ? { scheduleId } : {}),
  };

  const link = {
    itemType: recordType,
    recordType,
    recordId,
    title: trim(input.title),
    status: trim(input.status),
    dueDate: trim(input.dueDate),
    route,
    companyFolderId,
    screen,
    filter: filter || undefined,
    navigate,
    actionFilter: FILTER_TO_ACTION_FILTER[filter] || undefined,
  };

  if (sourceId && sourceType) {
    const sourceLink = buildBertRecordLink({
      recordType: sourceType,
      recordId: sourceId,
      companyFolderId,
      scheduleId: trim(input.sourceScheduleId),
      templateId: trim(input.sourceTemplateId),
    });
    link.sourceType = sourceType;
    link.sourceId = sourceId;
    link.sourceRoute = sourceLink.route;
    link.sourceNavigate = sourceLink.navigate;
    link.sourceTitle = trim(input.sourceTitle) || undefined;
  }

  return link;
}

/**
 * Map dashboard Act Today / section item types to navigation metadata.
 */
export function buildActTodayNavigation(item = {}, companyFolderId = "") {
  const type = trim(item.type);
  const rawId = trim(item.id);
  const templateId = trim(item.templateId || item.auditId);
  const scheduleId = trim(item.scheduleId || (type.includes("insp") ? item.id : ""));

  if (type === "overdue-inspection" || type === "due-today") {
    const scheduleRecordId = rawId.replace(/^insp-(?:overdue|today)-/, "");
    return buildBertRecordLink({
      recordType: type === "overdue-inspection" ? "inspection" : "assigned-check",
      recordId: templateId || scheduleRecordId,
      scheduleId: scheduleRecordId,
      templateId,
      companyFolderId,
      title: item.title,
      status: item.dueLabel,
      dueDate: item.dueDate,
      filter: type === "overdue-inspection" ? "overdue" : "due-today",
    });
  }

  if (type === "incident") {
    const incidentId = rawId.replace(/^incident-/, "");
    return buildBertRecordLink({
      recordType: "incident",
      recordId: incidentId,
      companyFolderId,
      title: item.title,
      status: item.status || item.dueLabel,
      dueDate: item.dueDate,
      filter: "under-review",
    });
  }

  if (type === "overdue-action" || type === "open-action") {
    const actionId = rawId.replace(/^action-(?:overdue|open)-/, "");
    return buildBertRecordLink({
      recordType: "action",
      recordId: actionId,
      companyFolderId,
      title: item.title,
      status: item.dueLabel,
      dueDate: item.dueDate,
      filter: type === "overdue-action" ? "overdue" : "open",
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourceTitle: item.sourceTitle,
      sourceTemplateId: item.sourceTemplateId,
      sourceScheduleId: item.sourceScheduleId,
    });
  }

  if (type === "briefing") {
    const briefingId = parseBriefingRecordId(rawId.replace(/^briefing-/, ""));
    return buildBertRecordLink({
      recordType: "briefing",
      recordId: briefingId,
      companyFolderId,
      title: item.title,
      status: item.dueLabel,
      dueDate: item.dueDate,
      filter: "pending",
    });
  }

  if (type === "document-review") {
    return buildBertRecordLink({
      recordType: "document",
      recordId: rawId.replace(/^document-/, ""),
      companyFolderId,
      title: item.title,
      status: item.dueLabel,
      filter: "awaiting-approval",
    });
  }

  if (type === "open-ncr") {
    return buildBertRecordLink({
      recordType: "ncr",
      recordId: rawId.replace(/^ncr-/, ""),
      companyFolderId,
      title: item.title,
      status: item.dueLabel,
    });
  }

  if (type === "loler-overdue") {
    return buildBertRecordLink({
      recordType: "equipment",
      recordId: rawId.replace(/^equipment-/, ""),
      companyFolderId,
      title: item.title,
      status: item.dueLabel,
      filter: "overdue",
    });
  }

  return buildBertRecordLink({
    recordType: "report",
    recordId: rawId,
    companyFolderId,
    title: item.title,
    status: item.dueLabel,
  });
}

export function enrichOperationalItem(item = {}, companyFolderId = "") {
  if (!item || typeof item !== "object") return item;
  if (item.route && item.recordId && item.itemType) return item;
  const navigation = buildActTodayNavigation(item, companyFolderId);
  return {
    ...item,
    itemType: navigation.itemType,
    recordId: navigation.recordId,
    recordType: navigation.recordType,
    route: navigation.route,
    companyFolderId: navigation.companyFolderId || companyFolderId || undefined,
    navigate: navigation.navigate,
    ...(navigation.sourceType
      ? {
          sourceType: navigation.sourceType,
          sourceId: navigation.sourceId,
          sourceRoute: navigation.sourceRoute,
          sourceNavigate: navigation.sourceNavigate,
          sourceTitle: navigation.sourceTitle,
        }
      : {}),
  };
}

export function enrichOperationalItems(items = [], companyFolderId = "") {
  return toArray(items).map((item) => enrichOperationalItem(item, companyFolderId));
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * KPI cards → filtered module list routes.
 */
export function buildKpiListNavigation(kpiId, companyFolderId = "") {
  const routes = {
    "open-actions": { screen: "actions", filter: "open" },
    "overdue-actions": { screen: "actions", filter: "overdue" },
    "current-incidents": { screen: "incidents", filter: "under-review" },
    "outstanding-briefings": { screen: "briefings", filter: "pending" },
    "documents-awaiting": { screen: "documents", filter: "awaiting-approval" },
    "equipment-due": { screen: "loler", filter: "overdue" },
    "today-due": { screen: "audits", filter: "due-today" },
    "today-outstanding": { screen: "audits", filter: "due-today" },
    "audits-completed": { screen: "results", filter: "today" },
    "compliance-score": { screen: "reports" },
    "sync-queued": { screen: "sync" },
  };
  const entry = routes[kpiId];
  if (!entry) {
    return buildBertRecordLink({ recordType: "report", companyFolderId, screen: "dashboard" });
  }
  return buildBertRecordLink({
    recordType: "report",
    companyFolderId,
    screen: entry.screen,
    filter: entry.filter,
  });
}

export function buildActionSourceLink(action = {}, companyFolderId = "") {
  const incidentId = trim(action.incidentId || action.sourceIncidentId);
  const riskAssessmentId = trim(action.riskAssessmentId || action.sourceRiskAssessmentId);
  const auditId = trim(action.auditId || action.sourceAuditId);
  const auditName = trim(action.auditName || action.sourceAuditName);
  const ncrId = trim(action.nonConformanceId || action.ncrId);

  if (incidentId) {
    const link = buildBertRecordLink({
      recordType: "incident",
      recordId: incidentId,
      companyFolderId,
      title: trim(action.incidentLabel) || incidentId,
    });
    return {
      sourceType: "incident",
      sourceId: incidentId,
      sourceLabel: `Linked incident: ${trim(action.incidentLabel) || incidentId}`,
      ...link,
    };
  }

  if (riskAssessmentId) {
    const link = buildBertRecordLink({
      recordType: "risk-assessment",
      recordId: riskAssessmentId,
      companyFolderId,
      title: trim(action.riskAssessmentLabel) || riskAssessmentId,
    });
    return {
      sourceType: "risk-assessment",
      sourceId: riskAssessmentId,
      sourceLabel: `Linked risk assessment: ${trim(action.riskAssessmentLabel) || riskAssessmentId}`,
      ...link,
    };
  }

  if (ncrId) {
    const link = buildBertRecordLink({
      recordType: "ncr",
      recordId: ncrId,
      companyFolderId,
      title: ncrId,
    });
    return {
      sourceType: "ncr",
      sourceId: ncrId,
      sourceLabel: `Linked NCR: ${ncrId}`,
      ...link,
    };
  }

  if (auditId) {
    const link = buildBertRecordLink({
      recordType: "audit",
      recordId: auditId,
      companyFolderId,
      title: auditName || auditId,
      templateId: auditId,
    });
    return {
      sourceType: "audit",
      sourceId: auditId,
      sourceLabel: auditName ? `Linked audit: ${auditName}` : `Linked audit: ${auditId}`,
      ...link,
    };
  }

  return null;
}

export function parseBertRouteSearch(search = "") {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    screen: trim(params.get("screen")),
    recordId: trim(params.get("id")),
    filter: trim(params.get("filter")),
    scheduleId: trim(params.get("scheduleId")),
    templateId: trim(params.get("templateId")),
  };
}

export function mapUrlFilterToActionFilter(filter) {
  return FILTER_TO_ACTION_FILTER[trim(filter).toLowerCase()] || "";
}

export function mapUrlFilterToSafetyTab(filter) {
  const value = trim(filter).toLowerCase();
  if (value === "under-review" || value === "investigations") return "investigations";
  if (value === "near-miss" || value === "near-misses") return "near-misses";
  if (value === "closed") return "closed";
  return "incidents";
}

export function searchTargetToRoute(target = {}) {
  const screen = trim(target.screen);
  if (!screen) return "/";
  if (target.actionId) {
    return buildBertRecordLink({ recordType: "action", recordId: target.actionId, screen: "actions" }).route;
  }
  if (target.incidentId) {
    return buildBertRecordLink({ recordType: "incident", recordId: target.incidentId, screen: "incidents" }).route;
  }
  if (target.briefingId) {
    return buildBertRecordLink({ recordType: "briefing", recordId: target.briefingId, screen: "briefings" }).route;
  }
  if (target.documentId) {
    return buildBertRecordLink({ recordType: "document", recordId: target.documentId, screen: "documents" }).route;
  }
  if (target.scheduleId) {
    return buildBertRecordLink({ recordType: "schedule", recordId: target.scheduleId, screen: "schedules" }).route;
  }
  if (target.ncrId) {
    return buildBertRecordLink({ recordType: "ncr", recordId: target.ncrId, screen: "nonConformance" }).route;
  }
  if (target.riskAssessmentId) {
    return buildBertRecordLink({
      recordType: "risk-assessment",
      recordId: target.riskAssessmentId,
      screen: "riskAssessments",
    }).route;
  }
  if (target.auditId) {
    return buildBertRecordLink({
      recordType: target.openAudit ? "assigned-check" : "audit",
      recordId: target.auditId,
      scheduleId: target.scheduleId,
      templateId: target.auditId,
      screen: "audits",
    }).route;
  }
  return buildQueryRoute({ screen });
}
