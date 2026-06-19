export type ReportsDateRange = "7" | "30" | "90" | "all";

export type ReportsDashboardSummary = {
  totalChecksScheduled: number;
  completedChecks: number;
  overdueChecks: number;
  openFindings: number;
  openActions: number;
  completionRatePercent: number;
};

export type ReportsChartPoint = {
  label: string;
  value: number;
};

export type ReportsPassFailPoint = {
  label: string;
  pass: number;
  fail: number;
};

export type ReportsDashboardCharts = {
  checksCompletedOverTime: ReportsChartPoint[];
  completionRateBySiteArea: ReportsChartPoint[];
  openFindingsBySeverity: ReportsChartPoint[];
  openActionsByStatus: ReportsChartPoint[];
  outstandingChecksByAssignee: ReportsChartPoint[];
  passFailTrend: ReportsPassFailPoint[];
};

export type ReportsFilterOption = {
  id: string;
  name: string;
};

export type ReportsDashboardFilters = {
  dateRanges: string[];
  sites: string[];
  areas: ReportsFilterOption[];
  assignees: string[];
  statuses: string[];
};

export type ReportsDashboardDiagnostics = {
  failedTabs?: string[];
  technicalError?: string;
  durationMs?: number;
  masterSheetId?: string;
};

export type ReportsDashboardEmptyState = "no-data" | "schedules-only" | null;

export type ReportsDashboardPayload = {
  ok: boolean;
  cached?: boolean;
  refreshing?: boolean;
  stale?: boolean;
  summary: ReportsDashboardSummary;
  charts: ReportsDashboardCharts;
  filters: ReportsDashboardFilters;
  emptyState: ReportsDashboardEmptyState;
  diagnostics?: ReportsDashboardDiagnostics;
  loadError?: string;
  technicalError?: string;
};

export type ReportsDashboardQuery = {
  dateRange?: ReportsDateRange;
  site?: string;
  area?: string;
  assignee?: string;
  status?: string;
};
