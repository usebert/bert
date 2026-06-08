/**
 * Structural props types for DashboardScreen — mirrors App.tsx domain types so the screen
 * does not import App.tsx. Keep aligned when workspace models change.
 */

import type { Role } from "../permissions";
import type { ActionItem, Audit, AuditStatus, HistoryEntry } from "./reportsScreenProps";

export type ThemeMode = "light" | "dark";
export type Answer = "pass" | "nc" | "fail";

export type User = {
  username: string;
  password: string;
  role: Role;
  name: string;
  accessLevel?: string;
  companyAreas?: string[];
};

export type EvidenceItem = {
  id: string;
  name: string;
  previewUrl: string;
  addedAt: string;
  uploaded?: boolean;
  blobKey?: string;
  mimeType?: string;
  size?: number;
};

export type AuditDraft = {
  responses: Record<string, Answer>;
  textResponses?: Record<string, string>;
  notes: Record<string, string>;
  evidence: Record<string, EvidenceItem[]>;
  questionIndex?: number;
  updatedAt: string;
};

export type CompanyFolder = {
  id: string;
  name: string;
  onboardingFormName: string;
  onboardingFormId?: string;
  auditFormCount: number;
  auditFormIds?: string[];
  responseSheetName: string;
  responseSheetId?: string;
  linkedAt: string;
  onboardingVerified: boolean;
  auditFormsVerified: boolean;
  responseSheetVerified: boolean;
  registryStatus?: string;
};

export type CompanySheetSyncStatus = {
  sheetId: string;
  sheetName: string;
  tabs: string[];
  usersCount: number;
  schedulesCount: number;
  onboardingCount: number;
  actionsCount: number;
  notesCount: number;
  findingsCount?: number;
  evidenceCount?: number;
  reportsCount?: number;
  configCount?: number;
  lastSyncedAt: string;
};

export type WorkspaceValidation = {
  ok: boolean;
  schemaVersion: string;
  currentSchemaVersion: string;
  folders: {
    companyFolder: boolean;
    setupFolder: boolean;
    auditFormsFolder: boolean;
    recordsFolder: boolean;
    evidenceFolder: boolean;
    exportsFolder: boolean;
    managementNotesFolder: boolean;
  };
  tabs: Record<string, boolean>;
  missingTabs: string[];
  missingColumns: Record<string, string[]>;
  warnings: string[];
  repairableIssues?: string[];
};

export type AuditorTaskDashboardProps = {
  currentUser: User;
  groupedAudits: Record<AuditStatus, Audit[]>;
  assignedAudits: Audit[];
  drafts: Record<string, AuditDraft>;
  actions: ActionItem[];
  pendingSyncCount: number;
  failedSyncCount: number;
  showStartHereCard: boolean;
  workspaceLinked: boolean;
  recentCompletionsCount: number;
  onOpenAudit: (auditId: string) => void;
  slatePrimaryCtaInteract: string;
};

export type ManagerDashboardProps = {
  currentUser: User;
  groupedAudits: Record<AuditStatus, Audit[]>;
  assignedAudits: Audit[];
  actions: ActionItem[];
  history: HistoryEntry[];
  pendingSyncCount: number;
  failedSyncCount: number;
  offlineQueueCount: number;
  workspaceLinked: boolean;
  /** Surface onboarding card when workspace is new, empty, or demo data is active. */
  showStartHereCard: boolean;
  demoModeActive: boolean;
  openIncidentFollowUpsCount: number;
  onOpenIncidents: () => void;
  onOpenAudit: (auditId: string) => void;
  onAdvanceAction: (actionId: string, nextStatus?: ActionItem["status"]) => void;
  recurringFailedQuestions: [string, number][];
  onViewAllNeedsAttention: () => void;
  onViewAllDueToday: () => void;
  onViewAllAwaitingVerification: () => void;
  onViewAllInProgress: () => void;
  onViewAllRecentCompletions: () => void;
  onOpenSyncCentre: () => void;
  /** Company sheet last sync label for plain-English dashboard copy */
  lastSyncedAt?: string | null;
};

export type AdminDashboardProps = {
  groupedAudits: Record<AuditStatus, Audit[]>;
  assignedAudits: Audit[];
  actions: ActionItem[];
  history: HistoryEntry[];
  workspaceLinked: boolean;
  pendingSyncCount: number;
  failedSyncCount: number;
  reportUsersCount: number;
  activeSchedulesCount: number;
  templatesCount: number;
  showStartHereCard: boolean;
  onOpenAudit: (auditId: string) => void;
  onAdvanceAction: (actionId: string, nextStatus?: ActionItem["status"]) => void;
};
