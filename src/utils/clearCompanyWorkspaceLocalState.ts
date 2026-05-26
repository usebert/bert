import { storageKeys } from "../config/storageKeys";

export type WorkspaceStateBlob = {
  selectedFolderId?: string;
  folders?: unknown[];
  audits?: unknown[];
  history?: unknown[];
  actions?: unknown[];
  nonConformances?: unknown[];
  schedules?: unknown[];
  templates?: unknown[];
  drafts?: Record<string, unknown>;
  managedSchedules?: unknown[];
  invitedUsers?: unknown[];
  sites?: unknown[];
  selectedSiteId?: string;
  companySheetSync?: unknown;
  reportInbox?: unknown[];
  syncQueue?: unknown[];
  incidents?: unknown[];
  incidentActions?: unknown[];
  auditAccessOverrides?: Record<string, unknown>;
  managerAlerts?: unknown[];
  areaAudits?: unknown[];
  selectedAreaAuditAreaId?: string;
  complianceSchedules?: unknown[];
  auditFindings?: unknown[];
  externalEmployees?: unknown[];
  documentDistributions?: unknown[];
  qmsDocuments?: unknown[];
  qmsTraining?: unknown[];
  qmsRisks?: unknown[];
  hsHazardReports?: unknown[];
  hsRiskAssessments?: unknown[];
  hsSafetyObservations?: unknown[];
  hsObjectives?: unknown[];
};

/** Operational company fields cleared when switching companies or starting a new one. */
export function clearedCompanyWorkspaceOperationalFields(): Pick<
  WorkspaceStateBlob,
  | "audits"
  | "history"
  | "actions"
  | "nonConformances"
  | "schedules"
  | "templates"
  | "drafts"
  | "managedSchedules"
  | "invitedUsers"
  | "sites"
  | "selectedSiteId"
  | "companySheetSync"
  | "reportInbox"
  | "syncQueue"
  | "incidents"
  | "incidentActions"
  | "auditAccessOverrides"
  | "managerAlerts"
  | "areaAudits"
  | "selectedAreaAuditAreaId"
  | "complianceSchedules"
  | "auditFindings"
  | "externalEmployees"
  | "documentDistributions"
  | "qmsDocuments"
  | "qmsTraining"
  | "qmsRisks"
  | "hsHazardReports"
  | "hsRiskAssessments"
  | "hsSafetyObservations"
  | "hsObjectives"
> {
  return {
    audits: [],
    history: [],
    actions: [],
    nonConformances: [],
    schedules: [],
    templates: [],
    drafts: {},
    managedSchedules: [],
    invitedUsers: [],
    sites: [],
    selectedSiteId: "",
    companySheetSync: null,
    reportInbox: [],
    syncQueue: [],
    incidents: [],
    incidentActions: [],
    auditAccessOverrides: {},
    managerAlerts: [],
    areaAudits: [],
    selectedAreaAuditAreaId: "",
    complianceSchedules: [],
    auditFindings: [],
    externalEmployees: [],
    documentDistributions: [],
    qmsDocuments: [],
    qmsTraining: [],
    qmsRisks: [],
    hsHazardReports: [],
    hsRiskAssessments: [],
    hsSafetyObservations: [],
    hsObjectives: [],
  };
}

function readWorkspaceStateBlob(): WorkspaceStateBlob | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKeys.workspaceState);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as WorkspaceStateBlob;
  } catch {
    return null;
  }
}

function writeWorkspaceStateBlob(next: WorkspaceStateBlob) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKeys.workspaceState, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Clears operational workspace localStorage when the active company was reset on the server. */
export function clearCompanyWorkspaceLocalState(companyFolderId: string) {
  if (typeof window === "undefined" || !companyFolderId) {
    return { cleared: false };
  }

  const stored = readWorkspaceStateBlob();
  if (!stored) {
    return { cleared: false };
  }
  if (stored.selectedFolderId && stored.selectedFolderId !== companyFolderId) {
    return { cleared: false, reason: "different_company_selected" as const };
  }

  const next: WorkspaceStateBlob = {
    ...stored,
    selectedFolderId: companyFolderId,
    ...clearedCompanyWorkspaceOperationalFields(),
  };
  writeWorkspaceStateBlob(next);
  return { cleared: true };
}

/** Master Godmode: wipe company workspace data and leave no active company selected. */
export function clearGodmodeNewCompanyWorkspaceLocalState() {
  if (typeof window === "undefined") {
    return { cleared: false };
  }

  const stored = readWorkspaceStateBlob();
  const next: WorkspaceStateBlob = {
    ...(stored || {}),
    selectedFolderId: "",
    ...clearedCompanyWorkspaceOperationalFields(),
  };
  writeWorkspaceStateBlob(next);
  return { cleared: true };
}

/** Master Godmode: clear operational data before switching to another company folder. */
export function clearCompanyWorkspaceLocalStateForGodmodeSwitch() {
  if (typeof window === "undefined") {
    return { cleared: false };
  }

  const stored = readWorkspaceStateBlob();
  if (!stored) {
    return { cleared: false };
  }

  const next: WorkspaceStateBlob = {
    ...stored,
    ...clearedCompanyWorkspaceOperationalFields(),
  };
  writeWorkspaceStateBlob(next);
  return { cleared: true };
}
