import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyPanel } from "../components/dashboard/DashboardPrimitives";
import { AuditCentreBackButton } from "../components/auditCentre/AuditCentreBackButton";
import { AuditEvidencePanel } from "../components/evidence/AuditEvidencePanel";
import { SectionIntro } from "../components/SectionIntro";
import {
  COMPANY_RESULTS_LOADING_MESSAGE,
  COMPANY_RESULT_DETAIL_LOADING_MESSAGE,
} from "../services/resultsService";
import type { AuditResultDetail, ResultsScreenProps } from "../types/resultsScreenProps";
import {
  collectCompletedByOptions,
  collectStatusOptions,
  createInitialResultsFilters,
  EMPTY_RESULTS_FILTERS,
  enrichAuditResult,
  enrichAuditResults,
  buildScheduleLookup,
  filterEnrichedResults,
  hasActiveResultsFilters,
  sortResultsByCompletedAtDesc,
  type EnrichedAuditResult,
} from "../utils/resultsView";

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

const filterControlClass =
  "h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none";

function ScheduledCheckBadge({ selected }: { selected: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide ${
        selected ? "bg-white/15 text-white" : "bg-sky-50 text-sky-800"
      }`}
    >
      Scheduled check
    </span>
  );
}

function CompletionModeBadge({
  label,
  selected,
}: {
  label: string;
  selected: boolean;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[0.65rem] font-semibold ${
        selected ? "bg-white/10 text-slate-100" : "bg-slate-100 text-slate-600"
      }`}
    >
      {label}
    </span>
  );
}

function ResultMetaLine({
  result,
  selected,
}: {
  result: EnrichedAuditResult;
  selected: boolean;
}) {
  const mutedClass = selected ? "text-slate-300" : "text-slate-400";
  const bodyClass = selected ? "text-slate-200" : "text-slate-500";

  return (
    <div className={`mt-3 space-y-1 text-xs ${mutedClass}`}>
      <p className={bodyClass}>
        Completed by {result.completedByName || result.completedByEmail}
      </p>
      <p>{formatDisplayDate(result.completedAt)}</p>
      {result.frequency ? <p>Frequency: {result.frequency}</p> : null}
      {result.totalRiskScore ? <p>Risk score: {result.totalRiskScore}</p> : null}
      {result.highestRiskLevel ? <p>Highest risk: {result.highestRiskLevel}</p> : null}
    </div>
  );
}

function ResultDetailHeader({
  result,
  enriched,
  onClear,
}: {
  result: AuditResultDetail;
  enriched: EnrichedAuditResult;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {enriched.isScheduledCheck ? <ScheduledCheckBadge selected={false} /> : null}
          {enriched.completionModeLabel ? (
            <CompletionModeBadge label={enriched.completionModeLabel} selected={false} />
          ) : null}
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">
            {result.status || "completed"}
          </span>
        </div>
        <h2 className="mt-3 text-lg font-semibold text-slate-900">{enriched.checkDisplayName}</h2>
        {enriched.scheduleName ? (
          <p className="mt-1 text-sm text-slate-600">Schedule: {enriched.scheduleName}</p>
        ) : null}
        <p className="mt-1 text-sm text-slate-500">
          Completed by {result.completedByName || result.completedByEmail}
        </p>
        <p className="mt-1 text-xs text-slate-400">{formatDisplayDate(result.completedAt)}</p>
        {result.frequency ? (
          <p className="mt-1 text-xs text-slate-400">Frequency: {result.frequency}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
      >
        {t("common.close")}
      </button>
    </div>
  );
}

function ResultsFiltersPanel({
  filters,
  completedByOptions,
  statusOptions,
  filteredCount,
  totalCount,
  onChange,
  onClear,
}: {
  filters: typeof EMPTY_RESULTS_FILTERS;
  completedByOptions: string[];
  statusOptions: string[];
  filteredCount: number;
  totalCount: number;
  onChange: (next: typeof EMPTY_RESULTS_FILTERS) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const active = hasActiveResultsFilters(filters);

  return (
    <div className="rounded-[1.35rem] border border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{t("results.filterResults")}</p>
          <p className="mt-1 text-xs text-slate-500">
            Showing {filteredCount} of {totalCount} completed checks
          </p>
        </div>
        {active ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            {t("results.clearFilters")}
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Check or schedule
          </span>
          <input
            type="search"
            value={filters.nameQuery}
            onChange={(event) => onChange({ ...filters, nameQuery: event.target.value })}
            placeholder="Search name…"
            className={filterControlClass}
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Completed by
          </span>
          <select
            value={filters.completedBy}
            onChange={(event) => onChange({ ...filters, completedBy: event.target.value })}
            className={filterControlClass}
          >
            <option value="">All users</option>
            {completedByOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Status
          </span>
          <select
            value={filters.status}
            onChange={(event) => onChange({ ...filters, status: event.target.value })}
            className={filterControlClass}
          >
            <option value="">All statuses</option>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            From date
          </span>
          <input
            type="date"
            value={filters.fromDate}
            onChange={(event) => onChange({ ...filters, fromDate: event.target.value })}
            className={filterControlClass}
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            To date
          </span>
          <input
            type="date"
            value={filters.toDate}
            onChange={(event) => onChange({ ...filters, toDate: event.target.value })}
            className={filterControlClass}
          />
        </label>
      </div>
    </div>
  );
}

export function ResultsScreen({
  results,
  schedules = [],
  resultsLoading,
  resultsLoadingMore = false,
  resultsLoadError,
  resultsLoadWarning,
  resultsHasMore = false,
  onRefreshResults,
  onLoadMoreResults,
  selectedResultId,
  selectedResult,
  selectedResultLoading,
  selectedResultLoadError,
  onSelectResult,
  onClearSelectedResult,
  onBackToAuditCentre,
}: ResultsScreenProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState(createInitialResultsFilters);

  const basicResults = useMemo(
    () => sortResultsByCompletedAtDesc(results),
    [results],
  );
  const enrichedResults = useMemo(
    () => enrichAuditResults(results, schedules),
    [results, schedules],
  );
  const filteredResults = useMemo(
    () => sortResultsByCompletedAtDesc(filterEnrichedResults(enrichedResults, filters)),
    [enrichedResults, filters],
  );
  const completedByOptions = useMemo(() => collectCompletedByOptions(results), [results]);
  const statusOptions = useMemo(() => collectStatusOptions(results), [results]);
  const scheduleLookup = useMemo(() => buildScheduleLookup(schedules), [schedules]);
  const selectedEnriched = useMemo(() => {
    if (!selectedResult) {
      return null;
    }
    return enrichAuditResult(selectedResult, scheduleLookup);
  }, [selectedResult, scheduleLookup]);
  return (
    <div className="space-y-6">
      {onBackToAuditCentre ? <AuditCentreBackButton onClick={onBackToAuditCentre} /> : null}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <ResultsScreenIcon />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t("results.title")}</h1>
          <p className="text-sm text-slate-500">{t("results.subtitle")}</p>
        </div>
      </div>

      <SectionIntro text="Completed checks from your company AuditResults tab. Filter by date, user, or schedule, then open a row to review answers and evidence metadata." />

      {resultsLoadWarning ? (
        <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {resultsLoadWarning}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {onRefreshResults ? (
          <button
            type="button"
            onClick={onRefreshResults}
            disabled={resultsLoading || resultsLoadingMore}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resultsLoading ? t("results.refreshing") : t("results.refresh")}
          </button>
        ) : null}
        {resultsHasMore && onLoadMoreResults ? (
          <button
            type="button"
            onClick={onLoadMoreResults}
            disabled={resultsLoading || resultsLoadingMore}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resultsLoadingMore ? t("results.loadingMore") : t("results.loadMore")}
          </button>
        ) : null}
      </div>

      {resultsLoading && basicResults.length === 0 ? (
        <EmptyPanel title={COMPANY_RESULTS_LOADING_MESSAGE} text={t("results.readingWorkbook")} />
      ) : resultsLoadError && basicResults.length === 0 ? (
        <EmptyPanel title={t("results.couldNotLoad")} text={resultsLoadError} />
      ) : basicResults.length === 0 ? (
        <EmptyPanel
          title={t("results.noCompletedChecks")}
          text={t("results.emptyBody")}
        />
      ) : (
        <>
          <ResultsFiltersPanel
            filters={filters}
            completedByOptions={completedByOptions}
            statusOptions={statusOptions}
            filteredCount={filteredResults.length}
            totalCount={enrichedResults.length}
            onChange={setFilters}
            onClear={() => setFilters(createInitialResultsFilters())}
          />

          {filteredResults.length === 0 ? (
            <EmptyPanel
              title={t("results.noMatchFiltersTitle")}
              text={t("results.noMatchFiltersBody")}
            />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="space-y-3">
                {filteredResults.map((result) => {
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
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {result.isScheduledCheck ? (
                              <ScheduledCheckBadge selected={selected} />
                            ) : null}
                            {result.completionModeLabel ? (
                              <CompletionModeBadge
                                label={result.completionModeLabel}
                                selected={selected}
                              />
                            ) : null}
                          </div>
                          <p
                            className={`mt-2 text-sm font-semibold ${selected ? "text-white" : "text-slate-900"}`}
                          >
                            {result.checkDisplayName}
                          </p>
                          {result.scheduleName ? (
                            <p className={`mt-1 text-sm ${selected ? "text-slate-200" : "text-slate-600"}`}>
                              Schedule: {result.scheduleName}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
                            selected ? "bg-white/10 text-white" : "bg-emerald-50 text-emerald-800"
                          }`}
                        >
                          {result.status || "completed"}
                        </span>
                      </div>
                      <ResultMetaLine result={result} selected={selected} />
                    </button>
                  );
                })}
              </div>

              <div className="space-y-4">
                {!selectedResultId ? (
                  <EmptyPanel
                    title={t("results.selectCheck")}
                    text={t("results.selectCheckBody")}
                  />
                ) : selectedResultLoading ? (
                  <EmptyPanel
                    title={COMPANY_RESULT_DETAIL_LOADING_MESSAGE}
                    text={t("results.readingSavedAnswers")}
                  />
                ) : selectedResultLoadError ? (
                  <EmptyPanel title={t("results.couldNotLoadDetails")} text={selectedResultLoadError} />
                ) : selectedResult && selectedEnriched ? (
                  <>
                    <ResultDetailHeader
                      result={selectedResult}
                      enriched={selectedEnriched}
                      onClear={onClearSelectedResult}
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[1.25rem] border border-slate-200/80 bg-white p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                          Result ID
                        </p>
                        <p className="mt-2 break-all text-sm text-slate-700">{selectedResult.resultId}</p>
                      </div>
                      <div className="rounded-[1.25rem] border border-slate-200/80 bg-white p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                          Schedule
                        </p>
                        <p className="mt-2 text-sm text-slate-700">
                          {selectedEnriched.scheduleName || selectedResult.scheduleId || "—"}
                        </p>
                      </div>
                      {selectedResult.frequency ? (
                        <div className="rounded-[1.25rem] border border-slate-200/80 bg-white p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            Frequency
                          </p>
                          <p className="mt-2 text-sm text-slate-700">{selectedResult.frequency}</p>
                        </div>
                      ) : null}
                      {selectedResult.totalRiskScore || selectedResult.highestRiskLevel ? (
                        <div className="rounded-[1.25rem] border border-slate-200/80 bg-white p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            Outcome
                          </p>
                          <p className="mt-2 text-sm text-slate-700">
                            {[selectedResult.totalRiskScore, selectedResult.highestRiskLevel]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <JsonPanel title={t("results.answers")} body={selectedResult.answersDisplay} />
                    <JsonPanel title={t("results.findings")} body={selectedResult.findingsDisplay} />
                    <AuditEvidencePanel result={selectedResult} />
                  </>
                ) : (
                  <EmptyPanel
                    title={t("results.detailUnavailable")}
                    text={t("results.detailUnavailableBody")}
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
