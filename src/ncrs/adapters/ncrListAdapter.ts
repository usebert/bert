import type { NonConformanceRecord } from "../../types/nonConformanceScreenProps";
import { isUkOverdue } from "../../utils/ukDateTime";
import type { NcrDisplayStatus, NcrFilterState, NcrListItem, NcrSummaryMetric, NcrWorkspaceTab } from "../types";

function parseNcrSequence(reference: string) {
  const match = reference.match(/^NCR-(\d+)$/i);
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
}

function displayStatus(record: NonConformanceRecord): NcrDisplayStatus {
  if (record.status === "Completed") return "Closed";
  const hasCause = Boolean(record.rootCause?.trim());
  const hasCorrective = Boolean(record.correctiveAction?.trim());
  const hasNotes = Boolean(record.investigationNotes?.trim());
  if (!hasNotes) return "Cause analysis required";
  if (!hasCause) return "Cause analysis required";
  if (!hasCorrective) return "Corrective action required";
  if (hasCorrective && record.status === "In Progress") return "Awaiting verification";
  return "Open";
}

function isOverdue(record: NonConformanceRecord): boolean {
  return record.status !== "Completed" && Boolean(record.raisedAt) && isUkOverdue(record.raisedAt);
}

export function buildNcrListItems(records: NonConformanceRecord[]): NcrListItem[] {
  return records.map((record) => {
    const overdue = isOverdue(record);
    let status = displayStatus(record);
    if (overdue && status !== "Closed") status = "Overdue";
    const sortPriority =
      status === "Closed"
        ? 1000 - parseNcrSequence(record.reference)
        : overdue
          ? -100
          : status === "Awaiting verification"
            ? -50
            : -parseNcrSequence(record.reference);
    return {
      id: record.id,
      reference: record.reference,
      title: record.auditQuestion?.trim().slice(0, 80) || record.auditName,
      source: record.auditName || "Audit",
      site: record.site,
      area: "",
      owner: record.assignedLineManager || record.auditorName,
      dateRaised: record.raisedAt,
      dueDate: record.raisedAt,
      severity: record.selectedAnswer === "fail" ? "High" : "Medium",
      status,
      correctiveActionStatus: record.correctiveAction?.trim() ? "Entered" : "Outstanding",
      raw: record,
      sortPriority,
    };
  });
}

export function filterItemsForTab(items: NcrListItem[], tab: NcrWorkspaceTab): NcrListItem[] {
  switch (tab) {
    case "overdue":
      return items.filter((item) => item.status === "Overdue");
    case "awaiting-verification":
      return items.filter((item) => item.status === "Awaiting verification" || item.raw.status === "In Progress");
    case "closed":
      return items.filter((item) => item.raw.status === "Completed");
    case "archived":
      return [];
    case "open":
    default:
      return items.filter((item) => item.raw.status !== "Completed" && item.status !== "Overdue");
  }
}

export function filterNcrItems(items: NcrListItem[], filters: NcrFilterState): NcrListItem[] {
  const query = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.site && !item.site.toLowerCase().includes(filters.site.toLowerCase())) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (!query) return true;
    return [item.reference, item.title, item.site, item.owner, item.source].some((value) =>
      value.toLowerCase().includes(query),
    );
  });
}

export function sortNcrItems(items: NcrListItem[]): NcrListItem[] {
  return [...items].sort((a, b) => a.sortPriority - b.sortPriority);
}

export function buildNcrSummaryMetrics(records: NonConformanceRecord[]): NcrSummaryMetric[] {
  const items = buildNcrListItems(records);
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return [
    { key: "open", label: "Open NCRs", value: String(items.filter((i) => i.raw.status !== "Completed").length) },
    { key: "overdue", label: "Overdue", value: String(items.filter((i) => i.status === "Overdue").length), tone: "danger" },
    { key: "high", label: "High severity", value: String(items.filter((i) => i.severity === "High" && i.raw.status !== "Completed").length) },
    { key: "corrective", label: "Awaiting corrective action", value: String(items.filter((i) => i.correctiveActionStatus === "Outstanding" && i.raw.status !== "Completed").length) },
    { key: "verification", label: "Awaiting verification", value: String(items.filter((i) => i.status === "Awaiting verification").length) },
    {
      key: "closed",
      label: "Closed this month",
      value: String(records.filter((r) => r.status === "Completed" && (r.completionDateTime || "").slice(0, 7) === monthKey).length),
      tone: "success",
    },
  ];
}
