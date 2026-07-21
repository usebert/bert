import type { NonConformanceScreenProps } from "../types/nonConformanceScreenProps";
import type { NonConformanceRecord } from "../types/nonConformanceScreenProps";

export type NcrWorkspaceProps = NonConformanceScreenProps & {
  initialNcrId?: string;
};

export type NcrWorkspaceTab = "open" | "overdue" | "awaiting-verification" | "closed" | "archived";

export type NcrDisplayStatus =
  | "Open"
  | "Containment required"
  | "Cause analysis required"
  | "Corrective action required"
  | "Awaiting verification"
  | "Closed"
  | "Overdue"
  | "Archived";

export type NcrFilterState = {
  query: string;
  site: string;
  severity: string;
  status: string;
};

export type NcrListItem = {
  id: string;
  reference: string;
  title: string;
  source: string;
  site: string;
  area: string;
  owner: string;
  dateRaised: string;
  dueDate: string;
  severity: string;
  status: NcrDisplayStatus;
  correctiveActionStatus: string;
  raw: NonConformanceRecord;
  sortPriority: number;
};

export type NcrSummaryMetric = {
  key: string;
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger" | "success";
};
