import { useEffect, useState } from "react";
import type { NavItemId } from "../../types/navigation";
import {
  fetchHealthSafetyOverview,
  readCachedHealthSafetyOverview,
} from "../../services/healthSafetyService";
import type { HealthSafetyOverviewSummary } from "../../types/healthSafety";

type Props = {
  companyFolderId: string;
  onNavigate: (screen: NavItemId) => void;
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
  overdueRiskAssessments: 0,
  awaitingApprovalRiskAssessments: 0,
  highResidualRiskAssessments: 0,
};

/**
 * Compact dashboard card — RIDDOR decisions, COSHH reviews, and missing SDS counts.
 */
export function HealthSafetySummaryCard({ companyFolderId, onNavigate }: Props) {
  const folderId = String(companyFolderId || "").trim();
  const [summary, setSummary] = useState<HealthSafetyOverviewSummary | null>(
    () => readCachedHealthSafetyOverview(folderId)?.summary || null,
  );
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!folderId) return;
    let cancelled = false;
    void fetchHealthSafetyOverview(folderId)
      .then((result) => {
        if (!cancelled && result.summary) {
          setSummary(result.summary);
          setLoadFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  const display = summary || EMPTY_SUMMARY;
  const attentionCount =
    display.riddorDecisionsRequired +
    display.coshhAssessmentsOverdue +
    display.chemicalsMissingSds +
    display.overdueRiskAssessments +
    display.awaitingApprovalRiskAssessments;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black text-slate-900">Health & Safety</h2>
        <button
          type="button"
          onClick={() => onNavigate("healthSafety")}
          className="text-sm font-semibold text-slate-700 underline-offset-2 hover:underline"
        >
          Open overview
        </button>
        {(display.overdueRiskAssessments > 0 || display.awaitingApprovalRiskAssessments > 0 || display.highResidualRiskAssessments > 0) ? (
          <button
            type="button"
            onClick={() => onNavigate("riskAssessments")}
            className="text-sm font-semibold text-slate-700 underline-offset-2 hover:underline"
          >
            Risk assessments
          </button>
        ) : null}
      </div>
      {summary || !loadFailed ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Needs attention</p>
            <p className="mt-1 text-2xl font-black text-amber-800">{attentionCount}</p>
          </div>
          <div className="rounded-xl border border-red-100 bg-red-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">RIDDOR decisions</p>
            <p className="mt-1 text-2xl font-black text-red-800">{display.riddorDecisionsRequired}</p>
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">COSHH reviews</p>
            <p className="mt-1 text-2xl font-black text-sky-800">{display.coshhAssessmentsOverdue}</p>
          </div>
          <div className="rounded-xl border border-violet-100 bg-violet-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Missing SDS</p>
            <p className="mt-1 text-2xl font-black text-violet-800">{display.chemicalsMissingSds}</p>
          </div>
          {display.overdueRiskAssessments > 0 || display.awaitingApprovalRiskAssessments > 0 || display.highResidualRiskAssessments > 0 ? (
            <div className="col-span-2 rounded-xl border border-rose-100 bg-rose-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Risk assessments</p>
              <p className="mt-1 text-sm text-rose-900">
                {[
                  display.overdueRiskAssessments > 0 ? `${display.overdueRiskAssessments} overdue` : "",
                  display.awaitingApprovalRiskAssessments > 0 ? `${display.awaitingApprovalRiskAssessments} awaiting approval` : "",
                  display.highResidualRiskAssessments > 0 ? `${display.highResidualRiskAssessments} high residual risk` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Health & Safety summary is unavailable right now.</p>
      )}
    </section>
  );
}
