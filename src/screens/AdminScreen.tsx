import { useEffect, useMemo, useState } from "react";
import { SECTION_INTROS } from "../config/sectionIntros";
import { canAccessAdmin, canAccessAdminOnboardingWorkspace, canManageAreas, getRoleDisplayName } from "../permissions";
import { SitesAreasPanel } from "../components/admin/SitesAreasPanel";
import { EmptyPanel, MiniMetric, SectionHeader } from "../components/dashboard/DashboardPrimitives";
import { SectionIntro } from "../components/SectionIntro";
import { DangerActionButton } from "../components/DangerActionButton";
import { UsersInvitesPilotPanel } from "../components/admin/UsersInvitesPilotPanel";
import { InviteStatusLegend } from "../components/InviteStatusLegend";
import { isDebugUiAllowed } from "../utils/debugUiVisibility";
import { WhatHappensNextPanel } from "../components/WhatHappensNextPanel";
import {
  formatInviteStatusLabel,
  formatUserRoleLabel,
  getInviteStatusHelp,
  inviteStatusBadgeClass,
  isLegacyInviteRowId,
  isStaleOrIncompleteInviteStatus,
} from "../utils/inviteStatusDisplay";
import type { AdminScreenProps, CompanyOnboardingEmailResult, CompanyUserInviteEmailResult } from "../types/adminScreenProps";
import type { Role } from "../permissions";
import type { Answer, AuditQuestion } from "../types/reportsScreenProps";

const USER_INVITE_NEXT_STEPS = [
  "Recipient checks Inbox and Junk/Spam for the setup email.",
  "They open the invite link and complete name and password setup.",
  "Verify the company master spreadsheet Users tab and Config UserAuth.",
  "Status changes to Active when they can sign in to BERT.",
];

const COMPANY_ONBOARDING_NEXT_STEPS = [
  "Recipient completes the Google onboarding form.",
  "Review the submission under Company Onboarding.",
  "Create or link the company workspace folder when ready.",
  "Invite the company administrator from Users & Invites.",
];

function normalizeIdentity(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function isValidEmailAddress(value: string) {
  const trimmed = value.trim().toLowerCase();
  return Boolean(trimmed) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function companyAdminEmailError(value: string, touched: boolean) {
  const trimmed = value.trim();
  if (!touched && !trimmed) {
    return "";
  }
  if (!trimmed) {
    return "Enter the company administrator email.";
  }
  if (!isValidEmailAddress(trimmed)) {
    return "Enter a valid email address.";
  }
  return "";
}

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CompanyOnboardingEmailResultPanel({
  result,
  onDismiss,
  slatePrimaryCtaInteract,
}: {
  result: CompanyOnboardingEmailResult;
  onDismiss: () => void;
  slatePrimaryCtaInteract: string;
}) {
  const [copyLinkDone, setCopyLinkDone] = useState(false);
  const [copyDraftDone, setCopyDraftDone] = useState(false);

  const senderEmail = result.senderEmail || "admin@usebert.co.uk";

  if (result.sent) {
    return (
      <div className="mt-4 rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-4">
        <p className="text-sm font-semibold text-emerald-100">Onboarding email sent</p>
        <p className="mt-1 text-sm leading-6 text-emerald-50/90">
          We sent the company onboarding form to <span className="font-semibold">{result.email}</span>. Ask the recipient
          to check their Inbox and Junk/Spam folder if it does not arrive within a few minutes.
        </p>
        <dl className="mt-3 text-xs text-emerald-100/80">
          <div>
            <dt className="font-semibold uppercase tracking-[0.14em] text-emerald-200/70">From</dt>
            <dd className="mt-0.5 text-sm text-emerald-50">{senderEmail}</dd>
          </div>
        </dl>
        <button type="button" onClick={onDismiss} className={`mt-3 text-xs font-semibold text-emerald-200 underline-offset-2 hover:underline ${slatePrimaryCtaInteract}`}>
          Dismiss
        </button>
      </div>
    );
  }

  const draftText = result.emailDraft
    ? `Subject: ${result.emailDraft.subject}\n\n${result.emailDraft.body}`
    : "";

  return (
    <div className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-950/25 p-4">
      <p className="text-sm font-semibold text-amber-100">Onboarding email ready</p>
      <p className="mt-1 text-sm leading-6 text-amber-50/90">
        {result.smtpConfigured
          ? "The server could not send the email. Copy the link or draft and send it manually."
          : "Email sending is not configured. Copy the link or draft and send it manually."}
      </p>
      <p className="mt-2 text-sm leading-6 text-amber-50/90">
        Email sending may be blocked or filtered. You can send the link manually from your normal mailbox. Ask the
        recipient to check Inbox and Junk/Spam.
      </p>
      <dl className="mt-3 space-y-2 text-xs text-slate-300">
        <div>
          <dt className="font-semibold uppercase tracking-[0.14em] text-slate-500">From (expected)</dt>
          <dd className="mt-0.5 text-sm text-white">{senderEmail}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.14em] text-slate-500">Recipient</dt>
          <dd className="mt-0.5 break-all text-sm text-white">{result.email}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.14em] text-slate-500">Onboarding form link</dt>
          <dd className="mt-0.5 break-all text-sm text-sky-200">{result.onboardingFormUrl}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            const ok = await copyTextToClipboard(result.onboardingFormUrl);
            if (ok) {
              setCopyLinkDone(true);
              setTimeout(() => setCopyLinkDone(false), 2000);
            }
          }}
          className="h-10 rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white hover:bg-white/15"
        >
          {copyLinkDone ? "Link copied" : "Copy link"}
        </button>
        {draftText ? (
          <button
            type="button"
            onClick={async () => {
              const ok = await copyTextToClipboard(draftText);
              if (ok) {
                setCopyDraftDone(true);
                setTimeout(() => setCopyDraftDone(false), 2000);
              }
            }}
            className="h-10 rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white hover:bg-white/15"
          >
            {copyDraftDone ? "Draft copied" : "Copy email draft"}
          </button>
        ) : null}
        {result.mailtoUrl ? (
          <a
            href={result.mailtoUrl}
            className="inline-flex h-10 items-center rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white hover:bg-white/15"
          >
            Open in mail app
          </a>
        ) : null}
      </div>
      <button type="button" onClick={onDismiss} className={`mt-3 text-xs font-semibold text-amber-200 underline-offset-2 hover:underline ${slatePrimaryCtaInteract}`}>
        Dismiss
      </button>
    </div>
  );
}

function CompanyUserInviteEmailResultPanel({
  result,
  onDismiss,
  slatePrimaryCtaInteract,
}: {
  result: CompanyUserInviteEmailResult;
  onDismiss: () => void;
  slatePrimaryCtaInteract: string;
}) {
  const [copyLinkDone, setCopyLinkDone] = useState(false);
  const [copyDraftDone, setCopyDraftDone] = useState(false);
  const senderEmail = result.senderEmail || "admin@usebert.co.uk";

  if (result.sent) {
    return (
      <div className="mt-4 rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-4">
        <p className="text-sm font-semibold text-emerald-100">User invite sent</p>
        <p className="mt-1 text-sm leading-6 text-emerald-50/90">
          We sent an invite to <span className="font-semibold">{result.email}</span> as{" "}
          <span className="font-semibold">{result.role}</span>. Ask them to check their Inbox and Junk/Spam folder if it
          does not arrive within a few minutes.
        </p>
        {!result.loginReady ? (
          <p className="mt-2 text-sm leading-6 text-emerald-50/90">
            The user must open the invite link and finish account setup (name and password) before they can sign in.
            After completion, verify the <span className="font-semibold">company master spreadsheet</span> Users tab and
            Config UserAuth — not the operator Master sheet.
          </p>
        ) : (
          <p className="mt-2 text-sm leading-6 text-emerald-50/90">This account is ready for company sign-in.</p>
        )}
        <dl className="mt-3 text-xs text-emerald-100/80">
          <div>
            <dt className="font-semibold uppercase tracking-[0.14em] text-emerald-200/70">From</dt>
            <dd className="mt-0.5 text-sm text-emerald-50">{senderEmail}</dd>
          </div>
        </dl>
        <button type="button" onClick={onDismiss} className={`mt-3 text-xs font-semibold text-emerald-200 underline-offset-2 hover:underline ${slatePrimaryCtaInteract}`}>
          Dismiss
        </button>
      </div>
    );
  }

  const draftText = result.emailDraft ? `Subject: ${result.emailDraft.subject}\n\n${result.emailDraft.body}` : "";

  return (
    <div className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-950/25 p-4">
      <p className="text-sm font-semibold text-amber-100">User invite ready</p>
      <p className="mt-1 text-sm leading-6 text-amber-50/90">
        Email could not be sent. Copy the invite link or draft and send it manually.
      </p>
      {result.smtpError ? (
        <p className="mt-2 text-xs leading-5 text-amber-100/80">Reason: {result.smtpError}</p>
      ) : null}
      <dl className="mt-3 space-y-2 text-xs text-slate-300">
        <div>
          <dt className="font-semibold uppercase tracking-[0.14em] text-slate-500">Recipient</dt>
          <dd className="mt-0.5 break-all text-sm text-white">{result.email}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.14em] text-slate-500">Role</dt>
          <dd className="mt-0.5 text-sm text-white">{result.role}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.14em] text-slate-500">Invite link</dt>
          <dd className="mt-0.5 break-all text-sm text-sky-200">{result.inviteUrl}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            const ok = await copyTextToClipboard(result.inviteUrl);
            if (ok) {
              setCopyLinkDone(true);
              setTimeout(() => setCopyLinkDone(false), 2000);
            }
          }}
          className="h-10 rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white hover:bg-white/15"
        >
          {copyLinkDone ? "Link copied" : "Copy invite link"}
        </button>
        {draftText ? (
          <button
            type="button"
            onClick={async () => {
              const ok = await copyTextToClipboard(draftText);
              if (ok) {
                setCopyDraftDone(true);
                setTimeout(() => setCopyDraftDone(false), 2000);
              }
            }}
            className="h-10 rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white hover:bg-white/15"
          >
            {copyDraftDone ? "Draft copied" : "Copy email draft"}
          </button>
        ) : null}
        {result.mailtoUrl ? (
          <a
            href={result.mailtoUrl}
            className="inline-flex h-10 items-center rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white hover:bg-white/15"
          >
            Open in mail app
          </a>
        ) : null}
      </div>
      <button type="button" onClick={onDismiss} className={`mt-3 text-xs font-semibold text-amber-200 underline-offset-2 hover:underline ${slatePrimaryCtaInteract}`}>
        Dismiss
      </button>
    </div>
  );
}

function isActiveCompanyUserInvite(invite: { status: string; loginReady?: boolean }) {
  return invite.status === "Active" || invite.loginReady === true;
}

function GoogleWorkspaceSetupNotice({
  backendConfigured,
  googleConnected,
  showInitialSetupCta,
  onOpenInitialSetup,
  slatePrimaryCtaInteract,
}: {
  backendConfigured: boolean;
  googleConnected: boolean;
  showInitialSetupCta: boolean;
  onOpenInitialSetup?: () => void;
  slatePrimaryCtaInteract: string;
}) {
  if (backendConfigured && googleConnected) {
    return null;
  }
  return (
    <section className="rounded-[1.75rem] border border-amber-200 bg-gradient-to-b from-amber-50 to-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-slate-900">Google Workspace needs setup</p>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        {!backendConfigured || !googleConnected
          ? "Connect Google Workspace in Initial Setup before creating company workspaces or company user logins."
          : null}
      </p>
      {showInitialSetupCta && onOpenInitialSetup ? (
        <button
          type="button"
          onClick={onOpenInitialSetup}
          className={`mt-3 h-11 rounded-2xl bg-[#ea580c] px-5 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
        >
          Open Initial Setup
        </button>
      ) : null}
    </section>
  );
}

export function AdminScreen({
  currentUser,
  googleConnected,
  backendConfigured,
  sharedDriveId,
  googleStatusLoading,
  folderInspection,
  folderInspectionLoading,
  onboardingSource,
  onboardingRecords,
  onboardingRecordsLoading,
  selectedOnboardingRecordId,
  folders,
  selectedFolder,
  schedules,
  inviteEmailInput,
  inviteRoleInput,
  invitedUsers,
  sites,
  selectedSiteId,
  areaRestrictionsEnabled,
  areaSyncLoading,
  areaSyncError,
  reportUsers,
  userSiteAssignments,
  onToggleUserSiteAssignment,
  onEnableAreaRestrictions,
  onDisableAreaRestrictions,
  onRenameArea,
  onReactivateArea,
  creatableRoles,
  notificationsEnabled,
  companySheetSync,
  workspaceValidation,
  workspaceValidationLoading,
  templates,
  folderNameInput,
  folderIdInput,
  auditFormsFolderInput,
  masterSheetInput,
  evidenceFolderInput,
  healthSafetyFolderInput,
  exportsFolderInput,
  adminNotesFolderInput,
  templateNameInput,
  templateQuestionInput,
  templateQuestionTypeInput,
  templateDraftQuestions,
  syncState,
  scheduleNameInput,
  scheduleAreaInput,
  scheduleOwnerInput,
  scheduleScopeInput,
  schedulePersonalAssigneeInput,
  scheduleFrequencyInput,
  scheduleSendTimeInput,
  scheduleRecipientsInput,
  scheduleOverdueAlertRecipientsInput,
  scheduleEscalationContactInput,
  scheduleOverdueAlertTimingInput,
  scheduleCompletionCheckTimingInput,
  scheduleNextDueHoursInput,
  schedulePriorityInput,
  onGoogleConnect,
  onGoogleDisconnect,
  onRequestNotifications,
  onValidateWorkspace,
  onRepairWorkspace,
  onRefreshGoogleStatus,
  onRefreshOnboardingRecords,
  onSelectOnboardingRecord,
  onApplyOnboardingRecord,
  onFolderNameChange,
  onFolderIdChange,
  onAuditFormsFolderChange,
  onMasterSheetChange,
  onEvidenceFolderChange,
  onHealthSafetyFolderChange,
  onExportsFolderChange,
  onAdminNotesFolderChange,
  onScheduleNameChange,
  onScheduleAreaChange,
  onScheduleOwnerChange,
  onScheduleScopeChange,
  onSchedulePersonalAssigneeChange,
  onScheduleFrequencyChange,
  onScheduleSendTimeChange,
  onScheduleRecipientsChange,
  onScheduleOverdueAlertRecipientsChange,
  onScheduleEscalationContactChange,
  onScheduleOverdueAlertTimingChange,
  onScheduleCompletionCheckTimingChange,
  onScheduleNextDueHoursChange,
  onSchedulePriorityChange,
  onOpenOnboardingForm,
  onStartCompanyOnboarding,
  onAddFolder,
  onOneClickGoogleOnboarding,
  onTemplateNameChange,
  onTemplateQuestionChange,
  onTemplateQuestionTypeChange,
  onAddTemplateQuestion,
  onRemoveTemplateQuestion,
  onAddAnswerPromptToDraftQuestion,
  onRemoveAnswerPromptFromDraftQuestion,
  onAddTemplate,
  onToggleTemplate,
  onAddSchedule,
  onSelectFolder,
  onVerifyOnboarding,
  onVerifyAudits,
  onVerifyResponseSheet,
  onSyncForms,
  onLoadDemoData,
  onClearDemoData,
  onInviteEmailChange,
  onInviteRoleChange,
  onInviteUser,
  companyUserInviteEmailResult,
  companyUserInviteEmailSending,
  onDismissCompanyUserInviteEmailResult,
  onResendInvite,
  onDeleteInvite,
  onRemoveCompanyUser,
  onResyncUsers,
  onSelectSite,
  onAddSite,
  onArchiveSite,
  standaloneOnboarding = false,
  pilotFocus = undefined,
  pilotShellScreen = undefined,
  hideMasterLocalDemoTools = false,
  godModeAppInviteEmail,
  onGodModeAppInviteEmailChange,
  onSendGodModeAppCompanyInvite,
  companyOnboardingEmailResult,
  companyOnboardingEmailSending,
  onDismissCompanyOnboardingEmailResult,
  onOpenInitialSetup,
  AppIcon,
  slatePrimaryCtaInteract,
}: AdminScreenProps) {
  const adminOnly = !canAccessAdmin(currentUser.role);
  const masterOnly = currentUser.role !== "Master";
  const canInviteNewCompany = currentUser.role === "Master" || currentUser.role === "Admin";
  const godModeFirstUserInvite =
    currentUser.role === "Master" &&
    (companySheetSync?.usersCount ?? 0) === 0 &&
    invitedUsers.length === 0;
  const isCompaniesScreen = pilotFocus === "companies" || pilotShellScreen === "companies";
  const isUsersInvitesScreen = pilotFocus === "users" || pilotFocus === "invites";
  const isOnboardingScreen =
    pilotFocus === "onboarding" || pilotShellScreen === "onboarding" || standaloneOnboarding;
  const usersInvitesPilotMode = isUsersInvitesScreen;
  const workspaceSetupComplete = syncState === "Synced" && Boolean(selectedFolder);
  const showAuditTemplateBuilder = !pilotFocus;
  const pilotHeroLight = isCompaniesScreen || isOnboardingScreen || isUsersInvitesScreen;
  const pilotLightSurface = "rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm";
  const companyAdminShell = currentUser.role === "Admin";
  const onboardingPanelClass = companyAdminShell
    ? pilotLightSurface
    : "rounded-[1.75rem] border border-slate-800 bg-slate-950 p-4 shadow-sm";
  const onboardingHeadingClass = companyAdminShell ? "text-slate-900" : "text-white";
  const onboardingBodyClass = companyAdminShell ? "text-slate-600" : "text-slate-300";
  const onboardingEyebrowClass = companyAdminShell ? "text-slate-500" : "text-slate-400";
  const pilotLightNested = "rounded-2xl border border-slate-200 bg-slate-50 p-4";
  const pilotEditableInput =
    "h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500";
  const [adminView, setAdminView] = useState<"overview" | "onboarding">(
    isOnboardingScreen ? "onboarding" : "overview",
  );
  const [showAdvancedOnboardingActions, setShowAdvancedOnboardingActions] = useState(false);
  const [showOnboardingAdvancedTools, setShowOnboardingAdvancedTools] = useState(false);
  const masterDemoToolsVisible =
    isDebugUiAllowed() || showAdvancedOnboardingActions || (isOnboardingScreen && showOnboardingAdvancedTools);
  const [pendingAdminScrollTarget, setPendingAdminScrollTarget] = useState<string | null>(null);
  const onboardingMode =
    !usersInvitesPilotMode &&
    (isOnboardingScreen || (canAccessAdminOnboardingWorkspace(currentUser.role) && adminView === "onboarding"));
  useEffect(() => {
    if (pilotFocus === "onboarding") {
      setAdminView("onboarding");
      return;
    }
    if (pilotFocus === "companies") {
      setAdminView("overview");
      return;
    }
    if (pilotFocus === "users" || pilotFocus === "invites") {
      setAdminView("overview");
    }
  }, [pilotFocus]);
  const godModeFullVisibility = currentUser.role === "Master";
  const googleWorkspaceReady = backendConfigured && googleConnected;
  const showInitialSetupCta = currentUser.role === "Master";
  const [inviteAdminEmailTouched, setInviteAdminEmailTouched] = useState(false);
  const inviteAdminEmailValidationError = useMemo(
    () => companyAdminEmailError(godModeAppInviteEmail, inviteAdminEmailTouched),
    [godModeAppInviteEmail, inviteAdminEmailTouched],
  );
  const canCreateCompanyWorkspace =
    googleWorkspaceReady &&
    isValidEmailAddress(godModeAppInviteEmail) &&
    !inviteAdminEmailValidationError &&
    !companyOnboardingEmailSending;
  const companyWorkspaceButtonLabel = companyOnboardingEmailSending
    ? "Sending…"
    : !googleWorkspaceReady
      ? "Connect Google first"
      : inviteAdminEmailValidationError || !godModeAppInviteEmail.trim()
        ? "Enter company administrator email"
        : "Send onboarding email";
  const workspaceLinksReady =
    Boolean(folderIdInput.trim()) && Boolean(masterSheetInput.trim());
  const workspaceSetupButtonLabel = !googleWorkspaceReady
    ? "Connect Google first"
    : !workspaceLinksReady
      ? "Add company folder and master sheet first"
      : folderInspectionLoading
        ? "Checking links..."
        : syncState === "Synced"
          ? "Populate app again"
          : "Populate app";
  const showCompanyInviteCard = canInviteNewCompany && isOnboardingScreen;
  const activeOnboardingRecord = useMemo(
    () => onboardingRecords.find((record) => record.id === selectedOnboardingRecordId) ?? null,
    [onboardingRecords, selectedOnboardingRecordId],
  );

  const handleCompanyWorkspaceSubmit = () => {
    setInviteAdminEmailTouched(true);
    if (!googleWorkspaceReady || !isValidEmailAddress(godModeAppInviteEmail)) {
      return;
    }
    onSendGodModeAppCompanyInvite();
  };
  useEffect(() => {
    if (!pendingAdminScrollTarget) {
      return;
    }
    const targetElement = document.getElementById(pendingAdminScrollTarget);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingAdminScrollTarget(null);
    }
  }, [pendingAdminScrollTarget, onboardingMode, adminView, godModeFullVisibility]);

  const pilotTitles: Record<"companies" | "onboarding" | "users" | "invites", { title: string; intro: string }> = {
    companies: {
      title: "Companies",
      intro: SECTION_INTROS.companies,
    },
    onboarding: {
      title: "Company Onboarding",
      intro: SECTION_INTROS.companyOnboarding,
    },
    users: {
      title: "Users & Invites",
      intro: SECTION_INTROS.usersInvites,
    },
    invites: {
      title: "Team",
      intro: SECTION_INTROS.team,
    },
  };

  return (
    <div className="space-y-4">
      {pilotFocus ? (
        <section className={pilotHeroLight ? pilotLightSurface : "rounded-[1.75rem] bg-slate-950 px-5 py-4 text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)]"}>
          <p className={["text-xs font-semibold uppercase tracking-[0.3em]", pilotHeroLight ? "text-slate-500" : "text-slate-400"].join(" ")}>
            {pilotTitles[pilotFocus].title}
          </p>
          <h2 className={["mt-1 text-xl font-semibold tracking-tight", pilotHeroLight ? "text-slate-900" : "text-white"].join(" ")}>
            {pilotTitles[pilotFocus].title}
          </h2>
          <SectionIntro text={pilotTitles[pilotFocus].intro} className="mt-2" role={pilotHeroLight ? "Master" : undefined} />
        </section>
      ) : null}

      {isCompaniesScreen ? (
        <section className={pilotLightSurface}>
          <SectionHeader
            icon="clipboard"
            eyebrow="Workspaces"
            title="Company workspaces"
            subtitle="Select a company to review setup status or open its Drive folder."
          />
          {folders.length === 0 ? (
            <EmptyPanel
              title="No company workspaces yet"
              text="Link company folders from Google Drive after onboarding, or send a new onboarding form from Company Onboarding."
            />
          ) : (
            <ul className="mt-3 space-y-2">
              {folders.map((folder) => {
                const selected = selectedFolder?.id === folder.id;
                return (
                  <li key={folder.id}>
                    <button
                      type="button"
                      onClick={() => onSelectFolder(folder.id)}
                      className={[
                        "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition",
                        selected
                          ? "border-orange-300 bg-orange-50 ring-1 ring-orange-200"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white",
                      ].join(" ")}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{folder.name}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {syncState === "Synced" && selected ? "Live in app" : "Setup or review"}
                        </p>
                      </div>
                      <span
                        className={[
                          "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                          selected && syncState === "Synced"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600",
                        ].join(" ")}
                      >
                        {selected && syncState === "Synced" ? "Active" : "Select"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs leading-relaxed text-slate-600">{SECTION_INTROS.companiesInviteHelper}</p>
          {canManageAreas(currentUser.role) && selectedFolder ? (
            <div className="mt-4">
              <SitesAreasPanel
                currentUserRole={currentUser.role}
                sites={sites}
                areaRestrictionsEnabled={areaRestrictionsEnabled}
                areaSyncLoading={areaSyncLoading}
                areaSyncError={areaSyncError}
                googleConnected={googleConnected}
                variant="light"
                surfaceClass={pilotLightSurface}
                nestedClass={pilotLightNested}
                onEnableAreaRestrictions={onEnableAreaRestrictions}
                onDisableAreaRestrictions={onDisableAreaRestrictions}
                onAddArea={onAddSite}
                onRenameArea={onRenameArea}
                onArchiveArea={onArchiveSite}
                onReactivateArea={onReactivateArea}
              />
            </div>
          ) : null}
          {!workspaceSetupComplete ? (
            <details className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-amber-950">Workspace setup status — incomplete</summary>
              <p className="mt-2 text-sm text-amber-900/90">
                One-time Google Drive linking and populate live in <span className="font-semibold">Company Onboarding</span>.
                Users &amp; Invites is for access after setup.
              </p>
            </details>
          ) : (
            <p className="mt-3 text-xs font-semibold text-emerald-800">Workspace setup complete — manage users from Users &amp; Invites.</p>
          )}
        </section>
      ) : null}
      {(!onboardingMode || godModeFullVisibility) && currentUser.role !== "Master" && !pilotFocus && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Workspace</h2>
            <SectionIntro text={SECTION_INTROS.workspace} className="mt-2" role={currentUser.role} />
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              Online
            </div>
            <div className="rounded-full bg-fuchsia-100 px-2.5 py-1 text-xs font-semibold text-fuchsia-700">{getRoleDisplayName(currentUser.role)}</div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {[
            { key: "onboarding", targetId: "admin-user-management", icon: "user", title: "User Management", subtitle: "Invite users and manage roles" },
            { key: "overview", targetId: "admin-audit-templates", icon: "checklist", title: "Audit Templates", subtitle: "Build and manage audit form templates" },
            { key: "onboarding", targetId: "admin-maintenance", icon: "sync", title: "Maintenance", subtitle: "Work waiting to sync, export, and reset tools" },
          ].map((card) => (
            <button
              key={card.title}
              onClick={() => {
                setAdminView(card.key === "onboarding" ? "onboarding" : "overview");
                setPendingAdminScrollTarget(card.targetId);
              }}
              className="flex min-h-[76px] items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:border-slate-300 hover:bg-white"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
                  <AppIcon name={card.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{card.title}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{card.subtitle}</p>
                </span>
              </div>
              <span className="ml-3 text-sm text-slate-400">{">"}</span>
            </button>
          ))}
        </div>
        {currentUser.role === "Admin" && isDebugUiAllowed() && (
          <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/80 p-3">
            <button
              type="button"
              onClick={onLoadDemoData}
              className="h-11 rounded-xl border border-sky-200 bg-white px-4 text-sm font-semibold text-sky-900 shadow-sm"
            >
              Load Demo Data
            </button>
            <button
              type="button"
              onClick={onClearDemoData}
              className="ml-2 h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm"
            >
              Clear Demo Data
            </button>
            <p className="mt-2 text-xs text-slate-600">
              Inserts realistic precast H&amp;S sample audits, CAPAs, and sync items in this tablet only — it does not write to linked Google Sheets.
            </p>
          </div>
        )}
        </section>
      )}

      {canManageAreas(currentUser.role) && !pilotFocus && currentUser.role === "Admin" ? (
        <SitesAreasPanel
          currentUserRole={currentUser.role}
          sites={sites}
          areaRestrictionsEnabled={areaRestrictionsEnabled}
          areaSyncLoading={areaSyncLoading}
          areaSyncError={areaSyncError}
          googleConnected={googleConnected}
          variant="light"
          surfaceClass={pilotLightSurface}
          nestedClass={pilotLightNested}
          onEnableAreaRestrictions={onEnableAreaRestrictions}
          onDisableAreaRestrictions={onDisableAreaRestrictions}
          onAddArea={onAddSite}
          onRenameArea={onRenameArea}
          onArchiveArea={onArchiveSite}
          onReactivateArea={onReactivateArea}
        />
      ) : null}

      {currentUser.role === "Master" && !hideMasterLocalDemoTools && masterDemoToolsVisible && (
        <section className="rounded-2xl border border-sky-200 bg-sky-50/90 p-4 shadow-sm">
          <p className="text-sm font-semibold text-sky-950">Local review data</p>
          <p className="mt-1 text-xs text-sky-900/85">Optional sample payloads for demos — stored on this device only; does not write to linked Google Sheets.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onLoadDemoData}
              className="h-11 rounded-xl border border-sky-200 bg-white px-4 text-sm font-semibold text-sky-900 shadow-sm"
            >
              Load Demo Data
            </button>
            <button
              type="button"
              onClick={onClearDemoData}
              className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm"
            >
              Clear Demo Data
            </button>
          </div>
        </section>
      )}

      {masterOnly && currentUser.role !== "Admin" && (
        <section className="rounded-[1.75rem] border border-slate-800 bg-slate-950 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.24)]">
          <SectionHeader
            icon="shield"
            eyebrow="Setup"
            title="Setup account only"
            subtitle="Workspace setup, connecting Google, and loading live data are limited to the setup account."
          />
          <div className="rounded-[1.5rem] bg-slate-900 p-4">
            <p className="text-sm font-semibold text-white">This workspace is managed centrally</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Connecting Google, linking the company folder, and loading live data are only available from the setup account.
            </p>
          </div>
        </section>
      )}

      {showCompanyInviteCard && (
        <div className="space-y-3">
          <GoogleWorkspaceSetupNotice
            backendConfigured={backendConfigured}
            googleConnected={googleConnected}
            showInitialSetupCta={showInitialSetupCta}
            onOpenInitialSetup={onOpenInitialSetup}
            slatePrimaryCtaInteract={slatePrimaryCtaInteract}
          />
          <section className={pilotLightSurface}>
            <SectionHeader
              icon="spark"
              eyebrow="New tenant"
              title="Invite new company"
              subtitle="Send the company administrator a secure onboarding form."
            />
            <div className={pilotLightNested}>
              <label htmlFor="company-admin-email" className="mb-1 block text-sm font-semibold text-slate-900">
                Company administrator email
              </label>
              <p className="mb-2 text-xs leading-5 text-slate-600">
                This person will receive the BERT company onboarding form.
              </p>
              <input
                id="company-admin-email"
                type="email"
                autoComplete="email"
                value={godModeAppInviteEmail}
                onChange={(event) => onGodModeAppInviteEmailChange(event.target.value)}
                onBlur={() => setInviteAdminEmailTouched(true)}
                placeholder="admin@example.com"
                aria-invalid={Boolean(inviteAdminEmailValidationError)}
                aria-describedby={
                  inviteAdminEmailValidationError
                    ? "company-admin-email-error"
                    : !googleWorkspaceReady
                      ? "company-admin-email-disabled"
                      : undefined
                }
                disabled={!googleWorkspaceReady}
                className={[
                  pilotEditableInput,
                  inviteAdminEmailValidationError ? "border-rose-400 focus:border-rose-400 focus:ring-rose-400/20" : "",
                ].join(" ")}
              />
              {!googleWorkspaceReady ? (
                <p id="company-admin-email-disabled" className="mt-2 text-xs text-slate-500">
                  Connect Google in Platform Setup before sending onboarding email.
                </p>
              ) : null}
              {inviteAdminEmailValidationError ? (
                <p id="company-admin-email-error" className="mt-2 text-xs font-medium text-rose-700" role="alert">
                  {inviteAdminEmailValidationError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={handleCompanyWorkspaceSubmit}
                disabled={!canCreateCompanyWorkspace}
                className={[
                  "mt-3 h-11 w-full rounded-2xl text-sm font-semibold transition",
                  canCreateCompanyWorkspace
                    ? "bg-orange-500 text-white hover:bg-orange-600"
                    : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-500",
                ].join(" ")}
              >
                {companyWorkspaceButtonLabel}
              </button>
              {companyOnboardingEmailResult ? (
                <>
                  <CompanyOnboardingEmailResultPanel
                    result={companyOnboardingEmailResult}
                    onDismiss={onDismissCompanyOnboardingEmailResult}
                    slatePrimaryCtaInteract={slatePrimaryCtaInteract}
                  />
                  <WhatHappensNextPanel
                    steps={COMPANY_ONBOARDING_NEXT_STEPS}
                    className="mt-3 border-orange-100 bg-orange-50/70"
                  />
                </>
              ) : null}
            </div>
          </section>
        </div>
      )}

      {isOnboardingScreen && !isDebugUiAllowed() ? (
        <section className={pilotLightSurface}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">Optional tools for demos and local review data.</p>
            <button
              type="button"
              onClick={() => setShowOnboardingAdvancedTools((open) => !open)}
              className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700"
            >
              {showOnboardingAdvancedTools ? "Hide advanced" : "Show advanced"}
            </button>
          </div>
        </section>
      ) : null}

      {isOnboardingScreen ? (
        <section className={pilotLightSurface}>
          <SectionHeader
            icon="clipboard"
            eyebrow="Submissions"
            title="Onboarding submissions"
            subtitle="Responses waiting to be reviewed and turned into company workspaces."
          />
          {onboardingRecordsLoading ? (
            <p className="mt-2 text-sm text-slate-500">Loading submissions…</p>
          ) : onboardingRecords.length === 0 ? (
            <EmptyPanel
              title="No submissions yet"
              text="Send an onboarding form using Invite new company above. Completed forms will appear here for review."
            />
          ) : (
            <ul className="mt-3 space-y-2">
              {onboardingRecords.slice(0, 8).map((record) => (
                <li key={record.id}>
                  <button
                    type="button"
                    onClick={() => onSelectOnboardingRecord(record.id)}
                    className={[
                      "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition",
                      selectedOnboardingRecordId === record.id
                        ? "border-orange-300 bg-orange-50"
                        : "border-slate-200 bg-slate-50 hover:bg-white",
                    ].join(" ")}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {record.companyName || record.contactEmail}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{record.contactEmail}</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-orange-600">Review</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {activeOnboardingRecord ? (
            <button
              type="button"
              onClick={onApplyOnboardingRecord}
              className="mt-3 h-11 rounded-2xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
            >
              Load selected submission into setup
            </button>
          ) : null}
        </section>
      ) : null}

      {currentUser.role === "Master" && isOnboardingScreen && (onboardingMode || godModeFullVisibility) && (
        <div className="space-y-3">
          <GoogleWorkspaceSetupNotice
            backendConfigured={backendConfigured}
            googleConnected={googleConnected}
            showInitialSetupCta={showInitialSetupCta}
            onOpenInitialSetup={onOpenInitialSetup}
            slatePrimaryCtaInteract={slatePrimaryCtaInteract}
          />
        <section className="rounded-[1.75rem] bg-slate-950 p-5 text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)]">
          {!standaloneOnboarding && (
            <div className="mb-3">
              <button
                onClick={() => setAdminView("overview")}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
              >
                Back to admin overview
              </button>
            </div>
          )}
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white">
              <AppIcon name="shield" className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Workspace setup</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Set up a new company workspace</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Complete the steps below to connect Google Drive, link the company folder, and make the app live.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <MiniPill label={backendConfigured ? "Server ready" : "Finish server setup"} active={backendConfigured} />
            <MiniPill label={googleConnected ? "Google Drive connected" : "Google Drive not connected"} active={googleConnected} />
            <MiniPill
              label={selectedFolder ? `${selectedFolder.name} linked` : "Company folder not linked"}
              active={Boolean(selectedFolder)}
            />
            <MiniPill label={syncState === "Synced" ? "App live" : "App not live"} active={syncState === "Synced"} />
          </div>
          <div className="mt-5 rounded-[1.5rem] bg-white/6 p-4">
            <p className="text-sm font-semibold text-white">Setup progress</p>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              {!backendConfigured
                ? "Finish server setup before Google Drive can be connected."
                : !googleConnected
                  ? "Step 1: connect Google Drive with the account you use for setup."
                  : !selectedFolder
                    ? "Step 2: paste the company Google Drive links below."
                    : syncState !== "Synced"
                      ? `Step 3: populate the app using ${selectedFolder.name}.`
                      : `${selectedFolder.name} is linked and the app is live.`}
            </p>
            {selectedFolder && <p className="mt-2 break-all text-xs text-slate-400">{selectedFolder.id}</p>}
            {googleConnected && (
              <div className="mt-4 grid gap-3">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Company folder link or ID
                  </label>
                  <input
                    value={folderIdInput}
                    onChange={(event) => onFolderIdChange(event.target.value)}
                    placeholder="Paste the company folder link or ID"
                    className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/20 px-4 text-sm text-white outline-none transition focus:border-white/30"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Company master sheet link or ID
                  </label>
                  <input
                    value={masterSheetInput}
                    onChange={(event) => onMasterSheetChange(event.target.value)}
                    placeholder="Paste the company master sheet link or ID"
                    className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/20 px-4 text-sm text-white outline-none transition focus:border-white/30"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Audit forms folder link or ID
                  </label>
                  <input
                    value={auditFormsFolderInput}
                    onChange={(event) => onAuditFormsFolderChange(event.target.value)}
                    placeholder="Paste the audit forms folder link or ID"
                    className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/20 px-4 text-sm text-white outline-none transition focus:border-white/30"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Evidence folder
                    </label>
                    <input
                      value={evidenceFolderInput}
                      onChange={(event) => onEvidenceFolderChange(event.target.value)}
                      placeholder="Optional"
                      className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/20 px-4 text-sm text-white outline-none transition focus:border-white/30"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Health &amp; Safety folder
                    </label>
                    <input
                      value={healthSafetyFolderInput}
                      onChange={(event) => onHealthSafetyFolderChange(event.target.value)}
                      placeholder="Recommended for incident reporting"
                      className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/20 px-4 text-sm text-white outline-none transition focus:border-white/30"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Exports folder
                    </label>
                    <input
                      value={exportsFolderInput}
                      onChange={(event) => onExportsFolderChange(event.target.value)}
                      placeholder="Optional"
                      className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/20 px-4 text-sm text-white outline-none transition focus:border-white/30"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Admin notes folder
                  </label>
                  <input
                    value={adminNotesFolderInput}
                    onChange={(event) => onAdminNotesFolderChange(event.target.value)}
                    placeholder="Optional"
                    className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/20 px-4 text-sm text-white outline-none transition focus:border-white/30"
                  />
                </div>
              </div>
            )}
            <div className="mt-4 space-y-3">
              <button
                onClick={onOneClickGoogleOnboarding}
                disabled={adminOnly || !googleWorkspaceReady || folderInspectionLoading}
                className={[
                  "h-12 rounded-2xl px-5 text-sm font-semibold transition",
                  adminOnly || !googleWorkspaceReady || folderInspectionLoading
                    ? "cursor-not-allowed bg-white/10 text-slate-400"
                    : "bg-sky-300 text-slate-900 shadow-[0_14px_28px_rgba(14,165,233,0.25)] active:scale-[0.99]",
                ].join(" ")}
              >
                {!googleWorkspaceReady ? "Connect Google first" : "Run workspace setup (one click)"}
              </button>
              <div className="flex flex-wrap items-center gap-3">
                {googleConnected && currentUser.role === "Master" && (
                  <div className="rounded-2xl border border-rose-500/35 bg-rose-950/25 px-3 py-2">
                    <p className="text-xs font-semibold text-rose-200">Danger zone</p>
                    <p className="mt-0.5 max-w-md text-xs text-rose-100/80">
                      Disconnecting stops company login, invites, and sheet access until Google is connected again in Initial Setup.
                    </p>
                    <DangerActionButton
                      onClick={onGoogleDisconnect}
                      className="mt-2 border-rose-400/60 bg-rose-900/40 text-rose-50 hover:bg-rose-900/60"
                    >
                      Disconnect Google Workspace
                    </DangerActionButton>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowAdvancedOnboardingActions((current) => !current)}
                  className="h-11 rounded-2xl border border-white/20 px-4 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  {showAdvancedOnboardingActions ? "Hide advanced" : "Show advanced"}
                </button>
              </div>
              {showAdvancedOnboardingActions && (
                <div className="flex flex-wrap gap-3 rounded-2xl border border-white/10 bg-slate-950/20 p-3">
                  <button
                    onClick={!googleConnected ? onGoogleConnect : onAddFolder}
                    disabled={adminOnly || !googleWorkspaceReady || googleStatusLoading}
                    className={[
                      "h-12 rounded-2xl px-5 text-sm font-semibold transition",
                      adminOnly || !googleWorkspaceReady || googleStatusLoading
                        ? "bg-white/10 text-slate-400"
                        : "bg-white text-slate-900 shadow-[0_14px_28px_rgba(15,23,42,0.18)] active:scale-[0.99]",
                    ].join(" ")}
                  >
                    {googleStatusLoading
                      ? "Checking Google Drive..."
                      : !googleConnected
                        ? "Connect Google Drive"
                        : "Continue workspace setup"}
                  </button>
                  {selectedFolder && (
                    <a
                      href={`https://drive.google.com/drive/folders/${selectedFolder.id}`}
                      className="inline-flex h-12 items-center rounded-2xl border border-white/20 px-5 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                      Open folder in Google Drive
                    </a>
                  )}
                  <button
                    onClick={onSyncForms}
                    disabled={adminOnly || !googleWorkspaceReady || !selectedFolder || folderInspectionLoading}
                    className={[
                      "h-12 rounded-2xl px-5 text-sm font-semibold transition",
                      adminOnly || !googleWorkspaceReady || !selectedFolder || folderInspectionLoading
                        ? "bg-white/10 text-slate-400"
                        : "bg-orange-500 text-white shadow-[0_14px_28px_rgba(249,115,22,0.35)] active:scale-[0.99]",
                    ].join(" ")}
                  >
                    {workspaceSetupButtonLabel}
                  </button>
                </div>
              )}
            </div>
            {(folderInspection || selectedFolder) && (
              <div className="mt-4 rounded-[1.25rem] border border-white/10 bg-slate-950/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Company folder check</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {folderInspection
                        ? `Checked ${folderInspection.folder.name}`
                        : selectedFolder
                          ? `Waiting to check ${selectedFolder.name}`
                          : "No company folder checked yet"}
                    </p>
                  </div>
                  {folderInspection && (
                    <div
                      className={[
                        "rounded-full px-3 py-1 text-xs font-semibold",
                        folderInspection.blockingItems.length === 0
                          ? "bg-blue-500/12 text-blue-300"
                          : "bg-amber-500/12 text-amber-300",
                      ].join(" ")}
                    >
                      {folderInspection.blockingItems.length === 0 ? "Ready to populate" : "Blocked"}
                    </div>
                  )}
                </div>

                {folderInspection && (
                  <>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <FolderCheckRow label="Company Master Sheet" ok={folderInspection.checks.masterSheet} />
                      <FolderCheckRow
                        label={folderInspection.checks.auditFormsFolder ? "Audit forms folder" : "Audit forms folder (recommended)"}
                        ok={folderInspection.checks.auditFormsFolder}
                      />
                      <FolderCheckRow
                        label={
                          folderInspection.checks.masterDataFolder || !folderInspection.checks.masterSheet
                            ? "Master sheet link"
                            : "Master sheet link (recommended)"
                        }
                        ok={folderInspection.checks.masterDataFolder || folderInspection.checks.masterSheet}
                      />
                      <FolderCheckRow label="Evidence folder (recommended)" ok={folderInspection.checks.evidenceFolder} />
                      <FolderCheckRow label="Exports folder (recommended)" ok={folderInspection.checks.exportsFolder} />
                      <FolderCheckRow label="Admin notes folder (recommended)" ok={folderInspection.checks.adminNotesFolder} />
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-white/6 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Master sheet</p>
                        <p className="mt-2 text-sm font-semibold text-white">
                          {folderInspection.masterSheet?.name || "Not found"}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {folderInspection.masterSheet?.tabs.length
                            ? folderInspection.masterSheet.tabs.join(", ")
                            : "No tabs available"}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white/6 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Audit forms</p>
                        <p className="mt-2 text-sm font-semibold text-white">
                          {folderInspection.auditForms.length} form{folderInspection.auditForms.length === 1 ? "" : "s"} found
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {folderInspection.auditForms.length > 0
                            ? folderInspection.auditForms.slice(0, 3).map((item) => item.name).join(", ")
                            : "No audit forms added yet"}
                        </p>
                      </div>
                    </div>

                    {folderInspection.blockingItems.length > 0 && (
                      <div className="mt-4 rounded-2xl bg-amber-500/10 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Blocking items</p>
                        <p className="mt-2 text-sm text-amber-100">{folderInspection.blockingItems.join(" • ")}</p>
                      </div>
                    )}

                    {folderInspection.recommendedItems.length > 0 && (
                      <div className="mt-4 rounded-2xl bg-slate-900/30 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">Recommended structure</p>
                        <p className="mt-2 text-sm text-slate-200">{folderInspection.recommendedItems.join(" • ")}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </section>
        </div>
      )}

      {usersInvitesPilotMode ? (
        <UsersInvitesPilotPanel
          currentUser={currentUser}
          googleConnected={googleConnected}
          inviteEmailInput={inviteEmailInput}
          inviteRoleInput={inviteRoleInput}
          invitedUsers={invitedUsers}
          reportUsers={reportUsers}
          sites={sites}
          selectedSiteId={selectedSiteId}
          userSiteAssignments={userSiteAssignments}
          creatableRoles={creatableRoles}
          companyUserInviteEmailResult={companyUserInviteEmailResult}
          companyUserInviteEmailSending={companyUserInviteEmailSending}
          godModeFirstUserInvite={godModeFirstUserInvite}
          workspaceSetupComplete={workspaceSetupComplete}
          pilotEditableInput={pilotEditableInput}
          pilotLightSurface={pilotLightSurface}
          pilotLightNested={pilotLightNested}
          notificationsEnabled={notificationsEnabled}
          companySheetSync={companySheetSync}
          workspaceValidation={workspaceValidation}
          workspaceValidationLoading={workspaceValidationLoading}
          syncState={syncState}
          selectedFolder={selectedFolder}
          folderInspection={folderInspection}
          onInviteEmailChange={onInviteEmailChange}
          onInviteRoleChange={onInviteRoleChange}
          onInviteUser={onInviteUser}
          onDismissCompanyUserInviteEmailResult={onDismissCompanyUserInviteEmailResult}
          onResendInvite={onResendInvite}
          onDeleteInvite={onDeleteInvite}
          onRemoveCompanyUser={onRemoveCompanyUser}
          onResyncUsers={onResyncUsers}
          areaRestrictionsEnabled={areaRestrictionsEnabled}
          areaSyncLoading={areaSyncLoading}
          areaSyncError={areaSyncError}
          onSelectSite={onSelectSite}
          onAddSite={onAddSite}
          onArchiveSite={onArchiveSite}
          onEnableAreaRestrictions={onEnableAreaRestrictions}
          onDisableAreaRestrictions={onDisableAreaRestrictions}
          onRenameArea={onRenameArea}
          onReactivateArea={onReactivateArea}
          onToggleUserSiteAssignment={onToggleUserSiteAssignment}
          onRequestNotifications={onRequestNotifications}
          onValidateWorkspace={onValidateWorkspace}
          onRepairWorkspace={onRepairWorkspace}
          CompanyUserInviteEmailResultPanel={CompanyUserInviteEmailResultPanel}
          slatePrimaryCtaInteract={slatePrimaryCtaInteract}
        />
      ) : null}

      {onboardingMode && (
        <>
          <section id="admin-user-management" className={onboardingPanelClass}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className={["text-xs font-semibold uppercase tracking-[0.2em]", onboardingEyebrowClass].join(" ")}>
                  {currentUser.role === "Master" ? "Workspace" : "Company admin"}
                </p>
                <h3 className={["mt-1 text-base font-semibold", onboardingHeadingClass].join(" ")}>Company setup</h3>
                <p className={["text-sm", onboardingBodyClass].join(" ")}>
                  One-time workspace setup — use Company Onboarding or Companies for Drive linking; this block is for the legacy admin workspace view.
                </p>
              </div>
              <div
                className={[
                  "rounded-full px-3 py-1 text-xs font-semibold",
                  companyAdminShell
                    ? "bg-blue-50 text-blue-800 ring-1 ring-blue-100"
                    : "bg-slate-900 text-slate-200 ring-1 ring-slate-700",
                ].join(" ")}
              >
                {syncState === "Synced" ? "Company live" : "Setup in progress"}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  step: "Step 1",
                  title: "Connect Google",
                  detail:
                    backendConfigured && googleConnected
                      ? "Connected"
                      : "Finish server setup, then connect Google Drive from the steps above.",
                },
                {
                  step: "Step 2",
                  title: "Link company workspace",
                  detail: selectedFolder ? `${selectedFolder.name} linked` : "Link the company folder and master sheet.",
                },
                {
                  step: "Step 3",
                  title: "Populate app",
                  detail:
                    syncState === "Synced"
                      ? "App has been populated from company sheet."
                      : "Run workspace setup (one click).",
                },
                {
                  step: "Step 4",
                  title: "Check everything is ready",
                  detail: folderInspection?.blockingItems.length
                    ? "Resolve blocking items shown below."
                    : "Ready for user invites.",
                },
              ].map((card) => (
                <div
                  key={card.step}
                  className={[
                    "rounded-2xl border p-3",
                    companyAdminShell ? "border-slate-200 bg-slate-50" : "border-slate-800 bg-slate-900",
                  ].join(" ")}
                >
                  <p className={["text-xs font-semibold uppercase tracking-[0.16em]", onboardingEyebrowClass].join(" ")}>
                    {card.step}
                  </p>
                  <p className={["mt-1 text-sm font-semibold", onboardingHeadingClass].join(" ")}>{card.title}</p>
                  <p className={["mt-1 text-xs", onboardingBodyClass].join(" ")}>{card.detail}</p>
                </div>
              ))}
            </div>
          </section>

          <section className={onboardingPanelClass}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className={["text-base font-semibold", onboardingHeadingClass].join(" ")}>User management</h3>
                <p className={["text-sm", onboardingBodyClass].join(" ")}>
                  {currentUser.role === "Master"
                    ? "The setup account can create Admin, Manager, and Auditor users."
                    : currentUser.role === "Admin"
                      ? "Admins can create Admin, Manager, and Auditor users."
                      : "User creation is not available on this account."}
                </p>
              </div>
              <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-200 ring-1 ring-slate-700">
                {getRoleDisplayName(currentUser.role)}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.5rem] border border-slate-800 bg-slate-900 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Site access</p>
                    <p className="text-sm text-slate-300">Select a site context or add a new site for this company.</p>
                  </div>
                  <button
                    type="button"
                    onClick={onAddSite}
                    className="h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-semibold text-slate-200"
                  >
                    Add site
                  </button>
                </div>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => onSelectSite("")}
                    className={[
                      "w-full rounded-xl border px-3 py-2 text-left text-sm",
                      selectedSiteId === ""
                        ? "border-[var(--bert-signal-orange)] bg-[rgba(249,115,22,0.14)] text-white"
                        : "border-slate-800 bg-slate-950 text-slate-300",
                    ].join(" ")}
                  >
                    All sites
                  </button>
                  {sites
                    .filter((site) => site.active)
                    .map((site) => (
                      <div key={site.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectSite(site.id)}
                          className={[
                            "flex-1 rounded-xl border px-3 py-2 text-left text-sm",
                            selectedSiteId === site.id
                              ? "border-[var(--bert-signal-orange)] bg-[rgba(249,115,22,0.14)] text-white"
                              : "border-slate-800 bg-slate-950 text-slate-300",
                          ].join(" ")}
                        >
                          {site.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => onArchiveSite(site.id)}
                          className="rounded-xl border border-rose-300 bg-rose-50 px-2 py-2 text-xs font-semibold text-rose-700"
                        >
                          Archive
                        </button>
                      </div>
                    ))}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-slate-800 bg-slate-900 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Assign users to sites</p>
                <p className="mt-1 text-sm text-slate-300">
                  For Managers and Auditors: leave all boxes unchecked to allow every active site. Check one or more sites to restrict their workspace to only those sites.
                </p>
                <div className="mt-4 space-y-4">
                  {reportUsers
                    .filter((user) => user.role !== "Master")
                    .map((user) => {
                      const assignmentKey = normalizeIdentity(user.email);
                      const assignedIds = userSiteAssignments[assignmentKey] ?? [];
                      const activeSites = sites.filter((site) => site.active);
                      return (
                        <div key={user.email} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-sm font-semibold text-white">{user.email}</p>
                            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{user.role}</span>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {activeSites.map((site) => {
                              const checked = assignedIds.includes(site.id);
                              return (
                                <label
                                  key={`${user.email}-${site.id}`}
                                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2 py-2 text-sm text-slate-200"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => onToggleUserSiteAssignment(user.email, site.id)}
                                    className="h-4 w-4 shrink-0 rounded border-slate-600"
                                  />
                                  <span className="min-w-0 truncate">{site.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-slate-800 bg-slate-900 p-4">
                <div className="grid gap-3">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">User email</label>
                    <input
                      value={inviteEmailInput}
                      onChange={(event) => onInviteEmailChange(event.target.value)}
                      placeholder="name@company.com"
                      className="h-12 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 text-sm text-white outline-none transition focus:border-sky-400"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Role to create</label>
                    {godModeFirstUserInvite ? (
                      <div className="h-12 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 text-sm font-semibold leading-[3rem] text-slate-200">
                        Admin (first company user)
                      </div>
                    ) : (
                      <select
                        value={inviteRoleInput}
                        onChange={(event) => onInviteRoleChange(event.target.value as Role)}
                        className="h-12 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 text-sm text-white outline-none transition focus:border-sky-400"
                      >
                        {creatableRoles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {creatableRoles.map((role) => (
                    <MiniPill key={role} label={`Can create ${role}`} active />
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">
                  Invites email a secure setup link. Users are written to the <span className="text-slate-200">company master spreadsheet</span> (Users tab + Config UserAuth) — not the operator Master sheet. They can sign in only after completing the invite link.
                </p>
                <button
                  type="button"
                  onClick={onInviteUser}
                  disabled={companyUserInviteEmailSending}
                  className={`mt-4 h-12 w-full rounded-2xl bg-slate-900 text-sm font-semibold text-white active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${slatePrimaryCtaInteract}`}
                >
                  {companyUserInviteEmailSending ? "Sending…" : "Send invite link"}
                </button>
                {companyUserInviteEmailResult ? (
                  <>
                    <CompanyUserInviteEmailResultPanel
                      result={companyUserInviteEmailResult}
                      onDismiss={onDismissCompanyUserInviteEmailResult}
                      slatePrimaryCtaInteract={slatePrimaryCtaInteract}
                    />
                    <WhatHappensNextPanel steps={USER_INVITE_NEXT_STEPS} className="mt-3 border-sky-100 bg-sky-50/50" />
                  </>
                ) : null}
                <button
                  onClick={onResyncUsers}
                  className="mt-2 h-11 w-full rounded-2xl border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-200 transition hover:bg-slate-900"
                >
                  Re-sync users from company sheet
                </button>
              </div>

              {invitedUsers.length === 0 ? (
                <EmptyPanel
                  title="No invites sent yet"
                  text="Nothing listed until you send invite links. Use the form above for roles you are allowed to create."
                />
              ) : (
                <div className="space-y-3">
                  {invitedUsers.slice(0, 5).map((invite) => {
                    const staleOrIncomplete =
                      isStaleOrIncompleteInviteStatus(invite.status) || isLegacyInviteRowId(invite.id);
                    return (
                    <div key={invite.id} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{invite.email}</p>
                        <p className="mt-1 truncate text-xs text-slate-400">
                          Sent by {invite.invitedBy} • {invite.sentAt}
                          {invite.senderEmail ? ` • From ${invite.senderEmail}` : ""}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-slate-600 bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-100">
                            {formatUserRoleLabel(invite.role)}
                          </span>
                          <span
                            className={inviteStatusBadgeClass(invite.status)}
                            title={getInviteStatusHelp(invite.status)}
                          >
                            {formatInviteStatusLabel(invite.status)}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {invite.appOnboardingUrl && (
                          <a
                            href={invite.appOnboardingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center rounded-xl border border-sky-400/50 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-200 no-underline"
                          >
                            Open link
                          </a>
                        )}
                        {invite.mailtoUrl && (
                          <a href={invite.mailtoUrl} className={`inline-flex items-center justify-center rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white no-underline ${slatePrimaryCtaInteract}`}>
                            Open email
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => onResendInvite(invite)}
                          title={
                            staleOrIncomplete
                              ? "Send a fresh invite from a live company workspace"
                              : "Resend invite email"
                          }
                          className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                        >
                          {staleOrIncomplete ? "Send fresh invite" : "Resend"}
                        </button>
                        {isActiveCompanyUserInvite(invite) ? (
                          <DangerActionButton
                            type="button"
                            onClick={() => onRemoveCompanyUser(invite)}
                            title="Remove this user from the company Users tab and UserAuth so they can no longer sign in"
                            className="rounded-xl px-3 py-2 text-xs"
                          >
                            Remove user
                          </DangerActionButton>
                        ) : (
                          <DangerActionButton
                            type="button"
                            onClick={() => onDeleteInvite(invite)}
                            title={
                              staleOrIncomplete ? "Revoke stale or incomplete invite" : "Revoke invite link"
                            }
                            className="rounded-xl px-3 py-2 text-xs"
                          >
                            {staleOrIncomplete ? "Revoke" : "Delete"}
                          </DangerActionButton>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
            <InviteStatusLegend className="mt-4" />
          </section>

          {onboardingMode && (
            <>
              <section id="admin-maintenance" className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <SectionHeader
            icon="spark"
            eyebrow="Live delivery"
            title="Live delivery controls"
            subtitle="Enable browser alerts and keep the company workspace ready for live notifications."
          />
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {notificationsEnabled ? "Browser alerts on" : "Browser alerts off"}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={onRequestNotifications}
            className={`h-12 rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
          >
            Enable browser notifications
          </button>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            User invites email the in-app invite link when SMTP is configured. If sending fails, copy the invite link or draft from the panel above the invite list.
          </div>
        </div>
              </section>

              <section className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <SectionHeader
            icon="chart"
            eyebrow="Data sync"
            title="Company sheet sync"
            subtitle="Shows what has been pulled from the company master sheet and whether the live company sync is healthy."
          />
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {companySheetSync ? "Synced" : "Waiting"}
          </div>
        </div>
        {companySheetSync ? (
          <div className="space-y-3">
            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">{companySheetSync.sheetName}</p>
              <p className="mt-1 text-xs text-slate-500">Last synced {companySheetSync.lastSyncedAt}</p>
              <p className="mt-2 text-xs text-slate-500">{companySheetSync.tabs.join(", ")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MiniMetric label="Users tab rows" value={String(companySheetSync.usersCount)} />
              <MiniMetric label="Schedule rows" value={String(companySheetSync.schedulesCount)} />
              <MiniMetric label="Onboarding rows" value={String(companySheetSync.onboardingCount)} />
              <MiniMetric label="Action rows" value={String(companySheetSync.actionsCount)} />
            </div>
          </div>
        ) : (
          <EmptyPanel
            title="Company sheet not synced yet"
            text="Setup needed — link a company folder with a master sheet in Admin, then populate so row counts and tabs can show here."
          />
        )}
              </section>

              <section className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <SectionHeader
            icon="shield"
            eyebrow="Workspace health"
            title="Check workspace"
            subtitle="Checks tabs, sheet format, and linked folders before you rely on this workspace in the field."
          />
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {workspaceValidation?.ok ? "Healthy" : "Check needed"}
          </div>
        </div>
        {workspaceValidation ? (
          <div className="space-y-3">
            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Sheet format</p>
              <p className="mt-1 text-sm text-slate-500">
                On sheet: {workspaceValidation.schemaVersion || "none"} • this app expects {workspaceValidation.currentSchemaVersion}
              </p>
              {workspaceValidation.warnings.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {workspaceValidation.warnings.map((warning) => (
                    <div key={warning} className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                      {warning}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FolderCheckRow label="Company folder" ok={workspaceValidation.folders.companyFolder} tone="light" />
              <FolderCheckRow label="Audit forms folder" ok={workspaceValidation.folders.auditFormsFolder} tone="light" />
              <FolderCheckRow label="Evidence folder" ok={workspaceValidation.folders.evidenceFolder} tone="light" />
              <FolderCheckRow label="Exports folder" ok={workspaceValidation.folders.exportsFolder} tone="light" />
              <FolderCheckRow label="Admin notes folder" ok={workspaceValidation.folders.adminNotesFolder} tone="light" />
              <FolderCheckRow label="Actions tab" ok={workspaceValidation.tabs.Actions} tone="light" />
            </div>
            {workspaceValidation.missingTabs.length > 0 && (
              <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4">
                <p className="text-sm font-semibold text-rose-900">Missing tabs</p>
                <p className="mt-2 text-sm text-rose-700">{workspaceValidation.missingTabs.join(", ")}</p>
              </div>
            )}
            {Object.entries(workspaceValidation.missingColumns).some(([, columns]) => columns.length > 0) && (
              <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Missing columns</p>
                <div className="mt-2 space-y-2">
                  {Object.entries(workspaceValidation.missingColumns)
                    .filter(([, columns]) => columns.length > 0)
                    .map(([tab, columns]) => (
                      <p key={tab} className="text-sm text-amber-700">
                        {tab}: {columns.join(", ")}
                      </p>
                    ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <EmptyPanel
            title="No workspace check yet"
            text="After you link folders, tap Check workspace to confirm tabs, columns, and folder links before go-live."
          />
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={onValidateWorkspace} className={`h-12 rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}>
            {workspaceValidationLoading ? "Checking..." : "Check workspace"}
          </button>
          <button onClick={onRepairWorkspace} className="h-12 rounded-2xl bg-blue-50 px-5 text-sm font-semibold text-blue-800">
            Fix workspace
          </button>
        </div>
              </section>

              {syncState === "Synced" && selectedFolder && (
                <section className="rounded-[1.75rem] border border-blue-200 bg-gradient-to-b from-blue-50 to-white p-4 shadow-[0_16px_36px_rgba(29,78,216,0.12)]">
          <SectionHeader
            icon="check"
            eyebrow="Go live complete"
            title={`${selectedFolder.name} is now live`}
            subtitle="This company workspace has been linked, checked, and populated from Google Drive."
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <QuickActionTile title="Audit forms" value={String(folderInspection?.auditForms.length ?? 0)} caption="Loaded from Drive" />
            <QuickActionTile title="Users" value={String(companySheetSync?.usersCount ?? 0)} caption="Synced from master sheet" />
            <QuickActionTile title="Schedules" value={String(companySheetSync?.schedulesCount ?? 0)} caption="Ready in app" />
          </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {showAuditTemplateBuilder ? (
      <section id="admin-audit-templates" className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <SectionHeader
            icon="clipboard"
            eyebrow="Build and activate"
            title="Audit template builder"
            subtitle="Create local templates, activate or pause them, and combine them with Google Drive audit forms."
          />
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {templates.filter((template) => template.active).length} active
          </div>
        </div>
        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3">
            <input
              value={templateNameInput}
              onChange={(event) => onTemplateNameChange(event.target.value)}
              placeholder="Template name"
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
            />
            <textarea
              value={templateQuestionInput}
              onChange={(event) => onTemplateQuestionChange(event.target.value)}
              placeholder="Write a question, then add it to the builder"
              className="min-h-[7rem] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
            />
            <select
              value={templateQuestionTypeInput}
              onChange={(event) => onTemplateQuestionTypeChange(event.target.value as AuditQuestion["fieldType"])}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
            >
              <option value="Traffic light">Traffic light</option>
              <option value="Pass / Fail">Pass / Fail</option>
              <option value="Text note">Text note</option>
              <option value="Photo evidence">Photo evidence</option>
            </select>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={onAddTemplateQuestion}
              className="h-12 rounded-2xl bg-slate-200 px-5 text-sm font-semibold text-slate-900"
            >
              Add question
            </button>
            <button
              onClick={onAddTemplate}
              className={`h-12 rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
            >
              Create template
            </button>
          </div>
          {templateDraftQuestions.length > 0 && (
            <div className="mt-4 space-y-2">
              {templateDraftQuestions.map((question, index) => (
                <div key={question.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {index + 1}. {question.text}
                      </p>
                      <p className="truncate text-xs text-slate-500">{question.fieldType}</p>
                    </div>
                    <button
                      onClick={() => onRemoveTemplateQuestion(question.id)}
                      className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {(["pass", "nc", "fail"] as Answer[]).map((answer) => (
                      <div key={`${question.id}-${answer}`} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <button
                          type="button"
                          onClick={() => onAddAnswerPromptToDraftQuestion(question.id, answer)}
                          className="w-full rounded-lg bg-white px-2 py-1.5 text-xs font-semibold text-slate-700"
                        >
                          Do you need a prompt for this answer?
                        </button>
                        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{answer.toUpperCase()}</p>
                        <div className="mt-1 space-y-1">
                          {(question.answerPrompts?.[answer] || []).map((prompt, promptIndex) => (
                            <div key={`${question.id}-${answer}-${promptIndex}`} className="flex items-start justify-between gap-2 rounded-lg bg-white px-2 py-1.5">
                              <p className="text-xs text-slate-700">{prompt}</p>
                              <button
                                type="button"
                                onClick={() => onRemoveAnswerPromptFromDraftQuestion(question.id, answer, promptIndex)}
                                className="text-[10px] font-semibold text-rose-600"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 space-y-3">
          {templates.length === 0 ? (
            <EmptyPanel
              title="No templates yet"
              text="Nothing to pick from until Drive forms or local templates load into this workspace after sync."
            />
          ) : (
            templates.slice(0, 8).map((template) => (
              <div key={template.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{template.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {template.source} • {template.questions.length} questions
                  </p>
                </div>
                <button
                  onClick={() => onToggleTemplate(template.id)}
                  className={[
                    "rounded-xl px-3 py-2 text-xs font-semibold",
                    template.active ? "bg-blue-500/12 text-blue-800" : "bg-slate-200 text-slate-700",
                  ].join(" ")}
                >
                  {template.active ? "Active" : "Inactive"}
                </button>
              </div>
            ))
          )}
        </div>
      </section>
      ) : null}
    </div>
  );
}

function QuickActionTile({
  title,
  value,
  caption,
}: {
  title: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="rounded-[1.45rem] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{title}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{caption}</p>
    </div>
  );
}

function MiniPill({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={[
        "rounded-full px-3 py-1 text-xs font-semibold",
        active ? "bg-blue-500/12 text-blue-800" : "bg-slate-100 text-slate-600",
      ].join(" ")}
    >
      {label}
    </div>
  );
}

function FolderCheckRow({ label, ok, tone = "dark" }: { label: string; ok: boolean; tone?: "dark" | "light" }) {
  if (tone === "light") {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-sm text-slate-700">{label}</p>
        <div
          className={[
            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
            ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900",
          ].join(" ")}
        >
          {ok ? "Found" : "Missing"}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/6 px-3 py-2">
      <p className="text-sm text-slate-200">{label}</p>
      <div
        className={[
          "rounded-full px-2.5 py-1 text-[11px] font-semibold",
          ok ? "bg-blue-500/12 text-blue-300" : "bg-amber-500/12 text-amber-300",
        ].join(" ")}
      >
        {ok ? "Found" : "Missing"}
      </div>
    </div>
  );
}

