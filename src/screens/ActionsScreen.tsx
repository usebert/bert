import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SECTION_INTROS } from "../config/sectionIntros";
import { SectionIntro } from "../components/SectionIntro";
import { canCompleteAuditAsAuditor, getRolePermissions, type Role } from "../permissions";
import { EmptyPanel, MetaPill } from "../components/dashboard/DashboardPrimitives";
import { StatusChip } from "../components/ui/StatusChip";
import type { ActionItem, ActionStatus, RiskLevel } from "../types/reportsScreenProps";
import type { User } from "../types/dashboardScreenProps";
import { slatePrimaryCtaInteract } from "../styles/interactions";
import { getActionPrimaryCTA, getRecordNextStepText } from "../utils/recordNextStep";

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

function isDueToday(action: ActionItem) {
  return action.dueHours >= 0 && action.dueHours <= 24;
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

function useWideLayout() {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : true));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = () => setWide(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return wide;
}

function ChevronRight({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MobileActionDetail({
  action,
  role,
  permissions,
  onBack,
  onAdvanceAction,
  onAssignAction,
  onAddEvidence,
  availableAuditors,
}: {
  action: ActionItem;
  role: Role;
  permissions: ReturnType<typeof getRolePermissions>;
  onBack: () => void;
  onAdvanceAction: (actionId: string, nextStatus?: ActionStatus) => void;
  onAssignAction: (actionId: string, assignee: string) => void;
  onAddEvidence: (actionId: string, files: FileList) => void;
  availableAuditors: string[];
}) {
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const chip = statusChipForAction(action.status);
  const priorityHigh = action.severity === "High" || action.severity === "Critical";
  const cta = getActionPrimaryCTA(action, permissions);
  const nextStep = getRecordNextStepText("action", action.status, role, {
    evidenceRequired: action.evidenceRequired,
    evidenceCount: action.evidenceCount,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 lg:hidden">
      <header className="shrink-0 bg-gradient-to-r from-[#071525] via-[#0c1f36] to-[#050b14] px-3 py-3 text-white ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-white/60"
          >
            Back
          </button>
          <p className="text-sm font-semibold">Action</p>
          <span className="w-10 shrink-0" aria-hidden />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusChip variant={chip.variant}>{chip.label}</StatusChip>
          {action.nonConformanceId ? (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-200 ring-1 ring-white/20">
              NCR {action.nonConformanceId}
            </span>
          ) : null}
        </div>
        <p className="mt-2 font-mono text-[11px] text-slate-400">Ref · {action.id}</p>
        <h2 className="mt-1 text-lg font-semibold leading-snug text-white">{action.questionText}</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">{action.sourceAnswer}</p>
        <p className="mt-2 text-xs text-slate-400">{action.auditName}</p>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
        <div className="rounded-2xl border border-slate-200 bg-sky-50/80 p-3 text-sm text-slate-800">
          <span className="font-semibold text-slate-900">Next step. </span>
          {nextStep.replace(/^Next step:\s*/i, "")}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <DetailRow label="Owner" value={action.assignedToName} />
          <DetailRow
            label="Due"
            value={action.dueDate || action.dueLabel}
            valueClassName={isDueToday(action) ? "text-orange-600 font-semibold" : undefined}
          />
          <div className="flex min-h-[44px] items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-xs font-medium text-slate-500">Status</span>
            <StatusChip variant={chip.variant}>{chip.label}</StatusChip>
          </div>
          <DetailRow
            label="Priority"
            value={action.severity}
            valueClassName={priorityHigh ? "text-rose-600 font-semibold" : undefined}
          />
          <DetailRow label="Created" value={action.createdAt} />
          <DetailRow label="Location" value={action.siteArea || "—"} />
          <DetailRow label="Notes" value={action.comments?.trim() ? action.comments : "—"} />
          <button
            type="button"
            className="flex min-h-[44px] w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left focus-visible:outline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-300"
            onClick={() => evidenceInputRef.current?.click()}
          >
            <span className="text-xs font-medium text-slate-500">Evidence</span>
            <span className="flex items-center gap-1 text-sm font-semibold text-slate-800">
              {action.evidenceCount > 0 ? `${action.evidenceCount} attached` : "Add photos"}
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </span>
          </button>
        </div>

        {permissions.canAssignActions && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Owner (assign)</label>
            <select
              value={action.assignedToName}
              onChange={(event) => onAssignAction(action.id, event.target.value)}
              className={`min-h-[44px] w-full rounded-2xl px-4 text-sm ${brandDarkFormControl}`}
            >
              {[action.assignedToName, ...availableAuditors]
                .filter((value, index, list) => value && list.indexOf(value) === index)
                .map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
            </select>
          </div>
        )}

        <input
          ref={evidenceInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) {
              onAddEvidence(action.id, event.target.files);
              event.target.value = "";
            }
          }}
        />
      </div>

      <div className="shrink-0 space-y-2 border-t border-slate-200 bg-white px-3 py-3">
        {cta.kind === "uploadEvidence" ? (
          <button
            type="button"
            onClick={() => evidenceInputRef.current?.click()}
            className={`min-h-[48px] w-full rounded-2xl bg-[var(--bert-signal-orange)] text-sm font-semibold text-[var(--qms-navy-950)] shadow-md focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 ${slatePrimaryCtaInteract}`}
          >
            {cta.label}
          </button>
        ) : cta.kind === "start" ? (
          <button
            type="button"
            onClick={() => onAdvanceAction(action.id, "In Progress")}
            className={`min-h-[48px] w-full rounded-2xl bg-[var(--bert-signal-orange)] text-sm font-semibold text-[var(--qms-navy-950)] shadow-md focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 ${slatePrimaryCtaInteract}`}
          >
            {cta.label}
          </button>
        ) : cta.kind === "submitVerification" ? (
          <button
            type="button"
            onClick={() => onAdvanceAction(action.id, "Awaiting Verification")}
            className={`min-h-[48px] w-full rounded-2xl bg-[var(--bert-signal-orange)] text-sm font-semibold text-[var(--qms-navy-950)] shadow-md focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 ${slatePrimaryCtaInteract}`}
          >
            {cta.label}
          </button>
        ) : cta.kind === "verifyClose" ? (
          <button
            type="button"
            onClick={() => onAdvanceAction(action.id, "Closed")}
            className={`min-h-[48px] w-full rounded-2xl bg-[var(--bert-signal-orange)] text-sm font-semibold text-[var(--qms-navy-950)] shadow-md focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 ${slatePrimaryCtaInteract}`}
          >
            {cta.label}
          </button>
        ) : (
          <p className="py-2 text-center text-xs text-slate-500">No further actions from you on this item.</p>
        )}

        {action.status === "In Progress" && cta.kind === "uploadEvidence" ? (
          <button
            type="button"
            onClick={() => onAdvanceAction(action.id, "Awaiting Verification")}
            className="min-h-[44px] w-full rounded-2xl border border-slate-200 py-2 text-sm font-semibold text-slate-800 focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-300"
          >
            Mark ready for review (photos attached)
          </button>
        ) : null}

        {action.status === "Awaiting Verification" && permissions.canVerifyActions ? (
          <button
            type="button"
            onClick={() => onAdvanceAction(action.id, "Rejected")}
            className="min-h-[44px] w-full rounded-2xl border border-rose-200 bg-rose-50 py-2 text-sm font-semibold text-rose-800 focus-visible:outline focus-visible:ring-2 focus-visible:ring-rose-300"
          >
            Reject with feedback
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 last:border-b-0">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className={`max-w-[60%] text-right text-sm text-slate-900 ${valueClassName ?? ""}`.trim()}>{value}</span>
    </div>
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
}) {
  const permissions = getRolePermissions(currentUser.role);
  const wide = useWideLayout();
  const [mobileDetailId, setMobileDetailId] = useState<string | null>(null);

  const detailAction = useMemo(
    () => (mobileDetailId ? actions.find((a) => a.id === mobileDetailId) : undefined),
    [actions, mobileDetailId],
  );

  useEffect(() => {
    if (wide) setMobileDetailId(null);
  }, [wide]);

  useEffect(() => {
    if (mobileDetailId && !actions.some((a) => a.id === mobileDetailId)) {
      setMobileDetailId(null);
    }
  }, [actions, mobileDetailId]);

  const openDetail = useCallback((id: string) => {
    if (!wide) setMobileDetailId(id);
  }, [wide]);

  if (!wide && detailAction) {
    return (
      <MobileActionDetail
        action={detailAction}
        role={currentUser.role}
        permissions={permissions}
        onBack={() => setMobileDetailId(null)}
        onAdvanceAction={onAdvanceAction}
        onAssignAction={onAssignAction}
        onAddEvidence={onAddEvidence}
        availableAuditors={availableAuditors}
      />
    );
  }

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
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              {canCompleteAuditAsAuditor(currentUser.role) ? "My actions" : "Corrective actions"}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              {canCompleteAuditAsAuditor(currentUser.role) ? "Assigned corrective actions" : "CAPA control centre"}
            </h2>
            <SectionIntro
              text={SECTION_INTROS.correctiveActions}
              className="mt-2"
              role={currentUser.role === "Auditor" ? "Auditor" : currentUser.role === "Manager" ? "Manager" : "Admin"}
            />
          </div>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200/90 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-3">
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
      </section>

      {actions.length === 0 ? (
        <EmptyPanel
          title="No open actions"
          text="Nothing needs follow-up here right now. Failed or flagged answers from audits can create actions automatically — you can also add one when a finding needs tracking."
        />
      ) : (
        <div className="space-y-3">
          {actions.map((action) => (
            <section
              key={action.id}
              className="cursor-pointer rounded-[1.6rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_30px_rgba(15,23,42,0.06)] lg:cursor-default"
              onClick={() => openDetail(action.id)}
              onKeyDown={(e) => {
                if (!wide && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  openDetail(action.id);
                }
              }}
              role={wide ? undefined : "button"}
              tabIndex={wide ? undefined : 0}
            >
              {(() => {
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
                const chip = statusChipForAction(action.status);
                return (
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <StatusChip variant={chip.variant}>{chip.label}</StatusChip>
                    <div className={`rounded-full px-3 py-1 text-xs font-semibold ${urgencyTone}`}>{urgency}</div>
                  </div>
                );
              })()}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-slate-500">Ref · {action.id}</p>
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
                    <MetaPill icon="clipboard" label={action.riskCategory} />
                    <MetaPill icon="user" label={action.assignedToName} />
                    <MetaPill icon="clock" label={action.dueDate || action.dueLabel} />
                    <MetaPill
                      icon="camera"
                      label={
                        action.evidenceRequired
                          ? action.evidenceCount === 0
                            ? "Evidence required"
                            : `${action.evidenceCount} photos`
                          : action.evidenceCount > 0
                            ? `${action.evidenceCount} photos`
                            : "Evidence optional"
                      }
                    />
                    {action.siteArea ? <MetaPill icon="clipboard" label={action.siteArea} /> : null}
                  </div>
                  <p className="mt-3 rounded-xl border border-sky-100 bg-sky-50/90 px-3 py-2 text-sm text-slate-800">
                    <span className="font-semibold text-slate-900">Next step. </span>
                    {getRecordNextStepText("action", action.status, currentUser.role, {
                      evidenceRequired: action.evidenceRequired,
                      evidenceCount: action.evidenceCount,
                    }).replace(/^Next step:\s*/i, "")}
                  </p>
                  {action.status !== "Closed" && action.evidenceRequired && action.evidenceCount === 0 && (
                    <p className="mt-2 text-xs font-semibold text-amber-800">Photos are still required before this can be verified.</p>
                  )}
                </div>
              </div>
              {(() => {
                const cta = getActionPrimaryCTA(action, permissions);
                return (
              <div className="mt-4 hidden flex-col gap-3 lg:flex" onClick={(e) => e.stopPropagation()}>
                {permissions.canAssignActions && (
                  <select
                    value={action.assignedToName}
                    onChange={(event) => onAssignAction(action.id, event.target.value)}
                    className={`min-h-[44px] w-full max-w-md rounded-2xl px-4 text-sm ${brandDarkFormControl}`}
                  >
                    {[action.assignedToName, ...availableAuditors].filter((value, index, list) => value && list.indexOf(value) === index).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  {cta.kind === "uploadEvidence" ? (
                    <button
                      type="button"
                      onClick={() => document.getElementById(`evidence-${action.id}`)?.click()}
                      className={`min-h-[44px] rounded-2xl bg-[var(--bert-signal-orange)] px-5 text-sm font-semibold text-[var(--qms-navy-950)] shadow-sm focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 ${slatePrimaryCtaInteract}`}
                    >
                      {cta.label}
                    </button>
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
                  ) : null}
                  {action.status === "In Progress" && cta.kind === "uploadEvidence" ? (
                    <button
                      type="button"
                      onClick={() => onAdvanceAction(action.id, "Awaiting Verification")}
                      className="min-h-[44px] rounded-2xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-300"
                    >
                      Mark ready for review
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
                  <label className={`inline-flex min-h-[44px] w-full max-w-xs cursor-pointer items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-slate-300`}>
                    Add photo evidence
                    <input
                      id={`evidence-${action.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        if (event.target.files?.length) {
                          onAddEvidence(action.id, event.target.files);
                          event.target.value = "";
                        }
                      }}
                    />
                  </label>
                ) : action.status !== "Closed" && cta.kind === "uploadEvidence" ? (
                  <input
                    id={`evidence-${action.id}`}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      if (event.target.files?.length) {
                        onAddEvidence(action.id, event.target.files);
                        event.target.value = "";
                      }
                    }}
                  />
                ) : null}
              </div>
                );
              })()}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
