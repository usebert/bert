import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Role } from "../permissions";
import {
  canAccessRiddor,
  canCreateRiskAssessments,
  canManageCoshh,
  canManageLoler,
  canSubmitIncidents,
} from "../permissions";
import type { NavItemId } from "../types/navigation";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/LoadingStates";
import { PageContainer, PageHeader, Section } from "../components/ui/PageLayout";
import { StatusBadge } from "../components/ui/StatusBadge";
import {
  fetchHealthSafetyOverview,
  HEALTH_SAFETY_LOAD_USER_MESSAGE,
  readCachedHealthSafetyOverview,
} from "../services/healthSafetyService";
import type {
  HealthSafetyAttentionItemDetail,
  HealthSafetyOverviewMetrics,
  HealthSafetyRecentActivityItem,
  HealthSafetyStatusSummary,
} from "../types/healthSafety";

export type HealthSafetyOverviewScreenProps = {
  role: Role;
  companyFolderId: string;
  onNavigate?: (screen: NavItemId, params?: Record<string, string>) => void;
  onBack?: () => void;
};

const EMPTY_METRICS: HealthSafetyOverviewMetrics = {
  openIncidents: 0,
  highRiskIncidents: 0,
  incidentsAwaitingInvestigation: 0,
  riddorDecisionsRequired: 0,
  openRiddorReports: 0,
  riddorFollowUpsDue: 0,
  riddorReportableActionsDue: 0,
  coshhReviewsOverdue: 0,
  coshhReviewsDueSoon: 0,
  chemicalsMissingSds: 0,
  coshhAssessmentsDue: 0,
  equipmentInspectionsOverdue: 0,
  equipmentInspectionsDueSoon: 0,
  equipmentOutOfService: 0,
  overdueHealthSafetyActions: 0,
  highPriorityOverdueActions: 0,
  activeRiskAssessments: 0,
  draftRiskAssessments: 0,
  awaitingApprovalRiskAssessments: 0,
  reviewDueRiskAssessments: 0,
  overdueRiskAssessments: 0,
  highResidualRiskAssessments: 0,
  veryHighResidualRiskAssessments: 0,
};

const CARD = "rounded-2xl border border-[var(--ui-border)] bg-white p-4 shadow-sm";

function formatClockTime(iso?: string) {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateKey(dateKey?: string) {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw || "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatRelativeTime(iso: string) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  const diffMs = Date.now() - parsed;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(parsed).toLocaleDateString();
}

function statusLabel(level: HealthSafetyStatusSummary["level"]) {
  switch (level) {
    case "urgent":
      return "Urgent action required";
    case "attention":
      return "Attention required";
    default:
      return "Good";
  }
}

function statusTone(level: HealthSafetyStatusSummary["level"]) {
  switch (level) {
    case "urgent":
      return "border-red-200 bg-red-50";
    case "attention":
      return "border-amber-200 bg-amber-50";
    default:
      return "border-emerald-200 bg-emerald-50";
  }
}

function ModuleIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
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
    case "incidents":
      return (
        <svg {...shared}>
          <path d="M12 4.75 20.25 19.25H3.75L12 4.75z" />
          <path d="M12 9.5v4.5" />
          <circle cx="12" cy="16.35" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "riddor":
      return (
        <svg {...shared}>
          <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3Z" />
        </svg>
      );
    case "coshh":
      return (
        <svg {...shared}>
          <path d="M10 3h4l1 2h4v2H5V5h4l1-2Z" />
          <path d="M7 9h10v11H7z" />
        </svg>
      );
    case "equipment":
      return (
        <svg {...shared}>
          <path d="M4 10h16v8H4z" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case "risk":
      return (
        <svg {...shared}>
          <path d="M12 3 3 20h18L12 3z" />
          <path d="M12 9v4" />
          <circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" />
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

function openAttentionTarget(
  onNavigate: HealthSafetyOverviewScreenProps["onNavigate"],
  item: HealthSafetyAttentionItemDetail | HealthSafetyRecentActivityItem,
) {
  if (!onNavigate) return;
  const params: Record<string, string> = {};
  if (item.route === "incidents") params.incidentId = item.recordId;
  if (item.route === "healthSafetyRiddor") params.riddorId = item.recordId;
  if (item.route === "healthSafetyCoshh") params.coshhId = item.recordId;
  if (item.route === "loler") params.equipmentId = item.recordId;
  if (item.route === "riskAssessments") params.riskAssessmentId = item.recordId;
  onNavigate(item.route as NavItemId, params);
}

type ModuleCardProps = {
  icon: string;
  title: string;
  mainCount: number;
  mainLabel: string;
  badge: { label: string; variant: "success" | "warning" | "danger" | "info" | "neutral" };
  metrics: Array<{ label: string; value: number; tone?: "danger" | "warning" | "success" }>;
  accent: string;
  onOpen: () => void;
};

function ModuleHealthCard({ icon, title, mainCount, mainLabel, badge, metrics, accent, onOpen }: ModuleCardProps) {
  return (
    <article className={`${CARD} ${accent}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 text-slate-700 ring-1 ring-black/5">
            <ModuleIcon name={icon} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            <p className="text-2xl font-black text-slate-900">
              {mainCount} <span className="text-sm font-semibold text-slate-600">{mainLabel}</span>
            </p>
          </div>
        </div>
        <StatusBadge variant={badge.variant} dot>
          {badge.label}
        </StatusBadge>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt className="text-xs text-slate-500">{metric.label}</dt>
            <dd
              className={[
                "font-semibold",
                metric.tone === "danger" ? "text-red-700" : metric.tone === "warning" ? "text-amber-700" : "text-slate-900",
              ].join(" ")}
            >
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={onOpen}
        className="mt-4 text-sm font-semibold text-slate-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
      >
        Open {title}
      </button>
    </article>
  );
}

export function HealthSafetyOverviewScreen({ role, companyFolderId, onNavigate, onBack }: HealthSafetyOverviewScreenProps) {
  const folderId = String(companyFolderId || "").trim();
  const cached = readCachedHealthSafetyOverview(folderId);
  const [metrics, setMetrics] = useState<HealthSafetyOverviewMetrics>(cached?.metrics || EMPTY_METRICS);
  const [statusSummary, setStatusSummary] = useState<HealthSafetyStatusSummary | null>(cached?.statusSummary || null);
  const [attentionItems, setAttentionItems] = useState<HealthSafetyAttentionItemDetail[]>(cached?.attentionItems || []);
  const [recentActivity, setRecentActivity] = useState<HealthSafetyRecentActivityItem[]>(cached?.recentActivity || []);
  const [updatedAt, setUpdatedAt] = useState(cached?.updatedAt || "");
  const [loading, setLoading] = useState(!cached?.metrics);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refreshNotice, setRefreshNotice] = useState("");
  const requestSeq = useRef(0);

  const applyPayload = useCallback((result: Awaited<ReturnType<typeof fetchHealthSafetyOverview>>) => {
    if (result.metrics) setMetrics(result.metrics);
    if (result.statusSummary) setStatusSummary(result.statusSummary);
    setAttentionItems(result.attentionItems || result.attention?.map((legacy) => ({
      id: legacy.id,
      type: "riddor_decision",
      title: legacy.title,
      reason: legacy.title,
      priority: legacy.rank,
      severity: legacy.rank <= 4 ? "urgent" : "attention",
      siteId: "",
      siteName: legacy.site,
      areaId: "",
      areaName: "",
      dueDate: legacy.dueDate,
      route: legacy.navigate.screen,
      recordId:
        legacy.navigate.incidentId ||
        legacy.navigate.riddorId ||
        legacy.navigate.coshhId ||
        legacy.navigate.equipmentId ||
        "",
      actionLabel: "Open",
    })) || []);
    setRecentActivity(result.recentActivity || []);
    setUpdatedAt(result.updatedAt || result.statusSummary?.updatedAt || "");
  }, []);

  const loadOverview = useCallback(
    async (refresh = false) => {
      if (!folderId) return;
      const seq = ++requestSeq.current;
      if (refresh) {
        setRefreshing(true);
      } else if (!cached?.metrics) {
        setLoading(true);
      }
      setLoadError("");
      try {
        const result = await fetchHealthSafetyOverview(folderId, { refresh });
        if (seq !== requestSeq.current) return;
        applyPayload(result);
        if (refresh) {
          setRefreshNotice("Overview refreshed.");
        }
      } catch (error) {
        if (seq !== requestSeq.current) return;
        const message = error instanceof Error ? error.message : HEALTH_SAFETY_LOAD_USER_MESSAGE;
        setLoadError(message);
        if (refresh) setRefreshNotice("Refresh failed. Showing the last loaded data.");
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [applyPayload, cached?.metrics, folderId],
  );

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const visibleAttention = attentionItems.slice(0, 6);
  const hasMoreAttention = attentionItems.length > 6;
  const [showAllAttention, setShowAllAttention] = useState(false);
  const attentionToRender = showAllAttention ? attentionItems : visibleAttention;

  const lastUpdatedLabel = useMemo(() => {
    const source = updatedAt || statusSummary?.updatedAt;
    const clock = formatClockTime(source);
    return clock ? `Last updated ${clock}` : "";
  }, [statusSummary?.updatedAt, updatedAt]);

  const quickActions = useMemo(() => {
    const actions: Array<{ id: string; label: string; screen: NavItemId; params?: Record<string, string> }> = [];
    if (canSubmitIncidents(role)) {
      actions.push({ id: "report-incident", label: "Report incident", screen: "incidents", params: { openReport: "true" } });
    }
    if (canManageCoshh(role)) {
      actions.push({ id: "add-chemical", label: "Add chemical", screen: "healthSafetyCoshh", params: { openCreate: "true" } });
    }
    if (canManageLoler(role)) {
      actions.push({ id: "add-equipment", label: "Add equipment", screen: "loler", params: { openCreate: "true" } });
    }
    if (canAccessRiddor(role)) {
      actions.push({ id: "open-riddor", label: "Open RIDDOR workspace", screen: "healthSafetyRiddor" });
    }
    if (canCreateRiskAssessments(role)) {
      actions.push({ id: "create-risk-assessment", label: "Create risk assessment", screen: "riskAssessments" });
    }
    return actions;
  }, [role]);

  const moduleCards = useMemo(
    () => [
      {
        key: "incidents",
        icon: "incidents",
        title: "Incidents",
        mainCount: metrics.openIncidents,
        mainLabel: "open",
        badge:
          metrics.highRiskIncidents > 0
            ? { label: "High risk", variant: "danger" as const }
            : metrics.openIncidents > 0
              ? { label: "Open", variant: "warning" as const }
              : { label: "Clear", variant: "success" as const },
        accent: metrics.highRiskIncidents > 0 ? "border-red-100 bg-red-50/40" : "border-slate-200",
        metrics: [
          { label: "High risk", value: metrics.highRiskIncidents, tone: metrics.highRiskIncidents ? ("danger" as const) : undefined },
          { label: "Awaiting investigation", value: metrics.incidentsAwaitingInvestigation },
        ],
        screen: "incidents" as const,
      },
      {
        key: "riddor",
        icon: "riddor",
        title: "RIDDOR",
        mainCount: metrics.openRiddorReports,
        mainLabel: "open reports",
        badge:
          metrics.riddorDecisionsRequired > 0
            ? { label: "Decision needed", variant: "warning" as const }
            : { label: "Current", variant: "success" as const },
        accent: metrics.riddorDecisionsRequired > 0 ? "border-amber-100 bg-amber-50/50" : "border-slate-200",
        metrics: [
          { label: "Decisions required", value: metrics.riddorDecisionsRequired, tone: metrics.riddorDecisionsRequired ? ("warning" as const) : undefined },
          { label: "Follow-ups due", value: metrics.riddorFollowUpsDue },
        ],
        screen: "healthSafetyRiddor" as const,
      },
      {
        key: "coshh",
        icon: "coshh",
        title: "COSHH",
        mainCount: metrics.coshhReviewsOverdue,
        mainLabel: "reviews overdue",
        badge:
          metrics.chemicalsMissingSds > 0
            ? { label: "Missing SDS", variant: "danger" as const }
            : metrics.coshhReviewsOverdue > 0
              ? { label: "Overdue", variant: "warning" as const }
              : { label: "Current", variant: "success" as const },
        accent: metrics.chemicalsMissingSds > 0 ? "border-red-100 bg-red-50/40" : "border-slate-200",
        metrics: [
          { label: "Missing SDS", value: metrics.chemicalsMissingSds, tone: metrics.chemicalsMissingSds ? ("danger" as const) : undefined },
          { label: "Assessments due", value: metrics.coshhAssessmentsDue },
        ],
        screen: "healthSafetyCoshh" as const,
      },
      {
        key: "risk-assessments",
        icon: "risk",
        title: "Risk Assessments",
        mainCount: metrics.activeRiskAssessments,
        mainLabel: "active",
        badge:
          metrics.overdueRiskAssessments > 0
            ? { label: "Overdue", variant: "danger" as const }
            : metrics.awaitingApprovalRiskAssessments > 0
              ? { label: "Awaiting approval", variant: "warning" as const }
              : metrics.veryHighResidualRiskAssessments > 0
                ? { label: "Very High risk", variant: "danger" as const }
                : { label: "Current", variant: "success" as const },
        accent:
          metrics.overdueRiskAssessments > 0 || metrics.veryHighResidualRiskAssessments > 0
            ? "border-red-100 bg-red-50/40"
            : "border-slate-200",
        metrics: [
          { label: "Awaiting approval", value: metrics.awaitingApprovalRiskAssessments, tone: metrics.awaitingApprovalRiskAssessments ? ("warning" as const) : undefined },
          { label: "Review due", value: metrics.reviewDueRiskAssessments },
          { label: "Overdue", value: metrics.overdueRiskAssessments, tone: metrics.overdueRiskAssessments ? ("danger" as const) : undefined },
        ],
        screen: "riskAssessments" as const,
      },
      {
        key: "equipment",
        icon: "equipment",
        title: "Equipment",
        mainCount: metrics.equipmentInspectionsOverdue,
        mainLabel: "inspections overdue",
        badge:
          metrics.equipmentInspectionsOverdue > 0
            ? { label: "Overdue", variant: "danger" as const }
            : metrics.equipmentInspectionsDueSoon > 0
              ? { label: "Due soon", variant: "warning" as const }
              : { label: "Current", variant: "success" as const },
        accent: metrics.equipmentInspectionsOverdue > 0 ? "border-red-100 bg-red-50/40" : "border-slate-200",
        metrics: [
          { label: "Due soon", value: metrics.equipmentInspectionsDueSoon, tone: metrics.equipmentInspectionsDueSoon ? ("warning" as const) : undefined },
          { label: "Out of service", value: metrics.equipmentOutOfService },
        ],
        screen: "loler" as const,
      },
    ],
    [metrics],
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow="HEALTH & SAFETY"
        title="Overview"
        description="Your current safety position across incidents, COSHH, RIDDOR and equipment."
        secondaryActions={
          <>
            {lastUpdatedLabel ? (
              <span className="text-xs text-[var(--ui-text-muted)]" aria-live="polite">
                {lastUpdatedLabel}
              </span>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => void loadOverview(true)}
              disabled={refreshing}
              aria-label="Refresh Health and Safety overview"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
            {onBack ? (
              <Button type="button" variant="secondary" onClick={onBack}>
                Back
              </Button>
            ) : null}
          </>
        }
      />

      <div className="sr-only" aria-live="polite">
        {refreshNotice}
      </div>

      {loadError ? (
        <Section>
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {loadError}
            <button type="button" onClick={() => void loadOverview(true)} className="ml-3 font-semibold underline">
              Retry
            </button>
          </div>
        </Section>
      ) : null}

      <Section>
        <div className={`rounded-2xl border p-5 ${statusTone(statusSummary?.level || "good")}`}>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Health & Safety status</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-black text-slate-900">{statusLabel(statusSummary?.level || "good")}</h2>
            <StatusBadge
              variant={
                statusSummary?.level === "urgent" ? "danger" : statusSummary?.level === "attention" ? "warning" : "success"
              }
              dot
            >
              {statusSummary?.urgentCount || 0} urgent · {statusSummary?.attentionCount || 0} attention
            </StatusBadge>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            {statusSummary?.explanation || "Loading your current safety position…"}
          </p>
          {lastUpdatedLabel ? <p className="mt-2 text-xs text-slate-500">{lastUpdatedLabel}</p> : null}
          <p className="mt-3 text-xs text-slate-500">
            This summary reflects records held in BERT and does not replace competent Health & Safety review.
          </p>
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Section title="Requires attention">
          {loading && attentionItems.length === 0 ? (
            <p className="text-sm text-slate-500">Loading attention items…</p>
          ) : attentionItems.length === 0 ? (
            <EmptyState
              title="Great news"
              description="No urgent Health & Safety issues need attention right now. BERT will show incidents, overdue reviews and inspection issues here when action is required."
              icon={<ModuleIcon name="check" className="h-8 w-8 text-emerald-600" />}
            />
          ) : (
            <div className="space-y-2">
              {attentionToRender.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm motion-reduce:transition-none"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                          <ModuleIcon
                            name={
                              item.type.includes("incident")
                                ? "incidents"
                                : item.type.includes("riddor")
                                  ? "riddor"
                                  : item.type.includes("coshh") || item.type === "missing_sds"
                                    ? "coshh"
                                    : "equipment"
                            }
                            className="h-4 w-4"
                          />
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                          <p className="mt-1 text-sm text-slate-600">{item.reason}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {[item.siteName, item.areaName].filter(Boolean).join(" · ")}
                            {item.dueDate ? ` · Due ${formatDateKey(item.dueDate)}` : ""}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <StatusBadge variant={item.severity === "urgent" ? "danger" : "warning"} dot={false}>
                        {item.severity === "urgent" ? "Urgent" : "Attention"}
                      </StatusBadge>
                      <Button type="button" variant="secondary" onClick={() => openAttentionTarget(onNavigate, item)}>
                        {item.actionLabel}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
              {hasMoreAttention ? (
                <button
                  type="button"
                  onClick={() => setShowAllAttention((current) => !current)}
                  className="text-sm font-semibold text-slate-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                >
                  {showAllAttention ? "Show fewer items" : "View all attention items"}
                </button>
              ) : null}
            </div>
          )}
        </Section>

        <Section title="Module health">
          <div className="grid gap-3">
            {moduleCards.map((card) => (
              <ModuleHealthCard
                key={card.key}
                icon={card.icon}
                title={card.title}
                mainCount={card.mainCount}
                mainLabel={card.mainLabel}
                badge={card.badge}
                metrics={card.metrics}
                accent={card.accent}
                onOpen={() => onNavigate?.(card.screen)}
              />
            ))}
          </div>
        </Section>
      </div>

      <Section title="Recent activity">
        {loading && recentActivity.length === 0 ? (
          <p className="text-sm text-slate-500">Loading recent activity…</p>
        ) : recentActivity.length === 0 ? (
          <EmptyState
            title="No recent activity yet"
            description="Incident, COSHH, RIDDOR and equipment updates will appear here as they are recorded in BERT."
          />
        ) : (
          <ul className="space-y-2">
            {recentActivity.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openAttentionTarget(onNavigate, item)}
                  className="flex w-full items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 motion-reduce:transition-none"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{item.summary}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {[item.actorName, item.siteName, item.areaName].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">{formatRelativeTime(item.occurredAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {quickActions.length > 0 ? (
        <Section title="Quick actions">
          <div className="flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant="secondary"
                onClick={() => onNavigate?.(action.screen, action.params)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </Section>
      ) : null}
    </PageContainer>
  );
}
