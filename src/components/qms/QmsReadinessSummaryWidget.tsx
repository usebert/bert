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

function ControlMetricTile({
  badge,
  badgeClass,
  value,
  onClick,
}: {
  badge: string;
  badgeClass: string;
  value: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={["inline-flex rounded-full px-2.5 py-0.5 text-xs font-black", badgeClass].join(" ")}>{badge}</span>
      <p className="mt-3 text-lg font-black text-slate-900">{value}</p>
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
  if (compact) {
    const documentsValue =
      summary.documentsNeedingReview === 1
        ? "1 to review"
        : `${summary.documentsNeedingReview} to review`;
    const trainingValue =
      summary.trainingExpiringSoon === 1 ? "1 expiring" : `${summary.trainingExpiringSoon} expiring`;
    const qualityValue = summary.openNonConformances === 1 ? "1 open" : `${summary.openNonConformances} open`;
    const hazardsValue = summary.openHazards === 1 ? "1 open" : `${summary.openHazards} open`;

    return (
      <section className={DASHBOARD_CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-orange-600">Quality & Safety</p>
            <h3 className="mt-1 text-xl font-black text-slate-900">Control summary</h3>
            <p className="mt-1 text-sm text-slate-600">A simple view of what needs review, action, or evidence.</p>
          </div>
          {onOpenReviewPack ? (
            <SecondaryButton onClick={onOpenReviewPack} className="shrink-0 gap-2 sm:min-w-[10rem]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
              </svg>
              Review pack
            </SecondaryButton>
          ) : null}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ControlMetricTile
            badge="Documents"
            badgeClass="bg-blue-100 text-blue-800"
            value={documentsValue}
            onClick={onOpenHub}
          />
          <ControlMetricTile
            badge="Training"
            badgeClass="bg-amber-100 text-amber-900"
            value={trainingValue}
            onClick={onNavigate ? () => onNavigate("documentTraining") : onOpenHub}
          />
          <ControlMetricTile
            badge="Quality issues"
            badgeClass="bg-emerald-100 text-emerald-900"
            value={qualityValue}
            onClick={onNavigate ? () => onNavigate("nonConformance") : onOpenHub}
          />
          <ControlMetricTile
            badge="Safety hazards"
            badgeClass="bg-rose-100 text-rose-900"
            value={hazardsValue}
            onClick={onOpenHub}
          />
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
        <ControlMetricTile
          badge="Documents"
          badgeClass="bg-blue-100 text-blue-800"
          value={summary.documentsNeedingReview === 1 ? "1 to review" : `${summary.documentsNeedingReview} to review`}
          onClick={onOpenHub}
        />
        <ControlMetricTile
          badge="Training"
          badgeClass="bg-amber-100 text-amber-900"
          value={summary.trainingExpiringSoon === 1 ? "1 expiring" : `${summary.trainingExpiringSoon} expiring`}
          onClick={onNavigate ? () => onNavigate("documentTraining") : onOpenHub}
        />
        <ControlMetricTile
          badge="Quality issues"
          badgeClass="bg-emerald-100 text-emerald-900"
          value={summary.openNonConformances === 1 ? "1 open" : `${summary.openNonConformances} open`}
          onClick={onNavigate ? () => onNavigate("nonConformance") : onOpenHub}
        />
        <ControlMetricTile
          badge="Safety hazards"
          badgeClass="bg-rose-100 text-rose-900"
          value={summary.openHazards === 1 ? "1 open" : `${summary.openHazards} open`}
          onClick={onOpenHub}
        />
      </div>
      {onOpenReviewPack ? (
        <div className="mt-5 flex justify-end">
          <SecondaryButton onClick={onOpenReviewPack}>Review pack</SecondaryButton>
        </div>
      ) : null}
    </section>
  );
}
