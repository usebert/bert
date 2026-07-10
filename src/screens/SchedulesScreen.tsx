import { useEffect, useRef, useState } from "react";
import type { CompanyFolder, ScheduleAssigneeOption, ScheduleListFilter } from "../types/schedulesScreenProps";
import type { ScheduleAssigneeDiagnostics } from "../utils/scheduleAssignees";
import { formatUserRoleLabel } from "../utils/inviteStatusDisplay";
import type {
  ManagedSchedule,
  ManagedScheduleAudit,
  ScheduleCompletionMode,
  ScheduleDay,
  ScheduleFrequency,
  ScheduleHealthState,
} from "../types/reportsScreenProps";
import { EmptyPanel } from "../components/dashboard/DashboardPrimitives";
import { slatePrimaryCtaInteract } from "../styles/interactions";
import {
  formatScheduleNextDueLabel,
  resolveScheduleListStatusChip,
  scheduleLastCompletedLabel,
  scheduleNextDueLabel,
} from "../utils/assignedCheckCompletion";
import { formatScheduleCompletionModeLabel, resolveScheduleCompletionMode } from "../utils/scheduleCompletionMode";
import { darkPanelBody, darkPanelEyebrow, darkPanelShell, darkPanelTitleLg } from "../styles/darkPanel";
import { ArchiveRecordButton } from "../components/archive/ArchiveRecordButton";

const amberThresholdHours = 2;
const SCHEDULE_EDIT_PANEL_ID = "schedule-edit-panel";
const SCHEDULE_EDIT_SCROLL_OFFSET_PX = 16;

/** App shell scrolls inside `.qms-screen-stage`, not the window — scroll that container. */
function findScheduleScrollContainer(from: HTMLElement): HTMLElement {
  const stage = from.closest(".qms-screen-stage");
  if (stage instanceof HTMLElement) {
    return stage;
  }
  let parent: HTMLElement | null = from.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      parent.scrollHeight > parent.clientHeight + 1
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return (document.scrollingElement as HTMLElement) || document.documentElement;
}

function scrollScheduleEditPanelIntoView(panel: HTMLElement) {
  const container = findScheduleScrollContainer(panel);
  if (container === document.scrollingElement || container === document.documentElement || container === document.body) {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const containerRect = container.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const nextTop = container.scrollTop + (panelRect.top - containerRect.top) - SCHEDULE_EDIT_SCROLL_OFFSET_PX;
  container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
}

const scheduleDayOptions: ScheduleDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const scheduleFrequencyOptions: ScheduleFrequency[] = ["Daily", "Weekly", "Bi-Weekly", "Monthly"];
const scheduleDurationOptions = [1, 2, 4, 8, 12, 24, 48];
const scheduleTimeOptions = Array.from({ length: 48 }, (_, index) => {
  const hours = String(Math.floor(index / 2)).padStart(2, "0");
  const minutes = index % 2 === 0 ? "00" : "30";
  return `${hours}:${minutes}`;
});

/** Transitions only — hover uses shell-wide 15% contrasting overlay (.qms-app-shell / .qms-login-shell). */

/** Accent-filled fields (signal orange) — schedule editor; avoids washed-out OS styling on pale backgrounds in dark theme. */
const brandAccentFormField =
  "border border-[rgba(249,115,22,0.5)] bg-[var(--bert-signal-orange)] text-[var(--qms-navy-950)] shadow-[0_10px_26px_rgba(249,115,22,0.22)] outline-none transition focus:border-[var(--qms-navy-850)]";

function computeScheduleHealthState(schedule: ManagedSchedule): ScheduleHealthState {
  if (schedule.lifecycle === "Archived") {
    return "Paused";
  }
  if (schedule.healthState === "Paused") {
    if (schedule.nextDueAt) {
      const resumeAt = new Date(schedule.nextDueAt).getTime();
      if (Number.isFinite(resumeAt) && resumeAt > Date.now()) {
        return "Paused";
      }
    } else {
      return "Paused";
    }
  }
  if ((schedule.missedAuditCount || 0) > 0) {
    return "Failing";
  }
  if (schedule.nextDueAt) {
    const diffHours = Math.round((new Date(schedule.nextDueAt).getTime() - Date.now()) / 36e5);
    if (diffHours < 0) return "Overdue";
    if (diffHours < amberThresholdHours) return "Due Soon";
  }
  return "Healthy";
}

function SchedulesScreenIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const shared = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };

  switch (name) {
    case "clipboard":
      return (
        <svg {...shared}>
          <rect x="6" y="4" width="12" height="16" rx="2" />
          <path d="M9 4.5h6a1.5 1.5 0 0 0-1.5-1.5h-3A1.5 1.5 0 0 0 9 4.5Z" />
          <path d="M9 10h6" />
          <path d="M9 14h6" />
        </svg>
      );
    case "user":
      return (
        <svg {...shared}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 19a7 7 0 0 1 14 0" />
        </svg>
      );
    case "spark":
      return (
        <svg {...shared}>
          <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z" />
        </svg>
      );
    case "clock":
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 2.5" />
        </svg>
      );
    case "check":
      return (
        <svg {...shared}>
          <path d="m5 12 4 4 10-10" />
        </svg>
      );
    default:
      return null;
  }
}

function SectionHeader({
  icon,
  eyebrow,
  title,
  subtitle,
}: {
  icon: string;
  eyebrow?: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
        <SchedulesScreenIcon name={icon} className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{eyebrow}</p> : null}
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function MetaPill({
  icon,
  label,
  tone = "neutral",
}: {
  icon: string;
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const toneClasses =
    tone === "success"
      ? "bg-emerald-100 text-emerald-800"
      : tone === "warning"
        ? "bg-amber-100 text-amber-800"
        : tone === "danger"
          ? "bg-rose-100 text-rose-800"
          : tone === "info"
            ? "bg-blue-100 text-blue-800"
            : "bg-slate-100 text-slate-600";

  return (
    <div className={["inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold", toneClasses].join(" ")}>
      <SchedulesScreenIcon name={icon} className="h-3.5 w-3.5" />
      <span>{label}</span>
    </div>
  );
}

function scheduleStatusChipTone(chip: ReturnType<typeof resolveScheduleListStatusChip>) {
  if (chip === "Completed for period") {
    return "success";
  }
  if (chip === "Due soon" || chip === "Due") {
    return "warning";
  }
  if (chip === "Overdue") {
    return "danger";
  }
  if (chip === "Active") {
    return "info";
  }
  if (chip === "Paused") {
    return "neutral";
  }
  return "neutral";
}

function scheduleLifecycleStatusChip(schedule: ManagedSchedule) {
  return resolveScheduleListStatusChip(schedule);
}

export function SchedulesScreen({
  selectedFolder,
  schedules,
  filter,
  availableAudits,
  auditTemplatesLoading = false,
  auditTemplatesLoadError = "",
  availableAssignees,
  assigneeEmptyMessage = "No company profiles found for this company. Add people in People.",
  assigneeDiagnostics,
  showAssigneeDiagnostics = false,
  assigneeWarning = "",
  signedInEmail = "",
  editorOpen,
  editingSchedule,
  scheduleName,
  completionMode,
  selectedAuditIds,
  scheduleAudits,
  startDate,
  endDate,
  continuous,
  selectedAuditors,
  validationAttempted,
  onFilterChange,
  onOpenNew,
  onOpenSchedule,
  onToggleAudit,
  onToggleAuditDay,
  onAuditFieldChange,
  onScheduleNameChange,
  onCompletionModeChange,
  onStartDateChange,
  onEndDateChange,
  onContinuousChange,
  onToggleAuditor,
  onSave,
  saving = false,
  schedulesLoading = false,
  schedulesLoadError = "",
  onCancel,
  onReactivate,
  onDelete,
  onPause,
  onResume,
  archiveCompanyFolderId = "",
  archiveMasterSheetId,
  archiveOffline = false,
  canArchiveSchedules = false,
  onScheduleArchived,
  onArchiveError,
  onArchiveSuccess,
  companyActionsBlocked = false,
  companyActionsBlockedMessage = "",
}: {
  selectedFolder: CompanyFolder | null;
  companyActionsBlocked?: boolean;
  companyActionsBlockedMessage?: string;
  schedules: ManagedSchedule[];
  filter: ScheduleListFilter;
  availableAudits: { id: string; name: string }[];
  auditTemplatesLoading?: boolean;
  auditTemplatesLoadError?: string;
  availableAssignees: ScheduleAssigneeOption[];
  assigneeEmptyMessage?: string;
  assigneeDiagnostics?: ScheduleAssigneeDiagnostics;
  showAssigneeDiagnostics?: boolean;
  assigneeWarning?: string;
  signedInEmail?: string;
  editorOpen: boolean;
  editingSchedule: ManagedSchedule | null;
  scheduleName: string;
  completionMode: ScheduleCompletionMode;
  selectedAuditIds: string[];
  scheduleAudits: ManagedScheduleAudit[];
  startDate: string;
  endDate: string;
  continuous: boolean;
  selectedAuditors: string[];
  validationAttempted: boolean;
  onFilterChange: (value: ScheduleListFilter) => void;
  onOpenNew: () => void;
  onOpenSchedule: (scheduleId: string) => void;
  onToggleAudit: (auditId: string, auditName: string) => void;
  onToggleAuditDay: (auditId: string, day: ScheduleDay) => void;
  onAuditFieldChange: (auditId: string, field: "frequency" | "liveTime" | "completionHours", value: string) => void;
  onScheduleNameChange: (value: string) => void;
  onCompletionModeChange: (value: ScheduleCompletionMode) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onContinuousChange: (value: boolean) => void;
  onToggleAuditor: (auditorId: string) => void;
  onSave: () => void;
  saving?: boolean;
  schedulesLoading?: boolean;
  schedulesLoadError?: string;
  onCancel: () => void;
  onReactivate: (scheduleId: string) => void;
  onDelete: (scheduleId: string) => void;
  onPause: (scheduleId: string) => void;
  onResume: (scheduleId: string) => void;
  archiveCompanyFolderId?: string;
  archiveMasterSheetId?: string;
  archiveOffline?: boolean;
  canArchiveSchedules?: boolean;
  onScheduleArchived?: (scheduleId: string) => void | Promise<void>;
  onArchiveError?: (message: string) => void;
  onArchiveSuccess?: () => void;
}) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [editScrollNonce, setEditScrollNonce] = useState(0);
  const shouldScrollToEditRef = useRef(false);
  const editPanelRef = useRef<HTMLElement | null>(null);
  const nameError = validationAttempted && !scheduleName.trim();
  const auditsError = validationAttempted && scheduleAudits.length === 0;
  const startDateError = validationAttempted && !startDate;
  const auditorsError = validationAttempted && selectedAuditors.length === 0;

  const requestScrollToEditPanel = () => {
    shouldScrollToEditRef.current = true;
    setEditScrollNonce((value) => value + 1);
  };

  useEffect(() => {
    if (!editorOpen || !shouldScrollToEditRef.current) {
      return;
    }

    let cancelled = false;
    let attempt = 0;
    const timers: number[] = [];

    const finishFocus = (panel: HTMLElement) => {
      const firstField = panel.querySelector<HTMLElement>("#schedule-builder-name, input, select, textarea");
      const heading = panel.querySelector<HTMLElement>("#schedule-edit-panel-heading");
      window.setTimeout(() => {
        if (cancelled) return;
        if (firstField && typeof firstField.focus === "function") {
          firstField.focus({ preventScroll: true });
        } else if (heading && typeof heading.focus === "function") {
          heading.focus({ preventScroll: true });
        }
      }, 180);
    };

    const tryScroll = () => {
      if (cancelled) return;
      const panel =
        editPanelRef.current ||
        (document.getElementById(SCHEDULE_EDIT_PANEL_ID) as HTMLElement | null);
      if (!panel) {
        attempt += 1;
        if (attempt < 12) {
          timers.push(window.setTimeout(tryScroll, 32));
        }
        return;
      }
      shouldScrollToEditRef.current = false;
      scrollScheduleEditPanelIntoView(panel);
      finishFocus(panel);
    };

    // Wait for parent edit state + panel mount/layout inside .qms-screen-stage.
    timers.push(
      window.setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(tryScroll);
        });
      }, 0),
    );

    return () => {
      cancelled = true;
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [editorOpen, editingSchedule?.id, editScrollNonce]);

  return (
    <div className="space-y-4">
      <section className={darkPanelShell}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white">
              <SchedulesScreenIcon name="clock" className="h-5 w-5" />
            </div>
            <div>
              <p className={darkPanelEyebrow}>Schedules</p>
              <h2 className={darkPanelTitleLg}>Live schedules</h2>
              <p className={["mt-2", darkPanelBody].join(" ")}>
                Create, edit, archive, and reactivate company audit schedules for {selectedFolder?.name || "the live workspace"}.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              onOpenNew();
              requestScrollToEditPanel();
            }}
            disabled={companyActionsBlocked}
            title={companyActionsBlocked ? companyActionsBlockedMessage : undefined}
            className={`h-12 rounded-2xl px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${brandAccentFormField} ${slatePrimaryCtaInteract}`}
          >
            Add new schedule
          </button>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <div className="flex items-end justify-between gap-3">
          <SectionHeader
            icon="clock"
            eyebrow="Schedule list"
            title={filter}
            subtitle="Open a schedule to edit its timings, audits, assigned users, and revision history."
          />
          <div className="w-full max-w-[18rem]">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Schedule view</label>
            <select
              value={filter}
              onChange={(event) => onFilterChange(event.target.value as ScheduleListFilter)}
              className={`h-12 w-full rounded-2xl px-4 text-sm ${brandAccentFormField}`}
            >
              <option value="Live">Live</option>
              <option value="Archived">Archived</option>
              <option value="All schedules">All schedules</option>
            </select>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {schedulesLoadError ? (
            <EmptyPanel title="Schedules unavailable" text={schedulesLoadError} />
          ) : schedulesLoading && schedules.length === 0 ? (
            <EmptyPanel title="Loading schedules" text="Pulling live schedules for this company…" />
          ) : schedules.length === 0 ? (
            <EmptyPanel
              title="No schedules found"
              text="Nothing listed — add a schedule or switch Live / Archived so saved schedules can appear here."
            />
          ) : (
            schedules.map((schedule) => {
              const statusChip = scheduleLifecycleStatusChip(schedule);
              const nextDueLabel = scheduleNextDueLabel(schedule);
              return (
              <div key={schedule.id} className="rounded-[1.4rem] border border-[rgba(249,115,22,0.35)] bg-[rgba(249,115,22,0.1)] px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{schedule.scheduleName}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <MetaPill icon="spark" label={`${schedule.lifecycle} rev ${schedule.versionLabel}`} />
                      <MetaPill icon="clipboard" label={`${schedule.audits.length} audits`} />
                      <MetaPill icon="user" label={`${schedule.auditors.length} assigned`} />
                      {statusChip ? (
                        <MetaPill icon="check" label={statusChip} tone={scheduleStatusChipTone(statusChip)} />
                      ) : null}
                      {statusChip === "Paused" && schedule.nextDueAt ? (
                        <MetaPill icon="clock" label={`Resumes ${formatScheduleNextDueLabel(schedule.nextDueAt)}`} />
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Last completed: {scheduleLastCompletedLabel(schedule)}
                    </p>
                    {nextDueLabel ? (
                      <p className="mt-1 text-xs text-slate-600">Next due: {nextDueLabel}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-600">
                      Completion mode: {formatScheduleCompletionModeLabel(resolveScheduleCompletionMode(schedule))}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Start {schedule.startDate} {schedule.endDate ? `• End ${schedule.endDate}` : "• No end date"}
                      {schedule.audits[0]?.frequency ? ` • ${schedule.audits[0].frequency}` : ""}
                    </p>
                    {schedule.createdBy || schedule.createdAt ? (
                      <p className="mt-1 text-xs text-slate-400">
                        Created
                        {schedule.createdBy ? ` by ${schedule.createdBy}` : ""}
                        {schedule.createdAt
                          ? ` at ${schedule.createdAt}`
                          : schedule.updatedAt
                            ? ` • Updated ${schedule.updatedAt}`
                            : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        onOpenSchedule(schedule.id);
                        requestScrollToEditPanel();
                      }}
                      className={`rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white ${slatePrimaryCtaInteract}`}
                    >
                      Edit
                    </button>
                    <button onClick={() => onDelete(schedule.id)} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                      Delete
                    </button>
                    {schedule.lifecycle !== "Archived" &&
                    canArchiveSchedules &&
                    archiveCompanyFolderId &&
                    onScheduleArchived ? (
                      <ArchiveRecordButton
                        recordType="schedule"
                        recordId={schedule.id}
                        companyFolderId={archiveCompanyFolderId}
                        masterSheetId={archiveMasterSheetId}
                        offlineMode={archiveOffline}
                        canArchive={canArchiveSchedules}
                        label="Archive"
                        extraMessage="It will be removed from active and due views and can be restored from Archive."
                        onArchived={() => onScheduleArchived(schedule.id)}
                        onError={onArchiveError}
                        onSuccess={onArchiveSuccess}
                      />
                    ) : null}
                    {computeScheduleHealthState(schedule) === "Paused" ? (
                      <button onClick={() => onResume(schedule.id)} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
                        Resume
                      </button>
                    ) : (
                      <button onClick={() => onPause(schedule.id)} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                        Pause
                      </button>
                    )}
                    {schedule.lifecycle === "Archived" && (
                      <button onClick={() => onReactivate(schedule.id)} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
            })
          )}
        </div>
      </section>

      {editorOpen && (
        <section
          ref={editPanelRef}
          id={SCHEDULE_EDIT_PANEL_ID}
          data-testid="schedule-edit-panel"
          tabIndex={-1}
          className="scroll-mt-6 rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)] outline-none"
        >
          <h3
            id="schedule-edit-panel-heading"
            tabIndex={-1}
            className="sr-only outline-none"
          >
            {editingSchedule ? "Edit schedule" : "Create schedule"}
          </h3>
          <SectionHeader
            icon="check"
            eyebrow="Schedule builder"
            title={editingSchedule ? "Edit schedule" : "Create schedule"}
            subtitle="Choose audits, set timings, assign users, and save the live or archived revision."
          />
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Schedule name or ID</label>
              <input
                id="schedule-builder-name"
                value={scheduleName}
                onChange={(event) => onScheduleNameChange(event.target.value)}
                className={[
                  "h-12 w-full rounded-2xl px-4 text-sm outline-none transition",
                  brandAccentFormField,
                  nameError ? "border-rose-400 ring-1 ring-rose-400" : "",
                ].join(" ")}
                placeholder="Enter the schedule name"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Completion mode</label>
              <select
                value={completionMode}
                onChange={(event) => onCompletionModeChange(event.target.value as ScheduleCompletionMode)}
                className={`h-12 w-full rounded-2xl px-4 text-sm ${brandAccentFormField}`}
              >
                <option value="repeatable">Repeatable</option>
                <option value="once-per-period">Once per due period</option>
              </select>
              <p className="mt-2 text-xs text-slate-500">
                Repeatable checks stay available after completion. Once per due period hides the check until the next due window.
              </p>
            </div>

            <div className={["rounded-[1.5rem] border p-4", auditsError ? "border-rose-300 bg-rose-50/50" : "border-slate-200 bg-slate-50"].join(" ")}>
              <p className="text-sm font-semibold text-slate-900">Select audits for this schedule</p>
              <div className="mt-3 space-y-2">
                {availableAudits.length === 0 ? (
                  <EmptyPanel
                    title={auditTemplatesLoading ? "Loading audit templates…" : "No audit templates yet"}
                    text={
                      auditTemplatesLoading
                        ? "Reading audit templates from your company workbook…"
                        : auditTemplatesLoadError ||
                          "Add audit templates in Audit Builder or the AuditTemplates workbook tab before creating a schedule."
                    }
                  />
                ) : (
                  availableAudits.map((audit) => {
                  const selected = selectedAuditIds.includes(audit.id);
                  return (
                    <label
                      key={audit.id}
                      className={[
                        "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left",
                        selected
                          ? "border-[rgba(249,115,22,0.55)] bg-[rgba(249,115,22,0.18)]"
                          : "border-[rgba(249,115,22,0.28)] bg-[rgba(249,115,22,0.08)]",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => onToggleAudit(audit.id, audit.name)}
                          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                        />
                        <span className="text-sm font-semibold text-slate-900">{audit.name}</span>
                      </div>
                      <span className={["rounded-full px-3 py-1 text-xs font-semibold", selected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"].join(" ")}>
                        {selected ? "Added" : "Add"}
                      </span>
                    </label>
                  );
                  })
                )}
              </div>
              {auditsError && availableAudits.length > 0 && (
                <p className="mt-2 text-xs font-semibold text-rose-600">Select at least one audit for this schedule.</p>
              )}
            </div>

            {scheduleAudits.map((audit) => {
              const auditError = validationAttempted && audit.days.length === 0;
              return (
                <div key={audit.id} className="rounded-[1.5rem] border border-[rgba(249,115,22,0.35)] bg-[rgba(249,115,22,0.08)] p-4">
                  <p className="text-sm font-semibold text-slate-900">{audit.auditName}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {scheduleDayOptions.map((day) => {
                      const selected = audit.days.includes(day);
                      return (
                        <label
                          key={day}
                          className={[
                            "inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold",
                            selected ? `bg-slate-900 text-white ${slatePrimaryCtaInteract}` : "bg-slate-100 text-slate-600 transition-colors duration-200 hover:bg-slate-200",
                          ].join(" ")}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => onToggleAuditDay(audit.auditId, day)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                          />
                          {day}
                        </label>
                      );
                    })}
                  </div>
                  {auditError && <p className="mt-2 text-xs font-semibold text-rose-600">Select at least one day.</p>}
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <select
                      value={audit.frequency}
                      onChange={(event) => onAuditFieldChange(audit.auditId, "frequency", event.target.value)}
                      className={`h-12 rounded-2xl px-4 text-sm ${brandAccentFormField}`}
                    >
                      {scheduleFrequencyOptions.map((frequency) => (
                        <option key={frequency} value={frequency}>{frequency}</option>
                      ))}
                    </select>
                    <select
                      value={audit.liveTime}
                      onChange={(event) => onAuditFieldChange(audit.auditId, "liveTime", event.target.value)}
                      className={`h-12 rounded-2xl px-4 text-sm ${brandAccentFormField}`}
                    >
                      {scheduleTimeOptions.map((time) => (
                        <option key={time} value={time}>{time}</option>
                      ))}
                    </select>
                    <select
                      value={String(audit.completionHours)}
                      onChange={(event) => onAuditFieldChange(audit.auditId, "completionHours", event.target.value)}
                      className={`h-12 rounded-2xl px-4 text-sm ${brandAccentFormField}`}
                    >
                      {scheduleDurationOptions.map((hours) => (
                        <option key={hours} value={hours}>{hours} hours to complete</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Start date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => onStartDateChange(event.target.value)}
                  className={[
                    "h-12 w-full rounded-2xl px-4 text-sm outline-none transition",
                    brandAccentFormField,
                    startDateError ? "border-rose-400 ring-1 ring-rose-400" : "",
                  ].join(" ")}
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">End date</label>
                <label className="mb-2 flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={continuous}
                    onChange={(event) => {
                      onContinuousChange(event.target.checked);
                      if (event.target.checked) {
                        onEndDateChange("");
                      }
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                  />
                  Continuous until an end date is given
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => {
                    onEndDateChange(event.target.value);
                    if (event.target.value) {
                      onContinuousChange(false);
                    }
                  }}
                  disabled={continuous}
                  className={[
                    "h-12 w-full rounded-2xl px-4 text-sm outline-none transition",
                    continuous
                      ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                      : brandAccentFormField,
                  ].join(" ")}
                />
              </div>
            </div>

            <div className={["rounded-[1.5rem] border p-4", auditorsError ? "border-rose-300 bg-rose-50/50" : "border-slate-200 bg-slate-50"].join(" ")}>
              <p className="text-sm font-semibold text-slate-900">Assign users to this schedule</p>
              {assigneeWarning ? (
                <p className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  {assigneeWarning}
                </p>
              ) : null}
              <div className="mt-3 space-y-2">
                {availableAssignees.length === 0 ? (
                  <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                    {assigneeEmptyMessage}
                  </p>
                ) : (
                  availableAssignees.map((assignee) => {
                    const selected = selectedAuditors.includes(assignee.id);
                    const areasLabel =
                      assignee.companyAreas.length > 0 ? assignee.companyAreas.join(", ") : "No areas assigned";
                    return (
                      <label
                        key={assignee.id}
                        className={[
                          "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left",
                          selected
                            ? "border-[rgba(249,115,22,0.55)] bg-[rgba(249,115,22,0.18)]"
                            : "border-[rgba(249,115,22,0.28)] bg-[rgba(249,115,22,0.08)]",
                        ].join(" ")}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => onToggleAuditor(assignee.id)}
                            className="h-4 w-4 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{assignee.name}</p>
                            <p className="text-xs text-slate-500">
                              {formatUserRoleLabel(assignee.role)} • {assignee.email}
                            </p>
                            <p className="text-xs text-slate-500">Areas: {areasLabel}</p>
                            {assignee.areaWarning ? (
                              <p className="mt-1 text-xs font-medium text-amber-700">{assignee.areaWarning}</p>
                            ) : null}
                          </div>
                        </div>
                        <span className={["shrink-0 rounded-full px-3 py-1 text-xs font-semibold", selected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"].join(" ")}>
                          {selected ? "Added" : "Add"}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              {showAssigneeDiagnostics && assigneeDiagnostics ? (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setShowTechnicalDetails((value) => !value)}
                    className="text-xs font-semibold text-slate-700 underline-offset-2 hover:underline"
                  >
                    {showTechnicalDetails ? "Hide advanced diagnostics" : "Advanced diagnostics"}
                  </button>
                  {showTechnicalDetails ? (
                    <dl className="mt-3 grid gap-2 text-xs text-slate-600">
                      <div>
                        <dt className="font-semibold text-slate-800">currentCompanyId</dt>
                        <dd>{assigneeDiagnostics.currentCompanyId || assigneeDiagnostics.companyId || "—"}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">currentCompanyName</dt>
                        <dd>{assigneeDiagnostics.currentCompanyName || "—"}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">masterSheetId</dt>
                        <dd>{assigneeDiagnostics.masterSheetId || "—"}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">signedInEmail</dt>
                        <dd>{assigneeDiagnostics.signedInEmail || signedInEmail || "—"}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">totalUsersRead</dt>
                        <dd>{assigneeDiagnostics.totalUsersRead ?? assigneeDiagnostics.totalRows ?? 0}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">profilesReturned</dt>
                        <dd>{assigneeDiagnostics.profilesReturned ?? assigneeDiagnostics.totalRows ?? 0}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">activeOnlyCount</dt>
                        <dd>{assigneeDiagnostics.activeOnlyCount ?? assigneeDiagnostics.activeUsersFound ?? assigneeDiagnostics.activeCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">assignableUsersReturned</dt>
                        <dd>{assigneeDiagnostics.assignableUsersReturned ?? assigneeDiagnostics.finalCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">excludedByStatus</dt>
                        <dd>{assigneeDiagnostics.excludedByStatus ?? 0}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">excludedByCompany</dt>
                        <dd>{assigneeDiagnostics.excludedByCompany ?? 0}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">excludedByArea</dt>
                        <dd>{assigneeDiagnostics.excludedByArea ?? 0}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">dataSource</dt>
                        <dd>{assigneeDiagnostics.dataSource || "—"}</dd>
                      </div>
                    </dl>
                  ) : null}
                </div>
              ) : null}
              {auditorsError && (
                <p className="mt-2 text-xs font-semibold text-rose-600">
                  Please select at least one user for this schedule.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={onSave}
                disabled={saving}
                className={`h-12 rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${slatePrimaryCtaInteract}`}
              >
                {saving ? "Saving schedule…" : "Save schedule"}
              </button>
              <button onClick={onCancel} className="h-12 rounded-2xl bg-slate-100 px-5 text-sm font-semibold text-slate-700">
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
