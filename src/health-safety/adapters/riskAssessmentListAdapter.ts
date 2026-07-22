import type { StatusBadgeVariant } from "../../components/ui/StatusBadge";
import type { RiskAssessmentListTab, RiskAssessmentRecord } from "../../types/riskAssessment";

export type RiskAssessmentFilterState = {
  query: string;
  status: string;
  site: string;
  area: string;
  assessmentType: string;
  owner: string;
  reviewDueOnly: boolean;
  overdueOnly: boolean;
  includeArchived: boolean;
};

export type RiskAssessmentListItem = {
  id: string;
  assessmentNumber: string;
  title: string;
  assessmentType: string;
  siteId: string;
  areaId: string;
  ownerName: string;
  highestResidualRiskScore: number;
  status: string;
  reviewDate: string;
  version: string;
  raw: RiskAssessmentRecord;
  sortPriority: number;
};

const STATUS_RANK: Record<string, number> = {
  Overdue: 0,
  "Review Due": 1,
  Submitted: 2,
  Rejected: 3,
  Draft: 4,
  Approved: 5,
  Active: 6,
  Superseded: 7,
  Archived: 8,
};

export function riskAssessmentStatusLabel(status: string) {
  return status || "Draft";
}

export function riskAssessmentStatusVariant(status: string): StatusBadgeVariant {
  switch (status) {
    case "Active":
      return "success";
    case "Review Due":
      return "warning";
    case "Overdue":
    case "Rejected":
      return "danger";
    case "Submitted":
      return "info";
    case "Draft":
      return "neutral";
    case "Superseded":
    case "Archived":
      return "neutral";
    default:
      return "neutral";
  }
}

export function buildRiskAssessmentListItems(records: RiskAssessmentRecord[]): RiskAssessmentListItem[] {
  return records.map((record) => ({
    id: record.id,
    assessmentNumber: record.assessmentNumber,
    title: record.title,
    assessmentType: record.assessmentType,
    siteId: record.siteId,
    areaId: record.areaId,
    ownerName: record.ownerName,
    highestResidualRiskScore: record.highestResidualRiskScore || 0,
    status: record.status,
    reviewDate: record.reviewDate,
    version: record.version,
    raw: record,
    sortPriority:
      (STATUS_RANK[record.status] ?? 9) * 100 -
      (record.highestResidualRiskScore || 0) * 2 -
      new Date(record.reviewDate || record.updatedAt || record.createdAt).getTime() / 1e12,
  }));
}

export function filterRiskAssessmentItems(items: RiskAssessmentListItem[], filters: RiskAssessmentFilterState) {
  const query = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (!filters.includeArchived && item.status === "Archived") return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.site && item.siteId !== filters.site) return false;
    if (filters.area && item.areaId !== filters.area) return false;
    if (filters.assessmentType && item.assessmentType !== filters.assessmentType) return false;
    if (filters.owner && !item.ownerName.toLowerCase().includes(filters.owner.toLowerCase())) return false;
    if (filters.reviewDueOnly && item.status !== "Review Due") return false;
    if (filters.overdueOnly && item.status !== "Overdue") return false;
    if (!query) return true;
    return (
      item.title.toLowerCase().includes(query) ||
      item.assessmentNumber.toLowerCase().includes(query) ||
      item.assessmentType.toLowerCase().includes(query) ||
      item.ownerName.toLowerCase().includes(query)
    );
  });
}

export function filterRiskAssessmentItemsForTab(items: RiskAssessmentListItem[], tab: RiskAssessmentListTab) {
  switch (tab) {
    case "active":
      return items.filter((item) => ["Active", "Approved", "Review Due", "Overdue"].includes(item.status));
    case "drafts":
      return items.filter((item) => item.status === "Draft" || item.status === "Rejected");
    case "awaiting_approval":
      return items.filter((item) => item.status === "Submitted");
    case "review_due":
      return items.filter((item) => item.status === "Review Due");
    case "overdue":
      return items.filter((item) => item.status === "Overdue");
    case "archived":
      return items.filter((item) => item.status === "Archived" || item.status === "Superseded");
    default:
      return items;
  }
}

export function sortRiskAssessmentItems(items: RiskAssessmentListItem[]) {
  return [...items].sort((left, right) => left.sortPriority - right.sortPriority || left.title.localeCompare(right.title));
}

export function buildRiskAssessmentSummary(records: RiskAssessmentRecord[]) {
  return {
    total: records.filter((r) => r.status !== "Archived" && r.status !== "Superseded").length,
    active: records.filter((r) => ["Active", "Approved"].includes(r.status)).length,
    drafts: records.filter((r) => r.status === "Draft" || r.status === "Rejected").length,
    awaitingApproval: records.filter((r) => r.status === "Submitted").length,
    reviewDue: records.filter((r) => r.status === "Review Due").length,
    overdue: records.filter((r) => r.status === "Overdue").length,
    highResidual: records.filter((r) => (r.highestResidualRiskScore || 0) >= 10 && (r.highestResidualRiskScore || 0) < 17).length,
    veryHighResidual: records.filter((r) => (r.highestResidualRiskScore || 0) >= 17).length,
    archived: records.filter((r) => r.status === "Archived" || r.status === "Superseded").length,
  };
}
