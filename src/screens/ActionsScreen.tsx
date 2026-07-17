import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SECTION_INTROS } from "../config/sectionIntros";
import { SectionIntro } from "../components/SectionIntro";
import { canCompleteAuditAsAuditor, getRolePermissions, type Role } from "../permissions";
import { EmptyPanel, MetaPill } from "../components/dashboard/DashboardPrimitives";
import { StatusChip } from "../components/ui/StatusChip";
import type { ActionItem, ActionStatus, RiskLevel } from "../types/reportsScreenProps";
import type { User } from "../types/dashboardScreenProps";
import { slatePrimaryCtaInteract } from "../styles/interactions";
import { getActionPrimaryCTA, getRecordNextStepText } from "../utils/recordNextStep";
import { EvidenceUploadChoice } from "../components/evidence/EvidenceUploadChoice";
import { ArchiveRecordButton } from "../components/archive/ArchiveRecordButton";
import { canArchiveRecordFromClient } from "../utils/archivePermissions";

type ActionFilter = "Open" | "Overdue" | "Awaiting Verification" | "Closed" | "Severity";
const brandDarkFormControl =
  "border border-[rgba(249,115,22,0.45)] bg-slate-950 text-slate-100 outline-none focus:border-[var(--bert-signal-orange)]";
const lightFilterControl =
  "border border-slate-200 bg-white text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

function ActionsScreenIcon({ className = "h-5 w-5" }: { className?: string }) {
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
      <path d="M12 4.75 20.25 19.25H3.75L12 4.75z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="16.35" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function isActionOverdue(action: ActionItem) {
  return action.status !== "Closed" && action.dueHours < 0;
}

function isActionEscalated(action: ActionItem) {
  if (action.escalated !== undefined) {
    return action.escalated;
  }
  return isActionOverdue(action) && Math.abs(action.dueHours) > 24;
}

function isActionStuck(action: ActionItem) {
  if (action.isStuck !== undefined) {
    return action.isStuck;
  }
  return action.status === "Awaiting Verification" && action.dueHours < -24;
}

function isActionDueSoon(action: ActionItem) {
  return action.status !== "Closed" && action.dueHours >= 0 && action.dueHours <= 24;
}

function getActionUrgency(action: ActionItem): "Escalated" | "Overdue" | "Stuck" | "Due soon" | "Normal" {
  if (isActionEscalated(action)) return "Escalated";
  if (isActionOverdue(action)) return "Overdue";
  if (isActionStuck(action)) return "Stuck";
  if (isActionDueSoon(action)) return "Due soon";
  return "Normal";
}

function statusChipForAction(status: ActionStatus) {
  if (status === "Awaiting Verification") return { variant: "awaitingVerification" as const, label: "Awaiting verification" };
  if (status === "Closed") return { variant: "closed" as const, label: "Closed" };
  if (status === "Rejected") return { variant: "overdue" as const, label: "Rejected" };
  if (status === "In Progress") return { variant: "awaitingVerification" as const, label: "In progress" };
  return { variant: "draft" as const, label: status === "Open" ? "Open" : status };
}

function formatOpenActionOptionLabel(action: ActionItem) {
  const ref = action.nonConformanceId ? `${action.nonConformanceId} · ` : "";
  const audit = action.auditName ? ` (${action.auditName})` : "";
  const text = action.questionText.trim();
  const clipped = text.length > 72 ? `${text.slice(0, 69)}…` : text;
  return `${ref}${clipped}${audit}`;
}

function ActionDetailPanel({
  action,
  role,
  permissions,
  canReviewSuggestions,
  availableAuditors,
  filterControl,
  onAdvanceAction,
  onAssignAction,
  onAddEvidence,
  onAcceptSuggestion,
  onEditSuggestion,
  onIgnoreSuggestion,
  archiveCompanyFolderId,
  archiveMasterSheetId,
  archiveOffline,
  canArchiveAction,
  onActionArchived,
  onArchiveError,
  onArchiveSuccess,
}: {
  action: ActionItem;
  role: Role;
  permissions: ReturnType<typeof getRolePermissions>;
  canReviewSuggestions: boolean;
  availableAuditors: string[];
  filterControl: string;
  onAdvanceAction: (actionId: string, nextStatus?: ActionStatus) => void;
  onAssignAction: (actionId: string, assignee: string) => void;
  onAddEvidence: (actionId: string, files: FileList) => void;
  onAcceptSuggestion: (actionId: string) => void;
  onEditSuggestion: (actionId: string) => void;
  onIgnoreSuggestion: (actionId: string) => void;
  archiveCompanyFolderId?: string;
  archiveMasterSheetId?: string;
  archiveOffline?: boolean;
  canArchiveAction?: boolean;
  onActionArchived?: (actionId: string) => void | Promise<void>;
  onArchiveError?: (message: string) => void;
  onArchiveSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const chip = statusChipForAction(action.status);
  const urgency = getActionUrgency(action);
  const urgencyTone =
    urgency === "Escalated"
      ? "bg-rose-200 text-rose-900"
      : urgency === "Overdue"
        ? "bg-rose-100 text-rose-700"
        : urgency === "Stuck"
          ? "bg-amber-100 text-amber-800"
          : urgency === "Due soon"
            ? "bg-amber-50 text-amber-700"
            : "bg-slate-100 text-slate-700";
  const cta = getActionPrimaryCTA(action, permissions);
  const nextStep = getRecordNextStepText("action", action.status, role, {
    evidenceRequired: action.evidenceRequired,
    evidenceCount: action.evidenceCount,
  });

  return (
    <section className="rounded-[1.6rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_30px_rgba(15,23,42,0.06)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <StatusChip variant={chip.variant}>{chip.label}</StatusChip>
        <div className="flex flex-wrap items-center gap-2">
          {canArchiveAction && archiveCompanyFolderId && onActionArchived ? (
            <ArchiveRecordButton
              recordType="action"
              recordId={action.id}
              companyFolderId={archiveCompanyFolderId}
              masterSheetId={archiveMasterSheetId}
              offlineMode={archiveOffline}
              canArchive={canArchiveAction}
              label={t("actions.archiveAction")}
              extraMessage="It will be hidden from active views and can be restored from Archive."
              onArchived={() => onActionArchived(action.id)}
              onError={onArchiveError}
              onSuccess={onArchiveSuccess}
            />
          ) : null}
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${urgencyTone}`}>{urgency}</div>
        </div>
      </div>
      <div className="min-w-0">
        <p className="mt-1 text-base font-semibold text-slate-900">{action.questionText}</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{action.sourceAnswer}</p>
        <p className="mt-1 text-xs font-medium text-slate-500">{action.auditName}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {action.nonConformanceId ? (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
              NCR {action.nonConformanceId}
            </span>
          ) : null}
          <MetaPill icon="spark" label={action.severity} />
          <MetaPill
            icon={action.riskCategory === "Health & Safety" ? "warningTriangle" : "clipboard"}
            label={action.riskCategory}
          />
          <MetaPill icon="user" label={action.assignedToName} />
          <MetaPill icon="clock" label={action.dueDate || action.dueLabel} />
          <MetaPill
            icon="camera"
            label={
              action.evidenceRequired
                ? action.evidenceCount === 0
                  ? t("actions.evidenceRequired")
                  : `${action.evidenceCount} photos`
                : action.evidenceCount > 0
                  ? `${action.evidenceCount} photos`
                  : t("actions.evidenceOptional")
            }
          />
          {action.siteArea ? <MetaPill icon="clipboard" label={action.siteArea} /> : null}
        </div>
        <p className="mt-3 rounded-xl border border-sky-100 bg-sky-50/90 px-3 py-2 text-sm text-slate-800">
          <span className="font-semibold text-slate-900">Next step. </span>
          {nextStep.replace(/^Next step:\s*/i, "")}
        </p>
        {action.status !== "Closed" && action.evidenceRequired && action.evidenceCount === 0 && (
          <p className="mt-2 text-xs font-semibold text-amber-800">Photos are still required before this can be verified.</p>
        )}
        {canReviewSuggestions ? (
          <SuggestedFixPanel
            action={action}
            onAcceptSuggestion={onAcceptSuggestion}
            onEditSuggestion={onEditSuggestion}
            onIgnoreSuggestion={onIgnoreSuggestion}
          />
        ) : null}
        {action.correctiveAction?.trim() && action.suggestionStatus && action.suggestionStatus !== "suggested" ? (
          <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span className="font-semibold text-slate-900">Corrective action. </span>
            {action.correctiveAction}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {permissions.canAssignActions && (
          <select
            value={action.assignedToName}
            onChange={(event) => onAssignAction(action.id, event.target.value)}
            className={`min-h-[44px] w-full max-w-md rounded-2xl px-4 text-sm ${filterControl}`}
          >
            {[action.assignedToName, ...availableAuditors]
              .filter((value, index, list) => value && list.indexOf(value) === index)
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {cta.kind === "uploadEvidence" ? (
            <EvidenceUploadChoice
              triggerLabel={t("actions.uploadEvidence")}
              triggerClassName={`min-h-[48px] rounded-2xl bg-[var(--bert-signal-orange)] px-5 text-sm font-semibold text-[var(--qms-navy-950)] shadow-sm focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 ${slatePrimaryCtaInteract}`}
              onFiles={(files) => onAddEvidence(action.id, files)}
            />
          ) : cta.kind === "start" ? (
            <button
              type="button"
              onClick={() => onAdvanceAction(action.id, "In Progress")}
              className={`min-h-[44px] rounded-2xl bg-[var(--bert-signal-orange)] px-5 text-sm font-semibold text-[var(--qms-navy-950)] shadow-sm focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 ${slatePrimaryCtaInteract}`}
            >
              {cta.label}
            </button>
          ) : cta.kind === "submitVerification" ? (
            <button
              type="button"
              onClick={() => onAdvanceAction(action.id, "Awaiting Verification")}
              className={`min-h-[44px] rounded-2xl bg-[var(--bert-signal-orange)] px-5 text-sm font-semibold text-[var(--qms-navy-950)] shadow-sm focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 ${slatePrimaryCtaInteract}`}
            >
              {cta.label}
            </button>
          ) : cta.kind === "verifyClose" ? (
            <button
              type="button"
              onClick={() => onAdvanceAction(action.id, "Closed")}
              className={`min-h-[44px] rounded-2xl bg-[var(--bert-signal-orange)] px-5 text-sm font-semibold text-[var(--qms-navy-950)] shadow-sm focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 ${slatePrimaryCtaInteract}`}
            >
              {cta.label}
            </button>
          ) : (
            <p className="text-sm text-slate-500">No further actions from you on this item.</p>
          )}
          {action.status === "In Progress" && cta.kind === "uploadEvidence" ? (
            <button
              type="button"
              onClick={() => onAdvanceAction(action.id, "Awaiting Verification")}
              className="min-h-[44px] rounded-2xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              {t("actions.markReadyForReview")}
            </button>
          ) : null}
          {permissions.canVerifyActions && action.status === "Awaiting Verification" ? (
            <button
              type="button"
              onClick={() => onAdvanceAction(action.id, "Rejected")}
              className="min-h-[44px] rounded-2xl border border-rose-200 bg-rose-50 px-5 text-sm font-semibold text-rose-800 focus-visible:outline focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              Reject with feedback
            </button>
          ) : null}
        </div>
        {action.status !== "Closed" && cta.kind !== "uploadEvidence" ? (
          <EvidenceUploadChoice
            triggerLabel={t("actions.uploadEvidence")}
            triggerClassName="min-h-[48px] w-full max-w-xs rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-300"
            onFiles={(files) => onAddEvidence(action.id, files)}
          />
        ) : null}
      </div>
    </section>
  );
}

function SuggestedFixPanel({
  action,
  onAcceptSuggestion,
  onEditSuggestion,
  onIgnoreSuggestion,
}: {
  action: ActionItem;
  onAcceptSuggestion: (actionId: string) => void;
  onEditSuggestion: (actionId: string) => void;
  onIgnoreSuggestion: (actionId: string) => void;
}) {
  if (action.suggestionStatus !== "suggested" || !action.suggestedActionTitle) {
    return null;
  }

  return (
    <section className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-900">Suggested fix</p>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 ring-1 ring-amber-200">
          Manager review required
        </span>
      </div>
      <p className="mt-2 text-base font-semibold text-slate-900">{action.suggestedActionTitle}</p>
      {action.suggestedActionDescription ? (
        <p className="mt-2 leading-relaxed text-slate-700">{action.suggestedActionDescription}</p>
      ) : null}
      {action.suggestionReason ? (
        <p className="mt-3 rounded-xl border border-amber-100 bg-white/80 px-3 py-2 text-slate-700">
          <span className="font-semibold text-slate-900">Why BERT suggested this. </span>
          {action.suggestionReason}
        </p>
      ) : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-100 bg-white/70 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Suggested due date</p>
          <p className="mt-1 font-semibold text-slate-900">{action.suggestedDueDate || action.dueDate}</p>
        </div>
        {action.suggestedOwnerRole ? (
          <div className="rounded-xl border border-amber-100 bg-white/70 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Suggested owner role</p>
            <p className="mt-1 font-semibold text-slate-900">{action.suggestedOwnerRole}</p>
          </div>
        ) : null}
      </div>
      {action.suggestedEvidence && action.suggestedEvidence.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Evidence needed</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
            {action.suggestedEvidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {(action.similarIssueCount30d ?? 0) > 0 ? (
        <p className="mt-3 text-xs font-medium text-amber-900">
          Same check failed {action.similarIssueCount30d} other time{action.similarIssueCount30d === 1 ? "" : "s"} in this
          area in the last 30 days.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-slate-600">
        This is a rule-based suggestion for manager review — not an automated decision, guarantee, or certification.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => onAcceptSuggestion(action.id)}
          className={`min-h-[44px] rounded-2xl bg-[var(--bert-signal-orange)] px-4 text-sm font-semibold text-[var(--qms-navy-950)] shadow-sm focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 ${slatePrimaryCtaInteract}`}
        >
          Use suggestion
        </button>
        <button
          type="button"
          onClick={() => onEditSuggestion(action.id)}
          className="min-h-[44px] rounded-2xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-950 focus-visible:outline focus-visible:ring-2 focus-visible:ring-amber-200"
        >
          Edit before assigning
        </button>
        <button
          type="button"
          onClick={() => onIgnoreSuggestion(action.id)}
          className="min-h-[44px] rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-300"
        >
          Ignore suggestion
        </button>
      </div>
    </section>
  );
}

export function ActionsScreen({
  currentUser,
  actions,
  actionFilter,
  actionSeverityFilter,
  actionNcFilter,
  availableNonConformanceIds,
  availableAuditors,
  onFilterChange,
  onSeverityFilterChange,
  onNcFilterChange,
  onAdvanceAction,
  onAssignAction,
  onAddEvidence,
  onAcceptSuggestion,
  onEditSuggestion,
  onIgnoreSuggestion,
  archiveCompanyFolderId = "",
  archiveMasterSheetId,
  archiveOffline = false,
  onActionArchived,
  onArchiveError,
  onArchiveSuccess,
}: {
  currentUser: User;
  actions: ActionItem[];
  actionFilter: ActionFilter;
  actionSeverityFilter: RiskLevel | "All";
  actionNcFilter: string;
  availableNonConformanceIds: string[];
  availableAuditors: string[];
  onFilterChange: (value: ActionFilter) => void;
  onSeverityFilterChange: (value: RiskLevel | "All") => void;
  onNcFilterChange: (value: string) => void;
  onAdvanceAction: (actionId: string, nextStatus?: ActionStatus) => void;
  onAssignAction: (actionId: string, assignee: string) => void;
  onAddEvidence: (actionId: string, files: FileList) => void;
  onAcceptSuggestion: (actionId: string) => void;
  onEditSuggestion: (actionId: string) => void;
  onIgnoreSuggestion: (actionId: string) => void;
  archiveCompanyFolderId?: string;
  archiveMasterSheetId?: string;
  archiveOffline?: boolean;
  onActionArchived?: (actionId: string) => void | Promise<void>;
  onArchiveError?: (message: string) => void;
  onArchiveSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const canArchiveAction = canArchiveRecordFromClient(currentUser.role, "action");
  const canReviewSuggestions = currentUser.role === "Admin" || currentUser.role === "Manager";
  const permissions = getRolePermissions(currentUser.role);
  const [selectedActionId, setSelectedActionId] = useState("");

  const openActions = useMemo(
    () => actions.filter((action) => action.status !== "Closed"),
    [actions],
  );

  const selectedAction = useMemo(
    () => openActions.find((action) => action.id === selectedActionId),
    [openActions, selectedActionId],
  );

  useEffect(() => {
    if (selectedActionId && !openActions.some((action) => action.id === selectedActionId)) {
      setSelectedActionId("");
    }
  }, [openActions, selectedActionId]);

  const handleSelectAction = useCallback((actionId: string) => {
    setSelectedActionId(actionId);
  }, []);

  const filterControl = currentUser.role === "Admin" || currentUser.role === "Manager" ? lightFilterControl : brandDarkFormControl;
  const heroIconChip =
    currentUser.role === "Admin"
      ? "bg-blue-50 text-blue-600 ring-1 ring-blue-100"
      : currentUser.role === "Manager"
        ? "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"
        : "bg-violet-50 text-violet-600 ring-1 ring-violet-100";

  return (
    <div className="space-y-4">
      <section className="rounded-[1.75rem] border border-slate-200/90 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className={["flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", heroIconChip].join(" ")}>
            <ActionsScreenIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              {canCompleteAuditAsAuditor(currentUser.role) ? t("actions.myActions") : t("actions.title")}
            </h2>
            <SectionIntro
              text={SECTION_INTROS.correctiveActions}
              className="mt-2"
              role={currentUser.role === "Auditor" ? "Auditor" : currentUser.role === "Manager" ? "Manager" : "Admin"}
            />
          </div>
        </div>
      </section>

      <details className="rounded-[1.75rem] border border-slate-200/90 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">{t("actions.filterAdvanced")}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <select
            value={actionFilter}
            onChange={(event) => onFilterChange(event.target.value as ActionFilter)}
            className={`h-12 rounded-2xl px-4 text-sm ${filterControl}`}
          >
            <option value="Open">Open</option>
            <option value="Overdue">Overdue</option>
            <option value="Awaiting Verification">Awaiting verification</option>
            <option value="Closed">Closed</option>
            <option value="Severity">All by severity</option>
          </select>
          <select
            value={actionSeverityFilter}
            onChange={(event) => onSeverityFilterChange(event.target.value as RiskLevel | "All")}
            className={`h-12 rounded-2xl px-4 text-sm ${filterControl}`}
          >
            <option value="All">All severities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
          <select
            value={actionNcFilter}
            onChange={(event) => onNcFilterChange(event.target.value)}
            className={`h-12 rounded-2xl px-4 text-sm ${filterControl}`}
          >
            <option value="All">All non-conformances</option>
            {availableNonConformanceIds.map((reference) => (
              <option key={reference} value={reference}>
                Non-conformance {reference} (NCR)
              </option>
            ))}
          </select>
        </div>
      </details>

      <section className="rounded-[1.75rem] border border-slate-200/90 bg-white p-4 shadow-sm">
        <label className="mb-2 block text-sm font-semibold text-slate-900">{t("actions.openCorrectiveAction")}</label>
        <p className="mb-3 text-sm text-slate-500">{t("actions.chooseOpenAction")}</p>
        {openActions.length === 0 ? (
          <EmptyPanel
            title={t("actions.noOpenActions")}
            text={t("actions.noOpenActionsBody")}
          />
        ) : (
          <select
            value={selectedActionId}
            onChange={(event) => handleSelectAction(event.target.value)}
            className={`h-12 w-full rounded-2xl px-4 text-sm ${filterControl}`}
          >
            <option value="">{t("actions.selectOpenAction")}</option>
            {openActions.map((action) => (
              <option key={action.id} value={action.id}>
                {formatOpenActionOptionLabel(action)}
              </option>
            ))}
          </select>
        )}
      </section>

      {selectedAction ? (
        <ActionDetailPanel
          action={selectedAction}
          role={currentUser.role}
          permissions={permissions}
          canReviewSuggestions={canReviewSuggestions}
          availableAuditors={availableAuditors}
          filterControl={filterControl}
          onAdvanceAction={onAdvanceAction}
          onAssignAction={onAssignAction}
          onAddEvidence={onAddEvidence}
          onAcceptSuggestion={onAcceptSuggestion}
          onEditSuggestion={onEditSuggestion}
          onIgnoreSuggestion={onIgnoreSuggestion}
          archiveCompanyFolderId={archiveCompanyFolderId}
          archiveMasterSheetId={archiveMasterSheetId}
          archiveOffline={archiveOffline}
          canArchiveAction={canArchiveAction}
          onActionArchived={onActionArchived}
          onArchiveError={onArchiveError}
          onArchiveSuccess={onArchiveSuccess}
        />
      ) : openActions.length > 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
          {t("actions.selectActionAbove")}
        </p>
      ) : null}
    </div>
  );
}
