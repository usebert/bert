/**
 * Extracted from App.tsx. The role-specific sub-dashboards (Auditor / Manager / Admin) are
 * injected as render-prop functions from App.tsx so this screen does not need to know their
 * full prop surface or duplicate the helpers they depend on (storageKeys, useDashboardSectionLayout,
 * rankAuditorAudit, etc.). Small presentational helpers and the dashboard branch logic remain here.
 *
 * Note on drift risk: getAuditTrafficStatus / getDueWarning / computeScheduleHealthState /
 * amberThresholdHours / statusStyles / AppIcon / SectionHeader / MetaPill / StatusBadge /
 * KpiCard / EmptyPanel / TrendBar / TrafficLane / DashboardBertFlowStrip are duplicated from
 * App.tsx because they are not exported. Keep aligned with App.tsx if those helpers change.
 */

import { ReactNode, useMemo, useState } from "react";
import {
  canAccessAdmin,
  canAccessAuditsCentre,
  canCompleteAssignedCheck,
} from "../permissions";
import type {
  ActionItem,
  Audit,
  AuditStatus,
  HistoryEntry,
  ManagedSchedule,
} from "../types/reportsScreenProps";
import type {
  DashboardPreferences,
  DashboardSectionKey,
  RiskSummary,
} from "../types/dashboard";
import type {
  AuditDraft,
  CompanyFolder,
  CompanySheetSyncStatus,
  ThemeMode,
  User,
  WorkspaceValidation,
} from "../types/dashboardScreenProps";
import {
  EmptyPanel,
  KpiCard,
  MetaPill,
  SectionHeader,
  StartHereCard,
  StatusBadge,
  TrendBar,
} from "../components/dashboard/DashboardPrimitives";
import { ControlLoopStrip, deriveControlLoopState } from "../components/dashboard/ControlLoopStrip";
import {
  amberThresholdHours,
  computeScheduleHealthState,
  getAuditTrafficStatus,
  getDueWarning,
  statusStyles,
} from "../utils/dashboardHealth";
import { isDebugUiAllowed } from "../utils/debugUiVisibility";

function TrafficLane({
  title,
  subtitle,
  audits,
  status,
  onOpenAudit,
}: {
  title: string;
  subtitle: string;
  audits: Audit[];
  status: AuditStatus;
  onOpenAudit: (auditId: string) => void;
}) {
  const visibleAudits = audits.slice(0, 1);
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
            className="w-full rounded-xl bg-white/95 px-3 py-2 text-left shadow-[0_6px_14px_rgba(15,23,42,0.06)] transition active:scale-[0.99]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900">{audit.name}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {audit.siteArea} • {audit.priority} • Owner {audit.owner}
                </p>
                <p className="mt-1 text-[10px] font-medium text-slate-600">{getDueWarning(audit.dueHours)}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">Last completed {audit.lastCompletedAt}</p>
              </div>
              <div className="shrink-0 space-y-1 text-right">
                <StatusBadge status={getAuditTrafficStatus(audit.dueHours)} />
                <div className="text-[10px] text-slate-400">{audit.dueLabel}</div>
              </div>
            </div>
          </button>
        ))}
        {hiddenCount > 0 && <div className="px-1 text-[10px] font-semibold text-slate-500">+{hiddenCount} more</div>}
        {audits.length === 0 && (
          <div className="rounded-xl bg-white/85 px-3 py-2 text-xs text-slate-500 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)]">
            <p className="font-semibold text-slate-700">Nothing in this due window</p>
            <p className="mt-0.5">Audits appear here when assigned and they match this lane.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function DashboardScreen({
  currentUser,
  workspaceName,
  compliance,
  complianceDelta,
  groupedAudits,
  actions,
  openActions,
  overdueActions,
  criticalActions,
  awaitingVerificationActions,
  overdueAudits,
  evidenceCount,
  completedToday,
  offlineQueueCount,
  pendingSyncCount,
  failedSyncCount,
  assignedAudits,
  history,
  drafts,
  companySheetSync,
  auditCompletionRate,
  actionClosureRate,
  averageActionClosureDays,
  recurringFailedQuestions,
  topOverdueSchedules,
  riskSummary,
  themeMode,
  dashboardPreferences,
  dashboardSectionOrder,
  onOpenAudit,
  onAdvanceAction,
  onApplyDashboardPreset,
  onToggleDashboardSection,
  onMoveDashboardSection,
  reportUsersCount,
  activeSchedulesCount,
  templatesCount,
  workspaceValidation,
  selectedFolder,
  onValidateWorkspace,
  onRepairWorkspace,
  onLoadDemoData,
  onClearDemoData,
  showStartHereCard,
  demoModeActive,
  renderAuditorDashboard,
  renderManagerDashboard,
  renderAdminDashboard,
  renderMasterDashboard,
}: {
  currentUser: User;
  workspaceName: string;
  compliance: number;
  complianceDelta: number;
  groupedAudits: Record<AuditStatus, Audit[]>;
  actions: ActionItem[];
  openActions: ActionItem[];
  overdueActions: ActionItem[];
  criticalActions: ActionItem[];
  awaitingVerificationActions: ActionItem[];
  overdueAudits: Audit[];
  evidenceCount: number;
  completedToday: number;
  offlineQueueCount: number;
  pendingSyncCount: number;
  failedSyncCount: number;
  assignedAudits: Audit[];
  history: HistoryEntry[];
  drafts: Record<string, AuditDraft>;
  companySheetSync: CompanySheetSyncStatus | null;
  auditCompletionRate: number;
  actionClosureRate: number;
  averageActionClosureDays: number;
  recurringFailedQuestions: [string, number][];
  topOverdueSchedules: ManagedSchedule[];
  riskSummary: RiskSummary;
  themeMode: ThemeMode;
  dashboardPreferences: DashboardPreferences;
  dashboardSectionOrder: DashboardSectionKey[];
  onOpenAudit: (auditId: string) => void;
  onAdvanceAction: (actionId: string) => void;
  onApplyDashboardPreset: (preset: "minimal" | "operations" | "executive") => void;
  onToggleDashboardSection: (section: DashboardSectionKey) => void;
  onMoveDashboardSection: (section: DashboardSectionKey, direction: "up" | "down") => void;
  reportUsersCount: number;
  activeSchedulesCount: number;
  templatesCount: number;
  workspaceValidation: WorkspaceValidation | null;
  selectedFolder: CompanyFolder | null;
  onValidateWorkspace: () => void;
  onRepairWorkspace: () => void;
  onLoadDemoData: () => void;
  onClearDemoData: () => void;
  showStartHereCard: boolean;
  demoModeActive: boolean;
  renderAuditorDashboard: () => ReactNode;
  renderManagerDashboard: () => ReactNode;
  renderAdminDashboard: () => ReactNode;
  renderMasterDashboard: () => ReactNode;
}) {
  const [showDashboardOptions, setShowDashboardOptions] = useState(false);
  void workspaceName;
  void awaitingVerificationActions;
  void companySheetSync;
  void workspaceValidation;
  void onValidateWorkspace;
  void onRepairWorkspace;
  void onLoadDemoData;
  void onClearDemoData;
  void demoModeActive;
  void reportUsersCount;
  void activeSchedulesCount;
  void templatesCount;
  void pendingSyncCount;
  void failedSyncCount;
  if (currentUser.role === "Master") {
    return <>{renderMasterDashboard()}</>;
  }

  if (canCompleteAssignedCheck(currentUser.role) && !canAccessAuditsCentre(currentUser.role)) {
    return <>{renderAuditorDashboard()}</>;
  }

  if (currentUser.role === "Manager") {
    return <>{renderManagerDashboard()}</>;
  }

  if (currentUser.role === "Admin") {
    return <>{renderAdminDashboard()}</>;
  }

  const workspaceLinked = Boolean(selectedFolder);
  const openOrInProgressActions = useMemo(
    () => actions.filter((a) => a.status === "Open" || a.status === "In Progress").length,
    [actions],
  );
  const awaitingVerificationCount = useMemo(
    () => actions.filter((a) => a.status === "Awaiting Verification").length,
    [actions],
  );
  const controlLoop = useMemo(
    () =>
      deriveControlLoopState({
        workspaceLinked,
        hasAssignedAudits: assignedAudits.length > 0,
        openOrInProgressActions,
        awaitingVerificationCount,
        recentCompletionCount: history.length,
      }),
    [workspaceLinked, assignedAudits.length, openOrInProgressActions, awaitingVerificationCount, history.length],
  );

  const visibleSectionOrder = dashboardSectionOrder.filter((key) => dashboardPreferences[key]);

  const dashboardSectionDisplayNames: Record<DashboardSectionKey, string> = {
    trafficBoard: "Needs attention",
    upcomingAudits: "Due today",
    openActions: "Open work",
    liveSummary: "Ready to report",
    complianceSnapshot: "Workspace health",
  };

  const renderSection = (section: DashboardSectionKey) => {
    if (section === "trafficBoard") {
      return (
        <section key={section} className="rounded-2xl border border-sky-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
          <SectionHeader icon="dashboard" eyebrow="Needs attention" title="Audit traffic" subtitle="Overdue, due soon, and on-track audits at a glance." />
          <div className="mt-2 grid gap-2">
            <TrafficLane title="Red" subtitle="Overdue" audits={groupedAudits.red.slice(0, 1)} status="red" onOpenAudit={onOpenAudit} />
            <TrafficLane title="Amber" subtitle={`<${amberThresholdHours}h remaining`} audits={groupedAudits.amber.slice(0, 1)} status="amber" onOpenAudit={onOpenAudit} />
            <TrafficLane title="Green" subtitle={`>${amberThresholdHours}h remaining`} audits={groupedAudits.green.slice(0, 1)} status="green" onOpenAudit={onOpenAudit} />
          </div>
        </section>
      );
    }
    if (section === "liveSummary") {
      return (
        <section key={section} className="rounded-2xl border border-sky-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
          <SectionHeader icon="chart" eyebrow="Ready to report" title="Key numbers" subtitle="Compliance, completion, open actions, and queue in one place." />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <KpiCard title="Open actions" value={String(openActions.length)} tone={openActions.length ? "amber" : "green"} subtitle={`${overdueActions.length} overdue`} dark={themeMode === "dark"} />
            <KpiCard title="Compliance" value={`${compliance}%`} tone="green" subtitle={complianceDelta >= 0 ? `Up ${complianceDelta}%` : `Down ${Math.abs(complianceDelta)}%`} dark={themeMode === "dark"} />
            <KpiCard title="Completion" value={`${auditCompletionRate}%`} tone={auditCompletionRate > 79 ? "green" : "amber"} subtitle={`${completedToday} today`} dark={themeMode === "dark"} />
            <KpiCard title="Work waiting to sync" value={String(offlineQueueCount)} tone={offlineQueueCount ? "amber" : "green"} subtitle={`${evidenceCount} evidence`} dark={themeMode === "dark"} />
          </div>
        </section>
      );
    }
    if (section === "upcomingAudits") {
      return (
        <section key={section} className="rounded-2xl border border-sky-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
          <SectionHeader icon="clipboard" eyebrow="Due today" title="Upcoming audits" subtitle="What to plan or open next from your assigned work." />
          <div className="mt-2 space-y-2">
            {assignedAudits.slice(0, 4).map((audit) => (
              <button key={audit.id} onClick={() => onOpenAudit(audit.id)} className="w-full rounded-xl border border-sky-200/70 bg-slate-50 px-3 py-2.5 text-left transition hover:bg-white">
                <p className="text-sm font-semibold text-slate-900">{audit.name}</p>
                <p className="mt-1 text-xs text-slate-500">{audit.siteArea} - {getDueWarning(audit.dueHours)}</p>
              </button>
            ))}
            {assignedAudits.length === 0 && (
              <EmptyPanel
                title="Nothing assigned yet"
                text="No audits in your queue right now. When schedules and access are set, upcoming field work will land here."
              />
            )}
          </div>
        </section>
      );
    }
    if (section === "openActions") {
      return (
        <section key={section} className="rounded-2xl border border-sky-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
          <SectionHeader icon="warningTriangle" eyebrow="Open work" title="Open actions" subtitle="Items needing progress or verification." />
          <div className="mt-2 space-y-2">
            {actions.slice(0, 4).map((action) => (
              <button key={action.id} onClick={() => onAdvanceAction(action.id)} className="w-full rounded-xl border border-sky-200/70 bg-slate-50 px-3 py-2.5 text-left transition hover:bg-white">
                <p className="text-sm font-semibold text-slate-900">{action.questionText}</p>
                <p className="mt-1 text-xs text-slate-500">{action.owner} - {action.status}</p>
              </button>
            ))}
          </div>
        </section>
      );
    }
    return (
      <section key={section} className="rounded-2xl border border-sky-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
        <SectionHeader icon="shield" eyebrow="Workspace health" title="Risk & closure" subtitle="Critical or high actions and how quickly work closes." />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <KpiCard title="Critical/high" value={String(criticalActions.length)} tone={criticalActions.length ? "red" : "green"} subtitle={`${riskSummary.criticalFindings} critical`} dark={themeMode === "dark"} />
          <KpiCard title="Closure rate" value={`${actionClosureRate}%`} tone={actionClosureRate > 79 ? "green" : "amber"} subtitle={`${averageActionClosureDays || 0} days avg`} dark={themeMode === "dark"} />
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-4">
      {showStartHereCard && <StartHereCard />}
      <section className="rounded-2xl border border-slate-700/80 bg-gradient-to-r from-slate-950 via-[#0c1f36] to-slate-950 px-4 py-3.5 text-white shadow-[0_12px_28px_rgba(2,6,23,0.28)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Control loop</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">bert.</h2>
            <p className="mt-0.5 text-xs text-slate-400">Business. Evaluate. Report. Tool.</p>
            {selectedFolder ? (
              <p className="mt-1 text-[11px] font-medium text-slate-400">Workspace: {selectedFolder.name}</p>
            ) : null}
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-300">
              Provision through report — where you are in the quality cycle right now.
            </p>
            <ControlLoopStrip currentStepIndex={controlLoop.currentStepIndex} tone="onDark" className="mt-2" role={currentUser.role} />
          </div>
          {isDebugUiAllowed() ? (
            <div className="flex shrink-0 flex-col items-end gap-2">
              <button
                type="button"
                onClick={() => setShowDashboardOptions((current) => !current)}
                className="h-8 rounded-lg bg-white/12 px-3 text-xs font-semibold text-white"
              >
                Customize
              </button>
              <div className="rounded-xl bg-white/10 px-3 py-1.5 text-right">
                <p className="text-[11px] text-slate-300">Overdue audits</p>
                <p className="text-lg font-semibold">{overdueAudits.length}</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>
      {isDebugUiAllowed() && showDashboardOptions && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Dashboard options</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => onApplyDashboardPreset("minimal")} className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">Minimal</button>
            <button onClick={() => onApplyDashboardPreset("operations")} className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">Operations</button>
            <button onClick={() => onApplyDashboardPreset("executive")} className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">Executive</button>
          </div>
          <div className="mt-3 space-y-2">
            {dashboardSectionOrder.map((section, index) => (
              <div key={section} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <input type="checkbox" checked={dashboardPreferences[section]} onChange={() => onToggleDashboardSection(section)} />
                <span className="min-w-0 flex-1 text-sm text-slate-700">{dashboardSectionDisplayNames[section]}</span>
                <button onClick={() => onMoveDashboardSection(section, "up")} disabled={index === 0} className="h-7 rounded border border-slate-200 bg-white px-2 text-xs">↑</button>
                <button onClick={() => onMoveDashboardSection(section, "down")} disabled={index === dashboardSectionOrder.length - 1} className="h-7 rounded border border-slate-200 bg-white px-2 text-xs">↓</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {visibleSectionOrder.map((section) => renderSection(section))}
      </div>

      <section className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <SectionHeader
          icon="chart"
          eyebrow="Ready to report"
          title="Progress trends"
          subtitle="Audit traffic, completion, and where action work is piling up."
        />
        <div className="space-y-3">
          <TrendBar label="Green audits" value={groupedAudits.green.length} total={Math.max(1, groupedAudits.green.length + groupedAudits.amber.length + groupedAudits.red.length)} tone="green" />
          <TrendBar label="Amber audits" value={groupedAudits.amber.length} total={Math.max(1, groupedAudits.green.length + groupedAudits.amber.length + groupedAudits.red.length)} tone="amber" />
          <TrendBar label="Red audits" value={groupedAudits.red.length} total={Math.max(1, groupedAudits.green.length + groupedAudits.amber.length + groupedAudits.red.length)} tone="red" />
          <TrendBar label="Actions in progress" value={actions.filter((item) => item.status === "In Progress").length} total={Math.max(1, actions.length || 1)} tone="amber" />
          <TrendBar label="Actions closed" value={actions.filter((item) => item.status === "Closed").length} total={Math.max(1, actions.length || 1)} tone="green" />
          <TrendBar label="Critical/high actions" value={criticalActions.length} total={Math.max(1, actions.length || 1)} tone="red" />
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <SectionHeader
          icon="warningTriangle"
          eyebrow="More detail"
          title="Repeat issues & schedules"
          subtitle="Repeated failed questions and schedules that need a nudge."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[1.4rem] border border-slate-200/70 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
            <p className="text-sm font-semibold text-slate-900">Top 5 failed questions</p>
            <div className="mt-3 space-y-2">
              {recurringFailedQuestions.length === 0 ? (
                <p className="text-sm text-slate-500">
                  <span className="font-semibold text-slate-700">No repeat failures yet</span>
                  <span className="mt-1 block font-normal">Nothing flagged — trends appear once the same question fails more than once.</span>
                </p>
              ) : (
                recurringFailedQuestions.map(([question, count]) => (
                  <div key={question} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <span className="mr-3 text-sm text-slate-700">{question}</span>
                    <span className="text-xs font-semibold text-slate-500">{count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="rounded-[1.4rem] border border-slate-200/70 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
            <p className="text-sm font-semibold text-slate-900">Top 5 overdue schedules</p>
            <div className="mt-3 space-y-2">
              {topOverdueSchedules.length === 0 ? (
                <p className="text-sm text-slate-500">
                  <span className="font-semibold text-slate-700">No overdue schedules</span>
                  <span className="mt-1 block font-normal">Nothing late in this list — schedules show here when they need a nudge.</span>
                </p>
              ) : (
                topOverdueSchedules.map((schedule) => (
                  <div key={schedule.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <span className="mr-3 text-sm text-slate-700">{schedule.scheduleName}</span>
                    <span className="text-xs font-semibold text-rose-600">{schedule.healthState || computeScheduleHealthState(schedule)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <SectionHeader
          icon="clipboard"
          eyebrow="Open work"
          title="Active audits"
          subtitle={
            canAccessAdmin(currentUser.role)
              ? "All open audits across the business"
              : currentUser.role === "Manager"
                ? "Assigned audits and actions needing review"
                : "Your assigned audits and saved progress"
          }
        />

        {assignedAudits.length === 0 ? (
          <EmptyPanel
            title="No audits loaded yet"
            text="Nothing to open here until this workspace has audits. Connect Google and your company folder in Admin, then sync forms."
          />
        ) : (
          <div className="space-y-3">
            {assignedAudits.slice(0, 4).map((audit) => (
              <button
                key={audit.id}
                onClick={() => onOpenAudit(audit.id)}
                className="w-full rounded-[1.4rem] border border-slate-200/70 bg-white px-4 py-4 text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-slate-900">{audit.name}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <MetaPill icon="clipboard" label={audit.siteArea} />
                      <MetaPill icon="user" label={audit.owner} />
                      <MetaPill icon="spark" label={audit.priority} />
                    </div>
                    <p className="mt-3 text-xs font-medium text-slate-600">{getDueWarning(audit.dueHours)}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {drafts[audit.id] ? `In progress ${drafts[audit.id].updatedAt}` : `Last completed ${audit.lastCompletedAt}`}
                    </p>
                  </div>
                  <div className="shrink-0 space-y-2 text-right">
                    <StatusBadge status={getAuditTrafficStatus(audit.dueHours)} />
                    {drafts[audit.id] && (
                      <div className="rounded-full bg-sky-500/12 px-3 py-1 text-xs font-semibold text-sky-700">
                        In progress
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <SectionHeader
          icon="chart"
          eyebrow="Ready to report"
          title="Recent completions"
          subtitle="Latest finished audits and outcomes."
        />
        {history.length === 0 ? (
          <EmptyPanel
            title="No completion history yet"
            text="Nothing finished to show — completed audits will list here after work is submitted and synced."
          />
        ) : (
          <div className="space-y-3">
            {history.slice(0, 6).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded-[1.4rem] border border-slate-200/70 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-slate-900">{entry.auditName}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <MetaPill icon="user" label={entry.completedBy} />
                    <MetaPill icon="clock" label={entry.completedAt} />
                  </div>
                </div>
                <StatusBadge status={entry.status} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
