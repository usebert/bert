import type {
  IncidentRecord,
  IncidentReportingScreenProps,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
} from "../types/incidentsScreenProps";

export type SafetyWorkspaceProps = IncidentReportingScreenProps & {
  offlineMode?: boolean;
  initialIncidentId?: string;
  initialSafetyTab?: SafetyWorkspaceTab;
};

export type SafetyWorkspaceTab = "incidents" | "near-misses" | "investigations" | "closed" | "report";

export type SafetyDisplayStatus =
  | "Reported"
  | "Under investigation"
  | "Action required"
  | "Awaiting review"
  | "Closed"
  | "Archived";

export type SafetyFilterState = {
  query: string;
  status: IncidentStatus | "";
  severity: IncidentSeverity | "";
  site: string;
  area: string;
  fromDate: string;
  toDate: string;
  investigator: string;
  actionsOutstanding: boolean;
};

export type SafetyListItem = {
  id: string;
  reference: string;
  type: IncidentType;
  title: string;
  site: string;
  area: string;
  reportedBy: string;
  dateReported: string;
  severity: IncidentSeverity;
  investigationStatus: string;
  actionsRaised: number;
  status: SafetyDisplayStatus;
  raw: IncidentRecord;
  sortPriority: number;
};

export type SafetySummaryMetric = {
  key: string;
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger" | "success";
};
