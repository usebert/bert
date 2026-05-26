import { storageKeys } from "../config/storageKeys";

type WorkspaceStateBlob = {
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

/** Clears operational workspace localStorage when the active company was reset on the server. */
export function clearCompanyWorkspaceLocalState(companyFolderId: string) {
  if (typeof window === "undefined" || !companyFolderId) {
    return { cleared: false };
  }

  try {
    const raw = window.localStorage.getItem(storageKeys.workspaceState);
    if (!raw) {
      return { cleared: false };
    }
    const stored = JSON.parse(raw) as WorkspaceStateBlob;
    if (stored.selectedFolderId && stored.selectedFolderId !== companyFolderId) {
      return { cleared: false, reason: "different_company_selected" as const };
    }

    const next: WorkspaceStateBlob = {
      ...stored,
      selectedFolderId: companyFolderId,
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
    window.localStorage.setItem(storageKeys.workspaceState, JSON.stringify(next));
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}
