import { useEffect, useState } from "react";
import type { ResolvedCompanyContext } from "../../services/companyContextService";
import { fetchReportsDashboard } from "../../services/reportsDashboardService";
import {
  readReportsDashboardCache,
  REPORTS_DASHBOARD_LOAD_TIMEOUT_MS,
  writeReportsDashboardCache,
} from "../../services/reportsDashboardCache";
import type { ReportsDashboardPayload, ReportsDashboardQuery } from "../../types/reportsDashboard";
import { EmptyReportState } from "./EmptyReportState";
import { ReportBarChart } from "./ReportBarChart";
import { ReportFilters } from "./ReportFilters";
import { ReportLineChart } from "./ReportLineChart";
import { ReportPieChart } from "./ReportPieChart";
import { ReportSummaryCards } from "./ReportSummaryCards";

const defaultQuery: ReportsDashboardQuery = { dateRange: "30" };

export function ReportsDashboardPanel({
  companyContext,
  showDiagnostics = false,
  enabled = true,
}: {
  companyContext: ResolvedCompanyContext;
  showDiagnostics?: boolean;
  enabled?: boolean;
}) {
  const [query, setQuery] = useState<ReportsDashboardQuery>(defaultQuery);
  const [payload, setPayload] = useState<ReportsDashboardPayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();

  useEffect(() => {
    const companyId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
    const masterSheetId = String(companyContext.masterSheetId || "").trim();
    if (!enabled || !companyId || !masterSheetId) {
      setPayload(null);
      setLoadError(undefined);
      return;
    }

    const cachedEntry = readReportsDashboardCache(companyId, query);
    if (cachedEntry?.payload?.ok) {
      setPayload(cachedEntry.payload);
      setLoadError(undefined);
    } else {
      setPayload(null);
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REPORTS_DASHBOARD_LOAD_TIMEOUT_MS);
    let cancelled = false;
    setRefreshing(true);

    void (async () => {
      try {
        const result = await fetchReportsDashboard(companyContext, {
          query,
          signal: controller.signal,
          diagnostics: showDiagnostics,
        });
        if (cancelled) {
          return;
        }
        if (result.ok) {
          setPayload(result);
          setLoadError(undefined);
          writeReportsDashboardCache({
            companyId,
            filterKey: [
              query.dateRange || "30",
              query.site || "",
              query.area || "",
              query.assignee || "",
              query.status || "",
            ].join("|"),
            payload: result,
            cachedAt: Date.now(),
          });
        } else if (!cachedEntry?.payload?.ok) {
          setPayload(result);
          setLoadError(result.loadError);
        }
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) {
          if (cachedEntry?.payload?.ok) {
            setLoadError(undefined);
          } else if (!cachedEntry) {
            setLoadError("Could not load reports right now. Try again.");
          }
          return;
        }
        if (!cachedEntry?.payload?.ok) {
          setLoadError(error instanceof Error ? error.message : "Could not load reports right now. Try again.");
        }
      } finally {
        if (!cancelled) {
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    companyContext.companyFolderId,
    companyContext.companyId,
    companyContext.companyName,
    companyContext.masterSheetId,
    enabled,
    query,
    showDiagnostics,
  ]);

  if (!enabled) {
    return null;
  }

  if (!payload && !loadError) {
    return (
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-500">Loading live reports…</p>
      </section>
    );
  }

  if (loadError && !payload?.ok) {
    return (
      <section className="rounded-[1.75rem] border border-rose-200 bg-rose-50 p-4">
        <p className="text-sm font-semibold text-rose-900">{loadError}</p>
        {showDiagnostics && payload?.diagnostics ? (
          <pre className="mt-2 overflow-x-auto text-xs text-rose-800">{JSON.stringify(payload.diagnostics, null, 2)}</pre>
        ) : null}
      </section>
    );
  }

  if (!payload) {
    return null;
  }

  return (
    <section className="space-y-4 rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Live reporting</p>
          <h3 className="text-base font-semibold text-slate-900">Visual dashboard</h3>
        </div>
        {refreshing ? <p className="text-xs font-medium text-slate-500">Updating report data…</p> : null}
      </div>

      <ReportFilters filters={payload.filters} query={query} onChange={setQuery} />
      <ReportSummaryCards summary={payload.summary} />

      {payload.emptyState ? <EmptyReportState state={payload.emptyState} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportLineChart title="Checks completed over time" data={payload.charts.checksCompletedOverTime} />
        <ReportBarChart title="Completion rate by site/area (%)" data={payload.charts.completionRateBySiteArea} color="#2563eb" />
        <ReportPieChart title="Open findings by severity" data={payload.charts.openFindingsBySeverity} />
        <ReportBarChart title="Open actions by status" data={payload.charts.openActionsByStatus} color="#f59e0b" />
        <ReportBarChart
          title="Outstanding checks by assignee"
          data={payload.charts.outstandingChecksByAssignee}
          horizontal
          color="#0f172a"
        />
        <ReportLineChart title="Pass/fail trend" data={payload.charts.passFailTrend} dualSeries />
      </div>

      {showDiagnostics && payload.diagnostics ? (
        <details className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-800">Godmode diagnostics</summary>
          <pre className="mt-2 overflow-x-auto">{JSON.stringify(payload.diagnostics, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  );
}
