import { useEffect, useMemo, useState } from "react";
import type { Role } from "../../permissions";
import { canManageAreas } from "../../permissions";
import { apiUrl } from "../../config/apiBase";
import { AreaAuditsSection } from "../admin/AreaAuditsSection";
import { CompanyWorkspaceResetPanel } from "../admin/CompanyWorkspaceResetPanel";
import { SitesAreasPanel } from "../admin/SitesAreasPanel";
import { EmptyPanel, MiniMetric, SectionHeader } from "../dashboard/DashboardPrimitives";
import { SECTION_INTROS } from "../../config/sectionIntros";
import { GodmodeBackgroundJobsPanel } from "./GodmodeBackgroundJobsPanel";
import { GodmodeCollapsibleSection } from "./GodmodeCollapsibleSection";
import { GodmodeUserManagementSection, type GodmodeUserManagementSectionProps } from "./GodmodeUserManagementSection";
import { WorkspaceStatusBadge } from "./WorkspaceStatusBadge";
import {
  resolveCompanySetupStatus,
  resolveCompanyWorkspaceStatus,
  resolveSimpleCompanySetupStatus,
  simpleSetupStatusBadgeClass,
} from "../../utils/companyWorkspaceStatus";
import {
  resolveCompanySetupDisplayStatus,
  resolveCompanySetupPhase,
  resolveCompanySetupPrimaryAction,
  shouldAutoQueueHealthCheck,
} from "../../utils/companySetupState";
import { UX_STATUS } from "../../utils/uxDeclutter";
import type { Site, UserInvite, FolderInspection } from "../../types/adminScreenProps";
import type { AreaAuditMapping } from "../../utils/areaAuditMapping";
import type { AuditTemplate } from "../../types/reportsScreenProps";
import type { CompanyFolder, CompanySheetSyncStatus, WorkspaceValidation } from "../../types/dashboardScreenProps";
import {
  COMPANY_SETUP_DID_NOT_FINISH_MESSAGE,
  COMPANY_SETUP_STEP_LABELS,
  COMPANY_SETUP_SUCCESS_MESSAGE,
  type MakeUsableResult,
} from "../../services/companySetupProgressService";
import { COMPANY_READY_INVITE_MESSAGE } from "../../utils/companyFolderContext";
import { companyWorkspaceRegistryService } from "../../services/companyWorkspaceRegistryService";
import {
  getCanonicalCompanyStatus,
  isCompanyRegistryLive,
  isCompanyUsersTabWritable,
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
  companySetupResult?: MakeUsableResult | null;
  companyRegistryStatus?: string;
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
  onMakeCompanyUsable: () => void;
  /** @deprecated Use onMakeCompanyUsable */
  onCompleteSetup?: () => void;
  /** @deprecated Use onMakeCompanyUsable */
  onOneClickGoogleOnboarding?: () => void;
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
  onCompanyRegistryUpdated?: (payload: {
    companyId: string;
    registryStatus: string;
    masterSheetId?: string;
    registryLinkMissing?: boolean;
  }) => void | Promise<void>;
  onClearSetupError?: () => void;
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
  companySetupWarnings = [],
  companySetupResult = null,
  companyRegistryStatus = "",
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
  onMakeCompanyUsable,
  onCompleteSetup,
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
  onCompanyRegistryUpdated,
  onClearSetupError,
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
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const runMakeUsable = onMakeCompanyUsable || onCompleteSetup || onOneClickGoogleOnboarding;
  const [inviteTargetDiagnostic, setInviteTargetDiagnostic] = useState("");
  const [inviteTargetRepairing, setInviteTargetRepairing] = useState(false);
  const [usersTabRepairing, setUsersTabRepairing] = useState(false);
  const [usersTabRepairMessage, setUsersTabRepairMessage] = useState("");
  const [usersCacheRebuilding, setUsersCacheRebuilding] = useState(false);
  const [usersCacheRebuildMessage, setUsersCacheRebuildMessage] = useState("");
  const [registryRelinking, setRegistryRelinking] = useState(false);
  const [registryForceLiveLoading, setRegistryForceLiveLoading] = useState(false);
  const [registryRelinkSucceeded, setRegistryRelinkSucceeded] = useState(false);
  const [registryActionError, setRegistryActionError] = useState("");
  const healthCheckRun = workspaceValidation != null;
  const workspaceHealthOk = workspaceValidation?.ok ?? false;
  const masterSheetOk = Boolean(companyMasterSheetId || folderInspection?.checks.masterSheet);
  const setupFailed =
    Boolean(folderInspection?.error) ||
    (workspaceValidation != null &&
      !workspaceValidation.ok &&
      (workspaceValidation.missingTabs?.length ?? 0) > 0 &&
      !masterSheetOk);

  const effectiveRegistryStatus = getCanonicalCompanyStatus({
    status: companyRegistryStatus || (selectedFolder as CompanyFolder & { registryStatus?: string })?.registryStatus,
    registryStatus: companyRegistryStatus || (selectedFolder as CompanyFolder & { registryStatus?: string })?.registryStatus,
  });
  const companyLive = isCompanyRegistryLive({
    status: effectiveRegistryStatus,
    registryStatus: effectiveRegistryStatus,
  });
  const resolvedMasterSheetId = companyMasterSheetId || folderInspection?.masterSheet?.id || companySheetSync?.sheetId || "";
  const companyUsable = Boolean(
    selectedFolder?.id &&
      resolvedMasterSheetId &&
      !setupFailed,
  );
  const godmodeUsersTabWritable = isCompanyUsersTabWritable({
    companySheetSync: companySheetSync ?? undefined,
    workspaceValidation,
  });
  const hasLinkedCompanyWorkspace = Boolean(selectedFolder?.id && resolvedMasterSheetId);
  const canShowUserInvites = companyUsable || godmodeUsersTabWritable || hasLinkedCompanyWorkspace;
  const setupRunning = companyFolderStructureRepairing || companyMasterSheetProvisioning;
  const isProvisioning = setupRunning && !companyUsable;
  const visibleSetupError = companyUsable ? null : companySetupError;

  const folderStatuses = useMemo(
    () =>
      folders.map((folder) => {
        const masterSheetId = folderMasterSheetId(folder);
        const isSelected = selectedFolder?.id === folder.id;
        const folderRegistryStatus = getCanonicalCompanyStatus({
          status: (folder as CompanyFolder & { registryStatus?: string }).registryStatus,
          registryStatus: (folder as CompanyFolder & { registryStatus?: string }).registryStatus,
        });
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
          registryStatus: isSelected ? effectiveRegistryStatus : folderRegistryStatus,
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
      effectiveRegistryStatus,
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
  const registryStatus = effectiveRegistryStatus;
  const usingFallbackRegistry =
    companySetupResult?.fallbackRegistry === true || companySetupResult?.registrySource === "fallback";
  const fallbackRegistryDiagnostic = (companySetupResult?.warnings || []).find((warning) =>
    warning.startsWith("Using fallback registry because main Companies registry write failed"),
  );
  const registryStatusDisplay = companyLive
    ? "Live"
    : registryActionError
      ? registryActionError
      : visibleSetupError?.failedStep === "persist_live" && visibleSetupError.message
        ? visibleSetupError.message
        : registryStatus || "Not Live";
  const folderRegistryLinkMissing = (selectedFolder as CompanyFolder & { registryLinkMissing?: boolean })
    ?.registryLinkMissing;
  const registryLinkMissing =
    Boolean(selectedFolder) &&
    masterSheetOk &&
    !companyLive &&
    (folderRegistryLinkMissing === true ||
      (folderRegistryLinkMissing !== false && !effectiveRegistryStatus && effectiveRegistryStatus !== "Needs attention"));
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
    if (!companyLive) {
      if (!healthCheckRun) {
        blockers.push("Workspace health check not run");
      } else if (!workspaceHealthOk) {
        blockers.push("Workspace health check failed");
      }
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
    setRegistryRelinkSucceeded(false);
    setRegistryActionError("");
  }, [selectedFolder?.id]);

  const buildReadinessChecks = () => ({
    rootFolderId: selectedFolder?.id || "",
    masterSheetId: companyMasterSheetId || folderInspection?.masterSheet?.id || "",
    folderStructureOk,
    requiredTabsOk: Boolean(requiredTabsOk),
    companyFoldersMappingOk,
    firstAdminReady,
    workspaceHealthOk: healthCheckRun && workspaceHealthOk,
    healthCheckRun: healthCheckRun && workspaceHealthOk,
    skipHealthCheck: !healthCheckRun,
  });

  const relinkCompanyRegistry = async () => {
    if (!selectedFolder?.id || registryRelinking) {
      return;
    }
    setRegistryRelinking(true);
    setRegistryActionError("");
    try {
      const sheetId = companyMasterSheetId || folderInspection?.masterSheet?.id || "";
      const result = await companyWorkspaceRegistryService.relinkRegistry({
        workspaceId: selectedFolder.id,
        companyFolderId: selectedFolder.id,
        companyId: selectedFolder.id,
        companyName: selectedFolder.name,
        masterSheetId: sheetId,
      });
      setRegistryRelinkSucceeded(true);
      onClearSetupError?.();
      const registryPayload = await companyWorkspaceRegistryService.getCompany(
        result.companyId || selectedFolder.id,
      );
      const canonicalStatus = getCanonicalCompanyStatus(registryPayload.company);
      const registryMasterSheetId = String(registryPayload.company.masterSheetId || result.masterSheetId || "").trim();
      const relinkLive = isCompanyRegistryLive(registryPayload.company);
      await onCompanyRegistryUpdated?.({
        companyId: result.companyId || selectedFolder.id,
        registryStatus: canonicalStatus || result.registryStatus,
        masterSheetId: registryMasterSheetId,
        registryLinkMissing: !relinkLive,
      });
    } catch (error) {
      setRegistryActionError(error instanceof Error ? error.message : "Unable to relink company registry record.");
    } finally {
      setRegistryRelinking(false);
    }
  };

  const forceMarkLiveFromReadyChecks = async () => {
    if (!selectedFolder?.id || registryForceLiveLoading) {
      return;
    }
    setRegistryForceLiveLoading(true);
    setRegistryActionError("");
    try {
      const result = await companyWorkspaceRegistryService.forceLiveIfReady({
        companyId: selectedFolder.id,
        companyFolderId: selectedFolder.id,
        companyName: selectedFolder.name,
        checks: buildReadinessChecks(),
      });
      onClearSetupError?.();
      const registryPayload = await companyWorkspaceRegistryService.getCompany(
        result.companyId || selectedFolder.id,
      );
      const canonicalStatus = getCanonicalCompanyStatus(registryPayload.company);
      const registryMasterSheetId = String(
        registryPayload.company.masterSheetId || companyMasterSheetId || folderInspection?.masterSheet?.id || "",
      ).trim();
      const forceLive = isCompanyRegistryLive(registryPayload.company);
      await onCompanyRegistryUpdated?.({
        companyId: result.companyId || selectedFolder.id,
        registryStatus: canonicalStatus || result.registryStatus,
        masterSheetId: registryMasterSheetId,
        registryLinkMissing: !forceLive,
      });
    } catch (error) {
      setRegistryActionError(error instanceof Error ? error.message : "Unable to mark company live.");
    } finally {
      setRegistryForceLiveLoading(false);
    }
  };

  const showForceLiveFromReadyChecks =
    !companyLive && readinessChecksGreen && (registryRelinkSucceeded || !registryLinkMissing);

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

  const rebuildUsersFromSheet = async () => {
    if (!selectedFolder?.id || usersCacheRebuilding) {
      return;
    }
    const masterSheetId = companyMasterSheetId || folderInspection?.masterSheet?.id || "";
    if (!masterSheetId) {
      setUsersCacheRebuildMessage("Link a company master sheet before rebuilding users from the sheet.");
      return;
    }
    setUsersCacheRebuilding(true);
    setUsersCacheRebuildMessage("");
    try {
      const response = await fetch(
        apiUrl(`/api/godmode/companies/${encodeURIComponent(selectedFolder.id)}/rebuild-users-from-sheet`),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyFolderId: selectedFolder.id,
            masterSheetId,
            companyName: selectedFolder.name,
          }),
        },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        technicalError?: string;
        activeCount?: number;
        cacheOnlyUsersRemoved?: number;
        removed?: string[];
        kept?: string[];
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.technicalError || payload.error || "Unable to rebuild users from sheet.");
      }
      const removed = Array.isArray(payload.removed) ? payload.removed : [];
      setUsersCacheRebuildMessage(
        `Rebuilt user cache from sheet (${payload.activeCount ?? 0} active). Removed ${payload.cacheOnlyUsersRemoved ?? removed.length} cache-only user(s).`,
      );
    } catch (error) {
      setUsersCacheRebuildMessage(
        error instanceof Error ? error.message : "Unable to rebuild users from sheet.",
      );
    } finally {
      setUsersCacheRebuilding(false);
    }
  };

  const repairUsersTab = async () => {
    if (!selectedFolder?.id || usersTabRepairing) {
      return;
    }
    const masterSheetId = companyMasterSheetId || folderInspection?.masterSheet?.id || "";
    if (!masterSheetId) {
      setUsersTabRepairMessage("Link a company master sheet before repairing the Users tab.");
      return;
    }
    setUsersTabRepairing(true);
    setUsersTabRepairMessage("");
    try {
      const response = await fetch(
        apiUrl(`/api/godmode/companies/${encodeURIComponent(selectedFolder.id)}/repair-users-tab`),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyFolderId: selectedFolder.id,
            masterSheetId,
            companyName: selectedFolder.name,
          }),
        },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        technicalError?: string;
        rowCount?: number;
        tabTitle?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.technicalError || payload.error || "Unable to repair the Users tab.");
      }
      setUsersTabRepairMessage(
        `Users tab repaired (${payload.tabTitle || "Users"}, ${payload.rowCount ?? 0} row(s)).`,
      );
    } catch (error) {
      setUsersTabRepairMessage(
        error instanceof Error ? error.message : "Unable to repair the Users tab.",
      );
    } finally {
      setUsersTabRepairing(false);
    }
  };

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
      registryStatus: effectiveRegistryStatus,
    });
  }, [
    selectedFolder,
    companyMasterSheetId,
    syncState,
    isProvisioning,
    setupFailed,
    workspaceHealthOk,
    healthCheckRun,
    effectiveRegistryStatus,
  ]);

  const backgroundWorkRunning =
    isProvisioning || Boolean(companySetupResult?.backgroundSetup) || Boolean(companySetupResult?.backgroundJobs?.length);
  const setupPhase = useMemo(() => {
    if (!selectedFolder) {
      return null;
    }
    return resolveCompanySetupPhase({
      setupFailed,
      companyUsable,
      hasCompanyFolder: true,
      masterSheetId: companyMasterSheetId,
      syncState,
      isProvisioning,
      backgroundWorkRunning,
      healthCheckRun,
      workspaceHealthOk,
    });
  }, [
    selectedFolder,
    setupFailed,
    companyUsable,
    companyMasterSheetId,
    syncState,
    isProvisioning,
    backgroundWorkRunning,
    healthCheckRun,
    workspaceHealthOk,
  ]);

  const simpleStatus = setupPhase
    ? resolveCompanySetupDisplayStatus(setupPhase)
    : selectedFolder
      ? resolveSimpleCompanySetupStatus({
          folderName: selectedFolder.name,
          hasCompanyFolder: true,
          masterSheetId: companyMasterSheetId,
          syncState,
          isProvisioning,
          setupFailed,
          companyUsable,
          backgroundWorkRunning,
          healthCheckRun,
          workspaceHealthOk,
          registryStatus: effectiveRegistryStatus,
        })
      : "Not set up";
  const primarySetupAction = setupPhase ? resolveCompanySetupPrimaryAction(setupPhase) : null;

  useEffect(() => {
    if (!selectedFolder?.id || !setupPhase || !shouldAutoQueueHealthCheck(setupPhase)) {
      return;
    }
    void companyWorkspaceRegistryService.ensureBackgroundHealth(selectedFolder.id).catch(() => {});
  }, [selectedFolder?.id, setupPhase]);
  const setupResultCard =
    companySetupResult ??
    (companyUsable && !visibleSetupError
      ? {
          ok: true as const,
          userMessage: COMPANY_READY_INVITE_MESSAGE,
          warnings: companySetupWarnings,
        }
      : visibleSetupError
        ? {
            ok: false as const,
            userMessage: COMPANY_SETUP_DID_NOT_FINISH_MESSAGE,
            reasonDetail: visibleSetupError.message,
            reason: visibleSetupError.errorCode,
          }
        : null);
  const failureReasonText =
    companySetupResult?.reasonDetail ||
    companySetupResult?.reason?.replace(/_/g, " ") ||
    visibleSetupError?.message ||
    "Setup could not complete.";

  const healthSummary = workspaceValidation
    ? workspaceValidation.ok
      ? "Healthy"
      : "Needs attention"
    : healthCheckRun
      ? "Checked"
      : "Not checked yet";

  const showAreas = canManageAreas(currentUserRole) && selectedFolder && !masterCompanyContextBlocked && companyUsable;
  const showReset =
    currentUserRole === "Master" && selectedFolder && companyMasterSheetId && onCompanyWorkspaceResetSuccess;

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
            {folderStatuses.map(({ folder }) => {
              const selected = selectedFolder?.id === folder.id;
              const masterSheetId = folderMasterSheetId(folder);
              const isSelected = selected;
              const folderRegistryStatus = getCanonicalCompanyStatus({
                status: (folder as CompanyFolder & { registryStatus?: string }).registryStatus,
                registryStatus: (folder as CompanyFolder & { registryStatus?: string }).registryStatus,
              });
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
                    <WorkspaceStatusBadge
                      status={resolveSimpleCompanySetupStatus({
                        folderName: folder.name,
                        hasCompanyFolder: true,
                        masterSheetId: isSelected ? companyMasterSheetId || masterSheetId : masterSheetId,
                        syncState: isSelected ? syncState : undefined,
                        isProvisioning: isSelected && isProvisioning,
                        setupFailed: isSelected && setupFailed,
                        companyUsable: isSelected
                          ? companyUsable
                          : Boolean(masterSheetId),
                        healthCheckRun: isSelected ? healthCheckRun : undefined,
                        workspaceHealthOk: isSelected ? workspaceHealthOk : undefined,
                        registryStatus: isSelected ? effectiveRegistryStatus : folderRegistryStatus,
                      })}
                      displayAsSimple
                    />
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
              title={selectedFolder.name}
              subtitle="Select the company folder, resolve the workbook, then invite users."
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={[
                  "inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  simpleSetupStatusBadgeClass(simpleStatus),
                ].join(" ")}
              >
                {simpleStatus}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {primarySetupAction?.action === "make_usable" ? (
                <button
                  type="button"
                  onClick={() => runMakeUsable?.()}
                  disabled={
                    adminOnly ||
                    !googleWorkspaceReady ||
                    !runMakeUsable ||
                    isProvisioning ||
                    !masterSheetOk
                  }
                  className="inline-flex h-11 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isProvisioning ? "Making usable…" : primarySetupAction.label}
                </button>
              ) : primarySetupAction?.action === "invite_users" ? (
                <button
                  type="button"
                  onClick={() => {
                    document.getElementById("godmode-user-management")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="inline-flex h-11 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"
                >
                  {primarySetupAction.label}
                </button>
              ) : primarySetupAction?.label ? (
                <p className="text-sm font-semibold text-amber-950">{primarySetupAction.label}</p>
              ) : null}
            </div>
            {primarySetupAction?.detail ? (
              <p className="mt-3 text-xs text-slate-600">{primarySetupAction.detail}</p>
            ) : null}
            {simpleStatus === "Working in the background" && !primarySetupAction?.label ? (
              <p className="mt-3 text-xs text-slate-600">{UX_STATUS.workingInBackground}</p>
            ) : null}
            {!companyUsable ? (
              <p className="mt-3 text-xs text-amber-900">
                Select a company folder with a workbook, or run setup to resolve the master sheet.
              </p>
            ) : (
              <p className="mt-3 text-xs text-emerald-900">{COMPANY_READY_INVITE_MESSAGE}</p>
            )}
            {setupResultCard?.ok ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
                <p className="font-semibold">
                  {setupResultCard.userMessage || COMPANY_SETUP_SUCCESS_MESSAGE}
                </p>
                {(setupResultCard.warnings?.length ?? 0) > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-emerald-900">
                    {setupResultCard.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : setupResultCard && !setupResultCard.ok ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
                <p className="font-semibold">{COMPANY_SETUP_DID_NOT_FINISH_MESSAGE}</p>
                <p className="mt-2">Reason: {failureReasonText}</p>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setShowTechnicalDetails((open) => !open)}
              className="mt-4 text-xs font-semibold text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              {showTechnicalDetails ? "Hide advanced diagnostics" : "Advanced diagnostics"}
            </button>
            {showTechnicalDetails ? (
              <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                <div className="space-y-2">
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
                {setupBlockers.length ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-amber-950">
                    {setupBlockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                ) : null}
                {registryUnlinkReason ? (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    Unlink reason: {registryUnlinkReason.replace(/_/g, " ")}
                  </p>
                ) : null}
                {usingFallbackRegistry ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                    <p className="font-semibold">Registry source: fallback JSON file</p>
                    {fallbackRegistryDiagnostic ? (
                      <p className="mt-2 font-mono text-xs text-amber-900">{fallbackRegistryDiagnostic}</p>
                    ) : companySetupResult?.technicalError ? (
                      <p className="mt-2 font-mono text-xs text-amber-900">
                        Using fallback registry because main Companies registry write failed.{" "}
                        {companySetupResult.technicalError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <GodmodeBackgroundJobsPanel
                  companyId={selectedFolder?.id || folderIdInput.trim()}
                  surfaceClass={pilotLightNested}
                />
                {visibleSetupError || companySetupResult?.registryLocation ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
                    {visibleSetupError?.failedStep ? (
                      <p>
                        Failed step:{" "}
                        {COMPANY_SETUP_STEP_LABELS[visibleSetupError.failedStep] ||
                          visibleSetupError.failedStep.replace(/_/g, " ")}
                      </p>
                    ) : null}
                    {visibleSetupError?.technicalError || companySetupResult?.technicalError ? (
                      <p className="mt-2 font-mono text-xs text-rose-800">
                        {visibleSetupError?.technicalError || companySetupResult?.technicalError}
                      </p>
                    ) : null}
                    {companySetupResult?.registrySpreadsheetId ||
                    visibleSetupError?.registrySpreadsheetId ||
                    companySetupResult?.registryLocation ||
                    visibleSetupError?.registryLocation ? (
                      <dl className="mt-3 space-y-1 font-mono text-xs text-rose-900">
                        <div>
                          <dt className="inline font-semibold">Registry spreadsheet: </dt>
                          <dd className="inline break-all">
                            {companySetupResult?.registrySpreadsheetId ||
                              visibleSetupError?.registrySpreadsheetId ||
                              "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline font-semibold">Registry tab: </dt>
                          <dd className="inline">
                            {companySetupResult?.registryTab || visibleSetupError?.registryTab || "Companies"}
                          </dd>
                        </div>
                        {(companySetupResult?.registryLocation || visibleSetupError?.registryLocation) && (
                          <div>
                            <dt className="inline font-semibold">Registry location: </dt>
                            <dd className="inline break-all">
                              {companySetupResult?.registryLocation || visibleSetupError?.registryLocation}
                            </dd>
                          </div>
                        )}
                      </dl>
                    ) : null}
                    {(companySetupResult?.lookupKeys && Object.keys(companySetupResult.lookupKeys).length > 0) ||
                    (visibleSetupError?.lookupKeys && Object.keys(visibleSetupError.lookupKeys).length > 0) ? (
                      <div className="mt-2 font-mono text-xs text-rose-900">
                        <p className="font-semibold">Lookup keys</p>
                        <ul className="mt-1 list-disc pl-4">
                          {Object.entries(companySetupResult?.lookupKeys || visibleSetupError?.lookupKeys || {})
                            .filter(([, value]) => String(value || "").trim())
                            .map(([key, value]) => (
                              <li key={key}>
                                {key}: {value}
                              </li>
                            ))}
                        </ul>
                      </div>
                    ) : null}
                    {(companySetupResult?.missingColumns?.length || visibleSetupError?.missingColumns?.length) ? (
                      <p className="mt-2 font-mono text-xs text-rose-900">
                        Missing columns:{" "}
                        {(companySetupResult?.missingColumns || visibleSetupError?.missingColumns || []).join(", ")}
                      </p>
                    ) : null}
                    {companySetupResult?.verifyReadback || visibleSetupError?.verifyReadback ? (
                      <p className="mt-2 font-mono text-xs text-rose-900">
                        Verify readback: status=
                        {companySetupResult?.verifyReadback?.status ||
                          visibleSetupError?.verifyReadback?.status ||
                          "unknown"}
                        {companySetupResult?.verifyReadback?.masterSheetId ||
                        visibleSetupError?.verifyReadback?.masterSheetId
                          ? `, masterSheetId=${companySetupResult?.verifyReadback?.masterSheetId || visibleSetupError?.verifyReadback?.masterSheetId}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {registryActionError ? <p className="text-xs text-rose-800">{registryActionError}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {registryLinkMissing ? (
                    <button
                      type="button"
                      onClick={() => void relinkCompanyRegistry()}
                      disabled={adminOnly || !googleWorkspaceReady || registryRelinking}
                      className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {registryRelinking ? "Relinking registry…" : "Create / relink company registry record"}
                    </button>
                  ) : null}
                  {showForceLiveFromReadyChecks ? (
                    <button
                      type="button"
                      onClick={() => void forceMarkLiveFromReadyChecks()}
                      disabled={adminOnly || !googleWorkspaceReady || registryForceLiveLoading}
                      className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {registryForceLiveLoading ? "Marking Live…" : "Force mark LIVE from ready checks"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onValidateWorkspace}
                    disabled={masterCompanyContextBlocked || workspaceValidationLoading}
                    className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {workspaceValidationLoading ? "Checking…" : "Re-check workspace"}
                  </button>
                  {onRepairCompanyFolderStructure ? (
                    <button
                      type="button"
                      onClick={onRepairCompanyFolderStructure}
                      disabled={masterCompanyContextBlocked || companyFolderStructureRepairing}
                      className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {companyFolderStructureRepairing ? "Repairing…" : "Repair folder structure"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onRepairWorkspace}
                    disabled={masterCompanyContextBlocked}
                    className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
                  >
                    Fix workspace
                  </button>
                  <button
                    type="button"
                    onClick={() => void repairUsersTab()}
                    disabled={masterCompanyContextBlocked || usersTabRepairing || !resolvedMasterSheetId}
                    className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {usersTabRepairing ? "Repairing Users tab…" : "Repair Users tab"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void rebuildUsersFromSheet()}
                    disabled={masterCompanyContextBlocked || usersCacheRebuilding || !resolvedMasterSheetId}
                    className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {usersCacheRebuilding ? "Rebuilding users…" : "Rebuild users from sheet"}
                  </button>
                  <a
                    href={`https://drive.google.com/drive/folders/${selectedFolder.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
                  >
                    Open Drive folder
                  </a>
                  {companyMasterSheetId ? (
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${companyMasterSheetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
                    >
                      Open master sheet
                    </a>
                  ) : null}
                </div>
                {usersTabRepairMessage ? (
                  <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                    {usersTabRepairMessage}
                  </p>
                ) : null}
                {usersCacheRebuildMessage ? (
                  <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                    {usersCacheRebuildMessage}
                  </p>
                ) : null}
                {inviteTargetDiagnostic ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
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
                <dl className="space-y-2 text-xs text-slate-600">
                  <div>
                    <dt className="font-semibold text-slate-500">Company ID</dt>
                    <dd className="mt-0.5 break-all font-mono text-slate-800">{selectedFolder.id}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">Registry status</dt>
                    <dd className="mt-0.5 font-mono text-slate-800">
                      {registryStatusDisplay}
                      {usingFallbackRegistry ? " (fallback registry)" : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">Master sheet ID</dt>
                    <dd className="mt-0.5 break-all font-mono text-slate-800">{companyMasterSheetId || "Not linked"}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </section>

          <section className={pilotLightSurface}>
            <SectionHeader
              icon="shield"
              eyebrow="Overview"
              title="Workspace overview"
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
              <MiniMetric label="Last readiness check" value={healthSummary} />
            </dl>
            {setupFailed && folderInspection?.blockingItems.length ? (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {folderInspection.blockingItems.join(" • ")}
              </p>
            ) : null}
            <p className="mt-4 text-xs text-slate-600">
              Background checks and repair actions are in Advanced diagnostics above — they do not block invites.
            </p>
          </section>

          {userManagement ? (
            <section id="godmode-user-management" className={pilotLightSurface}>
              <SectionHeader
                icon="user"
                eyebrow="People"
                title="User management"
                subtitle="Invite users by email. They complete name and password from the link."
              />
              {!canShowUserInvites ? (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  Make the company usable first — select a folder and resolve the workbook, then invite users.
                </p>
              ) : (
                <div className="mt-4">
                  <GodmodeUserManagementSection
                    {...userManagement}
                    pilotLightNested={pilotLightNested}
                  />
                </div>
              )}
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
