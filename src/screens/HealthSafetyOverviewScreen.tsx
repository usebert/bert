import { useCallback, useEffect, useState } from "react";
import type { NavItemId } from "../types/navigation";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/LoadingStates";
import { PageContainer, PageHeader, Section } from "../components/ui/PageLayout";
import { StatusBadge, statusToBadgeVariant } from "../components/ui/StatusBadge";
import {
  fetchHealthSafetyOverview,
  HEALTH_SAFETY_LOAD_USER_MESSAGE,
  readCachedHealthSafetyOverview,
} from "../services/healthSafetyService";
import type { HealthSafetyAttentionItem, HealthSafetyOverviewSummary } from "../types/healthSafety";

export type HealthSafetyOverviewScreenProps = {
  companyFolderId: string;
  onNavigate?: (screen: NavItemId, params?: Record<string, string>) => void;
  onBack?: () => void;
};

const EMPTY_SUMMARY: HealthSafetyOverviewSummary = {
  openIncidents: 0,
  highRiskIncidents: 0,
  riddorDecisionsRequired: 0,
  openRiddorReports: 0,
  coshhAssessmentsOverdue: 0,
  chemicalsMissingSds: 0,
  equipmentInspectionsOverdue: 0,
  openHealthSafetyActions: 0,
};

function attentionKindLabel(kind: HealthSafetyAttentionItem["kind"]) {
  switch (kind) {
    case "incident_investigation":
      return "Incident";
    case "riddor_decision":
      return "RIDDOR";
    case "coshh_review":
      return "COSHH";
    case "missing_sds":
      return "SDS";
    case "equipment_overdue":
      return "LOLER";
    default:
      return "Attention";
  }
}

function formatDate(dateKey?: string) {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw || "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function HealthSafetyOverviewScreen({ companyFolderId, onNavigate, onBack }: HealthSafetyOverviewScreenProps) {
  const folderId = String(companyFolderId || "").trim();
  const cached = readCachedHealthSafetyOverview(folderId);
  const [summary, setSummary] = useState<HealthSafetyOverviewSummary>(cached?.summary || EMPTY_SUMMARY);
  const [attention, setAttention] = useState<HealthSafetyAttentionItem[]>(cached?.attention || []);
  const [loading, setLoading] = useState(!cached?.summary);
  const [loadError, setLoadError] = useState("");

  const loadOverview = useCallback(
    async (refresh = false) => {
      if (!folderId) return;
      if (!cached?.summary) setLoading(true);
      setLoadError("");
      try {
        const result = await fetchHealthSafetyOverview(folderId, { refresh });
        setSummary(result.summary || EMPTY_SUMMARY);
        setAttention(result.attention || []);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : HEALTH_SAFETY_LOAD_USER_MESSAGE);
      } finally {
        setLoading(false);
      }
    },
    [folderId, cached?.summary],
  );

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const summaryCards = [
    { label: "Open incidents", value: summary.openIncidents },
    { label: "High risk incidents", value: summary.highRiskIncidents, tone: "danger" as const },
    { label: "RIDDOR decisions required", value: summary.riddorDecisionsRequired, tone: "warning" as const },
    { label: "Open RIDDOR reports", value: summary.openRiddorReports },
    { label: "COSHH reviews due", value: summary.coshhAssessmentsOverdue, tone: "warning" as const },
    { label: "Chemicals missing SDS", value: summary.chemicalsMissingSds, tone: "danger" as const },
    { label: "LOLER inspections overdue", value: summary.equipmentInspectionsOverdue, tone: "danger" as const },
  ];

  const openAttentionItem = (item: HealthSafetyAttentionItem) => {
    if (!onNavigate) return;
    const screen = item.navigate.screen as NavItemId;
    const params: Record<string, string> = {};
    if (item.navigate.incidentId) params.incidentId = item.navigate.incidentId;
    if (item.navigate.riddorId) params.riddorId = item.navigate.riddorId;
    if (item.navigate.coshhId) params.coshhId = item.navigate.coshhId;
    if (item.navigate.equipmentId) params.equipmentId = item.navigate.equipmentId;
    onNavigate(screen, params);
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Health & Safety"
        title="Overview"
        description="Cross-module summary for incidents, COSHH, RIDDOR, and equipment compliance."
        secondaryActions={
          onBack ? (
            <Button type="button" variant="secondary" onClick={onBack}>
              Back
            </Button>
          ) : undefined
        }
      />

      {loadError ? (
        <Section>
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {loadError}
            <button type="button" onClick={() => void loadOverview(true)} className="ml-3 font-semibold underline">
              Retry
            </button>
          </div>
        </Section>
      ) : null}

      <Section title="Summary">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</p>
              <p
                className={[
                  "mt-1 text-2xl font-black",
                  card.tone === "danger" ? "text-red-700" : card.tone === "warning" ? "text-amber-700" : "text-slate-900",
                ].join(" ")}
              >
                {loading ? "…" : card.value}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Requires attention">
        {loading && attention.length === 0 ? (
          <p className="text-sm text-slate-500">Loading attention items…</p>
        ) : attention.length === 0 ? (
          <EmptyState title="Nothing needs attention right now" description="Health & Safety items will appear here when action is required." />
        ) : (
          <div className="space-y-2">
            {attention.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openAttentionItem(item)}
                className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-slate-300"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {attentionKindLabel(item.kind)}
                    {item.site ? ` · ${item.site}` : ""}
                    {item.dueDate ? ` · Due ${formatDate(item.dueDate)}` : ""}
                  </p>
                </div>
                <StatusBadge variant={statusToBadgeVariant(item.status)} dot={false}>
                  {item.status.replace(/_/g, " ")}
                </StatusBadge>
              </button>
            ))}
          </div>
        )}
      </Section>
    </PageContainer>
  );
}
