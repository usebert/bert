import {
  canCompleteAuditAsAuditor,
  canSubmitAuditForReview,
  usesAssignedChecksCompletionFlow,
} from "../permissions";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getRoleTheme } from "../config/roleTheme";
import { rankAuditorAudit } from "../utils/auditorDashboard";
import { SECTION_INTROS } from "../config/sectionIntros";
import { SectionIntro } from "../components/SectionIntro";
import { AuditCentreBackButton } from "../components/auditCentre/AuditCentreBackButton";
import { AssignedCheckActionRow } from "../components/checks/AssignedCheckActionRow";
import type { AssignedCheckScheduleMeta } from "../utils/assignedCheckDisplay";
import { EmptyPanel, SectionHeader, StatusBadge } from "../components/dashboard/DashboardPrimitives";
import { FormsChecksTemplatesPanel } from "../components/forms/FormsChecksTemplatesPanel";
import { ASSIGNED_CHECKS_LOADING_MESSAGE, ASSIGNED_CHECKS_REFRESHING_MESSAGE } from "../services/checkService";
import { amberThresholdHours, getAuditTrafficStatus, getDueWarning, statusStyles } from "../utils/dashboardHealth";
import type {
  AuditAccessLevel,
  AuditAccessMatrixRow,
  AuditScheduleMatrixInfo,
  AuditsScreenProps,
} from "../types/auditsScreenProps";
import type { Audit, AuditStatus } from "../types/reportsScreenProps";
import type { AuditDraft } from "../types/dashboardScreenProps";

function accessLevelLabel(t: TFunction, access: AuditAccessLevel | "Can complete"): string {
  if (access === "Full access") return t("audits.fullAccess");
  if (access === "Oversight") return t("audits.oversight");
  if (access === "Can complete" || access === "Complete") return t("audits.canComplete");
  if (access === "No access") return t("audits.noAccess");
  return access;
}

function AssignedChecksLoadingState({
  message,
  className = "rounded-2xl border border-violet-200/80 bg-white px-5 py-6 text-sm text-slate-600",
}: {
  message: string;
  className?: string;
}) {
  return <div className={className}>{message}</div>;
}

function AssignedChecksLoadError({
  loadError,
  loadErrorDetail,
}: {
  loadError: string;
  loadErrorDetail?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-6">
      <p className="text-sm font-semibold text-rose-900">{t("audits.couldNotLoad")}</p>
      <p className="mt-2 text-sm text-rose-800">{loadError}</p>
      {loadErrorDetail ? (
        <p className="mt-2 break-all font-mono text-xs text-rose-700">{loadErrorDetail}</p>
      ) : null}
    </div>
  );
}

function AuditsScreenIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="6" y="4" width="12" height="16" rx="2" />
      <path d="M9 4.5h6a1.5 1.5 0 0 0-1.5-1.5h-3A1.5 1.5 0 0 0 9 4.5Z" />
      <path d="M9 10h6" />
      <path d="M9 14h6" />
    </svg>
  );
}

function getWorkspaceInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
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

function accessMatrixChipClasses(access: AuditAccessLevel): { button: string; label: string } {
  if (access === "Full access") {
    return {
      button: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100/80",
      label: "text-emerald-800",
    };
  }
  if (access === "Oversight") {
    return {
      button: "border-sky-200 bg-sky-50 hover:bg-sky-100/80",
      label: "text-sky-700",
    };
  }
  if (access === "Can complete" || access === "Complete") {
    return {
      button: "border-blue-200 bg-blue-50 hover:bg-blue-100/80",
      label: "text-blue-800",
    };
  }
  return {
    button: "border-slate-200 bg-slate-100 hover:bg-slate-200/70",
    label: "text-slate-500",
  };
}

function AccessMatrixTable({
  auditAccessMatrix,
  auditScheduleMatrix,
  userProfilePhotos,
  users,
  onToggleAuditAccess,
}: {
  auditAccessMatrix: AuditAccessMatrixRow[];
  auditScheduleMatrix: Record<string, AuditScheduleMatrixInfo>;
  userProfilePhotos: Record<string, string>;
  users: AuditsScreenProps["users"];
  onToggleAuditAccess: (email: string, auditId: string, currentAccess: AuditAccessLevel) => void;
}) {
  const { t } = useTranslation();
  const matrixAuditColumns = auditAccessMatrix[0]?.cells ?? [];
  const visibleMatrixAuditColumns = matrixAuditColumns;
  const filteredMatrixRows = auditAccessMatrix;
  const findProfilePhoto = (matrixUser: AuditAccessMatrixRow) => {
    const emailKey = matrixUser.email.split("@")[0]?.toLowerCase() || "";
    const nameKey = matrixUser.name.toLowerCase();
    const knownUser = users.find((item) => item.name.toLowerCase() === nameKey || item.username === emailKey);
    return (
      (knownUser ? userProfilePhotos[knownUser.username] : "") ||
      userProfilePhotos[emailKey] ||
      userProfilePhotos[nameKey] ||
      ""
    );
  };

  return (
    <>
      {filteredMatrixRows.length === 0 || visibleMatrixAuditColumns.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t("audits.nothingToShow")}
            text={t("audits.matrixEmptyBody")}
          />
        </div>
      ) : (
        <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white">
          <table className="w-full table-fixed border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="w-[11rem] bg-slate-50 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t("common.user")}
                </th>
                {visibleMatrixAuditColumns.map((audit) => (
                  <th
                    key={audit.auditId}
                    className="px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"
                  >
                    <span className="block truncate leading-4">{audit.auditName}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredMatrixRows.map((user) => (
                <tr key={user.email} className="border-b border-slate-100 align-top last:border-b-0">
                  <td className="bg-white px-2 py-2">
                    <div className="flex items-center gap-2">
                      {findProfilePhoto(user) ? (
                        <img
                          src={findProfilePhoto(user)}
                          alt={user.name}
                          className="h-7 w-7 shrink-0 rounded-full border border-slate-200 object-cover"
                        />
                      ) : (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
                          {getWorkspaceInitials(user.name)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold leading-4 text-slate-900">{user.name}</p>
                        <p className="mt-1 text-[10px] font-semibold text-slate-400">
                          {t("audits.accessibleCount", { count: user.accessibleCount })}
                        </p>
                      </div>
                    </div>
                  </td>
                  {user.cells.map((cell) => {
                    const chip = accessMatrixChipClasses(cell.access);
                    return (
                    <td key={`${user.email}-${cell.auditId}`} className="px-1.5 py-2">
                      <button
                        type="button"
                        onClick={() => onToggleAuditAccess(user.email, cell.auditId, cell.access)}
                        className={["w-full rounded-lg border px-2 py-1.5 text-left transition", "cursor-pointer", chip.button].join(" ")}
                      >
                        <p className={["text-[10px] font-semibold uppercase tracking-[0.12em]", chip.label].join(" ")}>
                          {accessLevelLabel(t, cell.access === "Complete" ? "Can complete" : cell.access)}
                        </p>
                        <p className="mt-0.5 text-[9px] font-semibold text-slate-400">{t("audits.tapToChange")}</p>
                      </button>
                    </td>
                  );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t("audits.accessLevels")}</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              <li>
                <span className="font-semibold text-slate-800">{t("audits.noAccess")}</span> — {t("audits.accessNoAccessDesc")}
              </li>
              <li>
                <span className="font-semibold text-slate-800">{t("audits.canComplete")}</span> — {t("audits.accessCanCompleteDesc")}
              </li>
              <li>
                <span className="font-semibold text-slate-800">{t("audits.fullAccess")}</span> — {t("audits.accessFullAccessDesc")}
              </li>
            </ul>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t("audits.scheduleMapping")}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {visibleMatrixAuditColumns.map((audit) => {
                const schedule = auditScheduleMatrix[audit.auditId];
                return (
                  <div key={`schedule-map-${audit.auditId}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <p className="text-sm font-semibold text-slate-900">{audit.auditName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {schedule
                        ? `${schedule.frequency} • ${schedule.days.join(", ")} • ${schedule.liveTime} • ${schedule.completionHours}h`
                        : t("audits.notScheduled")}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <QuickActionTile title={t("audits.usersTile")} value={String(filteredMatrixRows.length)} caption={t("audits.includedInMatrix")} />
        <QuickActionTile title={t("audits.auditsTile")} value={String(visibleMatrixAuditColumns.length)} caption={t("audits.availableOnWorkspace")} />
        <QuickActionTile
          title={t("audits.assignedAccess")}
          value={String(filteredMatrixRows.reduce((sum, row) => sum + row.accessibleCount, 0))}
          caption={t("audits.userToAuditLinks")}
        />
      </div>
    </>
  );
}

function TrafficLane({
  title,
  subtitle,
  audits,
  status,
  onOpenAudit,
  expanded = false,
  drafts = {},
  unsyncedAuditIds = new Set<string>(),
}: {
  title: string;
  subtitle: string;
  audits: Audit[];
  status: AuditStatus;
  onOpenAudit: (auditId: string) => void;
  expanded?: boolean;
  drafts?: Record<string, AuditDraft>;
  unsyncedAuditIds?: Set<string>;
}) {
  const { t } = useTranslation();
  const compact = !expanded;
  const visibleAudits = compact ? audits.slice(0, 1) : audits;
  const hiddenCount = Math.max(0, audits.length - visibleAudits.length);

  return (
    <div className={["rounded-[1.2rem] p-2 ring-1 shadow-[0_8px_18px_rgba(15,23,42,0.05)]", statusStyles[status].soft, statusStyles[status].ring].join(" ")}>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${statusStyles[status].dot}`} />
          <div>
            <p className={`text-xs font-semibold ${statusStyles[status].text}`}>{title}</p>
            <p className="text-[10px] text-slate-500">{subtitle}</p>
          </div>
        </div>
        <div className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-slate-700 shadow-[0_3px_10px_rgba(15,23,42,0.05)]">{audits.length}</div>
      </div>

      <div className="space-y-1.5">
        {visibleAudits.map((audit) => (
          <button
            key={audit.id}
            onClick={() => onOpenAudit(audit.id)}
            className={["w-full rounded-xl bg-white/95 px-3 py-2 text-left shadow-[0_6px_14px_rgba(15,23,42,0.06)] transition active:scale-[0.99]", expanded ? "min-h-[4.25rem]" : ""].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900">{audit.name}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {audit.siteArea} • {audit.priority} • {t("audits.ownerLabel", { name: audit.owner })}
                </p>
                <p className="mt-1 text-[10px] font-medium text-slate-600">{getDueWarning(audit.dueHours)}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {drafts[audit.id]
                    ? t("audits.inProgressAt", { time: drafts[audit.id].updatedAt })
                    : t("audits.lastCompletedAt", { time: audit.lastCompletedAt })}
                </p>
                {unsyncedAuditIds.has(audit.id) && (
                  <p className="mt-0.5 text-[10px] font-semibold text-amber-700">{t("audits.auditCompleteNotSynced")}</p>
                )}
              </div>
              <div className="shrink-0 space-y-1 text-right">
                <StatusBadge status={getAuditTrafficStatus(audit.dueHours)} />
                <div className="text-[10px] text-slate-400">{audit.dueLabel}</div>
              </div>
            </div>
          </button>
        ))}
        {hiddenCount > 0 && <div className="px-1 text-[10px] font-semibold text-slate-500">{t("audits.moreCount", { count: hiddenCount })}</div>}
        {audits.length === 0 && (
          <div className="rounded-xl bg-white/85 px-3 py-2 text-xs text-slate-500 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)]">
            <p className="font-semibold text-slate-700">{t("audits.nothingInWindow")}</p>
            <p className="mt-0.5">{t("audits.nothingInWindowHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AuditorChecksList({
  audits,
  drafts,
  scheduleMetaByAuditId = {},
  onOpenAudit,
  onNavigateToToday,
  onNavigateToSubmit,
}: {
  audits: Audit[];
  drafts: Record<string, AuditDraft>;
  scheduleMetaByAuditId?: Record<string, AssignedCheckScheduleMeta>;
  onOpenAudit: (auditId: string) => void;
  onNavigateToToday?: () => void;
  onNavigateToSubmit?: () => void;
}) {
  const { t } = useTranslation();
  const theme = getRoleTheme("Auditor");
  const sorted = [...audits].sort((a, b) => {
    const rankDiff = rankAuditorAudit(a, Boolean(drafts[a.id])) - rankAuditorAudit(b, Boolean(drafts[b.id]));
    if (rankDiff !== 0) return rankDiff;
    return a.dueHours - b.dueHours;
  });

  if (sorted.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/50 px-5 py-6">
        <p className="text-lg font-semibold text-slate-900">{t("audits.noChecksAssigned")}</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{t("audits.noChecksAssignedBody")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {onNavigateToToday ? (
            <button
              type="button"
              onClick={onNavigateToToday}
              className={[
                "min-h-[2.75rem] rounded-full px-5 py-2 text-sm font-semibold transition active:scale-[0.98]",
                theme.primaryButton,
                theme.primaryButtonHover,
              ].join(" ")}
            >
              {t("audits.goToToday")}
            </button>
          ) : null}
          {onNavigateToSubmit ? (
            <button
              type="button"
              onClick={onNavigateToSubmit}
              className={[
                "min-h-[2.75rem] rounded-full border px-5 py-2 text-sm font-semibold transition active:scale-[0.98]",
                theme.outlineButton,
              ].join(" ")}
            >
              {t("audits.submitRecord")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const dueToday = sorted.filter((audit) => audit.dueLabel !== "Available" && audit.dueHours >= 0 && audit.dueHours <= 24);
  const availableChecks = sorted.filter((audit) => audit.dueLabel === "Available");
  const otherChecks = sorted.filter(
    (audit) => audit.dueLabel !== "Available" && !(audit.dueHours >= 0 && audit.dueHours <= 24),
  );

  const renderAuditRow = (audit: Audit) => (
    <AssignedCheckActionRow
      key={audit.id}
      audit={audit}
      drafts={drafts}
      scheduleMeta={scheduleMetaByAuditId[audit.id]}
      onOpenAudit={onOpenAudit}
      themeRole="Auditor"
    />
  );

  return (
    <div className="space-y-5">
      {dueToday.length > 0 ? (
        <section>
          <p className="text-sm font-semibold text-slate-900">{t("audits.dueToday")}</p>
          <ul className="mt-3 space-y-3">{dueToday.map(renderAuditRow)}</ul>
        </section>
      ) : null}
      {availableChecks.length > 0 ? (
        <section>
          <p className="text-sm font-semibold text-slate-900">{t("audits.availableChecks")}</p>
          <p className="mt-1 text-xs text-slate-500">{t("audits.availableChecksHint")}</p>
          <ul className="mt-3 space-y-3">{availableChecks.map(renderAuditRow)}</ul>
        </section>
      ) : null}
      {otherChecks.length > 0 ? (
        <section>
          <p className="text-sm font-semibold text-slate-900">{t("audits.otherAssignedChecks")}</p>
          <ul className="mt-3 space-y-3">{otherChecks.map(renderAuditRow)}</ul>
        </section>
      ) : null}
    </div>
  );
}

export function AuditsScreen({
  currentUser,
  audits,
  myAssignedChecks = [],
  assignedCheckScheduleMeta = {},
  groupedAudits,
  drafts,
  unsyncedAuditIds,
  userProfilePhotos,
  users,
  onOpenAudit,
  auditAccessMatrix,
  auditScheduleMatrix,
  onToggleAuditAccess,
  onNavigateToToday,
  onNavigateToSubmit,
  onNavigateToSchedules,
  onNavigateToTemplateBuilder,
  onNavigateToAuditBuilder,
  onNavigateToWorkspace,
  templates = [],
  syncState = "Not synced",
  googleConnected = false,
  companyFolderId,
  companyGoogleForms = [],
  companyGoogleFormsStatus = "idle",
  companyGoogleFormsDiagnostics = null,
  showGoogleFormsDiagnostics = false,
  canCreateTemplates = false,
  masterSheetId,
  onToggleTemplate,
  onEditTemplate,
  onTemplateCopied,
  onTemplateRevised,
  onTemplateArchived,
  assignedChecksLoading = false,
  assignedChecksLoadError,
  assignedChecksLoadErrorDetail,
  onGoogleFormUpdated,
  onBackToAuditCentre,
}: AuditsScreenProps) {
  const { t } = useTranslation();
  if (canCompleteAuditAsAuditor(currentUser.role)) {
    const theme = getRoleTheme("Auditor");
    return (
      <div className="space-y-4">
        {onBackToAuditCentre ? <AuditCentreBackButton onClick={onBackToAuditCentre} /> : null}
        <section className="rounded-2xl border border-violet-200/80 bg-violet-50/60 px-5 py-4 shadow-sm">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t("audits.myChecks")}</h2>
          <SectionIntro text={SECTION_INTROS.auditorChecks} className="mt-2" role="Auditor" />
          {onNavigateToToday ? (
            <button
              type="button"
              onClick={onNavigateToToday}
              className={[
                "mt-4 inline-flex h-11 items-center rounded-xl px-5 text-sm font-semibold",
                theme.primaryButton,
                theme.primaryButtonHover,
              ].join(" ")}
            >
              {t("audits.goToToday")}
            </button>
          ) : null}
        </section>
        {assignedChecksLoading && myAssignedChecks.length === 0 ? (
          <AssignedChecksLoadingState message={ASSIGNED_CHECKS_LOADING_MESSAGE} />
        ) : assignedChecksLoadError && myAssignedChecks.length === 0 ? (
          <AssignedChecksLoadError loadError={assignedChecksLoadError} loadErrorDetail={assignedChecksLoadErrorDetail} />
        ) : (
          <div className="space-y-3">
            {assignedChecksLoading ? (
              <AssignedChecksLoadingState
                message={ASSIGNED_CHECKS_REFRESHING_MESSAGE}
                className="rounded-2xl border border-violet-100 bg-violet-50/70 px-4 py-3 text-sm text-slate-600"
              />
            ) : null}
            <AuditorChecksList
              audits={myAssignedChecks}
              drafts={drafts}
              scheduleMetaByAuditId={assignedCheckScheduleMeta}
              onOpenAudit={onOpenAudit}
              onNavigateToToday={onNavigateToToday}
              onNavigateToSubmit={onNavigateToSubmit}
            />
          </div>
        )}
      </div>
    );
  }

  const theme = getRoleTheme(currentUser.role);
  const adminAccentHero = currentUser.role === "Admin";
  const heroIconChip = adminAccentHero
    ? "bg-blue-50 text-blue-600 ring-1 ring-blue-100"
    : currentUser.role === "Manager"
      ? "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"
      : "bg-violet-50 text-violet-600 ring-1 ring-violet-100";

  return (
    <div className="space-y-4">
      {onBackToAuditCentre ? <AuditCentreBackButton onClick={onBackToAuditCentre} /> : null}
      <section className="rounded-[1.75rem] border border-slate-200/90 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className={["flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", heroIconChip].join(" ")}>
            <AuditsScreenIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t("audits.formsAndChecks")}</h2>
            <SectionIntro
              text={t("audits.formsAndChecksIntro")}
              className="mt-2"
              role={currentUser.role}
            />
            <div className="mt-4 flex flex-wrap gap-3">
              {onNavigateToAuditBuilder ? (
                <button
                  type="button"
                  onClick={onNavigateToAuditBuilder}
                  className={[
                    "inline-flex h-12 items-center rounded-xl px-5 text-sm font-semibold text-white",
                    theme.primaryButton,
                    theme.primaryButtonHover,
                  ].join(" ")}
                >
                  {t("audits.createAuditTemplate")}
                </button>
              ) : null}
              {onNavigateToTemplateBuilder ? (
                <button
                  type="button"
                  onClick={onNavigateToTemplateBuilder}
                  className={[
                    "inline-flex h-12 items-center rounded-xl border px-5 text-sm font-semibold",
                    theme.outlineButton,
                  ].join(" ")}
                >
                  {t("audits.advancedTemplateBuilder")}
                </button>
              ) : null}
              {onNavigateToSchedules ? (
                <button
                  type="button"
                  onClick={onNavigateToSchedules}
                  className={[
                    "inline-flex h-12 items-center rounded-xl border px-5 text-sm font-semibold",
                    theme.outlineButton,
                  ].join(" ")}
                >
                  {t("audits.manageSchedules")}
                </button>
              ) : null}
              {!googleConnected && onNavigateToWorkspace ? (
                <button
                  type="button"
                  onClick={onNavigateToWorkspace}
                  className={[
                    "inline-flex h-12 items-center rounded-xl border px-5 text-sm font-semibold",
                    theme.outlineButton,
                  ].join(" ")}
                >
                  {t("audits.openWorkspace")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {usesAssignedChecksCompletionFlow(currentUser.role) && !canCompleteAuditAsAuditor(currentUser.role) ? (
        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <h3 className="text-xl font-semibold tracking-tight text-slate-900">{t("audits.myAssignedChecks")}</h3>
          <p className="mt-2 text-sm text-slate-600">{t("audits.myAssignedChecksBody")}</p>
          <div className="mt-4">
            {assignedChecksLoading && myAssignedChecks.length === 0 ? (
              <AssignedChecksLoadingState
                message={ASSIGNED_CHECKS_LOADING_MESSAGE}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-600"
              />
            ) : assignedChecksLoadError && myAssignedChecks.length === 0 ? (
              <AssignedChecksLoadError loadError={assignedChecksLoadError} loadErrorDetail={assignedChecksLoadErrorDetail} />
            ) : (
              <div className="space-y-3">
                {assignedChecksLoading ? (
                  <AssignedChecksLoadingState
                    message={ASSIGNED_CHECKS_REFRESHING_MESSAGE}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
                  />
                ) : null}
                <AuditorChecksList
                  audits={myAssignedChecks}
                  drafts={drafts}
                  scheduleMetaByAuditId={assignedCheckScheduleMeta}
                  onOpenAudit={onOpenAudit}
                />
              </div>
            )}
          </div>
        </section>
      ) : null}

      <FormsChecksTemplatesPanel
        templates={templates}
        syncState={syncState}
        googleConnected={googleConnected}
        companyFolderId={companyFolderId}
        masterSheetId={masterSheetId}
        role={currentUser.role}
        companyGoogleForms={companyGoogleForms}
        companyGoogleFormsStatus={companyGoogleFormsStatus}
        companyGoogleFormsDiagnostics={companyGoogleFormsDiagnostics}
        showGoogleFormsDiagnostics={showGoogleFormsDiagnostics}
        canCreateTemplates={canCreateTemplates}
        onToggleTemplate={onToggleTemplate}
        onEditTemplate={onEditTemplate}
        onTemplateCopied={onTemplateCopied || onEditTemplate}
        onTemplateRevised={onTemplateRevised || onEditTemplate}
        onTemplateArchived={onTemplateArchived}
        onGoogleFormUpdated={onGoogleFormUpdated}
      />

      {canSubmitAuditForReview(currentUser.role) && auditAccessMatrix.length > 0 ? (
        <details className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">{t("audits.manageAccessAdvanced")}</summary>
          <p className="mt-2 text-sm text-slate-600">{t("audits.manageAccessBody")}</p>
          <div className="mt-4 overflow-x-auto">
            <AccessMatrixTable
              auditAccessMatrix={auditAccessMatrix}
              auditScheduleMatrix={auditScheduleMatrix}
              userProfilePhotos={userProfilePhotos}
              users={users}
              onToggleAuditAccess={onToggleAuditAccess}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
