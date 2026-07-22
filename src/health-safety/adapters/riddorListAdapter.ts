import type { StatusBadgeVariant } from "../../components/ui/StatusBadge";
import type { RiddorDecisionStatus, RiddorRecord, RiddorSubmissionStatus } from "../../types/healthSafety";

export type RiddorWorkspaceTab = RiddorDecisionStatus | "all" | "open_submissions";

export type RiddorFilterState = {
  query: string;
  submissionStatus: RiddorSubmissionStatus | "";
};

export type RiddorListItem = {
  id: string;
  incidentId: string;
  decisionStatus: RiddorDecisionStatus;
  decisionDate: string;
  submissionStatus: RiddorSubmissionStatus;
  submissionReference: string;
  followUpDate: string;
  reportableOutcome: string;
  raw: RiddorRecord;
  sortPriority: number;
};

const DECISION_RANK: Record<RiddorDecisionStatus, number> = {
  decision_required: 0,
  information_required: 1,
  likely_reportable: 2,
  confirmed_reportable: 3,
  not_reportable: 4,
};

export const RIDDOR_TAB_LABELS: Record<RiddorWorkspaceTab, string> = {
  all: "All",
  decision_required: "Decision required",
  information_required: "Information required",
  likely_reportable: "Likely reportable",
  not_reportable: "Not reportable",
  confirmed_reportable: "Confirmed reportable",
  open_submissions: "Open submissions",
};

export function riddorDecisionLabel(status: RiddorDecisionStatus): string {
  return RIDDOR_TAB_LABELS[status] || status;
}

export function riddorDecisionVariant(status: RiddorDecisionStatus): StatusBadgeVariant {
  switch (status) {
    case "confirmed_reportable":
    case "likely_reportable":
      return "danger";
    case "decision_required":
    case "information_required":
      return "warning";
    case "not_reportable":
      return "success";
    default:
      return "neutral";
  }
}

export function riddorSubmissionLabel(status: RiddorSubmissionStatus): string {
  switch (status) {
    case "not_started":
      return "Not started";
    case "in_preparation":
      return "In preparation";
    case "submitted":
      return "Submitted";
    case "follow_up_required":
      return "Follow-up required";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}

export function riddorSubmissionVariant(status: RiddorSubmissionStatus): StatusBadgeVariant {
  switch (status) {
    case "submitted":
    case "closed":
      return "success";
    case "follow_up_required":
    case "in_preparation":
      return "warning";
    case "not_started":
      return "info";
    default:
      return "neutral";
  }
}

export function buildRiddorListItems(records: RiddorRecord[]): RiddorListItem[] {
  return records.map((record) => ({
    id: record.id,
    incidentId: record.incidentId,
    decisionStatus: record.decisionStatus,
    decisionDate: record.decisionDate,
    submissionStatus: record.submissionStatus,
    submissionReference: record.submissionReference,
    followUpDate: record.followUpDate,
    reportableOutcome: record.reportableOutcome,
    raw: record,
    sortPriority: DECISION_RANK[record.decisionStatus] ?? 10,
  }));
}

export function filterRiddorItemsForTab(items: RiddorListItem[], tab: RiddorWorkspaceTab): RiddorListItem[] {
  if (tab === "all") {
    return items;
  }
  if (tab === "open_submissions") {
    return items.filter((item) => item.submissionStatus !== "closed");
  }
  return items.filter((item) => item.decisionStatus === tab);
}

export function filterRiddorItems(items: RiddorListItem[], filters: RiddorFilterState): RiddorListItem[] {
  const query = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.submissionStatus && item.submissionStatus !== filters.submissionStatus) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [item.incidentId, item.submissionReference, item.reportableOutcome, item.raw.supportingReason].some((value) =>
      String(value || "").toLowerCase().includes(query),
    );
  });
}

export function sortRiddorItems(items: RiddorListItem[]): RiddorListItem[] {
  return [...items].sort((left, right) => {
    if (left.sortPriority !== right.sortPriority) {
      return left.sortPriority - right.sortPriority;
    }
    return (right.decisionDate || right.raw.createdAt).localeCompare(left.decisionDate || left.raw.createdAt);
  });
}
