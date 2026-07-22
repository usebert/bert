import type { StatusBadgeVariant } from "../../components/ui/StatusBadge";
import type { CoshhListSummary, CoshhRecord, CoshhStatus } from "../../types/healthSafety";

export type CoshhFilterState = {
  query: string;
  status: CoshhStatus | "" | "active_register";
  site: string;
};

export type CoshhListItem = {
  id: string;
  productName: string;
  manufacturer: string;
  supplier: string;
  siteId: string;
  areaId: string;
  storageLocation: string;
  reviewDate: string;
  status: CoshhStatus;
  hasSds: boolean;
  assessmentRequired: boolean;
  approvedForUse: boolean;
  raw: CoshhRecord;
  sortPriority: number;
};

const STATUS_RANK: Record<CoshhStatus, number> = {
  overdue: 0,
  missing_sds: 1,
  assessment_required: 2,
  review_due: 3,
  current: 4,
  archived: 5,
};

export function coshhStatusLabel(status: CoshhStatus): string {
  switch (status) {
    case "current":
      return "Current";
    case "review_due":
      return "Review due";
    case "overdue":
      return "Overdue";
    case "missing_sds":
      return "Missing SDS";
    case "assessment_required":
      return "Assessment required";
    case "archived":
      return "Archived";
    default:
      return status;
  }
}

export function coshhStatusVariant(status: CoshhStatus): StatusBadgeVariant {
  switch (status) {
    case "current":
      return "success";
    case "review_due":
      return "warning";
    case "overdue":
    case "missing_sds":
      return "danger";
    case "assessment_required":
      return "info";
    case "archived":
      return "neutral";
    default:
      return "neutral";
  }
}

export function buildCoshhListItems(records: CoshhRecord[]): CoshhListItem[] {
  return records.map((record) => {
    const hasSds = Boolean(record.sdsDocumentId || record.sdsFileName);
    return {
      id: record.id,
      productName: record.productName,
      manufacturer: record.manufacturer,
      supplier: record.supplier,
      siteId: record.siteId,
      areaId: record.areaId,
      storageLocation: record.storageLocation,
      reviewDate: record.reviewDate,
      status: record.status,
      hasSds,
      assessmentRequired: record.assessmentRequired,
      approvedForUse: record.approvedForUse,
      raw: record,
      sortPriority: STATUS_RANK[record.status] ?? 10,
    };
  });
}

export function buildCoshhSummary(records: CoshhRecord[]): CoshhListSummary {
  const active = records.filter((item) => item.status !== "archived");
  return {
    total: active.length,
    current: active.filter((item) => item.status === "current").length,
    reviewDue: active.filter((item) => item.status === "review_due").length,
    overdue: active.filter((item) => item.status === "overdue").length,
    missingSds: active.filter((item) => item.status === "missing_sds").length,
    assessmentRequired: active.filter((item) => item.status === "assessment_required").length,
    archived: records.filter((item) => item.status === "archived").length,
  };
}

export function filterCoshhItems(items: CoshhListItem[], filters: CoshhFilterState): CoshhListItem[] {
  const query = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.status === "active_register" && item.status === "archived") {
      return false;
    }
    if (filters.status && filters.status !== "active_register" && item.status !== filters.status) {
      return false;
    }
    if (filters.site && item.siteId !== filters.site && item.raw.siteId !== filters.site) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [
      item.productName,
      item.manufacturer,
      item.supplier,
      item.raw.productCode,
      item.storageLocation,
      item.raw.description,
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

export function sortCoshhItems(items: CoshhListItem[]): CoshhListItem[] {
  return [...items].sort((left, right) => {
    if (left.sortPriority !== right.sortPriority) {
      return left.sortPriority - right.sortPriority;
    }
    return left.productName.localeCompare(right.productName);
  });
}
