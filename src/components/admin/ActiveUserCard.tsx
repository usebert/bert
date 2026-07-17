import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "../../permissions";
import { translateRoleLabel } from "../../i18n/statusLabels";
import { getEditableCompanyMemberRoles } from "../../permissions";
import type { CompanyMember } from "../../services/companyUserService";
import type { StructureEntity } from "../../services/companyStructureService";
import {
  createCompanyDepartment,
  createCompanySite,
  createCompanyStructureArea,
  updatePersonAccess,
} from "../../services/companyStructureService";
import { DangerActionButton } from "../DangerActionButton";
import { ArchiveRecordButton } from "../archive/ArchiveRecordButton";
import { formatInviteStatusLabel } from "../../utils/inviteStatusDisplay";
import {
  accessScopeFromPersonRecord,
  canEditPersonAccess,
  formatAccessSummary,
  type AccessScope,
} from "../../utils/companyStructureAccess";

export type ActiveUserCardProps = {
  member: CompanyMember;
  currentUserRole: Role;
  currentUserEmail?: string;
  companyFolderId?: string;
  masterSheetId?: string;
  structureCatalog?: {
    sites: StructureEntity[];
    departments: StructureEntity[];
    areas: StructureEntity[];
  };
  onEdit: (member: CompanyMember, input: { name: string; role: string }) => void | Promise<void>;
  onDeactivate: (member: CompanyMember) => void | Promise<void>;
  canArchive?: boolean;
  archiveCompanyFolderId?: string;
  archiveMasterSheetId?: string;
  archiveOffline?: boolean;
  onArchivedUser?: (member: CompanyMember) => void | Promise<void>;
  onArchiveError?: (message: string) => void;
  onArchiveSuccess?: () => void;
  onRemove?: (member: CompanyMember) => void | Promise<void>;
  onAccessUpdated?: (member: CompanyMember) => void | Promise<void>;
  editing?: boolean;
  slatePrimaryCtaInteract: string;
};

function formatMemberStatus(t: ReturnType<typeof useTranslation>["t"], status: string): string {
  const normalized = String(status || "ACTIVE").trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return t("people.active");
  }
  if (normalized === "INACTIVE") {
    return t("people.inactive");
  }
  if (normalized === "PENDING") {
    return t("people.pending");
  }
  return formatInviteStatusLabel(status);
}

function ScopeMultiSelect({
  label,
  allLabel,
  allSelected,
  options,
  selectedIds,
  onToggleAll,
  onToggleId,
  onAddNew,
  addNewLabel,
}: {
  label: string;
  allLabel: string;
  allSelected: boolean;
  options: StructureEntity[];
  selectedIds: string[];
  onToggleAll: () => void;
  onToggleId: (id: string) => void;
  onAddNew?: () => void;
  addNewLabel: string;
}) {
  const activeOptions = options.filter((item) => item.active !== false && item.status !== "inactive");
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onToggleAll}
          className={`h-10 rounded-xl border px-3 text-sm font-semibold ${
            allSelected
              ? "border-sky-200 bg-sky-50 text-sky-900"
              : "border-slate-200 bg-white text-slate-700"
          }`}
        >
          {allLabel}
        </button>
        {activeOptions.map((option) => {
          const selected = !allSelected && selectedIds.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onToggleId(option.id)}
              className={`h-10 rounded-xl border px-3 text-sm font-semibold ${
                selected
                  ? "border-sky-200 bg-sky-50 text-sky-900"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {option.name}
            </button>
          );
        })}
        {onAddNew ? (
          <button
            type="button"
            onClick={onAddNew}
            className="h-10 rounded-xl border border-dashed border-orange-300 bg-orange-50 px-3 text-sm font-semibold text-orange-800"
          >
            {addNewLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ActiveUserCard({
  member,
  currentUserRole,
  currentUserEmail,
  companyFolderId = "",
  masterSheetId = "",
  structureCatalog,
  onEdit,
  onDeactivate,
  canArchive = false,
  archiveCompanyFolderId = "",
  archiveMasterSheetId,
  archiveOffline = false,
  onArchivedUser,
  onArchiveError,
  onArchiveSuccess,
  onRemove,
  onAccessUpdated,
  editing = false,
  slatePrimaryCtaInteract,
}: ActiveUserCardProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [draftName, setDraftName] = useState(member.name);
  const [draftRole, setDraftRole] = useState(member.role);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [draftAccess, setDraftAccess] = useState<AccessScope>(() =>
    accessScopeFromPersonRecord(member as unknown as Record<string, unknown>),
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const editableRoles = getEditableCompanyMemberRoles(currentUserRole);
  const canManage = editableRoles.length > 0;
  const canEditAccess = canEditPersonAccess(currentUserRole);
  const isSelf = Boolean(currentUserEmail && member.email.toLowerCase() === currentUserEmail.toLowerCase());

  const catalogs = useMemo(
    () => ({
      sites: structureCatalog?.sites || [],
      departments: structureCatalog?.departments || [],
      areas: structureCatalog?.areas || [],
    }),
    [structureCatalog],
  );

  const accessSummary = useMemo(() => {
    const scope = accessScopeFromPersonRecord(member as unknown as Record<string, unknown>);
    return formatAccessSummary(scope, catalogs);
  }, [member, catalogs]);

  useEffect(() => {
    setDraftName(member.name);
    setDraftRole(member.role);
    setDraftAccess(accessScopeFromPersonRecord(member as unknown as Record<string, unknown>));
  }, [member]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  const saveEdit = async () => {
    const name = draftName.trim();
    if (!name) {
      return;
    }
    await onEdit(member, { name, role: draftRole });
    setEditOpen(false);
    setMenuOpen(false);
  };

  const saveAccess = async () => {
    if (!companyFolderId || !masterSheetId) {
      setAccessError("Company workspace is required to save access.");
      return;
    }
    setAccessSaving(true);
    setAccessError(null);
    try {
      const result = await updatePersonAccess(companyFolderId, member.email, {
        masterSheetId,
        allSites: draftAccess.allSites,
        allDepartments: draftAccess.allDepartments,
        allAreas: draftAccess.allAreas,
        siteIds: draftAccess.allSites ? [] : draftAccess.siteIds,
        departmentIds: draftAccess.allDepartments ? [] : draftAccess.departmentIds,
        areaIds: draftAccess.allAreas ? [] : draftAccess.areaIds,
      });
      if (!result.ok) {
        setAccessError(result.error || "Could not update access.");
        return;
      }
      setAccessOpen(false);
      if (result.user && onAccessUpdated) {
        await onAccessUpdated({
          ...member,
          ...result.user,
          companyAreas: result.user.companyAreas || [],
          siteIds: result.user.siteIds || [],
          departmentIds: result.user.departmentIds || [],
          areaIds: result.user.areaIds || [],
        } as CompanyMember);
      } else if (onAccessUpdated) {
        await onAccessUpdated(member);
      }
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Could not update access.");
    } finally {
      setAccessSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{member.name || member.email}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{member.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              {translateRoleLabel(t, member.role)}
            </span>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              {formatMemberStatus(t, member.status)}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-600">{t("people.access")}:</span>{" "}
            {accessSummary.replace(/^Access:\s*/, "")}
          </p>
          {canEditAccess ? (
            <button
              type="button"
              onClick={() => {
                setDraftAccess(accessScopeFromPersonRecord(member as unknown as Record<string, unknown>));
                setAccessOpen((open) => !open);
                setAccessError(null);
              }}
              className="mt-2 h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
            >
              {accessOpen ? t("people.closeAccess") : t("people.editAccess")}
            </button>
          ) : null}
        </div>
        {canManage ? (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              aria-label="User actions"
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg font-semibold text-slate-700"
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setEditOpen(true);
                    setMenuOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  {t("people.editUser")}
                </button>
                {!isSelf && canArchive && archiveCompanyFolderId ? (
                  <div className="px-3 py-2">
                    <ArchiveRecordButton
                      recordType="user"
                      recordId={member.email}
                      companyFolderId={archiveCompanyFolderId}
                      masterSheetId={archiveMasterSheetId}
                      offlineMode={archiveOffline}
                      canArchive={canArchive}
                      label={t("people.archiveUser")}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
                      extraMessage="The user can be reactivated from Archive if needed."
                      onArchived={() => onArchivedUser?.(member)}
                      onError={onArchiveError}
                      onSuccess={onArchiveSuccess}
                    />
                  </div>
                ) : null}
                {!isSelf ? (
                  <button
                    type="button"
                    onClick={async () => {
                      setMenuOpen(false);
                      await onDeactivate(member);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm font-medium text-amber-900 hover:bg-amber-50"
                  >
                    {t("people.deactivate")}
                  </button>
                ) : null}
                {!isSelf && onRemove ? (
                  <DangerActionButton
                    type="button"
                    onClick={async () => {
                      setMenuOpen(false);
                      await onRemove(member);
                    }}
                    className="block w-full rounded-none border-0 px-3 py-2 text-left text-sm font-medium"
                  >
                    {t("people.removeUser")}
                  </DangerActionButton>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {accessOpen ? (
        <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-white p-3">
          <ScopeMultiSelect
            label={t("people.siteAccess")}
            allLabel={t("common.allSites")}
            allSelected={draftAccess.allSites}
            options={catalogs.sites}
            selectedIds={draftAccess.siteIds}
            addNewLabel={t("people.addNewSite")}
            onToggleAll={() =>
              setDraftAccess((prev) => ({ ...prev, allSites: true, siteIds: [] }))
            }
            onToggleId={(id) =>
              setDraftAccess((prev) => {
                const nextIds = prev.siteIds.includes(id)
                  ? prev.siteIds.filter((entry) => entry !== id)
                  : [...prev.siteIds, id];
                return { ...prev, allSites: nextIds.length === 0, siteIds: nextIds };
              })
            }
            onAddNew={() => {
              const name = window.prompt("New site name");
              if (!name?.trim() || !companyFolderId) {
                return;
              }
              void createCompanySite(companyFolderId, {
                name: name.trim(),
                masterSheetId,
              }).then(async (created) => {
                if (created.site) {
                  setDraftAccess((prev) => ({
                    ...prev,
                    allSites: false,
                    siteIds: [...prev.siteIds.filter((id) => id !== created.site!.id), created.site!.id],
                  }));
                  if (onAccessUpdated) {
                    await onAccessUpdated(member);
                  }
                }
              });
            }}
          />
          <ScopeMultiSelect
            label={t("people.departmentAccess")}
            allLabel={t("people.allDepartments")}
            allSelected={draftAccess.allDepartments}
            options={catalogs.departments}
            selectedIds={draftAccess.departmentIds}
            addNewLabel={t("people.addNewDepartment")}
            onToggleAll={() =>
              setDraftAccess((prev) => ({ ...prev, allDepartments: true, departmentIds: [] }))
            }
            onToggleId={(id) =>
              setDraftAccess((prev) => {
                const nextIds = prev.departmentIds.includes(id)
                  ? prev.departmentIds.filter((entry) => entry !== id)
                  : [...prev.departmentIds, id];
                return { ...prev, allDepartments: nextIds.length === 0, departmentIds: nextIds };
              })
            }
            onAddNew={() => {
              const name = window.prompt("New department name");
              if (!name?.trim() || !companyFolderId) {
                return;
              }
              void createCompanyDepartment(companyFolderId, {
                name: name.trim(),
                masterSheetId,
              }).then(async (created) => {
                if (created.department) {
                  setDraftAccess((prev) => ({
                    ...prev,
                    allDepartments: false,
                    departmentIds: [
                      ...prev.departmentIds.filter((id) => id !== created.department!.id),
                      created.department!.id,
                    ],
                  }));
                  if (onAccessUpdated) {
                    await onAccessUpdated(member);
                  }
                }
              });
            }}
          />
          <ScopeMultiSelect
            label={t("sites.areaAccess")}
            allLabel={t("common.allAreas")}
            allSelected={draftAccess.allAreas}
            options={catalogs.areas}
            selectedIds={draftAccess.areaIds}
            addNewLabel={t("people.addNewArea")}
            onToggleAll={() =>
              setDraftAccess((prev) => ({ ...prev, allAreas: true, areaIds: [] }))
            }
            onToggleId={(id) =>
              setDraftAccess((prev) => {
                const nextIds = prev.areaIds.includes(id)
                  ? prev.areaIds.filter((entry) => entry !== id)
                  : [...prev.areaIds, id];
                return { ...prev, allAreas: nextIds.length === 0, areaIds: nextIds };
              })
            }
            onAddNew={() => {
              const name = window.prompt("New area name");
              if (!name?.trim() || !companyFolderId) {
                return;
              }
              void createCompanyStructureArea(companyFolderId, {
                name: name.trim(),
                masterSheetId,
              }).then(async (created) => {
                if (created.area) {
                  setDraftAccess((prev) => ({
                    ...prev,
                    allAreas: false,
                    areaIds: [...prev.areaIds.filter((id) => id !== created.area!.id), created.area!.id],
                  }));
                  if (onAccessUpdated) {
                    await onAccessUpdated(member);
                  }
                }
              });
            }}
          />
          {accessError ? <p className="text-sm text-rose-700">{accessError}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={accessSaving}
              onClick={() => void saveAccess()}
              className={`h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60 ${slatePrimaryCtaInteract}`}
            >
              {accessSaving ? t("common.saving") : t("people.saveAccess")}
            </button>
            <button
              type="button"
              onClick={() => setAccessOpen(false)}
              className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("people.displayName")}</span>
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900"
            />
          </label>
          <label className="mt-3 block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("people.role")}</span>
            <select
              value={draftRole}
              onChange={(event) => setDraftRole(event.target.value)}
              disabled={isSelf}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 disabled:opacity-60"
            >
              {editableRoles.map((role) => (
                <option key={role} value={role}>
                  {translateRoleLabel(t, role)}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={editing || !draftName.trim()}
              onClick={() => void saveEdit()}
              className={`h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60 ${slatePrimaryCtaInteract}`}
            >
              {editing ? t("common.saving") : t("templates.saveChanges")}
            </button>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
