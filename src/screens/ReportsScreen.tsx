import { ReportsWorkspace } from "../reports/ReportsWorkspace";
import type { ComponentProps } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type {
  CompanyReportUser,
  ReportItem,
  ReportSectionKey,
  ReportTemplateType,
} from "../types/reports";
import type {
  ActionItem,
  Audit,
  AuditTemplate,
  HistoryEntry,
  ManagedSchedule,
  RiskLevel,
} from "../types/reportsScreenProps";
import type { SyncQueueItem } from "../types/sync";
import { EmptyPanel } from "../components/dashboard/DashboardPrimitives";
import { PilotHealthPanel } from "../components/pilot/PilotHealthPanel";
import { SECTION_INTROS } from "../config/sectionIntros";
import { SectionIntro } from "../components/SectionIntro";
import { darkPanelEyebrow, darkPanelShell, darkPanelTitleLg } from "../styles/darkPanel";
import type { Role } from "../permissions";
import { slatePrimaryCtaInteract } from "../styles/interactions";
import { ReportsDashboardPanel } from "../components/reports/ReportsDashboardPanel";
import type { ResolvedCompanyContext } from "../services/companyContextService";

const reportTemplates: {
  type: ReportTemplateType;
  title: string;
  subtitle: string;
}[] = [
  {
    type: "Executive summary",
    title: "Executive summary",
    subtitle: "High-level compliance, pressure areas, and status for managers or clients.",
  },
  {
    type: "Overdue audit pack",
    title: "Overdue audit pack",
    subtitle: "Focus on missed audits, due risk, and who owns the next action.",
  },
  {
    type: "Corrective action pack",
    title: "Corrective action pack",
    subtitle: "Open CAPA items, severity, evidence, and close-out ownership.",
  },
  {
    type: "Evidence pack",
    title: "Evidence pack",
    subtitle: "Evidence-heavy handover with proof items, completion trail, and audit context.",
  },
  {
    type: "Full report",
    title: "Full report",
    subtitle: "Complete compliance pack including schedule, risk, CAPA, evidence, and sync exceptions.",
  },
];

const reportSectionOptions: {
  key: ReportSectionKey;
  title: string;
  description: string;
  icon?: string;
}[] = [
  { key: "compliance", title: "Compliance summary", description: "Live compliance and daily completion metrics." },
  { key: "auditCompletion", title: "Audit completion summary", description: "Completion rate, finished audits, and coverage." },
  { key: "overdueAudits", title: "Overdue audits", description: "Audits that are currently overdue." },
  { key: "correctiveActions", title: "Corrective actions", description: "Open and overdue CAPA items.", icon: "warningTriangle" },
  { key: "overdueActions", title: "Overdue actions", description: "Corrective actions past due date.", icon: "warningTriangle" },
  { key: "criticalFindings", title: "Critical/high findings", description: "Highest-risk audit findings needing attention." },
  { key: "repeatFailures", title: "Repeat failures", description: "Questions or findings repeatedly failing over time." },
  { key: "evidence", title: "Evidence summary", description: "Captured evidence and proof counts." },
  { key: "auditHistory", title: "Audit history", description: "Recent completed audit records." },
  { key: "verificationHistory", title: "Verification history", description: "Action verification and close-out activity.", icon: "warningTriangle" },
  { key: "scheduleCompliance", title: "Schedule compliance", description: "Schedule health, missed audits, and due-soon items." },
  { key: "syncExceptions", title: "Offline sync exceptions", description: "Items failed or conflicted during sync." },
  { key: "templates", title: "Audit templates", description: "Active templates included in the workspace." },
  { key: "offlineQueue", title: "Work waiting to sync", description: "Queued submissions still waiting to sync." },
];

function localizedReportPackTitle(t: TFunction, type: ReportTemplateType): string {
  switch (type) {
    case "Executive summary":
      return t("reports.executiveSummary");
    case "Overdue audit pack":
      return t("reports.overdueAuditPack");
    case "Corrective action pack":
      return t("reports.correctiveActionPack");
    case "Evidence pack":
      return t("reports.evidencePack");
    case "Full report":
      return t("reports.fullReport");
    default:
      return type;
  }
}

function ReportsScreenIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
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
    case "dashboard":
      return (
        <svg {...shared}>
          <rect x="3" y="3" width="8" height="8" rx="2" />
          <rect x="13" y="3" width="8" height="5" rx="2" />
          <rect x="13" y="10" width="8" height="11" rx="2" />
          <rect x="3" y="13" width="8" height="8" rx="2" />
        </svg>
      );
    case "clipboard":
      return (
        <svg {...shared}>
          <rect x="6" y="4" width="12" height="16" rx="2" />
          <path d="M9 4.5h6a1.5 1.5 0 0 0-1.5-1.5h-3A1.5 1.5 0 0 0 9 4.5Z" />
          <path d="M9 10h6" />
          <path d="M9 14h6" />
        </svg>
      );
    case "warningTriangle":
      return (
        <svg {...shared}>
          <path d="M12 4.75 20.25 19.25H3.75L12 4.75z" />
          <path d="M12 9.5v4.5" />
          <circle cx="12" cy="16.35" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "chart":
      return (
        <svg {...shared}>
          <path d="M4 19h16" />
          <path d="M7 16V10" />
          <path d="M12 16V6" />
          <path d="M17 16v-4" />
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
        <ReportsScreenIcon name={icon} className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{eyebrow}</p> : null}
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  icon,
  tone = "slate",
}: {
  label: string;
  value: string;
  icon?: string;
  tone?: "slate" | "red" | "amber" | "green" | "sky";
}) {
  const toneClasses: Record<NonNullable<typeof tone>, { shell: string; icon: string; label: string; value: string }> = {
    slate: {
      shell: "border-slate-200 bg-white",
      icon: "text-slate-600",
      label: "text-slate-500",
      value: "text-slate-900",
    },
    red: {
      shell: "border-rose-200 bg-white",
      icon: "text-rose-600",
      label: "text-rose-500",
      value: "text-rose-900",
    },
    amber: {
      shell: "border-amber-200 bg-white",
      icon: "text-amber-600",
      label: "text-amber-600",
      value: "text-amber-900",
    },
    green: {
      shell: "border-blue-200 bg-white",
      icon: "text-blue-700",
      label: "text-blue-700",
      value: "text-blue-950",
    },
    sky: {
      shell: "border-sky-200 bg-white",
      icon: "text-sky-600",
      label: "text-sky-600",
      value: "text-sky-900",
    },
  };
  const classes = toneClasses[tone];
  return (
    <div className={`rounded-[1.5rem] border p-3 ${classes.shell}`}>
      <div className="flex items-center gap-2">
        {icon ? (
          <span className={classes.icon}>
            <ReportsScreenIcon name={icon} className="h-4 w-4" />
          </span>
        ) : null}
        <p className={`text-[11px] font-semibold leading-tight tracking-[0.08em] ${classes.label}`}>{label}</p>
      </div>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${classes.value}`}>{value}</p>
    </div>
  );
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

function LiveGraphChart({
  data,
  chartType,
}: {
  data: Array<{ label: string; value: number; tone: "green" | "amber" | "red" }>;
  chartType: "column" | "line" | "area" | "bar";
}) {
  const max = Math.max(1, ...data.map((item) => item.value));
  const toneColor = (tone: "green" | "amber" | "red") => (tone === "green" ? "#10b981" : tone === "amber" ? "#f59e0b" : "#f43f5e");

  if (chartType === "bar") {
    return (
      <div className="mb-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        {data.map((item) => {
          const width = Math.max(8, Math.round((item.value / max) * 100));
          return (
            <div key={`bar-${item.label}`} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">{item.label}</span>
                <span className="text-slate-500">{item.value}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full" style={{ width: `${width}%`, backgroundColor: toneColor(item.tone) }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const width = 480;
  const height = 180;
  const left = 24;
  const right = 12;
  const top = 12;
  const bottom = 32;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const step = data.length > 1 ? plotW / (data.length - 1) : plotW;
  const points = data.map((item, index) => {
    const x = left + step * index;
    const y = top + (1 - item.value / max) * plotH;
    return { ...item, x, y };
  });
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPoints = `${left},${top + plotH} ${linePoints} ${left + plotW},${top + plotH}`;

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full">
        <line x1={left} y1={top + plotH} x2={left + plotW} y2={top + plotH} stroke="#cbd5e1" strokeWidth="1" />
        {chartType === "column" &&
          points.map((point) => {
            const barW = Math.max(18, plotW / Math.max(data.length * 2, 6));
            return (
              <rect
                key={`col-${point.label}`}
                x={point.x - barW / 2}
                y={point.y}
                width={barW}
                height={top + plotH - point.y}
                rx="4"
                fill={toneColor(point.tone)}
                fillOpacity="0.9"
              />
            );
          })}
        {chartType === "line" && <polyline points={linePoints} fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />}
        {chartType === "area" && (
          <>
            <polygon points={areaPoints} fill="#0f172a" fillOpacity="0.16" />
            <polyline points={linePoints} fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
          </>
        )}
        {(chartType === "line" || chartType === "area") &&
          points.map((point) => <circle key={`dot-${point.label}`} cx={point.x} cy={point.y} r="4" fill={toneColor(point.tone)} />)}
        {points.map((point) => (
          <text key={`lbl-${point.label}`} x={point.x} y={height - 10} textAnchor="middle" fontSize="10" fill="#64748b">
            {point.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

function TrendBar({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: "green" | "amber" | "red";
}) {
  const width = Math.max(8, Math.round((value / total) * 100));
  const toneClass = tone === "green" ? "bg-blue-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="rounded-[1.2rem] bg-slate-50 px-3 py-3">
      <div className="mb-1 flex items-center justify-between text-sm">
        <p className="font-semibold text-slate-900">{label}</p>
        <p className="text-slate-500">{value}</p>
      </div>
      <div className="h-3 rounded-full bg-white shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)]">
        <div className={`h-3 rounded-full ${toneClass}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function FlowItem({ number, title, text, icon }: { number: string; title: string; text: string; icon?: string }) {
  return (
    <div className="flex gap-4 rounded-2xl bg-slate-50 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
        {icon ? <ReportsScreenIcon name={icon} className="h-5 w-5 text-white" /> : number}
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
      </div>
    </div>
  );
}

export function ReportsWorkspaceBody({
  currentUserRole,
  companyContext,
  buildMarker,
  workspaceName,
  compliance,
  openActions,
  overdueActions,
  overdueAudits,
  actions: _actions,
  managedSchedules: _managedSchedules,
  syncQueue: _syncQueue,
  riskSummary: _riskSummary,
  recurringFailedQuestions: _recurringFailedQuestions,
  auditCompletionRate: _auditCompletionRate,
  evidenceCount,
  completedToday,
  offlineQueueCount,
  reportUsers,
  reportUsersLoading = false,
  reportRecipients,
  reportInbox,
  history,
  templates,
  selectedReportTemplate,
  reportTitleInput,
  selectedReportSections,
  onToggleReportRecipient,
  onSelectReportTemplate,
  onReportTitleChange,
  onToggleReportSection,
  onExportAuditPack,
  onExportAuditPackPdf,
  onEmailAuditPackPdf,
}: {
  currentUserRole: Role;
  companyContext: ResolvedCompanyContext;
  buildMarker?: string;
  workspaceName: string;
  compliance: number;
  openActions: ActionItem[];
  overdueActions: ActionItem[];
  overdueAudits: Audit[];
  actions: ActionItem[];
  managedSchedules: ManagedSchedule[];
  syncQueue: SyncQueueItem[];
  riskSummary: {
    totalRiskScore: number;
    highestRiskLevel: RiskLevel;
    criticalFindings: number;
    highFindings: number;
  };
  recurringFailedQuestions: [string, number][];
  auditCompletionRate: number;
  evidenceCount: number;
  completedToday: number;
  offlineQueueCount: number;
  reportUsers: CompanyReportUser[];
  reportUsersLoading?: boolean;
  reportRecipients: string[];
  reportInbox: ReportItem[];
  history: HistoryEntry[];
  templates: AuditTemplate[];
  selectedReportTemplate: ReportTemplateType;
  reportTitleInput: string;
  selectedReportSections: ReportSectionKey[];
  onToggleReportRecipient: (email: string) => void;
  onSelectReportTemplate: (value: ReportTemplateType) => void;
  onReportTitleChange: (value: string) => void;
  onToggleReportSection: (section: ReportSectionKey) => void;
  onExportAuditPack: () => void;
  onExportAuditPackPdf: () => void;
  onEmailAuditPackPdf: () => void;
}) {
  const { t } = useTranslation();
  const [showReportCreator, setShowReportCreator] = useState(false);
  const [showAuditPackOptions, setShowAuditPackOptions] = useState(false);
  const [selectedReportGraphType, setSelectedReportGraphType] = useState<"column" | "line" | "area" | "bar">("column");
  const reportPreviewSeries = [
    { label: "Completion", value: compliance, tone: "green" as const },
    { label: "Open actions", value: openActions.length, tone: "amber" as const },
    { label: "Overdue audits", value: overdueAudits.length, tone: "red" as const },
  ];

  return (
    <div className="space-y-4">
      <section className={darkPanelShell}>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white">
            <ReportsScreenIcon name="chart" className="h-5 w-5" />
          </div>
          <div>
            <h2 className={darkPanelTitleLg}>
              {currentUserRole === "Master" ? "Diagnostics" : "Reports"}
            </h2>
            <SectionIntro
              text={currentUserRole === "Master" ? SECTION_INTROS.diagnostics : SECTION_INTROS.reports}
              className="mt-2"
              role={currentUserRole}
              tone="onDark"
            />
            {currentUserRole === "Master" && buildMarker ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-400">Build details</summary>
                <p className="mt-1 font-mono text-[11px] text-slate-300">{buildMarker}</p>
              </details>
            ) : null}
          </div>
        </div>
      </section>

      {currentUserRole === "Master" ? <PilotHealthPanel role="Master" /> : null}

      <ReportsDashboardPanel
        companyContext={companyContext}
        showDiagnostics={currentUserRole === "Master"}
      />

      {currentUserRole === "Master" ? (
        <section className="grid grid-cols-2 gap-3">
          <MiniMetric label="Compliance" value={`${compliance}%`} />
          <MiniMetric label="Open actions" value={String(openActions.length)} icon="warningTriangle" />
          <MiniMetric label="Overdue audits" value={String(overdueAudits.length)} />
          <MiniMetric label="Evidence items" value={String(evidenceCount)} />
        </section>
      ) : null}

      {currentUserRole !== "Master" ? (
        <section className="rounded-[1.75rem] border border-slate-200/80 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Recent reports</p>
          <div className="mt-3 space-y-3">
            {reportInbox.length === 0 ? (
              <EmptyPanel title="No reports yet" text="Create your first report pack below." />
            ) : (
              reportInbox.slice(0, 5).map((report) => (
                <div key={report.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">{report.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {report.type} · {report.createdAt}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      <section className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <SectionHeader
          icon="chart"
          eyebrow="Visual summary"
          title="Report preview"
          subtitle={`A quick visual read of ${workspaceName} before you export.`}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[1.4rem] border border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Audit status split</p>
              <div className="relative w-[8.5rem]">
                <select
                  value={selectedReportGraphType}
                  onChange={(event) => setSelectedReportGraphType(event.target.value as "column" | "line" | "area" | "bar")}
                  className="h-8 w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-2.5 pr-7 text-xs font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:bg-white"
                >
                  <option value="column">Column</option>
                  <option value="line">Line</option>
                  <option value="area">Area</option>
                  <option value="bar">Bar</option>
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-slate-400">▾</span>
              </div>
            </div>
            <LiveGraphChart data={reportPreviewSeries} chartType={selectedReportGraphType} />
            <div className="space-y-3">
              <TrendBar label="Completion rate" value={compliance} total={100} tone="green" />
              <TrendBar label="Open actions" value={openActions.length} total={Math.max(1, openActions.length + overdueActions.length + 2)} tone="amber" />
              <TrendBar label="Overdue audits" value={overdueAudits.length} total={Math.max(1, overdueAudits.length + 3)} tone="red" />
            </div>
          </div>
          <div className="rounded-[1.4rem] border border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Pack emphasis</p>
              <p className="text-xs text-slate-500">{selectedReportTemplate}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <QuickActionTile title="History" value={String(history.length)} caption="Records available" />
              <QuickActionTile title="Templates" value={String(templates.filter((template) => template.active).length)} caption="Included" />
              <QuickActionTile title="Proof" value={String(evidenceCount)} caption="Evidence items" />
              <QuickActionTile title="Today" value={String(completedToday)} caption="Completed audits" />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <SectionHeader
            icon="chart"
            eyebrow="Create"
            title={t("reports.createReport")}
            subtitle={`Build a pack for ${workspaceName}.`}
          />
          {currentUserRole === "Master" && offlineQueueCount > 0 ? (
            <details className="shrink-0 text-right">
              <summary className="cursor-pointer rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                Sync
              </summary>
              <p className="mt-1 text-xs text-slate-500">{offlineQueueCount} waiting to sync</p>
            </details>
          ) : null}
        </div>
        {!showReportCreator ? (
          <button
            onClick={() => setShowReportCreator(true)}
            className={`h-12 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
          >
            {t("reports.createReport")}
          </button>
        ) : (
          <>
            <div className="mb-4 grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => setShowAuditPackOptions((current) => !current)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 transition-colors duration-200 ease-in-out hover:bg-slate-900/25 hover:text-white"
              >
                {showAuditPackOptions ? "Hide audit pack options" : "Create audit pack"}
              </button>
              <button
                onClick={() => onSelectReportTemplate("Evidence pack")}
                className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 transition-colors duration-200 ease-in-out hover:bg-slate-900/25 hover:text-white"
              >
                {t("reports.evidencePack")}
              </button>
            </div>
            <div className="mb-4 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Report type</p>
              <p className="mt-1 text-sm text-slate-500">Pick the report outcome you want to create for this workspace.</p>
              <div className="mt-3 grid gap-2">
                {reportTemplates.map((template) => {
                  const selected = template.type === selectedReportTemplate;
                  return (
                    <button
                      key={template.type}
                      onClick={() => onSelectReportTemplate(template.type)}
                      className={[
                        "rounded-2xl border px-4 py-3 text-left transition-colors duration-200 ease-in-out",
                        selected ? `border-slate-900 bg-slate-900 text-white shadow-[0_14px_28px_rgba(15,23,42,0.14)] ${slatePrimaryCtaInteract}` : "border-slate-200 bg-white hover:bg-slate-900/25 hover:text-white",
                      ].join(" ")}
                    >
                      <p className="text-sm font-semibold">{localizedReportPackTitle(t, template.type)}</p>
                      <p className={["mt-1 text-xs leading-5", selected ? "text-slate-300" : "text-slate-500"].join(" ")}>{template.subtitle}</p>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Report title</label>
                <input
                  value={reportTitleInput}
                  onChange={(event) => onReportTitleChange(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                  placeholder="Enter report title"
                />
              </div>
            </div>
            <div className="mb-4 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Who can see this report?</p>
              <p className="mt-1 text-sm text-slate-500">Select the company users who should see the report in their app.</p>
              <div className="mt-3 space-y-2">
                {reportUsersLoading && reportUsers.length === 0 ? (
                  <EmptyPanel title="Loading people…" text="Reading company members for this workspace." />
                ) : reportUsers.length === 0 ? (
                  <EmptyPanel
                    title="No people to select"
                    text="Add company members in People first, then return here to choose report recipients."
                  />
                ) : (
                reportUsers.map((user) => {
                  const selected = reportRecipients.includes(user.email);
                  return (
                    <button
                      key={user.email}
                      onClick={() => onToggleReportRecipient(user.email)}
                      className={[
                        "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left",
                        selected ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white",
                      ].join(" ")}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {user.role} • {user.email}
                        </p>
                      </div>
                      <div
                        className={[
                          "rounded-full px-3 py-1 text-xs font-semibold",
                          selected ? "bg-blue-500/12 text-blue-800" : "bg-slate-100 text-slate-500",
                        ].join(" ")}
                      >
                        {selected ? t("reports.canView") : t("reports.select")}
                      </div>
                    </button>
                  );
                })
                )}
              </div>
            </div>
            <div className="mb-4 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Choose what goes into the report</p>
              <p className="mt-1 text-sm text-slate-500">Select the sections to include in this export.</p>
              <div className="mt-3 space-y-2">
                {reportSectionOptions.map((section) => {
                  const selected = selectedReportSections.includes(section.key);
                  return (
                    <button
                      key={section.key}
                      onClick={() => onToggleReportSection(section.key)}
                      className={[
                        "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left",
                        selected ? "border-slate-900 bg-white" : "border-slate-200 bg-white",
                      ].join(" ")}
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        {section.icon ? (
                          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
                            <ReportsScreenIcon name={section.icon} className="h-[18px] w-[18px]" />
                          </div>
                        ) : null}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">{section.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{section.description}</p>
                        </div>
                      </div>
                      <div
                        className={[
                          "rounded-full px-3 py-1 text-xs font-semibold",
                          selected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500",
                        ].join(" ")}
                      >
                        {selected ? t("reports.included") : t("reports.exclude")}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3">
              <button
                onClick={onExportAuditPackPdf}
                className={`h-14 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
              >
                Export PDF report
              </button>
              <button
                onClick={onEmailAuditPackPdf}
                className="h-14 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition-colors duration-200 ease-in-out hover:bg-slate-900/25 hover:text-white"
              >
                Email PDF to selected
              </button>
              {showAuditPackOptions && (
                <>
                  <button
                    onClick={onExportAuditPack}
                    className="h-14 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-800 transition-colors duration-200 ease-in-out hover:bg-slate-900/25 hover:text-white"
                  >
                    Export text audit pack
                  </button>
                </>
              )}
              <button
                onClick={() => {
                  setShowReportCreator(false);
                  setShowAuditPackOptions(false);
                }}
                className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors duration-200 ease-in-out hover:bg-slate-900/25 hover:text-white"
              >
                Close report options
              </button>
            </div>
          </>
        )}
      </section>

      {currentUserRole === "Master" ? (
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
        <SectionHeader
          icon="dashboard"
          eyebrow="Recent"
          title={t("reports.recentReports")}
          subtitle="Reports shared with your team."
        />
        <div className="mt-4 space-y-3">
          {reportInbox.length === 0 ? (
            <EmptyPanel
              title={t("reports.noReports")}
              text="Nothing shared here until someone generates a pack. Reports can build from audits, actions, and NCRs as that history grows."
            />
          ) : (
            reportInbox.map((report) => (
              <div key={report.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{report.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {report.type} • {report.template} • created by {report.createdBy} • {report.createdAt}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">Visible to {report.visibleTo.join(", ")}</p>
                  </div>
                  <div className="rounded-full bg-sky-500/12 px-3 py-1 text-xs font-semibold text-sky-700">
                    In app
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
      ) : null}

      {showReportCreator && (
        <section className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
          <SectionHeader
            icon="clipboard"
            eyebrow="Included sections"
            title="Report contents"
            subtitle="Only the sections marked below will be included in the export."
          />
          <div className="mt-4 space-y-3">
            {reportSectionOptions
              .filter((section) => selectedReportSections.includes(section.key))
              .map((section, index) => (
                <FlowItem
                  key={section.key}
                  number={String(index + 1).padStart(2, "0")}
                  title={section.title}
                  text={section.description}
                  icon={section.icon}
                />
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Reports screen — Release 6 workspace shell. */
export function ReportsScreen(props: ComponentProps<typeof ReportsWorkspaceBody>) {
  return (
    <ReportsWorkspace>
      <ReportsWorkspaceBody {...props} />
    </ReportsWorkspace>
  );
}
