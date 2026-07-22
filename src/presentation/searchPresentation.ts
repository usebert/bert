import type { RoutedScreen } from "../types/navigation";

export type SearchResultKind =
  | "action"
  | "audit"
  | "completed-audit"
  | "document"
  | "document-library"
  | "incident"
  | "near-miss"
  | "ncr"
  | "equipment"
  | "coshh"
  | "coshh-assessment"
  | "riddor"
  | "risk-assessment"
  | "person"
  | "site"
  | "area"
  | "briefing"
  | "schedule";

export type SearchNavigateTarget = {
  screen: RoutedScreen;
  actionId?: string;
  auditId?: string;
  openAudit?: boolean;
  documentId?: string;
  incidentId?: string;
  ncrId?: string;
  briefingId?: string;
  scheduleId?: string;
  siteId?: string;
  coshhId?: string;
  assessmentId?: string;
  riddorId?: string;
  riskAssessmentId?: string;
};

export type SearchResultItem = {
  id: string;
  kind: SearchResultKind;
  title: string;
  typeLabel: string;
  status?: string;
  site?: string;
  description?: string;
  navigate: SearchNavigateTarget;
  searchText: string;
};

export type SearchResultGroup = {
  id: string;
  label: string;
  items: SearchResultItem[];
};

export const SEARCH_GROUP_ORDER: Array<{ id: string; label: string; kinds: SearchResultKind[] }> = [
  { id: "actions", label: "Actions", kinds: ["action"] },
  { id: "audits", label: "Audits", kinds: ["audit", "completed-audit"] },
  { id: "documents", label: "Documents", kinds: ["document", "document-library"] },
  { id: "equipment", label: "Equipment", kinds: ["equipment"] },
  { id: "health-safety", label: "Health & Safety", kinds: ["coshh", "coshh-assessment", "riddor", "risk-assessment"] },
  { id: "people", label: "People", kinds: ["person"] },
  { id: "incidents", label: "Incidents", kinds: ["incident", "near-miss"] },
  { id: "ncrs", label: "NCRs", kinds: ["ncr"] },
  { id: "sites", label: "Sites", kinds: ["site"] },
  { id: "areas", label: "Areas", kinds: ["area"] },
  { id: "briefings", label: "Briefings", kinds: ["briefing"] },
  { id: "schedules", label: "Schedules", kinds: ["schedule"] },
];

export const SEARCH_TYPE_LABELS: Record<SearchResultKind, string> = {
  action: "Action",
  audit: "Audit",
  "completed-audit": "Completed audit",
  document: "Document",
  "document-library": "Document library",
  incident: "Incident",
  "near-miss": "Near miss",
  ncr: "NCR",
  equipment: "Equipment",
  coshh: "COSHH product",
  "coshh-assessment": "COSHH assessment",
  riddor: "RIDDOR record",
  "risk-assessment": "Risk assessment",
  person: "Person",
  site: "Site",
  area: "Area",
  briefing: "Briefing",
  schedule: "Schedule",
};

export const RECENT_SEARCHES_KEY = "bert-global-search-recent";
export const RECENT_SEARCHES_MAX = 10;

export type StoredRecentSearch = Pick<
  SearchResultItem,
  "id" | "kind" | "title" | "typeLabel" | "status" | "site" | "description" | "navigate"
>;
