import type { Role } from "../permissions";
import type { Audit, AuditStatus, AuditTemplate, ScheduleDay, ScheduleFrequency } from "./reportsScreenProps";
import type { AuditDraft, User } from "./dashboardScreenProps";

export type AuditAccessLevel = "Full access" | "Oversight" | "Can complete" | "Complete" | "No access";

export type AuditAccessMatrixCell = {
  auditId: string;
  auditName: string;
  access: AuditAccessLevel;
  detail: string;
  hasAccess: boolean;
};

export type AuditAccessMatrixRow = {
  email: string;
  name: string;
  role: Role;
  accessibleCount: number;
  cells: AuditAccessMatrixCell[];
};

export type AuditScheduleMatrixInfo = {
  scheduleName: string;
  versionLabel: string;
  frequency: ScheduleFrequency;
  days: ScheduleDay[];
  liveTime: string;
  completionHours: number;
};

export type AuditsScreenProps = {
  currentUser: User;
  audits: Audit[];
  groupedAudits: Record<AuditStatus, Audit[]>;
  drafts: Record<string, AuditDraft>;
  unsyncedAuditIds: Set<string>;
  userProfilePhotos: Record<string, string>;
  users: User[];
  onOpenAudit: (auditId: string) => void;
  auditAccessMatrix: AuditAccessMatrixRow[];
  auditScheduleMatrix: Record<string, AuditScheduleMatrixInfo>;
  onToggleAuditAccess: (email: string, auditId: string, currentAccess: AuditAccessLevel) => void;
  onNavigateToToday?: () => void;
  onNavigateToSubmit?: () => void;
  onNavigateToSchedules?: () => void;
  onNavigateToTemplateBuilder?: () => void;
  onNavigateToAuditBuilder?: () => void;
  onNavigateToWorkspace?: () => void;
  templates?: AuditTemplate[];
  syncState?: string;
  googleConnected?: boolean;
  companyFolderId?: string;
  canCreateTemplates?: boolean;
  onToggleTemplate?: (templateId: string) => void;
  onEditTemplate?: (templateId: string) => void;
  onGoogleFormUpdated?: (
    templateId: string,
    record: {
      googleFormId?: string;
      googleFormEditUrl?: string;
      googleFormResponderUrl?: string;
      syncStatus?: string;
      currentDriveFolderName?: string;
    },
  ) => void;
};
