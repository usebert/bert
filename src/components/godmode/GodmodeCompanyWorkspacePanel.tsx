import { useMemo, useState } from "react";
import type { Role } from "../../permissions";
import { canManageAreas } from "../../permissions";
import { AreaAuditsSection } from "../admin/AreaAuditsSection";
import { CompanyWorkspaceResetPanel } from "../admin/CompanyWorkspaceResetPanel";
import { SitesAreasPanel } from "../admin/SitesAreasPanel";
import { EmptyPanel, MiniMetric, SectionHeader } from "../dashboard/DashboardPrimitives";
import { SECTION_INTROS } from "../../config/sectionIntros";
import { GodmodeCollapsibleSection } from "./GodmodeCollapsibleSection";
import { resolveCompanyWorkspaceStatus, WorkspaceStatusBadge } from "./WorkspaceStatusBadge";
import type { Site, UserInvite, FolderInspection } from "../../types/adminScreenProps";
import type { AreaAuditMapping } from "../../utils/areaAuditMapping";
import type { AuditTemplate } from "../../types/reportsScreenProps";
import type { CompanyFolder, CompanySheetSyncStatus, WorkspaceValidation } from "../../types/dashboardScreenProps";

const pilotLightSurface = "rounded-3xl border border-slate-200/90 bg-white p-4 shadow-sm";
const pilotLightNested = "rounded-2xl border border-slate-200 bg-slate-50 p-4";

function folderMasterSheetId(folder: CompanyFolder): string {
  const extended = folder as CompanyFolder & { masterSheetId?: string };
  return extended.masterSheetId || extended.responseSheetId || "";
}

function SetupChecklistRow({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
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
        {ok ? "Ready" : "Needs work"}
      </span>
    </div>
  );
}

function FolderCheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
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
  companyMasterSheetProvisioning: boolean;
  folderIdInput: string;
  masterSheetInput: string;
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
  slatePrimaryCtaInteract: string;
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
  companyMasterSheetProvisioning,
  folderIdInput,
  masterSheetInput,
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
  slatePrimaryCtaInteract,
}: GodmodeCompanyWorkspacePanelProps) {
  const workspaceSetupComplete = syncState === "Synced" && Boolean(selectedFolder);
  const isProvisioning = companyFolderStructureRepairing || companyMasterSheetProvisioning;
  const setupFailed = Boolean(folderInspection?.error) || (workspaceValidation != null && !workspaceValidation.ok && (workspaceValidation.missingTabs?.length ?? 0) > 0);

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
        });
        return { folder, status, masterSheetId: isSelected ? companyMasterSheetId || masterSheetId : masterSheetId };
      }),
    [folders, selectedFolder?.id, companyMasterSheetId, syncState, isProvisioning, setupFailed],
  );

  const selectedStatus = useMemo(() => {
    if (!selectedFolder) return null;
    const row = folderStatuses.find((item) => item.folder.id === selectedFolder.id);
    return row?.status ?? "Draft";
  }, [selectedFolder, folderStatuses]);

  const hasActiveAdmin = useMemo(
    () => invitedUsers.some((invite) => invite.role === "Admin" && (invite.status === "Active" || invite.loginReady)),
    [invitedUsers],
  );

  const firstAdminReady = hasActiveAdmin || (companySheetSync?.usersCount ?? 0) > 0;

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

  const masterSheetOk = Boolean(companyMasterSheetId || folderInspection?.checks.masterSheet);
  const requiredTabsOk =
    workspaceValidation?.ok ??
    (folderInspection?.masterSheet?.tabs.length ? folderInspection.blockingItems.length === 0 : false);
  const companyFoldersMappingOk = workspaceValidation?.folders.companyFolder ?? Boolean(selectedFolder);
  const liveStatusOk = syncState === "Synced" && masterSheetOk;

  const workspaceSetupButtonLabel = !googleWorkspaceReady
    ? "Connect Google first"
    : folderInspectionLoading
      ? "Checking links…"
      : syncState === "Synced"
        ? "Populate app again"
        : "Run workspace setup";

  const showAreas = canManageAreas(currentUserRole) && selectedFolder && !masterCompanyContextBlocked;
  const showReset =
    currentUserRole === "Master" && selectedFolder && companyMasterSheetId && onCompanyWorkspaceResetSuccess;

  return (
    <div className="space-y-4">
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
            {folderStatuses.map(({ folder, status }) => {
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
                      {selected ? (
                        <p className="mt-0.5 text-xs font-medium text-orange-800">Selected company</p>
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
              eyebrow="Overview"
              title={selectedFolder.name}
              subtitle="Compact snapshot of this company workspace."
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {selectedStatus ? <WorkspaceStatusBadge status={selectedStatus} /> : null}
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <MiniMetric label="Company folder" value={selectedFolder.name} />
              <MiniMetric
                label="Folder status"
                value={folderStructureOk ? "Structure ready" : "Needs folders"}
              />
              <MiniMetric label="Master sheet" value={masterSheetOk ? "Linked" : "Not linked"} />
              <MiniMetric label="Setup status" value={workspaceSetupComplete ? "Complete" : "Incomplete"} />
              <MiniMetric label="Live status" value={liveStatusOk ? "Live in app" : "Not live"} />
              <MiniMetric label="First admin" value={firstAdminReady ? "Ready" : "Pending onboarding"} />
            </dl>
          </section>

          <section className={pilotLightSurface}>
            <SectionHeader
              icon="sync"
              eyebrow="Setup"
              title="Workspace setup"
              subtitle="One-time linking, checks, and populate for this company."
            />
            <div className="mt-4 space-y-2">
              <SetupChecklistRow label="Company folder" ok={Boolean(selectedFolder)} />
              <SetupChecklistRow label="Folder structure" ok={folderStructureOk} hint="ISO 01–06 folders under the company root" />
              <SetupChecklistRow label="Company master sheet" ok={masterSheetOk} />
              <SetupChecklistRow
                label="Required tabs"
                ok={Boolean(requiredTabsOk)}
                hint={workspaceValidation?.missingTabs.length ? `${workspaceValidation.missingTabs.length} tab(s) missing` : undefined}
              />
              <SetupChecklistRow label="CompanyFolders mapping" ok={companyFoldersMappingOk} />
              <SetupChecklistRow label="First admin / onboarding" ok={firstAdminReady} />
              <SetupChecklistRow label="Live status" ok={liveStatusOk} />
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace setup status</p>
              {workspaceSetupComplete ? (
                <p className="mt-2 text-sm font-semibold text-emerald-800">
                  Workspace setup complete — manage users from Users &amp; Invites.
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-700">
                  Finish Google Drive linking and populate from this card or Company Onboarding before inviting field users.
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onOneClickGoogleOnboarding}
                disabled={adminOnly || !googleWorkspaceReady || folderInspectionLoading}
                className="inline-flex h-11 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isProvisioning ? "Running setup…" : workspaceSetupButtonLabel}
              </button>
              <button
                type="button"
                onClick={onRepairWorkspace}
                disabled={!masterSheetOk}
                title={!masterSheetOk ? "Link a master sheet before repairing the workspace." : undefined}
                className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Repair workspace setup
              </button>
              {selectedFolder ? (
                <a
                  href={`https://drive.google.com/drive/folders/${selectedFolder.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
                >
                  Open company folder
                </a>
              ) : null}
              {companyMasterSheetId ? (
                <a
                  href={`https://docs.google.com/spreadsheets/d/${companyMasterSheetId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
                >
                  Open company master sheet
                </a>
              ) : null}
            </div>
          </section>

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
            summary="Diagnostics, raw IDs, and sync/repair utilities for this workspace."
            defaultOpen={false}
            openLabel="Show advanced tools"
            closeLabel="Hide advanced tools"
            surfaceClass={pilotLightSurface}
          >
            <div className="space-y-4">
              {(folderInspection || selectedFolder) ? (
                <div className={pilotLightNested}>
                  <p className="text-sm font-semibold text-slate-900">Advanced setup diagnostics</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {folderInspection
                      ? `Checked ${folderInspection.folder.name}`
                      : `Waiting to check ${selectedFolder?.name ?? "company folder"}`}
                  </p>
                  {folderInspection ? (
                    <>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <FolderCheckRow label="Company Master Sheet" ok={folderInspection.checks.masterSheet} />
                        <FolderCheckRow label="Audit forms folder" ok={folderInspection.checks.auditFormsFolder} />
                        <FolderCheckRow label="01 Company Setup folder" ok={folderInspection.checks.setupFolder} />
                        <FolderCheckRow label="03 Company Records folder" ok={folderInspection.checks.recordsFolder} />
                        <FolderCheckRow label="Evidence folder" ok={folderInspection.checks.evidenceFolder} />
                        <FolderCheckRow label="Exports folder" ok={folderInspection.checks.exportsFolder} />
                        <FolderCheckRow label="06 Management Notes folder" ok={folderInspection.checks.managementNotesFolder} />
                      </div>
                      {folderInspection.blockingItems.length > 0 ? (
                        <p className="mt-3 text-sm text-amber-800">{folderInspection.blockingItems.join(" • ")}</p>
                      ) : null}
                      {folderInspection.recommendedItems.length > 0 ? (
                        <p className="mt-2 text-xs text-slate-600">{folderInspection.recommendedItems.join(" • ")}</p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}

              <div className={pilotLightNested}>
                <p className="text-sm font-semibold text-slate-900">Raw folder / sheet IDs</p>
                <dl className="mt-2 space-y-2 text-xs text-slate-600">
                  <div>
                    <dt className="font-semibold text-slate-500">Company folder ID</dt>
                    <dd className="mt-0.5 break-all font-mono text-slate-800">{selectedFolder.id}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">Master sheet ID</dt>
                    <dd className="mt-0.5 break-all font-mono text-slate-800">{companyMasterSheetId || "Not linked"}</dd>
                  </div>
                  {folderIdInput.trim() && folderIdInput.trim() !== selectedFolder.id ? (
                    <div>
                      <dt className="font-semibold text-slate-500">Folder input</dt>
                      <dd className="mt-0.5 break-all font-mono text-slate-800">{folderIdInput.trim()}</dd>
                    </div>
                  ) : null}
                  {masterSheetInput.trim() ? (
                    <div>
                      <dt className="font-semibold text-slate-500">Master sheet input</dt>
                      <dd className="mt-0.5 break-all font-mono text-slate-800">{masterSheetInput.trim()}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              {workspaceValidation ? (
                <div className={pilotLightNested}>
                  <p className="text-sm font-semibold text-slate-900">Workspace validation</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Schema on sheet: {workspaceValidation.schemaVersion || "none"} • app expects{" "}
                    {workspaceValidation.currentSchemaVersion}
                  </p>
                  {(workspaceValidation.repairableIssues?.length ?? 0) > 0 && !workspaceValidation.ok ? (
                    <p className="mt-2 text-sm text-amber-800">{workspaceValidation.repairableIssues?.join(" • ")}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onValidateWorkspace}
                  disabled={masterCompanyContextBlocked}
                  title={masterCompanyContextBlocked ? masterCompanyContextMessage : undefined}
                  className={`h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${slatePrimaryCtaInteract}`}
                >
                  {workspaceValidationLoading ? "Checking…" : "Check workspace"}
                </button>
                <button
                  type="button"
                  onClick={onRepairWorkspace}
                  disabled={masterCompanyContextBlocked}
                  className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Fix workspace
                </button>
                {onRepairCompanyFolderStructure ? (
                  <button
                    type="button"
                    onClick={onRepairCompanyFolderStructure}
                    disabled={masterCompanyContextBlocked || companyFolderStructureRepairing}
                    className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {companyFolderStructureRepairing ? "Repairing folders…" : "Repair company folder structure"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onSyncForms}
                  disabled={adminOnly || !googleWorkspaceReady || !selectedFolder || folderInspectionLoading}
                  className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {folderInspectionLoading ? "Checking…" : syncState === "Synced" ? "Populate app again" : "Populate app"}
                </button>
              </div>
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
