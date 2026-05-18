import type { ComponentType } from "react";
import type { Role } from "../permissions";
import type {
  CompanyFolder,
  CompanySheetSyncStatus,
  User,
  WorkspaceValidation,
} from "./dashboardScreenProps";
import type {
  Answer,
  AuditQuestion,
  AuditTemplate,
  Priority,
  ScheduleFrequency,
} from "./reportsScreenProps";
import type { CompanyReportUser } from "./reports";

export type OnboardingSource = {
  configured: boolean;
  formId: string;
  formName: string;
  sheetId: string;
  sheetName: string;
};

export type OnboardingRecord = {
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

export type Site = {
  id: string;
  name: string;
  code: string;
  active: boolean;
};

export type UserInvite = {
  id: string;
  email: string;
  role: Role;
  invitedBy: string;
  senderEmail?: string;
  sentAt: string;
  status: "Invite sent";
  mailtoUrl?: string;
  appOnboardingUrl?: string;
};

export type UserSiteAssignments = Record<string, string[]>;

export type FolderInspection = {
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

export type DraftTemplateQuestion = {
  id: string;
  text: string;
  fieldType: AuditQuestion["fieldType"];
  answerPrompts?: Partial<Record<Answer, string[]>>;
};

export type ScheduleScope = "Company schedule" | "Personal schedule";
export type OverdueAlertTiming = "At due time" | "30 minutes overdue" | "1 hour overdue" | "2 hours overdue";
export type CompletionCheckTiming = "30 minutes after send" | "1 hour after send" | "At due time" | "2 hours after due";

export type ScheduleItem = {
  id: string;
};

export type AdminScreenProps = {
  currentUser: User;
  googleConnected: boolean;
  backendConfigured: boolean;
  sharedDriveId: string;
  googleStatusLoading: boolean;
  folderInspection: FolderInspection | null;
  folderInspectionLoading: boolean;
  onboardingSource: OnboardingSource | null;
  onboardingRecords: OnboardingRecord[];
  onboardingRecordsLoading: boolean;
  selectedOnboardingRecordId: string;
  folders: CompanyFolder[];
  selectedFolder: CompanyFolder | null;
  schedules: ScheduleItem[];
  inviteEmailInput: string;
  inviteRoleInput: Role;
  invitedUsers: UserInvite[];
  sites: Site[];
  selectedSiteId: string;
  reportUsers: CompanyReportUser[];
  userSiteAssignments: UserSiteAssignments;
  onToggleUserSiteAssignment: (email: string, siteId: string) => void;
  creatableRoles: Role[];
  notificationsEnabled: boolean;
  companySheetSync: CompanySheetSyncStatus | null;
  workspaceValidation: WorkspaceValidation | null;
  workspaceValidationLoading: boolean;
  templates: AuditTemplate[];
  folderNameInput: string;
  folderIdInput: string;
  auditFormsFolderInput: string;
  masterSheetInput: string;
  evidenceFolderInput: string;
  healthSafetyFolderInput: string;
  exportsFolderInput: string;
  adminNotesFolderInput: string;
  templateNameInput: string;
  templateQuestionInput: string;
  templateQuestionTypeInput: AuditQuestion["fieldType"];
  templateDraftQuestions: DraftTemplateQuestion[];
  syncState: string;
  scheduleNameInput: string;
  scheduleAreaInput: string;
  scheduleOwnerInput: string;
  scheduleScopeInput: ScheduleScope;
  schedulePersonalAssigneeInput: string;
  scheduleFrequencyInput: ScheduleFrequency;
  scheduleSendTimeInput: string;
  scheduleRecipientsInput: string;
  scheduleOverdueAlertRecipientsInput: string;
  scheduleEscalationContactInput: string;
  scheduleOverdueAlertTimingInput: OverdueAlertTiming;
  scheduleCompletionCheckTimingInput: CompletionCheckTiming;
  scheduleNextDueHoursInput: string;
  schedulePriorityInput: Priority;
  onGoogleConnect: () => void;
  onGoogleDisconnect: () => void;
  onRequestNotifications: () => void;
  onValidateWorkspace: () => void;
  onRepairWorkspace: () => void;
  onRefreshGoogleStatus: () => void;
  onRefreshOnboardingRecords: () => void;
  onSelectOnboardingRecord: (recordId: string) => void;
  onApplyOnboardingRecord: () => void;
  onFolderNameChange: (value: string) => void;
  onFolderIdChange: (value: string) => void;
  onAuditFormsFolderChange: (value: string) => void;
  onMasterSheetChange: (value: string) => void;
  onEvidenceFolderChange: (value: string) => void;
  onHealthSafetyFolderChange: (value: string) => void;
  onExportsFolderChange: (value: string) => void;
  onAdminNotesFolderChange: (value: string) => void;
  onScheduleNameChange: (value: string) => void;
  onScheduleAreaChange: (value: string) => void;
  onScheduleOwnerChange: (value: string) => void;
  onScheduleScopeChange: (value: ScheduleScope) => void;
  onSchedulePersonalAssigneeChange: (value: string) => void;
  onScheduleFrequencyChange: (value: ScheduleFrequency) => void;
  onScheduleSendTimeChange: (value: string) => void;
  onScheduleRecipientsChange: (value: string) => void;
  onScheduleOverdueAlertRecipientsChange: (value: string) => void;
  onScheduleEscalationContactChange: (value: string) => void;
  onScheduleOverdueAlertTimingChange: (value: OverdueAlertTiming) => void;
  onScheduleCompletionCheckTimingChange: (value: CompletionCheckTiming) => void;
  onScheduleNextDueHoursChange: (value: string) => void;
  onSchedulePriorityChange: (value: Priority) => void;
  onOpenOnboardingForm: () => void;
  onStartCompanyOnboarding: () => void;
  onAddFolder: () => void;
  onOneClickGoogleOnboarding: () => void;
  onTemplateNameChange: (value: string) => void;
  onTemplateQuestionChange: (value: string) => void;
  onTemplateQuestionTypeChange: (value: AuditQuestion["fieldType"]) => void;
  onAddTemplateQuestion: () => void;
  onRemoveTemplateQuestion: (questionId: string) => void;
  onAddAnswerPromptToDraftQuestion: (questionId: string, answer: Answer) => void;
  onRemoveAnswerPromptFromDraftQuestion: (questionId: string, answer: Answer, promptIndex: number) => void;
  onAddTemplate: () => void;
  onToggleTemplate: (templateId: string) => void;
  onAddSchedule: () => void;
  onSelectFolder: (folderId: string) => void;
  onVerifyOnboarding: () => void;
  onVerifyAudits: () => void;
  onVerifyResponseSheet: () => void;
  onSyncForms: () => void;
  onLoadDemoData: () => void;
  onClearDemoData: () => void;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (value: Role) => void;
  onInviteUser: () => void;
  onResendInvite: (invite: UserInvite) => void;
  onDeleteInvite: (invite: UserInvite) => void;
  onResyncUsers: () => void;
  onSelectSite: (siteId: string) => void;
  onAddSite: () => void;
  onArchiveSite: (siteId: string) => void;
  standaloneOnboarding?: boolean;
  /** Paid-pilot nav: focus Companies / Users / Invites content. */
  pilotFocus?: "companies" | "users" | "invites";
  hideMasterLocalDemoTools?: boolean;
  godModeAppInviteEmail: string;
  onGodModeAppInviteEmailChange: (value: string) => void;
  onSendGodModeAppCompanyInvite: () => void;
  AppIcon: ComponentType<{ name: string; className?: string }>;
  slatePrimaryCtaInteract: string;
};
