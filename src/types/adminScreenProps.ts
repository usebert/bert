import type { ComponentType } from "react";
import type { Role } from "../permissions";
import type {
  CompanyFolder,
  CompanySheetSyncStatus,
  User,
  WorkspaceValidation,
} from "./dashboardScreenProps";
import type { FormLanguageCode } from "../config/templateLanguages";
import type { GoogleFormCopyOptionState } from "../utils/googleFormCopyOptionState";
import type {
  Answer,
  AuditQuestion,
  AuditTemplate,
  Priority,
  ScheduleFrequency,
} from "./reportsScreenProps";
import type { CompanyReportUser } from "./reports";
import type { AreaAuditMapping } from "../utils/areaAuditMapping";

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
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  archivedAt?: string;
};

export type UserInvite = {
  id: string;
  email: string;
  role: Role;
  invitedBy: string;
  senderEmail?: string;
  sentAt: string;
  status: "Email sent" | "Invite created" | "Awaiting setup" | "Setup incomplete" | "Stale invite" | "Active" | "Invite sent";
  mailtoUrl?: string;
  appOnboardingUrl?: string;
  loginReady?: boolean;
  tokenId?: string;
  companyFolderId?: string;
};

/** Result of POST /api/onboarding/app-invites/company-user (company user invite email). */
export type CompanyUserInviteEmailResult = {
  email: string;
  role: Role;
  sent: boolean;
  smtpConfigured: boolean;
  senderEmail?: string;
  inviteUrl: string;
  userMessage?: string;
  showTechnicalErrors?: boolean;
  status: "awaiting_setup" | "setup_incomplete" | "active";
  loginReady: boolean;
  setupIncomplete?: boolean;
  storageHint?: string;
  emailDraft?: { subject: string; body: string };
  mailtoUrl?: string;
  smtpError?: string;
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
    setupFolder: boolean;
    auditFormsFolder: boolean;
    recordsFolder: boolean;
    masterSheet: boolean;
    evidenceFolder: boolean;
    exportsFolder: boolean;
    managementNotesFolder: boolean;
  };
  auditFormsFolder: { id: string; name: string } | null;
  setupFolder: { id: string; name: string } | null;
  recordsFolder: { id: string; name: string } | null;
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

/** @deprecated Google Form email path — use CompanyOnboardingInviteResult (app-hosted onboarding). */
export type CompanyOnboardingEmailResult = {
  email: string;
  sent: boolean;
  smtpConfigured: boolean;
  senderEmail?: string;
  onboardingFormUrl: string;
  emailDraft?: { subject: string; body: string };
  mailtoUrl?: string;
};

export type CompanyOnboardingInviteRow = {
  inviteId: string;
  status: string;
  statusCode?: string;
  statusLabel?: string;
  contactEmail: string;
  provisionalCompanyName?: string;
  provisionError?: string;
  provisionStage?: string;
  companyFolderId?: string;
  masterSheetId?: string;
  companyFolderUrl?: string;
  masterSheetUrl?: string;
  canRetrySetup?: boolean;
};

export type CompanyOnboardingInviteResult = {
  ok?: boolean;
  inviteUrl?: string;
  sent?: boolean;
  mailtoUrl?: string;
  invite?: CompanyOnboardingInviteRow;
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
  areaRestrictionsEnabled: boolean;
  areaSyncLoading: boolean;
  areaSyncError: string | null;
  areaAudits: AreaAuditMapping[];
  selectedAreaAuditAreaId: string;
  mappingSyncLoading: boolean;
  mappingSyncError: string | null;
  onSelectAreaAuditArea: (areaId: string) => void;
  onToggleAreaAudit: (areaId: string, auditId: string, enabled: boolean) => void;
  reportUsers: CompanyReportUser[];
  activeCompanyMembers?: Array<{
    email: string;
    name: string;
    role: string;
    accessLevel: string;
    status: string;
    companyId: string;
    companyAreas: string[];
  }>;
  activeMembersLoading?: boolean;
  activeMembersLoadError?: string;
  activeMembersLoadErrorDetail?: string;
  activeMembersWarning?: string;
  userSiteAssignments: UserSiteAssignments;
  onToggleUserSiteAssignment: (email: string, siteId: string) => void;
  onEnableAreaRestrictions: () => void;
  onDisableAreaRestrictions: () => void;
  onRenameArea: (siteId: string, currentName: string) => void;
  onReactivateArea: (siteId: string) => void;
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
  setupFolderInput: string;
  recordsFolderInput: string;
  evidenceFolderInput: string;
  exportsFolderInput: string;
  managementNotesFolderInput: string;
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
  onRepairCompanyFolderStructure?: () => void;
  companyFolderStructureRepairing?: boolean;
  companySetupCurrentStep?: string;
  companySetupError?: {
    failedStep: string;
    errorCode: string;
    message: string;
    technicalError?: string;
    registrySpreadsheetId?: string;
    registryTab?: string;
    registryLocation?: string;
    missingColumns?: string[];
    lookupKeys?: Record<string, string>;
    verifyReadback?: { status?: string; companyId?: string; masterSheetId?: string } | null;
  } | null;
  companySetupWarnings?: string[];
  companySetupResult?: import("../services/companySetupProgressService").MakeUsableResult | null;
  onCreateCompanyMasterSheet?: () => void;
  companyMasterSheetProvisioning?: boolean;
  companyMasterSheetLink?: string;
  onRefreshGoogleStatus: () => void;
  onRefreshOnboardingRecords: () => void;
  onSelectOnboardingRecord: (recordId: string) => void;
  onApplyOnboardingRecord: () => void;
  onFolderNameChange: (value: string) => void;
  onFolderIdChange: (value: string) => void;
  onAuditFormsFolderChange: (value: string) => void;
  onMasterSheetChange: (value: string) => void;
  onSetupFolderChange: (value: string) => void;
  onRecordsFolderChange: (value: string) => void;
  onEvidenceFolderChange: (value: string) => void;
  onExportsFolderChange: (value: string) => void;
  onManagementNotesFolderChange: (value: string) => void;
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
  onMakeCompanyUsable?: () => void;
  /** @deprecated Use onMakeCompanyUsable */
  onCompleteSetup?: () => void;
  onOneClickGoogleOnboarding: () => void;
  onTemplateNameChange: (value: string) => void;
  templateCategoryInput: string;
  onTemplateCategoryChange: (value: string) => void;
  defaultFormLanguage: FormLanguageCode;
  onDefaultFormLanguageChange: (value: FormLanguageCode) => void;
  templateLanguageInput: FormLanguageCode;
  onTemplateLanguageChange: (value: FormLanguageCode) => void;
  googleFormCopyLanguage: FormLanguageCode;
  onGoogleFormCopyLanguageChange: (value: FormLanguageCode) => void;
  createGoogleFormTemplateCopy: boolean;
  onCreateGoogleFormTemplateCopyChange: (value: boolean) => void;
  googleFormCopyOption: GoogleFormCopyOptionState;
  googleFormCopyPlacement: "master" | "company";
  companyFolderId: string;
  companyName?: string;
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
  companyUserInviteEmailResult: CompanyUserInviteEmailResult | null;
  companyUserInviteEmailSending: boolean;
  onDismissCompanyUserInviteEmailResult: () => void;
  onResendInvite: (invite: UserInvite) => void;
  onDeleteInvite: (invite: UserInvite) => void;
  onRemoveCompanyUser: (invite: UserInvite) => void;
  onResyncUsers: () => void;
  onSelectSite: (siteId: string) => void;
  onAddSite: () => void;
  onArchiveSite: (siteId: string) => void;
  standaloneOnboarding?: boolean;
  /** Master Godmode: onboarding with no prior company context selected. */
  godmodeNewCompanyOnboarding?: boolean;
  /** Master Godmode: resume setup for a selected company without a linked master sheet. */
  godmodeIncompleteCompanySetup?: boolean;
  /** Paid-pilot nav: focus Companies / Users / Invites content. */
  pilotFocus?: "companies" | "onboarding" | "users" | "invites";
  pilotShellScreen?: "companies" | "onboarding";
  /** Scroll to a section when the workspace screen opens (e.g. template builder). */
  initialScrollTarget?: string | null;
  hideMasterLocalDemoTools?: boolean;
  /** @deprecated Legacy Google Form email field — app-hosted onboarding uses CompanyOnboardingInvitePanel. */
  godModeAppInviteEmail?: string;
  onGodModeAppInviteEmailChange?: (value: string) => void;
  onSendGodModeAppCompanyInvite?: () => void;
  companyOnboardingEmailResult?: CompanyOnboardingEmailResult | null;
  companyOnboardingEmailSending?: boolean;
  onDismissCompanyOnboardingEmailResult?: () => void;
  onSendCompanyOnboardingInvite: (input: {
    contactEmail: string;
    contactName: string;
    provisionalCompanyName: string;
    notes: string;
  }) => Promise<CompanyOnboardingInviteResult | null>;
  companyOnboardingInviteResult: CompanyOnboardingInviteResult | null;
  companyOnboardingInviteSending: boolean;
  onDismissCompanyOnboardingInviteResult: () => void;
  parseJsonApiResponse: <T = Record<string, unknown>>(response: Response) => Promise<T>;
  /** Master-only: navigate to protected Initial Setup (/setup/initial). */
  onOpenInitialSetup?: () => void;
  /** Master-only: company master spreadsheet ID for workspace reset. */
  companyMasterSheetId?: string;
  onCompanyWorkspaceResetSuccess?: (message: string) => void;
  onCompanyWorkspaceResetError?: (message: string) => void;
  onCompanyRegistryUpdated?: (payload: {
    companyId: string;
    registryStatus: string;
    masterSheetId?: string;
  }) => void | Promise<void>;
  onClearSetupError?: () => void;
  /** Master Godmode: block company-scoped actions until a live workspace is selected. */
  masterCompanyContextBlocked?: boolean;
  masterCompanyContextMessage?: string;
  /** Company Admin: fixed invite target label (no Godmode company picker). */
  inviteWorkspaceBanner?: string;
  /** Canonical Companies registry status for invite LIVE gating. */
  companyRegistryStatus?: string;
  AppIcon: ComponentType<{ name: string; className?: string }>;
  slatePrimaryCtaInteract: string;
};
