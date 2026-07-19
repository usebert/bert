import type { DocumentControlSummary } from "../../types/documentControl";

type Props = {
  summary: DocumentControlSummary;
};

export function DocumentControlSummary({ summary }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs text-slate-500">Current</p>
        <p className="text-xl font-semibold text-emerald-700">{summary.current}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs text-slate-500">Awaiting approval</p>
        <p className="text-xl font-semibold text-amber-700">{summary.awaitingApproval}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs text-slate-500">Drafts</p>
        <p className="text-xl font-semibold text-slate-700">{summary.drafts}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs text-slate-500">Reviews due</p>
        <p className="text-xl font-semibold text-red-700">{summary.reviewsDue}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs text-slate-500">Archived</p>
        <p className="text-xl font-semibold text-slate-500">{summary.archived}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs text-slate-500">Total</p>
        <p className="text-xl font-semibold text-slate-900">{summary.total}</p>
      </div>
    </div>
  );
}
