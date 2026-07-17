import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "../../permissions";
import { translateRoleLabel } from "../../i18n/statusLabels";
import { canManageAreas } from "../../permissions";
import { SectionHeader } from "../dashboard/DashboardPrimitives";
import {
  activeAreas,
  areaAssignmentHelpText,
  isSingleWorkspaceMode,
  shouldShowAreaAssignment,
} from "../../utils/companyAreas";
import type { Site, UserSiteAssignments } from "../../types/adminScreenProps";
import type { CompanyReportUser } from "../../types/reports";

type SitesAreasPanelProps = {
  currentUserRole: Role;
  sites: Site[];
  areaRestrictionsEnabled: boolean;
  areaSyncLoading?: boolean;
  areaSyncError?: string | null;
  googleConnected: boolean;
  selectedSiteId?: string;
  userSiteAssignments?: UserSiteAssignments;
  reportUsers?: CompanyReportUser[];
  showSiteContext?: boolean;
  showUserAssignment?: boolean;
  variant?: "light" | "dark";
  surfaceClass?: string;
  nestedClass?: string;
  onEnableAreaRestrictions?: () => void;
  onDisableAreaRestrictions?: () => void;
  onAddArea?: () => void;
  onRenameArea?: (siteId: string, currentName: string) => void;
  onArchiveArea?: (siteId: string) => void;
  onReactivateArea?: (siteId: string) => void;
  onSelectSite?: (siteId: string) => void;
  onToggleUserSiteAssignment?: (email: string, siteId: string) => void;
};

export function SitesAreasPanel({
  currentUserRole,
  sites,
  areaRestrictionsEnabled,
  areaSyncLoading = false,
  areaSyncError = null,
  googleConnected,
  selectedSiteId = "",
  userSiteAssignments = {},
  reportUsers = [],
  showSiteContext = false,
  showUserAssignment = false,
  variant = "light",
  surfaceClass = "",
  nestedClass = "",
  onEnableAreaRestrictions,
  onDisableAreaRestrictions,
  onAddArea,
  onRenameArea,
  onArchiveArea,
  onReactivateArea,
  onSelectSite,
  onToggleUserSiteAssignment,
}: SitesAreasPanelProps) {
  const { t } = useTranslation();
  const manage = canManageAreas(currentUserRole);
  const [manageAccessOpen, setManageAccessOpen] = useState(false);
  const active = useMemo(() => activeAreas(sites), [sites]);
  const singleWorkspace = isSingleWorkspaceMode(areaRestrictionsEnabled, sites);
  const showAssignment =
    manageAccessOpen && showUserAssignment && shouldShowAreaAssignment(areaRestrictionsEnabled, sites);

  const isDark = variant === "dark";
  const chipBase = isDark
    ? "rounded-full border px-3 py-1.5 text-sm font-semibold transition"
    : "rounded-full border px-3 py-1.5 text-sm font-semibold transition";
  const chipIdle = isDark
    ? "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600"
    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300";
  const chipActive = isDark
    ? "border-[var(--bert-signal-orange)] bg-[rgba(249,115,22,0.14)] text-white"
    : "border-sky-200 bg-sky-50 text-sky-900";

  if (!manage && !showAssignment && !showSiteContext) {
    return null;
  }

  return (
    <section className={surfaceClass}>
      <SectionHeader
        icon="grid"
        eyebrow={t("sites.sitesAndAreasEyebrow")}
        title={manage ? t("sites.areas") : t("sites.areaAccess")}
        subtitle={
          singleWorkspace
            ? "Everyone can access this workspace."
            : "People only see work for areas they are assigned to."
        }
        tone={isDark ? "onDark" : "onLight"}
      />

      {areaSyncError ? (
        <p className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${isDark ? "border-amber-500/40 bg-amber-950/30 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          {areaSyncError}
          {!googleConnected ? " Connect Google Workspace to sync areas to the company master sheet." : ""}
        </p>
      ) : null}

      {areaSyncLoading ? (
        <p className={`mt-3 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>{t("sites.syncingAreas")}</p>
      ) : null}

      <div className={`mt-4 space-y-4 ${nestedClass}`}>
        {manage ? (
          <div className={`rounded-2xl border p-4 ${isDark ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
            <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {t("sites.restrictionMode")}
            </p>
            {singleWorkspace ? (
              <p className={`mt-2 text-sm leading-6 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                Everyone can access this workspace. Add areas when you want to split by site, then turn on restrictions to
                limit who sees what.
              </p>
            ) : (
              <p className={`mt-2 text-sm leading-6 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                Area restrictions are on. Use Manage access to choose which areas each person can use.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {!areaRestrictionsEnabled ? (
                <button
                  type="button"
                  onClick={onEnableAreaRestrictions}
                  className={`h-11 rounded-xl px-5 text-sm font-semibold ${isDark ? "bg-orange-500 text-slate-950" : "bg-orange-500 text-white hover:bg-orange-600"}`}
                >
                  {t("sites.enableAreaRestrictions")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onAddArea}
                  className={`h-11 rounded-xl px-5 text-sm font-semibold ${isDark ? "bg-orange-500 text-slate-950" : "bg-orange-500 text-white hover:bg-orange-600"}`}
                >
                  {t("sites.addArea")}
                </button>
              )}
              {areaRestrictionsEnabled ? (
                <button
                  type="button"
                  onClick={onDisableAreaRestrictions}
                  className={`h-11 rounded-xl border px-4 text-sm font-semibold ${isDark ? "border-slate-700 text-slate-200" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  {t("sites.turnOffRestrictions")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onAddArea}
                  className={`h-11 rounded-xl border px-4 text-sm font-semibold ${isDark ? "border-slate-600 text-slate-200" : "border-slate-300 bg-white text-slate-800"}`}
                >
                  {t("sites.addArea")}
                </button>
              )}
              {shouldShowAreaAssignment(areaRestrictionsEnabled, sites) ? (
                <button
                  type="button"
                  onClick={() => setManageAccessOpen((open) => !open)}
                  className={`h-11 rounded-xl border px-4 text-sm font-semibold ${isDark ? "border-slate-600 text-slate-200" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  {manageAccessOpen ? t("sites.hideAccess") : t("sites.manageAccess")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {manage || showSiteContext ? (
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {showSiteContext ? t("sites.companySiteContext") : t("sites.activeAreas")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {showSiteContext && onSelectSite ? (
                <button
                  type="button"
                  onClick={() => onSelectSite("")}
                  className={[chipBase, selectedSiteId === "" ? chipActive : chipIdle].join(" ")}
                >
                  {t("sites.allSites")}
                </button>
              ) : null}
              {active.map((site) =>
                showSiteContext && onSelectSite ? (
                  <span key={site.id} className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onSelectSite(site.id)}
                      className={[chipBase, selectedSiteId === site.id ? chipActive : chipIdle].join(" ")}
                    >
                      {site.name}
                    </button>
                    {manage && onArchiveArea ? (
                      <button
                        type="button"
                        onClick={() => onArchiveArea(site.id)}
                        className="rounded-full px-1.5 text-xs font-semibold text-slate-400 hover:text-rose-600"
                        title={t("sites.archiveAreaTitle")}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                ) : (
                  <span
                    key={site.id}
                    className={[chipBase, chipIdle, "inline-flex items-center gap-2"].join(" ")}
                  >
                    {site.name}
                    {manage && onRenameArea ? (
                      <button
                        type="button"
                        onClick={() => onRenameArea(site.id, site.name)}
                        className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-700"
                      >
                        {t("sites.rename")}
                      </button>
                    ) : null}
                    {manage && onArchiveArea ? (
                      <button
                        type="button"
                        onClick={() => onArchiveArea(site.id)}
                        className="text-[10px] font-semibold uppercase tracking-wide text-rose-500 hover:text-rose-700"
                      >
                        {t("sites.archive")}
                      </button>
                    ) : null}
                  </span>
                ),
              )}
              {manage && onAddArea && !showSiteContext ? (
                <button type="button" onClick={onAddArea} className={[chipBase, "border-dashed", chipIdle].join(" ")}>
                  {t("sites.addArea")}
                </button>
              ) : null}
              {active.length === 0 ? (
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>{t("sites.noCustomAreas")}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {sites.some((site) => !site.active) ? (
          <div className={`rounded-2xl border p-3 ${isDark ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
            <p className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>{t("sites.archivedAreas")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {sites
                .filter((site) => !site.active)
                .map((site) => (
                  <span key={site.id} className="inline-flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs ${isDark ? "bg-slate-800 text-slate-400" : "bg-slate-200 text-slate-600"}`}
                    >
                      {site.name}
                    </span>
                    {manage && onReactivateArea ? (
                      <button
                        type="button"
                        onClick={() => onReactivateArea(site.id)}
                        className="text-xs font-semibold text-sky-600 hover:underline"
                      >
                        {t("sites.reactivate")}
                      </button>
                    ) : null}
                  </span>
                ))}
            </div>
          </div>
        ) : null}

        {showAssignment ? (
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {t("sites.assignUsersToAreas")}
            </p>
            <p className={`mt-1 text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>
              {areaAssignmentHelpText(areaRestrictionsEnabled, sites)}
            </p>
            <div className="mt-3 space-y-3">
              {reportUsers
                .filter((user) => user.role !== "Master")
                .map((user) => {
                  const assignmentKey = user.email.trim().toLowerCase();
                  const assignedIds = userSiteAssignments[assignmentKey] ?? [];
                  return (
                    <div
                      key={user.email}
                      className={`rounded-2xl border p-3 ${isDark ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"}`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>{user.email}</p>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                          {translateRoleLabel(t, user.role)}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {active.map((site) => {
                          const checked = assignedIds.includes(site.id);
                          return (
                            <label
                              key={`${user.email}-${site.id}`}
                              className={[
                                "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition",
                                checked
                                  ? isDark
                                    ? "border-sky-500/50 bg-sky-950/40 text-sky-100"
                                    : "border-sky-200 bg-sky-50 text-sky-900"
                                  : isDark
                                    ? "border-slate-800 bg-slate-900 text-slate-200"
                                    : "border-slate-200 bg-slate-50 text-slate-700",
                              ].join(" ")}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onToggleUserSiteAssignment?.(user.email, site.id)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600"
                              />
                              <span className="truncate">{site.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ) : !manage && !singleWorkspace ? null : !showAssignment && manage ? (
          <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            {areaAssignmentHelpText(areaRestrictionsEnabled, sites)}
          </p>
        ) : null}
      </div>
    </section>
  );
}
