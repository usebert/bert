import type { NavItemId } from "../../types/navigation";
import type { QmsReadinessSummary } from "../../types/qms";

type Props = {
  summary: QmsReadinessSummary;
  compact?: boolean;
  onOpenHub?: () => void;
  onNavigate?: (screen: NavItemId) => void;
};

function MetricButton({
  label,
  value,
  alert,
  onClick,
}: {
  label: string;
  value: number;
  alert: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${alert ? "text-amber-700" : "text-slate-900"}`}>
        {value}
      </p>
    </>
  );
  if (!onClick) {
    return <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-left transition hover:border-slate-200 hover:bg-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-400"
    >
      {body}
    </button>
  );
}

export function QmsReadinessSummaryWidget({ summary, compact, onOpenHub, onNavigate }: Props) {
  const reviewTone =
    summary.managementReviewStatus === "ready"
      ? "text-emerald-700"
      : summary.managementReviewStatus === "attention"
        ? "text-amber-700"
        : "text-slate-600";

  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Quality & safety readiness</p>
          <h3 className="mt-1 text-sm font-semibold text-slate-900">
            {compact ? "Quality & safety snapshot" : "Readiness summary"}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            BERT helps you stay ready for audits. Supports ISO 9001 and ISO 45001 readiness — BERT does not certify you.
          </p>
        </div>
        {onOpenHub ? (
          <button
            type="button"
            onClick={onOpenHub}
            className="shrink-0 rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Open hub
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <MetricButton
          label="Documents needing review"
          value={summary.documentsNeedingReview}
          alert={summary.documentsNeedingReview > 0}
          onClick={onOpenHub}
        />
        <MetricButton
          label="Training expiring soon"
          value={summary.trainingExpiringSoon}
          alert={summary.trainingExpiringSoon > 0}
          onClick={onOpenHub}
        />
        <MetricButton
          label="Open non-conformances"
          value={summary.openNonConformances}
          alert={summary.openNonConformances > 0}
          onClick={onNavigate ? () => onNavigate("nonConformance") : onOpenHub}
        />
        <MetricButton
          label="Overdue actions (all)"
          value={summary.overdueHsActions}
          alert={summary.overdueHsActions > 0}
          onClick={onNavigate ? () => onNavigate("actions") : onOpenHub}
        />
        <MetricButton
          label="Open hazards"
          value={summary.openHazards}
          alert={summary.openHazards > 0}
          onClick={onOpenHub}
        />
        <MetricButton
          label="Open incidents / near misses"
          value={summary.openIncidentsAndNearMisses}
          alert={summary.openIncidentsAndNearMisses > 0}
          onClick={onNavigate ? () => onNavigate("incidents") : onOpenHub}
        />
        <MetricButton
          label="Quality risks needing review"
          value={summary.risksNeedingReview}
          alert={summary.risksNeedingReview > 0}
          onClick={onOpenHub}
        />
        <MetricButton
          label="Safety risk assessments due"
          value={summary.riskAssessmentsDueReview}
          alert={summary.riskAssessmentsDueReview > 0}
          onClick={onOpenHub}
        />
        <MetricButton
          label="H&S objectives at risk"
          value={summary.safetyObjectivesAtRisk}
          alert={summary.safetyObjectivesAtRisk > 0}
          onClick={onOpenHub}
        />
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 sm:col-span-2 lg:col-span-3">
          <p className="text-xs font-medium text-slate-500">Management review pack</p>
          <p className={`mt-1 text-sm font-semibold capitalize ${reviewTone}`}>{summary.managementReviewStatus.replace("_", " ")}</p>
          <p className="mt-1 text-xs text-slate-600">{summary.managementReviewDetail}</p>
        </div>
      </div>
    </section>
  );
}
