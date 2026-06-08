import { useEffect, useMemo, useState } from "react";
import type { Role } from "../../permissions";
import { canManageAreas } from "../../permissions";
import { apiUrl } from "../../config/apiBase";
import { AreaAuditsSection } from "../admin/AreaAuditsSection";
import { CompanyWorkspaceResetPanel } from "../admin/CompanyWorkspaceResetPanel";
import { SitesAreasPanel } from "../admin/SitesAreasPanel";
import { EmptyPanel, MiniMetric, SectionHeader } from "../dashboard/DashboardPrimitives";
import { SECTION_INTROS } from "../../config/sectionIntros";
import { GodmodeCollapsibleSection } from "./GodmodeCollapsibleSection";
import { GodmodeUserManagementSection, type GodmodeUserManagementSectionProps } from "./GodmodeUserManagementSection";
import {
  getCompanySetupNextAction,
  resolveCompanySetupStatus,
  resolveCompanyWorkspaceStatus,
  WorkspaceStatusBadge,
} from "./WorkspaceStatusBadge";
import type { Site, UserInvite, FolderInspection } from "../../types/adminScreenProps";
import type { AreaAuditMapping } from "../../utils/areaAuditMapping";
import type { AuditTemplate } from "../../types/reportsScreenProps";
import type { CompanyFolder, CompanySheetSyncStatus, WorkspaceValidation } from "../../types/dashboardScreenProps";
import type { CompanySetupNextAction } from "../../utils/companyWorkspaceStatus";
import {
  COMPANY_SETUP_DID_NOT_FINISH_MESSAGE,
  COMPANY_SETUP_STEP_LABELS,
} from "../../services/companySetupProgressService";
import {
  getCanonicalCompanyStatus,
  isCompanyRegistryLive,
} from "../../utils/companyWorkspaceInvite";
import { BERT_LIGHT_NESTED, BERT_LIGHT_SURFACE } from "../../styles/bertText";

const pilotLightSurface = BERT_LIGHT_SURFACE;
const pilotLightNested = BERT_LIGHT_NESTED;

function folderMasterSheetId(folder: CompanyFolder): string {
  const extended = folder as CompanyFolder & { masterSheetId?: string };
  return extended.masterSheetId || extended.responseSheetId || "";
}

function SetupChecklistRow({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) {
  return (
    <div className="bert-light-surface flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
      </div>
      <span
        className={[
          "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
          ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900",
        ].join(" ")}
      >
        {ok ? "Ready" : "Pending"}
      </span>
    </div>
  );
}

function FolderCheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="bert-light-surface flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-sm text-slate-700">{label}</p>
      <span
        className={[
          "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
          ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900",
        ].join(" ")}
      >
        {ok ? "Found" : "Missing"}
      </span>
    </div>
  );
}

export type GodmodeCompanyWorkspacePanelProps = {
  currentUserRole: Role;
  folders: CompanyFolder[];
  selectedFolder: CompanyFolder | null;
  companyMasterSheetId: string;
  syncState: string;
  googleConnected: boolean;
  googleWorkspaceReady: boolean;
  adminOnly: boolean;
  folderInspection: FolderInspection | null;
  folderInspectionLoading: boolean;
  workspaceValidation: WorkspaceValidation | null;
  workspaceValidationLoading: boolean;
  companySheetSync: CompanySheetSyncStatus | null;
  invitedUsers: UserInvite[];
  sites: Site[];
  areaRestrictionsEnabled: boolean;
  areaSyncLoading: boolean;
  areaSyncError: string | null;
  areaAudits: AreaAuditMapping[];
  selectedAreaAuditAreaId: string;
  mappingSyncLoading: boolean;
  mappingSyncError: string | null;
  templates: AuditTemplate[];
  masterCompanyContextBlocked: boolean;
  masterCompanyContextMessage: string;
  companyFolderStructureRepairing: boolean;
  companySetupCurrentStep?: string;
  companySetupError?: { failedStep: string; errorCode: string; message: string; technicalError?: string } | null;
  companyMasterSheetProvisioning: boolean;
  folderIdInput: string;
  masterSheetInput: string;
  auditFormsFolderInput?: string;
  setupFolderInput?: string;
  recordsFolderInput?: string;
  evidenceFolderInput?: string;
  exportsFolderInput?: string;
  managementNotesFolderInput?: string;
  companyMasterSheetLink?: string;
  onSelectFolder: (folderId: string) => void;
  onOneClickGoogleOnboarding: () => void;
  onRepairWorkspace: () => void;
  onRepairCompanyFolderStructure?: () => void;
  onValidateWorkspace: () => void;
  onSyncForms: () => void;
  onEnableAreaRestrictions: () => void;
  onDisableAreaRestrictions: () => void;
  onAddArea: () => void;
  onRenameArea: (siteId: string, currentName: string) => void;
  onArchiveArea: (siteId: string) => void;
  onReactivateArea: (siteId: string) => void;
  onSelectAreaAuditArea: (areaId: string) => void;
  onToggleAreaAudit: (areaId: string, auditId: string, enabled: boolean) => void;
  onCompanyWorkspaceResetSuccess?: (message: string) => void;
  onCompanyWorkspaceResetError?: (message: string) => void;
  onFolderIdChange?: (value: string) => void;
  onMasterSheetChange?: (value: string) => void;
  onAuditFormsFolderChange?: (value: string) => void;
  onSetupFolderChange?: (value: string) => void;
  onRecordsFolderChange?: (value: string) => void;
  onEvidenceFolderChange?: (value: string) => void;
  onExportsFolderChange?: (value: string) => void;
  onManagementNotesFolderChange?: (value: string) => void;
  onCreateCompanyMasterSheet?: () => void;
  onAddFolder?: () => void;
  onGoogleConnect?: () => void;
  slatePrimaryCtaInteract: string;
  userManagement?: Omit<GodmodeUserManagementSectionProps, "pilotLightNested"> & {
    pilotEditableInput: string;
  };
};

function runNextAction(
  action: CompanySetupNextAction["primaryHandler"],
  handlers: {
    onOneClickGoogleOnboarding: () => void;
    onValidateWorkspace: () => void;
    onSyncForms: () => void;
    onRepairCompanyFolderStructure?: () => void;
    onRepairWorkspace: () => void;
  },
) {
  switch (action) {
    case "run_setup":
      handlers.onOneClickGoogleOnboarding();
      break;
    case "health_check":
      handlers.onValidateWorkspace();
      break;
    case "resync":
      handlers.onSyncForms();
      break;
    case "repair_folders":
      handlers.onRepairCompanyFolderStructure?.();
      break;
    case "repair_workspace":
      handlers.onRepairWorkspace();
      break;
    default:
      break;
  }
}

export function GodmodeCompanyWorkspacePanel({
  currentUserRole,
  folders,
  selectedFolder,
  companyMasterSheetId,
  syncState,
  googleConnected,
  googleWorkspaceReady,
  adminOnly,
  folderInspection,
  folderInspectionLoading,
  workspaceValidation,
  workspaceValidationLoading,
  companySheetSync,
  invitedUsers,
  sites,
  areaRestrictionsEnabled,
  areaSyncLoading,
  areaSyncError,
  areaAudits,
  selectedAreaAuditAreaId,
  mappingSyncLoading,
  mappingSyncError,
  templates,
  masterCompanyContextBlocked,
  masterCompanyContextMessage,
  companyFolderStructureRepairing,
  companySetupCurrentStep = "",
  companySetupError = null,
  companyMasterSheetProvisioning,
  folderIdInput,
  masterSheetInput,
  auditFormsFolderInput = "",
  setupFolderInput = "",
  recordsFolderInput = "",
  evidenceFolderInput = "",
  exportsFolderInput = "",
  managementNotesFolderInput = "",
  companyMasterSheetLink,
  onSelectFolder,
  onOneClickGoogleOnboarding,
  onRepairWorkspace,
  onRepairCompanyFolderStructure,
  onValidateWorkspace,
  onSyncForms,
  onEnableAreaRestrictions,
  onDisableAreaRestrictions,
  onAddArea,
  onRenameArea,
  onArchiveArea,
  onReactivateArea,
  onSelectAreaAuditArea,
  onToggleAreaAudit,
  onCompanyWorkspaceResetSuccess,
  onCompanyWorkspaceResetError,
  onFolderIdChange,
  onMasterSheetChange,
  onAuditFormsFolderChange,
  onSetupFolderChange,
  onRecordsFolderChange,
  onEvidenceFolderChange,
  onExportsFolderChange,
  onManagementNotesFolderChange,
  onCreateCompanyMasterSheet,
  onAddFolder,
  onGoogleConnect,
  slatePrimaryCtaInteract,
  userManagement,
}: GodmodeCompanyWorkspacePanelProps) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [inviteTargetDiagnostic, setInviteTargetDiagnostic] = useState("");
  const [inviteTargetRepairing, setInviteTargetRepairing] = useState(false);
  const isProvisioning = companyFolderStructureRepairing || companyMasterSheetProvisioning;
  const healthCheckRun = workspaceValidation != null;
  const workspaceHealthOk = workspaceValidation?.ok ?? false;
  const masterSheetOk = Boolean(companyMasterSheetId || folderInspection?.checks.masterSheet);
  const setupFailed =
    Boolean(folderInspection?.error) ||
    (workspaceValidation != null &&
      !workspaceValidation.ok &&
      (workspaceValidation.missingTabs?.length ?? 0) > 0 &&
      !masterSheetOk);

  const folderStatuses = useMemo(
    () =>
      folders.map((folder) => {
        const masterSheetId = folderMasterSheetId(folder);
        const isSelected = selectedFolder?.id === folder.id;
        const status = resolveCompanyWorkspaceStatus({
          folderName: folder.name,
          masterSheetId: isSelected ? companyMasterSheetId || masterSheetId : masterSheetId,
          isSelected,
          syncState: isSelected ? syncState : undefined,
          isProvisioning: isSelected && isProvisioning,
          setupFailed: isSelected && setupFailed,
          onboardingVerified: folder.onboardingVerified,
          responseSheetVerified: folder.responseSheetVerified,
          workspaceHealthOk: isSelected ? workspaceHealthOk : undefined,
          healthCheckRun: isSelected ? healthCheckRun : undefined,
        });
        return { folder, status };
      }),
    [
      folders,
      selectedFolder?.id,
      companyMasterSheetId,
      syncState,
      isProvisioning,
      setupFailed,
      workspaceHealthOk,
      healthCheckRun,
    ],
  );

  const hasActiveAdmin = useMemo(
    () => invitedUsers.some((invite) => invite.role === "Admin" && (invite.status === "Active" || invite.loginReady)),
    [invitedUsers],
  );

  const registryFirstAdminReady =
    String((selectedFolder as CompanyFolder & { firstAdminStatus?: string })?.firstAdminStatus || "")
      .trim()
      .toLowerCase() === "ready";
  const firstAdminReady =
    hasActiveAdmin || (companySheetSync?.usersCount ?? 0) > 0 || registryFirstAdminReady;

  const folderStructureOk = useMemo(() => {
    if (workspaceValidation) {
      return (
        workspaceValidation.folders.setupFolder &&
        workspaceValidation.folders.auditFormsFolder &&
        workspaceValidation.folders.recordsFolder
      );
    }
    if (folderInspection) {
      return (
        folderInspection.checks.setupFolder &&
        folderInspection.checks.auditFormsFolder &&
        folderInspection.checks.recordsFolder
      );
    }
    return false;
  }, [workspaceValidation, folderInspection]);

  const requiredTabsOk = workspaceValidation
    ? workspaceValidation.ok && (workspaceValidation.missingTabs?.length ?? 0) === 0
    : folderInspection?.masterSheet?.tabs.length
      ? folderInspection.blockingItems.length === 0
      : false;
  const companyFoldersMappingOk = workspaceValidation?.folders.companyFolder ?? Boolean(selectedFolder);
  const registryStatus = getCanonicalCompanyStatus({
    status: (selectedFolder as CompanyFolder & { registryStatus?: string })?.registryStatus,
    registryStatus: (selectedFolder as CompanyFolder & { registryStatus?: string })?.registryStatus,
  });
  const companyLive = isCompanyRegistryLive({ status: registryStatus, registryStatus });
  const folderRegistryLinkMissing = (selectedFolder as CompanyFolder & { registryLinkMissing?: boolean })
    ?.registryLinkMissing;
  const registryLinkMissing =
    Boolean(selectedFolder) &&
    masterSheetOk &&
    !companyLive &&
    (folderRegistryLinkMissing === true ||
      (folderRegistryLinkMissing !== false && !registryStatus && registryStatus !== "Needs attention"));
  const registryUnlinkReason = String(
    (selectedFolder as CompanyFolder & { registryUnlinkReason?: string })?.registryUnlinkReason || "",
  ).trim();
  const readinessChecksGreen =
    Boolean(selectedFolder) &&
    masterSheetOk &&
    folderStructureOk &&
    Boolean(requiredTabsOk) &&
    companyFoldersMappingOk &&
    firstAdminReady &&
    healthCheckRun &&
    workspaceHealthOk;
  const setupBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (!selectedFolder) {
      blockers.push("Company folder not linked");
    }
    if (!masterSheetOk) {
      blockers.push("Master sheet not linked");
    }
    if (!folderStructureOk) {
      blockers.push("Folder structure incomplete");
    }
    if (!requiredTabsOk) {
      blockers.push("Required tabs missing");
    }
    if (!companyFoldersMappingOk) {
      blockers.push("CompanyFolders mapping missing");
    }
    if (!firstAdminReady) {
      blockers.push("First admin not ready");
    }
    if (!healthCheckRun) {
      blockers.push("Workspace health check not run");
    } else if (!workspaceHealthOk) {
      blockers.push("Workspace health check failed");
    }
    if (registryLinkMissing) {
      blockers.push("Company registry link missing — run Repair / complete setup to relink");
    } else if (registryStatus === "Needs attention") {
      blockers.push(registryUnlinkReason ? registryUnlinkReason.replace(/_/g, " ") : "Workspace needs attention");
    } else if (!companyLive && !readinessChecksGreen) {
      blockers.push("Registry status is not Live");
    }
    return blockers;
  }, [
    selectedFolder,
    masterSheetOk,
    folderStructureOk,
    requiredTabsOk,
    companyFoldersMappingOk,
    firstAdminReady,
    healthCheckRun,
    workspaceHealthOk,
    registryStatus,
    registryUnlinkReason,
    companyLive,
    readinessChecksGreen,
    registryLinkMissing,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedFolder?.id || !googleWorkspaceReady || adminOnly) {
      setInviteTargetDiagnostic("");
      return () => {
        cancelled = true;
      };
    }
    const sheetId = companyMasterSheetId || folderInspection?.masterSheet?.id || "";
    if (!sheetId) {
      setInviteTargetDiagnostic("");
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const params = new URLSearchParams({
          companyFolderId: selectedFolder.id,
          masterSheetId: sheetId,
          companyName: selectedFolder.name,
        });
        const response = await fetch(apiUrl(`/api/onboarding/company-invite-target-diagnostics?${params}`), {
          credentials: "include",
        });
        const payload = (await response.json()) as {
          verificationWouldFail?: boolean;
          masterSheetReady?: boolean;
          message?: string;
          diagnostics?: string[];
        };
        if (cancelled) return;
        if (
          response.ok &&
          payload.verificationWouldFail &&
          payload.masterSheetReady &&
          masterSheetOk
        ) {
          const detail = payload.message ? ` ${payload.message}` : "";
          setInviteTargetDiagnostic(
            `Master sheet looks ready in Godmode, but invite verification would fail.${detail} Repair the invite/company sheet link before sending user invites.`,
          );
          return;
        }
        setInviteTargetDiagnostic("");
      } catch {
        if (!cancelled) {
          setInviteTargetDiagnostic("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    adminOnly,
    companyMasterSheetId,
    folderInspection?.masterSheet?.id,
    googleWorkspaceReady,
    masterSheetOk,
    selectedFolder?.id,
    selectedFolder?.name,
  ]);

  const repairInviteCompanySheetLink = async () => {
    if (!selectedFolder?.id || inviteTargetRepairing) {
      return;
    }
    setInviteTargetRepairing(true);
    try {
      const response = await fetch(apiUrl("/api/onboarding/repair-company-invite-target"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyFolderId: selectedFolder.id,
          masterSheetId: companyMasterSheetId || folderInspection?.masterSheet?.id || "",
          companyName: selectedFolder.name,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || payload.error || "Unable to repair invite/company sheet link.");
      }
      setInviteTargetDiagnostic("");
    } catch (error) {
      setInviteTargetDiagnostic(
        error instanceof Error ? error.message : "Unable to repair invite/company sheet link.",
      );
    } finally {
      setInviteTargetRepairing(false);
    }
  };

  const selectedStatus = useMemo(() => {
    if (!selectedFolder) return null;
    return resolveCompanySetupStatus({
      folderName: selectedFolder.name,
      hasCompanyFolder: true,
      masterSheetId: companyMasterSheetId,
      syncState,
      isProvisioning,
      setupFailed,
      onboardingVerified: selectedFolder.onboardingVerified,
      responseSheetVerified: selectedFolder.responseSheetVerified,
      workspaceHealthOk,
      healthCheckRun,
    });
  }, [
    selectedFolder,
    companyMasterSheetId,
    syncState,
    isProvisioning,
    setupFailed,
    workspaceHealthOk,
    healthCheckRun,
  ]);

  const isLiveStatus = selectedStatus === "Live" || selectedStatus === "Needs attention";

  const nextAction = useMemo(() => {
    if (!selectedStatus) {
      return getCompanySetupNextAction({
        status: "Not started",
        googleWorkspaceReady,
        masterSheetOk,
        folderStructureOk,
        healthCheckRun,
        workspaceHealthOk,
      });
    }
    return getCompanySetupNextAction({
      status: selectedStatus,
      googleWorkspaceReady,
      masterSheetOk,
      folderStructureOk,
      healthCheckRun,
      workspaceHealthOk,
    });
  }, [
    selectedStatus,
    googleWorkspaceReady,
    masterSheetOk,
    folderStructureOk,
    healthCheckRun,
    workspaceHealthOk,
  ]);

  const healthSummary = workspaceValidation
    ? workspaceValidation.ok
      ? "Healthy"
      : "Needs attention"
    : healthCheckRun
      ? "Checked"
      : "Not checked yet";

  const showAreas = canManageAreas(currentUserRole) && selectedFolder && !masterCompanyContextBlocked && companyLive;
  const showReset =
    currentUserRole === "Master" && selectedFolder && companyMasterSheetId && onCompanyWorkspaceResetSuccess;

  const actionHandlers = {
    onOneClickGoogleOnboarding,
    onValidateWorkspace,
    onSyncForms,
    onRepairCompanyFolderStructure,
    onRepairWorkspace,
  };

  return (
    <div className="space-y-4">
      <section className={pilotLightSurface}>
        <SectionHeader
          icon="clipboard"
          eyebrow="Workspaces"
          title="Select company"
          subtitle="Choose which company workspace you are setting up."
        />
        {folders.length === 0 ? (
          <EmptyPanel
            title="No company workspaces yet"
            text="Send a company onboarding invite above, or link a folder after the customer completes onboarding."
          />
        ) : (
          <ul className="mt-3 space-y-2">
            {folderStatuses.map(({ folder, status }) => {
              const selected = selectedFolder?.id === folder.id;
              return (
                <li key={folder.id}>
                  <button
                    type="button"
                    onClick={() => onSelectFolder(folder.id)}
                    className={[
                      "bert-light-surface flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition",
                      selected
                        ? "border-orange-300 bg-orange-50 ring-1 ring-orange-200"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white",
                    ].join(" ")}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{folder.name}</p>
                      {selected ? (
                        <p className="mt-0.5 text-xs font-medium text-orange-800">Selected</p>
                      ) : (
                        <p className="mt-0.5 truncate text-xs text-slate-500">Tap to select</p>
                      )}
                    </div>
                    <WorkspaceStatusBadge status={status} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-600">{SECTION_INTROS.companiesInviteHelper}</p>
      </section>

      {selectedFolder ? (
        <>
          <section className={pilotLightSurface}>
            <SectionHeader
              icon="clipboard"
              eyebrow="Setup"
              title="Selected company setup"
              subtitle={selectedFolder.name}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {selectedStatus ? <WorkspaceStatusBadge status={selectedStatus} /> : null}
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next action</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{nextAction.label}</p>
              {nextAction.detail ? <p className="mt-1 text-xs text-slate-600">{nextAction.detail}</p> : null}
            </div>
            <div className="mt-4 space-y-2">
              <SetupChecklistRow label="Company folder" ok={Boolean(selectedFolder)} />
              <SetupChecklistRow
                label="Folder structure"
                ok={folderStructureOk}
                hint="ISO 01–06 folders under the company root"
              />
              <SetupChecklistRow label="Company master sheet" ok={masterSheetOk} />
              <SetupChecklistRow
                label="Required tabs"
                ok={Boolean(requiredTabsOk)}
                hint={
                  workspaceValidation?.missingTabs.length
                    ? `${workspaceValidation.missingTabs.length} tab(s) missing`
                    : undefined
                }
              />
              <SetupChecklistRow label="CompanyFolders mapping" ok={companyFoldersMappingOk} />
              <SetupChecklistRow label="First admin" ok={firstAdminReady} />
              <SetupChecklistRow label="Workspace health checked" ok={healthCheckRun && workspaceHealthOk} />
              <SetupChecklistRow
                label="Company live"
                ok={companyLive}
                hint={companyLive ? "Registry status: Live" : registryStatus || "Not Live"}
              />
            </div>
            {!companyLive ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <p className="font-semibold">
                  {registryLinkMissing
                    ? "Company registry link missing."
                    : "Company is not Live in the registry."}
                </p>
                {registryLinkMissing ? (
                  <p className="mt-1 text-xs text-amber-900">
                    Click Repair / complete setup to relink it.
                  </p>
                ) : null}
                {setupBlockers.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {setupBlockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                ) : null}
                <button
                  type="button"
                  onClick={() => void onOneClickGoogleOnboarding()}
                  disabled={adminOnly || !googleWorkspaceReady || isProvisioning}
                  className="mt-3 inline-flex h-10 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isProvisioning ? "Running setup…" : "Repair / complete setup"}
                </button>
              </div>
            ) : null}
            {inviteTargetDiagnostic ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <p>{inviteTargetDiagnostic}</p>
                <button
                  type="button"
                  onClick={() => void repairInviteCompanySheetLink()}
                  disabled={adminOnly || !googleWorkspaceReady || inviteTargetRepairing}
                  className="mt-3 inline-flex h-10 items-center rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {inviteTargetRepairing ? "Repairing…" : "Repair invite/company sheet link"}
                </button>
              </div>
            ) : null}
            {registryUnlinkReason ? (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Unlink reason: {registryUnlinkReason.replace(/_/g, " ")}
              </p>
            ) : null}
            {isProvisioning && companySetupCurrentStep ? (
              <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                Current step:{" "}
                {COMPANY_SETUP_STEP_LABELS[companySetupCurrentStep] ||
                  companySetupCurrentStep.replace(/_/g, " ")}
              </p>
            ) : null}
            {companySetupError ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
                <p className="font-semibold">{COMPANY_SETUP_DID_NOT_FINISH_MESSAGE}</p>
                {companySetupError.failedStep ? (
                  <p className="mt-2">
                    Failed step:{" "}
                    {COMPANY_SETUP_STEP_LABELS[companySetupError.failedStep] ||
                      companySetupError.failedStep.replace(/_/g, " ")}
                  </p>
                ) : null}
                {companySetupError.errorCode ? (
                  <p className="mt-1 font-mono text-xs">Error code: {companySetupError.errorCode}</p>
                ) : null}
                {companySetupError.message ? (
                  <p className="mt-2 text-xs text-rose-900">{companySetupError.message}</p>
                ) : null}
                {companySetupError.technicalError ? (
                  <p className="mt-2 font-mono text-xs text-rose-800">{companySetupError.technicalError}</p>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {!isLiveStatus ? (
                <button
                  type="button"
                  onClick={() => runNextAction(nextAction.primaryHandler, actionHandlers)}
                  disabled={
                    adminOnly ||
                    !googleWorkspaceReady ||
                    folderInspectionLoading ||
                    isProvisioning ||
                    nextAction.primaryHandler === "none"
                  }
                  className="inline-flex h-11 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isProvisioning ? "Running setup…" : "Repair / complete setup"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onValidateWorkspace}
                  disabled={masterCompanyContextBlocked || workspaceValidationLoading}
                  className="inline-flex h-11 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {workspaceValidationLoading ? "Checking…" : "Re-check workspace"}
                </button>
              )}
              <a
                href={`https://drive.google.com/drive/folders/${selectedFolder.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
              >
                Open Drive folder
              </a>
              {companyMasterSheetId ? (
                <a
                  href={`https://docs.google.com/spreadsheets/d/${companyMasterSheetId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
                >
                  Open master sheet
                </a>
              ) : null}
            </div>
          </section>

          <section className={pilotLightSurface}>
            <SectionHeader
              icon="shield"
              eyebrow="Health"
              title="Workspace health"
              subtitle="Sync status, row counts, and folder/sheet checks for this company."
            />
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MiniMetric
                label="Last synced"
                value={companySheetSync?.lastSyncedAt ?? (syncState === "Synced" ? syncState : "Not synced")}
              />
              <MiniMetric label="Users" value={String(companySheetSync?.usersCount ?? "—")} />
              <MiniMetric
                label="Audit templates"
                value={String(templates.filter((t) => t.active).length || "—")}
              />
              <MiniMetric label="Schedules" value={String(companySheetSync?.schedulesCount ?? "—")} />
              <MiniMetric label="Actions" value={String(companySheetSync?.actionsCount ?? "—")} />
              <MiniMetric label="Last health check" value={healthSummary} />
            </dl>
            {setupFailed && folderInspection?.blockingItems.length ? (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {folderInspection.blockingItems.join(" • ")}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onValidateWorkspace}
                disabled={masterCompanyContextBlocked}
                title={masterCompanyContextBlocked ? masterCompanyContextMessage : undefined}
                className={`inline-flex h-11 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${slatePrimaryCtaInteract}`}
              >
                {workspaceValidationLoading ? "Checking…" : "Run health check"}
              </button>
              <button
                type="button"
                onClick={onSyncForms}
                disabled={adminOnly || !googleWorkspaceReady || !selectedFolder || folderInspectionLoading}
                className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Re-sync from company sheet
              </button>
              {onRepairCompanyFolderStructure ? (
                <button
                  type="button"
                  onClick={onRepairCompanyFolderStructure}
                  disabled={masterCompanyContextBlocked || companyFolderStructureRepairing}
                  className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {companyFolderStructureRepairing ? "Repairing…" : "Repair folder structure"}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setShowDiagnostics((open) => !open)}
              className="mt-4 text-xs font-semibold text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              {showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
            </button>
            {showDiagnostics ? (
              <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                {folderInspection ? (
                  <div className={pilotLightNested}>
                    <p className="text-sm font-semibold text-slate-900">Folder check — {folderInspection.folder.name}</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <FolderCheckRow label="Company Master Sheet" ok={folderInspection.checks.masterSheet} />
                      <FolderCheckRow label="Audit forms folder" ok={folderInspection.checks.auditFormsFolder} />
                      <FolderCheckRow label="01 Company Setup folder" ok={folderInspection.checks.setupFolder} />
                      <FolderCheckRow label="03 Company Records folder" ok={folderInspection.checks.recordsFolder} />
                      <FolderCheckRow label="Evidence folder" ok={folderInspection.checks.evidenceFolder} />
                      <FolderCheckRow label="Exports folder" ok={folderInspection.checks.exportsFolder} />
                      <FolderCheckRow
                        label="06 Management Notes folder"
                        ok={folderInspection.checks.managementNotesFolder}
                      />
                    </div>
                    {folderInspection.recommendedItems.length > 0 ? (
                      <p className="mt-2 text-xs text-slate-600">{folderInspection.recommendedItems.join(" • ")}</p>
                    ) : null}
                  </div>
                ) : null}
                {workspaceValidation ? (
                  <div className={pilotLightNested}>
                    <p className="text-sm font-semibold text-slate-900">Workspace validation</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Schema on sheet: {workspaceValidation.schemaVersion || "none"} • app expects{" "}
                      {workspaceValidation.currentSchemaVersion}
                    </p>
                    {workspaceValidation.missingTabs.length > 0 ? (
                      <p className="mt-2 text-sm text-rose-800">Missing tabs: {workspaceValidation.missingTabs.join(", ")}</p>
                    ) : null}
                    {(workspaceValidation.repairableIssues?.length ?? 0) > 0 && !workspaceValidation.ok ? (
                      <p className="mt-2 text-sm text-amber-800">{workspaceValidation.repairableIssues?.join(" • ")}</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={onRepairWorkspace}
                      disabled={masterCompanyContextBlocked}
                      className="mt-3 h-10 rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-800"
                    >
                      Fix workspace (repair sheet &amp; folders)
                    </button>
                  </div>
                ) : null}
                <div className={pilotLightNested}>
                  <p className="text-sm font-semibold text-slate-900">Repair setup debug</p>
                  <dl className="mt-2 space-y-2 text-xs text-slate-600">
                    <div>
                      <dt className="font-semibold text-slate-500">Company ID</dt>
                      <dd className="mt-0.5 break-all font-mono text-slate-800">{selectedFolder.id}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Registry status</dt>
                      <dd className="mt-0.5 font-mono text-slate-800">{registryStatus || "Unknown"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Master sheet ID</dt>
                      <dd className="mt-0.5 break-all font-mono text-slate-800">{companyMasterSheetId || "Not linked"}</dd>
                    </div>
                    {companySetupError ? (
                      <>
                        <div>
                          <dt className="font-semibold text-slate-500">Last failed step</dt>
                          <dd className="mt-0.5 font-mono text-slate-800">
                            {COMPANY_SETUP_STEP_LABELS[companySetupError.failedStep] || companySetupError.failedStep || "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-slate-500">Technical error</dt>
                          <dd className="mt-0.5 break-all font-mono text-rose-800">
                            {companySetupError.technicalError || "—"}
                          </dd>
                        </div>
                      </>
                    ) : companyLive ? (
                      <div>
                        <dt className="font-semibold text-slate-500">Last repair result</dt>
                        <dd className="mt-0.5 text-emerald-800">Registry status is Live.</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
                <div className={pilotLightNested}>
                  <p className="text-sm font-semibold text-slate-900">Folder &amp; sheet IDs</p>
                  <dl className="mt-2 space-y-2 text-xs text-slate-600">
                    <div>
                      <dt className="font-semibold text-slate-500">Company folder ID</dt>
                      <dd className="mt-0.5 break-all font-mono text-slate-800">{selectedFolder.id}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Master sheet ID</dt>
                      <dd className="mt-0.5 break-all font-mono text-slate-800">{companyMasterSheetId || "Not linked"}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            ) : null}
          </section>

          {userManagement ? (
            <section className={pilotLightSurface}>
              <SectionHeader
                icon="user"
                eyebrow="People"
                title="User management"
                subtitle="Invite users by email. They complete name and password from the link."
              />
              <div className="mt-4">
                <GodmodeUserManagementSection
                  {...userManagement}
                  pilotLightNested={pilotLightNested}
                />
              </div>
            </section>
          ) : null}

          {showAreas ? (
            <>
              <SitesAreasPanel
                currentUserRole={currentUserRole}
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
                onAddArea={onAddArea}
                onRenameArea={onRenameArea}
                onArchiveArea={onArchiveArea}
                onReactivateArea={onReactivateArea}
              />
              <AreaAuditsSection
                sites={sites}
                areaRestrictionsEnabled={areaRestrictionsEnabled}
                templates={templates}
                areaAudits={areaAudits}
                mappingSyncLoading={mappingSyncLoading}
                mappingSyncError={mappingSyncError}
                selectedAreaId={selectedAreaAuditAreaId}
                variant="light"
                surfaceClass={pilotLightSurface}
                onSelectArea={onSelectAreaAuditArea}
                onToggleAreaAudit={onToggleAreaAudit}
              />
            </>
          ) : null}

          <GodmodeCollapsibleSection
            title="Advanced tools"
            summary="Manual folder/sheet IDs, legacy workspace linking, and extra repair actions."
            defaultOpen={false}
            openLabel="Show advanced tools"
            closeLabel="Hide advanced tools"
            surfaceClass={pilotLightSurface}
          >
            <div className="space-y-4">
              <div className={pilotLightNested}>
                <p className="text-sm font-semibold text-slate-900">Legacy workspace linking</p>
                <p className="mt-1 text-xs text-slate-500">
                  Paste Drive links when onboarding did not auto-link, or when repairing an older company folder.
                </p>
                {onFolderIdChange ? (
                  <label className="mt-3 block">
                    <span className="text-xs font-semibold text-slate-600">Company folder link or ID</span>
                    <input
                      value={folderIdInput}
                      onChange={(event) => onFolderIdChange(event.target.value)}
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900"
                      placeholder="Paste company folder link or ID"
                    />
                  </label>
                ) : null}
                {onMasterSheetChange ? (
                  <label className="mt-3 block">
                    <span className="text-xs font-semibold text-slate-600">Master sheet link or ID</span>
                    <input
                      value={masterSheetInput}
                      onChange={(event) => onMasterSheetChange(event.target.value)}
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900"
                      placeholder="Auto-created during setup, or paste link / ID"
                    />
                  </label>
                ) : null}
                {onCreateCompanyMasterSheet ? (
                  <button
                    type="button"
                    onClick={onCreateCompanyMasterSheet}
                    disabled={
                      adminOnly ||
                      !googleWorkspaceReady ||
                      companyMasterSheetProvisioning ||
                      companyFolderStructureRepairing ||
                      !folderIdInput.trim()
                    }
                    className="mt-2 h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:opacity-60"
                  >
                    {companyMasterSheetProvisioning ? "Creating master sheet…" : "Create company master sheet"}
                  </button>
                ) : null}
                {companyMasterSheetLink ? (
                  <p className="mt-2 break-all text-xs text-emerald-800">
                    <a href={companyMasterSheetLink} target="_blank" rel="noopener noreferrer" className="underline">
                      {companyMasterSheetLink}
                    </a>
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {onGoogleConnect && onAddFolder ? (
                    <button
                      type="button"
                      onClick={!googleConnected ? onGoogleConnect : onAddFolder}
                      disabled={adminOnly || !googleWorkspaceReady}
                      className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
                    >
                      {!googleConnected ? "Connect Google Drive" : "Continue workspace setup"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onRepairWorkspace}
                    disabled={masterCompanyContextBlocked}
                    className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
                  >
                    Fix workspace
                  </button>
                </div>
              </div>
              {(onAuditFormsFolderChange ||
                onSetupFolderChange ||
                onRecordsFolderChange ||
                onEvidenceFolderChange ||
                onExportsFolderChange ||
                onManagementNotesFolderChange) && (
                <div className={pilotLightNested}>
                  <p className="text-sm font-semibold text-slate-900">Optional folder overrides</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {onAuditFormsFolderChange ? (
                      <label className="block sm:col-span-2">
                        <span className="text-xs text-slate-600">Audit forms folder</span>
                        <input
                          value={auditFormsFolderInput}
                          onChange={(e) => onAuditFormsFolderChange(e.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                        />
                      </label>
                    ) : null}
                    {onSetupFolderChange ? (
                      <label className="block">
                        <span className="text-xs text-slate-600">01 Company Setup</span>
                        <input
                          value={setupFolderInput}
                          onChange={(e) => onSetupFolderChange(e.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                        />
                      </label>
                    ) : null}
                    {onRecordsFolderChange ? (
                      <label className="block">
                        <span className="text-xs text-slate-600">03 Company Records</span>
                        <input
                          value={recordsFolderInput}
                          onChange={(e) => onRecordsFolderChange(e.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                        />
                      </label>
                    ) : null}
                    {onEvidenceFolderChange ? (
                      <label className="block">
                        <span className="text-xs text-slate-600">Evidence</span>
                        <input
                          value={evidenceFolderInput}
                          onChange={(e) => onEvidenceFolderChange(e.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                        />
                      </label>
                    ) : null}
                    {onExportsFolderChange ? (
                      <label className="block">
                        <span className="text-xs text-slate-600">Exports</span>
                        <input
                          value={exportsFolderInput}
                          onChange={(e) => onExportsFolderChange(e.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                        />
                      </label>
                    ) : null}
                    {onManagementNotesFolderChange ? (
                      <label className="block sm:col-span-2">
                        <span className="text-xs text-slate-600">06 Management Notes</span>
                        <input
                          value={managementNotesFolderInput}
                          onChange={(e) => onManagementNotesFolderChange(e.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                        />
                      </label>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </GodmodeCollapsibleSection>

          {showReset ? (
            <CompanyWorkspaceResetPanel
              companyFolderId={selectedFolder.id}
              masterSheetId={companyMasterSheetId}
              companyName={selectedFolder.name}
              googleConnected={googleConnected}
              slatePrimaryCtaInteract={slatePrimaryCtaInteract}
              onResetComplete={onCompanyWorkspaceResetSuccess}
              onResetError={(message) => onCompanyWorkspaceResetError?.(message)}
              collapsible
            />
          ) : null}
        </>
      ) : null}

      {masterCompanyContextBlocked && masterCompanyContextMessage ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {masterCompanyContextMessage}
        </p>
      ) : null}
    </div>
  );
}
