import type { IncidentCorrectiveAction, IncidentRecord } from "../../types/incidentsScreenProps";
import { isUkOverdue } from "../../utils/ukDateTime";
import type { SafetyDisplayStatus, SafetyFilterState, SafetyListItem, SafetySummaryMetric, SafetyWorkspaceTab } from "../types";

const SEVERITY_RANK: Record<string, number> = {
  Fatality: 0,
  "Major Incident": 1,
  "Lost Time Injury": 2,
  "Medical Treatment": 3,
  Minor: 4,
};

function displayStatus(incident: IncidentRecord, openActions: number): SafetyDisplayStatus {
  if (incident.status === "Closed") return "Closed";
  if (incident.status === "Under Investigation") {
    if (openActions > 0) return "Action required";
    return "Under investigation";
  }
  if (openActions > 0) return "Action required";
  return "Reported";
}

function sortPriority(incident: IncidentRecord, openActions: number, overdueInvestigation: boolean): number {
  if (incident.status === "Closed") return 1000 - new Date(incident.closedAt || incident.updatedAt || incident.createdAt).getTime() / 1e10;
  let score = 0;
  if (incident.priority === "High") score -= 100;
  score -= (SEVERITY_RANK[incident.severity] ?? 5) * 10;
  if (overdueInvestigation) score -= 50;
  if (incident.status === "Under Investigation") score -= 20;
  if (openActions > 0) score -= 5;
  score -= new Date(`${incident.incidentDate}T${incident.incidentTime || "00:00"}`).getTime() / 1e12;
  return score;
}

function openActionCount(incidentId: string, actions: IncidentCorrectiveAction[]): number {
  return actions.filter((item) => item.incidentId === incidentId && item.status !== "Complete").length;
}

function isInvestigationOverdue(incident: IncidentRecord): boolean {
  return incident.status === "Under Investigation" && Boolean(incident.dueDate) && isUkOverdue(incident.dueDate);
}

export function buildSafetyListItems(
  incidents: IncidentRecord[],
  incidentActions: IncidentCorrectiveAction[],
): SafetyListItem[] {
  return incidents.map((incident) => {
    const actionsRaised = incidentActions.filter((item) => item.incidentId === incident.id).length;
    const openActions = openActionCount(incident.id, incidentActions);
    const overdue = isInvestigationOverdue(incident);
    const siteArea = incident.department || "";
    const [site, area] = siteArea.includes(" / ") ? siteArea.split(" / ", 2) : [siteArea, ""];
    return {
      id: incident.id,
      reference: incident.incidentId,
      type: incident.incidentType,
      title: incident.description.trim().slice(0, 80) || incident.incidentType,
      site: site || incident.location,
      area: area || "",
      reportedBy: incident.reporterName,
      dateReported: `${incident.incidentDate} ${incident.incidentTime}`.trim(),
      severity: incident.severity,
      investigationStatus: incident.status === "Under Investigation" ? (overdue ? "Overdue" : "In progress") : incident.status,
      actionsRaised,
      status: displayStatus(incident, openActions),
      raw: incident,
      sortPriority: sortPriority(incident, openActions, overdue),
    };
  });
}

export function filterItemsForTab(items: SafetyListItem[], tab: SafetyWorkspaceTab): SafetyListItem[] {
  switch (tab) {
    case "near-misses":
      return items.filter((item) => item.type === "Near Miss" && item.raw.status !== "Closed");
    case "investigations":
      return items.filter((item) => item.raw.status === "Under Investigation");
    case "closed":
      return items.filter((item) => item.raw.status === "Closed");
    case "incidents":
      return items.filter((item) => item.type !== "Near Miss" && item.raw.status !== "Closed");
    default:
      return items;
  }
}

export function filterSafetyItems(items: SafetyListItem[], filters: SafetyFilterState): SafetyListItem[] {
  const query = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.status && item.raw.status !== filters.status) return false;
    if (filters.severity && item.severity !== filters.severity) return false;
    if (filters.site && !item.site.toLowerCase().includes(filters.site.toLowerCase())) return false;
    if (filters.area && !item.area.toLowerCase().includes(filters.area.toLowerCase())) return false;
    if (filters.fromDate && item.raw.incidentDate < filters.fromDate) return false;
    if (filters.toDate && item.raw.incidentDate > filters.toDate) return false;
    if (filters.investigator) {
      const investigator = (item.raw.assignedToName || item.raw.assignedTo || "").toLowerCase();
      if (!investigator.includes(filters.investigator.toLowerCase())) return false;
    }
    if (filters.actionsOutstanding) {
      const open = item.raw.status !== "Closed" && item.actionsRaised > 0;
      if (!open) return false;
    }
    if (!query) return true;
    return [
      item.reference,
      item.title,
      item.site,
      item.area,
      item.reportedBy,
      item.raw.description,
      item.raw.location,
    ].some((value) => value.toLowerCase().includes(query));
  });
}

export function sortSafetyItems(items: SafetyListItem[], tab: SafetyWorkspaceTab): SafetyListItem[] {
  return [...items].sort((a, b) => {
    if (tab === "closed") {
      const aTime = new Date(a.raw.closedAt || a.raw.updatedAt || a.raw.createdAt).getTime();
      const bTime = new Date(b.raw.closedAt || b.raw.updatedAt || b.raw.createdAt).getTime();
      return bTime - aTime;
    }
    return a.sortPriority - b.sortPriority;
  });
}

export function buildSafetySummaryMetrics(
  incidents: IncidentRecord[],
  incidentActions: IncidentCorrectiveAction[],
): SafetySummaryMetric[] {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const openIncidents = incidents.filter((item) => item.status !== "Closed").length;
  const highRisk = incidents.filter((item) => item.priority === "High" && item.status !== "Closed").length;
  const nearMisses = incidents.filter((item) => item.incidentType === "Near Miss" && item.status !== "Closed").length;
  const investigationsOverdue = incidents.filter((item) => isInvestigationOverdue(item)).length;
  const awaitingReview = incidents.filter(
    (item) => item.status === "Under Investigation" && !isInvestigationOverdue(item),
  ).length;
  const closedThisMonth = incidents.filter(
    (item) => item.status === "Closed" && (item.closedAt || item.updatedAt || "").slice(0, 7) === monthKey,
  ).length;
  const openActions = incidentActions.filter((item) => item.status !== "Complete").length;

  return [
    { key: "open", label: "Open incidents", value: String(openIncidents) },
    { key: "high-risk", label: "High-risk incidents", value: String(highRisk), tone: highRisk > 0 ? "danger" : "default" },
    { key: "near-misses", label: "Near misses", value: String(nearMisses) },
    { key: "overdue-inv", label: "Investigations overdue", value: String(investigationsOverdue), tone: investigationsOverdue > 0 ? "warning" : "default" },
    { key: "awaiting-review", label: "Awaiting review", value: String(awaitingReview) },
    { key: "closed-month", label: "Closed this month", value: String(closedThisMonth), tone: "success" },
    { key: "open-actions", label: "Open actions", value: String(openActions) },
  ];
}

export function visibleTabsForRole(canManage: boolean, fieldAuditor: boolean): SafetyWorkspaceTab[] {
  if (fieldAuditor) return ["report"];
  const tabs: SafetyWorkspaceTab[] = ["report", "incidents", "near-misses"];
  if (canManage) {
    tabs.push("investigations", "closed");
  }
  return tabs;
}
