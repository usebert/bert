import type { NavItemId } from "../../types/navigation";
import type { QmsReadinessSummary } from "../../types/qms";
import { DASHBOARD_CARD, SecondaryButton } from "../dashboard/RoleDashboardPrimitives";
import { AlertTriangleIcon } from "../icons/AlertTriangleIcon";

type Props = {
  summary: QmsReadinessSummary;
  compact?: boolean;
  onOpenHub?: () => void;
  onNavigate?: (screen: NavItemId) => void;
  onOpenReviewPack?: () => void;
};

function MetricTile({
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
      <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-black tabular-nums ${alert ? "text-rose-600" : "text-slate-900"}`}>{value}</p>
    </>
  );
  const className = "rounded-3xl border border-slate-200 bg-slate-50/80 p-5 text-left transition hover:border-slate-300 hover:bg-white";
  if (!onClick) {
    return <div className={className}>{body}</div>;
  }
  return (
    <button type="button" onClick={onClick} className={[className, "w-full"].join(" ")}>
      {body}
    </button>
  );
}

export function QmsReadinessSummaryWidget({ summary, compact, onOpenHub, onNavigate, onOpenReviewPack }: Props) {
  const reviewTone =
    summary.managementReviewStatus === "ready"
      ? "text-emerald-700"
      : summary.managementReviewStatus === "attention"
        ? "text-amber-700"
        : "text-slate-600";

  if (compact) {
    return (
      <section className={DASHBOARD_CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
              <AlertTriangleIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Quality & Safety Hub</p>
            <h3 className="mt-1 text-lg font-black text-slate-900">Quality & safety snapshot</h3>
            <p className="mt-1 text-sm text-slate-600">A simple view of what needs review, action, or evidence.</p>
            </div>
          </div>
          {onOpenHub ? (
            <button
              type="button"
              onClick={onOpenHub}
              className="shrink-0 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Open hub
            </button>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <MetricTile label="Documents to review" value={summary.documentsNeedingReview} alert={summary.documentsNeedingReview > 0} onClick={onOpenHub} />
          <MetricTile label="Overdue actions" value={summary.overdueHsActions} alert={summary.overdueHsActions > 0} onClick={onNavigate ? () => onNavigate("actions") : onOpenHub} />
        </div>
      </section>
    );
  }

  return (
    <section className={DASHBOARD_CARD}>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
          <AlertTriangleIcon className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-lg font-black text-slate-900">Control summary</h3>
          <p className="mt-1 text-sm text-slate-600">A simple view of what needs review, action, or evidence.</p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Documents to review"
          value={summary.documentsNeedingReview}
          alert={summary.documentsNeedingReview > 0}
          onClick={onOpenHub}
        />
        <MetricTile
          label="Open quality issues"
          value={summary.openNonConformances}
          alert={summary.openNonConformances > 0}
          onClick={onNavigate ? () => onNavigate("nonConformance") : onOpenHub}
        />
        <MetricTile
          label="Overdue actions"
          value={summary.overdueHsActions}
          alert={summary.overdueHsActions > 0}
          onClick={onNavigate ? () => onNavigate("actions") : onOpenHub}
        />
        <MetricTile label="Open safety hazards" value={summary.openHazards} alert={summary.openHazards > 0} onClick={onOpenHub} />
      </div>
      <div className="mt-5 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50/80 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Review pack</p>
          <p className={`mt-1 text-sm font-bold capitalize ${reviewTone}`}>{summary.managementReviewStatus.replace("_", " ")}</p>
          <p className="mt-1 text-sm text-slate-600">{summary.managementReviewDetail}</p>
        </div>
        {onOpenReviewPack ? (
          <SecondaryButton onClick={onOpenReviewPack} className="w-full sm:w-auto sm:min-w-[10rem]">
            Review pack
          </SecondaryButton>
        ) : null}
      </div>
    </section>
  );
}
