import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BertLogo } from "./src/components/BertLogo";
import type { NavItemId, Role, RoutedScreen } from "./src/permissions";
import {
  canAccessActions,
  canAccessAdmin,
  canAccessAdminOnboardingWorkspace,
  canAccessAuditsCentre,
  canAccessCompletedNcrReports,
  canAccessControlScreen,
  canAccessDocumentTraining,
  canAccessEmailReminders,
  canAccessOnboardingNav,
  canAccessPilotCompanies,
  canAccessPilotInvites,
  canAccessPilotSettings,
  canAccessGodmodeInitialSetup,
  canAccessPilotSetup,
  canAccessPilotUsers,
  usesPilotOperatorNav,
  canAccessReports,
  canAccessSchedules,
  canCompleteAuditAsAuditor,
  canEditLegalName,
  canRoleAccessNavItem,
  canSubmitAuditForReview,
  canSubmitIncidents,
  getCreatableRoles,
  getHomeScreenForRole,
  getRoleDisplayName,
  getRolePermissions,
} from "./src/permissions";
import { navItems } from "./src/config/navItems";
import { MORE_MENU_NAV_IDS, PILOT_PRIMARY_NAV_IDS, PRIMARY_NAV_IDS } from "./src/config/navStructure";
import { PilotReadinessCard } from "./src/components/pilot/PilotReadinessCard";
import { storageKeys } from "./src/config/storageKeys";
import { apiUrl } from "./src/config/apiBase";
import { slatePrimaryCtaInteract } from "./src/styles/interactions";
import { getGreetingFirstName, getTimeBasedGreeting, getUserInitials } from "./src/utils/userDisplay";
import { isDebugUiAllowed } from "./src/utils/debugUiVisibility";
import { AuditorTaskDashboard } from "./src/components/dashboard/AuditorTaskDashboard";
import { AdminDashboard } from "./src/components/dashboard/AdminDashboard";
import { ManagerDashboard } from "./src/components/dashboard/ManagerDashboard";
import { AccountSettingsScreen } from "./src/screens/AccountSettingsScreen";
import { ActionsScreen } from "./src/screens/ActionsScreen";
import { AdminScreen } from "./src/screens/AdminScreen";
import type { CompanyOnboardingEmailResult, CompanyUserInviteEmailResult } from "./src/types/adminScreenProps";
import { AppHostedOnboardingCompletion } from "./src/screens/AppHostedOnboardingCompletion";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { AuditsScreen } from "./src/screens/AuditsScreen";
import { AuditModeScreen } from "./src/screens/AuditModeScreen";
import { CompleteAuditScreen } from "./src/screens/CompleteAuditScreen";
import { IncidentReportingScreen } from "./src/screens/IncidentReportingScreen";
import { NonConformanceScreen } from "./src/screens/NonConformanceScreen";
import { ReportsScreen } from "./src/screens/ReportsScreen";
import { SchedulesScreen } from "./src/screens/SchedulesScreen";
import { DocumentTrainingScreen } from "./src/screens/DocumentTrainingScreen";
import { EmailRemindersScreen } from "./src/screens/EmailRemindersScreen";
import { GodmodeInitialSetupScreen } from "./src/screens/GodmodeInitialSetupScreen";
import { PilotSetupScreen } from "./src/screens/PilotSetupScreen";
import { isSetupInitialPath, leaveSetupInitialPath, navigateToSetupInitial } from "./src/utils/setupRoute";
import { PilotSettingsScreen } from "./src/screens/PilotSettingsScreen";
import { SyncCentreScreen } from "./src/screens/SyncCentreScreen";
import type { DocumentDistribution, ExternalEmployee } from "./src/types/documentTraining";
import type { OnboardedRecipientOption } from "./src/types/documentTrainingScreenProps";
import {
  EmptyPanel,
  KpiCard,
  MiniMetric,
  SectionHeader,
  StatusBadge,
  TrendBar,
} from "./src/components/dashboard/DashboardPrimitives";
import { pickNextAuditorAudit } from "./src/utils/auditorDashboard";
import { isEscalated, isOverdue, isStuck } from "./src/utils/managerDashboard";
import { getNextBestAction } from "./src/utils/nextBestAction";
import type { DashboardSummaryForNextAction, NextBestActionIntent } from "./src/utils/nextBestAction";
import {
  amberThresholdHours,
  computeScheduleHealthState,
  getAuditTrafficStatus,
  getDueWarning,
  statusStyles,
} from "./src/utils/dashboardHealth";
import type { CompanyReportUser, ReportItem, ReportSectionKey, ReportTemplateType } from "./src/types/reports";
import type { NonConformanceRecord } from "./src/types/nonConformanceScreenProps";
import type { SyncQueueItem, SyncStatus } from "./src/types/sync";

type AuditStatus = "green" | "amber" | "red";
type Answer = "pass" | "nc" | "fail";
type Priority = "High" | "Medium" | "Low";
type RiskLevel = "Low" | "Medium" | "High" | "Critical";
type RiskCategory = "Health & Safety" | "Quality" | "Environmental" | "Operational" | "Other";
type ActionStatus = "Open" | "In Progress" | "Awaiting Verification" | "Closed" | "Rejected";
type ScheduleFrequency =
  | "Daily"
  | "Weekly"
  | "Bi-Weekly"
  | "Monthly";
type ScheduleScope = "Company schedule" | "Personal schedule";
type OverdueAlertTiming = "At due time" | "30 minutes overdue" | "1 hour overdue" | "2 hours overdue";
type CompletionCheckTiming = "30 minutes after send" | "1 hour after send" | "At due time" | "2 hours after due";
/** Routed shell screen — alias of `RoutedScreen` from `src/types/navigation.ts` (re-exported via `src/permissions.ts`). */
type Screen = RoutedScreen;
type ThemeMode = "light" | "dark";
type ScheduleDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
type ScheduleLifecycle = "Live" | "Archived";
type ScheduleListFilter = "Live" | "Archived" | "All schedules";
type ScheduleHealthState = "Healthy" | "Due Soon" | "Overdue" | "Failing" | "Paused";
type PreviewOrientation = "portrait" | "landscape";

type User = {
  username: string;
  password: string;
  role: Role;
  name: string;
};

type RoleNavVisibilityMatrix = Record<Role, Record<NavItemId, boolean>>;
type RoleSiteSelectorVisibility = Record<Role, boolean>;

type UserInvite = {
  id: string;
  email: string;
  role: Role;
  invitedBy: string;
  senderEmail?: string;
  sentAt: string;
  status: "Email sent" | "Invite created" | "Invite sent";
  mailtoUrl?: string;
  appOnboardingUrl?: string;
};

type AuditQuestion = {
  id: string;
  text: string;
  fieldType?: "Traffic light" | "Text note" | "Photo evidence" | "Pass / Fail";
  riskLevel?: RiskLevel;
  riskCategory?: RiskCategory;
  autoActionRequired?: boolean;
  requiresPhotoEvidence?: boolean;
  requiresManagerReview?: boolean;
  answerPrompts?: Partial<Record<Answer, string[]>>;
};

type Audit = {
  id: string;
  name: string;
  category: string;
  siteArea: string;
  dueLabel: string;
  dueHours: number;
  priority: Priority;
  owner: string;
  templateVersion: string;
  status: AuditStatus;
  lastCompletedAt: string;
  questions: AuditQuestion[];
  totalRiskScore?: number;
  highestRiskLevel?: RiskLevel;
  numberOfCriticalFindings?: number;
  numberOfHighFindings?: number;
  scheduleHealthState?: ScheduleHealthState;
};

type HistoryEntry = {
  id: string;
  auditId: string;
  auditName: string;
  completedAt: string;
  completedBy: string;
  status: AuditStatus;
};

type AuditDraft = {
  responses: Record<string, Answer>;
  notes: Record<string, string>;
  evidence: Record<string, EvidenceItem[]>;
  updatedAt: string;
};

type EvidenceItem = {
  id: string;
  name: string;
  previewUrl: string;
  addedAt: string;
  uploaded?: boolean;
};

type ActionItem = {
  id: string;
  companyId: string;
  siteArea?: string;
  auditId: string;
  auditName: string;
  questionId: string;
  questionText: string;
  sourceAnswer: string;
  nonConformanceId?: string;
  severity: RiskLevel;
  owner: string;
  assignedToUserId: string;
  assignedToName: string;
  createdByUserId: string;
  createdAt: string;
  dueDate: string;
  closedAt: string;
  verifiedByUserId: string;
  verificationNotes: string;
  evidenceLinks: string[];
  localEvidenceRefs: string[];
  comments: string;
  recurrenceFlag: boolean;
  rootCause: string;
  correctiveAction: string;
  preventiveAction: string;
  dueLabel: string;
  dueHours: number;
  status: ActionStatus;
  evidenceCount: number;
  noteIncluded: boolean;
  riskCategory: RiskCategory;
  escalated?: boolean;
  isStuck?: boolean;
  evidenceRequired?: boolean;
  requiresManagerReview?: boolean;
};

type CompanyFolder = {
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
};

type Site = {
  id: string;
  name: string;
  code: string;
  active: boolean;
};

/** Normalized user email -> site ids they may access. Empty or missing entry means no restriction (all sites). */
type UserSiteAssignments = Record<string, string[]>;

type OnboardingSource = {
  configured: boolean;
  formId: string;
  formName: string;
  sheetId: string;
  sheetName: string;
};

type OnboardingRecord = {
  id: string;
  submittedAt: string;
  companyName: string;
  siteName: string;
  mainContact: string;
  contactEmail: string;
  reportingContact: string;
  auditRecipients: string;
  overdueAlertRecipients: string;
  companyFolderReference: string;
  raw: Record<string, string>;
};

type DashboardPreferences = {
  trafficBoard: boolean;
  liveSummary: boolean;
  upcomingAudits: boolean;
  openActions: boolean;
  complianceSnapshot: boolean;
};

type DashboardSectionKey = keyof DashboardPreferences;

type ScheduleItem = {
  id: string;
  companyFolderId: string;
  auditId: string;
  auditName: string;
  siteArea: string;
  owner: string;
  scope: ScheduleScope;
  personalAssignee: string;
  frequency: ScheduleFrequency;
  sendTime: string;
  recipients: string[];
  overdueAlertRecipients: string[];
  reportTo: string;
  overdueAlertTiming: OverdueAlertTiming;
  completionCheckTiming: CompletionCheckTiming;
  nextDueHours: number;
  priority: Priority;
};

type ManagedScheduleAudit = {
  id: string;
  auditId: string;
  auditName: string;
  days: ScheduleDay[];
  frequency: ScheduleFrequency;
  liveTime: string;
  completionHours: number;
};

type ManagedSchedule = {
  id: string;
  rootId: string;
  parentScheduleId?: string;
  versionNumber: number;
  versionLabel: string;
  lifecycle: ScheduleLifecycle;
  companyFolderId: string;
  scheduleName: string;
  audits: ManagedScheduleAudit[];
  auditors: string[];
  startDate: string;
  endDate: string;
  updatedAt: string;
  archivedAt?: string;
  reactivatedAt?: string;
  escalationUserIds?: string[];
  triggerReauditOnFailure?: boolean;
  reauditDelayHours?: number;
  missedAuditCount?: number;
  lastCompletedAt?: string;
  nextDueAt?: string;
  healthState?: ScheduleHealthState;
};

type AuditScheduleMatrixInfo = {
  scheduleName: string;
  versionLabel: string;
  frequency: ScheduleFrequency;
  days: ScheduleDay[];
  liveTime: string;
  completionHours: number;
};

type GoogleBackendStatus = {
  ok: boolean;
  configured: boolean;
  connected: boolean;
  sharedDriveId: string;
  companies?: CompanyFolder[];
  onboardingSource?: OnboardingSource;
  error?: string;
};

type FolderInspection = {
  ok: boolean;
  folder: {
    id: string;
    name: string;
    createdTime: string;
  };
  checks: {
    auditFormsFolder: boolean;
    masterDataFolder: boolean;
    masterSheet: boolean;
    evidenceFolder: boolean;
    exportsFolder: boolean;
    adminNotesFolder: boolean;
  };
  auditFormsFolder: { id: string; name: string } | null;
  masterDataFolder: { id: string; name: string } | null;
  masterSheet: { id: string; name: string; tabs: string[] } | null;
  auditForms: { id: string; name: string }[];
  blockingItems: string[];
  recommendedItems: string[];
  missingItems: string[];
  error?: string;
};

type CompanySheetPayload = {
  ok: boolean;
  sheetId: string;
  sheetName: string;
  tabs: string[];
  data: Record<string, Record<string, string>[]>;
  error?: string;
};

type CompanySheetSyncStatus = {
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

type SaveSchedulesResponse = {
  ok: boolean;
  error?: string;
};

type GoogleDriveFilePayload = {
  ok: boolean;
  file: {
    id: string;
    name: string;
    mimeType: string;
    createdTime?: string;
  };
  error?: string;
};

type GoogleFormsFolderPayload = {
  ok: boolean;
  folder: {
    id: string;
    name: string;
    mimeType: string;
    createdTime?: string;
  };
  forms: { id: string; name: string; mimeType: string }[];
  error?: string;
};

type AuditTemplate = {
  id: string;
  name: string;
  active: boolean;
  questions: AuditQuestion[];
  source: "Google Drive" | "Built in app";
};

type DraftTemplateQuestion = {
  id: string;
  text: string;
  fieldType: AuditQuestion["fieldType"];
  answerPrompts?: Partial<Record<Answer, string[]>>;
};

type OfflineSubmission = {
  id: string;
  audit: Audit;
  responses: Record<string, Answer>;
  notes: Record<string, string>;
  evidence: Record<string, EvidenceItem[]>;
  signatureDataUrl: string;
  queuedAt: string;
  submittedBy: string;
};

type AuditAccessLevel = "Full access" | "Oversight" | "Complete" | "No access";

type AuditAccessMatrixCell = {
  auditId: string;
  auditName: string;
  access: AuditAccessLevel;
  detail: string;
  hasAccess: boolean;
};

type AuditAccessMatrixRow = {
  email: string;
  name: string;
  role: Role;
  accessibleCount: number;
  cells: AuditAccessMatrixCell[];
};

type AuditAccessOverrideMap = Record<string, AuditAccessLevel>;

type WorkspaceValidation = {
  ok: boolean;
  schemaVersion: string;
  currentSchemaVersion: string;
  folders: {
    companyFolder: boolean;
    auditFormsFolder: boolean;
    evidenceFolder: boolean;
    exportsFolder: boolean;
    adminNotesFolder: boolean;
  };
  tabs: Record<string, boolean>;
  missingTabs: string[];
  missingColumns: Record<string, string[]>;
  warnings: string[];
};

type OnboardingSubmissionsResponse = {
  ok: boolean;
  onboardingSource: OnboardingSource;
  headers: string[];
  records: OnboardingRecord[];
  error?: string;
};

type Toast = {
  id: number;
  title: string;
  message: string;
  tone: "neutral" | "success" | "warning";
};

type ManagerAlert = {
  id: string;
  auditId: string;
  auditName: string;
  submittedBy: string;
  nonComplianceCount: number;
  queuedForSync: boolean;
  createdAt: string;
  managerEmails: string[];
  managerNames: string[];
  readBy: string[];
};

type IncidentStatus = "Open" | "Under Investigation" | "Closed";
type IncidentPriority = "Normal" | "High";
type IncidentType = "Accident" | "Near Miss" | "Dangerous Occurrence" | "Property Damage" | "Environmental";
type IncidentSeverity =
  | "Minor"
  | "Medical Treatment"
  | "Lost Time Injury"
  | "Major Incident"
  | "Fatality";

type IncidentEvidenceItem = {
  id: string;
  name: string;
  mimeType: string;
  previewUrl: string;
  addedAt: string;
};

type IncidentRecord = {
  id: string;
  incidentId: string;
  status: IncidentStatus;
  priority: IncidentPriority;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  incidentDate: string;
  incidentTime: string;
  reporterName: string;
  reporterEmail: string;
  department: string;
  location: string;
  description: string;
  immediateAction: string;
  injured: boolean;
  injuryDetails: string;
  contributingFactors: string;
  witnesses: string;
  evidenceUrls: IncidentEvidenceItem[];
  assignedTo: string;
  investigationNotes: string;
  rootCause: string;
  correctiveActions: string;
  preventiveActions: string;
  actionOwner: string;
  dueDate: string;
  completionDate: string;
  riddorRequired: boolean;
  closedBy: string;
  closedAt: string;
  notificationStatus: string;
  statusHistory: { at: string; from: IncidentStatus | ""; to: IncidentStatus; by: string; note: string }[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

type IncidentCorrectiveAction = {
  id: string;
  incidentId: string;
  description: string;
  owner: string;
  dueDate: string;
  status: "Open" | "In Progress" | "Complete";
  completedAt: string;
  completedBy: string;
};

type IssuePromptState = {
  question: AuditQuestion;
  answer: Exclude<Answer, "pass">;
};

type AuditCompletionSummaryState = {
  auditId: string;
  auditName: string;
  questionsAnswered: number;
  issuesFound: number;
  actionsCreated: number;
  photosCaptured: number;
  syncTone: "green" | "amber" | "red";
  syncLabel: string;
};

const DEFAULT_APP_DISPLAY_NAME = "bert.";
/** Short product name in shell chrome, notifications, and `document.title`. Override with `VITE_APP_NAME` (e.g. white-label). */
function resolveAppDisplayNameFromEnv(): string {
  const raw = String(import.meta.env.VITE_APP_NAME ?? "").trim();
  return raw || DEFAULT_APP_DISPLAY_NAME;
}
const companyName = resolveAppDisplayNameFromEnv();
const PRODUCT_TAGLINE = "Business. Evaluate. Report. Tool.";
function isDemoRoleSwitchEnabled() {
  const rawValue = String(import.meta.env.VITE_ENABLE_DEMO_ROLE_SWITCH || "").trim().toLowerCase();
  return rawValue === "true" || rawValue === "1" || rawValue === "yes" || rawValue === "on";
}
function canCreatePreviewProfile() {
  return isDemoRoleSwitchEnabled();
}
const demoRoleSwitchEnabled = isDemoRoleSwitchEnabled();
/** Sign-in / landing demo copy — display names only; internal `Role` values are unchanged (`Master`, etc.). */
const roles = ["Workspace setup", "Admin", "Manager", "Auditor"] as const;
const CURRENT_SCHEMA_VERSION = "2.0.0";
const REQUIRED_WORKSPACE_TABS = ["Onboarding", "Users", "Schedule", "Actions", "Notes", "Config"] as const;
const ACTION_DUE_DAYS_BY_SEVERITY: Record<RiskLevel, number> = {
  Critical: 1,
  High: 3,
  Medium: 7,
  Low: 14,
};

/** When true, static demo login users and related UI are included (dev or `VITE_ENABLE_DEMO_LOGIN=true`). */
const isDemoLoginEnabled = import.meta.env.DEV === true || import.meta.env.VITE_ENABLE_DEMO_LOGIN === "true";
const GOD_MODE_USERNAME = (import.meta.env.VITE_GODMODE_USERNAME || "master").trim().toLowerCase();

/** Demo passwords come only from env — never hard-coded — so production bundles stay clean. Set in `.env.local` for dev. */
const DEMO_USER_PASSWORD = String(import.meta.env.VITE_DEMO_USER_PASSWORD ?? "").trim();
const GODMODE_PASSWORD = String(import.meta.env.VITE_GODMODE_PASSWORD ?? "").trim();

const users: User[] = isDemoLoginEnabled
  ? [
      ...(GODMODE_PASSWORD
        ? [{ username: GOD_MODE_USERNAME, password: GODMODE_PASSWORD, role: "Master" as const, name: "System Setup" }]
        : []),
      ...(DEMO_USER_PASSWORD
        ? [
            { username: "admin", password: DEMO_USER_PASSWORD, role: "Admin" as const, name: "Audit Control" },
            { username: "manager", password: DEMO_USER_PASSWORD, role: "Manager" as const, name: "James Preston" },
            { username: "tom", password: DEMO_USER_PASSWORD, role: "Auditor" as const, name: "Tom Hughes" },
          ]
        : []),
    ]
  : [];

const DEFAULT_MANAGER_NAME = users.find((user) => user.role === "Manager")?.name || "Unassigned";
const DEFAULT_AUDITOR_NAME = users.find((user) => user.role === "Auditor")?.name || "Unassigned";
const DEFAULT_ESCALATION_NAME = users.find((user) => user.role === "Master")?.name || "System Setup";

const initialAudits: Audit[] = [];

const initialHistory: HistoryEntry[] = [];

const initialActions: ActionItem[] = [];
const initialSyncQueue: SyncQueueItem[] = [];
const initialSchedules: ScheduleItem[] = [];
const initialTemplates: AuditTemplate[] = [];
const initialNonConformances: NonConformanceRecord[] = [];
const initialIncidents: IncidentRecord[] = [];
const initialIncidentActions: IncidentCorrectiveAction[] = [];

/** Transitions only — hover uses shell-wide 15% contrasting overlay (.qms-app-shell / .qms-login-shell). */

/** Accent-filled fields (signal orange) — schedule editor; avoids washed-out OS styling on pale backgrounds in dark theme. */
const brandAccentFormField =
  "border border-[rgba(249,115,22,0.5)] bg-[var(--bert-signal-orange)] text-[var(--qms-navy-950)] shadow-[0_10px_26px_rgba(249,115,22,0.22)] outline-none transition focus:border-[var(--qms-navy-850)]";

/** Slate surface + accent outline for dropdowns and secondary inputs on dark panels (filters, assignees, file inputs). */
const brandDarkFormControl =
  "border border-[rgba(249,115,22,0.45)] bg-slate-950 text-slate-100 outline-none focus:border-[var(--bert-signal-orange)]";
const qmsDarkShellGradient =
  "bg-[radial-gradient(circle_at_top,var(--qms-shell-dark-radial),_transparent_35%),linear-gradient(180deg,var(--qms-shell-dark-start)_0%,var(--qms-shell-dark-mid)_45%,var(--qms-shell-dark-end)_100%)]";
const qmsLightShellGradient =
  "bg-[radial-gradient(circle_at_top,var(--qms-shell-light-radial),_transparent_35%),linear-gradient(180deg,var(--qms-shell-light-start)_0%,var(--qms-shell-light-mid)_45%,var(--qms-shell-light-end)_100%)]";

const appMotionStyles = `
  @keyframes qmsFadeSlideUp {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.985);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .qms-screen-stage {
    animation: qmsFadeSlideUp 220ms ease-out;
    padding-top: 0.75rem;
    padding-left: 0.85rem;
    padding-right: 0.85rem;
    padding-bottom: 1.5rem;
  }

  /* Compact fit pass: reduce chunky spacing while keeping readability. */
  .qms-screen-stage .space-y-4 > * + * {
    margin-top: 0.65rem;
  }

  .qms-screen-stage .space-y-3 > * + * {
    margin-top: 0.5rem;
  }

  .qms-screen-stage [class*="rounded-[1.75rem]"] {
    border-radius: 1.2rem !important;
  }

  .qms-screen-stage section[class*="rounded-[1.75rem]"] {
    padding: 0.82rem !important;
  }

  .qms-screen-stage section[class*="rounded-[1.6rem]"] {
    padding: 0.72rem !important;
  }

  /* Global aesthetic normalization (workflow-safe): cards, controls, and small actions. */
  .qms-app-shell[data-qms-theme="light"] .qms-screen-stage section {
    border-color: rgba(148, 163, 184, 0.28);
    box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
  }

  .qms-app-shell[data-qms-theme="dark"] .qms-screen-stage section {
    border-color: rgba(148, 163, 184, 0.2);
    box-shadow: 0 12px 30px rgba(2, 6, 23, 0.3);
  }

  .qms-screen-stage input,
  .qms-screen-stage select,
  .qms-screen-stage textarea {
    border-radius: 0.95rem;
  }

  .qms-app-shell[data-qms-theme="light"] .qms-screen-stage input,
  .qms-app-shell[data-qms-theme="light"] .qms-screen-stage select,
  .qms-app-shell[data-qms-theme="light"] .qms-screen-stage textarea {
    border-color: rgba(148, 163, 184, 0.35);
    background-color: rgba(255, 255, 255, 0.82);
  }

  .qms-app-shell[data-qms-theme="dark"] .qms-screen-stage input,
  .qms-app-shell[data-qms-theme="dark"] .qms-screen-stage select,
  .qms-app-shell[data-qms-theme="dark"] .qms-screen-stage textarea {
    border-color: rgba(148, 163, 184, 0.32);
    background-color: rgba(2, 6, 23, 0.72);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .qms-screen-stage button {
    border-radius: 0.9rem;
  }

  .qms-screen-stage .rounded-2xl {
    border-radius: 1rem;
  }

  .qms-screen-stage input,
  .qms-screen-stage select,
  .qms-screen-stage textarea,
  .qms-screen-stage button {
    min-height: 2.5rem;
  }

  .qms-screen-stage .h-14 {
    height: 3.15rem !important;
  }

  .qms-screen-stage .h-12 {
    height: 2.85rem !important;
  }

  .qms-screen-stage .h-11 {
    height: 2.65rem !important;
  }

  .qms-screen-stage .h-10 {
    height: 2.45rem !important;
  }

  .qms-screen-stage [class*="px-5"] {
    padding-left: 1.1rem !important;
    padding-right: 1.1rem !important;
  }

  .qms-screen-stage [class*="py-5"] {
    padding-top: 1.05rem !important;
    padding-bottom: 1.05rem !important;
  }

  .qms-app-shell[data-qms-theme="light"] .qms-screen-stage button {
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
  }

  .qms-app-shell[data-qms-theme="dark"] .qms-screen-stage button {
    box-shadow: 0 8px 20px rgba(2, 6, 23, 0.28);
  }

  /* Typography rhythm pass (aesthetic only): clearer hierarchy, tighter enterprise feel. */
  .qms-screen-stage h1 {
    font-size: clamp(1.55rem, 2.1vw, 1.95rem);
    line-height: 1.15;
    letter-spacing: -0.015em;
  }

  .qms-screen-stage h2 {
    font-size: clamp(1.25rem, 1.65vw, 1.55rem);
    line-height: 1.2;
    letter-spacing: -0.01em;
  }

  .qms-screen-stage h3 {
    font-size: clamp(1.06rem, 1.25vw, 1.24rem);
    line-height: 1.28;
    letter-spacing: -0.005em;
  }

  .qms-screen-stage p,
  .qms-screen-stage li {
    line-height: 1.5;
  }

  .qms-screen-stage p {
    font-size: clamp(0.88rem, 0.9vw, 0.96rem);
  }

  .qms-screen-stage label {
    font-size: 0.82rem;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .qms-screen-stage small,
  .qms-screen-stage .text-xs {
    letter-spacing: 0.025em;
  }

  .qms-app-shell[data-qms-theme="light"] .qms-screen-stage h1,
  .qms-app-shell[data-qms-theme="light"] .qms-screen-stage h2,
  .qms-app-shell[data-qms-theme="light"] .qms-screen-stage h3 {
    color: rgb(15 23 42);
  }

  .qms-app-shell[data-qms-theme="dark"] .qms-screen-stage h1,
  .qms-app-shell[data-qms-theme="dark"] .qms-screen-stage h2,
  .qms-app-shell[data-qms-theme="dark"] .qms-screen-stage h3 {
    color: rgb(241 245 249);
  }

  .qms-app-shell button:not(:disabled),
  .qms-login-shell button:not(:disabled) {
    transition:
      background-color 200ms ease-in-out,
      color 200ms ease-in-out,
      border-color 200ms ease-in-out,
      box-shadow 200ms ease-in-out,
      opacity 200ms ease-in-out;
  }

  /* 15% opposite-colour tint (readable: inset shadow sits beneath button content) */
  .qms-app-shell[data-qms-theme="light"] button:enabled:hover,
  .qms-login-shell[data-qms-theme="light"] button:enabled:hover {
    box-shadow: inset 0 0 0 9999px var(--qms-hover-overlay-light);
  }

  .qms-app-shell[data-qms-theme="dark"] button:enabled:hover,
  .qms-login-shell[data-qms-theme="dark"] button:enabled:hover {
    box-shadow: inset 0 0 0 9999px var(--qms-hover-overlay-dark);
  }

  /* Dark theme: slate rows must not hover to white (would clash with light body copy colours). */
  .qms-app-shell[data-qms-theme="dark"] .qms-screen-stage .hover\\:bg-white:hover {
    background-color: rgb(30 41 59) !important;
  }

  .qms-app-shell[data-qms-theme="dark"] .qms-screen-stage .hover\\:border-slate-300:hover {
    border-color: rgb(71 85 105) !important;
  }

  .qms-app-shell[data-qms-theme="light"] button:enabled:active,
  .qms-login-shell[data-qms-theme="light"] button:enabled:active {
    box-shadow: inset 0 0 0 9999px var(--qms-active-overlay-light);
  }

  .qms-app-shell[data-qms-theme="dark"] button:enabled:active,
  .qms-login-shell[data-qms-theme="dark"] button:enabled:active {
    box-shadow: inset 0 0 0 9999px var(--qms-active-overlay-dark);
  }

  .qms-app-shell button:disabled,
  .qms-login-shell button:disabled {
    cursor: not-allowed;
  }

  /* File-upload chips (label + rounded link CTAs mirror button hover) */
  .qms-app-shell label.inline-flex.cursor-pointer,
  .qms-login-shell label.inline-flex.cursor-pointer,
  .qms-app-shell a.inline-flex[class*="rounded"],
  .qms-login-shell a.inline-flex[class*="rounded"] {
    transition: box-shadow 200ms ease-in-out;
  }

  .qms-app-shell[data-qms-theme="light"] label.inline-flex.cursor-pointer:hover,
  .qms-login-shell[data-qms-theme="light"] label.inline-flex.cursor-pointer:hover {
    box-shadow: inset 0 0 0 9999px var(--qms-hover-overlay-light);
  }

  .qms-app-shell[data-qms-theme="dark"] label.inline-flex.cursor-pointer:hover,
  .qms-login-shell[data-qms-theme="dark"] label.inline-flex.cursor-pointer:hover {
    box-shadow: inset 0 0 0 9999px var(--qms-hover-overlay-dark);
  }

  .qms-app-shell[data-qms-theme="light"] a.inline-flex[class*="rounded"]:hover,
  .qms-login-shell[data-qms-theme="light"] a.inline-flex[class*="rounded"]:hover {
    box-shadow: inset 0 0 0 9999px var(--qms-hover-overlay-light);
  }

  .qms-app-shell[data-qms-theme="dark"] a.inline-flex[class*="rounded"]:hover,
  .qms-login-shell[data-qms-theme="dark"] a.inline-flex[class*="rounded"]:hover {
    box-shadow: inset 0 0 0 9999px var(--qms-hover-overlay-dark);
  }

  .qms-tablet-stage {
    display: flex;
    min-height: 100%;
    align-items: center;
    justify-content: center;
  }

  /* Sign-in: landscape frame so left/right columns fit without scrolling. */
  .qms-tablet-device.qms-tablet-device--signin {
    width: min(96vw, 52rem);
    aspect-ratio: 16 / 10;
    max-height: min(90dvh, 34rem);
    overflow: hidden;
  }

  @media (max-width: 639px) {
    .qms-tablet-device.qms-tablet-device--signin {
      width: min(92vw, 26rem);
      aspect-ratio: 10 / 13;
      max-height: min(86dvh, 38rem);
    }
  }

  .qms-tablet-device {
    position: relative;
    width: min(92vw, 41rem);
    aspect-ratio: 10 / 16;
    padding: 0.9rem;
    overflow: hidden;
    border-radius: 2.8rem;
    background:
      linear-gradient(145deg, var(--qms-navy-950), var(--qms-navy-900)),
      linear-gradient(180deg, rgba(0,0,0,0.4), rgba(0,0,0,0.2));
    box-shadow:
      0 30px 90px rgba(2, 6, 23, 0.45),
      inset 0 1px 0 rgba(148,163,184,0.14),
      inset 0 -2px 0 rgba(0,0,0,0.45);
  }

  .qms-tablet-device::before {
    content: "";
    position: absolute;
    top: 0.5rem;
    left: 50%;
    z-index: 2;
    width: 5.2rem;
    height: 0.42rem;
    transform: translateX(-50%);
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.18);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.45);
  }

  .qms-tablet-device::after {
    content: "";
    position: absolute;
    top: 0.56rem;
    left: calc(50% + 2rem);
    z-index: 3;
    width: 0.34rem;
    height: 0.34rem;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.38);
  }

  .qms-tablet-device .qms-app-shell,
  .qms-tablet-device .qms-login-shell {
    width: 100%;
    max-width: none;
    min-height: 100%;
    height: 100%;
  }

  .qms-force-landscape .qms-login-shell {
    min-height: 100%;
  }

  .qms-force-landscape .qms-tablet-device {
    width: min(94vw, 74rem);
    aspect-ratio: 16 / 10;
  }

  .qms-force-landscape .qms-app-shell {
    max-width: none;
  }

  .qms-force-landscape .qms-app-header-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem);
    gap: 1rem;
    align-items: start;
  }

  .qms-force-landscape .qms-app-session-bar {
    margin-top: 0;
    min-height: 100%;
  }

  .qms-force-landscape .qms-screen-stage {
    padding-left: 1.25rem;
    padding-right: 1.25rem;
    padding-bottom: 2rem;
  }

  .qms-force-landscape .qms-bottom-nav {
    max-width: 78rem;
    padding-left: 1rem;
    padding-right: 1rem;
  }

  .qms-force-landscape .qms-bottom-nav-grid {
    gap: 0.75rem;
  }

  .qms-force-landscape .qms-nav-button {
    height: 3.4rem;
    font-size: 0.72rem;
  }

  .qms-force-landscape .qms-nav-label {
    max-width: 7rem;
  }

  .qms-force-landscape .qms-login-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
    gap: 1.5rem;
    align-items: start;
  }

  .qms-force-landscape .qms-login-access {
    margin-top: 0;
  }

  @media (orientation: landscape) and (min-width: 900px) {
    .qms-tablet-device {
      width: min(94vw, 74rem);
      aspect-ratio: 16 / 10;
    }

    .qms-login-shell {
      min-height: 100%;
    }

    .qms-app-shell {
      max-width: none;
    }

    .qms-app-header-main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem);
      gap: 1rem;
      align-items: start;
    }

    .qms-app-session-bar {
      margin-top: 0;
      min-height: 100%;
    }

    .qms-screen-stage {
      padding-left: 1.25rem;
      padding-right: 1.25rem;
      padding-bottom: 2rem;
    }

    .qms-bottom-nav {
      max-width: 78rem;
      padding-left: 1rem;
      padding-right: 1rem;
    }

    .qms-bottom-nav-grid {
      gap: 0.75rem;
    }

    .qms-nav-button {
      height: 3.4rem;
      font-size: 0.72rem;
    }

    .qms-nav-label {
      max-width: 7rem;
    }
  }

  @media (orientation: landscape) and (min-width: 1100px) {
    .qms-login-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
      gap: 1.5rem;
      align-items: start;
    }

    .qms-login-access {
      margin-top: 0;
    }
  }
`;

/** Parse JSON from `fetch` responses — avoids `response.json()` throwing on empty/HTML proxy errors. */
async function parseJsonApiResponse<T = Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    const hint =
      import.meta.env.DEV === true
        ? "Start the API: from the project root run `npm run server` (default port 8787) while using `npm run dev`."
        : "The setup server did not return data.";
    throw new Error(`No response body from server (${response.status}). ${hint}`);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const snippet = trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
    throw new Error(`Invalid response (${response.status}): ${snippet}`);
  }
}

const userStorageKey = storageKeys.currentUser;
/** When set, Master session is limited to company onboarding (no other nav or tools). Cleared on staff sign-in or logout. */
const masterCompanySetupSessionKey = storageKeys.masterCompanySetupSession;
const offlineQueueStorageKey = storageKeys.offlineSubmissions;
const themeStorageKey = storageKeys.theme;
const previewOrientationStorageKey = storageKeys.previewOrientation;
const desktopSidebarCollapsedStorageKey = storageKeys.desktopSidebarCollapsed;
const dashboardPreferencesStorageKey = storageKeys.dashboardPreferences;
const dashboardSectionOrderStorageKey = storageKeys.dashboardSectionOrder;
const folderLinksStorageKey = storageKeys.folderLinks;
const workspaceStateStorageKey = storageKeys.workspaceState;
const userProfilePhotosStorageKey = storageKeys.userProfilePhotos;
const userNicknamesStorageKey = storageKeys.userNicknames;
const scheduleTimeZone = "Europe/London";

function AppIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const shared = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };

  switch (name) {
    case "dashboard":
      return (
        <svg {...shared}>
          <rect x="3" y="3" width="8" height="8" rx="2" />
          <rect x="13" y="3" width="8" height="5" rx="2" />
          <rect x="13" y="10" width="8" height="11" rx="2" />
          <rect x="3" y="13" width="8" height="8" rx="2" />
        </svg>
      );
    case "grid":
      return (
        <svg {...shared}>
          <rect x="3" y="3" width="6.5" height="6.5" rx="1.25" />
          <rect x="14.5" y="3" width="6.5" height="6.5" rx="1.25" />
          <rect x="3" y="14.5" width="6.5" height="6.5" rx="1.25" />
          <rect x="14.5" y="14.5" width="6.5" height="6.5" rx="1.25" />
        </svg>
      );
    case "clipboard":
      return (
        <svg {...shared}>
          <rect x="6" y="4" width="12" height="16" rx="2" />
          <path d="M9 4.5h6a1.5 1.5 0 0 0-1.5-1.5h-3A1.5 1.5 0 0 0 9 4.5Z" />
          <path d="M9 10h6" />
          <path d="M9 14h6" />
        </svg>
      );
    case "checklist":
      return (
        <svg {...shared}>
          <path d="M9 7h10" />
          <path d="M9 12h10" />
          <path d="M9 17h10" />
          <path d="m4 7 1.5 1.5L7.5 6" />
          <path d="m4 12 1.5 1.5L7.5 11" />
          <path d="m4 17 1.5 1.5L7.5 16" />
        </svg>
      );
    case "warningTriangle":
      return (
        <svg {...shared}>
          <path d="M12 4.75 20.25 19.25H3.75L12 4.75z" />
          <path d="M12 9.5v4.5" />
          <circle cx="12" cy="16.35" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "chart":
      return (
        <svg {...shared}>
          <path d="M4 19h16" />
          <path d="M7 16V10" />
          <path d="M12 16V6" />
          <path d="M17 16v-4" />
        </svg>
      );
    case "sync":
      return (
        <svg {...shared}>
          <path d="M3 12a8 8 0 0 1 13.66-5.66L19 8" />
          <path d="M21 12a8 8 0 0 1-13.66 5.66L5 16" />
          <path d="M19 3v5h-5" />
          <path d="M5 21v-5h5" />
        </svg>
      );
    case "shield":
      return (
        <svg {...shared}>
          <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3Z" />
          <path d="m9.5 12 1.8 1.8 3.2-3.6" />
        </svg>
      );
    case "user":
      return (
        <svg {...shared}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 19a7 7 0 0 1 14 0" />
        </svg>
      );
    case "spark":
      return (
        <svg {...shared}>
          <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z" />
        </svg>
      );
    case "clock":
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 2.5" />
        </svg>
      );
    case "camera":
      return (
        <svg {...shared}>
          <path d="M4.5 8.5h3l1.5-2h6l1.5 2h3v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-9Z" />
          <circle cx="12" cy="13" r="3.2" />
        </svg>
      );
    case "check":
      return (
        <svg {...shared}>
          <path d="m5 12 4 4 10-10" />
        </svg>
      );
    case "note":
      return (
        <svg {...shared}>
          <path d="M7 4h10a2 2 0 0 1 2 2v12l-4-3H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
          <path d="M9 8h6" />
          <path d="M9 11h6" />
        </svg>
      );
    case "logOut":
      return (
        <svg {...shared}>
          <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      );
    default:
      return null;
  }
}

function getUkTimeZoneLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: scheduleTimeZone,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "UK time";
}

function formatScheduledTime(time: string) {
  return `${time} ${getUkTimeZoneLabel()}`;
}

function getWorkspaceInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function buildAuditAccessOverrideKey(email: string, auditId: string) {
  return `${email}::${auditId}`;
}

function buildOnboardingFormViewUrl(formId: string) {
  const clean = formId.trim();
  if (!clean) return "";
  if (clean.startsWith("1FAIpQL")) {
    return `https://docs.google.com/forms/d/e/${clean}/viewform`;
  }
  return `https://docs.google.com/forms/d/${clean}/viewform`;
}

const reportTemplateDefaults: Record<ReportTemplateType, ReportSectionKey[]> = {
  "Executive summary": ["compliance", "auditCompletion", "correctiveActions", "overdueAudits", "auditHistory"],
  "Overdue audit pack": ["overdueAudits", "overdueActions", "correctiveActions", "scheduleCompliance", "auditHistory"],
  "Corrective action pack": ["correctiveActions", "overdueActions", "verificationHistory", "evidence", "auditHistory"],
  "Evidence pack": ["evidence", "criticalFindings", "auditHistory", "templates"],
  "Full report": ["compliance", "auditCompletion", "overdueAudits", "correctiveActions", "overdueActions", "criticalFindings", "repeatFailures", "verificationHistory", "scheduleCompliance", "evidence", "syncExceptions", "auditHistory", "templates", "offlineQueue"],
};

function getDueLabel(dueHours: number) {
  if (dueHours < 0) {
    return "Overdue";
  }
  if (dueHours < amberThresholdHours) {
    return "Due soon";
  }
  if (dueHours < 24) {
    return "Due today";
  }
  return "Due later";
}

function buildDefaultQuestions(auditName: string): AuditQuestion[] {
  return [
    {
      id: `${auditName}-q1`,
      text: "Work area is safe, clean, and prepared for the scheduled check.",
      riskLevel: "Medium",
      riskCategory: "Health & Safety",
      autoActionRequired: true,
      requiresPhotoEvidence: false,
      requiresManagerReview: false,
    },
    {
      id: `${auditName}-q2`,
      text: "Required controls, signage, and access arrangements are in place.",
      riskLevel: "High",
      riskCategory: "Operational",
      autoActionRequired: true,
      requiresPhotoEvidence: true,
      requiresManagerReview: true,
    },
    {
      id: `${auditName}-q3`,
      text: "Equipment, materials, and records meet the expected audit standard.",
      riskLevel: "Medium",
      riskCategory: "Quality",
      autoActionRequired: true,
      requiresPhotoEvidence: false,
      requiresManagerReview: false,
    },
    {
      id: `${auditName}-q4`,
      text: "Any issues have been identified, recorded, and communicated correctly.",
      riskLevel: "Critical",
      riskCategory: "Health & Safety",
      autoActionRequired: true,
      requiresPhotoEvidence: true,
      requiresManagerReview: true,
    },
  ];
}

/** Local-only precast HSE demo payloads for QA/review — never merges into Google-connected company sheets. */
function buildDemoPrecastWorkspace(): {
  audits: Audit[];
  actions: ActionItem[];
  drafts: Record<string, AuditDraft>;
  syncQueue: SyncQueueItem[];
  templates: AuditTemplate[];
  companySheetSync: CompanySheetSyncStatus;
} {
  const demoAudits: Audit[] = [
    {
      id: "audit-demo-yard-safety",
      name: "Daily Yard Safety Check",
      category: "Daily safety",
      siteArea: "Main Yard",
      dueLabel: "Overdue",
      dueHours: -2,
      priority: "High",
      owner: "Tom Blake",
      templateVersion: "Built in app",
      status: "red",
      lastCompletedAt: "Today 06:30",
      questions: buildDefaultQuestions("Daily Yard Safety Check"),
    },
    {
      id: "audit-demo-fire-bay2",
      name: "Bay 2 Fire Safety Inspection",
      category: "Fire safety",
      siteArea: "Bay 2",
      dueLabel: "Due soon",
      dueHours: 1,
      priority: "High",
      owner: "Sarah Evans",
      templateVersion: "Built in app",
      status: "amber",
      lastCompletedAt: "Yesterday 15:10",
      questions: buildDefaultQuestions("Bay 2 Fire Safety Inspection"),
    },
    {
      id: "audit-demo-ppe-weekly",
      name: "Weekly PPE Compliance Audit",
      category: "PPE compliance",
      siteArea: "Casting Hall",
      dueLabel: "Due later",
      dueHours: 48,
      priority: "Medium",
      owner: "Tom Blake",
      templateVersion: "Built in app",
      status: "green",
      lastCompletedAt: "Monday 08:45",
      questions: buildDefaultQuestions("Weekly PPE Compliance Audit"),
    },
    {
      id: "audit-demo-lifting",
      name: "Lifting Equipment Check",
      category: "Plant safety",
      siteArea: "Lifting Bay",
      dueLabel: "Due soon",
      dueHours: 2,
      priority: "High",
      owner: "Sarah Evans",
      templateVersion: "Built in app",
      status: "amber",
      lastCompletedAt: "Yesterday 10:20",
      questions: buildDefaultQuestions("Lifting Equipment Check"),
    },
    {
      id: "audit-demo-housekeeping",
      name: "Housekeeping Walkaround",
      category: "Housekeeping",
      siteArea: "Factory Floor",
      dueLabel: "Due later",
      dueHours: 36,
      priority: "Medium",
      owner: "Tom Blake",
      templateVersion: "Built in app",
      status: "green",
      lastCompletedAt: "Today 07:10",
      questions: buildDefaultQuestions("Housekeeping Walkaround"),
    },
  ];

  const demoActions: ActionItem[] = [
    {
      id: "action-demo-extinguisher",
      companyId: "demo-company",
      auditId: "audit-demo-fire-bay2",
      auditName: "Bay 2 Fire Safety Inspection",
      questionId: "fire-extinguisher",
      questionText: "Replace damaged fire extinguisher — Bay 2",
      sourceAnswer: "fail",
      severity: "High",
      owner: "Tom Blake",
      assignedToUserId: "tom",
      assignedToName: "Tom Blake",
      createdByUserId: "manager",
      createdAt: "Today 08:10",
      dueDate: "Today",
      closedAt: "",
      verifiedByUserId: "",
      verificationNotes: "",
      evidenceLinks: [],
      localEvidenceRefs: [],
      comments: "Casing dented, pressure gauge in red zone.",
      recurrenceFlag: false,
      rootCause: "Impact damage from FLT movement",
      correctiveAction: "Replace extinguisher and complete monthly inspection tag",
      preventiveAction: "Install protective hoop at forklift pinch points",
      dueLabel: "Due today",
      dueHours: 10,
      status: "Open",
      evidenceCount: 0,
      noteIncluded: true,
      riskCategory: "Health & Safety",
    },
    {
      id: "action-demo-exit",
      companyId: "demo-company",
      auditId: "audit-demo-yard-safety",
      auditName: "Daily Yard Safety Check",
      questionId: "blocked-exit",
      questionText: "Clear blocked emergency exit — Casting Hall",
      sourceAnswer: "fail",
      severity: "Critical",
      owner: "Sarah Evans",
      assignedToUserId: "sarah",
      assignedToName: "Sarah Evans",
      createdByUserId: "manager",
      createdAt: "Yesterday 16:00",
      dueDate: "Overdue",
      closedAt: "",
      verifiedByUserId: "",
      verificationNotes: "",
      evidenceLinks: [],
      localEvidenceRefs: [],
      comments: "Pallet stack narrowing exit width below required clearance.",
      recurrenceFlag: true,
      rootCause: "Poor material staging",
      correctiveAction: "Clear egress and mark yellow no-storage box",
      preventiveAction: "Supervisor aisle walk each shift change",
      dueLabel: "Overdue",
      dueHours: -30,
      status: "Open",
      evidenceCount: 0,
      noteIncluded: true,
      riskCategory: "Health & Safety",
    },
    {
      id: "action-demo-guardrail",
      companyId: "demo-company",
      auditId: "audit-demo-lifting",
      auditName: "Lifting Equipment Check",
      questionId: "guardrail-evidence",
      questionText: "Upload evidence for repaired guard rail",
      sourceAnswer: "nc",
      severity: "Medium",
      owner: "Tom Blake",
      assignedToUserId: "tom",
      assignedToName: "Tom Blake",
      createdByUserId: "manager",
      createdAt: "Today 07:00",
      dueDate: "Due tomorrow",
      closedAt: "",
      verifiedByUserId: "",
      verificationNotes: "",
      evidenceLinks: [],
      localEvidenceRefs: [],
      comments: "Welded repair signed off locally; awaiting photo upload and manager verification.",
      recurrenceFlag: false,
      rootCause: "Incomplete close-out packet",
      correctiveAction: "Upload date-stamped guard rail photos",
      preventiveAction: "Require evidence checklist before marking complete",
      dueLabel: "Due soon",
      dueHours: 18,
      status: "Awaiting Verification",
      evidenceCount: 0,
      noteIncluded: true,
      riskCategory: "Operational",
    },
    {
      id: "action-demo-ppe-review",
      companyId: "demo-company",
      auditId: "audit-demo-ppe-weekly",
      auditName: "Weekly PPE Compliance Audit",
      questionId: "ppe-review",
      questionText: "Review repeated PPE non-conformance",
      sourceAnswer: "fail",
      severity: "High",
      owner: "James Cole",
      assignedToUserId: "manager",
      assignedToName: "James Cole",
      createdByUserId: "admin",
      createdAt: "Today 09:20",
      dueDate: "Due tomorrow",
      closedAt: "",
      verifiedByUserId: "",
      verificationNotes: "",
      evidenceLinks: [],
      localEvidenceRefs: [],
      comments: "Repeat observations in bays 1 and 3 near steel-fixing pours.",
      recurrenceFlag: true,
      rootCause: "Variable supervisor enforcement near pour windows",
      correctiveAction: "Manager-led toolbox talk plus signed commitment",
      preventiveAction: "Random PPE checks at pouring deck access",
      dueLabel: "Due soon",
      dueHours: 18,
      status: "In Progress",
      evidenceCount: 1,
      noteIncluded: true,
      riskCategory: "Health & Safety",
    },
    ...Array.from({ length: 4 }).map((_, index) => ({
      id: `action-demo-ppe-repeat-${index + 1}`,
      companyId: "demo-company",
      auditId: "audit-demo-ppe-weekly",
      auditName: "Weekly PPE Compliance Audit",
      questionId: `ppe-repeat-${index + 1}`,
      questionText: "PPE not worn correctly",
      sourceAnswer: "fail",
      severity: "High" as RiskLevel,
      owner: index % 2 === 0 ? "Tom Blake" : "Sarah Evans",
      assignedToUserId: index % 2 === 0 ? "tom" : "sarah",
      assignedToName: index % 2 === 0 ? "Tom Blake" : "Sarah Evans",
      createdByUserId: "manager",
      createdAt: "This week",
      dueDate: "Due this week",
      closedAt: "",
      verifiedByUserId: "",
      verificationNotes: "",
      evidenceLinks: [],
      localEvidenceRefs: [],
      comments: "Hi-vis or safety glasses incomplete during yard pour.",
      recurrenceFlag: true,
      rootCause: "Comfort / habit skipping PPE near familiar tasks",
      correctiveAction: "On-the-spot coaching and documented warning",
      preventiveAction: "PPE ambassadors on each casting line",
      dueLabel: "Due later",
      dueHours: 20 + index,
      status: "Open" as ActionStatus,
      evidenceCount: 0,
      noteIncluded: true,
      riskCategory: "Health & Safety" as RiskCategory,
    })),
    {
      id: "action-demo-fire-obstructed-1",
      companyId: "demo-company",
      auditId: "audit-demo-fire-bay2",
      auditName: "Bay 2 Fire Safety Inspection",
      questionId: "fire-obstructed-1",
      questionText: "Fire exits obstructed",
      sourceAnswer: "fail",
      severity: "Critical",
      owner: "Sarah Evans",
      assignedToUserId: "sarah",
      assignedToName: "Sarah Evans",
      createdByUserId: "manager",
      createdAt: "This week",
      dueDate: "Overdue",
      closedAt: "",
      verifiedByUserId: "",
      verificationNotes: "",
      evidenceLinks: [],
      localEvidenceRefs: [],
      comments: "Stacked shuttering pallets narrow exit effective width.",
      recurrenceFlag: true,
      rootCause: "Poor layout control",
      correctiveAction: "Clear marking and barrier until resolved",
      preventiveAction: "End-of-shift housekeeping audit",
      dueLabel: "Overdue",
      dueHours: -10,
      status: "Open",
      evidenceCount: 0,
      noteIncluded: true,
      riskCategory: "Health & Safety",
    },
    {
      id: "action-demo-fire-obstructed-2",
      companyId: "demo-company",
      auditId: "audit-demo-yard-safety",
      auditName: "Daily Yard Safety Check",
      questionId: "fire-obstructed-2",
      questionText: "Fire exits obstructed",
      sourceAnswer: "fail",
      severity: "High",
      owner: "Tom Blake",
      assignedToUserId: "tom",
      assignedToName: "Tom Blake",
      createdByUserId: "manager",
      createdAt: "This week",
      dueDate: "Due today",
      closedAt: "",
      verifiedByUserId: "",
      verificationNotes: "",
      evidenceLinks: [],
      localEvidenceRefs: [],
      comments: "Temporary materials creeping into egress during bay strip-out.",
      recurrenceFlag: true,
      rootCause: "Temporary works storage creep",
      correctiveAction: "Remove obstruction and widen marked lane",
      preventiveAction: "Daily supervisor route photo",
      dueLabel: "Due today",
      dueHours: 5,
      status: "In Progress",
      evidenceCount: 1,
      noteIncluded: true,
      riskCategory: "Operational",
    },
    ...Array.from({ length: 3 }).map((_, index) => ({
      id: `action-demo-housekeeping-repeat-${index + 1}`,
      companyId: "demo-company",
      auditId: "audit-demo-housekeeping",
      auditName: "Housekeeping Walkaround",
      questionId: `housekeeping-repeat-${index + 1}`,
      questionText: "Missing housekeeping sign-off",
      sourceAnswer: "nc",
      severity: "Medium" as RiskLevel,
      owner: index % 2 === 0 ? "Tom Blake" : "Sarah Evans",
      assignedToUserId: index % 2 === 0 ? "tom" : "sarah",
      assignedToName: index % 2 === 0 ? "Tom Blake" : "Sarah Evans",
      createdByUserId: "manager",
      createdAt: "This week",
      dueDate: "Due this week",
      closedAt: "",
      verifiedByUserId: "",
      verificationNotes: "",
      evidenceLinks: [],
      localEvidenceRefs: [],
      comments: "Shift close-out checklist incomplete on casting record.",
      recurrenceFlag: true,
      rootCause: "Handover overlap between crews",
      correctiveAction: "Backfill supervisory sign-off with time stamp",
      preventiveAction: "Digital lock on shift close before FLT entry",
      dueLabel: "Due later",
      dueHours: 30 + index,
      status: "Open" as ActionStatus,
      evidenceCount: 0,
      noteIncluded: true,
      riskCategory: "Operational" as RiskCategory,
    })),
  ];

  const demoDrafts: Record<string, AuditDraft> = {
    "audit-demo-yard-safety": {
      responses: {
        "Daily Yard Safety Check-q1": "pass",
        "Daily Yard Safety Check-q2": "fail",
      },
      notes: {
        "Daily Yard Safety Check-q2": "Forklift route crossing without clear barrier — barrier tape displaced overnight.",
      },
      evidence: {},
      updatedAt: "Today 10:12 (45% complete)",
    },
  };

  const demoSyncQueue: SyncQueueItem[] = [
    {
      id: "sync-demo-1",
      itemType: "auditSubmission",
      localId: "audit-demo-yard-local-copy",
      status: "Pending Sync",
      createdAt: "Today 10:15",
      updatedAt: "Today 10:15",
      retryCount: 0,
      lastError: "",
      payload: { auditName: "Daily Yard Safety Check (field draft)" },
    },
    {
      id: "sync-demo-2",
      itemType: "actionUpdate",
      localId: "action-demo-ppe-review",
      status: "Pending Sync",
      createdAt: "Today 10:18",
      updatedAt: "Today 10:18",
      retryCount: 0,
      lastError: "",
      payload: {},
    },
    {
      id: "sync-demo-3",
      itemType: "evidenceUpload",
      localId: "action-demo-guardrail-evidence-pack",
      status: "Failed",
      createdAt: "Today 10:20",
      updatedAt: "Today 10:21",
      attemptedAt: "Today 10:21",
      retryCount: 1,
      lastError: "Evidence upload failed: network timeout",
      payload: {},
    },
  ];

  const demoTemplates: AuditTemplate[] = demoAudits.map((audit, index) => ({
    id: `template-demo-${index + 1}`,
    name: audit.name,
    active: true,
    questions: audit.questions,
    source: "Built in app",
  }));

  const companySheetSync: CompanySheetSyncStatus = {
    sheetId: "demo-master-sheet",
    sheetName: `${companyName} Master Sheet`,
    tabs: ["Onboarding", "Users", "Schedule", "Actions", "Notes", "Config"],
    usersCount: 5,
    schedulesCount: 4,
    onboardingCount: 3,
    actionsCount: demoActions.length,
    notesCount: 6,
    findingsCount: 9,
    evidenceCount: 4,
    reportsCount: 2,
    configCount: 1,
    lastSyncedAt: "12 minutes ago",
  };

  return {
    audits: demoAudits,
    actions: demoActions,
    drafts: demoDrafts,
    syncQueue: demoSyncQueue,
    templates: demoTemplates,
    companySheetSync,
  };
}

function riskScore(level: RiskLevel = "Low") {
  if (level === "Critical") return 4;
  if (level === "High") return 3;
  if (level === "Medium") return 2;
  return 1;
}

function maxRiskLevel(levels: RiskLevel[]) {
  if (levels.includes("Critical")) return "Critical";
  if (levels.includes("High")) return "High";
  if (levels.includes("Medium")) return "Medium";
  return "Low";
}

function parsePeopleList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSiteName(value: string | null | undefined) {
  return String(value || "").trim();
}

function createSiteId(name: string) {
  const normalized = normalizeSiteName(name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return normalized || `site-${Date.now()}`;
}

function resolveUserSiteAssignmentKey(user: User, invitedUsers: UserInvite[]): string {
  const invite = invitedUsers.find(
    (inv) =>
      normalizeIdentity(inv.email.split("@")[0]) === normalizeIdentity(user.username) ||
      normalizeIdentity(inv.email) === normalizeIdentity(user.username),
  );
  if (invite) return normalizeIdentity(invite.email);
  if (user.name.includes("@")) return normalizeIdentity(user.name);
  return normalizeIdentity(`${user.username}@usebert.co.uk`);
}

function getUserAssignedSiteIds(
  role: Role,
  user: User | null,
  invitedUsers: UserInvite[],
  userSiteAssignments: UserSiteAssignments,
): Set<string> | null {
  if (!user) return null;
  if (role === "Master" || role === "Admin") return null;
  const key = resolveUserSiteAssignmentKey(user, invitedUsers);
  const ids = userSiteAssignments[key];
  if (!ids || ids.length === 0) return null;
  return new Set(ids);
}

function filterByAssignedSites<T extends { siteArea?: string }>(
  items: T[],
  allowedSiteIds: Set<string> | null,
  sites: Site[],
): T[] {
  if (!allowedSiteIds) return items;
  const allowedNames = new Set(
    sites.filter((s) => allowedSiteIds.has(s.id) && s.active).map((s) => normalizeIdentity(s.name)),
  );
  if (allowedNames.size === 0) return [];
  return items.filter((item) => {
    const area = normalizeIdentity(item.siteArea || "");
    return area && allowedNames.has(area);
  });
}

function filterNonConformancesByAssignedSites(
  records: NonConformanceRecord[],
  allowedSiteIds: Set<string> | null,
  sites: Site[],
): NonConformanceRecord[] {
  if (!allowedSiteIds) return records;
  const allowedNames = new Set(
    sites.filter((s) => allowedSiteIds.has(s.id) && s.active).map((s) => normalizeIdentity(s.name)),
  );
  if (allowedNames.size === 0) return [];
  return records.filter((r) => allowedNames.has(normalizeIdentity(r.site)));
}

function deriveSitesFromWorkspace(audits: Audit[], schedules: ScheduleItem[], managedSchedules: ManagedSchedule[]) {
  const names = new Set<string>();
  audits.forEach((audit) => {
    const site = normalizeSiteName(audit.siteArea);
    if (site) names.add(site);
  });
  schedules.forEach((schedule) => {
    const site = normalizeSiteName(schedule.siteArea);
    if (site) names.add(site);
  });
  void managedSchedules;
  if (names.size === 0) {
    names.add("Main site");
  }
  return Array.from(names).map((name) => ({
    id: createSiteId(name),
    name,
    code: name.slice(0, 3).toUpperCase(),
    active: true,
  }));
}

function safeLower(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function normalizeIdentity(value: string | null | undefined) {
  const normalized = safeLower(value);
  return normalized.replace(/\s+/g, " ").trim();
}

function buildIdentityTokens(user: CompanyReportUser) {
  const tokens = new Set<string>();
  [user.name, user.email, user.username, user.email.split("@")[0]].forEach((value) => {
    const normalized = normalizeIdentity(value);
    if (normalized) {
      tokens.add(normalized);
    }
  });
  return tokens;
}

function matchesIdentity(tokens: Set<string>, value: string | null | undefined) {
  const normalized = normalizeIdentity(value);
  return normalized ? tokens.has(normalized) : false;
}

function normalizeFolderName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.toLowerCase().startsWith("qms - ") ? trimmed : `QMS - ${trimmed}`;
}

function buildDefaultRoleNavVisibilityMatrix(): RoleNavVisibilityMatrix {
  const roles: Role[] = ["Master", "Admin", "Manager", "Auditor"];
  return roles.reduce((matrix, role) => {
    const visibility = navItems.reduce(
      (entry, item) => ({ ...entry, [item.id]: canRoleAccessNavItem(role, item.id) }),
      {} as Record<NavItemId, boolean>,
    );
    return { ...matrix, [role]: visibility };
  }, {} as RoleNavVisibilityMatrix);
}

function buildDefaultRoleSiteSelectorVisibility(): RoleSiteSelectorVisibility {
  return {
    Master: true,
    Admin: true,
    Manager: true,
    Auditor: true,
  };
}

function normalizeScheduleFrequency(value: string): ScheduleFrequency {
  const normalized = value.trim().toLowerCase();
  if (normalized === "daily") return "Daily";
  if (normalized === "bi-weekly" || normalized === "biweekly" || normalized === "bi weekly") return "Bi-Weekly";
  if (normalized === "monthly" || normalized === "bi-monthly" || normalized === "3 monthly" || normalized === "6 monthly" || normalized === "12 monthly") {
    return "Monthly";
  }
  return "Weekly";
}

function extractByKeys(record: Record<string, string>, candidates: string[]) {
  const entries = Object.entries(record || {});
  for (const [key, value] of entries) {
    const normalizedKey = key.trim().toLowerCase();
    if (candidates.some((candidate) => normalizedKey.includes(candidate)) && value) {
      return value.trim();
    }
  }
  return "";
}

function parseRole(value: string): Role | null {
  const lowered = value.trim().toLowerCase();
  if (lowered === "master" || lowered === "god mode") {
    return "Master";
  }
  if (lowered === "admin") {
    return "Admin";
  }
  if (lowered === "manager") {
    return "Manager";
  }
  if (lowered === "auditor") {
    return "Auditor";
  }
  return null;
}

function parseCompanySheetUsers(records: Record<string, string>[]) {
  return records
    .map((record, index) => {
      const role = parseRole(extractByKeys(record, ["role"]));
      const email = extractByKeys(record, ["email"]);
      if (!role || !email) {
        return null;
      }

      return {
        id: `sheet-user-${index + 1}`,
        email,
        role,
        invitedBy: extractByKeys(record, ["owner", "created by", "invited by"]) || "Company sheet",
        sentAt: extractByKeys(record, ["created", "submitted", "updated"]) || "Imported",
        status: "Invite created" as const,
      };
    })
    .filter(Boolean) as UserInvite[];
}

function parseCompanySheetSchedules(records: Record<string, string>[], companyFolderId: string) {
  return records
    .map((record, index) => {
      const auditName = extractByKeys(record, ["audit", "template", "name"]);
      if (!auditName) {
        return null;
      }

      return {
        id: `sheet-schedule-${companyFolderId}-${index + 1}`,
        companyFolderId,
        auditId: `sheet-audit-${companyFolderId}-${index + 1}`,
        auditName,
        siteArea: extractByKeys(record, ["area", "site"]) || "Main site",
        owner: extractByKeys(record, ["owner", "assignee"]) || "Unassigned",
        scope:
          extractByKeys(record, ["scope"]).toLowerCase().includes("personal")
            ? ("Personal schedule" as ScheduleScope)
            : ("Company schedule" as ScheduleScope),
        personalAssignee: extractByKeys(record, ["personal assignee", "assignee"]),
        frequency: normalizeScheduleFrequency(extractByKeys(record, ["frequency"])),
        sendTime: extractByKeys(record, ["send time", "time"]) || "08:00",
        recipients: parsePeopleList(extractByKeys(record, ["recipient"])),
        overdueAlertRecipients: parsePeopleList(extractByKeys(record, ["overdue", "alert"])),
        reportTo: extractByKeys(record, ["report to", "manager", "reports to"]),
        overdueAlertTiming:
          (extractByKeys(record, ["overdue timing", "overdue alert timing"]) as OverdueAlertTiming) || "At due time",
        completionCheckTiming:
          (extractByKeys(record, ["completion check", "completion timing"]) as CompletionCheckTiming) || "At due time",
        nextDueHours: Number(extractByKeys(record, ["due hours", "hours"])) || 24,
        priority: (extractByKeys(record, ["priority"]) as Priority) || "Medium",
      };
    })
    .filter(Boolean) as ScheduleItem[];
}

function parseManagedSchedules(records: Record<string, string>[], companyFolderId: string) {
  const grouped = new Map<string, ManagedSchedule>();

  records.forEach((record, index) => {
    const rowCompanyFolderId =
      extractByKeys(record, ["company folder id", "company folder", "folder id"]) || companyFolderId;
    if (rowCompanyFolderId !== companyFolderId) {
      return;
    }

    const scheduleId = extractByKeys(record, ["schedule id"]) || `schedule-row-${index + 1}`;
    const existing = grouped.get(scheduleId);
    const auditId = extractByKeys(record, ["audit id"]) || `audit-row-${index + 1}`;
    const auditName = extractByKeys(record, ["audit name", "audit", "template"]) || "Unnamed audit";

    const audit: ManagedScheduleAudit = {
      id: `${scheduleId}-${auditId}`,
      auditId,
      auditName,
      days: extractByKeys(record, ["days"])
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean) as ScheduleDay[],
      frequency: normalizeScheduleFrequency(extractByKeys(record, ["frequency"])),
      liveTime: extractByKeys(record, ["live time", "send time", "time"]) || "08:00",
      completionHours: Number(extractByKeys(record, ["completion hours", "due hours", "hours"])) || 24,
    };

    if (existing) {
      existing.audits.push(audit);
      return;
    }

    grouped.set(scheduleId, {
      id: scheduleId,
      rootId: extractByKeys(record, ["root id"]) || scheduleId,
      parentScheduleId: extractByKeys(record, ["parent schedule id"]) || undefined,
      versionNumber: Number(extractByKeys(record, ["version number"])) || 1,
      versionLabel: extractByKeys(record, ["version label"]) || "a",
      lifecycle: (extractByKeys(record, ["lifecycle"]) as ScheduleLifecycle) || "Live",
      companyFolderId: rowCompanyFolderId,
      scheduleName: extractByKeys(record, ["schedule name", "name"]) || "Unnamed schedule",
      audits: [audit],
      auditors: extractByKeys(record, ["auditors", "auditor"])
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      startDate: extractByKeys(record, ["start date"]),
      endDate: extractByKeys(record, ["end date"]),
      updatedAt: extractByKeys(record, ["updated at", "updated"]),
      archivedAt: extractByKeys(record, ["archived at"]) || undefined,
      reactivatedAt: extractByKeys(record, ["reactivated at"]) || undefined,
      escalationUserIds: parsePeopleList(extractByKeys(record, ["escalation user ids", "escalation users"])),
      triggerReauditOnFailure: safeLower(extractByKeys(record, ["trigger reaudit on failure"])) === "true",
      reauditDelayHours: Number(extractByKeys(record, ["reaudit delay hours"])) || undefined,
      missedAuditCount: Number(extractByKeys(record, ["missed audit count"])) || 0,
      lastCompletedAt: extractByKeys(record, ["last completed at"]) || undefined,
      nextDueAt: extractByKeys(record, ["next due at"]) || undefined,
      healthState: (extractByKeys(record, ["health state"]) as ScheduleHealthState) || undefined,
    });
  });

  return Array.from(grouped.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function parseCompanySheetActions(records: Record<string, string>[], companyFolderId: string) {
  return records
    .map((record, index) => {
      const rowCompanyId = extractByKeys(record, ["company id", "company folder id", "company"]);
      if (rowCompanyId && rowCompanyId !== companyFolderId) {
        return null;
      }
      const actionId = extractByKeys(record, ["action id"]) || `action-row-${index + 1}`;
      const auditId = extractByKeys(record, ["source audit id", "audit id"]);
      const auditName = extractByKeys(record, ["source audit name", "audit name"]);
      const questionText = extractByKeys(record, ["source question text", "question text"]);
      if (!actionId || !auditName) {
        return null;
      }
      const severity = (extractByKeys(record, ["severity"]) as RiskLevel) || "Medium";
      const createdAt = extractByKeys(record, ["created at"]) || "";
      const dueDate = extractByKeys(record, ["due date"]) || "";
      return {
        id: actionId,
        companyId: rowCompanyId || companyFolderId,
        siteArea: extractByKeys(record, ["site area", "site", "area"]),
        auditId,
        auditName,
        questionId: extractByKeys(record, ["source question id", "question id"]),
        questionText,
        sourceAnswer: extractByKeys(record, ["source answer", "answer"]),
        nonConformanceId: extractByKeys(record, ["non conformance id", "non-conformance id", "nc id"]),
        severity,
        owner: extractByKeys(record, ["assigned to name", "owner"]) || "Unassigned",
        assignedToUserId: extractByKeys(record, ["assigned to user id", "assigned user id"]),
        assignedToName: extractByKeys(record, ["assigned to name", "assigned to"]) || "Unassigned",
        createdByUserId: extractByKeys(record, ["created by user id", "created by"]),
        createdAt,
        dueDate,
        closedAt: extractByKeys(record, ["closed at"]),
        verifiedByUserId: extractByKeys(record, ["verified by user id", "verified by"]),
        verificationNotes: extractByKeys(record, ["verification notes"]),
        evidenceLinks: parsePeopleList(extractByKeys(record, ["evidence links"])),
        localEvidenceRefs: parsePeopleList(extractByKeys(record, ["local evidence refs", "local evidence"])),
        comments: extractByKeys(record, ["comments"]),
        recurrenceFlag: safeLower(extractByKeys(record, ["recurrence flag", "repeat flag"])) === "true",
        rootCause: extractByKeys(record, ["root cause"]),
        correctiveAction: extractByKeys(record, ["corrective action"]),
        preventiveAction: extractByKeys(record, ["preventive action"]),
        dueLabel: dueDate || getDueLabel(ACTION_DUE_DAYS_BY_SEVERITY[severity] * 24),
        dueHours: dueDate ? Math.round((new Date(dueDate).getTime() - Date.now()) / 36e5) : ACTION_DUE_DAYS_BY_SEVERITY[severity] * 24,
        status: (extractByKeys(record, ["status"]) as ActionStatus) || "Open",
        evidenceCount: Number(extractByKeys(record, ["evidence count"])) || parsePeopleList(extractByKeys(record, ["local evidence refs", "local evidence"])).length,
        noteIncluded: Boolean(extractByKeys(record, ["comments", "notes"])),
        riskCategory: (extractByKeys(record, ["risk category", "category"]) as RiskCategory) || "Other",
        evidenceRequired: safeLower(extractByKeys(record, ["requires photo evidence", "evidence required"])) === "true",
        requiresManagerReview: safeLower(extractByKeys(record, ["requires manager review"])) === "true",
      } satisfies ActionItem;
    })
    .filter(Boolean) as ActionItem[];
}

function addDaysIso(days: number) {
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function parseNonConformanceSequence(nonConformanceId?: string) {
  if (!nonConformanceId) return null;
  const match = nonConformanceId.match(/^NC-(\d+)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function getNextNonConformanceSequence(items: ActionItem[]) {
  const maxValue = items.reduce((max, item) => {
    const parsed = parseNonConformanceSequence(item.nonConformanceId);
    if (parsed === null) return max;
    return Math.max(max, parsed);
  }, 0);
  return maxValue + 1;
}

function formatNonConformanceId(sequence: number) {
  return `NC-${String(sequence).padStart(5, "0")}`;
}

function parseNcrSequence(reference: string) {
  const match = reference.match(/^NCR-(\d+)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function getNextNcrSequence(items: NonConformanceRecord[]) {
  const maxValue = items.reduce((max, item) => {
    const parsed = parseNcrSequence(item.reference);
    if (parsed === null) return max;
    return Math.max(max, parsed);
  }, 0);
  return maxValue + 1;
}

function formatNcrReference(sequence: number) {
  return `NCR-${String(sequence).padStart(4, "0")}`;
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function extractGoogleResourceId(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  const directIdMatch = trimmed.match(/^[A-Za-z0-9_-]{20,}$/);
  if (directIdMatch) {
    return directIdMatch[0];
  }

  const pathMatch = trimmed.match(/\/d\/([A-Za-z0-9_-]+)/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const folderMatch = trimmed.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folderMatch?.[1]) {
    return folderMatch[1];
  }

  const queryMatch = trimmed.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (queryMatch?.[1]) {
    return queryMatch[1];
  }

  return trimmed;
}

function isAuditCompleted(audit: Audit) {
  return !["Not yet completed", "Not completed yet"].includes(audit.lastCompletedAt);
}

function formatScheduleVersionLabel(versionNumber: number) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  return alphabet[versionNumber - 1] || `v${versionNumber}`;
}

function openPrintableReport(title: string, bodyHtml: string) {
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=900,height=1200");
  if (!printWindow) {
    return false;
  }

  printWindow.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; }
      h1 { margin: 0 0 12px; font-size: 28px; }
      h2 { margin: 24px 0 10px; font-size: 18px; }
      p { margin: 0 0 8px; line-height: 1.5; }
      ul { margin: 8px 0 16px 18px; padding: 0; }
      li { margin: 0 0 6px; }
      .meta { color: #475569; font-size: 12px; margin-bottom: 18px; }
      .card { border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; margin: 0 0 16px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      @media print { body { margin: 16px; } }
    </style>
  </head>
  <body>${bodyHtml}</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return true;
}

function readStoredFolderLinks() {
  try {
    const raw = window.localStorage.getItem(folderLinksStorageKey);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as {
      folderNameInput?: string;
      folderIdInput?: string;
      auditFormsFolderInput?: string;
      masterSheetInput?: string;
      evidenceFolderInput?: string;
      healthSafetyFolderInput?: string;
      exportsFolderInput?: string;
      adminNotesFolderInput?: string;
    };
  } catch {
    return null;
  }
}

function readStoredWorkspaceState() {
  try {
    const raw = window.localStorage.getItem(workspaceStateStorageKey);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as {
      audits?: Audit[];
      history?: HistoryEntry[];
      actions?: ActionItem[];
      nonConformances?: NonConformanceRecord[];
      schedules?: ScheduleItem[];
      templates?: AuditTemplate[];
      drafts?: Record<string, AuditDraft>;
      managedSchedules?: ManagedSchedule[];
      folders?: CompanyFolder[];
      selectedFolderId?: string;
      syncState?: string;
      invitedUsers?: UserInvite[];
      sites?: Site[];
      selectedSiteId?: string;
      companySheetSync?: CompanySheetSyncStatus | null;
      reportInbox?: ReportItem[];
      syncQueue?: SyncQueueItem[];
      incidents?: IncidentRecord[];
      incidentActions?: IncidentCorrectiveAction[];
      auditAccessOverrides?: AuditAccessOverrideMap;
      managerAlerts?: ManagerAlert[];
      roleNavVisibility?: RoleNavVisibilityMatrix;
      roleSiteSelectorVisibility?: RoleSiteSelectorVisibility;
      userSiteAssignments?: UserSiteAssignments;
      externalEmployees?: ExternalEmployee[];
      documentDistributions?: DocumentDistribution[];
    };
  } catch {
    return null;
  }
}

function readStoredUserProfilePhotos() {
  try {
    const raw = window.localStorage.getItem(userProfilePhotosStorageKey);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function readStoredUserNicknames() {
  try {
    const raw = window.localStorage.getItem(userNicknamesStorageKey);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/** First-ever visit (no persisted workspace blob) loads isolated local demo payloads; clears when real workspace data replaces localStorage. */
function getWorkspaceBootstrap() {
  const rawKey = window.localStorage.getItem(workspaceStateStorageKey);
  const stored = readStoredWorkspaceState();
  if (rawKey === null) {
    const demo = buildDemoPrecastWorkspace();
    return {
      audits: demo.audits,
      history: initialHistory,
      actions: demo.actions,
      schedules: initialSchedules,
      templates: demo.templates,
      nonConformances: initialNonConformances,
      drafts: demo.drafts,
      managedSchedules: [] as ManagedSchedule[],
      folders: [] as CompanyFolder[],
      selectedFolderId: "",
      syncState: "Synced",
      invitedUsers: [] as UserInvite[],
      sites: deriveSitesFromWorkspace(demo.audits, initialSchedules, []),
      selectedSiteId: "",
      companySheetSync: demo.companySheetSync,
      reportInbox: [] as ReportItem[],
      syncQueue: demo.syncQueue,
      incidents: [] as IncidentRecord[],
      incidentActions: [] as IncidentCorrectiveAction[],
      auditAccessOverrides: {} as AuditAccessOverrideMap,
      managerAlerts: [] as ManagerAlert[],
      roleNavVisibility: buildDefaultRoleNavVisibilityMatrix(),
      roleSiteSelectorVisibility: buildDefaultRoleSiteSelectorVisibility(),
      userSiteAssignments: {} as UserSiteAssignments,
      externalEmployees: [] as ExternalEmployee[],
      documentDistributions: [] as DocumentDistribution[],
    };
  }

  return {
    audits: stored?.audits ?? initialAudits,
    history: stored?.history ?? initialHistory,
    actions: stored?.actions ?? initialActions,
    nonConformances: stored?.nonConformances ?? initialNonConformances,
    schedules: stored?.schedules ?? initialSchedules,
    templates: stored?.templates ?? initialTemplates,
    drafts: stored?.drafts ?? {},
    managedSchedules: stored?.managedSchedules ?? [],
    folders: stored?.folders ?? [],
    selectedFolderId: stored?.selectedFolderId ?? "",
    syncState: stored?.syncState ?? "Not synced",
    invitedUsers: stored?.invitedUsers ?? [],
    sites: stored?.sites ?? deriveSitesFromWorkspace(stored?.audits ?? initialAudits, stored?.schedules ?? initialSchedules, stored?.managedSchedules ?? []),
    selectedSiteId: stored?.selectedSiteId ?? "",
    companySheetSync: stored?.companySheetSync ?? null,
    reportInbox: stored?.reportInbox ?? [],
    syncQueue: stored?.syncQueue ?? initialSyncQueue,
    incidents: stored?.incidents ?? initialIncidents,
    incidentActions: stored?.incidentActions ?? initialIncidentActions,
    auditAccessOverrides: stored?.auditAccessOverrides ?? {},
    managerAlerts: stored?.managerAlerts ?? [],
    roleNavVisibility: stored?.roleNavVisibility ?? buildDefaultRoleNavVisibilityMatrix(),
    roleSiteSelectorVisibility: stored?.roleSiteSelectorVisibility ?? buildDefaultRoleSiteSelectorVisibility(),
    userSiteAssignments: stored?.userSiteAssignments ?? {},
    externalEmployees: stored?.externalEmployees ?? [],
    documentDistributions: stored?.documentDistributions ?? [],
  };
}

function readStoredPreviewOrientation(): PreviewOrientation {
  try {
    const raw = window.localStorage.getItem(previewOrientationStorageKey);
    return raw === "landscape" ? "landscape" : "portrait";
  } catch {
    return "portrait";
  }
}

function defaultDashboardPreferences(): DashboardPreferences {
  return {
    trafficBoard: true,
    liveSummary: true,
    upcomingAudits: true,
    openActions: true,
    complianceSnapshot: true,
  };
}

function defaultDashboardSectionOrder(): DashboardSectionKey[] {
  return ["trafficBoard", "upcomingAudits", "openActions", "liveSummary", "complianceSnapshot"];
}

function readStoredDashboardPreferences(): DashboardPreferences {
  const defaults = defaultDashboardPreferences();
  try {
    const raw = window.localStorage.getItem(dashboardPreferencesStorageKey);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<DashboardPreferences>;
    return {
      trafficBoard: parsed.trafficBoard ?? defaults.trafficBoard,
      liveSummary: parsed.liveSummary ?? defaults.liveSummary,
      upcomingAudits: parsed.upcomingAudits ?? defaults.upcomingAudits,
      openActions: parsed.openActions ?? defaults.openActions,
      complianceSnapshot: parsed.complianceSnapshot ?? defaults.complianceSnapshot,
    };
  } catch {
    return defaults;
  }
}

function readStoredDashboardSectionOrder(): DashboardSectionKey[] {
  const defaults = defaultDashboardSectionOrder();
  try {
    const raw = window.localStorage.getItem(dashboardSectionOrderStorageKey);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as DashboardSectionKey[];
    const valid = parsed.filter((item): item is DashboardSectionKey => defaults.includes(item));
    const missing = defaults.filter((item) => !valid.includes(item));
    return [...valid, ...missing];
  } catch {
    return defaults;
  }
}

function DataFlowBackground({ className = "", showBase = true }: { className?: string; showBase?: boolean }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${showBase ? "bg-[#020817]" : ""} ${className}`.trim()}>
      {showBase && <div className="absolute inset-0 bg-[#020617]" />}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_58%_42%,rgba(59,130,246,0.14),transparent_14%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_48%,rgba(249,115,22,0.07),transparent_30%)]" />
      <svg
        className="absolute left-1/2 top-1/3 h-full w-[120%] -translate-x-1/2 opacity-50"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="heroStrand" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0" />
            <stop offset="18%" stopColor="#3b82f6" stopOpacity="0.5" />
            <stop offset="50%" stopColor="#dbeafe" stopOpacity="1" />
            <stop offset="76%" stopColor="#2563eb" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="coreLight" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#eff6ff" stopOpacity="1" />
            <stop offset="35%" stopColor="#93c5fd" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse
          cx="980"
          cy="350"
          rx="230"
          ry="48"
          fill="url(#coreLight)"
          opacity="0.95"
          stroke="#f97316"
          strokeOpacity="0.45"
          strokeWidth="1.2"
        />

        {Array.from({ length: 210 }).map((_, index) => {
          const t = index / 209;
          const startY = 20 + t * 650 + Math.sin(index * 0.3) * 22;
          const gatherY = 350 + (t - 0.5) * 18;
          const endY = 110 + t * 470;
          const swingA = Math.sin(index * 0.16) * 220;
          const swingB = Math.cos(index * 0.21) * 120;
          const width = index % 18 === 0 ? 1.5 : index % 3 === 0 ? 0.95 : 0.55;
          const opacity = index % 7 === 0 ? 0.85 : 0.34;

          return (
            <path
              key={`strand-${index}`}
              d={`M-80 ${startY}
                  C 180 ${startY + swingA},
                    460 ${gatherY + swingB},
                    820 ${gatherY}
                  S 1120 ${gatherY + (t - 0.5) * 10},
                    1480 ${endY}`}
              stroke="url(#heroStrand)"
              strokeWidth={width}
              fill="none"
              opacity={opacity}
            />
          );
        })}

        {Array.from({ length: 1400 }).map((_, index) => {
          const cluster = index % 4 === 0;
          const x = cluster ? 10 + (index % 80) * 14 : 1130 + (index % 34) * 14;
          const y = cluster
            ? 20 + Math.floor(index / 80) * 22 + Math.sin(index * 0.6) * 10
            : 25 + Math.floor(index / 34) * 16;

          if (cluster) {
            return (
              <text
                key={`particle-${index}`}
                x={x}
                y={y}
                fill="#93c5fd"
                opacity={0.04 + (index % 8) * 0.012}
                fontSize={index % 20 === 0 ? "10" : "7"}
                fontFamily="monospace"
              >
                {index % 2 === 0 ? "1" : "0"}
              </text>
            );
          }

          return (
            <circle
              key={`particle-${index}`}
              cx={x}
              cy={y}
              r={0.45}
              fill="#93c5fd"
              opacity="0.07"
              stroke="#fb923c"
              strokeOpacity="0.4"
              strokeWidth="0.35"
            />
          );
        })}

        {Array.from({ length: 1600 }).map((_, index) => {
          const col = index % 50;
          const row = Math.floor(index / 50);
          const x = 1080 + col * 11;
          const y = 20 + row * 14;

          return (
            <text
              key={`binary-${index}`}
              x={x}
              y={y}
              fill="#60a5fa"
              opacity={Math.max(0.03, 0.46 - col * 0.008)}
              fontSize="8"
              fontFamily="monospace"
            >
              {index % 4 === 0 ? "01" : index % 4 === 1 ? "10" : index % 4 === 2 ? "11" : "00"}
            </text>
          );
        })}

        {Array.from({ length: 90 }).map((_, index) => {
          const y = 120 + index * 6;
          return (
            <path
              key={`output-${index}`}
              d={`M1000 ${y} C 1120 ${y}, 1260 ${y + Math.sin(index) * 12}, 1480 ${y}`}
              stroke="#3b82f6"
              strokeWidth="0.5"
              fill="none"
              opacity="0.22"
            />
          );
        })}
      </svg>
    </div>
  );
}

function App() {
  const actionsPersistReadyRef = useRef(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [previewOrientation, setPreviewOrientation] = useState<PreviewOrientation>(() => readStoredPreviewOrientation());
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(desktopSidebarCollapsedStorageKey) === "true";
    } catch {
      return false;
    }
  });
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [companySetupLoginPortal, setCompanySetupLoginPortal] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("setup") === "master";
    } catch {
      return false;
    }
  });
  const [godCompanySetupSession, setGodCompanySetupSession] = useState(() => {
    try {
      return window.localStorage.getItem(masterCompanySetupSessionKey) === "1";
    } catch {
      return false;
    }
  });
  const workspaceBootstrapRef = useRef<ReturnType<typeof getWorkspaceBootstrap> | null>(null);
  if (!workspaceBootstrapRef.current) {
    workspaceBootstrapRef.current = getWorkspaceBootstrap();
  }
  const storedWorkspaceState = workspaceBootstrapRef.current;
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [shellMoreExpanded, setShellMoreExpanded] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [dashboardPreferences, setDashboardPreferences] = useState<DashboardPreferences>(() =>
    readStoredDashboardPreferences(),
  );
  const [dashboardSectionOrder, setDashboardSectionOrder] = useState<DashboardSectionKey[]>(() =>
    readStoredDashboardSectionOrder(),
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accountNameInput, setAccountNameInput] = useState("");
  const [accountNicknameInput, setAccountNicknameInput] = useState("");
  const [accountPhotoUrl, setAccountPhotoUrl] = useState("");
  const [userProfilePhotos, setUserProfilePhotos] = useState<Record<string, string>>(() => readStoredUserProfilePhotos());
  const [userNicknames, setUserNicknames] = useState<Record<string, string>>(() => readStoredUserNicknames());
  const [audits, setAudits] = useState<Audit[]>(storedWorkspaceState?.audits || initialAudits);
  const [history, setHistory] = useState<HistoryEntry[]>(storedWorkspaceState?.history || initialHistory);
  const [actions, setActions] = useState<ActionItem[]>(storedWorkspaceState?.actions || initialActions);
  const [nonConformances, setNonConformances] = useState<NonConformanceRecord[]>(storedWorkspaceState?.nonConformances || initialNonConformances);
  const [incidents, setIncidents] = useState<IncidentRecord[]>(storedWorkspaceState?.incidents || initialIncidents);
  const [incidentActions, setIncidentActions] = useState<IncidentCorrectiveAction[]>(storedWorkspaceState?.incidentActions || initialIncidentActions);
  const [schedules, setSchedules] = useState<ScheduleItem[]>(storedWorkspaceState?.schedules || initialSchedules);
  const [sites, setSites] = useState<Site[]>(storedWorkspaceState?.sites || deriveSitesFromWorkspace(storedWorkspaceState?.audits || initialAudits, storedWorkspaceState?.schedules || initialSchedules, storedWorkspaceState?.managedSchedules || []));
  const [selectedSiteId, setSelectedSiteId] = useState<string>(storedWorkspaceState?.selectedSiteId || "");
  const [templates, setTemplates] = useState<AuditTemplate[]>(storedWorkspaceState?.templates || initialTemplates);
  const [drafts, setDrafts] = useState<Record<string, AuditDraft>>(storedWorkspaceState?.drafts || {});
  const [activeAuditId, setActiveAuditId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, Answer>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<Record<string, EvidenceItem[]>>({});
  const [evidenceDebugLabel, setEvidenceDebugLabel] = useState("");
  const [auditModeQuestionIndex, setAuditModeQuestionIndex] = useState(0);
  const [issuePrompt, setIssuePrompt] = useState<IssuePromptState | null>(null);
  const [auditCompletionSummary, setAuditCompletionSummary] = useState<AuditCompletionSummaryState | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [signatureSignedAt, setSignatureSignedAt] = useState("");
  const [offlineMode, setOfflineMode] = useState(!window.navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState<OfflineSubmission[]>([]);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>(storedWorkspaceState?.syncQueue || initialSyncQueue);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [backendConfigured, setBackendConfigured] = useState(false);
  const [sharedDriveId, setSharedDriveId] = useState("");
  const [onboardingSource, setOnboardingSource] = useState<OnboardingSource | null>(null);
  const [onboardingRecords, setOnboardingRecords] = useState<OnboardingRecord[]>([]);
  const [onboardingRecordsLoading, setOnboardingRecordsLoading] = useState(false);
  const [selectedOnboardingRecordId, setSelectedOnboardingRecordId] = useState("");
  const [googleStatusLoading, setGoogleStatusLoading] = useState(false);
  const [folderInspection, setFolderInspection] = useState<FolderInspection | null>(null);
  const [folderInspectionLoading, setFolderInspectionLoading] = useState(false);
  const [workspaceValidation, setWorkspaceValidation] = useState<WorkspaceValidation | null>(null);
  const [workspaceValidationLoading, setWorkspaceValidationLoading] = useState(false);
  const storedFolderLinks = readStoredFolderLinks();
  const [folderNameInput, setFolderNameInput] = useState(storedFolderLinks?.folderNameInput || "");
  const [folderIdInput, setFolderIdInput] = useState(storedFolderLinks?.folderIdInput || "");
  const [auditFormsFolderInput, setAuditFormsFolderInput] = useState(storedFolderLinks?.auditFormsFolderInput || "");
  const [masterSheetInput, setMasterSheetInput] = useState(storedFolderLinks?.masterSheetInput || "");
  const [evidenceFolderInput, setEvidenceFolderInput] = useState(storedFolderLinks?.evidenceFolderInput || "");
  const [healthSafetyFolderInput, setHealthSafetyFolderInput] = useState(storedFolderLinks?.healthSafetyFolderInput || "");
  const [exportsFolderInput, setExportsFolderInput] = useState(storedFolderLinks?.exportsFolderInput || "");
  const [adminNotesFolderInput, setAdminNotesFolderInput] = useState(storedFolderLinks?.adminNotesFolderInput || "");
  const [templateNameInput, setTemplateNameInput] = useState("");
  const [templateQuestionInput, setTemplateQuestionInput] = useState("");
  const [templateQuestionTypeInput, setTemplateQuestionTypeInput] = useState<AuditQuestion["fieldType"]>("Traffic light");
  const [templateDraftQuestions, setTemplateDraftQuestions] = useState<DraftTemplateQuestion[]>([]);
  const [scheduleNameInput, setScheduleNameInput] = useState("");
  const [scheduleAreaInput, setScheduleAreaInput] = useState("");
  const [scheduleOwnerInput, setScheduleOwnerInput] = useState(DEFAULT_MANAGER_NAME);
  const [scheduleScopeInput, setScheduleScopeInput] = useState<ScheduleScope>("Company schedule");
  const [schedulePersonalAssigneeInput, setSchedulePersonalAssigneeInput] = useState(DEFAULT_AUDITOR_NAME);
  const [scheduleFrequencyInput, setScheduleFrequencyInput] = useState<ScheduleFrequency>("Weekly");
  const [scheduleSendTimeInput, setScheduleSendTimeInput] = useState("08:00");
  const [scheduleRecipientsInput, setScheduleRecipientsInput] = useState(DEFAULT_AUDITOR_NAME);
  const [scheduleOverdueAlertRecipientsInput, setScheduleOverdueAlertRecipientsInput] = useState(DEFAULT_MANAGER_NAME);
  const [scheduleEscalationContactInput, setScheduleEscalationContactInput] = useState(DEFAULT_ESCALATION_NAME);
  const [scheduleOverdueAlertTimingInput, setScheduleOverdueAlertTimingInput] =
    useState<OverdueAlertTiming>("At due time");
  const [scheduleCompletionCheckTimingInput, setScheduleCompletionCheckTimingInput] =
    useState<CompletionCheckTiming>("At due time");
  const [scheduleNextDueHoursInput, setScheduleNextDueHoursInput] = useState("24");
  const [schedulePriorityInput, setSchedulePriorityInput] = useState<Priority>("Medium");
  const [managedSchedules, setManagedSchedules] = useState<ManagedSchedule[]>(storedWorkspaceState?.managedSchedules || []);
  const [scheduleListFilter, setScheduleListFilter] = useState<ScheduleListFilter>("Live");
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleDraftName, setScheduleDraftName] = useState("");
  const [scheduleDraftSelectedAuditIds, setScheduleDraftSelectedAuditIds] = useState<string[]>([]);
  const [scheduleDraftAudits, setScheduleDraftAudits] = useState<ManagedScheduleAudit[]>([]);
  const [scheduleDraftStartDate, setScheduleDraftStartDate] = useState("");
  const [scheduleDraftEndDate, setScheduleDraftEndDate] = useState("");
  const [scheduleDraftContinuous, setScheduleDraftContinuous] = useState(true);
  const [scheduleDraftAuditors, setScheduleDraftAuditors] = useState<string[]>([]);
  const [scheduleValidationAttempted, setScheduleValidationAttempted] = useState(false);
  const [folders, setFolders] = useState<CompanyFolder[]>(storedWorkspaceState?.folders || []);
  const [selectedFolderId, setSelectedFolderId] = useState(storedWorkspaceState?.selectedFolderId || "");
  const [syncState, setSyncState] = useState(storedWorkspaceState?.syncState || "Not synced");
  const [inviteEmailInput, setInviteEmailInput] = useState("");
  const [inviteRoleInput, setInviteRoleInput] = useState<Role>("Manager");
  const [invitedUsers, setInvitedUsers] = useState<UserInvite[]>(storedWorkspaceState?.invitedUsers || []);
  const [godModeAppInviteEmail, setGodModeAppInviteEmail] = useState("");
  const [companyOnboardingEmailResult, setCompanyOnboardingEmailResult] = useState<CompanyOnboardingEmailResult | null>(null);
  const [companyOnboardingEmailSending, setCompanyOnboardingEmailSending] = useState(false);
  const [companyUserInviteEmailResult, setCompanyUserInviteEmailResult] = useState<CompanyUserInviteEmailResult | null>(null);
  const [companyUserInviteEmailSending, setCompanyUserInviteEmailSending] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [companySheetSync, setCompanySheetSync] = useState<CompanySheetSyncStatus | null>(storedWorkspaceState?.companySheetSync || null);
  const [selectedReportTemplate, setSelectedReportTemplate] = useState<ReportTemplateType>("Executive summary");
  const [reportTitleInput, setReportTitleInput] = useState(`${companyName} Executive Summary`);
  const [reportRecipients, setReportRecipients] = useState<string[]>([]);
  const [selectedReportSections, setSelectedReportSections] = useState<ReportSectionKey[]>(
    reportTemplateDefaults["Executive summary"],
  );
  const [reportInbox, setReportInbox] = useState<ReportItem[]>(storedWorkspaceState?.reportInbox || []);
  const [auditAccessOverrides, setAuditAccessOverrides] = useState<AuditAccessOverrideMap>(
    storedWorkspaceState?.auditAccessOverrides || {},
  );
  const [managerAlerts, setManagerAlerts] = useState<ManagerAlert[]>(storedWorkspaceState?.managerAlerts || []);
  const [roleNavVisibility, setRoleNavVisibility] = useState<RoleNavVisibilityMatrix>(
    storedWorkspaceState?.roleNavVisibility || buildDefaultRoleNavVisibilityMatrix(),
  );
  const [roleSiteSelectorVisibility, setRoleSiteSelectorVisibility] = useState<RoleSiteSelectorVisibility>(
    storedWorkspaceState?.roleSiteSelectorVisibility || buildDefaultRoleSiteSelectorVisibility(),
  );
  const [userSiteAssignments, setUserSiteAssignments] = useState<UserSiteAssignments>(
    storedWorkspaceState?.userSiteAssignments ?? {},
  );
  const [externalEmployees, setExternalEmployees] = useState<ExternalEmployee[]>(
    storedWorkspaceState?.externalEmployees ?? [],
  );
  const [documentDistributions, setDocumentDistributions] = useState<DocumentDistribution[]>(
    storedWorkspaceState?.documentDistributions ?? [],
  );
  const [actionFilter, setActionFilter] = useState<"Open" | "Overdue" | "Awaiting Verification" | "Closed" | "Severity">("Open");
  const [actionSeverityFilter, setActionSeverityFilter] = useState<RiskLevel | "All">("All");
  const [actionNcFilter, setActionNcFilter] = useState<string>("All");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const activeAudit = useMemo(
    () => audits.find((audit) => audit.id === activeAuditId) ?? null,
    [audits, activeAuditId],
  );

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  );

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId) ?? null,
    [sites, selectedSiteId],
  );

  const currentUserAssignedSiteIds = useMemo(() => {
    if (!currentUser) return null;
    return getUserAssignedSiteIds(currentUser.role, currentUser, invitedUsers, userSiteAssignments);
  }, [currentUser, invitedUsers, userSiteAssignments]);

  const assignmentFilteredAudits = useMemo(
    () => filterByAssignedSites(audits, currentUserAssignedSiteIds, sites),
    [audits, currentUserAssignedSiteIds, sites],
  );
  const assignmentFilteredActions = useMemo(
    () => filterByAssignedSites(actions, currentUserAssignedSiteIds, sites),
    [actions, currentUserAssignedSiteIds, sites],
  );
  const assignmentFilteredSchedules = useMemo(
    () => filterByAssignedSites(schedules, currentUserAssignedSiteIds, sites),
    [schedules, currentUserAssignedSiteIds, sites],
  );
  const assignmentFilteredNonConformances = useMemo(
    () => filterNonConformancesByAssignedSites(nonConformances, currentUserAssignedSiteIds, sites),
    [nonConformances, currentUserAssignedSiteIds, sites],
  );
  const assignmentFilteredHistory = useMemo(() => {
    if (!currentUserAssignedSiteIds) return history;
    const allowedNames = new Set(
      sites.filter((s) => currentUserAssignedSiteIds.has(s.id) && s.active).map((s) => normalizeIdentity(s.name)),
    );
    if (allowedNames.size === 0) return [];
    return history.filter((entry) => {
      const audit = audits.find((a) => a.id === entry.auditId);
      if (!audit) return true;
      return allowedNames.has(normalizeIdentity(audit.siteArea));
    });
  }, [history, audits, currentUserAssignedSiteIds, sites]);

  const headerSelectableSites = useMemo(() => {
    const active = sites.filter((site) => site.active);
    if (!currentUserAssignedSiteIds) return active;
    return active.filter((site) => currentUserAssignedSiteIds.has(site.id));
  }, [sites, currentUserAssignedSiteIds]);

  const siteScopedAudits = useMemo(() => {
    if (!selectedSite) return assignmentFilteredAudits;
    const selectedName = normalizeIdentity(selectedSite.name);
    return assignmentFilteredAudits.filter((audit) => normalizeIdentity(audit.siteArea) === selectedName);
  }, [assignmentFilteredAudits, selectedSite]);

  const siteScopedActions = useMemo(() => {
    if (!selectedSite) return assignmentFilteredActions;
    const selectedName = normalizeIdentity(selectedSite.name);
    return assignmentFilteredActions.filter((action) => !action.siteArea || normalizeIdentity(action.siteArea) === selectedName);
  }, [assignmentFilteredActions, selectedSite]);

  const siteScopedSchedules = useMemo(() => {
    if (!selectedSite) return assignmentFilteredSchedules;
    const selectedName = normalizeIdentity(selectedSite.name);
    return assignmentFilteredSchedules.filter((schedule) => normalizeIdentity(schedule.siteArea) === selectedName);
  }, [assignmentFilteredSchedules, selectedSite]);

  const getStoredProfilePhoto = (user: User | null) => {
    if (!user) return "";
    return userProfilePhotos[user.username] || userProfilePhotos[user.name.toLowerCase()] || "";
  };

  const workspaceName = selectedFolder?.name || companyName;

  const activeOnboardingRecord = useMemo(
    () => onboardingRecords.find((record) => record.id === selectedOnboardingRecordId) ?? null,
    [onboardingRecords, selectedOnboardingRecordId],
  );

  const selectedFolderSchedules = useMemo(
    () => siteScopedSchedules.filter((schedule) => schedule.companyFolderId === selectedFolderId),
    [siteScopedSchedules, selectedFolderId],
  );

  const groupedAudits = useMemo(
    () => ({
      green: siteScopedAudits.filter((audit) => !isAuditCompleted(audit) && getAuditTrafficStatus(audit.dueHours) === "green"),
      amber: siteScopedAudits.filter((audit) => !isAuditCompleted(audit) && getAuditTrafficStatus(audit.dueHours) === "amber"),
      red: siteScopedAudits.filter((audit) => !isAuditCompleted(audit) && getAuditTrafficStatus(audit.dueHours) === "red"),
    }),
    [siteScopedAudits],
  );

  const compliance = useMemo(() => {
    if (siteScopedAudits.length === 0) {
      return 0;
    }
    const safeCount = siteScopedAudits.filter((audit) => getAuditTrafficStatus(audit.dueHours) === "green").length;
    return Math.round((safeCount / siteScopedAudits.length) * 100);
  }, [siteScopedAudits]);

  const priorCompliance = useMemo(() => {
    const recent = history.slice(0, 6);
    const greenCount = recent.filter((item) => item.status === "green").length;
    return recent.length > 0 ? Math.round((greenCount / recent.length) * 100) : compliance;
  }, [history, compliance]);

  const complianceDelta = compliance - priorCompliance;

  const openActions = useMemo(() => actions.filter((action) => action.status !== "Closed"), [actions]);
  const overdueActions = useMemo(() => openActions.filter((action) => action.dueHours < 0), [openActions]);
  const criticalActions = useMemo(() => openActions.filter((action) => action.severity === "Critical" || action.severity === "High"), [openActions]);
  const awaitingVerificationActions = useMemo(() => openActions.filter((action) => action.status === "Awaiting Verification"), [openActions]);
  const overdueAudits = useMemo(
    () => siteScopedAudits.filter((audit) => !isAuditCompleted(audit) && getAuditTrafficStatus(audit.dueHours) === "red"),
    [siteScopedAudits],
  );
  const evidenceCount = useMemo(
    () => Object.values(evidence).reduce((total, items) => total + items.length, 0),
    [evidence],
  );
  const completedToday = useMemo(
    () =>
      history.filter((entry) => {
        const today = new Intl.DateTimeFormat("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: scheduleTimeZone,
        }).format(new Date());
        return entry.completedAt.includes(today);
      }).length,
    [history],
  );
  const auditCompletionRate = useMemo(() => {
    const total = siteScopedAudits.length + history.length;
    if (total === 0) return 0;
    return Math.round((history.length / total) * 100);
  }, [siteScopedAudits.length, history.length]);
  const actionClosureRate = useMemo(() => {
    if (siteScopedActions.length === 0) return 0;
    return Math.round((siteScopedActions.filter((item) => item.status === "Closed").length / siteScopedActions.length) * 100);
  }, [siteScopedActions]);
  const pendingSyncCount = useMemo(
    () => syncQueue.filter((item) => item.status === "Pending Sync" || item.status === "Syncing").length,
    [syncQueue],
  );
  const failedSyncCount = useMemo(
    () => syncQueue.filter((item) => item.status === "Failed" || item.status === "Conflict").length,
    [syncQueue],
  );
  const unsyncedSubmittedAuditIds = useMemo(
    () =>
      new Set(
        syncQueue
          .filter(
            (item) =>
              item.itemType === "auditSubmission" &&
              (item.status === "Pending Sync" ||
                item.status === "Syncing" ||
                item.status === "Failed" ||
                item.status === "Conflict"),
          )
          .map((item) => item.localId),
      ),
    [syncQueue],
  );
  const averageActionClosureDays = useMemo(() => {
    const closed = siteScopedActions.filter((item) => item.closedAt && item.createdAt);
    if (closed.length === 0) return 0;
    const totalDays = closed.reduce((sum, item) => {
      const diff = new Date(item.closedAt).getTime() - new Date(item.createdAt).getTime();
      return sum + Math.max(1, Math.round(diff / 86400000));
    }, 0);
    return Math.round(totalDays / closed.length);
  }, [siteScopedActions]);
  const recurringFailedQuestions = useMemo(() => {
    const map = new Map<string, number>();
    siteScopedActions.forEach((action) => {
      map.set(action.questionText, (map.get(action.questionText) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [siteScopedActions]);
  const topOverdueSchedules = useMemo(() => {
    return managedSchedules
      .filter((item) => computeScheduleHealthState(item) === "Overdue" || computeScheduleHealthState(item) === "Failing")
      .sort((a, b) => (b.missedAuditCount || 0) - (a.missedAuditCount || 0))
      .slice(0, 5);
  }, [managedSchedules]);
  const riskSummary = useMemo(() => {
    const levels: RiskLevel[] = [];
    let total = 0;
    let critical = 0;
    let high = 0;
    siteScopedAudits.forEach((audit) => {
      levels.push(audit.highestRiskLevel || "Low");
      total += audit.totalRiskScore || 0;
      critical += audit.numberOfCriticalFindings || 0;
      high += audit.numberOfHighFindings || 0;
    });
    return {
      totalRiskScore: total,
      highestRiskLevel: levels.length ? maxRiskLevel(levels) : ("Low" as RiskLevel),
      criticalFindings: critical,
      highFindings: high,
    };
  }, [siteScopedAudits]);
  const visibleActions = useMemo(() => {
    const withEscalation = (items: ActionItem[]) =>
      items.map((action) => ({
        ...action,
        escalated: isEscalated(action),
        isStuck: isStuck(action),
      }));
    if (!currentUser) return withEscalation(siteScopedActions);
    const permissions = getRolePermissions(currentUser.role);
    if (permissions.canAssignActions) return withEscalation(siteScopedActions);
    return withEscalation(siteScopedActions.filter((action) => action.assignedToName === currentUser.name || action.assignedToUserId === currentUser.username));
  }, [siteScopedActions, currentUser]);
  const filteredActions = useMemo(() => {
    let next = [...visibleActions];
    if (actionFilter === "Open") {
      next = next.filter((item) => item.status === "Open" || item.status === "In Progress");
    } else if (actionFilter === "Overdue") {
      next = next.filter((item) => isOverdue(item));
    } else if (actionFilter === "Awaiting Verification") {
      next = next.filter((item) => item.status === "Awaiting Verification");
    } else if (actionFilter === "Closed") {
      next = next.filter((item) => item.status === "Closed");
    }
    if (actionSeverityFilter !== "All") {
      next = next.filter((item) => item.severity === actionSeverityFilter);
    }
    if (actionNcFilter !== "All") {
      next = next.filter((item) => item.nonConformanceId === actionNcFilter);
    }
    return next;
  }, [visibleActions, actionFilter, actionSeverityFilter, actionNcFilter]);
  const availableNonConformanceIds = useMemo(
    () =>
      Array.from(new Set(visibleActions.map((item) => item.nonConformanceId).filter((value): value is string => Boolean(value)))).sort(
        (left, right) => left.localeCompare(right, undefined, { numeric: true }),
      ),
    [visibleActions],
  );

  const demoModeActive = useMemo(
    () =>
      siteScopedAudits.some((audit) => audit.id.startsWith("audit-demo-")) ||
      siteScopedActions.some((action) => action.id.startsWith("action-demo-")) ||
      syncQueue.some((item) => item.id.startsWith("sync-demo-")),
    [siteScopedAudits, siteScopedActions, syncQueue],
  );

  const godCompanySetupOnlyShell = Boolean(currentUser?.role === "Master" && godCompanySetupSession);

  const roleLabel = useMemo(() => {
    if (!currentUser) {
      return "";
    }
    if (currentUser.role === "Master" && godCompanySetupSession) {
      return "Workspace setup only — sign out when finished";
    }
    if (currentUser.role === "Master") {
      return "Setup — connect Google, link the company workspace, and go live";
    }
    if (currentUser.role === "Admin") {
      return "Admin, templates, invites, and workspace checks";
    }
    if (currentUser.role === "Manager") {
      return "Review actions, overdue items, and compliance risk";
    }
    return "Complete assigned audits and capture site outcomes";
  }, [currentUser, godCompanySetupSession]);
  const currentUserAppName = useMemo(() => {
    if (!currentUser) {
      return "";
    }
    return userNicknames[currentUser.username]?.trim() || currentUser.name;
  }, [currentUser, userNicknames, godCompanySetupSession]);

  const visibleNavItems = useMemo(() => {
    if (!currentUser) {
      return [];
    }
    if (usesPilotOperatorNav(currentUser.role)) {
      return PILOT_PRIMARY_NAV_IDS.flatMap((id) => {
        if (!canRoleAccessNavItem(currentUser.role, id)) {
          return [];
        }
        const item = navItems.find((entry) => entry.id === id);
        return item ? [item] : [];
      });
    }
    const filtered = navItems.filter((item) => {
      const baselineVisible = canRoleAccessNavItem(currentUser.role, item.id);
      if (item.id === "incidents") {
        return baselineVisible;
      }
      const matrixVisible = roleNavVisibility[currentUser.role]?.[item.id] ?? baselineVisible;
      return baselineVisible && matrixVisible;
    });

    // Safety net: always surface onboarding when role has onboarding access.
    if (
      canAccessOnboardingNav(currentUser.role) &&
      (roleNavVisibility[currentUser.role]?.["onboarding"] ?? true) &&
      !filtered.some((item) => item.id === "onboarding")
    ) {
      const onboardingItem = navItems.find((item) => item.id === "onboarding");
      if (onboardingItem) {
        const accountIndex = filtered.findIndex((item) => item.id === "account");
        if (accountIndex >= 0) {
          filtered.splice(accountIndex, 0, onboardingItem);
        } else {
          filtered.push(onboardingItem);
        }
      }
    }

    return filtered;
  }, [currentUser, roleNavVisibility, godCompanySetupSession]);

  const visibleNavIdSet = useMemo(() => new Set(visibleNavItems.map((item) => item.id)), [visibleNavItems]);

  /** Tablet sidebar primary row — fixed order from `navStructure`, intersected with role visibility. */
  const primaryNavItems = useMemo(() => {
    const order = currentUser && usesPilotOperatorNav(currentUser.role) ? PILOT_PRIMARY_NAV_IDS : PRIMARY_NAV_IDS;
    return order.flatMap((id) => {
      if (!visibleNavIdSet.has(id)) {
        return [];
      }
      const item = navItems.find((entry) => entry.id === id);
      return item ? [item] : [];
    });
  }, [visibleNavIdSet, currentUser]);

  /** Tablet sidebar “More” — fixed order from `navStructure`, intersected with role visibility. */
  const moreNavItems = useMemo(() => {
    return MORE_MENU_NAV_IDS.flatMap((id) => {
      if (!visibleNavIdSet.has(id)) {
        return [];
      }
      const item = navItems.find((entry) => entry.id === id);
      return item ? [item] : [];
    });
  }, [visibleNavIdSet]);

  const mobileTabBarIds = useMemo(() => new Set<string>(["dashboard", "audits", "actions", "reports"]), []);

  /** Mobile “More” sheet — same ordering as tablet (primary extras not on tab bar, then More menu ids). */
  const mobileMoreDestinations = useMemo(() => {
    if (currentUser && usesPilotOperatorNav(currentUser.role)) {
      const orderedIds = [...PILOT_PRIMARY_NAV_IDS];
      const seen = new Set<string>();
      const out: Array<(typeof navItems)[number]> = [];
      for (const id of orderedIds) {
        if (seen.has(id) || mobileTabBarIds.has(id) || !visibleNavIdSet.has(id)) {
          continue;
        }
        seen.add(id);
        const item = navItems.find((entry) => entry.id === id);
        if (item) {
          out.push(item);
        }
      }
      return out;
    }
    const orderedIds = [...PRIMARY_NAV_IDS, ...MORE_MENU_NAV_IDS];
    const seen = new Set<string>();
    const out: Array<(typeof navItems)[number]> = [];
    for (const id of orderedIds) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      if (!visibleNavIdSet.has(id) || mobileTabBarIds.has(id)) {
        continue;
      }
      const item = navItems.find((entry) => entry.id === id);
      if (item) {
        out.push(item);
      }
    }
    return out;
  }, [visibleNavIdSet, mobileTabBarIds]);

  const mobileBottomNavEntries = useMemo(() => {
    if (currentUser && usesPilotOperatorNav(currentUser.role)) {
      return [
        { id: "dashboard" as const, label: "Dashboard", icon: "dashboard" },
        { id: "setup" as const, label: "Setup", icon: "spark" },
        { id: "companies" as const, label: "Companies", icon: "clipboard" },
        { id: "invites" as const, label: "Invites", icon: "note" },
        { id: "__more__" as const, label: "More", icon: "grid" },
        { id: "__logout__" as const, label: "Log out", icon: "logOut" },
      ];
    }
    const entries: Array<{ id: Screen | "__more__" | "__logout__"; label: string; icon: string }> = [
      { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    ];
    if (visibleNavItems.some((i) => i.id === "audits")) {
      entries.push({ id: "audits", label: "Audits", icon: "clipboard" });
    }
    if (visibleNavItems.some((i) => i.id === "actions")) {
      entries.push({ id: "actions", label: "Actions", icon: "warningTriangle" });
    }
    if (visibleNavItems.some((i) => i.id === "reports")) {
      entries.push({ id: "reports", label: "Reports", icon: "chart" });
    }
    entries.push({ id: "__more__", label: "More", icon: "grid" });
    entries.push({ id: "__logout__", label: "Log out", icon: "logOut" });
    return entries;
  }, [visibleNavItems]);

  const showSiteSelectorForRole = currentUser ? (roleSiteSelectorVisibility[currentUser.role] ?? true) : true;

  const creatableRoles = useMemo(
    () => (currentUser ? getCreatableRoles(currentUser.role) : []),
    [currentUser],
  );

  const companyReportUsers = useMemo(() => {
    const seededUsers = users
      .filter((user) => user.role !== "Master")
      .map((user) => ({
        username: user.username,
        email:
          user.username === "admin"
            ? "andy@usebert.co.uk"
            : user.username === "manager"
              ? "james@usebert.co.uk"
              : user.username === "tom"
                ? "tom@usebert.co.uk"
                : "sarah@usebert.co.uk",
        name: user.name,
        role: user.role,
      }));
    const invited = invitedUsers.map((invite) => ({
      username: invite.email.toLowerCase(),
      email: invite.email,
      name: invite.email,
      role: invite.role,
    }));
    const merged = [...seededUsers, ...invited];
    return merged.filter((user, index, list) => list.findIndex((item) => item.email === user.email) === index);
  }, [invitedUsers]);

  const reminderUserEmail = useMemo(() => {
    if (!currentUser) {
      return "";
    }
    const identity = currentUser.username.trim().toLowerCase();
    if (identity.includes("@")) {
      return identity;
    }
    return `${identity}@usebert.co.uk`;
  }, [currentUser]);

  const documentTrainingWorkspaceId = useMemo(
    () => selectedFolderId || selectedFolder?.id || "local-workspace",
    [selectedFolderId, selectedFolder],
  );

  const documentTrainingRecipientOptions = useMemo((): OnboardedRecipientOption[] => {
    return invitedUsers.map((invite) => {
      const email = invite.email.toLowerCase();
      const siteIds = userSiteAssignments[email] || [];
      const onboard = onboardingRecords.find((record) => record.contactEmail.toLowerCase() === email);
      const department =
        extractByKeys(onboard?.raw || {}, ["department", "dept", "area"]) || onboard?.siteName || "";
      const name = onboard?.mainContact?.trim() || invite.email.split("@")[0] || invite.email;
      return {
        id: invite.id,
        email,
        name,
        role: invite.role,
        siteIds,
        department,
      };
    });
  }, [invitedUsers, userSiteAssignments, onboardingRecords]);

  const documentTrainingApiHeaders = useCallback((): Record<string, string> => {
    if (!currentUser || import.meta.env.PROD) {
      return {};
    }
    if (!canAccessDocumentTraining(currentUser.role)) {
      return {};
    }
    const email = currentUser.username.includes("@")
      ? currentUser.username.toLowerCase()
      : `${currentUser.username}@local.test`;
    return {
      "X-Bert-Dev-User-Role": currentUser.role,
      "X-Bert-Dev-User-Email": email,
      "X-Bert-Dev-User-Name": currentUser.name,
    };
  }, [currentUser]);

  const refreshDocumentTrainingFromServer = useCallback(async () => {
    try {
      const response = await fetch(
        apiUrl(`/api/documents/distributions?workspaceId=${encodeURIComponent(documentTrainingWorkspaceId)}`),
        { credentials: "include", headers: documentTrainingApiHeaders() },
      );
      const payload = (await parseJsonApiResponse(response)) as {
        ok?: boolean;
        distributions?: DocumentDistribution[];
        externalEmployees?: ExternalEmployee[];
        error?: string;
      };
      if (response.ok && payload.ok) {
        if (payload.distributions) {
          setDocumentDistributions(payload.distributions);
        }
        if (payload.externalEmployees) {
          setExternalEmployees(payload.externalEmployees);
        }
      }
    } catch {
      /* keep local workspace cache */
    }
  }, [documentTrainingWorkspaceId, documentTrainingApiHeaders]);

  const handleSaveExternalEmployees = useCallback(
    async (employees: ExternalEmployee[]) => {
      setExternalEmployees(employees);
      try {
        const response = await fetch(apiUrl("/api/documents/external-employees"), {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...documentTrainingApiHeaders() },
          body: JSON.stringify({
            workspaceId: documentTrainingWorkspaceId,
            externalEmployees: employees,
          }),
        });
        const payload = (await parseJsonApiResponse(response)) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          pushToast(
            "Saved locally",
            payload.error || "Employee directory could not be synced to the server yet.",
            "warning",
          );
        }
      } catch {
        pushToast("Saved locally", "Employee directory is stored on this device only.", "warning");
      }
    },
    [documentTrainingWorkspaceId, documentTrainingApiHeaders],
  );

  const handleSendDocumentDistribution = useCallback(
    async (input: {
      title: string;
      fileName: string;
      pdfBase64: string;
      recipients: Array<{ email: string; name: string; source: "onboarded" | "external" }>;
    }) => {
      try {
        const response = await fetch(apiUrl("/api/documents/distributions"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...documentTrainingApiHeaders() },
          body: JSON.stringify({
            workspaceId: documentTrainingWorkspaceId,
            title: input.title,
            fileName: input.fileName,
            pdfBase64: input.pdfBase64,
            recipients: input.recipients,
          }),
        });
        const payload = (await parseJsonApiResponse(response)) as {
          ok?: boolean;
          error?: string;
          distribution?: DocumentDistribution;
          emailErrors?: Array<{ email: string; error: string }>;
        };
        if (!response.ok || !payload.ok) {
          return { ok: false, error: payload.error || "Unable to send document." };
        }
        if (payload.distribution) {
          setDocumentDistributions((current) => [payload.distribution!, ...current.filter((row) => row.id !== payload.distribution!.id)]);
        }
        await refreshDocumentTrainingFromServer();
        return { ok: true, emailErrors: payload.emailErrors };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unable to reach the setup server.",
        };
      }
    },
    [documentTrainingWorkspaceId, documentTrainingApiHeaders, refreshDocumentTrainingFromServer],
  );

  const onboardingPasswordByEmail = useMemo(() => {
    const lookup = new Map<string, string>();
    onboardingRecords.forEach((record) => {
      const email = normalizeIdentity(record.contactEmail);
      const password = extractByKeys(record.raw, ["password", "passcode", "pin", "login"]);
      if (email && password) {
        lookup.set(email, password);
      }
    });
    return lookup;
  }, [onboardingRecords]);

  const loginUsers = useMemo(() => {
    const demoOrDev = import.meta.env.DEV === true || import.meta.env.VITE_ENABLE_DEMO_LOGIN === "true";
    const invitedLoginUsers = invitedUsers.map((invite) => ({
      username: invite.email.toLowerCase(),
      password: demoOrDev
        ? onboardingPasswordByEmail.get(normalizeIdentity(invite.email)) ||
          String(import.meta.env.VITE_DEMO_USER_PASSWORD ?? "").trim()
        : "",
      role: invite.role,
      name: invite.email,
    }));
    const merged = [...users, ...invitedLoginUsers];
    return merged.filter(
      (user, index, list) =>
        list.findIndex((item) => item.username === user.username && item.role === user.role) === index,
    );
  }, [invitedUsers, onboardingPasswordByEmail, users]);

  const availableScheduleAudits = useMemo(() => {
    const templateOptions = templates
      .filter((template) => template.active)
      .map((template) => ({ id: template.id, name: template.name }));
    const auditOptions = audits.map((audit) => ({ id: audit.id, name: audit.name }));
    const merged = [...templateOptions, ...auditOptions];
    return merged.filter((item, index, list) => list.findIndex((entry) => entry.name === item.name) === index);
  }, [templates, audits]);

  const currentUserAuditAccess = useMemo(() => {
    if (!currentUser) {
      return { allowedAuditIds: new Set<string>(), allowedAuditNames: new Set<string>() };
    }
    const normalizedName = normalizeIdentity(currentUser.name);
    const normalizedUsername = normalizeIdentity(currentUser.username);
    const normalizedDefaultEmail = normalizeIdentity(`${currentUser.username}@usebert.co.uk`);
    const legacyDefaultEmail = normalizeIdentity(`${currentUser.username}@qmsprecast.co.uk`);
    const matchingEmails = new Set(
      companyReportUsers
        .filter((user) => {
          const userName = normalizeIdentity(user.name);
          const userEmail = normalizeIdentity(user.email);
          const userEmailLocalPart = normalizeIdentity(user.email.split("@")[0]);
          const userUsername = normalizeIdentity(user.username || "");
          return (
            userName === normalizedName ||
            userEmail === normalizedDefaultEmail ||
            userEmail === legacyDefaultEmail ||
            userEmailLocalPart === normalizedUsername ||
            userUsername === normalizedUsername
          );
        })
        .map((user) => normalizeIdentity(user.email)),
    );
    matchingEmails.add(normalizedDefaultEmail);
    matchingEmails.add(legacyDefaultEmail);

    const allowedAuditIds = new Set<string>();
    Object.entries(auditAccessOverrides).forEach(([key, access]) => {
      const [email, auditId] = key.split("::");
      if (!email || !auditId) return;
      if (access === "No access") return;
      if (!matchingEmails.has(normalizeIdentity(email))) return;
      allowedAuditIds.add(auditId);
    });

    const allowedAuditNames = new Set<string>();
    availableScheduleAudits.forEach((option) => {
      if (allowedAuditIds.has(option.id)) {
        allowedAuditNames.add(option.name);
      }
    });
    return { allowedAuditIds, allowedAuditNames };
  }, [currentUser, companyReportUsers, auditAccessOverrides, availableScheduleAudits]);

  const assignedAudits = useMemo(() => {
    if (!currentUser) {
      return siteScopedAudits.filter((audit) => !isAuditCompleted(audit));
    }
    if (canAccessAdmin(currentUser.role) || currentUser.role === "Manager") {
      return siteScopedAudits.filter((audit) => !isAuditCompleted(audit));
    }
    return siteScopedAudits.filter((audit) => {
      if (isAuditCompleted(audit)) return false;
      if (audit.owner === currentUser.name) return true;
      if (currentUserAuditAccess.allowedAuditIds.has(audit.id)) return true;
      if (currentUserAuditAccess.allowedAuditNames.has(audit.name)) return true;
      return false;
    });
  }, [siteScopedAudits, currentUser, currentUserAuditAccess]);

  const dashboardNextActionInput = useMemo((): DashboardSummaryForNextAction | null => {
    if (!currentUser) return null;
    const actions = visibleActions;
    return {
      overdueAuditCount: assignedAudits.filter((a) => getAuditTrafficStatus(a.dueHours) === "red").length,
      overdueActionCount: actions.filter(isOverdue).length,
      escalatedActionCount: actions.filter(isEscalated).length,
      stuckActionCount: actions.filter(isStuck).length,
      dueTodayAuditCount: assignedAudits.filter((a) => a.dueHours >= 0 && a.dueHours <= 24).length,
      dueTodayActionCount: actions.filter((a) => a.dueHours >= 0 && a.dueHours <= 24 && a.status !== "Closed").length,
      awaitingVerificationCount: actions.filter((a) => a.status === "Awaiting Verification").length,
      openOrInProgressActionCount: actions.filter((a) => a.status === "Open" || a.status === "In Progress").length,
      assignedEvidenceMissingCount: actions.filter(
        (a) =>
          (a.assignedToUserId === currentUser.username || a.assignedToName === currentUser.name) &&
          a.status !== "Closed" &&
          Boolean(a.evidenceRequired) &&
          a.evidenceCount === 0,
      ).length,
      recentCompletionCount: assignmentFilteredHistory.length,
    };
  }, [currentUser, visibleActions, assignedAudits, assignmentFilteredHistory]);

  const dashboardNextBest = useMemo(() => {
    if (!currentUser || !dashboardNextActionInput) return null;
    return getNextBestAction(currentUser.role, dashboardNextActionInput);
  }, [currentUser, dashboardNextActionInput]);

  const workspaceOnboardingIncomplete = useMemo(() => {
    if (!selectedFolder || !workspaceValidation) return false;
    return (
      !workspaceValidation.ok ||
      workspaceValidation.missingTabs.length > 0 ||
      (workspaceValidation.warnings?.length ?? 0) > 0
    );
  }, [selectedFolder, workspaceValidation]);

  const showDashboardStartHere = useMemo(
    () => !selectedFolder || demoModeActive || godCompanySetupOnlyShell || workspaceOnboardingIncomplete,
    [selectedFolder, demoModeActive, godCompanySetupOnlyShell, workspaceOnboardingIncomplete],
  );

  const openIncidentFollowUpsCount = useMemo(
    () => incidentActions.filter((item) => item.status !== "Complete").length,
    [incidentActions],
  );

  const syncPlainSummary = useMemo(() => {
    if (offlineMode) return "Offline";
    if (failedSyncCount > 0) return `${failedSyncCount} sync issue${failedSyncCount === 1 ? "" : "s"}`;
    if (pendingSyncCount > 0 || offlineQueue.length > 0) return "Saving…";
    return "All work saved";
  }, [offlineMode, failedSyncCount, pendingSyncCount, offlineQueue.length]);

  const availableScheduleAuditors = useMemo(() => {
    const seeded = users.filter((user) => user.role === "Auditor").map((user) => user.name);
    const invited = invitedUsers.filter((invite) => invite.role === "Auditor").map((invite) => invite.email);
    return [...seeded, ...invited].filter((item, index, list) => list.indexOf(item) === index);
  }, [invitedUsers]);
  const currentManagerAlerts = useMemo(() => {
    if (!currentUser || currentUser.role !== "Manager") {
      return [];
    }
    const usernameEmailPrimary = `${currentUser.username}@usebert.co.uk`.toLowerCase();
    const usernameEmailLegacy = `${currentUser.username}@qmsprecast.co.uk`.toLowerCase();
    const normalizedName = currentUser.name.toLowerCase();
    return managerAlerts.filter(
      (alert) =>
        (alert.managerNames.some((name) => name.toLowerCase() === normalizedName) ||
          alert.managerEmails.some(
            (email) => email.toLowerCase() === usernameEmailPrimary || email.toLowerCase() === usernameEmailLegacy,
          )) &&
        !alert.readBy.includes(currentUser.username),
    );
  }, [currentUser, managerAlerts]);

  const visibleSchedules = useMemo(() => {
    if (!selectedFolderId) {
      return managedSchedules;
    }

    const companySchedules = managedSchedules.filter((schedule) => schedule.companyFolderId === selectedFolderId);
    if (scheduleListFilter === "All schedules") {
      return companySchedules;
    }
    return companySchedules.filter((schedule) => schedule.lifecycle === scheduleListFilter);
  }, [managedSchedules, scheduleListFilter, selectedFolderId]);

  const auditScheduleMatrix = useMemo<Record<string, AuditScheduleMatrixInfo>>(() => {
    const byAuditId: Record<string, AuditScheduleMatrixInfo> = {};
    const sortedLive = managedSchedules
      .filter((schedule) => schedule.lifecycle === "Live" && (!selectedFolderId || schedule.companyFolderId === selectedFolderId))
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));

    for (const schedule of sortedLive) {
      for (const audit of schedule.audits) {
        if (byAuditId[audit.auditId]) {
          continue;
        }
        byAuditId[audit.auditId] = {
          scheduleName: schedule.scheduleName,
          versionLabel: schedule.versionLabel,
          frequency: audit.frequency,
          days: audit.days,
          liveTime: audit.liveTime,
          completionHours: audit.completionHours,
        };
      }
    }

    return byAuditId;
  }, [managedSchedules, selectedFolderId]);

  const auditAccessMatrix = useMemo<AuditAccessMatrixRow[]>(() => {
    const liveSchedules = managedSchedules.filter(
      (schedule) =>
        schedule.lifecycle === "Live" &&
        (!selectedFolderId || schedule.companyFolderId === selectedFolderId),
    );

    return companyReportUsers.map((user) => {
      const identityTokens = buildIdentityTokens(user);
      const cells = availableScheduleAudits.map((auditOption) => {
        const matchingSchedules = liveSchedules.filter((schedule) =>
          schedule.audits.some(
            (scheduleAudit) =>
              scheduleAudit.auditId === auditOption.id || scheduleAudit.auditName === auditOption.name,
          ),
        );
        const scheduledAssignments = matchingSchedules.filter((schedule) =>
          schedule.auditors.some((auditor) => matchesIdentity(identityTokens, auditor)),
        );
        const directAuditAssignments = audits.filter(
          (audit) =>
            (audit.id === auditOption.id || audit.name === auditOption.name) &&
            matchesIdentity(identityTokens, audit.owner),
        );

        let access: AuditAccessLevel = "No access";
        let detail = "No live assignment";

        if (user.role === "Admin") {
          access = "Full access";
          detail = "Manage, assign, verify, export";
        } else if (user.role === "Manager") {
          access = "Oversight";
          detail = "View, assign, verify";
        } else if (scheduledAssignments.length > 0 || directAuditAssignments.length > 0) {
          access = "Complete";
          detail =
            scheduledAssignments.length > 0
              ? `${scheduledAssignments.length} live schedule${scheduledAssignments.length === 1 ? "" : "s"}`
              : "Direct audit assignment";
        }

        const override = auditAccessOverrides[buildAuditAccessOverrideKey(user.email, auditOption.id)];
        if (override) {
          access = override;
          detail = `Manual override: ${override}`;
        }

        return {
          auditId: auditOption.id,
          auditName: auditOption.name,
          access,
          detail,
          hasAccess: access !== "No access",
        };
      });

      return {
        email: user.email,
        name: user.name,
        role: user.role,
        accessibleCount: cells.filter((cell) => cell.hasAccess).length,
        cells,
      };
    });
  }, [companyReportUsers, availableScheduleAudits, managedSchedules, selectedFolderId, audits, auditAccessOverrides]);

  const handleToggleAuditAccess = (email: string, auditId: string, currentAccess: AuditAccessLevel) => {
    const cycleOrder: AuditAccessLevel[] = ["No access", "Complete", "Oversight", "Full access"];
    const currentIndex = cycleOrder.indexOf(currentAccess);
    const nextAccess = cycleOrder[(currentIndex + 1) % cycleOrder.length];
    setAuditAccessOverrides((current) => ({
      ...current,
      [buildAuditAccessOverrideKey(email, auditId)]: nextAccess,
    }));
  };

  const getSelectedManagersForAudit = (auditId: string) => {
    return auditAccessMatrix
      .filter((row) => row.role === "Manager")
      .filter((row) => row.cells.some((cell) => cell.auditId === auditId && cell.access !== "No access"))
      .map((row) => ({ name: row.name, email: row.email }));
  };

  const notifySelectedManagersForNonCompliance = (
    audit: Audit,
    submittedBy: string,
    nonComplianceCount: number,
    queuedForSync: boolean,
  ) => {
    if (nonComplianceCount <= 0) {
      return;
    }

    const selectedManagers = getSelectedManagersForAudit(audit.id);
    if (selectedManagers.length === 0) {
      return;
    }

    const managerEmails = selectedManagers.map((item) => item.email).filter(Boolean);
    const managerNames = selectedManagers.map((item) => item.name).filter(Boolean);
    const managerLabel = managerNames.length > 0 ? managerNames.join(", ") : managerEmails.join(", ");

    setManagerAlerts((current) => [
      {
        id: `manager-alert-${audit.id}-${Date.now()}`,
        auditId: audit.id,
        auditName: audit.name,
        submittedBy,
        nonComplianceCount,
        queuedForSync,
        createdAt: formatStamp(),
        managerEmails,
        managerNames,
        readBy: [],
      },
      ...current,
    ]);

    pushToast(
      "Manager informed",
      queuedForSync
        ? `Non-compliance found. ${managerLabel} will be alerted when sync completes.`
        : `Non-compliance found. ${managerLabel} have been alerted.`,
      "warning",
    );
    triggerNotification(
      "Manager informed",
      `${audit.name} has ${nonComplianceCount} non-compliance item${nonComplianceCount === 1 ? "" : "s"}.`,
    );

    if (managerEmails.length > 0) {
      void fetch(apiUrl("/api/manager/non-compliance-alert"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          emails: managerEmails,
          auditName: audit.name,
          submittedBy,
          nonComplianceCount,
          queuedForSync,
        }),
      }).catch(() => undefined);
    }
  };

  const markManagerAlertRead = (alertId: string) => {
    if (!currentUser || currentUser.role !== "Manager") {
      return;
    }
    setManagerAlerts((current) =>
      current.map((alert) =>
        alert.id === alertId && !alert.readBy.includes(currentUser.username)
          ? { ...alert, readBy: [...alert.readBy, currentUser.username] }
          : alert,
      ),
    );
  };

  const canSubmitAudit = useMemo(() => {
    if (!activeAudit) {
      return false;
    }
    return activeAudit.questions.every((question) => responses[question.id]);
  }, [activeAudit, responses]);

  const deviceTimeLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: scheduleTimeZone,
      }).format(new Date()),
    [screen, offlineMode, currentUser?.role],
  );
  const shellPreviewClass =
    isDebugUiAllowed() && previewOrientation === "landscape" ? "qms-force-landscape" : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mr = await fetch(apiUrl("/api/auth/master/session"), { credentials: "include" });
        const mp = (await parseJsonApiResponse(mr)) as {
          ok?: boolean;
          operator?: { email: string; name: string };
        };
        if (cancelled) {
          return;
        }
        if (mr.ok && mp.ok && mp.operator) {
          const masterUser: User = {
            username: String(mp.operator.email).toLowerCase(),
            password: "",
            role: "Master",
            name: mp.operator.name || mp.operator.email,
          };
          setCurrentUser(masterUser);
          setAccountNameInput(masterUser.name);
          setAccountPhotoUrl(getStoredProfilePhoto(masterUser));
          try {
            if (window.localStorage.getItem(masterCompanySetupSessionKey) === "1") {
              setGodCompanySetupSession(true);
            } else {
              setGodCompanySetupSession(false);
            }
          } catch {
            setGodCompanySetupSession(false);
          }
          window.localStorage.setItem(userStorageKey, JSON.stringify(masterUser));
          return;
        }
      } catch {
        /* fall through to company session */
      }

      try {
        const cr = await fetch(apiUrl("/api/auth/company/session"), { credentials: "include" });
        const cp = (await parseJsonApiResponse(cr)) as {
          ok?: boolean;
          user?: { email: string; role: Role; name: string };
        };
        if (cancelled) {
          return;
        }
        if (cr.ok && cp.ok && cp.user?.email && cp.user?.role) {
          const companyUser: User = {
            username: String(cp.user.email).toLowerCase(),
            password: "",
            role: cp.user.role,
            name: cp.user.name || cp.user.email,
          };
          setCurrentUser(companyUser);
          setAccountNameInput(companyUser.name);
          setAccountPhotoUrl(getStoredProfilePhoto(companyUser));
          try {
            window.localStorage.removeItem(masterCompanySetupSessionKey);
            setGodCompanySetupSession(false);
          } catch {
            setGodCompanySetupSession(false);
          }
          window.localStorage.setItem(userStorageKey, JSON.stringify(companyUser));
          return;
        }
      } catch {
        /* fall through to localStorage */
      }

      const storedUser = window.localStorage.getItem(userStorageKey);
      if (!storedUser) {
        return;
      }

      try {
        const parsed = JSON.parse(storedUser) as User;
        const matchedUser = loginUsers.find(
          (user) =>
            user.username === parsed.username &&
            user.role === parsed.role &&
            user.name === parsed.name,
        );

        if (matchedUser) {
          setCurrentUser(matchedUser);
          setAccountNameInput(matchedUser.name);
          setAccountPhotoUrl(getStoredProfilePhoto(matchedUser));
          try {
            if (matchedUser.role === "Master" && window.localStorage.getItem(masterCompanySetupSessionKey) === "1") {
              setGodCompanySetupSession(true);
            } else {
              if (matchedUser.role !== "Master") {
                window.localStorage.removeItem(masterCompanySetupSessionKey);
              }
              setGodCompanySetupSession(false);
            }
          } catch {
            setGodCompanySetupSession(false);
          }
        } else if (parsed.role === "Master" && parsed.password === "") {
          window.localStorage.removeItem(userStorageKey);
        } else {
          window.localStorage.removeItem(userStorageKey);
        }
      } catch {
        window.localStorage.removeItem(userStorageKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loginUsers]);

  useEffect(() => {
    const syncSetupPortalFromUrl = () => {
      try {
        setCompanySetupLoginPortal(new URLSearchParams(window.location.search).get("setup") === "master");
      } catch {
        setCompanySetupLoginPortal(false);
      }
      if (isSetupInitialPath()) {
        setScreen((current) => {
          if (currentUser?.role === "Master") {
            return "setupInitial";
          }
          return current;
        });
      }
    };
    syncSetupPortalFromUrl();
    window.addEventListener("popstate", syncSetupPortalFromUrl);
    return () => window.removeEventListener("popstate", syncSetupPortalFromUrl);
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }
    if (screen === "setupInitial" && canAccessGodmodeInitialSetup(currentUser.role)) {
      if (!isSetupInitialPath()) {
        navigateToSetupInitial();
      }
      return;
    }
    if (screen !== "setupInitial" && isSetupInitialPath()) {
      leaveSetupInitialPath("/");
    }
  }, [screen, currentUser]);

  useEffect(() => {
    if (currentUser?.role === "Master" && isSetupInitialPath()) {
      setScreen("setupInitial");
    }
  }, [currentUser]);

  useEffect(() => {
    const storedQueue = window.localStorage.getItem(offlineQueueStorageKey);
    if (!storedQueue) {
      return;
    }

    try {
      setOfflineQueue(JSON.parse(storedQueue) as OfflineSubmission[]);
    } catch {
      window.localStorage.removeItem(offlineQueueStorageKey);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(offlineQueueStorageKey, JSON.stringify(offlineQueue));
  }, [offlineQueue]);

  useEffect(() => {
    window.localStorage.setItem(userProfilePhotosStorageKey, JSON.stringify(userProfilePhotos));
  }, [userProfilePhotos]);

  useEffect(() => {
    window.localStorage.setItem(
      folderLinksStorageKey,
      JSON.stringify({
        folderNameInput,
        folderIdInput,
        auditFormsFolderInput,
        masterSheetInput,
        evidenceFolderInput,
        healthSafetyFolderInput,
        exportsFolderInput,
        adminNotesFolderInput,
      }),
    );
  }, [
    folderNameInput,
    folderIdInput,
    auditFormsFolderInput,
    masterSheetInput,
    evidenceFolderInput,
    healthSafetyFolderInput,
    exportsFolderInput,
    adminNotesFolderInput,
  ]);

  useEffect(() => {
    window.localStorage.setItem(
      workspaceStateStorageKey,
      JSON.stringify({
        audits,
        history,
        actions,
        nonConformances,
        incidents,
        incidentActions,
        schedules,
        templates,
        drafts,
        managedSchedules,
        folders,
        sites,
        selectedSiteId,
        selectedFolderId,
        syncState,
        invitedUsers,
        companySheetSync,
        reportInbox,
        syncQueue,
        auditAccessOverrides,
        managerAlerts,
        roleNavVisibility,
        roleSiteSelectorVisibility,
        userSiteAssignments,
        externalEmployees,
        documentDistributions,
      }),
    );
  }, [
    audits,
    history,
    actions,
    nonConformances,
    incidents,
    incidentActions,
    schedules,
    templates,
    drafts,
    managedSchedules,
    folders,
    sites,
    selectedSiteId,
    selectedFolderId,
    syncState,
    invitedUsers,
    companySheetSync,
    reportInbox,
    syncQueue,
    auditAccessOverrides,
    managerAlerts,
    roleNavVisibility,
    roleSiteSelectorVisibility,
    userSiteAssignments,
    externalEmployees,
    documentDistributions,
  ]);

  useEffect(() => {
    if (screen === "documentTraining" && currentUser && canAccessDocumentTraining(currentUser.role)) {
      void refreshDocumentTrainingFromServer();
    }
  }, [screen, currentUser, refreshDocumentTrainingFromServer]);

  useEffect(() => {
    const handleOnline = () => setOfflineMode(false);
    const handleOffline = () => setOfflineMode(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if ("Notification" in window) {
      setNotificationsEnabled(Notification.permission === "granted");
    }
  }, []);

  useEffect(() => {
    const derivedSites = deriveSitesFromWorkspace(audits, schedules, managedSchedules);
    setSites((current) => {
      const merged = [...current];
      derivedSites.forEach((site) => {
        if (!merged.some((item) => normalizeIdentity(item.name) === normalizeIdentity(site.name))) {
          merged.push(site);
        }
      });
      return merged;
    });
  }, [audits, schedules, managedSchedules]);

  useEffect(() => {
    if (!selectedSiteId) return;
    const allowedIds = new Set(headerSelectableSites.map((site) => site.id));
    if (!allowedIds.has(selectedSiteId)) {
      setSelectedSiteId(headerSelectableSites[0]?.id ?? "");
    }
  }, [selectedSiteId, headerSelectableSites]);

  useEffect(() => {
    window.localStorage.setItem(themeStorageKey, themeMode);
  }, [themeMode]);

  const incidentEscalationSeverities: IncidentSeverity[] = ["Lost Time Injury", "Major Incident", "Fatality"];

  const generateIncidentNumber = (incidentDate: string) => {
    const year = (incidentDate || new Date().toISOString().slice(0, 10)).slice(0, 4) || String(new Date().getFullYear());
    const existingNumbers = incidents
      .map((item) => item.incidentId)
      .filter((value) => value.startsWith(`INC-${year}-`))
      .map((value) => Number(value.split("-")[2] || 0))
      .filter((value) => Number.isFinite(value));
    const next = (existingNumbers.length ? Math.max(...existingNumbers) : 0) + 1;
    return `INC-${year}-${String(next).padStart(3, "0")}`;
  };

  const sendIncidentNotification = async (incident: IncidentRecord) => {
    const response = await fetch(apiUrl("/api/incidents/notify"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incidentId: incident.incidentId,
        incidentType: incident.incidentType,
        severity: incident.severity,
        reporter: incident.reporterName,
        department: incident.department,
        location: incident.location,
        status: incident.status,
        incidentDate: incident.incidentDate,
        incidentTime: incident.incidentTime,
        priority: incident.priority,
        escalated: incident.priority === "High",
        viewLink: `${window.location.origin}/?screen=incidents&id=${encodeURIComponent(incident.id)}`,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      throw new Error(result.error || "Incident notification could not be sent.");
    }
  };

  const submitIncidentReport = async (payload: {
    incidentType: IncidentType;
    severity: IncidentSeverity;
    incidentDate: string;
    incidentTime: string;
    reporterName: string;
    reporterEmail: string;
    department: string;
    location: string;
    description: string;
    immediateAction: string;
    injured: boolean;
    injuryDetails: string;
    contributingFactors: string;
    witnesses: string;
    evidenceUrls: IncidentEvidenceItem[];
  }) => {
    if (!currentUser) {
      throw new Error("You must be signed in to submit incidents.");
    }
    if (!payload.incidentType || !payload.severity || !payload.incidentDate || !payload.reporterName || !payload.department || !payload.location || !payload.description) {
      throw new Error("Complete all required incident fields before submitting.");
    }
    if (payload.injured && !payload.injuryDetails.trim()) {
      throw new Error("Injury details are required when an injury is reported.");
    }

    const now = new Date().toISOString();
    const incidentId = generateIncidentNumber(payload.incidentDate);
    const highPriority = incidentEscalationSeverities.includes(payload.severity);
    const assignedTo = highPriority
      ? users.find((user) => user.role === "Master")?.name || "System Setup"
      : users.find((user) => user.role === "Manager")?.name || "Unassigned";

    const incident: IncidentRecord = {
      id: `incident-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      incidentId,
      status: "Open",
      priority: highPriority ? "High" : "Normal",
      incidentType: payload.incidentType,
      severity: payload.severity,
      incidentDate: payload.incidentDate,
      incidentTime: payload.incidentTime,
      reporterName: payload.reporterName,
      reporterEmail: payload.reporterEmail,
      department: payload.department,
      location: payload.location,
      description: payload.description,
      immediateAction: payload.immediateAction,
      injured: payload.injured,
      injuryDetails: payload.injuryDetails,
      contributingFactors: payload.contributingFactors,
      witnesses: payload.witnesses,
      evidenceUrls: payload.evidenceUrls,
      assignedTo,
      investigationNotes: "",
      rootCause: "",
      correctiveActions: "",
      preventiveActions: "",
      actionOwner: "",
      dueDate: "",
      completionDate: "",
      riddorRequired: false,
      closedBy: "",
      closedAt: "",
      notificationStatus: "Pending",
      statusHistory: [{ at: now, from: "", to: "Open", by: currentUser.name, note: "Incident submitted" }],
      createdAt: now,
      createdBy: currentUser.name,
      updatedAt: now,
      updatedBy: currentUser.name,
    };

    setIncidents((current) => [incident, ...current]);

    try {
      await sendIncidentNotification(incident);
      setIncidents((current) => current.map((item) => (item.id === incident.id ? { ...item, notificationStatus: highPriority ? "Escalated notification sent" : "Notification sent" } : item)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Notification failed.";
      setIncidents((current) => current.map((item) => (item.id === incident.id ? { ...item, notificationStatus: `Failed: ${message}` } : item)));
      pushToast("Notification failed", message, "warning");
    }

    return incident;
  };

  const updateIncidentRecord = (incidentId: string, patch: Partial<IncidentRecord>, options?: { statusNote?: string }) => {
    if (!currentUser) return;
    const at = new Date().toISOString();
    setIncidents((current) =>
      current.map((item) => {
        if (item.id !== incidentId) return item;
        const nextStatus = (patch.status || item.status) as IncidentStatus;
        const statusChanged = nextStatus !== item.status;
        const nextHistory = statusChanged
          ? [...item.statusHistory, { at, from: item.status, to: nextStatus, by: currentUser.name, note: options?.statusNote || `Status changed to ${nextStatus}` }]
          : item.statusHistory;
        return { ...item, ...patch, statusHistory: nextHistory, updatedAt: at, updatedBy: currentUser.name };
      }),
    );
  };

  const addIncidentCorrectiveAction = (incidentId: string, payload: { description: string; owner: string; dueDate: string }) => {
    if (!currentUser) return;
    if (!payload.description.trim() || !payload.owner.trim()) {
      throw new Error("Corrective action description and owner are required.");
    }
    setIncidentActions((current) => [
      {
        id: `incident-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        incidentId,
        description: payload.description.trim(),
        owner: payload.owner.trim(),
        dueDate: payload.dueDate,
        status: "Open",
        completedAt: "",
        completedBy: "",
      },
      ...current,
    ]);
  };

  const updateIncidentCorrectiveAction = (actionId: string, patch: Partial<IncidentCorrectiveAction>) => {
    if (!currentUser) return;
    setIncidentActions((current) =>
      current.map((item) => {
        if (item.id !== actionId) return item;
        const next = { ...item, ...patch };
        if (next.status === "Complete" && !next.completedAt) {
          next.completedAt = new Date().toISOString();
          next.completedBy = currentUser.name;
        }
        return next;
      }),
    );
  };

  useEffect(() => {
    window.localStorage.setItem(previewOrientationStorageKey, previewOrientation);
  }, [previewOrientation]);

  useEffect(() => {
    try {
      window.localStorage.setItem(desktopSidebarCollapsedStorageKey, String(desktopSidebarCollapsed));
    } catch {
      // Ignore storage write failures.
    }
  }, [desktopSidebarCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(dashboardPreferencesStorageKey, JSON.stringify(dashboardPreferences));
    } catch {
      // Ignore storage write failures.
    }
  }, [dashboardPreferences]);

  useEffect(() => {
    try {
      window.localStorage.setItem(dashboardSectionOrderStorageKey, JSON.stringify(dashboardSectionOrder));
    } catch {
      // Ignore storage write failures.
    }
  }, [dashboardSectionOrder]);

  useEffect(() => {
    if (offlineMode || offlineQueue.length === 0) {
      return;
    }

    const queued = [...offlineQueue];
    const offlineSubmittedByFallback: User = {
      username: "offline-sync",
      password: "",
      role: "Auditor",
      name: "Offline submission",
    };
    queued
      .slice()
      .reverse()
      .forEach((submission) => {
        applyAuditSubmission({
          audit: submission.audit,
          responseMap: submission.responses,
          noteMap: submission.notes,
          evidenceMap: submission.evidence,
          submittedBy: submission.submittedBy,
          submittedByUser:
            users.find((item) => item.name === submission.submittedBy) ||
            ({
              ...offlineSubmittedByFallback,
              name: submission.submittedBy?.trim() || offlineSubmittedByFallback.name,
              username: submission.submittedBy?.trim()
                ? submission.submittedBy.trim().toLowerCase().replace(/\s+/g, "-")
                : offlineSubmittedByFallback.username,
            } as User),
          completedAt: submission.queuedAt,
        });
        updateSyncItemStatus(submission.audit.id, "Synced");
      });

    setOfflineQueue([]);
    pushToast("Offline sync complete", `${queued.length} queued audit submission${queued.length === 1 ? "" : "s"} synced successfully.`, "success");
    triggerNotification("Offline sync complete", `${queued.length} queued audit submission${queued.length === 1 ? "" : "s"} synced.`);
  }, [offlineMode, offlineQueue]);

  useEffect(() => {
    if (!notificationsEnabled || overdueActions.length === 0) {
      return;
    }
    triggerNotification("Overdue actions need attention", `${overdueActions.length} corrective action${overdueActions.length === 1 ? "" : "s"} are overdue.`);
  }, [notificationsEnabled, overdueActions.length]);

  useEffect(() => {
    if (!selectedFolderId || syncState !== "Synced") {
      return;
    }
    if (!actionsPersistReadyRef.current) {
      actionsPersistReadyRef.current = true;
      return;
    }
    const nextActions = actions.filter((item) => item.companyId === selectedFolderId);
    queueSyncItem({
      itemType: "actionUpdate",
      localId: `actions-batch-${selectedFolderId}`,
      status: googleConnected && !offlineMode ? "Syncing" : "Pending Sync",
      createdAt: formatStamp(),
      retryCount: 0,
      lastError: "",
      payload: { companyFolderId: selectedFolderId, count: nextActions.length },
    });
    if (!googleConnected || offlineMode) {
      return;
    }
    void persistActions(selectedFolderId, nextActions)
      .then(() => updateSyncItemStatus(`actions-batch-${selectedFolderId}`, "Synced"))
      .catch((error) => updateSyncItemStatus(`actions-batch-${selectedFolderId}`, "Failed", error instanceof Error ? error.message : "Unable to save actions."));
  }, [actions, selectedFolderId, syncState, googleConnected, offlineMode]);

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setToasts((current) => current.slice(1));
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    if (creatableRoles.length === 0) {
      return;
    }
    if (!creatableRoles.includes(inviteRoleInput)) {
      setInviteRoleInput(creatableRoles[0]);
    }
  }, [creatableRoles, inviteRoleInput]);

  useEffect(() => {
    if (!googleConnected || !selectedFolderId) {
      return;
    }
    if (
      folderIdInput.trim() ||
      auditFormsFolderInput.trim() ||
      masterSheetInput.trim() ||
      evidenceFolderInput.trim() ||
      healthSafetyFolderInput.trim() ||
      exportsFolderInput.trim() ||
      adminNotesFolderInput.trim()
    ) {
      return;
    }
    if (folderInspection?.folder.id === selectedFolderId) {
      return;
    }
    void inspectFolderById(selectedFolderId, { silent: true });
  }, [
    googleConnected,
    selectedFolderId,
    folderIdInput,
    auditFormsFolderInput,
    masterSheetInput,
    evidenceFolderInput,
    healthSafetyFolderInput,
    exportsFolderInput,
    adminNotesFolderInput,
  ]);

  const pushToast = (title: string, message: string, tone: Toast["tone"] = "neutral") => {
    setToasts((current) => [
      ...current,
      { id: Date.now() + Math.floor(Math.random() * 1000), title, message, tone },
    ]);
  };

  const queueSyncItem = (item: Omit<SyncQueueItem, "id" | "updatedAt">) => {
    setSyncQueue((current) => [
      {
        ...item,
        id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        updatedAt: formatStamp(),
      },
      ...current,
    ]);
  };

  const updateSyncItemStatus = (localId: string, status: SyncStatus, lastError = "") => {
    const stamp = formatStamp();
    setSyncQueue((current) =>
      current.map((item) =>
        item.localId === localId
          ? {
              ...item,
              status,
              lastError,
              attemptedAt:
                status === "Syncing" || status === "Failed" || status === "Conflict" ? stamp : item.attemptedAt,
              retryCount: status === "Failed" ? item.retryCount + 1 : item.retryCount,
              updatedAt: stamp,
            }
          : item,
      ),
    );
  };

  const loadGoogleStatus = async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setGoogleStatusLoading(true);
    }

    try {
      const response = await fetch(apiUrl("/api/google/status"), { credentials: "include" });
      const payload = (await response.json()) as GoogleBackendStatus;

      setBackendConfigured(Boolean(payload.configured));
      setGoogleConnected(Boolean(payload.connected));
      setSharedDriveId(payload.sharedDriveId || "");
      setOnboardingSource(payload.onboardingSource ?? null);

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Unable to check the Google connection.");
      }

      if (payload.connected && payload.companies) {
        setFolders(payload.companies);
        if (!selectedFolderId && payload.companies[0]) {
          setSelectedFolderId(payload.companies[0].id);
        }
      }
    } catch (error) {
      if (!options?.silent) {
        pushToast(
          "Setup server unavailable",
          error instanceof Error ? error.message : "Unable to reach the setup server. Check your network and try again.",
          "warning",
        );
      }
    } finally {
      if (!options?.silent) {
        setGoogleStatusLoading(false);
      }
    }
  };

  const loadOnboardingRecords = async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setOnboardingRecordsLoading(true);
    }

    try {
      const response = await fetch(apiUrl("/api/onboarding/submissions"), { credentials: "include" });
      const payload = (await response.json()) as OnboardingSubmissionsResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Unable to load onboarding submissions.");
      }

      setOnboardingSource(payload.onboardingSource ?? null);
      setOnboardingRecords(payload.records ?? []);
      if (!selectedOnboardingRecordId && payload.records?.[0]) {
        setSelectedOnboardingRecordId(payload.records[0].id);
      }
    } catch (error) {
      if (!options?.silent) {
        pushToast(
          "Company sign-up list unavailable",
          error instanceof Error ? error.message : "Unable to load company sign-up responses.",
          "warning",
        );
      }
    } finally {
      if (!options?.silent) {
        setOnboardingRecordsLoading(false);
      }
    }
  };

  const loadCompanySheet = async (folderId: string, options?: { silent?: boolean }) => {
    try {
      const response = await fetch(apiUrl(`/api/company-sheet/${encodeURIComponent(folderId)}`), { credentials: "include" });
      const payload = (await response.json()) as CompanySheetPayload;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Unable to load the company master sheet.");
      }

      const nextInvites = parseCompanySheetUsers(payload.data.Users ?? []);
      const nextSchedules = parseCompanySheetSchedules(payload.data.Schedule ?? [], folderId);
      setCompanySheetSync({
        sheetId: payload.sheetId,
        sheetName: payload.sheetName,
        tabs: payload.tabs,
        usersCount: payload.data.Users?.length ?? 0,
        schedulesCount: payload.data.Schedule?.length ?? 0,
        onboardingCount: payload.data.Onboarding?.length ?? 0,
        actionsCount: payload.data.Actions?.length ?? 0,
        notesCount: payload.data.Notes?.length ?? 0,
        findingsCount: payload.data.AuditFindings?.length ?? 0,
        evidenceCount: payload.data.Evidence?.length ?? 0,
        reportsCount: payload.data.Reports?.length ?? 0,
        configCount: payload.data.Config?.length ?? 0,
        lastSyncedAt: formatStamp(),
      });

      setInvitedUsers((current) => {
        const existingIds = new Set(current.map((item) => `${item.email}-${item.role}`));
        const merged = [...current];
        nextInvites.forEach((invite) => {
          const key = `${invite.email}-${invite.role}`;
          if (!existingIds.has(key)) {
            merged.push(invite);
          }
        });
        return merged;
      });

      setSchedules((current) => {
        const remaining = current.filter((item) => item.companyFolderId !== folderId);
        return [...remaining, ...nextSchedules];
      });
      setManagedSchedules((current) => {
        const remaining = current.filter((item) => item.companyFolderId !== folderId);
        return [...remaining, ...parseManagedSchedules(payload.data.Schedule ?? [], folderId).map((item) => ({ ...item, healthState: computeScheduleHealthState(item) }))];
      });
      setActions((current) => {
        const remaining = current.filter((item) => item.companyId !== folderId);
        return [...remaining, ...parseCompanySheetActions(payload.data.Actions ?? [], folderId)];
      });

      return payload;
    } catch (error) {
      setCompanySheetSync(null);
      if (!options?.silent) {
        pushToast(
          "Company sheet unavailable",
          error instanceof Error ? error.message : "Unable to load company master sheet data.",
          "warning",
        );
      }
      return null;
    }
  };

  const loadCompanySheetById = async (
    sheetId: string,
    companyFolderId: string,
    options?: { silent?: boolean },
  ) => {
    try {
      const response = await fetch(apiUrl(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}`), { credentials: "include" });
      const payload = (await response.json()) as CompanySheetPayload;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Unable to load the company master sheet.");
      }

      const nextInvites = parseCompanySheetUsers(payload.data.Users ?? []);
      const nextSchedules = parseCompanySheetSchedules(payload.data.Schedule ?? [], companyFolderId);
      setCompanySheetSync({
        sheetId: payload.sheetId,
        sheetName: payload.sheetName,
        tabs: payload.tabs,
        usersCount: payload.data.Users?.length ?? 0,
        schedulesCount: payload.data.Schedule?.length ?? 0,
        onboardingCount: payload.data.Onboarding?.length ?? 0,
        actionsCount: payload.data.Actions?.length ?? 0,
        notesCount: payload.data.Notes?.length ?? 0,
        findingsCount: payload.data.AuditFindings?.length ?? 0,
        evidenceCount: payload.data.Evidence?.length ?? 0,
        reportsCount: payload.data.Reports?.length ?? 0,
        configCount: payload.data.Config?.length ?? 0,
        lastSyncedAt: formatStamp(),
      });

      setInvitedUsers((current) => {
        const existingIds = new Set(current.map((item) => `${item.email}-${item.role}`));
        const merged = [...current];
        nextInvites.forEach((invite) => {
          const key = `${invite.email}-${invite.role}`;
          if (!existingIds.has(key)) {
            merged.push(invite);
          }
        });
        return merged;
      });

      setSchedules((current) => {
        const remaining = current.filter((item) => item.companyFolderId !== companyFolderId);
        return [...remaining, ...nextSchedules];
      });
      setManagedSchedules((current) => {
        const remaining = current.filter((item) => item.companyFolderId !== companyFolderId);
        return [...remaining, ...parseManagedSchedules(payload.data.Schedule ?? [], companyFolderId).map((item) => ({ ...item, healthState: computeScheduleHealthState(item) }))];
      });
      setActions((current) => {
        const remaining = current.filter((item) => item.companyId !== companyFolderId);
        return [...remaining, ...parseCompanySheetActions(payload.data.Actions ?? [], companyFolderId)];
      });

      return payload;
    } catch (error) {
      if (!options?.silent) {
        pushToast(
          "Company sheet unavailable",
          error instanceof Error ? error.message : "Unable to load the company master sheet.",
          "warning",
        );
      }
      return null;
    }
  };

  const triggerNotification = (title: string, body: string) => {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }

    new Notification(title, { body });
  };

  const requestNotificationAccess = async () => {
    if (!("Notification" in window)) {
      pushToast("Notifications unavailable", "This browser does not support system notifications.", "warning");
      return;
    }

    const permission = await Notification.requestPermission();
    const granted = permission === "granted";
    setNotificationsEnabled(granted);
    pushToast(
      granted ? "Notifications enabled" : "Notifications blocked",
      granted ? `${companyName} can now send live browser alerts.` : "Enable browser notifications to receive live alerts.",
      granted ? "success" : "warning",
    );
  };

  const inspectFolderById = async (folderId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setFolderInspectionLoading(true);
    }

    try {
      const response = await fetch(apiUrl(`/api/company-folder/${encodeURIComponent(folderId)}`), { credentials: "include" });
      const payload = (await response.json()) as FolderInspection;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Unable to inspect the company folder.");
      }

      setFolderInspection(payload);
      return payload;
    } catch (error) {
      setFolderInspection(null);
      if (!options?.silent) {
        pushToast(
          "Folder check failed",
          error instanceof Error ? error.message : "Unable to inspect the company folder.",
          "warning",
        );
      }
      return null;
    } finally {
      if (!options?.silent) {
        setFolderInspectionLoading(false);
      }
    }
  };

  const validateWorkspace = async (options?: { silent?: boolean }) => {
    const sheetId = extractGoogleResourceId(masterSheetInput) || companySheetSync?.sheetId || selectedFolder?.responseSheetId || "";
    const companyFolderId = extractGoogleResourceId(folderIdInput) || selectedFolder?.id || "";
    if (!sheetId || !companyFolderId) {
      return null;
    }
    if (!options?.silent) {
      setWorkspaceValidationLoading(true);
    }
    try {
      const response = await fetch(apiUrl(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/validate`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyFolderId,
          auditFormsFolderId: extractGoogleResourceId(auditFormsFolderInput),
          evidenceFolderId: extractGoogleResourceId(evidenceFolderInput),
          healthSafetyFolderId: extractGoogleResourceId(healthSafetyFolderInput),
          exportsFolderId: extractGoogleResourceId(exportsFolderInput),
          adminNotesFolderId: extractGoogleResourceId(adminNotesFolderInput),
        }),
      });
      const payload = (await response.json()) as WorkspaceValidation & { error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Unable to check the workspace.");
      }
      setWorkspaceValidation(payload);
      return payload;
    } catch (error) {
      if (!options?.silent) {
        pushToast("Check workspace failed", error instanceof Error ? error.message : "Unable to check the workspace.", "warning");
      }
      return null;
    } finally {
      if (!options?.silent) {
        setWorkspaceValidationLoading(false);
      }
    }
  };

  const repairWorkspace = async () => {
    const sheetId = extractGoogleResourceId(masterSheetInput) || companySheetSync?.sheetId || selectedFolder?.responseSheetId || "";
    const companyFolderId = extractGoogleResourceId(folderIdInput) || selectedFolder?.id || "";
    if (!sheetId || !companyFolderId) {
      pushToast("Workspace link required", "Link a company folder and Company Master Sheet before running Fix workspace.", "warning");
      return;
    }
    setWorkspaceValidationLoading(true);
    try {
      const response = await fetch(apiUrl(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/repair`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyFolderId,
          auditFormsFolderId: extractGoogleResourceId(auditFormsFolderInput),
          evidenceFolderId: extractGoogleResourceId(evidenceFolderInput),
          healthSafetyFolderId: extractGoogleResourceId(healthSafetyFolderInput),
          exportsFolderId: extractGoogleResourceId(exportsFolderInput),
          adminNotesFolderId: extractGoogleResourceId(adminNotesFolderInput),
        }),
      });
      const payload = (await response.json()) as { ok: boolean; validation: WorkspaceValidation; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Unable to fix the workspace.");
      }
      setWorkspaceValidation(payload.validation);
      pushToast("Workspace updated", "Missing tabs and columns were added safely with a backup copy created first.", "success");
    } catch (error) {
      pushToast("Fix workspace failed", error instanceof Error ? error.message : "Unable to fix the workspace.", "warning");
    } finally {
      setWorkspaceValidationLoading(false);
    }
  };

  const loadGoogleFile = async (fileId: string) => {
    const response = await fetch(apiUrl(`/api/google-file/${encodeURIComponent(fileId)}`), { credentials: "include" });
    const payload = (await response.json()) as GoogleDriveFilePayload;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Unable to load the Google Drive item.");
    }
    return payload.file;
  };

  const loadFormsFolder = async (folderId: string) => {
    const response = await fetch(apiUrl(`/api/google-forms-folder/${encodeURIComponent(folderId)}`), { credentials: "include" });
    const payload = (await response.json()) as GoogleFormsFolderPayload;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Unable to load the audit forms folder.");
    }
    return payload;
  };

  const formatStamp = () =>
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: scheduleTimeZone,
    }).format(new Date());

  const handleLogin = async () => {
    const loginIdentity = username.trim().toLowerCase();
    const pwd = password;

    const applySignedInUser = (match: User, options?: { workspaceSetupOnly?: boolean }) => {
      if (companySetupLoginPortal && match.role !== "Master") {
        pushToast("Master only", "Company setup sign-in is only for the workspace setup (Master) account.", "warning");
        return;
      }
      const workspaceSetupShell =
        match.role === "Master" && (companySetupLoginPortal || options?.workspaceSetupOnly === true);
      try {
        if (match.role === "Master") {
          if (workspaceSetupShell) {
            window.localStorage.setItem(masterCompanySetupSessionKey, "1");
            setGodCompanySetupSession(true);
          } else {
            window.localStorage.removeItem(masterCompanySetupSessionKey);
            setGodCompanySetupSession(false);
          }
        } else {
          window.localStorage.removeItem(masterCompanySetupSessionKey);
          setGodCompanySetupSession(false);
        }
      } catch {
        setGodCompanySetupSession(false);
      }
      setCurrentUser(match);
      setAccountNameInput(match.name);
      setAccountPhotoUrl(getStoredProfilePhoto(match));
      window.localStorage.setItem(userStorageKey, JSON.stringify(match));
      setScreen(
        isSetupInitialPath() && canAccessGodmodeInitialSetup(match.role)
          ? "setupInitial"
          : getHomeScreenForRole(match.role),
      );
      setUsername("");
      setPassword("");
      setCompanySetupLoginPortal(false);
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("setup");
        window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
      } catch {
        window.history.replaceState({}, "", window.location.pathname);
      }
      pushToast("Welcome back", `Signed in as ${getRoleDisplayName(match.role)}.`, "success");
    };

    const persistedMasterSheetId = companySheetSync?.sheetId || extractGoogleResourceId(masterSheetInput) || "";
    const masterFailureGuidesUx = companySetupLoginPortal || !persistedMasterSheetId;
    let masterGuidedFailure: null | "auth" | "network" = null;

    const tryServerMasterLogin = async (): Promise<boolean> => {
      if (!pwd || !loginIdentity) {
        return false;
      }
      let response: Response;
      try {
        response = await fetch(apiUrl("/api/auth/master/login"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: loginIdentity.includes("@") ? loginIdentity : undefined,
            username: loginIdentity,
            password: pwd,
          }),
        });
      } catch {
        if (masterFailureGuidesUx) {
          masterGuidedFailure = "network";
        }
        return false;
      }
      let data: { ok?: boolean; operator?: { email: string; name: string }; error?: string };
      try {
        const text = (await response.text()).trim();
        data = text ? (JSON.parse(text) as typeof data) : {};
      } catch {
        if (masterFailureGuidesUx) {
          masterGuidedFailure = "network";
        }
        return false;
      }
      if (!response.ok || !data.ok || !data.operator) {
        if (masterFailureGuidesUx) {
          if (response.status === 401 || response.status === 403) {
            masterGuidedFailure = "auth";
          } else if (response.status >= 400 && response.status < 500) {
            masterGuidedFailure = "auth";
          } else {
            masterGuidedFailure = "network";
          }
        }
        return false;
      }
      const match: User = {
        username: String(data.operator.email).toLowerCase(),
        password: "",
        role: "Master",
        name: data.operator.name || data.operator.email,
      };
      applySignedInUser(match, { workspaceSetupOnly: companySetupLoginPortal });
      return true;
    };

    const tryServerCompanyLogin = async (): Promise<boolean> => {
      if (!pwd || !loginIdentity.includes("@")) {
        return false;
      }
      const masterSheetId = companySheetSync?.sheetId || extractGoogleResourceId(masterSheetInput) || "";
      if (!masterSheetId) {
        return false;
      }
      try {
        const response = await fetch(apiUrl("/api/auth/company/login"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: loginIdentity, password: pwd, masterSheetId }),
        });
        const data = (await parseJsonApiResponse(response)) as {
          ok?: boolean;
          user?: { email: string; role: Role; name: string };
          error?: string;
        };
        if (!response.ok || !data.ok || !data.user?.email || !data.user?.role) {
          return false;
        }
        const match: User = {
          username: String(data.user.email).toLowerCase(),
          password: "",
          role: data.user.role,
          name: data.user.name || data.user.email,
        };
        applySignedInUser(match);
        return true;
      } catch {
        return false;
      }
    };

    const findClientMatch = (): User | undefined =>
      loginUsers.find((user) => {
        if (user.password !== pwd) {
          return false;
        }
        if (user.username === loginIdentity) {
          return true;
        }
        if (normalizeIdentity(user.username) === normalizeIdentity(loginIdentity)) {
          return true;
        }
        if (
          `${user.username}@usebert.co.uk` === loginIdentity ||
          `${user.username}@qmsprecast.co.uk` === loginIdentity
        ) {
          return true;
        }
        return false;
      });

    if (isDemoLoginEnabled) {
      const clientMatch = findClientMatch();
      if (clientMatch) {
        applySignedInUser(clientMatch);
        return;
      }
      if (await tryServerMasterLogin()) {
        return;
      }
      if (await tryServerCompanyLogin()) {
        return;
      }
    } else {
      if (await tryServerMasterLogin()) {
        return;
      }
      if (await tryServerCompanyLogin()) {
        return;
      }
      const clientMatch = findClientMatch();
      if (clientMatch) {
        applySignedInUser(clientMatch);
        return;
      }
    }

    if (masterGuidedFailure === "auth") {
      pushToast("Sign in failed", "Email, username, or password is incorrect.", "warning");
      return;
    }
    if (masterGuidedFailure === "network") {
      pushToast(
        "Sign in failed",
        "BERT cannot reach the setup server. Check your internet connection or contact BERT support.",
        "warning",
      );
      return;
    }

    if (isDemoLoginEnabled && users.length === 0 && !DEMO_USER_PASSWORD && !GODMODE_PASSWORD) {
      pushToast(
        "Demo sign-in not configured",
        "Add VITE_DEMO_USER_PASSWORD (and optional VITE_GODMODE_PASSWORD) to .env.local, then restart npm run dev. Or sign in with a seeded Master email via npm run dev:full.",
        "warning",
      );
      return;
    }

    pushToast("Sign in failed", "Please check your username and password.", "warning");
  };

  const switchUserSession = (user: User) => {
    if (user.role !== "Master") {
      try {
        window.localStorage.removeItem(masterCompanySetupSessionKey);
      } catch {
        /* ignore */
      }
      setGodCompanySetupSession(false);
    }
    setCurrentUser(user);
    setAccountNameInput(user.name);
    setAccountPhotoUrl(getStoredProfilePhoto(user));
    window.localStorage.setItem(userStorageKey, JSON.stringify(user));
    setScreen(getHomeScreenForRole(user.role));
    pushToast("Profile switched", `Now viewing as ${getRoleDisplayName(user.role)}.`, "success");
  };

  const createRoleFallbackUser = (role: Role): User => {
    const suffix = role.toLowerCase();
    const uuid =
      typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : String(Date.now());
    const demoPw = String(import.meta.env.VITE_DEMO_USER_PASSWORD ?? "").trim();
    const previewPassword =
      import.meta.env.DEV === true || import.meta.env.VITE_ENABLE_DEMO_LOGIN === "true"
        ? demoPw || `preview-${uuid}`
        : `preview-${uuid}`;
    return {
      username: `quick-${suffix}`,
      password: previewPassword,
      role,
      name:
        role === "Master"
          ? "System Setup"
          : role === "Admin"
            ? "Audit Control"
            : role === "Manager"
              ? "Manager View"
              : "Auditor View",
    };
  };

  const handleQuickRoleSwitch = (role: Role, fallbackLabel: string) => {
    const existingUser = loginUsers.find((user) => user.role === role);
    if (existingUser) {
      switchUserSession(existingUser);
      return;
    }
    if (!canCreatePreviewProfile()) {
      pushToast("Profile missing", `No ${fallbackLabel} profile is available yet.`, "warning");
      return;
    }
    const fallbackUser = createRoleFallbackUser(role);
    if (demoRoleSwitchEnabled) {
      pushToast("Using preview profile", `${fallbackLabel} view opened with a temporary profile.`, "success");
    }
    switchUserSession(fallbackUser);
  };

  const handleToggleRoleNavVisibility = (role: Role, navItemId: NavItemId) => {
    if (navItemId === "dashboard" || navItemId === "account" || navItemId === "incidents") {
      return;
    }
    if (!canRoleAccessNavItem(role, navItemId)) {
      return;
    }
    setRoleNavVisibility((current) => ({
      ...current,
      [role]: {
        ...current[role],
        [navItemId]: !(current[role]?.[navItemId] ?? true),
      },
    }));
  };

  const handleToggleRoleSiteSelectorVisibility = (role: Role) => {
    setRoleSiteSelectorVisibility((current) => ({
      ...current,
      [role]: !(current[role] ?? true),
    }));
  };

  const handleSendGodModeAppCompanyInvite = async () => {
    if (!currentUser || (currentUser.role !== "Master" && currentUser.role !== "Admin")) {
      return;
    }
    if (!backendConfigured || !googleConnected) {
      pushToast(
        "Google Workspace needs setup",
        "Connect Google in Initial Setup before provisioning a company.",
        "warning",
      );
      return;
    }
    const trimmed = godModeAppInviteEmail.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      pushToast("Email required", "Enter a valid email address for the new company administrator.", "warning");
      return;
    }
    setCompanyOnboardingEmailSending(true);
    try {
      const response = await fetch(apiUrl("/api/onboarding/app-invites/new-company"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const payload = (await parseJsonApiResponse(response)) as {
        ok?: boolean;
        error?: string;
        sent?: boolean;
        smtpConfigured?: boolean;
        email?: string;
        senderEmail?: string;
        onboardingFormUrl?: string;
        emailDraft?: { subject: string; body: string };
        mailtoUrl?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Unable to send onboarding email.");
      }
      const result = {
        email: payload.email || trimmed,
        sent: payload.sent === true,
        smtpConfigured: payload.smtpConfigured !== false,
        senderEmail: payload.senderEmail || "admin@usebert.co.uk",
        onboardingFormUrl: payload.onboardingFormUrl || "",
        emailDraft: payload.emailDraft,
        mailtoUrl: payload.mailtoUrl,
      };
      setCompanyOnboardingEmailResult(result);
      if (result.sent) {
        pushToast("Onboarding email sent", `We sent the company onboarding form to ${result.email}.`, "success");
      }
    } catch (error) {
      setCompanyOnboardingEmailResult(null);
      pushToast(
        "Onboarding email failed",
        error instanceof Error ? error.message : "Unable to send onboarding email.",
        "warning",
      );
    } finally {
      setCompanyOnboardingEmailSending(false);
    }
  };

  const handleInviteUser = async () => {
    if (!currentUser) {
      return;
    }

    const allowedRoles = getCreatableRoles(currentUser.role);
    if (allowedRoles.length === 0) {
      pushToast("Access restricted", "Auditors cannot create other users.", "warning");
      return;
    }

    if (!allowedRoles.includes(inviteRoleInput)) {
      pushToast("Role restricted", `A ${currentUser.role.toLowerCase()} cannot create an ${inviteRoleInput.toLowerCase()}.`, "warning");
      return;
    }

    const isGodModeFirstUserInvite =
      currentUser.role === "Master" &&
      (companySheetSync?.usersCount ?? 0) === 0 &&
      invitedUsers.length === 0;
    const inviteRole = isGodModeFirstUserInvite ? "Admin" : inviteRoleInput;

    const trimmedEmail = inviteEmailInput.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      pushToast("Email required", "Enter a valid email address to send the invite link.", "warning");
      return;
    }

    if (invitedUsers.some((invite) => invite.email === trimmedEmail && invite.role === inviteRole)) {
      pushToast("Invite already sent", "That user and role already has an active invite.", "warning");
      return;
    }

    const sheetId = companySheetSync?.sheetId || extractGoogleResourceId(masterSheetInput);
    const companyFolderId = selectedFolder?.id || extractGoogleResourceId(folderIdInput);
    if (!googleConnected) {
      pushToast("Google not connected", "Connect Google in Setup before sending invite links.", "warning");
      return;
    }
    if (!sheetId || !companyFolderId) {
      pushToast(
        "Workspace required",
        "Select a company folder and ensure the master sheet is loaded before sending invites.",
        "warning",
      );
      return;
    }

    setCompanyUserInviteEmailSending(true);
    try {
      const response = await fetch(apiUrl("/api/onboarding/app-invites/company-user"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: trimmedEmail,
          role: inviteRole,
          invitedBy: currentUser.name,
          companyFolderId,
          masterSheetId: sheetId,
          companyName: selectedFolder?.name || "",
        }),
      });
      const payload = (await parseJsonApiResponse(response)) as {
        ok?: boolean;
        error?: string;
        sent?: boolean;
        smtpConfigured?: boolean;
        email?: string;
        role?: Role;
        inviteUrl?: string;
        tokenId?: string;
        senderEmail?: string;
        emailDraft?: { subject: string; body: string };
        mailtoUrl?: string;
        smtpError?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Unable to send invite email.");
      }

      const emailSent = payload.sent === true;
      const inviteUrl = payload.inviteUrl || "";
      const result: CompanyUserInviteEmailResult = {
        email: payload.email || trimmedEmail,
        role: (payload.role as Role) || inviteRole,
        sent: emailSent,
        smtpConfigured: payload.smtpConfigured !== false,
        senderEmail: payload.senderEmail || "admin@usebert.co.uk",
        inviteUrl,
        emailDraft: payload.emailDraft,
        mailtoUrl: payload.mailtoUrl,
        smtpError: payload.smtpError,
      };
      setCompanyUserInviteEmailResult(result);

      const createdInvite: UserInvite = {
        id: payload.tokenId || `invite-${Date.now()}`,
        email: trimmedEmail,
        role: inviteRole,
        invitedBy: currentUser.name,
        senderEmail: result.senderEmail,
        sentAt: formatStamp(),
        status: emailSent ? "Email sent" : "Invite created",
        mailtoUrl: result.mailtoUrl,
        appOnboardingUrl: inviteUrl || undefined,
      };
      const nextInvitedUsers = [createdInvite, ...invitedUsers];
      setInvitedUsers(nextInvitedUsers);
      if (selectedFolder?.id) {
        try {
          await persistUsers(selectedFolder.id, nextInvitedUsers);
        } catch (error) {
          pushToast(
            "Users tab not updated",
            error instanceof Error ? error.message : "Invite saved, but the Users tab could not be updated yet.",
            "warning",
          );
        }
      }
      setInviteEmailInput("");
      if (emailSent) {
        pushToast("User invite sent", `We sent an invite to ${trimmedEmail}.`, "success");
      }
      triggerNotification("User invite", `${trimmedEmail} has been invited as ${inviteRole}.`);
    } catch (error) {
      setCompanyUserInviteEmailResult(null);
      pushToast(
        "Invite send failed",
        error instanceof Error ? error.message : "Unable to send invite email.",
        "warning",
      );
    } finally {
      setCompanyUserInviteEmailSending(false);
    }
  };

  const handleResendInvite = async (invite: UserInvite) => {
    if (!currentUser) return;
    const sheetId = companySheetSync?.sheetId || extractGoogleResourceId(masterSheetInput);
    const companyFolderId = selectedFolder?.id || extractGoogleResourceId(folderIdInput);
    if (!googleConnected || !sheetId || !companyFolderId) {
      pushToast("Workspace required", "Connect Google and pick a company folder before resending invites.", "warning");
      return;
    }

    setCompanyUserInviteEmailSending(true);
    try {
      const response = await fetch(apiUrl("/api/onboarding/app-invites/company-user"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: invite.email,
          role: invite.role,
          invitedBy: currentUser.name,
          companyFolderId,
          masterSheetId: sheetId,
          companyName: selectedFolder?.name || "",
        }),
      });
      const payload = (await parseJsonApiResponse(response)) as {
        ok?: boolean;
        error?: string;
        sent?: boolean;
        smtpConfigured?: boolean;
        email?: string;
        role?: Role;
        inviteUrl?: string;
        tokenId?: string;
        senderEmail?: string;
        emailDraft?: { subject: string; body: string };
        mailtoUrl?: string;
        smtpError?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Unable to resend invite email.");
      }

      const emailSent = payload.sent === true;
      const inviteUrl = payload.inviteUrl || invite.appOnboardingUrl || "";
      const result: CompanyUserInviteEmailResult = {
        email: payload.email || invite.email,
        role: (payload.role as Role) || invite.role,
        sent: emailSent,
        smtpConfigured: payload.smtpConfigured !== false,
        senderEmail: payload.senderEmail || invite.senderEmail || "admin@usebert.co.uk",
        inviteUrl,
        emailDraft: payload.emailDraft,
        mailtoUrl: payload.mailtoUrl,
        smtpError: payload.smtpError,
      };
      setCompanyUserInviteEmailResult(result);

      const resentAt = formatStamp();
      const nextInvitedUsers = invitedUsers.map((item) =>
        item.id === invite.id
          ? {
              ...item,
              id: payload.tokenId || item.id,
              sentAt: resentAt,
              invitedBy: currentUser.name,
              senderEmail: result.senderEmail,
              status: emailSent ? ("Email sent" as const) : ("Invite created" as const),
              mailtoUrl: result.mailtoUrl,
              appOnboardingUrl: inviteUrl || undefined,
            }
          : item,
      );
      setInvitedUsers(nextInvitedUsers);
      if (selectedFolder?.id) {
        try {
          await persistUsers(selectedFolder.id, nextInvitedUsers);
        } catch (error) {
          pushToast(
            "Users tab not updated",
            error instanceof Error ? error.message : "Invite resent, but the Users tab could not be updated yet.",
            "warning",
          );
        }
      }
      if (emailSent) {
        pushToast("User invite resent", `We sent an invite to ${invite.email}.`, "success");
      }
    } catch (error) {
      setCompanyUserInviteEmailResult(null);
      pushToast(
        "Resend failed",
        error instanceof Error ? error.message : "Unable to resend invite email.",
        "warning",
      );
    } finally {
      setCompanyUserInviteEmailSending(false);
    }
  };

  const handleDeleteInvite = (invite: UserInvite) => {
    setInvitedUsers((current) => current.filter((item) => item.id !== invite.id));
    pushToast("Invite removed", `${invite.email} has been removed from sent invites.`, "success");
  };

  const handleResyncUsers = async () => {
    if (!googleConnected) {
      pushToast("Google not connected", "Connect Google before re-syncing users.", "warning");
      return;
    }

    const companyFolderId = selectedFolder?.id || extractGoogleResourceId(folderIdInput);
    if (!companyFolderId) {
      pushToast("Company folder required", "Select a company folder before re-syncing users.", "warning");
      return;
    }

    try {
      const manualMasterSheetId = extractGoogleResourceId(masterSheetInput) || companySheetSync?.sheetId || "";
      const payload = manualMasterSheetId
        ? await loadCompanySheetById(manualMasterSheetId, companyFolderId, { silent: true })
        : await loadCompanySheet(companyFolderId, { silent: true });

      if (!payload) {
        throw new Error("Unable to load the company sheet.");
      }

      const syncedUsers = payload.data.Users?.length ?? 0;
      pushToast("Users re-synced", `${syncedUsers} user row${syncedUsers === 1 ? "" : "s"} pulled from the company sheet.`, "success");
    } catch (error) {
      pushToast(
        "Resync failed",
        error instanceof Error ? error.message : "Unable to re-sync users from the company sheet.",
        "warning",
      );
    }
  };

  const persistUsers = async (companyFolderId: string, nextUsers: UserInvite[]) => {
    const sheetId = companySheetSync?.sheetId || extractGoogleResourceId(masterSheetInput);
    if (!sheetId) {
      throw new Error("Company master sheet link is required before saving users.");
    }

    const response = await fetch(apiUrl(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/users`), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyFolderId,
        users: nextUsers,
      }),
    });

    const payload = (await response.json()) as SaveSchedulesResponse;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Unable to save users.");
    }
  };

  const persistActions = async (companyFolderId: string, nextActions: ActionItem[]) => {
    const sheetId = companySheetSync?.sheetId || extractGoogleResourceId(masterSheetInput);
    if (!sheetId) {
      throw new Error("Company master sheet link is required before saving actions.");
    }

    const response = await fetch(apiUrl(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/actions`), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyFolderId,
        actions: nextActions,
      }),
    });

    const payload = (await response.json()) as SaveSchedulesResponse;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Unable to save actions.");
    }
  };

  const applyNextBestDashboardIntent = useCallback((intent: NextBestActionIntent) => {
    if (intent.type !== "screen") return;
    if (intent.actionFilter) {
      setActionFilter(intent.actionFilter);
    }
    setScreen(intent.screen);
  }, []);

  const handleLeaveMasterWorkspaceSetupOnly = () => {
    try {
      window.localStorage.removeItem(masterCompanySetupSessionKey);
    } catch {
      /* ignore */
    }
    setGodCompanySetupSession(false);
    setScreen(getHomeScreenForRole("Master"));
    pushToast("Full navigation", "All BERT areas are available on this device until you sign out.", "success");
  };

  const handleLogout = () => {
    fetch(apiUrl("/auth/google/logout"), { method: "POST", credentials: "include" }).catch(() => undefined);
    fetch(apiUrl("/api/auth/master/logout"), { method: "POST", credentials: "include" }).catch(() => undefined);
    fetch(apiUrl("/api/auth/company/logout"), { method: "POST", credentials: "include" }).catch(() => undefined);
    try {
      window.localStorage.removeItem(masterCompanySetupSessionKey);
    } catch {
      /* ignore */
    }
    setGodCompanySetupSession(false);
    setCompanySetupLoginPortal(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("setup");
      window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
    } catch {
      window.history.replaceState({}, "", window.location.pathname);
    }
    window.localStorage.removeItem(userStorageKey);
    setCurrentUser(null);
    setAccountNameInput("");
    setAccountPhotoUrl("");
    setScreen("dashboard");
    setActiveAuditId(null);
    setResponses({});
    setNotes({});
    setEvidence({});
    setAuditModeQuestionIndex(0);
    setIssuePrompt(null);
    setAuditCompletionSummary(null);
    pushToast("Signed out", "Your session has been closed.", "neutral");
  };

  const handleAccountPhotoChange = (file: File) => {
    if (!currentUser) return;
    const reader = new FileReader();
    reader.onload = () => {
      const nextPhoto = typeof reader.result === "string" ? reader.result : "";
      if (!nextPhoto) return;
      setAccountPhotoUrl(nextPhoto);
      setUserProfilePhotos((current) => ({
        ...current,
        [currentUser.username]: nextPhoto,
        [currentUser.name.toLowerCase()]: nextPhoto,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveAccountSettings = () => {
    const trimmedName = accountNameInput.trim();
    if (!currentUser || !trimmedName) {
      pushToast("Name required", "Enter your name before saving account settings.", "warning");
      return;
    }

    const updatedUser = { ...currentUser, name: trimmedName };
    setCurrentUser(updatedUser);
    window.localStorage.setItem(userStorageKey, JSON.stringify(updatedUser));
    pushToast("Account updated", "Your account settings have been saved on this device.", "success");
  };

  const startAudit = (auditId: string) => {
    const audit = audits.find((item) => item.id === auditId);
    if (!audit) {
      return;
    }
    if (isAuditCompleted(audit) && !drafts[auditId]) {
      pushToast("Audit already completed", `${audit.name} has already been submitted and moved to history.`, "warning");
      return;
    }

    const draft = drafts[auditId];
    setActiveAuditId(auditId);
    setResponses(draft?.responses ?? {});
    setNotes(draft?.notes ?? {});
    setEvidence(draft?.evidence ?? {});
    setAuditModeQuestionIndex(0);
    setIssuePrompt(null);
    setAuditCompletionSummary(null);
    setScreen("complete");
    if (draft) {
      pushToast("Audit in progress loaded", "Saved progress has been restored.", "neutral");
    }
  };

  const saveDraft = () => {
    if (!activeAudit) {
      return;
    }
    setDrafts((current) => ({
      ...current,
      [activeAudit.id]: {
        responses,
        notes,
        evidence,
        updatedAt: formatStamp(),
      },
    }));
    pushToast("Progress saved", `${activeAudit.name} has been saved for later.`, "success");
  };

  const createActionsFromAudit = (
    audit: Audit,
    responseMap: Record<string, Answer>,
    noteMap: Record<string, string>,
    evidenceMap: Record<string, EvidenceItem[]>,
    submittedBy: User,
    completedAt: string,
  ) => {
    let nonConformanceSequence = getNextNonConformanceSequence(actions);
    const actionItems = audit.questions
      .map((question) => ({
        question,
        answer: responseMap[question.id],
      }))
      .filter(
        (item): item is { question: AuditQuestion; answer: Exclude<Answer, "pass"> } =>
          item.answer === "nc" ||
          item.answer === "fail" ||
          (!!item.question.autoActionRequired && Boolean(item.answer)),
      )
      .map((item, index) => ({
        id: `${audit.id}-action-${Date.now()}-${index}`,
        companyId: selectedFolderId || selectedFolder?.id || "local-company",
        auditId: audit.id,
        auditName: audit.name,
        questionId: item.question.id,
        questionText: item.question.text,
        sourceAnswer: item.answer,
        nonConformanceId:
          item.answer === "fail" || item.answer === "nc" ? formatNonConformanceId(nonConformanceSequence++) : undefined,
        severity:
          item.question.riskLevel ||
          (item.answer === "fail" ? "Critical" : item.answer === "nc" ? "High" : "Medium"),
        owner: audit.owner,
        assignedToUserId: audit.owner.toLowerCase().replace(/\s+/g, "-"),
        assignedToName: audit.owner,
        createdByUserId: submittedBy.username,
        createdAt: completedAt,
        dueDate: addDaysIso(
          ACTION_DUE_DAYS_BY_SEVERITY[
            item.question.riskLevel ||
              (item.answer === "fail" ? "Critical" : item.answer === "nc" ? "High" : "Medium")
          ],
        ),
        closedAt: "",
        verifiedByUserId: "",
        verificationNotes: "",
        evidenceLinks: [],
        localEvidenceRefs: (evidenceMap[item.question.id] || []).map((evidenceItem) => evidenceItem.id),
        comments: noteMap[item.question.id] || "",
        recurrenceFlag: false,
        rootCause: "",
        correctiveAction: "",
        preventiveAction: "",
        dueLabel:
          item.answer === "fail"
            ? "Immediate attention"
            : item.answer === "nc"
              ? "Due within 3 days"
              : "Due within 7 days",
        dueHours:
          ACTION_DUE_DAYS_BY_SEVERITY[
            item.question.riskLevel ||
              (item.answer === "fail" ? "Critical" : item.answer === "nc" ? "High" : "Medium")
          ] * 24,
        status: item.question.requiresManagerReview ? ("Awaiting Verification" as ActionStatus) : ("Open" as ActionStatus),
        evidenceCount: evidenceMap[item.question.id]?.length ?? 0,
        noteIncluded: Boolean(noteMap[item.question.id]?.trim()),
        riskCategory: item.question.riskCategory || "Other",
        evidenceRequired: item.question.requiresPhotoEvidence,
        requiresManagerReview: item.question.requiresManagerReview,
      } satisfies ActionItem));

    if (actionItems.length > 0) {
      const existingKeys = new Set(
        actions
          .filter((item) => item.auditId === audit.id && item.status !== "Closed")
          .map((item) => `${item.auditId}::${item.questionId}`),
      );
      const uniqueActionItems = actionItems.filter((item) => !existingKeys.has(`${item.auditId}::${item.questionId}`));
      if (uniqueActionItems.length === 0) {
        return [];
      }
      setActions((current) => [...uniqueActionItems, ...current]);
      queueSyncItem({
        itemType: "actionUpdate",
        localId: `actions-${audit.id}-${Date.now()}`,
        status: googleConnected && !offlineMode ? "Pending Sync" : "Pending Sync",
        createdAt: completedAt,
        retryCount: 0,
        lastError: "",
        payload: { companyFolderId: selectedFolderId, actions: uniqueActionItems },
      });
      return uniqueActionItems;
    }

    return [];
  };

  const createCorrectiveActionFromIssue = ({
    audit,
    question,
    answer,
    findingNote,
  }: {
    audit: Audit;
    question: AuditQuestion;
    answer: Exclude<Answer, "pass">;
    findingNote: string;
  }) => {
    if (!currentUser) return 0;
    const severity =
      question.riskLevel ||
      (answer === "fail" ? "Critical" : answer === "nc" ? "High" : "Medium");
    const existingAction = actions.find((item) => item.auditId === audit.id && item.questionId === question.id && item.status !== "Closed");
    if (existingAction) return 0;
    const stamp = formatStamp();
    const actionItem: ActionItem = {
      id: `${audit.id}-issue-${question.id}-${Date.now()}`,
      companyId: selectedFolderId || selectedFolder?.id || "local-company",
      siteArea: audit.siteArea,
      auditId: audit.id,
      auditName: audit.name,
      questionId: question.id,
      questionText: `Resolve failed check: ${question.text}`,
      sourceAnswer: answer,
      nonConformanceId: answer === "fail" || answer === "nc" ? formatNonConformanceId(getNextNonConformanceSequence(actions)) : undefined,
      severity,
      owner: audit.owner,
      assignedToUserId: audit.owner.toLowerCase().replace(/\s+/g, "-"),
      assignedToName: audit.owner,
      createdByUserId: currentUser.username,
      createdAt: stamp,
      dueDate: addDaysIso(ACTION_DUE_DAYS_BY_SEVERITY[severity]),
      closedAt: "",
      verifiedByUserId: "",
      verificationNotes: "",
      evidenceLinks: [],
      localEvidenceRefs: (evidence[question.id] || []).map((item) => item.id),
      comments: findingNote,
      recurrenceFlag: false,
      rootCause: "",
      correctiveAction: "",
      preventiveAction: "",
      dueLabel: getDueLabel(ACTION_DUE_DAYS_BY_SEVERITY[severity] * 24),
      dueHours: ACTION_DUE_DAYS_BY_SEVERITY[severity] * 24,
      status: "Open",
      evidenceCount: evidence[question.id]?.length ?? 0,
      noteIncluded: Boolean(findingNote.trim()),
      riskCategory: question.riskCategory || "Other",
      evidenceRequired: question.requiresPhotoEvidence,
      requiresManagerReview: question.requiresManagerReview,
    };
    setActions((current) => [actionItem, ...current]);
    queueSyncItem({
      itemType: "actionUpdate",
      localId: actionItem.id,
      status: "Pending Sync",
      createdAt: stamp,
      retryCount: 0,
      lastError: "",
      payload: { companyFolderId: selectedFolderId, actions: [actionItem] },
    });
    return 1;
  };

  const createNonConformanceFromIssue = ({
    audit,
    question,
    answer,
    note,
  }: {
    audit: Audit;
    question: AuditQuestion;
    answer: Exclude<Answer, "pass">;
    note: string;
  }) => {
    if (!currentUser) return null;
    const selectedManagers = getSelectedManagersForAudit(audit.id);
    const assignedManager = selectedManagers[0] || { name: audit.owner || "Unassigned manager", email: "" };
    const managerUser = users.find((user) => user.name === assignedManager.name && user.role === "Manager");
    const raisedAt = formatStamp();
    const nextReference = formatNcrReference(getNextNcrSequence(nonConformances));
    const createdRecord: NonConformanceRecord = {
      id: `ncr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      reference: nextReference,
      auditId: audit.id,
      auditName: audit.name,
      auditQuestionId: question.id,
      auditQuestion: question.text,
      selectedAnswer: answer,
      auditorName: currentUser.name,
      auditorUserId: currentUser.username,
      site: audit.siteArea,
      raisedAt,
      status: "Raised",
      assignedLineManager: assignedManager.name,
      assignedLineManagerUserId: managerUser?.username || assignedManager.name.toLowerCase().replace(/\s+/g, "-"),
      assignedLineManagerEmail: assignedManager.email || "",
      investigationIsoClause: "",
      investigationNotes: note,
      rootCause: "",
      correctiveAction: "",
      investigationExtraNotes: "",
      evidence: [],
    };
    setNonConformances((current) => [createdRecord, ...current]);

    if (createdRecord?.assignedLineManagerEmail) {
      const investigationLink = `${window.location.origin}?ncr=${encodeURIComponent(createdRecord.reference)}`;
      void fetch(apiUrl("/api/ncr/escalation-alert"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: createdRecord.assignedLineManagerEmail,
          ncrReference: createdRecord.reference,
          auditorName: createdRecord.auditorName,
          site: createdRecord.site,
          raisedAt: createdRecord.raisedAt,
          auditQuestion: createdRecord.auditQuestion,
          selectedAnswer: createdRecord.selectedAnswer,
          investigationLink,
        }),
      });
    }

    return createdRecord;
  };

  const applyAuditSubmission = ({
    audit,
    responseMap,
    noteMap,
    evidenceMap,
    submittedBy,
    submittedByUser,
    completedAt,
  }: {
    audit: Audit;
    responseMap: Record<string, Answer>;
    noteMap: Record<string, string>;
    evidenceMap: Record<string, EvidenceItem[]>;
    submittedBy: string;
    submittedByUser: User;
    completedAt: string;
  }) => {
    const answers = Object.values(responseMap);
    const outcomeStatus: AuditStatus = answers.includes("fail")
      ? "red"
      : answers.includes("nc")
        ? "amber"
        : "green";
    const failedQuestions = audit.questions.filter((question) => responseMap[question.id] === "fail" || responseMap[question.id] === "nc");
    const levels = failedQuestions.map((question) => question.riskLevel || (responseMap[question.id] === "fail" ? "Critical" : "High"));
    const totalRiskScore = levels.reduce((sum, level) => sum + riskScore(level), 0);
    const highestRiskLevel = levels.length ? maxRiskLevel(levels) : "Low";
    const numberOfCriticalFindings = levels.filter((level) => level === "Critical").length;
    const numberOfHighFindings = levels.filter((level) => level === "High").length;

    setAudits((current) =>
      current.map((item) =>
        item.id === audit.id
          ? {
              ...item,
              status: outcomeStatus,
              dueLabel:
                outcomeStatus === "red"
                  ? "Immediate attention"
                  : outcomeStatus === "amber"
                    ? "Action required"
                    : "Updated today",
              dueHours: outcomeStatus === "red" ? -1 : outcomeStatus === "amber" ? 1 : 24,
              lastCompletedAt: completedAt,
              totalRiskScore,
              highestRiskLevel,
              numberOfCriticalFindings,
              numberOfHighFindings,
            }
          : item,
      ),
    );

    setHistory((current) => [
      {
        id: `${audit.id}-${Date.now()}`,
        auditId: audit.id,
        auditName: audit.name,
        completedAt,
        completedBy: submittedBy,
        status: outcomeStatus,
      },
      ...current,
    ]);

    setActions((current) => current.filter((action) => action.auditId !== audit.id || action.status === "Closed"));
    const createdActions = createActionsFromAudit(audit, responseMap, noteMap, evidenceMap, submittedByUser, completedAt);

    return { outcomeStatus, createdActions };
  };

  const submitAudit = () => {
    if (!activeAudit || !currentUser) {
      return;
    }

    const stamp = formatStamp();

    if (!signatureDataUrl) {
      pushToast("Signature required", "Add an inspector signature before submitting the audit.", "warning");
      return;
    }

    const nonComplianceCount = activeAudit.questions.filter(
      (question) => responses[question.id] === "fail" || responses[question.id] === "nc",
    ).length;

    if (offlineMode) {
      setOfflineQueue((current) => [
        {
          id: `offline-${activeAudit.id}-${Date.now()}`,
          audit: activeAudit,
          responses,
          notes,
          evidence,
          signatureDataUrl,
          queuedAt: stamp,
          submittedBy: currentUser.name,
        },
        ...current,
      ]);
      queueSyncItem({
        itemType: "auditSubmission",
        localId: activeAudit.id,
        status: "Pending Sync",
        createdAt: stamp,
        retryCount: 0,
        lastError: "",
        payload: { auditId: activeAudit.id, auditName: activeAudit.name, companyFolderId: selectedFolderId },
      });
      setDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[activeAudit.id];
        return nextDrafts;
      });
      setActiveAuditId(null);
      setResponses({});
      setNotes({});
      setEvidence({});
      setSignatureDataUrl("");
      setSignatureSignedAt("");
      setScreen("dashboard");
      pushToast("Queued offline", `${activeAudit.name} has been saved and will sync when the tablet reconnects.`, "warning");
      triggerNotification(companyName, `${activeAudit.name} has been queued offline for sync.`);
      notifySelectedManagersForNonCompliance(activeAudit, currentUser.name, nonComplianceCount, true);
      return;
    }

    const { outcomeStatus, createdActions } = applyAuditSubmission({
      audit: activeAudit,
      responseMap: responses,
      noteMap: notes,
      evidenceMap: evidence,
      submittedBy: currentUser.name,
      submittedByUser: currentUser,
      completedAt: stamp,
    });
    queueSyncItem({
      itemType: "auditSubmission",
      localId: activeAudit.id,
      status: googleConnected ? "Pending Sync" : "Pending Sync",
      createdAt: stamp,
      retryCount: 0,
      lastError: "",
      payload: { auditId: activeAudit.id, auditName: activeAudit.name, companyFolderId: selectedFolderId },
    });
    setDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[activeAudit.id];
      return nextDrafts;
    });

    setActiveAuditId(null);
    setResponses({});
    setNotes({});
    setEvidence({});
    setSignatureDataUrl("");
    setSignatureSignedAt("");
    setScreen("dashboard");

    pushToast(
      "Audit submitted",
      `${activeAudit.name} is now marked ${statusStyles[outcomeStatus].label.toLowerCase()}. ${createdActions.length} corrective action${createdActions.length === 1 ? "" : "s"} created.`,
      outcomeStatus === "green" ? "success" : "warning",
    );
    triggerNotification("Audit submitted", `${activeAudit.name} has been submitted by ${currentUser.name}.`);
    notifySelectedManagersForNonCompliance(activeAudit, currentUser.name, nonComplianceCount, false);
  };

  const completeAuditModeFlow = () => {
    if (!activeAudit || !currentUser) return;
    const stamp = formatStamp();
    const issuesFound = activeAudit.questions.filter((question) => responses[question.id] === "fail" || responses[question.id] === "nc").length;
    const photosCaptured = Object.values(evidence).reduce((count, items) => count + items.length, 0);
    let actionsCreated = 0;

    if (offlineMode) {
      setOfflineQueue((current) => [
        {
          id: `offline-${activeAudit.id}-${Date.now()}`,
          audit: activeAudit,
          responses,
          notes,
          evidence,
          signatureDataUrl: "audit-mode-signature-not-required",
          queuedAt: stamp,
          submittedBy: currentUser.name,
        },
        ...current,
      ]);
      queueSyncItem({
        itemType: "auditSubmission",
        localId: activeAudit.id,
        status: "Pending Sync",
        createdAt: stamp,
        retryCount: 0,
        lastError: "",
        payload: { auditId: activeAudit.id, auditName: activeAudit.name, companyFolderId: selectedFolderId },
      });
      setDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[activeAudit.id];
        return nextDrafts;
      });
      setAuditCompletionSummary({
        auditId: activeAudit.id,
        auditName: activeAudit.name,
        questionsAnswered: Object.keys(responses).length,
        issuesFound,
        actionsCreated,
        photosCaptured,
        syncTone: "amber",
        syncLabel: "Audit complete / not synced",
      });
      notifySelectedManagersForNonCompliance(activeAudit, currentUser.name, issuesFound, true);
      setActiveAuditId(null);
      return;
    }

    const applied = applyAuditSubmission({
      audit: activeAudit,
      responseMap: responses,
      noteMap: notes,
      evidenceMap: evidence,
      submittedBy: currentUser.name,
      submittedByUser: currentUser,
      completedAt: stamp,
    });
    actionsCreated = applied.createdActions.length;
    queueSyncItem({
      itemType: "auditSubmission",
      localId: activeAudit.id,
      status: "Pending Sync",
      createdAt: stamp,
      retryCount: 0,
      lastError: "",
      payload: { auditId: activeAudit.id, auditName: activeAudit.name, companyFolderId: selectedFolderId },
    });
    setDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[activeAudit.id];
      return nextDrafts;
    });
    setAuditCompletionSummary({
      auditId: activeAudit.id,
      auditName: activeAudit.name,
      questionsAnswered: Object.keys(responses).length,
      issuesFound,
      actionsCreated,
      photosCaptured,
      syncTone: "green",
      syncLabel: "Synced",
    });
    notifySelectedManagersForNonCompliance(activeAudit, currentUser.name, issuesFound, false);
    setActiveAuditId(null);
  };

  const handleAuditModeAnswer = (question: AuditQuestion, answer: Answer) => {
    if (!activeAudit) return;
    setResponses((current) => ({
      ...current,
      [question.id]: answer,
    }));
    if (answer === "pass") {
      const canAutoAdvance =
        !question.requiresPhotoEvidence &&
        !question.autoActionRequired &&
        !question.requiresManagerReview &&
        (question.answerPrompts?.pass?.length ?? 0) === 0;
      if (canAutoAdvance) {
        setAuditModeQuestionIndex((current) => Math.min(current + 1, activeAudit.questions.length - 1));
      }
      return;
    }
    setIssuePrompt({
      question,
      answer,
    });
  };

  const handleAuditModeSaveIssue = ({ noteValue }: { noteValue: string; escalate?: boolean }) => {
    if (!activeAudit || !issuePrompt) return;
    if (!noteValue.trim()) {
      pushToast("Note required", "Describe what was found before continuing.", "warning");
      return;
    }
    if (issuePrompt.question.requiresPhotoEvidence && (evidence[issuePrompt.question.id]?.length ?? 0) === 0) {
      pushToast("Photo required", "Capture photo evidence for this finding before continuing.", "warning");
      return;
    }
    setNotes((current) => ({
      ...current,
      [issuePrompt.question.id]: noteValue,
    }));
    const mustCreateAction =
      issuePrompt.question.autoActionRequired ||
      issuePrompt.question.riskLevel === "Critical" ||
      issuePrompt.question.riskLevel === "High" ||
      issuePrompt.answer === "fail";
    if (mustCreateAction) {
      createCorrectiveActionFromIssue({
        audit: activeAudit,
        question: issuePrompt.question,
        answer: issuePrompt.answer,
        findingNote: noteValue,
      });
    }
    setIssuePrompt(null);
    setAuditModeQuestionIndex((current) => Math.min(current + 1, activeAudit.questions.length - 1));
  };

  const handleAuditModeSaveAndExit = () => {
    saveDraft();
    setActiveAuditId(null);
    setIssuePrompt(null);
    setAuditModeQuestionIndex(0);
    setScreen("dashboard");
  };

  const updateActionStatus = (actionId: string, nextStatus?: ActionStatus) => {
    if (!currentUser) {
      return;
    }
    const permissions = getRolePermissions(currentUser.role);
    setActions((current) =>
      current.map((action) => {
        if (action.id !== actionId) {
          return action;
        }
        const resolvedStatus =
          nextStatus ||
          (action.status === "Open"
            ? "In Progress"
            : action.status === "In Progress"
              ? "Awaiting Verification"
              : action.status === "Awaiting Verification"
                ? "Closed"
                : "Closed");
        if ((resolvedStatus === "Closed" || resolvedStatus === "Awaiting Verification" || resolvedStatus === "Rejected") && !permissions.canVerifyActions) {
          return action;
        }
        return {
          ...action,
          status: resolvedStatus,
          verifiedByUserId: resolvedStatus === "Closed" ? currentUser.username : action.verifiedByUserId,
          closedAt: resolvedStatus === "Closed" ? formatStamp() : action.closedAt,
          dueHours: resolvedStatus === "Closed" ? 0 : action.dueHours,
        };
      }),
    );
  };

  const assignAction = (actionId: string, assignee: string) => {
    setActions((current) =>
      current.map((action) =>
        action.id === actionId
          ? {
              ...action,
              owner: assignee,
              assignedToName: assignee,
              assignedToUserId: assignee.toLowerCase().replace(/\s+/g, "-"),
            }
          : action,
      ),
    );
  };

  const attachEvidenceToAction = (actionId: string, files: FileList) => {
    const fileCount = files.length;
    if (fileCount === 0) return;
    const stamp = formatStamp();
    const newRefs = Array.from(files).map((file) => `action-evidence-${actionId}-${Date.now()}-${file.name}`);
    setActions((current) =>
      current.map((action) =>
        action.id === actionId
          ? {
              ...action,
              evidenceCount: (action.evidenceCount || 0) + fileCount,
              localEvidenceRefs: [...(action.localEvidenceRefs || []), ...newRefs],
              status: action.status === "Open" ? ("In Progress" as ActionStatus) : action.status,
            }
          : action,
      ),
    );
    queueSyncItem({
      itemType: "evidenceUpload",
      localId: `action-evidence-${actionId}-${Date.now()}`,
      status: "Pending Sync",
      createdAt: stamp,
      retryCount: 0,
      lastError: "",
      payload: { actionId, fileCount },
    });
    pushToast("Evidence attached", `${fileCount} file${fileCount === 1 ? "" : "s"} added.`, "success");
  };

  const handleGoogleConnect = () => {
    if (!backendConfigured) {
      pushToast(
        "Setup required",
        "Add your Google client ID and secret on the setup server (see `.env`) before connecting Drive.",
        "warning",
      );
      return;
    }

    window.location.href = apiUrl("/auth/google/login");
  };

  const handleGoogleDisconnect = async () => {
    try {
      await fetch(apiUrl("/auth/google/logout"), { method: "POST", credentials: "include" });
    } catch {
      pushToast("Disconnect issue", "Google sign-out could not be confirmed, but the local link has been cleared.", "warning");
    }

    setGoogleConnected(false);
    setSelectedFolderId("");
    setFolders([]);
    setFolderInspection(null);
    setAuditFormsFolderInput("");
    setMasterSheetInput("");
    setEvidenceFolderInput("");
    setHealthSafetyFolderInput("");
    setExportsFolderInput("");
    setAdminNotesFolderInput("");
    setOnboardingSource(null);
    setOnboardingRecords([]);
    setSelectedOnboardingRecordId("");
    setSyncState("Not synced");
    pushToast("Google disconnected", "The Google Drive connection has been removed from this tablet.", "neutral");
  };

  const handleAddFolder = async () => {
    if (!backendConfigured) {
      pushToast(
        "Google Workspace needs setup",
        "Connect Google in Initial Setup before linking company workspaces.",
        "warning",
      );
      return;
    }
    if (!googleConnected) {
      pushToast("Connect required", "Connect Google before linking the company folder from the root folder.", "warning");
      return;
    }

    const companyFolderId = extractGoogleResourceId(folderIdInput);
    const auditFormsFolderId = extractGoogleResourceId(auditFormsFolderInput);
    const masterSheetId = extractGoogleResourceId(masterSheetInput);
    const evidenceFolderId = extractGoogleResourceId(evidenceFolderInput);
    const healthSafetyFolderId = extractGoogleResourceId(healthSafetyFolderInput);
    const exportsFolderId = extractGoogleResourceId(exportsFolderInput);
    const adminNotesFolderId = extractGoogleResourceId(adminNotesFolderInput);
    const existingFolder = folders.find((folder) => folder.id === companyFolderId);

    if (!companyFolderId) {
      pushToast("Company folder required", "Paste the company folder link or ID.", "warning");
      return;
    }

    if (!masterSheetId) {
      pushToast("Master sheet required", "Paste the company master sheet link or ID.", "warning");
      return;
    }

    setFolderInspectionLoading(true);
    try {
      const [companyFolder, masterSheetPayload, auditFormsPayload] = await Promise.all([
        loadGoogleFile(companyFolderId),
        loadCompanySheetById(masterSheetId, companyFolderId, { silent: true }),
        auditFormsFolderId ? loadFormsFolder(auditFormsFolderId) : Promise.resolve(null),
      ]);

      if (!masterSheetPayload) {
        throw new Error("The company master sheet could not be loaded.");
      }

      const inspection: FolderInspection = {
        ok: true,
        folder: {
          id: companyFolder.id,
          name: companyFolder.name,
          createdTime: companyFolder.createdTime || "",
        },
        checks: {
          auditFormsFolder: Boolean(auditFormsFolderId),
          masterDataFolder: true,
          masterSheet: true,
          evidenceFolder: Boolean(evidenceFolderId),
          exportsFolder: Boolean(exportsFolderId),
          adminNotesFolder: Boolean(adminNotesFolderId),
        },
        auditFormsFolder: auditFormsPayload
          ? { id: auditFormsPayload.folder.id, name: auditFormsPayload.folder.name }
          : null,
        masterDataFolder: { id: masterSheetId, name: "Manual master sheet link" },
        masterSheet: {
          id: masterSheetPayload.sheetId,
          name: masterSheetPayload.sheetName,
          tabs: masterSheetPayload.tabs,
        },
        auditForms: (auditFormsPayload?.forms || []).map((form) => ({ id: form.id, name: form.name })),
        blockingItems: [],
        recommendedItems: [
          ...(!auditFormsFolderId ? ["Audit forms folder link"] : []),
          ...(!evidenceFolderId ? ["Evidence folder link"] : []),
          ...(!exportsFolderId ? ["Exports folder link"] : []),
          ...(!adminNotesFolderId ? ["Admin notes folder link"] : []),
        ],
        missingItems: [
          ...(!auditFormsFolderId ? ["Audit forms folder link"] : []),
          ...(!evidenceFolderId ? ["Evidence folder link"] : []),
          ...(!exportsFolderId ? ["Exports folder link"] : []),
          ...(!adminNotesFolderId ? ["Admin notes folder link"] : []),
        ],
      };

      setFolderInspection(inspection);

      const nextFolder: CompanyFolder = {
        id: inspection.folder.id,
        name: inspection.folder.name,
        onboardingFormName: existingFolder?.onboardingFormName || `${inspection.folder.name} Onboarding`,
        auditFormCount: inspection.auditForms.length,
        auditFormIds: inspection.auditForms.map((item) => item.id),
        responseSheetName: inspection.masterSheet?.name || "Company Master Sheet",
        responseSheetId: inspection.masterSheet?.id || "",
        linkedAt: inspection.folder.createdTime || existingFolder?.linkedAt || formatStamp(),
        onboardingVerified: existingFolder?.onboardingVerified ?? true,
        auditFormsVerified: Boolean(auditFormsFolderId),
        responseSheetVerified: true,
      };

      setFolders((current) => {
        const remaining = current.filter((folder) => folder.id !== nextFolder.id);
        return [nextFolder, ...remaining];
      });
      setSelectedFolderId(nextFolder.id);
      setFolderIdInput(companyFolderId);
      setAuditFormsFolderInput(auditFormsFolderId);
      setMasterSheetInput(masterSheetId);
      setEvidenceFolderInput(evidenceFolderId);
      setHealthSafetyFolderInput(healthSafetyFolderId);
      setExportsFolderInput(exportsFolderId);
      setAdminNotesFolderInput(adminNotesFolderId);
      setSyncState("Linked");
      setWorkspaceValidation(null);
      pushToast(
        "Company workspace linked",
        `${nextFolder.name} is ready to populate using the pasted Google links.`,
        "success",
      );
      void validateWorkspace({ silent: true });
    } catch (error) {
      setFolderInspection(null);
      pushToast(
        "Workspace link failed",
        error instanceof Error ? error.message : "Unable to link the company workspace from the provided Google links.",
        "warning",
      );
      return;
    } finally {
      setFolderInspectionLoading(false);
    }
  };

  const handleSelectFolder = async (folderId: string) => {
    if (!googleConnected) {
      pushToast("Connect required", "Connect Google before selecting the company folder.", "warning");
      return;
    }

    const folder = folders.find((item) => item.id === folderId);
    if (!folder) {
      pushToast("Folder missing", "Add a company folder before selecting it.", "warning");
      return;
    }

    setSelectedFolderId(folderId);
    setSyncState("Linked");
    void inspectFolderById(folderId, { silent: true });
    pushToast("Folder selected", `${folder.name} is now the active company source.`, "success");
  };

  const handleAddSite = () => {
    if (!canAccessAdmin(currentUser?.role || "Auditor")) {
      pushToast("Access restricted", "Only company administrators with full workspace rights can add sites.", "warning");
      return;
    }
    const input = window.prompt("New site name");
    const nextName = String(input || "").trim();
    if (!nextName) return;
    const exists = sites.some((site) => normalizeIdentity(site.name) === normalizeIdentity(nextName));
    if (exists) {
      pushToast("Site exists", `${nextName} already exists.`, "warning");
      return;
    }
    const newSite: Site = {
      id: createSiteId(nextName),
      name: nextName,
      code: nextName.slice(0, 3).toUpperCase(),
      active: true,
    };
    setSites((current) => [newSite, ...current]);
    setSelectedSiteId(newSite.id);
    pushToast("Site added", `${nextName} is now available for schedules and audits.`, "success");
  };

  const handleArchiveSite = (siteId: string) => {
    const site = sites.find((item) => item.id === siteId);
    if (!site) return;
    if (!window.confirm(`Archive ${site.name}?`)) return;
    setSites((current) => current.map((item) => (item.id === siteId ? { ...item, active: false } : item)));
    if (selectedSiteId === siteId) {
      setSelectedSiteId("");
    }
    pushToast("Site archived", `${site.name} has been archived.`, "success");
  };

  const handleToggleUserSiteAssignment = (email: string, siteId: string) => {
    if (!canAccessAdmin(currentUser?.role || "Auditor")) {
      pushToast("Access restricted", "Only company administrators with full workspace rights can change site assignments.", "warning");
      return;
    }
    const key = normalizeIdentity(email);
    setUserSiteAssignments((current) => {
      const prev = current[key] ?? [];
      const has = prev.includes(siteId);
      const nextIds = has ? prev.filter((id) => id !== siteId) : [...prev, siteId];
      const next = { ...current };
      if (nextIds.length === 0) {
        delete next[key];
      } else {
        next[key] = nextIds;
      }
      return next;
    });
    pushToast("Site assignment updated", "Workspace site access for that user was saved on this device.", "neutral");
  };

  const handleVerifyOnboarding = () => {
    if (!selectedFolder) {
      pushToast("Link required", "Link a company folder before verifying onboarding.", "warning");
      return;
    }

    setFolders((current) =>
      current.map((folder) =>
        folder.id === selectedFolder.id ? { ...folder, onboardingVerified: true } : folder,
      ),
    );
    pushToast("Onboarding verified", `${selectedFolder.onboardingFormName} is available in the company folder.`, "success");
  };

  const handleVerifyAudits = () => {
    if (!selectedFolder) {
      pushToast("Link required", "Link a company folder before verifying audit forms.", "warning");
      return;
    }

    setFolders((current) =>
      current.map((folder) =>
        folder.id === selectedFolder.id ? { ...folder, auditFormsVerified: true } : folder,
      ),
    );
    pushToast("Audit forms verified", `${selectedFolder.auditFormCount} audit forms are ready to sync.`, "success");
  };

  const handleVerifyResponseSheet = () => {
    if (!selectedFolder) {
      pushToast("Link required", "Link a company folder before verifying the response sheet.", "warning");
      return;
    }

    setFolders((current) =>
      current.map((folder) =>
        folder.id === selectedFolder.id ? { ...folder, responseSheetVerified: true } : folder,
      ),
    );
    pushToast("Response sheet verified", `${selectedFolder.responseSheetName} is ready to capture company data.`, "success");
  };

  const handleSyncForms = async () => {
    if (!selectedFolder) {
      pushToast("Setup incomplete", "Link a company folder before syncing.", "warning");
      return;
    }

    if (!folderInspection || folderInspection.folder.id !== selectedFolder.id) {
      pushToast("Folder check required", "Check the company folder before populating the app.", "warning");
      return;
    }

    const manualMasterSheetId = extractGoogleResourceId(masterSheetInput);
    if (!folderInspection.checks.masterSheet && !manualMasterSheetId) {
      pushToast("Master sheet missing", "Paste the company master sheet link before populating the app.", "warning");
      return;
    }

    const companySheet = manualMasterSheetId
      ? await loadCompanySheetById(manualMasterSheetId, selectedFolder.id, { silent: true })
      : await loadCompanySheet(selectedFolder.id, { silent: true });
    await validateWorkspace({ silent: true });

    setFolders((current) =>
      current.map((folder) =>
        folder.id === selectedFolder.id
          ? { ...folder, auditFormsVerified: true, responseSheetVerified: true }
          : folder,
      ),
    );
    const nextTemplates = folderInspection.auditForms.map((form) => ({
      id: `template-${selectedFolder.id}-${form.id}`,
      name: form.name,
      active: true,
      questions: buildDefaultQuestions(form.name),
      source: "Google Drive" as const,
    }));
    setTemplates((current) => {
      const remaining = current.filter((item) => !item.id.startsWith(`template-${selectedFolder.id}-`));
      return [...remaining, ...nextTemplates];
    });
    setAudits(
      nextTemplates.filter((template) => template.active).map((template, index) => ({
        id: `audit-${selectedFolder.id}-${template.id}`,
        name: template.name,
        category: "Google Form audit",
        siteArea: selectedFolder.name,
        dueLabel: getDueLabel(index === 0 ? 1 : 24),
        dueHours: index === 0 ? 1 : 24,
        priority: index === 0 ? "High" : "Medium",
        owner: scheduleOwnerInput || DEFAULT_MANAGER_NAME,
        templateVersion: template.source,
        status: getAuditTrafficStatus(index === 0 ? 1 : 24),
        lastCompletedAt: "Not yet completed",
        questions: template.questions,
      })),
    );
    setSyncState("Synced");
    pushToast(
      "App populated",
      folderInspection.auditForms.length > 0
        ? `${selectedFolder.name} is now live with ${folderInspection.auditForms.length} audit form${folderInspection.auditForms.length === 1 ? "" : "s"}${companySheet ? ", schedules, and users" : ""}.`
        : `${selectedFolder.name} is now live. No audit forms have been added yet.`,
      "success",
    );
  };

  const handleStartCompanyOnboarding = () => {
    setSelectedFolderId("");
    setFolderNameInput("");
    setFolderIdInput("");
    setAuditFormsFolderInput("");
    setMasterSheetInput("");
    setEvidenceFolderInput("");
    setHealthSafetyFolderInput("");
    setExportsFolderInput("");
    setAdminNotesFolderInput("");
    setSelectedOnboardingRecordId("");
    setSyncState("Onboarding new company");
    pushToast(
      "New company onboarding",
      "Enter the company folder details below or refresh the Google Drive root folder to choose a live company source.",
      "neutral",
    );
  };

  const handleOpenOnboardingForm = () => {
    if (!onboardingSource?.formId) {
      pushToast(
        "Onboarding form unavailable",
        googleConnected
          ? "The onboarding form has not been discovered yet. Refresh the onboarding source or reconnect Google."
          : `Reconnect Google first so ${companyName} can find the onboarding form link.`,
        "warning",
      );
      return;
    }

    window.location.href = buildOnboardingFormViewUrl(onboardingSource.formId);
  };

  const handleApplyOnboardingRecord = () => {
    if (!activeOnboardingRecord) {
      pushToast("Submission required", "Select an onboarding submission before applying it.", "warning");
      return;
    }

    setFolderNameInput(
      normalizeFolderName(activeOnboardingRecord.companyName || activeOnboardingRecord.companyFolderReference),
    );
    setScheduleRecipientsInput(activeOnboardingRecord.auditRecipients || DEFAULT_AUDITOR_NAME);
    setScheduleOverdueAlertRecipientsInput(
      activeOnboardingRecord.overdueAlertRecipients || activeOnboardingRecord.reportingContact || DEFAULT_MANAGER_NAME,
    );
    setScheduleEscalationContactInput(activeOnboardingRecord.reportingContact || DEFAULT_ESCALATION_NAME);
    setScheduleOwnerInput(activeOnboardingRecord.mainContact || DEFAULT_MANAGER_NAME);
    setSchedulePersonalAssigneeInput(activeOnboardingRecord.mainContact || DEFAULT_AUDITOR_NAME);
    setSyncState("Onboarding submission applied");
    pushToast(
      "Submission applied",
      `${activeOnboardingRecord.companyName} details have been loaded into the onboarding setup.`,
      "success",
    );
  };

  const handleLoadDemoData = () => {
    const demo = buildDemoPrecastWorkspace();
    setAudits(demo.audits);
    setActions(demo.actions);
    setDrafts(demo.drafts);
    setSyncQueue(demo.syncQueue);
    setTemplates(demo.templates);
    setCompanySheetSync(demo.companySheetSync);
    setSyncState("Synced");
    setScreen(getHomeScreenForRole(currentUser?.role || "Admin"));
    pushToast("Demo data loaded", "Realistic precast demo data is now active for review.", "success");
  };

  const handleClearDemoData = () => {
    setAudits((current) => current.filter((audit) => !audit.id.startsWith("audit-demo-")));
    setActions((current) => current.filter((action) => !action.id.startsWith("action-demo-") && action.companyId !== "demo-company"));
    setDrafts((current) => {
      const nextDrafts: Record<string, AuditDraft> = {};
      Object.entries(current).forEach(([auditId, draft]) => {
        if (!auditId.startsWith("audit-demo-")) {
          nextDrafts[auditId] = draft;
        }
      });
      return nextDrafts;
    });
    setSyncQueue((current) => current.filter((item) => !item.id.startsWith("sync-demo-") && !item.localId.includes("demo")));
    setTemplates((current) => current.filter((template) => !template.id.startsWith("template-demo-")));
    setCompanySheetSync((current) => (current?.sheetId === "demo-master-sheet" ? null : current));
    setScreen(getHomeScreenForRole(currentUser?.role || "Admin"));
    pushToast("Demo data cleared", "Demo-only records were removed from this tablet.", "neutral");
  };

  const handleOneClickGoogleOnboarding = async () => {
    if (!backendConfigured || !googleConnected) {
      pushToast(
        "Google Workspace needs setup",
        "Connect Google in Initial Setup before provisioning a company.",
        "warning",
      );
      return;
    }

    if (!folderIdInput || !masterSheetInput) {
      pushToast(
        "Missing links",
        "Paste the company folder and master sheet links first, then run one-click onboarding.",
        "warning",
      );
      return;
    }

    await handleAddFolder();
    handleVerifyOnboarding();
    handleVerifyAudits();
    handleVerifyResponseSheet();
    await handleSyncForms();
  };

  const handleApplyDashboardPreset = (preset: "minimal" | "operations" | "executive") => {
    if (preset === "minimal") {
      setDashboardPreferences({
        trafficBoard: true,
        liveSummary: true,
        upcomingAudits: false,
        openActions: true,
        complianceSnapshot: false,
      });
      setDashboardSectionOrder(["trafficBoard", "upcomingAudits", "openActions", "liveSummary", "complianceSnapshot"]);
      return;
    }
    if (preset === "operations") {
      setDashboardPreferences({
        trafficBoard: true,
        liveSummary: true,
        upcomingAudits: true,
        openActions: true,
        complianceSnapshot: true,
      });
      setDashboardSectionOrder(defaultDashboardSectionOrder());
      return;
    }
    setDashboardPreferences({
      trafficBoard: false,
      liveSummary: true,
      upcomingAudits: true,
      openActions: true,
      complianceSnapshot: true,
    });
    setDashboardSectionOrder(["liveSummary", "complianceSnapshot", "openActions", "upcomingAudits", "trafficBoard"]);
  };

  const handleToggleDashboardSection = (section: DashboardSectionKey) => {
    setDashboardPreferences((current) => ({ ...current, [section]: !current[section] }));
  };

  const handleMoveDashboardSection = (section: DashboardSectionKey, direction: "up" | "down") => {
    setDashboardSectionOrder((current) => {
      const index = current.indexOf(section);
      if (index < 0) return current;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const handleAddTemplate = () => {
    const trimmedName = templateNameInput.trim();

    if (!trimmedName) {
      pushToast("Template name required", "Enter a template name before adding it.", "warning");
      return;
    }

    const templateQuestions =
      templateDraftQuestions.length > 0
        ? templateDraftQuestions.map((question, index) => ({
            id: `${trimmedName}-custom-${index + 1}`,
            text: question.text,
            fieldType: question.fieldType,
            answerPrompts: question.answerPrompts,
          }))
        : buildDefaultQuestions(trimmedName);

    setTemplates((current) => [
      {
        id: `template-local-${Date.now()}`,
        name: trimmedName,
        active: true,
        questions: templateQuestions,
        source: "Built in app",
      },
      ...current,
    ]);
    if (syncState === "Synced") {
      setAudits((current) => [
        {
          id: `audit-local-${Date.now()}`,
          name: trimmedName,
          category: "Built in app",
          siteArea: selectedFolder?.name || "Main site",
          dueLabel: getDueLabel(24),
          dueHours: 24,
          priority: "Medium",
          owner: scheduleOwnerInput || DEFAULT_MANAGER_NAME,
          templateVersion: "Built in app",
          status: getAuditTrafficStatus(24),
          lastCompletedAt: "Not yet completed",
          questions: templateQuestions,
        },
        ...current,
      ]);
    }
    setTemplateNameInput("");
    setTemplateQuestionInput("");
    setTemplateDraftQuestions([]);
    pushToast("Template added", `${trimmedName} is now available in the audit template builder.`, "success");
  };

  const handleAddTemplateQuestion = () => {
    const trimmedQuestion = templateQuestionInput.trim();
    if (!trimmedQuestion) {
      pushToast("Question required", "Enter a question before adding it to the template builder.", "warning");
      return;
    }

    setTemplateDraftQuestions((current) => [
      ...current,
      {
        id: `draft-question-${Date.now()}`,
        text: trimmedQuestion,
        fieldType: templateQuestionTypeInput,
        answerPrompts: {},
      },
    ]);
    setTemplateQuestionInput("");
  };

  const handleAddAnswerPromptToDraftQuestion = (questionId: string, answer: Answer) => {
    if (!currentUser || !canAccessAdmin(currentUser.role)) {
      pushToast("Access restricted", "Only company administrators with full workspace rights can configure answer prompts.", "warning");
      return;
    }
    const promptText = window.prompt("Add action prompt for this answer");
    if (!promptText?.trim()) {
      return;
    }
    setTemplateDraftQuestions((current) =>
      current.map((question) => {
        if (question.id !== questionId) return question;
        const existing = question.answerPrompts?.[answer] || [];
        return {
          ...question,
          answerPrompts: {
            ...(question.answerPrompts || {}),
            [answer]: [...existing, promptText.trim()],
          },
        };
      }),
    );
  };

  const handleRemoveAnswerPromptFromDraftQuestion = (questionId: string, answer: Answer, promptIndex: number) => {
    setTemplateDraftQuestions((current) =>
      current.map((question) => {
        if (question.id !== questionId) return question;
        const existing = question.answerPrompts?.[answer] || [];
        return {
          ...question,
          answerPrompts: {
            ...(question.answerPrompts || {}),
            [answer]: existing.filter((_, index) => index !== promptIndex),
          },
        };
      }),
    );
  };

  const handleRemoveTemplateQuestion = (questionId: string) => {
    setTemplateDraftQuestions((current) => current.filter((question) => question.id !== questionId));
  };

  const handleToggleTemplate = (templateId: string) => {
    const existingTemplate = templates.find((template) => template.id === templateId);
    if (!existingTemplate) {
      return;
    }
    const toggledTemplate: AuditTemplate = { ...existingTemplate, active: !existingTemplate.active };
    setTemplates((current) =>
      current.map((template) => (template.id === templateId ? toggledTemplate : template)),
    );

    if (syncState !== "Synced") {
      return;
    }

    if (!toggledTemplate.active) {
      setAudits((current) => current.filter((audit) => audit.name !== toggledTemplate?.name));
      return;
    }

    setAudits((current) => [
      {
        id: `audit-toggle-${Date.now()}`,
        name: toggledTemplate.name,
        category: toggledTemplate.source,
        siteArea: selectedFolder?.name || "Main site",
        dueLabel: getDueLabel(24),
        dueHours: 24,
        priority: "Medium",
        owner: scheduleOwnerInput || DEFAULT_MANAGER_NAME,
        templateVersion: toggledTemplate.source,
        status: getAuditTrafficStatus(24),
        lastCompletedAt: "Not yet completed",
        questions: toggledTemplate.questions,
      },
      ...current,
    ]);
  };

  const handleSelectReportTemplate = (value: ReportTemplateType) => {
    setSelectedReportTemplate(value);
    setSelectedReportSections(reportTemplateDefaults[value]);
  };

  const handleToggleReportSection = (section: ReportSectionKey) => {
    setSelectedReportSections((current) => {
      if (current.includes(section)) {
        if (current.length === 1) {
          return current;
        }
        return current.filter((item) => item !== section);
      }
      return [...current, section];
    });
  };

  const buildReportSections = (): {
    title: string;
    intro: string;
    sections: [string, string[]][];
  } => {
    const title =
      reportTitleInput.trim() ||
      (selectedReportTemplate === "Overdue audit pack"
        ? "Overdue Audit Pack"
        : selectedReportTemplate === "Corrective action pack"
          ? "Corrective Action Pack"
          : selectedReportTemplate === "Evidence pack"
            ? "Evidence Pack"
            : selectedReportTemplate === "Full report"
              ? "Full Compliance Report"
            : "Executive Summary");

    const intro =
      selectedReportTemplate === "Overdue audit pack"
        ? `${workspaceName} overdue audit position with escalations and queue pressure.`
        : selectedReportTemplate === "Corrective action pack"
          ? `${workspaceName} corrective action view covering severity, ownership, and evidence.`
          : selectedReportTemplate === "Evidence pack"
            ? `${workspaceName} evidence-led pack showing captured proof items and related audit activity.`
            : selectedReportTemplate === "Full report"
              ? `${workspaceName} full compliance intelligence pack covering audits, actions, risks, schedules, and sync exceptions.`
            : `${workspaceName} executive audit overview covering compliance, actions, and readiness.`;

    const sectionMap: Record<ReportSectionKey, [string, string[]]> = {
      compliance: [
        "Live compliance",
        [
          `- Compliance: ${compliance}%`,
          `- Open actions: ${openActions.length}`,
          `- Overdue audits: ${overdueAudits.length}`,
          `- Completed today: ${completedToday}`,
        ],
      ],
      overdueAudits: [
        "Overdue audits",
        overdueAudits.length > 0
          ? overdueAudits.slice(0, 10).map((item) => `- ${item.name} | ${item.siteArea} | ${item.owner} | ${getDueWarning(item.dueHours)}`)
          : ["- No overdue audits"],
      ],
      correctiveActions: [
        "Corrective actions",
        actions.length > 0
          ? actions.slice(0, 12).map((item) => `- ${item.auditName} | ${item.severity} | ${item.owner} | ${item.status} | evidence ${item.evidenceCount}`)
          : ["- No corrective actions"],
      ],
      overdueActions: [
        "Overdue actions",
        overdueActions.length > 0
          ? overdueActions.slice(0, 12).map((item) => `- ${item.auditName} | ${item.severity} | ${item.assignedToName} | due ${item.dueDate || item.dueLabel}`)
          : ["- No overdue actions"],
      ],
      criticalFindings: [
        "Critical and high findings",
        actions.filter((item) => item.severity === "Critical" || item.severity === "High").length > 0
          ? actions
              .filter((item) => item.severity === "Critical" || item.severity === "High")
              .slice(0, 12)
              .map((item) => `- ${item.auditName} | ${item.questionText} | ${item.severity} | ${item.riskCategory}`)
          : ["- No critical or high findings"],
      ],
      repeatFailures: [
        "Repeat failures",
        recurringFailedQuestions.length > 0
          ? recurringFailedQuestions.map(([question, count]) => `- ${question} | repeated ${count} times`)
          : ["- No repeat failures"],
      ],
      evidence: [
        "Evidence summary",
        [
          `- Evidence captured: ${evidenceCount}`,
          `- Actions with evidence: ${actions.filter((item) => item.evidenceCount > 0).length}`,
        ],
      ],
      auditHistory: [
        "Audit history",
        history.length > 0
          ? history.slice(0, 10).map((item) => `- ${item.auditName} | ${item.status} | ${item.completedBy} | ${item.completedAt}`)
          : ["- No audit history yet"],
      ],
      verificationHistory: [
        "Verification history",
        actions.filter((item) => item.verifiedByUserId || item.status === "Closed").length > 0
          ? actions
              .filter((item) => item.verifiedByUserId || item.status === "Closed")
              .slice(0, 12)
              .map((item) => `- ${item.auditName} | ${item.status} | ${item.verifiedByUserId || "Not recorded"} | ${item.closedAt || item.verificationNotes || "Awaiting note"}`)
          : ["- No verification history yet"],
      ],
      scheduleCompliance: [
        "Schedule compliance",
        managedSchedules.length > 0
          ? managedSchedules.slice(0, 12).map((schedule) => `- ${schedule.scheduleName} | ${schedule.healthState || computeScheduleHealthState(schedule)} | missed ${schedule.missedAuditCount || 0} | next due ${schedule.nextDueAt || "Not set"}`)
          : ["- No schedules available"],
      ],
      auditCompletion: [
        "Audit completion summary",
        [
          `- Completed today: ${completedToday}`,
          `- Total history records: ${history.length}`,
          `- Completion rate: ${auditCompletionRate}%`,
        ],
      ],
      syncExceptions: [
        "Offline sync exceptions",
        syncQueue.length > 0
          ? syncQueue
              .filter((item) => item.status === "Failed" || item.status === "Conflict")
              .slice(0, 12)
              .map((item) => `- ${item.itemType} | ${item.status} | retries ${item.retryCount} | ${item.lastError || "No error message"}`)
          : ["- No sync exceptions"],
      ],
      templates: [
        "Templates",
        templates.length > 0
          ? templates.map((template) => `- ${template.name} | ${template.source} | ${template.active ? "Active" : "Inactive"}`)
          : ["- No templates available"],
      ],
      offlineQueue: [
        "Offline queue",
        [`- Offline queue: ${offlineQueue.length}`],
      ],
    };

    return {
      title,
      intro,
      sections: selectedReportSections.map((key) => sectionMap[key]),
    };
  };

  const handleExportAuditPack = () => {
    if (reportRecipients.length === 0) {
      pushToast("Recipients required", "Select who can see this report before exporting it.", "warning");
      return;
    }

    const timestamp = formatStamp();
    const reportDefinition = buildReportSections();
    const report = [
      reportDefinition.title,
      `Generated: ${timestamp}`,
      `Workspace: ${workspaceName}`,
      `Report type: ${selectedReportTemplate}`,
      "",
      reportDefinition.intro,
      "",
      ...reportDefinition.sections.flatMap(([heading, lines]) => [heading, ...lines, ""]),
    ].join("\n");

    downloadTextFile(`${reportDefinition.title.toLowerCase().replace(/\s+/g, "-")}.txt`, report);
    setReportInbox((current) => [
      {
        id: `report-text-${Date.now()}`,
        title: reportDefinition.title,
        type: "Text audit pack",
        createdAt: timestamp,
        createdBy: currentUser?.name || companyName,
        visibleTo: reportRecipients,
        template: selectedReportTemplate,
      },
      ...current,
    ]);
    pushToast("Audit pack exported", "A downloadable audit pack has been created for this workspace.", "success");
  };

  const handleExportAuditPackPdf = () => {
    if (reportRecipients.length === 0) {
      pushToast("Recipients required", "Select who can see this report before exporting it.", "warning");
      return;
    }

    const timestamp = formatStamp();
    const reportDefinition = buildReportSections();
    const html = `
      <h1>${reportDefinition.title}</h1>
      <p class="meta">Generated ${timestamp} for ${workspaceName}</p>
      <p>${reportDefinition.intro}</p>
      <div class="grid">
        <div class="card"><strong>Compliance</strong><p>${compliance}% live compliance</p></div>
        <div class="card"><strong>Open actions</strong><p>${openActions.length} open, ${overdueActions.length} overdue</p></div>
        <div class="card"><strong>Live audits</strong><p>${audits.length} active audits</p></div>
        <div class="card"><strong>Evidence</strong><p>${evidenceCount} captured evidence items</p></div>
      </div>
      ${reportDefinition.sections
        .map(
          ([heading, lines]) => `<h2>${heading}</h2><ul>${lines.map((line: string) => `<li>${line.replace(/^- /, "")}</li>`).join("")}</ul>`,
        )
        .join("")}
    `;

    const opened = openPrintableReport(reportDefinition.title, html);
    if (!opened) {
      pushToast("PDF export blocked", "Allow pop-ups on this device to open the printable PDF report view.", "warning");
      return;
    }

    setReportInbox((current) => [
      {
        id: `report-pdf-${Date.now()}`,
        title: reportDefinition.title,
        type: "PDF report",
        createdAt: timestamp,
        createdBy: currentUser?.name || companyName,
        visibleTo: reportRecipients,
        template: selectedReportTemplate,
      },
      ...current,
    ]);
    pushToast("PDF report opened", "The printable audit report view is ready to save as PDF.", "success");
  };

  const handleToggleReportRecipient = (email: string) => {
    setReportRecipients((current) =>
      current.includes(email) ? current.filter((item) => item !== email) : [...current, email],
    );
  };

  const handleAddSchedule = () => {
    if (!selectedFolder) {
      pushToast("Company required", "Select a company folder before creating a schedule.", "warning");
      return;
    }

    const trimmedName = scheduleNameInput.trim();
    const trimmedArea = scheduleAreaInput.trim();
    const trimmedOwner = scheduleOwnerInput.trim();
    const trimmedPersonalAssignee = schedulePersonalAssigneeInput.trim();
    const trimmedSendTime = scheduleSendTimeInput.trim();
    const recipients =
      scheduleScopeInput === "Personal schedule"
        ? [trimmedPersonalAssignee]
        : parsePeopleList(scheduleRecipientsInput);
    const overdueAlertRecipients = parsePeopleList(scheduleOverdueAlertRecipientsInput);
    const trimmedEscalationContact = scheduleEscalationContactInput.trim();
    const nextDueHours = Number(scheduleNextDueHoursInput);

    if (
      !trimmedName ||
      !trimmedArea ||
      !trimmedOwner ||
      (scheduleScopeInput === "Personal schedule" && !trimmedPersonalAssignee) ||
      !trimmedSendTime ||
      !trimmedEscalationContact ||
      recipients.length === 0 ||
      overdueAlertRecipients.length === 0 ||
      Number.isNaN(nextDueHours)
    ) {
      pushToast(
        "Details required",
        "Enter the audit details, send time, recipients, overdue alerts, and next due time before saving the schedule.",
        "warning",
      );
      return;
    }

    const auditId = `audit-${Date.now()}`;
    const newAudit: Audit = {
      id: auditId,
      name: trimmedName,
      category: "Scheduled Audit",
      siteArea: trimmedArea,
      dueLabel: getDueLabel(nextDueHours),
      dueHours: nextDueHours,
      priority: schedulePriorityInput,
      owner: scheduleScopeInput === "Personal schedule" ? trimmedPersonalAssignee : trimmedOwner,
      templateVersion: "v1.0",
      status: getAuditTrafficStatus(nextDueHours),
      lastCompletedAt: "Not completed yet",
      questions: buildDefaultQuestions(trimmedName),
    };

    const newSchedule: ScheduleItem = {
      id: `schedule-${Date.now()}`,
      companyFolderId: selectedFolder.id,
      auditId,
      auditName: trimmedName,
      siteArea: trimmedArea,
      owner: trimmedOwner,
      scope: scheduleScopeInput,
      personalAssignee: scheduleScopeInput === "Personal schedule" ? trimmedPersonalAssignee : "",
      frequency: scheduleFrequencyInput,
      sendTime: trimmedSendTime,
      recipients,
      overdueAlertRecipients,
      reportTo: trimmedEscalationContact,
      overdueAlertTiming: scheduleOverdueAlertTimingInput,
      completionCheckTiming: scheduleCompletionCheckTimingInput,
      nextDueHours,
      priority: schedulePriorityInput,
    };

    setAudits((current) => [newAudit, ...current]);
    setSchedules((current) => [newSchedule, ...current]);
    setScheduleNameInput("");
    setScheduleAreaInput("");
    setScheduleOwnerInput(DEFAULT_MANAGER_NAME);
    setScheduleScopeInput("Company schedule");
    setSchedulePersonalAssigneeInput(DEFAULT_AUDITOR_NAME);
    setScheduleFrequencyInput("Weekly");
    setScheduleSendTimeInput("08:00");
    setScheduleRecipientsInput(DEFAULT_AUDITOR_NAME);
    setScheduleOverdueAlertRecipientsInput(DEFAULT_MANAGER_NAME);
    setScheduleEscalationContactInput(DEFAULT_ESCALATION_NAME);
    setScheduleOverdueAlertTimingInput("At due time");
    setScheduleCompletionCheckTimingInput("At due time");
    setScheduleNextDueHoursInput("24");
    setSchedulePriorityInput("Medium");
    pushToast(
      "Schedule created",
      `${trimmedName} is now scheduled for ${selectedFolder.name} as a ${scheduleScopeInput.toLowerCase()}.`,
      "success",
    );
  };

  const resetManagedScheduleDraft = () => {
    setEditingScheduleId(null);
    setScheduleDraftName("");
    setScheduleDraftSelectedAuditIds([]);
    setScheduleDraftAudits([]);
    setScheduleDraftStartDate("");
    setScheduleDraftEndDate("");
    setScheduleDraftContinuous(true);
    setScheduleDraftAuditors([]);
    setScheduleValidationAttempted(false);
    setScheduleEditorOpen(false);
  };

  const handleOpenNewSchedule = () => {
    setEditingScheduleId(null);
    setScheduleDraftName("");
    setScheduleDraftSelectedAuditIds([]);
    setScheduleDraftAudits([]);
    setScheduleDraftStartDate(new Date().toISOString().slice(0, 10));
    setScheduleDraftEndDate("");
    setScheduleDraftContinuous(true);
    setScheduleDraftAuditors([]);
    setScheduleValidationAttempted(false);
    setScheduleEditorOpen(true);
  };

  const handleOpenSchedule = (scheduleId: string) => {
    const schedule = managedSchedules.find((item) => item.id === scheduleId);
    if (!schedule) {
      return;
    }

    setEditingScheduleId(scheduleId);
    setScheduleDraftName(schedule.scheduleName);
    setScheduleDraftSelectedAuditIds(schedule.audits.map((audit) => audit.auditId));
    setScheduleDraftAudits(schedule.audits);
    setScheduleDraftStartDate(schedule.startDate);
    setScheduleDraftEndDate(schedule.endDate);
    setScheduleDraftContinuous(!schedule.endDate);
    setScheduleDraftAuditors(schedule.auditors);
    setScheduleValidationAttempted(false);
    setScheduleEditorOpen(true);
  };

  const handleToggleScheduleAudit = (auditId: string, auditName: string) => {
    setScheduleDraftSelectedAuditIds((current) =>
      current.includes(auditId) ? current.filter((item) => item !== auditId) : [...current, auditId],
    );

    setScheduleDraftAudits((current) => {
      const existing = current.find((item) => item.auditId === auditId);
      if (existing) {
        return current.filter((item) => item.auditId !== auditId);
      }
      return [
        ...current,
        {
          id: `schedule-audit-${Date.now()}-${auditId}`,
          auditId,
          auditName,
          days: [],
          frequency: "Weekly",
          liveTime: "08:00",
          completionHours: 24,
        },
      ];
    });
  };

  const handleToggleScheduleAuditDay = (auditId: string, day: ScheduleDay) => {
    setScheduleDraftAudits((current) =>
      current.map((audit) =>
        audit.auditId === auditId
          ? {
              ...audit,
              days: audit.days.includes(day) ? audit.days.filter((item) => item !== day) : [...audit.days, day],
            }
          : audit,
      ),
    );
  };

  const handleUpdateScheduleAuditField = (
    auditId: string,
    field: "frequency" | "liveTime" | "completionHours",
    value: string,
  ) => {
    setScheduleDraftAudits((current) =>
      current.map((audit) =>
        audit.auditId === auditId
          ? {
              ...audit,
              [field]: field === "completionHours" ? Number(value) : value,
            }
          : audit,
      ),
    );
  };

  const handleToggleScheduleAuditor = (name: string) => {
    setScheduleDraftAuditors((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  const handleSaveManagedSchedule = async () => {
    if (!selectedFolder) {
      pushToast("Company required", "Link a company before creating schedules.", "warning");
      return;
    }

    setScheduleValidationAttempted(true);

    const trimmedName = scheduleDraftName.trim();
    const invalidAuditConfig = scheduleDraftAudits.some(
      (audit) =>
        audit.days.length === 0 ||
        !audit.frequency ||
        !audit.liveTime ||
        !audit.completionHours,
    );

    if (
      !trimmedName ||
      scheduleDraftAudits.length === 0 ||
      !scheduleDraftStartDate ||
      scheduleDraftAuditors.length === 0 ||
      invalidAuditConfig
    ) {
      pushToast("Schedule details missing", "Complete all required schedule fields before saving.", "warning");
      return;
    }

    const editingSchedule = editingScheduleId
      ? managedSchedules.find((item) => item.id === editingScheduleId) || null
      : null;
    const rootId = editingSchedule?.rootId || `schedule-root-${Date.now()}`;
    const nextVersion = editingSchedule ? editingSchedule.versionNumber + 1 : 1;
    const resolvedEndDate = scheduleDraftContinuous ? "" : scheduleDraftEndDate;
    const lifecycle: ScheduleLifecycle = resolvedEndDate ? "Archived" : "Live";

    const nextSchedule: ManagedSchedule = {
      id: `schedule-${Date.now()}`,
      rootId,
      versionNumber: nextVersion,
      versionLabel: formatScheduleVersionLabel(nextVersion),
      lifecycle,
      companyFolderId: selectedFolder.id,
      scheduleName: trimmedName,
      audits: scheduleDraftAudits,
      auditors: scheduleDraftAuditors,
      startDate: scheduleDraftStartDate,
      endDate: resolvedEndDate,
      updatedAt: formatStamp(),
    };

    const nextManagedSchedules = !editingSchedule
      ? [nextSchedule, ...managedSchedules]
      : [
          {
            ...editingSchedule,
            lifecycle: "Archived" as ScheduleLifecycle,
          },
          nextSchedule,
          ...managedSchedules.filter((item) => item.id !== editingSchedule.id),
        ];

    try {
      await persistManagedSchedules(
        selectedFolder.id,
        nextManagedSchedules.filter((schedule) => schedule.companyFolderId === selectedFolder.id),
      );
      setManagedSchedules(nextManagedSchedules);
    } catch (error) {
      pushToast(
        "Schedule save failed",
        error instanceof Error ? error.message : "Unable to save the schedule to the company master sheet.",
        "warning",
      );
      return;
    }

    pushToast(
      lifecycle === "Archived" ? "Schedule archived" : editingSchedule ? "Schedule updated" : "Schedule created",
      lifecycle === "Archived"
        ? `${trimmedName} has been archived as revision ${nextSchedule.versionLabel}.`
        : `${trimmedName} is now saved as revision ${nextSchedule.versionLabel}.`,
      "success",
    );

    resetManagedScheduleDraft();
  };

  const handleReactivateSchedule = (scheduleId: string) => {
    const schedule = managedSchedules.find((item) => item.id === scheduleId);
    if (!schedule) {
      return;
    }

    setEditingScheduleId(scheduleId);
    setScheduleDraftName(schedule.scheduleName);
    setScheduleDraftSelectedAuditIds(schedule.audits.map((audit) => audit.auditId));
    setScheduleDraftAudits(schedule.audits);
    setScheduleDraftStartDate(new Date().toISOString().slice(0, 10));
    setScheduleDraftEndDate("");
    setScheduleDraftContinuous(true);
    setScheduleDraftAuditors(schedule.auditors);
    setScheduleValidationAttempted(false);
    setScheduleEditorOpen(true);
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    const schedule = managedSchedules.find((item) => item.id === scheduleId);
    if (!schedule) return;
    const confirmed = window.confirm(`Delete "${schedule.scheduleName}" (${schedule.versionLabel})? This cannot be undone.`);
    if (!confirmed) return;

    const nextManagedSchedules = managedSchedules.filter((item) => item.id !== scheduleId);
    try {
      if (selectedFolder?.id) {
        await persistManagedSchedules(selectedFolder.id, nextManagedSchedules);
      }
      setManagedSchedules(nextManagedSchedules);
      if (editingScheduleId === scheduleId) {
        resetManagedScheduleDraft();
      }
      pushToast("Schedule deleted", `${schedule.scheduleName} has been removed.`, "success");
    } catch (error) {
      pushToast(
        "Delete failed",
        error instanceof Error ? error.message : "Unable to delete the schedule from the company master sheet.",
        "warning",
      );
    }
  };

  const handlePauseSchedule = async (scheduleId: string) => {
    const schedule = managedSchedules.find((item) => item.id === scheduleId);
    if (!schedule) return;
    const input = window.prompt(`Pause "${schedule.scheduleName}" for how many days?`, "7");
    if (input === null) return;
    const days = Number(input.trim());
    if (!Number.isFinite(days) || days <= 0) {
      pushToast("Invalid duration", "Enter a number of days greater than 0.", "warning");
      return;
    }
    const pausedUntil = addDaysIso(Math.round(days));
    const nextManagedSchedules = managedSchedules.map((item) =>
      item.id === scheduleId
        ? {
            ...item,
            healthState: "Paused" as ScheduleHealthState,
            nextDueAt: pausedUntil,
            updatedAt: formatStamp(),
          }
        : item,
    );
    try {
      if (selectedFolder?.id) {
        await persistManagedSchedules(selectedFolder.id, nextManagedSchedules);
      }
      setManagedSchedules(nextManagedSchedules);
      pushToast("Schedule paused", `${schedule.scheduleName} paused until ${pausedUntil}.`, "success");
    } catch (error) {
      pushToast(
        "Pause failed",
        error instanceof Error ? error.message : "Unable to pause the schedule in the company master sheet.",
        "warning",
      );
    }
  };

  const handleResumeSchedule = async (scheduleId: string) => {
    const schedule = managedSchedules.find((item) => item.id === scheduleId);
    if (!schedule) return;
    const nextManagedSchedules = managedSchedules.map((item) =>
      item.id === scheduleId
        ? {
            ...item,
            healthState: undefined,
            nextDueAt: "",
            updatedAt: formatStamp(),
          }
        : item,
    );
    try {
      if (selectedFolder?.id) {
        await persistManagedSchedules(selectedFolder.id, nextManagedSchedules);
      }
      setManagedSchedules(nextManagedSchedules);
      pushToast("Schedule resumed", `${schedule.scheduleName} is active again.`, "success");
    } catch (error) {
      pushToast(
        "Resume failed",
        error instanceof Error ? error.message : "Unable to resume the schedule in the company master sheet.",
        "warning",
      );
    }
  };

  const persistManagedSchedules = async (companyFolderId: string, nextSchedules: ManagedSchedule[]) => {
    const sheetId = companySheetSync?.sheetId || extractGoogleResourceId(masterSheetInput);
    if (!sheetId) {
      throw new Error("Company master sheet link is required before saving schedules.");
    }

    const response = await fetch(apiUrl(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/schedules`), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyFolderId,
        schedules: nextSchedules,
      }),
    });

    const payload = (await response.json()) as SaveSchedulesResponse;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Unable to save schedules.");
    }
  };

  useEffect(() => {
    loadGoogleStatus({ silent: true });
  }, []);

  useEffect(() => {
    document.title = companyName;
  }, [companyName]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google") === "connected") {
      loadGoogleStatus();
      loadOnboardingRecords({ silent: true });
      pushToast("Google connected", "Shared Google Drive access is now active.", "success");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const params = new URLSearchParams(window.location.search);
    const requestedScreen = params.get("screen");
    if (requestedScreen === "incidents" && canSubmitIncidents(currentUser.role)) {
      setScreen("incidents");
    }
  }, [currentUser]);

  useEffect(() => {
    if (googleConnected) {
      loadOnboardingRecords({ silent: true });
    } else {
      setOnboardingRecords([]);
      setSelectedOnboardingRecordId("");
    }
  }, [googleConnected]);

  useEffect(() => {
    if (currentUser && !canAccessControlScreen(currentUser.role) && screen === "admin") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessOnboardingNav(currentUser.role) && screen === "onboarding") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessSchedules(currentUser.role) && screen === "schedules") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessDocumentTraining(currentUser.role) && screen === "documentTraining") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessEmailReminders(currentUser.role) && screen === "emailReminders") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessPilotSetup(currentUser.role) && screen === "setup") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessPilotCompanies(currentUser.role) && screen === "companies") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessPilotUsers(currentUser.role) && screen === "users") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessPilotInvites(currentUser.role) && screen === "invites") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessPilotSettings(currentUser.role) && screen === "settings") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessGodmodeInitialSetup(currentUser.role) && screen === "setupInitial") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessReports(currentUser.role) && screen === "reports") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessActions(currentUser.role) && screen === "actions") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessActions(currentUser.role) && screen === "nonConformance") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canSubmitIncidents(currentUser.role) && screen === "incidents") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (currentUser && !canAccessAuditsCentre(currentUser.role) && screen === "audits") {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (
      currentUser &&
      screen === "complete" &&
      !activeAudit &&
      !(canCompleteAuditAsAuditor(currentUser.role) && auditCompletionSummary)
    ) {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
    if (
      currentUser &&
      screen !== "complete" &&
      screen !== "setupInitial" &&
      !visibleNavItems.some((item) => item.id === screen) &&
      !canRoleAccessNavItem(currentUser.role, screen)
    ) {
      setScreen(getHomeScreenForRole(currentUser.role));
    }
  }, [currentUser, screen, visibleNavItems, activeAudit, auditCompletionSummary]);

  let inviteTokenFromUrl = "";
  try {
    inviteTokenFromUrl = new URLSearchParams(window.location.search).get("invite")?.trim() || "";
  } catch {
    inviteTokenFromUrl = "";
  }
  if (inviteTokenFromUrl) {
    return <AppHostedOnboardingCompletion inviteToken={inviteTokenFromUrl} parseJsonApiResponse={parseJsonApiResponse} />;
  }

  if (!currentUser) {
    const signInOuterClass = [
      shellPreviewClass,
      "flex min-h-[100dvh] w-full max-w-[100vw] flex-col items-center justify-center overflow-hidden px-3 py-4 sm:px-4 sm:py-5",
      themeMode === "dark" ? `${qmsDarkShellGradient} text-slate-100` : `${qmsLightShellGradient} text-slate-900`,
    ].join(" ");

    const signInShellClass = [
      "qms-login-shell qms-login-card relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[2.2rem] border p-3 backdrop-blur sm:p-4",
      themeMode === "dark"
        ? "border-slate-800/80 bg-slate-950/80 shadow-[0_32px_90px_rgba(2,6,23,0.58)] text-white"
        : "border-slate-200/85 bg-white/90 shadow-[0_28px_80px_rgba(15,23,42,0.14)] text-slate-900",
    ].join(" ");

    const signInTabletChrome = isDebugUiAllowed();
    const signInLogoVariant = signInTabletChrome ? "mark" : "full";

    const wrapSignInTabletChrome = (node: React.ReactNode) =>
      signInTabletChrome ? (
        <div className="qms-tablet-stage">
          <div className="qms-tablet-device qms-tablet-device--signin">{node}</div>
        </div>
      ) : (
        node
      );

    if (companySetupLoginPortal) {
      return (
        <div className={signInOuterClass}>
          <style>{appMotionStyles}</style>
          {wrapSignInTabletChrome(
            <div data-qms-theme={themeMode} className={signInShellClass}>
                <DataFlowBackground />
                <div className="relative z-10 grid h-full min-h-0 w-full grid-cols-1 items-center gap-3 sm:grid-cols-2 sm:gap-4">
                  <div className="flex flex-col justify-center gap-3 px-1 py-0 sm:px-2">
                    <BertLogo variant={signInLogoVariant} tone={themeMode === "dark" ? "onDark" : "onLight"} size="lg" className="w-full" />
                    <p className="text-xs font-medium text-slate-500 sm:text-sm sm:text-slate-400">
                      Workspace setup — new company sign-in only
                    </p>
                  </div>
                  <div className="flex min-h-0 items-center">
                    <div className="w-full rounded-2xl border border-white/10 bg-white/[0.06] p-3 shadow-[0_16px_40px_rgba(2,6,23,0.4)] backdrop-blur-xl sm:rounded-[1.5rem] sm:p-4">
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            const url = new URL(window.location.href);
                            url.searchParams.delete("setup");
                            window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
                          } catch {
                            window.history.replaceState({}, "", window.location.pathname);
                          }
                          setCompanySetupLoginPortal(false);
                        }}
                        className="mb-3 text-left text-xs font-semibold text-blue-400 transition hover:text-orange-200 sm:text-sm"
                      >
                        ← Staff sign-in
                      </button>
                      <h2 className="text-center text-base font-semibold text-white sm:text-lg">Workspace setup (Master)</h2>
                      <p className="mt-2 rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2 text-xs leading-snug text-slate-300 sm:text-sm">
                        Use a <span className="font-semibold text-white">Master</span> account to onboard customer workspaces. Sign in with the
                        workspace setup (Master) account only. You will stay in <span className="font-semibold text-white">Setup</span> until you
                        sign out — no other areas of the app are available from here.
                      </p>
                      <p className="mt-2 text-center text-[11px] text-slate-400 sm:text-xs">
                        {!isDemoLoginEnabled ? (
                          <>
                            Use your <span className="font-semibold text-white">Master email or username</span> from the API host operator
                            store (see <span className="font-semibold text-white">docs/deployment-runbook.md</span>). Password is checked on
                            the server — it is never stored in the app bundle.
                          </>
                        ) : (
                          <>
                            Demo: you may use username <span className="font-semibold text-white">{GOD_MODE_USERNAME}</span> with{" "}
                            <span className="font-semibold text-white">VITE_GODMODE_PASSWORD</span>, or a seeded Master email with server
                            login.
                          </>
                        )}
                      </p>
                      {!isDemoLoginEnabled && !loginUsers.some((user) => user.role === "Master") ? (
                        <p className="mt-2 rounded-xl border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-[11px] leading-snug text-amber-50 sm:text-xs">
                          No client-side Master demo user is bundled. Seed the Master operator on the API host (see deployment runbook), then
                          sign in here with that email or username and password.
                        </p>
                      ) : null}
                      <form className="mt-3 space-y-2.5 sm:mt-4 sm:space-y-3" onSubmit={(event) => { event.preventDefault(); void handleLogin(); }}>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-100 sm:text-sm">Username or email</label>
                          <div className="relative">
                            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-slate-400 sm:left-3.5 sm:h-5 sm:w-5" strokeWidth="2">
                              <path d="M20 21a8 8 0 0 0-16 0" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                            <input
                              value={username}
                              onChange={(event) => setUsername(event.target.value)}
                              placeholder="Email or username"
                              className="h-11 w-full rounded-xl border border-white/10 bg-slate-950/45 pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/15 sm:h-12 sm:rounded-2xl sm:pl-11 sm:pr-4 sm:text-base"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-100 sm:text-sm">Password</label>
                          <div className="relative">
                            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-slate-400 sm:left-3.5 sm:h-5 sm:w-5" strokeWidth="2">
                              <rect x="4" y="11" width="16" height="10" rx="2" />
                              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                            </svg>
                            <input
                              type={showPassword ? "text" : "password"}
                              value={password}
                              onChange={(event) => setPassword(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  void handleLogin();
                                }
                              }}
                              placeholder="Master password"
                              className="h-11 w-full rounded-xl border border-white/10 bg-slate-950/45 pl-10 pr-11 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/15 sm:h-12 sm:rounded-2xl sm:pl-11 sm:pr-12 sm:text-base"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((current) => !current)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-blue-400 sm:right-3.5"
                              aria-label={showPassword ? "Hide password" : "Show password"}
                            >
                              {showPassword ? (
                                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2">
                                  <path d="M3 3l18 18" />
                                  <path d="M10.6 10.6a2 2 0 1 0 2.8 2.8" />
                                  <path d="M9.9 4.2A10.2 10.2 0 0 1 21 12a10.9 10.9 0 0 1-4.1 5.2" />
                                  <path d="M6.5 6.5A11.3 11.3 0 0 0 3 12a10.9 10.9 0 0 0 9 6 9.8 9.8 0 0 0 3.2-.5" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2">
                                  <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                        <button
                          type="submit"
                          className={`h-11 w-full rounded-xl bg-gradient-to-r from-orange-400 to-orange-600 text-sm font-semibold text-slate-950 shadow-[0_10px_22px_rgba(249,115,22,0.22)] active:scale-[0.99] sm:h-12 sm:rounded-2xl sm:text-base ${slatePrimaryCtaInteract}`}
                        >
                          Sign in for company setup
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              </div>
          )}
          <ToastStack toasts={toasts} />
        </div>
      );
    }

    return (
      <div className={signInOuterClass}>
        <style>{appMotionStyles}</style>
        {wrapSignInTabletChrome(
            <div
              data-qms-theme={themeMode}
              className={signInShellClass}
            >
              <DataFlowBackground />
              <div className="absolute right-4 top-4 z-20 flex items-center gap-1.5 sm:right-6 sm:top-6">
                <button
                  type="button"
                  className="rounded-full border border-slate-700 bg-slate-900/75 p-2 text-slate-300 transition hover:border-orange-400/60 hover:text-blue-400"
                  aria-label="Help"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-.8.7-1.7 1.2-1.7 2.2" />
                    <circle cx="12" cy="16.8" r="0.8" fill="currentColor" stroke="none" />
                  </svg>
                </button>
                <button
                  type="button"
                  title="Workspace setup (Master only)"
                  aria-label="Company setup sign-in for workspace setup (Master)"
                  onClick={() => {
                    try {
                      const url = new URL(window.location.href);
                      url.searchParams.set("setup", "master");
                      window.history.pushState({}, "", url.toString());
                    } catch {
                      window.history.pushState({}, "", "?setup=master");
                    }
                    setCompanySetupLoginPortal(true);
                  }}
                  className="rounded-full border border-slate-700/90 bg-slate-900/60 p-1.5 text-slate-400 transition hover:border-orange-400/55 hover:text-orange-300"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2">
                    <path d="M12 3l7 4v5c0 4-2.5 7.5-7 8.5-4.5-1-7-4.5-7-8.5V7z" />
                    <path d="M12 11v3M12 8h.01" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="rounded-full border border-slate-700 bg-slate-900/75 p-2 text-slate-300 transition hover:border-orange-400/60 hover:text-blue-400"
                  aria-label="Settings"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2">
                    <path d="M12 3.5l1 2.1 2.4.4-.9 2.2 1.7 1.8-1.7 1.8.9 2.2-2.4.4-1 2.1-1-2.1-2.4-.4.9-2.2-1.7-1.8 1.7-1.8-.9-2.2 2.4-.4z" />
                    <circle cx="12" cy="12" r="2.4" />
                  </svg>
                </button>
              </div>

              <div className="relative z-10 grid h-full min-h-0 w-full grid-cols-1 items-center gap-3 sm:grid-cols-2 sm:gap-4">
                <div className="flex flex-col justify-center gap-3 px-1 py-0 sm:px-2">
                  <BertLogo
                    variant={signInLogoVariant}
                    tone={themeMode === "dark" ? "onDark" : "onLight"}
                    size="lg"
                    className="w-full"
                  />
                  <p className="text-xs font-medium text-slate-500 sm:text-sm sm:text-slate-400">{PRODUCT_TAGLINE}</p>
                </div>

                <div className="flex min-h-0 items-center">
                  <div className="w-full rounded-2xl border border-white/10 bg-white/[0.06] p-3 shadow-[0_16px_40px_rgba(2,6,23,0.4)] backdrop-blur-xl sm:rounded-[1.5rem] sm:p-4">
                    <h2 className="text-center text-base font-semibold text-white sm:text-lg">Sign in to your account</h2>
                    {isDemoLoginEnabled ? (
                      <p className="mt-2 rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2 text-xs text-slate-300 sm:text-sm">
                        Demo accounts: <span className="font-semibold text-white">admin</span>,{" "}
                        <span className="font-semibold text-white">manager</span>,{" "}
                        <span className="font-semibold text-white">tom</span>,{" "}
                        <span className="font-semibold text-white">{GOD_MODE_USERNAME}</span> — set passwords in{" "}
                        <span className="font-semibold text-white">VITE_DEMO_USER_PASSWORD</span> and{" "}
                        <span className="font-semibold text-white">VITE_GODMODE_PASSWORD</span> (see <span className="font-semibold text-white">.env.example</span>).
                      </p>
                    ) : (
                      <p className="mt-2 rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2 text-xs text-slate-300 sm:text-sm">
                        Demo login is disabled in this build. Use an invited account or ask a BERT administrator to create access. BERT
                        Master operators sign in with their server-registered email or username (see deployment runbook).
                      </p>
                    )}
                    {!isDemoLoginEnabled && loginUsers.length === 0 ? (
                      <p className="mt-2 rounded-xl border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-[11px] leading-snug text-amber-50 sm:text-xs">
                        No sign-in accounts are available in this build (demo accounts are off, and no invites are loaded). For local
                        testing use <span className="font-semibold">npm run dev</span>, or rebuild with{" "}
                        <span className="font-semibold">VITE_ENABLE_DEMO_LOGIN=true</span>. Otherwise use an invited email and the
                        password your administrator issued once onboarding is connected.
                      </p>
                    ) : null}
                    <form className="mt-3 space-y-2.5 sm:mt-4 sm:space-y-3" onSubmit={(event) => { event.preventDefault(); void handleLogin(); }}>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-100 sm:text-sm">Username or email</label>
                        <div className="relative">
                          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-slate-400 sm:left-3.5 sm:h-5 sm:w-5" strokeWidth="2">
                            <path d="M20 21a8 8 0 0 0-16 0" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                          <input
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            placeholder="Enter username or email"
                            className="h-11 w-full rounded-xl border border-white/10 bg-slate-950/45 pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/15 sm:h-12 sm:rounded-2xl sm:pl-11 sm:pr-4 sm:text-base"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-100 sm:text-sm">Password</label>
                        <div className="relative">
                          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-slate-400 sm:left-3.5 sm:h-5 sm:w-5" strokeWidth="2">
                            <rect x="4" y="11" width="16" height="10" rx="2" />
                            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                          </svg>
                          <input
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                void handleLogin();
                              }
                            }}
                            placeholder="Enter password"
                            className="h-11 w-full rounded-xl border border-white/10 bg-slate-950/45 pl-10 pr-11 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/15 sm:h-12 sm:rounded-2xl sm:pl-11 sm:pr-12 sm:text-base"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((current) => !current)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-blue-400 sm:right-3.5"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? (
                              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2">
                                <path d="M3 3l18 18" />
                                <path d="M10.6 10.6a2 2 0 1 0 2.8 2.8" />
                                <path d="M9.9 4.2A10.2 10.2 0 0 1 21 12a10.9 10.9 0 0 1-4.1 5.2" />
                                <path d="M6.5 6.5A11.3 11.3 0 0 0 3 12a10.9 10.9 0 0 0 9 6 9.8 9.8 0 0 0 3.2-.5" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2">
                                <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-end pt-0.5">
                        <button type="button" className="text-xs font-medium text-blue-400 transition hover:text-orange-200 sm:text-sm">
                          Forgot password?
                        </button>
                      </div>

                      <button
                        type="submit"
                        className={`h-11 w-full rounded-xl bg-gradient-to-r from-orange-400 to-orange-600 text-sm font-semibold text-slate-950 shadow-[0_10px_22px_rgba(249,115,22,0.22)] active:scale-[0.99] sm:h-12 sm:rounded-2xl sm:text-base ${slatePrimaryCtaInteract}`}
                      >
                        Sign in
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          )}
          <ToastStack toasts={toasts} />
        </div>
    );
  }

  const tabletDebugUi = isDebugUiAllowed();
  const tabletChromeLogoVariant = tabletDebugUi ? "mark" : "wordmark";
  const wrapLoggedInTabletChrome = (node: React.ReactNode) =>
    tabletDebugUi ? (
      <div className="qms-tablet-stage">
        <div className="qms-tablet-device">{node}</div>
      </div>
    ) : (
      node
    );

  const loggedInRootClass = [
    shellPreviewClass,
    tabletDebugUi
      ? "h-[100dvh] overflow-hidden px-2 py-2 sm:px-3 sm:py-3"
      : "flex min-h-[100dvh] h-[100dvh] w-full max-w-[100vw] flex-col overflow-hidden",
    themeMode === "dark" ? `${qmsDarkShellGradient} text-slate-100` : `${qmsLightShellGradient} text-slate-900`,
  ]
    .filter(Boolean)
    .join(" ");

  const appShellSurfaceClass = [
    "qms-app-shell relative isolate flex w-full flex-col overflow-hidden border backdrop-blur",
    tabletDebugUi ? "mx-auto h-full rounded-[2.25rem]" : "mx-0 min-h-0 flex-1 rounded-none",
    themeMode === "dark"
      ? tabletDebugUi
        ? "border-white/10 bg-slate-950/72 shadow-[0_28px_90px_rgba(2,6,23,0.55)]"
        : "border-white/10 bg-slate-950/80"
      : tabletDebugUi
        ? "border-slate-200/90 bg-white/86 shadow-[0_28px_90px_rgba(15,23,42,0.12)]"
        : "border-slate-200/90 bg-white/95",
  ].join(" ");

  return (
    <div className={loggedInRootClass}>
      <style>{appMotionStyles}</style>
      {wrapLoggedInTabletChrome(
          <div data-qms-theme={themeMode} className={appShellSurfaceClass}>
        <DataFlowBackground className="z-20 opacity-10" showBase={false} />
        <header className={["qms-app-header relative z-10 border-b px-3 pb-1 pt-1 backdrop-blur", themeMode === "dark" ? "border-white/10 bg-slate-950/58" : "border-slate-200/80 bg-white/72"].join(" ")}>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[9px] font-semibold uppercase tracking-[0.16em]">
            {godCompanySetupOnlyShell ? (
              <div
                className={[
                  "rounded-full px-2.5 py-0.5",
                  themeMode === "dark" ? "bg-slate-900 text-slate-400" : "border border-[var(--bert-signal-orange)] bg-white font-semibold text-[var(--qms-navy-900)]",
                ].join(" ")}
              >
                Workspace setup (Master)
              </div>
            ) : isDebugUiAllowed() ? (
              <div
                className={[
                  "rounded-full px-2.5 py-0.5",
                  themeMode === "dark" ? "bg-slate-900 text-slate-400" : "border border-[var(--bert-signal-orange)] bg-white font-semibold text-[var(--qms-navy-900)]",
                ].join(" ")}
              >
                Tablet workspace
              </div>
            ) : (
              <span className="sr-only">Status</span>
            )}
            <div className="flex items-center gap-1">
              {isDebugUiAllowed() && demoRoleSwitchEnabled && !godCompanySetupOnlyShell && <div className="hidden items-center gap-1 lg:flex">
                {currentUser.role !== "Admin" && (
                <button
                  type="button"
                  title={roles[0]}
                  onClick={() => handleQuickRoleSwitch("Master", "Workspace setup")}
                  className={["rounded-full border px-2 py-0.5 text-[8px] font-semibold", themeMode === "dark" ? "border-[var(--bert-signal-orange)]/50 bg-slate-900 text-[var(--bert-chrome-accent)]" : "border-[var(--bert-signal-orange)] bg-white text-[var(--qms-navy-900)] hover:bg-orange-50"].join(" ")}
                >
                  OWNER
                </button>
                )}
                <button
                  type="button"
                  onClick={() => handleQuickRoleSwitch("Admin", "Admin")}
                  className={["rounded-full border px-2 py-0.5 text-[8px] font-semibold", themeMode === "dark" ? "border-[var(--bert-signal-orange)]/50 bg-slate-900 text-[var(--bert-chrome-accent)]" : "border-[var(--bert-signal-orange)] bg-white text-[var(--qms-navy-900)] hover:bg-orange-50"].join(" ")}
                >
                  ADMIN
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickRoleSwitch("Manager", "Manager")}
                  className={["rounded-full border px-2 py-0.5 text-[8px] font-semibold", themeMode === "dark" ? "border-[var(--bert-signal-orange)]/50 bg-slate-900 text-[var(--bert-chrome-accent)]" : "border-[var(--bert-signal-orange)] bg-white text-[var(--qms-navy-900)] hover:bg-orange-50"].join(" ")}
                >
                  MANAGER
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickRoleSwitch("Auditor", "Auditor")}
                  className={["rounded-full border px-2 py-0.5 text-[8px] font-semibold", themeMode === "dark" ? "border-[var(--bert-signal-orange)]/50 bg-slate-900 text-[var(--bert-chrome-accent)]" : "border-[var(--bert-signal-orange)] bg-white text-[var(--qms-navy-900)] hover:bg-orange-50"].join(" ")}
                >
                  AUDITOR
                </button>
              </div>}
              {isDebugUiAllowed() && !godCompanySetupOnlyShell && (
              <button
                type="button"
                onClick={() => setScreen(getHomeScreenForRole(currentUser.role))}
                className={["rounded-full border px-1.5 py-0 text-[8px]", themeMode === "dark" ? `border-slate-700 bg-slate-900 text-slate-300 ${slatePrimaryCtaInteract}` : "border-[var(--bert-signal-orange)] bg-white text-[var(--qms-navy-900)] transition-colors hover:bg-orange-50"].join(" ")}
              >
                Layout options
              </button>
              )}
              {isDebugUiAllowed() && !godCompanySetupOnlyShell && (
              <button
                onClick={() => setPreviewOrientation(previewOrientation === "landscape" ? "portrait" : "landscape")}
                className={["rounded-full border px-2 py-0.5 text-[8px]", themeMode === "dark" ? `border-slate-700 bg-slate-900 text-slate-300 ${slatePrimaryCtaInteract}` : "border-[var(--bert-signal-orange)] bg-white text-[var(--qms-navy-900)] transition-colors hover:bg-orange-50"].join(" ")}
              >
                {previewOrientation === "landscape" ? "Portrait preview" : "Landscape preview"}
              </button>
              )}
              <div className={["rounded-full px-2 py-0.5", offlineMode ? "bg-amber-500/15 text-amber-600" : "bg-blue-500/12 text-blue-800"].join(" ")}>
                {offlineMode ? "Offline" : "Online"}
              </div>
              <div
                className={[
                  "rounded-full border px-2 py-0.5 text-[8px] font-semibold normal-case tracking-normal",
                  themeMode === "dark" ? "border-slate-700 bg-slate-900 text-slate-300" : "border-slate-200 bg-white text-slate-700",
                ].join(" ")}
              >
                {syncPlainSummary}
              </div>
              <div className={["rounded-full border px-2 py-0.5 text-[8px]", themeMode === "dark" ? "border-slate-700 bg-slate-900 text-slate-300" : "border-[var(--bert-signal-orange)] bg-white text-[var(--qms-navy-900)]"].join(" ")}>
                {deviceTimeLabel}
              </div>
            </div>
          </div>
          <div className="qms-app-header-main">
            <div className="flex items-center gap-2">
              <div className="hidden shrink-0 pr-0.5 sm:block">
                <BertLogo
                  variant={tabletChromeLogoVariant}
                  tone={themeMode === "dark" ? "onDark" : "onLight"}
                  size="sm"
                />
              </div>
              <div className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--bert-signal-orange)] text-[9px] font-semibold tracking-[0.08em] text-[var(--qms-navy-950)]">
                {accountPhotoUrl ? (
                  <img src={accountPhotoUrl} alt={currentUser.name} className="h-full w-full object-cover" />
                ) : (
                  getUserInitials(currentUser.name, currentUser.username)
                )}
                {selectedFolder && isDebugUiAllowed() ? (
                    <span className="absolute -bottom-1 -right-1 rounded-full bg-blue-500 px-1 py-0 text-[8px] font-bold uppercase tracking-[0.08em] text-white">
                    Live
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className={["truncate text-[11px] font-semibold leading-4 tracking-tight", themeMode === "dark" ? "text-white" : "text-slate-900"].join(" ")}>{companyName}</p>
                <p className={["truncate text-[8px] leading-3 tracking-[0.08em]", themeMode === "dark" ? "text-slate-400" : "text-slate-500"].join(" ")}>{PRODUCT_TAGLINE}</p>
                {selectedFolder ? (
                  <p className={["mt-0.5 truncate text-[8px] font-medium leading-3", themeMode === "dark" ? "text-slate-500" : "text-slate-600"].join(" ")}>
                    Workspace: {selectedFolder.name}
                  </p>
                ) : null}
                {showSiteSelectorForRole && !godCompanySetupOnlyShell && (
                <div className="mt-1">
                  <select
                    value={selectedSiteId}
                    onChange={(event) => setSelectedSiteId(event.target.value)}
                    className={["h-6 max-w-[12rem] rounded-md border-2 px-2 text-[9px] font-semibold", themeMode === "dark" ? "border-slate-700 bg-slate-900 text-slate-200" : "border-[var(--bert-signal-orange)] bg-white text-[var(--qms-navy-900)]"].join(" ")}
                  >
                    <option value="">All sites</option>
                    {headerSelectableSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </div>
                )}
              </div>
            </div>

            {godCompanySetupOnlyShell ? (
              <div className="mt-2 flex justify-end md:hidden">
                <button
                  type="button"
                  onClick={() => handleLogout()}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold",
                    themeMode === "dark"
                      ? "border-rose-500/40 bg-rose-500/15 text-rose-100"
                      : "border-rose-200 bg-rose-50 text-rose-800",
                  ].join(" ")}
                  aria-label="Log out"
                >
                  <AppIcon name="logOut" className="h-3.5 w-3.5" />
                  Log out
                </button>
              </div>
            ) : null}

            <div className={["qms-app-session-bar mt-0.5 hidden items-center justify-between gap-2 rounded-lg border px-2 py-0.5 sm:flex", themeMode === "dark" ? "border-slate-700 bg-slate-900" : "border-slate-300 bg-white"].join(" ")}>
              <div className="flex min-w-0 max-w-full flex-1 items-center gap-1.5 text-[10px] leading-4">
                <p className={["shrink-0 font-semibold", themeMode === "dark" ? "text-slate-100" : "text-slate-900"].join(" ")}>{currentUser.name}</p>
                <span className={themeMode === "dark" ? "text-slate-500" : "text-slate-400"}>•</span>
                <p className={["shrink-0", themeMode === "dark" ? "text-slate-300" : "text-slate-600"].join(" ")}>
                  {getRoleDisplayName(currentUser.role)}
                </p>
                <span className={themeMode === "dark" ? "text-slate-500" : "text-slate-400"}>•</span>
                <p className={["truncate", themeMode === "dark" ? "text-slate-400" : "text-slate-500"].join(" ")}>
                  {roleLabel}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {isDebugUiAllowed() && demoModeActive ? (
                  <div className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Demo mode active</div>
                ) : null}
                {isDebugUiAllowed() ? (
                  <div className="rounded-full bg-blue-500/12 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                    {selectedFolder ? "Live workspace" : "Live session"}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
          <aside
            className={[
              "hidden min-h-0 flex-col border-r border-white/10 bg-gradient-to-b from-[#071525] via-[#0c1f36] to-[#050b14] text-slate-100 md:flex",
              desktopSidebarCollapsed ? "w-[4.75rem]" : "w-[15.5rem]",
            ].join(" ")}
          >
            <div className={`shrink-0 ${desktopSidebarCollapsed ? "px-2 py-3" : "px-3 py-4"}`}>
              <BertLogo
                variant={tabletChromeLogoVariant}
                tone="onDark"
                size="sm"
                className={desktopSidebarCollapsed ? "scale-90" : ""}
              />
            </div>
            <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2" aria-label="Primary">
              {primaryNavItems.map((item) => {
                const selected = screen === item.id || (screen === "complete" && item.id === "audits");
                return (
                  <button
                    key={`sidebar-${item.id}`}
                    type="button"
                    onClick={() => {
                      setShellMoreExpanded(false);
                      setMobileMoreOpen(false);
                      setScreen(item.id);
                    }}
                    className={[
                      "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition",
                      selected
                        ? "bg-[var(--bert-signal-orange)] text-[var(--qms-navy-950)] shadow-[0_8px_20px_rgba(249,115,22,0.25)]"
                        : "text-slate-200 hover:bg-white/8 hover:text-white",
                      desktopSidebarCollapsed ? "justify-center px-2" : "",
                    ].join(" ")}
                    title={item.label}
                  >
                    <AppIcon name={item.icon} className="h-4 w-4 shrink-0 opacity-95" />
                    {!desktopSidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
              {moreNavItems.length > 0 ? (
                <div className="mt-1 border-t border-white/10 pt-2">
                  <button
                    type="button"
                    onClick={() => setShellMoreExpanded((current) => !current)}
                    className={[
                      "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition",
                      shellMoreExpanded || moreNavItems.some((item) => item.id === screen)
                        ? "border border-orange-400/40 bg-orange-500/15 text-orange-100"
                        : "text-slate-300 hover:bg-white/8 hover:text-white",
                      desktopSidebarCollapsed ? "justify-center px-2" : "",
                    ].join(" ")}
                    aria-expanded={shellMoreExpanded}
                  >
                    <AppIcon name="grid" className="h-4 w-4 shrink-0" />
                    {!desktopSidebarCollapsed && <span>More</span>}
                  </button>
                  {shellMoreExpanded && (
                    <div className="mt-1 space-y-1 pl-1">
                      {moreNavItems.map((item) => {
                        const selected = screen === item.id;
                        return (
                          <button
                            key={`sidebar-more-${item.id}`}
                            type="button"
                            onClick={() => {
                              setScreen(item.id);
                              setShellMoreExpanded(false);
                              setMobileMoreOpen(false);
                            }}
                            className={[
                              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition",
                              selected ? "bg-sky-500/20 text-sky-100" : "text-slate-400 hover:bg-white/6 hover:text-slate-100",
                            ].join(" ")}
                          >
                            <AppIcon name={item.icon} className="h-3.5 w-3.5 shrink-0 opacity-90" />
                            <span className="truncate">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </nav>
            <div className="mt-auto shrink-0 space-y-2 border-t border-white/10 px-2 py-3">
              <button
                type="button"
                onClick={() => {
                  handleLogout();
                  setShellMoreExpanded(false);
                  setMobileMoreOpen(false);
                }}
                className={[
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/15 hover:text-white",
                  desktopSidebarCollapsed ? "justify-center px-2" : "",
                ].join(" ")}
                aria-label="Log out"
                title="Log out"
              >
                <AppIcon name="logOut" className="h-4 w-4 shrink-0 opacity-95" />
                {!desktopSidebarCollapsed && <span className="truncate">Log out</span>}
              </button>
              <div
                className={[
                  "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left",
                  desktopSidebarCollapsed ? "justify-center" : "",
                ].join(" ")}
                role="group"
                aria-label="Signed-in user"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-white ring-1 ring-white/20">
                  {getUserInitials(currentUser.name, currentUser.username)}
                </span>
                {!desktopSidebarCollapsed && (
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">{currentUser.name}</span>
                    <span className="block truncate text-xs text-slate-400">{getRoleDisplayName(currentUser.role)}</span>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDesktopSidebarCollapsed((current) => !current)}
                className="flex w-full items-center justify-center rounded-xl border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                aria-label={desktopSidebarCollapsed ? "Expand menu" : "Collapse menu"}
                title={desktopSidebarCollapsed ? "Expand menu" : "Collapse menu"}
              >
                <span>{desktopSidebarCollapsed ? "»" : "«"}</span>
              </button>
            </div>
          </aside>
          <div
            className={[
              "qms-screen-stage h-full min-w-0 flex-1 overflow-y-auto px-4 pb-24 pt-4 md:pb-10", themeMode === "dark" ? "[&_section.border]:border-slate-800 [&_section.bg-white]:bg-slate-900 [&_section.bg-slate-50]:bg-slate-900 [&_section_.text-slate-900]:text-slate-100 [&_section_.text-slate-800]:text-slate-200 [&_section_.text-slate-700]:text-slate-300 [&_section_.text-slate-600]:text-slate-400 [&_section_.text-slate-500]:text-slate-400 [&_section_.text-slate-400]:text-slate-500 [&_section_input]:border-slate-700 [&_section_input]:bg-slate-950 [&_section_input]:text-slate-100 [&_section_input:focus]:border-[var(--bert-signal-orange)] [&_section_input:focus]:bg-slate-950 [&_section_textarea]:border-slate-700 [&_section_textarea]:bg-slate-950 [&_section_textarea]:text-slate-100 [&_section_textarea:focus]:border-[var(--bert-signal-orange)] [&_section_select]:border-slate-700 [&_section_select]:bg-slate-950 [&_section_select]:text-slate-100 [&_section_select:focus]:border-[var(--bert-signal-orange)] [&_section_select:focus]:bg-slate-950 [&_.bg-gradient-to-b]:from-slate-900 [&_.bg-gradient-to-b]:to-slate-950 [&_.bg-slate-100]:bg-slate-800 [&_.bg-slate-200]:bg-slate-800 [&_.bg-white]:bg-slate-900 [&_.text-slate-900]:text-slate-100 [&_.text-slate-800]:text-slate-200 [&_.text-slate-700]:text-slate-300 [&_.text-slate-600]:text-slate-400 [&_.text-slate-500]:text-slate-400 [&_input[type=file]]:border-[rgba(249,115,22,0.45)] [&_input[type=file]]:bg-slate-950 [&_input[type=file]]:text-slate-300 [&_input[type=file]]:file:text-slate-200" : "bg-slate-100/72"            ].join(" ")}>
            {screen === "dashboard" && !godCompanySetupOnlyShell && (
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-semibold tracking-tight text-slate-900 md:text-2xl dark:text-slate-100">
                    {(() => {
                      const first = getGreetingFirstName(currentUserAppName);
                      return first ? `${getTimeBasedGreeting()}, ${first}` : getTimeBasedGreeting();
                    })()}
                  </h1>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Here is what needs attention, what is due today, and what is waiting on someone else.
                  </p>
                  {dashboardNextBest?.intent.type === "screen" ? (
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Suggested next step</p>
                      {dashboardNextBest.description ? (
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{dashboardNextBest.description}</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          if (dashboardNextBest?.intent.type === "screen") {
                            applyNextBestDashboardIntent(dashboardNextBest.intent);
                          }
                        }}
                        className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[var(--bert-signal-orange)] px-4 text-sm font-semibold text-[var(--qms-navy-950)] shadow-sm transition hover:brightness-95 focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 sm:w-auto"
                      >
                        {dashboardNextBest.label}
                      </button>
                    </div>
                  ) : dashboardNextBest && dashboardNextBest.intent.type === "none" ? (
                    <p className="mt-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">{dashboardNextBest.description ?? dashboardNextBest.label}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="shrink-0 self-end rounded-full border border-slate-200 bg-white p-2 text-slate-600 shadow-sm hover:bg-slate-50 sm:self-start dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  aria-label="Notifications"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 14h18c0-7-3-7-3-14" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )}
            {currentUser.role === "Manager" && currentManagerAlerts.length > 0 && (
              <section className="mb-4 rounded-[1.5rem] border border-rose-200 bg-rose-50 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-rose-900">Manager alerts</p>
                  <button
                    type="button"
                    onClick={() => currentManagerAlerts.forEach((alert) => markManagerAlertRead(alert.id))}
                    className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700"
                  >
                    Mark all as read
                  </button>
                </div>
                <div className="mt-2 space-y-1.5">
                  {currentManagerAlerts.slice(0, 3).map((alert) => (
                    <div key={alert.id} className="flex items-start justify-between gap-3 rounded-lg bg-white/70 px-3 py-2">
                      <p className="text-sm text-rose-800">
                        {alert.auditName}: {alert.nonComplianceCount} non-compliance item
                        {alert.nonComplianceCount === 1 ? "" : "s"} submitted by {alert.submittedBy}
                        {alert.queuedForSync ? " (queued offline)." : "."}
                      </p>
                      <button
                        type="button"
                        onClick={() => markManagerAlertRead(alert.id)}
                        className="shrink-0 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700"
                      >
                        Mark read
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {(offlineMode || offlineQueue.length > 0) && (
              <section className="mb-4 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4">
                <p className="text-sm font-semibold text-amber-900">
                  {offlineMode ? "Offline mode active" : "Queued submissions waiting to sync"}
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  {offlineMode
                    ? "Audits can still be completed on this tablet. Submissions will queue locally until the connection returns."
                    : `${offlineQueue.length} queued submission${offlineQueue.length === 1 ? "" : "s"} will sync automatically.`}
                </p>
              </section>
            )}
            {screen === "dashboard" && currentUser && usesPilotOperatorNav(currentUser.role) && (
              <div className="mb-4">
                <PilotReadinessCard
                  onOpenInitialSetup={
                    currentUser.role === "Master"
                      ? () => {
                          navigateToSetupInitial();
                          setScreen("setupInitial");
                        }
                      : undefined
                  }
                  slatePrimaryCtaInteractClass={slatePrimaryCtaInteract}
                />
              </div>
            )}
            {screen === "dashboard" && (
              <DashboardScreen
                currentUser={currentUser}
                workspaceName={workspaceName}
                compliance={compliance}
                complianceDelta={complianceDelta}
                groupedAudits={groupedAudits}
                actions={visibleActions}
                openActions={openActions}
                overdueActions={overdueActions}
                criticalActions={criticalActions}
                awaitingVerificationActions={awaitingVerificationActions}
                overdueAudits={overdueAudits}
                evidenceCount={evidenceCount}
                completedToday={completedToday}
                offlineQueueCount={offlineQueue.length}
                pendingSyncCount={pendingSyncCount}
                failedSyncCount={failedSyncCount}
                assignedAudits={assignedAudits}
                history={assignmentFilteredHistory}
                drafts={drafts}
                companySheetSync={companySheetSync}
                auditCompletionRate={auditCompletionRate}
                actionClosureRate={actionClosureRate}
                averageActionClosureDays={averageActionClosureDays}
                recurringFailedQuestions={recurringFailedQuestions}
                topOverdueSchedules={topOverdueSchedules}
                riskSummary={riskSummary}
                themeMode={themeMode}
                dashboardPreferences={dashboardPreferences}
                dashboardSectionOrder={dashboardSectionOrder}
                onOpenAudit={startAudit}
                onAdvanceAction={updateActionStatus}
                onApplyDashboardPreset={handleApplyDashboardPreset}
                onToggleDashboardSection={handleToggleDashboardSection}
                onMoveDashboardSection={handleMoveDashboardSection}
                reportUsersCount={companyReportUsers.length}
                activeSchedulesCount={managedSchedules.filter((item) => item.lifecycle !== "Archived").length}
                templatesCount={templates.filter((template) => template.active).length}
                workspaceValidation={workspaceValidation}
                selectedFolder={selectedFolder}
                onValidateWorkspace={() => void validateWorkspace()}
                onRepairWorkspace={repairWorkspace}
                onLoadDemoData={handleLoadDemoData}
                onClearDemoData={handleClearDemoData}
                showStartHereCard={showDashboardStartHere}
                demoModeActive={demoModeActive}
                renderAuditorDashboard={() => (
                  <AuditorTaskDashboard
                    currentUser={currentUser}
                    groupedAudits={groupedAudits}
                    assignedAudits={assignedAudits}
                    drafts={drafts}
                    actions={visibleActions}
                    pendingSyncCount={pendingSyncCount}
                    failedSyncCount={failedSyncCount}
                    showStartHereCard={showDashboardStartHere}
                    workspaceLinked={Boolean(selectedFolder)}
                    recentCompletionsCount={assignmentFilteredHistory.length}
                    onOpenAudit={startAudit}
                    slatePrimaryCtaInteract={slatePrimaryCtaInteract}
                  />
                )}
                renderManagerDashboard={() => (
                  <ManagerDashboard
                    currentUser={currentUser}
                    groupedAudits={groupedAudits}
                    assignedAudits={assignedAudits}
                    actions={visibleActions}
                    history={assignmentFilteredHistory}
                    pendingSyncCount={pendingSyncCount}
                    failedSyncCount={failedSyncCount}
                    offlineQueueCount={offlineQueue.length}
                    workspaceLinked={Boolean(selectedFolder)}
                    showStartHereCard={showDashboardStartHere}
                    demoModeActive={demoModeActive}
                    openIncidentFollowUpsCount={openIncidentFollowUpsCount}
                    onOpenIncidents={() => {
                      setScreen("incidents");
                    }}
                    onOpenAudit={startAudit}
                    onAdvanceAction={updateActionStatus}
                    recurringFailedQuestions={recurringFailedQuestions}
                    onViewAllNeedsAttention={() => {
                      setActionFilter("Overdue");
                      setScreen("actions");
                    }}
                    onViewAllDueToday={() => {
                      setScreen("audits");
                    }}
                    onViewAllAwaitingVerification={() => {
                      setActionFilter("Awaiting Verification");
                      setScreen("actions");
                    }}
                    onViewAllInProgress={() => {
                      setActionFilter("Open");
                      setScreen("actions");
                    }}
                    onViewAllRecentCompletions={() => {
                      setScreen("reports");
                    }}
                    onOpenSyncCentre={() => {
                      setScreen("sync");
                    }}
                    lastSyncedAt={companySheetSync?.lastSyncedAt ?? null}
                  />
                )}
                renderAdminDashboard={() => (
                  <AdminDashboard
                    groupedAudits={groupedAudits}
                    assignedAudits={assignedAudits}
                    actions={visibleActions}
                    history={assignmentFilteredHistory}
                    workspaceLinked={Boolean(selectedFolder)}
                    pendingSyncCount={pendingSyncCount}
                    failedSyncCount={failedSyncCount}
                    reportUsersCount={companyReportUsers.length}
                    activeSchedulesCount={managedSchedules.filter((item) => item.lifecycle !== "Archived").length}
                    templatesCount={templates.filter((template) => template.active).length}
                    showStartHereCard={showDashboardStartHere}
                    onOpenAudit={startAudit}
                    onAdvanceAction={updateActionStatus}
                  />
                )}
              />
            )}

            {screen === "audits" && canAccessAuditsCentre(currentUser.role) && (
              <AuditsScreen
                currentUser={currentUser}
                audits={siteScopedAudits}
                groupedAudits={groupedAudits}
                drafts={drafts}
                unsyncedAuditIds={unsyncedSubmittedAuditIds}
                userProfilePhotos={userProfilePhotos}
                users={users}
                onOpenAudit={startAudit}
                auditAccessMatrix={auditAccessMatrix}
                auditScheduleMatrix={auditScheduleMatrix}
                onToggleAuditAccess={handleToggleAuditAccess}
              />
            )}

            {screen === "actions" && canAccessActions(currentUser.role) && (
              <ActionsScreen
                currentUser={currentUser}
                actions={filteredActions}
                actionFilter={actionFilter}
                actionSeverityFilter={actionSeverityFilter}
                actionNcFilter={actionNcFilter}
                availableNonConformanceIds={availableNonConformanceIds}
                availableAuditors={availableScheduleAuditors}
                onFilterChange={setActionFilter}
                onSeverityFilterChange={setActionSeverityFilter}
                onNcFilterChange={setActionNcFilter}
                onAdvanceAction={updateActionStatus}
                onAssignAction={assignAction}
                onAddEvidence={attachEvidenceToAction}
              />
            )}

            {screen === "nonConformance" && canAccessActions(currentUser.role) && (
              <NonConformanceScreen
                currentUser={currentUser}
                nonConformances={assignmentFilteredNonConformances}
                canViewCompletedReports={canAccessCompletedNcrReports(currentUser.role)}
                onSaveProgress={(ncrId, payload) => {
                  setNonConformances((current) =>
                    current.map((item) => (item.id === ncrId ? { ...item, ...payload, status: "In Progress" } : item)),
                  );
                  pushToast("Progress saved", "Investigation updates were saved.", "success");
                }}
                onComplete={(ncrId, payload) => {
                  if (!currentUser) return false;
                  let completed = false;
                  setNonConformances((current) =>
                    current.map((item) => {
                      if (item.id !== ncrId) return item;
                      completed = true;
                      return {
                        ...item,
                        ...payload,
                        status: "Completed",
                        completionDateTime: formatStamp(),
                        completedByName: currentUser.name,
                        completedByUserId: currentUser.username,
                      };
                    }),
                  );
                  if (completed) {
                    pushToast("NCR complete", "Non-conformance report marked as completed.", "success");
                  }
                  return completed;
                }}
                onAddEvidence={(ncrId, files) => {
                  const nextItems = Array.from(files).map((file) => ({
                    id: `${ncrId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    name: file.name,
                    previewUrl: URL.createObjectURL(file),
                    addedAt: formatStamp(),
                  }));
                  setNonConformances((current) =>
                    current.map((item) => (item.id === ncrId ? { ...item, evidence: [...item.evidence, ...nextItems] } : item)),
                  );
                }}
                onExportReport={(ncr) => {
                  const opened = openPrintableReport(
                    `[${ncr.reference}] Non-Conformance Report`,
                    `
                    <h1>${ncr.reference} Non-Conformance Report</h1>
                    <p class="meta">Status: ${ncr.status} | Raised: ${ncr.raisedAt}</p>
                    <h2>Core details</h2>
                    <ul>
                      <li>Audit: ${ncr.auditName}</li>
                      <li>Question: ${ncr.auditQuestion}</li>
                      <li>Selected answer: ${ncr.selectedAnswer.toUpperCase()}</li>
                      <li>Site: ${ncr.site}</li>
                      <li>Auditor: ${ncr.auditorName}</li>
                      <li>Assigned line manager: ${ncr.assignedLineManager}</li>
                    </ul>
                    <h2>Investigation</h2>
                    <ul>
                      <li>ISO clause: ${ncr.investigationIsoClause || "-"}</li>
                      <li>Investigation notes: ${ncr.investigationNotes || "-"}</li>
                      <li>Root cause: ${ncr.rootCause || "-"}</li>
                      <li>Corrective action: ${ncr.correctiveAction || "-"}</li>
                      <li>Extra notes: ${ncr.investigationExtraNotes || "-"}</li>
                    </ul>
                    <h2>Evidence references</h2>
                    <ul>
                      ${
                        ncr.evidence.length
                          ? ncr.evidence.map((item) => `<li>${item.name} (${item.addedAt})</li>`).join("")
                          : "<li>No evidence uploaded.</li>"
                      }
                    </ul>
                    <h2>Completion</h2>
                    <ul>
                      <li>Completed at: ${ncr.completionDateTime || "-"}</li>
                      <li>Completed by: ${ncr.completedByName || "-"}</li>
                    </ul>
                  `,
                  );
                  if (!opened) {
                    pushToast("PDF export blocked", "Allow pop-ups to open NCR report print view.", "warning");
                    return;
                  }
                  pushToast("NCR report opened", `${ncr.reference} print view is ready to save as PDF.`, "success");
                }}
              />
            )}

            {screen === "incidents" && canSubmitIncidents(currentUser.role) && (
              <IncidentReportingScreen
                currentUser={currentUser}
                incidents={incidents}
                incidentActions={incidentActions}
                onSubmitIncident={submitIncidentReport}
                onUpdateIncident={updateIncidentRecord}
                onAddIncidentAction={addIncidentCorrectiveAction}
                onUpdateIncidentAction={updateIncidentCorrectiveAction}
              />
            )}

            {screen === "reports" && (
              <ReportsScreen
                compliance={compliance}
                openActions={openActions}
                overdueActions={overdueActions}
                overdueAudits={overdueAudits}
                actions={visibleActions}
                managedSchedules={managedSchedules}
                syncQueue={syncQueue}
                riskSummary={riskSummary}
                recurringFailedQuestions={recurringFailedQuestions}
                auditCompletionRate={auditCompletionRate}
                evidenceCount={evidenceCount}
                completedToday={completedToday}
                offlineQueueCount={offlineQueue.length}
                reportUsers={companyReportUsers}
                reportRecipients={reportRecipients}
                reportInbox={reportInbox}
                history={history}
                templates={templates}
                selectedReportTemplate={selectedReportTemplate}
                reportTitleInput={reportTitleInput}
                selectedReportSections={selectedReportSections}
                workspaceName={workspaceName}
                onToggleReportRecipient={handleToggleReportRecipient}
                onSelectReportTemplate={handleSelectReportTemplate}
                onReportTitleChange={setReportTitleInput}
                onToggleReportSection={handleToggleReportSection}
                onExportAuditPack={handleExportAuditPack}
                onExportAuditPackPdf={handleExportAuditPackPdf}
              />
            )}

            {screen === "sync" && (
              <SyncCentreScreen
                currentUser={currentUser}
                syncQueue={syncQueue}
                offlineQueueCount={offlineQueue.length}
                onRetryItem={(id) => updateSyncItemStatus(id, "Pending Sync")}
                onForceSyncItem={(id) => updateSyncItemStatus(id, googleConnected && !offlineMode ? "Syncing" : "Pending Sync")}
              />
            )}

            {screen === "documentTraining" && canAccessDocumentTraining(currentUser.role) && (
              <DocumentTrainingScreen
                workspaceId={documentTrainingWorkspaceId}
                currentUserName={currentUser.name}
                sites={sites}
                onboardedRecipients={documentTrainingRecipientOptions}
                externalEmployees={externalEmployees}
                distributions={documentDistributions}
                onSaveExternalEmployees={handleSaveExternalEmployees}
                onSendDistribution={handleSendDocumentDistribution}
                onRefreshFromServer={refreshDocumentTrainingFromServer}
              />
            )}

            {screen === "schedules" && canAccessSchedules(currentUser.role) && (
              <SchedulesScreen
                selectedFolder={selectedFolder}
                schedules={visibleSchedules}
                filter={scheduleListFilter}
                availableAudits={availableScheduleAudits}
                availableAuditors={availableScheduleAuditors}
                editorOpen={scheduleEditorOpen}
                editingSchedule={editingScheduleId ? managedSchedules.find((item) => item.id === editingScheduleId) || null : null}
                scheduleName={scheduleDraftName}
                selectedAuditIds={scheduleDraftSelectedAuditIds}
                scheduleAudits={scheduleDraftAudits}
                startDate={scheduleDraftStartDate}
                endDate={scheduleDraftEndDate}
                continuous={scheduleDraftContinuous}
                selectedAuditors={scheduleDraftAuditors}
                validationAttempted={scheduleValidationAttempted}
                onFilterChange={setScheduleListFilter}
                onOpenNew={handleOpenNewSchedule}
                onOpenSchedule={handleOpenSchedule}
                onToggleAudit={handleToggleScheduleAudit}
                onToggleAuditDay={handleToggleScheduleAuditDay}
                onAuditFieldChange={handleUpdateScheduleAuditField}
                onScheduleNameChange={setScheduleDraftName}
                onStartDateChange={setScheduleDraftStartDate}
                onEndDateChange={setScheduleDraftEndDate}
                onContinuousChange={setScheduleDraftContinuous}
                onToggleAuditor={handleToggleScheduleAuditor}
                onSave={handleSaveManagedSchedule}
                onCancel={resetManagedScheduleDraft}
                onReactivate={handleReactivateSchedule}
                onDelete={handleDeleteSchedule}
                onPause={handlePauseSchedule}
                onResume={handleResumeSchedule}
              />
            )}

            {screen === "setup" && currentUser && canAccessPilotSetup(currentUser.role) && (
              <PilotSetupScreen
                showInitialSetupEntry={currentUser.role === "Master"}
                onOpenInitialSetup={() => {
                  navigateToSetupInitial();
                  setScreen("setupInitial");
                }}
                slatePrimaryCtaInteract={slatePrimaryCtaInteract}
              />
            )}

            {screen === "setupInitial" && currentUser && canAccessGodmodeInitialSetup(currentUser.role) && (
              <GodmodeInitialSetupScreen
                googleConnected={googleConnected}
                onGoogleConnect={handleGoogleConnect}
                onGoogleDisconnect={handleGoogleDisconnect}
                onBackToSetup={() => {
                  leaveSetupInitialPath("/");
                  setScreen("setup");
                }}
                slatePrimaryCtaInteract={slatePrimaryCtaInteract}
              />
            )}

            {screen === "settings" && currentUser && canAccessPilotSettings(currentUser.role) && (
              <PilotSettingsScreen
                currentUser={currentUser}
                accountNameInput={accountNameInput}
                themeMode={themeMode}
                onOpenScreen={(next) => setScreen(next)}
                onOpenAccount={() => setScreen("account")}
                slatePrimaryCtaInteract={slatePrimaryCtaInteract}
              />
            )}

            {((screen === "companies" && canAccessPilotCompanies(currentUser.role)) ||
              (screen === "users" && canAccessPilotUsers(currentUser.role)) ||
              (screen === "invites" && canAccessPilotInvites(currentUser.role)) ||
              (screen === "admin" && canAccessControlScreen(currentUser.role)) ||
              (screen === "onboarding" && canAccessAdminOnboardingWorkspace(currentUser.role))) && (
              <AdminScreen
                pilotFocus={
                  screen === "companies" ? "companies" : screen === "users" ? "users" : screen === "invites" ? "invites" : undefined
                }
                standaloneOnboarding={
                  screen === "onboarding" || screen === "companies"
                }
                hideMasterLocalDemoTools={godCompanySetupOnlyShell || screen === "companies" || screen === "users" || screen === "invites"}
                currentUser={currentUser}
                googleConnected={googleConnected}
                folders={folders}
                selectedFolder={selectedFolder}
                folderNameInput={folderNameInput}
                folderIdInput={folderIdInput}
                auditFormsFolderInput={auditFormsFolderInput}
                masterSheetInput={masterSheetInput}
                evidenceFolderInput={evidenceFolderInput}
                healthSafetyFolderInput={healthSafetyFolderInput}
                exportsFolderInput={exportsFolderInput}
                adminNotesFolderInput={adminNotesFolderInput}
                syncState={syncState}
                backendConfigured={backendConfigured}
                sharedDriveId={sharedDriveId}
                googleStatusLoading={googleStatusLoading}
                folderInspection={folderInspection}
                folderInspectionLoading={folderInspectionLoading}
                onboardingSource={onboardingSource}
                onboardingRecords={onboardingRecords}
                onboardingRecordsLoading={onboardingRecordsLoading}
                selectedOnboardingRecordId={selectedOnboardingRecordId}
                schedules={selectedFolderSchedules}
                inviteEmailInput={inviteEmailInput}
                inviteRoleInput={inviteRoleInput}
                invitedUsers={invitedUsers}
                sites={sites}
                selectedSiteId={selectedSiteId}
                reportUsers={companyReportUsers}
                userSiteAssignments={userSiteAssignments}
                onToggleUserSiteAssignment={handleToggleUserSiteAssignment}
                creatableRoles={creatableRoles}
                onGoogleConnect={handleGoogleConnect}
                onGoogleDisconnect={handleGoogleDisconnect}
                notificationsEnabled={notificationsEnabled}
                companySheetSync={companySheetSync}
                workspaceValidation={workspaceValidation}
                workspaceValidationLoading={workspaceValidationLoading}
                templates={templates}
                templateNameInput={templateNameInput}
                templateQuestionInput={templateQuestionInput}
                templateQuestionTypeInput={templateQuestionTypeInput}
                templateDraftQuestions={templateDraftQuestions}
                onRefreshGoogleStatus={() => loadGoogleStatus()}
                onRefreshOnboardingRecords={() => loadOnboardingRecords()}
                onSelectOnboardingRecord={setSelectedOnboardingRecordId}
                onApplyOnboardingRecord={handleApplyOnboardingRecord}
                onFolderNameChange={setFolderNameInput}
                onFolderIdChange={setFolderIdInput}
                onAuditFormsFolderChange={setAuditFormsFolderInput}
                onMasterSheetChange={setMasterSheetInput}
                onEvidenceFolderChange={setEvidenceFolderInput}
                onHealthSafetyFolderChange={setHealthSafetyFolderInput}
                onExportsFolderChange={setExportsFolderInput}
                onAdminNotesFolderChange={setAdminNotesFolderInput}
                onScheduleNameChange={setScheduleNameInput}
                onScheduleAreaChange={setScheduleAreaInput}
                onScheduleOwnerChange={setScheduleOwnerInput}
                onScheduleScopeChange={setScheduleScopeInput}
                onSchedulePersonalAssigneeChange={setSchedulePersonalAssigneeInput}
                onScheduleFrequencyChange={setScheduleFrequencyInput}
                onScheduleSendTimeChange={setScheduleSendTimeInput}
                onScheduleRecipientsChange={setScheduleRecipientsInput}
                onScheduleOverdueAlertRecipientsChange={setScheduleOverdueAlertRecipientsInput}
                onScheduleEscalationContactChange={setScheduleEscalationContactInput}
                onScheduleOverdueAlertTimingChange={setScheduleOverdueAlertTimingInput}
                onScheduleCompletionCheckTimingChange={setScheduleCompletionCheckTimingInput}
                onScheduleNextDueHoursChange={setScheduleNextDueHoursInput}
                onSchedulePriorityChange={setSchedulePriorityInput}
                onOpenOnboardingForm={handleOpenOnboardingForm}
                onStartCompanyOnboarding={handleStartCompanyOnboarding}
                onAddFolder={handleAddFolder}
                onOneClickGoogleOnboarding={handleOneClickGoogleOnboarding}
                onRequestNotifications={requestNotificationAccess}
                onValidateWorkspace={() => void validateWorkspace()}
                onRepairWorkspace={repairWorkspace}
                onTemplateNameChange={setTemplateNameInput}
                onTemplateQuestionChange={setTemplateQuestionInput}
                onTemplateQuestionTypeChange={setTemplateQuestionTypeInput}
                onAddTemplateQuestion={handleAddTemplateQuestion}
                onRemoveTemplateQuestion={handleRemoveTemplateQuestion}
                onAddAnswerPromptToDraftQuestion={handleAddAnswerPromptToDraftQuestion}
                onRemoveAnswerPromptFromDraftQuestion={handleRemoveAnswerPromptFromDraftQuestion}
                onAddTemplate={handleAddTemplate}
                onToggleTemplate={handleToggleTemplate}
                onAddSchedule={handleAddSchedule}
                onSelectFolder={handleSelectFolder}
                onVerifyOnboarding={handleVerifyOnboarding}
                onVerifyAudits={handleVerifyAudits}
                onVerifyResponseSheet={handleVerifyResponseSheet}
                onSyncForms={handleSyncForms}
                onLoadDemoData={handleLoadDemoData}
                onClearDemoData={handleClearDemoData}
                onInviteEmailChange={setInviteEmailInput}
                onInviteRoleChange={setInviteRoleInput}
                onInviteUser={handleInviteUser}
                companyUserInviteEmailResult={companyUserInviteEmailResult}
                companyUserInviteEmailSending={companyUserInviteEmailSending}
                onDismissCompanyUserInviteEmailResult={() => setCompanyUserInviteEmailResult(null)}
                onResendInvite={handleResendInvite}
                onDeleteInvite={handleDeleteInvite}
                onResyncUsers={handleResyncUsers}
                onSelectSite={setSelectedSiteId}
                onAddSite={handleAddSite}
                onArchiveSite={handleArchiveSite}
                godModeAppInviteEmail={godModeAppInviteEmail}
                onGodModeAppInviteEmailChange={setGodModeAppInviteEmail}
                onSendGodModeAppCompanyInvite={handleSendGodModeAppCompanyInvite}
                companyOnboardingEmailResult={companyOnboardingEmailResult}
                companyOnboardingEmailSending={companyOnboardingEmailSending}
                onDismissCompanyOnboardingEmailResult={() => setCompanyOnboardingEmailResult(null)}
                onOpenInitialSetup={
                  canAccessGodmodeInitialSetup(currentUser.role)
                    ? () => {
                        setScreen("setupInitial");
                        navigateToSetupInitial();
                      }
                    : undefined
                }
                scheduleNameInput={scheduleNameInput}
                scheduleAreaInput={scheduleAreaInput}
                scheduleOwnerInput={scheduleOwnerInput}
                scheduleScopeInput={scheduleScopeInput}
                schedulePersonalAssigneeInput={schedulePersonalAssigneeInput}
                scheduleFrequencyInput={scheduleFrequencyInput}
                scheduleSendTimeInput={scheduleSendTimeInput}
                scheduleRecipientsInput={scheduleRecipientsInput}
                scheduleOverdueAlertRecipientsInput={scheduleOverdueAlertRecipientsInput}
                scheduleEscalationContactInput={scheduleEscalationContactInput}
                scheduleOverdueAlertTimingInput={scheduleOverdueAlertTimingInput}
                scheduleCompletionCheckTimingInput={scheduleCompletionCheckTimingInput}
                scheduleNextDueHoursInput={scheduleNextDueHoursInput}
                schedulePriorityInput={schedulePriorityInput}
                AppIcon={AppIcon}
                slatePrimaryCtaInteract={slatePrimaryCtaInteract}
              />
            )}

            {screen === "emailReminders" && currentUser && canAccessEmailReminders(currentUser.role) && (
              <EmailRemindersScreen
                userEmail={reminderUserEmail}
                themeMode={themeMode}
                slatePrimaryCtaInteract={slatePrimaryCtaInteract}
                devApiHeaders={documentTrainingApiHeaders()}
              />
            )}

            {screen === "account" && (
              <AccountSettingsScreen
                currentUser={currentUser}
                accountNameInput={accountNameInput}
                accountPhotoUrl={accountPhotoUrl}
                themeMode={themeMode}
                companyName={companyName}
                slatePrimaryCtaInteract={slatePrimaryCtaInteract}
                onAccountNameChange={setAccountNameInput}
                onAccountPhotoChange={handleAccountPhotoChange}
                onThemeModeChange={setThemeMode}
                onSave={handleSaveAccountSettings}
                workspaceSetupLimitedShell={godCompanySetupOnlyShell}
                onOpenFullAppNavigation={godCompanySetupOnlyShell ? handleLeaveMasterWorkspaceSetupOnly : undefined}
              />
            )}

            {screen === "complete" && canCompleteAuditAsAuditor(currentUser.role) && auditCompletionSummary && (
              <AuditCompletionSummary
                summary={auditCompletionSummary}
                hasMoreAudits={Boolean(pickNextAuditorAudit(assignedAudits, drafts))}
                onStartNext={() => {
                  const next = pickNextAuditorAudit(assignedAudits, drafts);
                  setAuditCompletionSummary(null);
                  setResponses({});
                  setNotes({});
                  setEvidence({});
                  setIssuePrompt(null);
                  setAuditModeQuestionIndex(0);
                  if (next) {
                    startAudit(next.id);
                  } else {
                    setScreen("dashboard");
                  }
                }}
                onReturnDashboard={() => {
                  setAuditCompletionSummary(null);
                  setResponses({});
                  setNotes({});
                  setEvidence({});
                  setIssuePrompt(null);
                  setAuditModeQuestionIndex(0);
                  setScreen("dashboard");
                }}
              />
            )}

            {screen === "complete" && activeAudit && canCompleteAuditAsAuditor(currentUser.role) && !auditCompletionSummary && (
              <>
                <AuditModeScreen
                  audit={activeAudit}
                  responses={responses}
                  notes={notes}
                  evidence={evidence}
                  evidenceDebugLabel={evidenceDebugLabel}
                  questionIndex={auditModeQuestionIndex}
                  offlineMode={offlineMode}
                  pendingSyncCount={pendingSyncCount}
                  failedSyncCount={failedSyncCount}
                  slatePrimaryCtaInteract={slatePrimaryCtaInteract}
                  onAnswerSelect={handleAuditModeAnswer}
                  onJumpToQuestion={setAuditModeQuestionIndex}
                  onNoteChange={(questionId, value) =>
                    setNotes((current) => ({
                      ...current,
                      [questionId]: value,
                    }))
                  }
                  onAddEvidence={(questionId, files) => {
                    const fileCount = files.length;
                    setEvidenceDebugLabel(`Selected: ${Array.from(files).map((file) => file.name).join(", ")}`);
                    const nextItems = Array.from(files).map((file) => ({
                      id: `${questionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      name: file.name,
                      previewUrl: URL.createObjectURL(file),
                      addedAt: formatStamp(),
                    }));
                    setEvidence((current) => ({
                      ...current,
                      [questionId]: [...(current[questionId] ?? []), ...nextItems],
                    }));
                    pushToast(
                      "Evidence attached",
                      `${fileCount} file${fileCount === 1 ? "" : "s"} added to this question.`,
                      "success",
                    );
                  }}
                  onComplete={completeAuditModeFlow}
                  onSaveAndExit={handleAuditModeSaveAndExit}
                />
                {issuePrompt && (
                  <IssueFoundPrompt
                    issue={issuePrompt}
                    existingNote={notes[issuePrompt.question.id] || ""}
                    evidenceCount={evidence[issuePrompt.question.id]?.length ?? 0}
                    assignedToName={activeAudit.owner}
                    offlineMode={offlineMode}
                    onAddPhoto={(files) => {
                      const fileCount = files.length;
                      if (!fileCount) return;
                      const questionId = issuePrompt.question.id;
                      setEvidenceDebugLabel(`Selected: ${Array.from(files).map((file) => file.name).join(", ")}`);
                      const nextItems = Array.from(files).map((file) => ({
                        id: `${questionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        name: file.name,
                        previewUrl: URL.createObjectURL(file),
                        addedAt: formatStamp(),
                      }));
                      setEvidence((current) => ({
                        ...current,
                        [questionId]: [...(current[questionId] ?? []), ...nextItems],
                      }));
                      pushToast(
                        "Evidence attached",
                        `${fileCount} file${fileCount === 1 ? "" : "s"} added to this finding.`,
                        "success",
                      );
                    }}
                    onSave={handleAuditModeSaveIssue}
                    onCancel={() => setIssuePrompt(null)}
                  />
                )}
              </>
            )}

            {screen === "complete" && activeAudit && canSubmitAuditForReview(currentUser.role) && (
              <CompleteAuditScreen
                audit={activeAudit}
                responses={responses}
                notes={notes}
                evidence={evidence}
                signatureDataUrl={signatureDataUrl}
                signatureSignedAt={signatureSignedAt}
                offlineMode={offlineMode}
                savedAt={drafts[activeAudit.id]?.updatedAt ?? null}
                canSubmit={canSubmitAudit}
                onSelect={(questionId, answer) =>
                  setResponses((current) => ({
                    ...current,
                    [questionId]: answer,
                  }))
                }
                onNoteChange={(questionId, value) =>
                  setNotes((current) => ({
                    ...current,
                    [questionId]: value,
                  }))
                }
                onAddEvidence={(questionId, files) => {
                  const fileCount = files.length;
                  setEvidenceDebugLabel(`Selected: ${Array.from(files).map((file) => file.name).join(", ")}`);
                  const nextItems = Array.from(files).map((file) => ({
                    id: `${questionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    name: file.name,
                    previewUrl: URL.createObjectURL(file),
                    addedAt: formatStamp(),
                  }));
                  setEvidence((current) => ({
                    ...current,
                    [questionId]: [...(current[questionId] ?? []), ...nextItems],
                  }));
                  pushToast(
                    "Evidence attached",
                    `${fileCount} file${fileCount === 1 ? "" : "s"} added to this question.`,
                    "success",
                  );
                }}
                onRemoveEvidence={(questionId, evidenceId) =>
                  setEvidence((current) => ({
                    ...current,
                    [questionId]: (current[questionId] ?? []).filter((item) => item.id !== evidenceId),
                  }))
                }
                onSignatureChange={(dataUrl) => {
                  setSignatureDataUrl(dataUrl);
                  setSignatureSignedAt(dataUrl ? formatStamp() : "");
                }}
                onSaveDraft={saveDraft}
                onSubmit={submitAudit}
                AppIcon={AppIcon}
                slatePrimaryCtaInteract={slatePrimaryCtaInteract}
                onCancel={() => {
                  setActiveAuditId(null);
                  setResponses({});
                  setNotes({});
                  setEvidence({});
                  setSignatureDataUrl("");
                  setSignatureSignedAt("");
                  setScreen("audits");
                }}
              />
            )}
          </div>
        </main>

        {!godCompanySetupOnlyShell && (
          <>
            {mobileMoreOpen ? (
              <div
                className="absolute inset-0 z-40 flex items-end justify-center bg-slate-950/50 p-3 md:hidden"
                onClick={() => setMobileMoreOpen(false)}
                role="presentation"
              >
                <div
                  className="mb-14 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-label="More navigation"
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">More</p>
                  <div className="grid max-h-[46vh] gap-2 overflow-y-auto">
                    {mobileMoreDestinations.map((item) => (
                      <button
                        key={`mobile-more-${item.id}`}
                        type="button"
                        onClick={() => {
                          setScreen(item.id);
                          setMobileMoreOpen(false);
                        }}
                        className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-left text-sm font-semibold text-slate-800"
                      >
                        <AppIcon name={item.icon} className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            <nav
              className="absolute bottom-0 left-0 right-0 z-30 flex border-t border-slate-200/90 bg-white/95 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur md:hidden"
              aria-label="Primary navigation"
            >
              {mobileBottomNavEntries.map((entry) => {
                if (entry.id === "__logout__") {
                  return (
                    <button
                      key="mobile-nav-logout"
                      type="button"
                      onClick={() => {
                        handleLogout();
                        setMobileMoreOpen(false);
                      }}
                      className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold text-rose-600"
                      aria-label="Log out"
                    >
                      <AppIcon name="logOut" className="h-5 w-5" />
                      Log out
                    </button>
                  );
                }
                if (entry.id === "__more__") {
                  const moreActive =
                    mobileMoreOpen || mobileMoreDestinations.some((item) => item.id === screen);
                  return (
                    <button
                      key="mobile-nav-more"
                      type="button"
                      onClick={() => setMobileMoreOpen((current) => !current)}
                      className={[
                        "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold",
                        moreActive ? "text-[var(--bert-signal-orange)]" : "text-slate-500",
                      ].join(" ")}
                    >
                      <AppIcon name="grid" className="h-5 w-5" />
                      More
                    </button>
                  );
                }
                const selected = screen === entry.id || (screen === "complete" && entry.id === "audits");
                return (
                  <button
                    key={`mobile-nav-${entry.id}`}
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      setScreen(entry.id as Screen);
                    }}
                    className={[
                      "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold",
                      selected ? "text-[var(--bert-signal-orange)]" : "text-slate-500",
                    ].join(" ")}
                  >
                    <AppIcon name={entry.icon} className="h-5 w-5" />
                    {entry.label}
                  </button>
                );
              })}
            </nav>
          </>
        )}

        </div>
      )}

      <ToastStack toasts={toasts} />
    </div>
  );
}

function IssueFoundPrompt({
  issue,
  existingNote,
  evidenceCount,
  assignedToName,
  offlineMode,
  onAddPhoto,
  onSave,
  onCancel,
}: {
  issue: IssuePromptState;
  existingNote: string;
  evidenceCount: number;
  assignedToName: string;
  offlineMode: boolean;
  onAddPhoto: (files: FileList) => void;
  onSave: ({ noteValue, escalate }: { noteValue: string; escalate?: boolean }) => void;
  onCancel: () => void;
}) {
  const [noteValue, setNoteValue] = useState(existingNote);
  const severity = issue.question.riskLevel || (issue.answer === "fail" ? "Critical" : "High");
  const requiresPhoto = Boolean(issue.question.requiresPhotoEvidence);
  const willCreateAction =
    issue.question.autoActionRequired ||
    severity === "Critical" ||
    severity === "High" ||
    issue.answer === "fail";
  const actionTitle = `Resolve failed check: ${issue.question.text}`;
  const actionDueDate = addDaysIso(ACTION_DUE_DAYS_BY_SEVERITY[severity]);

  useEffect(() => {
    setNoteValue(existingNote);
  }, [existingNote, issue.question.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-900/45 p-3">
      <div className="w-full rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-600">Issue found</p>
        <p className="mt-2 text-sm font-semibold text-slate-900">{issue.question.text}</p>
        <p className="mt-1 text-xs text-slate-500">Answer: {issue.answer.toUpperCase()} • Risk: {severity}</p>
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <p>Photo evidence: {requiresPhoto ? "Required" : "Optional but encouraged"}</p>
          <p>Corrective action: {willCreateAction ? "Will be created" : "Not required"}</p>
        </div>
        {willCreateAction && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <p className="font-semibold">Corrective action preview</p>
            <p className="mt-1">Title: {actionTitle}</p>
            <p>Severity: {severity}</p>
            <p>Due date: {actionDueDate}</p>
            <p>Assigned to: {assignedToName || "Unassigned"}</p>
          </div>
        )}
        <textarea
          value={noteValue}
          onChange={(event) => setNoteValue(event.target.value)}
          placeholder="Describe what was found"
          className="mt-3 min-h-[7rem] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none"
        />
        <div className="mt-3 flex items-center gap-2">
          <label className={`inline-flex h-11 cursor-pointer items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}>
            Add photo
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) {
                  onAddPhoto(event.target.files);
                  event.target.value = "";
                }
              }}
            />
          </label>
          <p className="text-xs text-slate-500">{evidenceCount} photo(s) attached</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => onSave({ noteValue, escalate: false })} className={`h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}>
            Save issue and continue
          </button>
          <button type="button" onClick={onCancel} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700">
            Change answer
          </button>
        </div>
        {offlineMode && <p className="mt-3 text-xs font-medium text-amber-700">Saved on this tablet. It will sync when online.</p>}
      </div>
    </div>
  );
}

function AuditCompletionSummary({
  summary,
  hasMoreAudits,
  onStartNext,
  onReturnDashboard,
}: {
  summary: AuditCompletionSummaryState;
  hasMoreAudits: boolean;
  onStartNext: () => void;
  onReturnDashboard: () => void;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[0_16px_30px_rgba(15,23,42,0.06)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Audit complete</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{summary.auditName}</h2>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <MiniMetric label="Answered" value={String(summary.questionsAnswered)} />
          <MiniMetric label="Issues" value={String(summary.issuesFound)} />
          <MiniMetric label="Actions" value={String(summary.actionsCreated)} />
          <MiniMetric label="Photos" value={String(summary.photosCaptured)} />
          <MiniMetric label="Sync status" value={summary.syncLabel} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onStartNext} className={`h-12 rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}>
            {hasMoreAudits ? "Start next audit" : "All audits complete"}
          </button>
          <button type="button" onClick={onReturnDashboard} className="h-12 rounded-2xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700">
            Return to dashboard
          </button>
        </div>
      </section>
    </div>
  );
}

function LiveGraphChart({
  data,
  chartType,
}: {
  data: Array<{ label: string; value: number; tone: "green" | "amber" | "red" }>;
  chartType: "column" | "line" | "area" | "bar";
}) {
  const max = Math.max(1, ...data.map((item) => item.value));
  const toneColor = (tone: "green" | "amber" | "red") => (tone === "green" ? "#10b981" : tone === "amber" ? "#f59e0b" : "#f43f5e");

  if (chartType === "bar") {
    return (
      <div className="mb-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        {data.map((item) => {
          const width = Math.max(8, Math.round((item.value / max) * 100));
          return (
            <div key={`bar-${item.label}`} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">{item.label}</span>
                <span className="text-slate-500">{item.value}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full" style={{ width: `${width}%`, backgroundColor: toneColor(item.tone) }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const width = 480;
  const height = 180;
  const left = 24;
  const right = 12;
  const top = 12;
  const bottom = 32;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const step = data.length > 1 ? plotW / (data.length - 1) : plotW;
  const points = data.map((item, index) => {
    const x = left + step * index;
    const y = top + (1 - item.value / max) * plotH;
    return { ...item, x, y };
  });
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPoints = `${left},${top + plotH} ${linePoints} ${left + plotW},${top + plotH}`;

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full">
        <line x1={left} y1={top + plotH} x2={left + plotW} y2={top + plotH} stroke="#cbd5e1" strokeWidth="1" />
        {chartType === "column" &&
          points.map((point) => {
            const barW = Math.max(18, plotW / Math.max(data.length * 2, 6));
            return (
              <rect
                key={`col-${point.label}`}
                x={point.x - barW / 2}
                y={point.y}
                width={barW}
                height={top + plotH - point.y}
                rx="4"
                fill={toneColor(point.tone)}
                fillOpacity="0.9"
              />
            );
          })}
        {chartType === "line" && <polyline points={linePoints} fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />}
        {chartType === "area" && (
          <>
            <polygon points={areaPoints} fill="#0f172a" fillOpacity="0.16" />
            <polyline points={linePoints} fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
          </>
        )}
        {(chartType === "line" || chartType === "area") &&
          points.map((point) => <circle key={`dot-${point.label}`} cx={point.x} cy={point.y} r="4" fill={toneColor(point.tone)} />)}
        {points.map((point) => (
          <text key={`lbl-${point.label}`} x={point.x} y={height - 10} textAnchor="middle" fontSize="10" fill="#64748b">
            {point.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

function AdminAction({
  title,
  subtitle,
  actionLabel,
  active,
  disabled,
  onClick,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-4">
      <div className="min-w-0 pr-3">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className={[
          "shrink-0 rounded-xl px-4 py-3 text-xs font-semibold transition",
          disabled
            ? "bg-slate-200 text-slate-400"
            : active
              ? "bg-blue-500/12 text-blue-800"
              : `bg-slate-900 text-white ${slatePrimaryCtaInteract}`,
        ].join(" ")}
      >
        {active ? "Ready" : actionLabel}
      </button>
    </div>
  );
}

function ProcessCard({
  step,
  title,
  text,
  state,
  active,
  actionLabel,
  onAction,
  disabled = false,
  children,
}: {
  step: string;
  title: string;
  text: string;
  state: string;
  active: boolean;
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
            {step}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
          </div>
        </div>
        <div className={["shrink-0 rounded-full px-3 py-1 text-xs font-semibold", active ? "bg-blue-500/12 text-blue-800" : "bg-white text-slate-600"].join(" ")}>
          {active ? "Ready" : "Pending"}
        </div>
      </div>
      <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm text-slate-600">{state}</div>
      {children && <div className="mt-3">{children}</div>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          disabled={disabled || active}
          className={[
            "mt-3 h-11 w-full rounded-2xl text-sm font-semibold transition",
            disabled || active ? "bg-slate-200 text-slate-400" : `bg-slate-900 text-white active:scale-[0.99] ${slatePrimaryCtaInteract}`,
          ].join(" ")}
        >
          {active ? "Ready" : actionLabel}
        </button>
      )}
    </div>
  );
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex max-w-[36rem] flex-col gap-2 px-4">
      {toasts.slice(0, 3).map((toast) => {
        const toneClass =
          toast.tone === "success"
            ? "border-blue-200 bg-blue-50 text-blue-950"
            : toast.tone === "warning"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-slate-200 bg-white text-slate-900";

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.12)] ${toneClass}`}
          >
            <p className="text-sm font-semibold">{toast.title}</p>
            <p className="mt-1 text-sm">{toast.message}</p>
          </div>
        );
      })}
    </div>
  );
}

export default App;
