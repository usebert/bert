import { EmptyPanel } from "../components/dashboard/DashboardPrimitives";
import { SectionIntro } from "../components/SectionIntro";
import {
  COMPANY_RESULTS_LOADING_MESSAGE,
  COMPANY_RESULT_DETAIL_LOADING_MESSAGE,
} from "../services/resultsService";
import type { ResultsScreenProps } from "../types/resultsScreenProps";

function formatDisplayDate(isoOrDisplay: string): string {
  const parsed = Date.parse(isoOrDisplay);
  if (Number.isNaN(parsed)) {
    return isoOrDisplay || "—";
  }
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(parsed));
  } catch {
    return isoOrDisplay;
  }
}

function ResultsScreenIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function JsonPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.25rem] border border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</p>
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-700">
        {body}
      </pre>
    </div>
  );
}

export function ResultsScreen({
  results,
  resultsLoading,
  resultsLoadError,
  selectedResultId,
  selectedResult,
  selectedResultLoading,
  selectedResultLoadError,
  onSelectResult,
  onClearSelectedResult,
}: ResultsScreenProps) {
  const sortedResults = [...results].sort(
    (a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <ResultsScreenIcon />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Results</h1>
          <p className="text-sm text-slate-500">Completed checks saved to your company workbook.</p>
        </div>
      </div>

      <SectionIntro text="Completed checks from your company AuditResults tab. Open a row to review answers and evidence metadata." />

      {resultsLoading ? (
        <EmptyPanel title={COMPANY_RESULTS_LOADING_MESSAGE} text="Reading your company workbook…" />
      ) : resultsLoadError ? (
        <EmptyPanel title="Could not load results" text={resultsLoadError} />
      ) : sortedResults.length === 0 ? (
        <EmptyPanel
          title="No completed checks yet"
          text="When someone completes a check, it will appear here from your company workbook."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-3">
            {sortedResults.map((result) => {
              const selected = selectedResultId === result.resultId;
              return (
                <button
                  key={result.resultId}
                  type="button"
                  onClick={() => onSelectResult(result.resultId)}
                  className={`w-full rounded-[1.35rem] border px-4 py-4 text-left shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition ${
                    selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200/80 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={`text-sm font-semibold ${selected ? "text-white" : "text-slate-900"}`}>
                        {result.auditName || result.scheduleId || "Completed check"}
                      </p>
                      <p className={`mt-1 text-sm ${selected ? "text-slate-200" : "text-slate-500"}`}>
                        {result.completedByName || result.completedByEmail}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
                        selected ? "bg-white/10 text-white" : "bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      {result.status || "completed"}
                    </span>
                  </div>
                  <p className={`mt-3 text-xs ${selected ? "text-slate-300" : "text-slate-400"}`}>
                    {formatDisplayDate(result.completedAt)}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="space-y-4">
            {!selectedResultId ? (
              <EmptyPanel title="Select a completed check" text="Choose a result to review completion metadata and saved answers." />
            ) : selectedResultLoading ? (
              <EmptyPanel title={COMPANY_RESULT_DETAIL_LOADING_MESSAGE} text="Reading saved answers…" />
            ) : selectedResultLoadError ? (
              <EmptyPanel title="Could not load check details" text={selectedResultLoadError} />
            ) : selectedResult ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      {selectedResult.auditName || selectedResult.scheduleId}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Completed by {selectedResult.completedByName || selectedResult.completedByEmail}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatDisplayDate(selectedResult.completedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClearSelectedResult}
                    className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.25rem] border border-slate-200/80 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Result ID</p>
                    <p className="mt-2 break-all text-sm text-slate-700">{selectedResult.resultId}</p>
                  </div>
                  <div className="rounded-[1.25rem] border border-slate-200/80 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Schedule ID</p>
                    <p className="mt-2 break-all text-sm text-slate-700">{selectedResult.scheduleId || "—"}</p>
                  </div>
                </div>

                <JsonPanel title="Answers" body={selectedResult.answersDisplay} />
                <JsonPanel title="Findings" body={selectedResult.findingsDisplay} />
                <JsonPanel title="Evidence refs" body={selectedResult.evidenceDisplay} />
              </>
            ) : (
              <EmptyPanel title="Check details unavailable" text="This completed check could not be shown." />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
