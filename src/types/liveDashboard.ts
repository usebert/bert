export type LiveRiskLevel = "Low" | "Medium" | "High" | "Critical";

export type LiveDashboardMetrics = {
  todayDue: number;
  todayCompleted: number;
  todayOutstanding: number;
  overdueInspections: number;
  openActions: number;
  overdueActions: number;
  currentIncidents: number;
  pendingBriefings: number;
  complianceScore: number;
};

export type LiveDashboardToday = {
  dateLabel: string;
  due: number;
  completed: number;
  outstanding: number;
  overdue: number;
  missedChecks: number;
};

export type LiveActTodayItem = {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  area: string;
  owner: string;
  priority: LiveRiskLevel;
  dueLabel: string;
  rank: number;
};

export type LiveComplianceReduction = {
  key: string;
  label: string;
  count: number;
  points: number;
};

export type LiveCompliance = {
  score: number;
  label: "Good" | "Needs attention" | "Critical";
  reductions: LiveComplianceReduction[];
};

export type LiveRiskArea = {
  area: string;
  overdueInspections: number;
  openActions: number;
  incidents: number;
  criticalFindings: number;
  score: number;
  level: LiveRiskLevel;
};

export type LiveOverdueInspection = {
  id: string;
  title: string;
  subtitle: string;
  area: string;
  owner: string;
  hoursLate: number;
  priority: LiveRiskLevel;
  dueLabel: string;
};

export type LiveOutstandingAction = {
  id: string;
  title: string;
  subtitle: string;
  area: string;
  owner: string;
  severity: LiveRiskLevel;
  dueDate: string;
  dueLabel: string;
};

export type LiveCurrentIncident = {
  id: string;
  title: string;
  subtitle: string;
  area: string;
  owner: string;
  severity: LiveRiskLevel;
  status: string;
  daysOpen: number;
  dueLabel: string;
};

export type LiveBriefingItem = {
  id: string;
  title: string;
  subtitle: string;
  owner: string;
  priority: LiveRiskLevel;
  mandatory: boolean;
  dueLabel: string;
};

export type LiveChartPoint = { label: string; value: number };

export type LiveDashboardCharts = {
  auditTrend: LiveChartPoint[];
  actionBreakdown: LiveChartPoint[];
  incidentTrend: LiveChartPoint[];
  briefingStatus: LiveChartPoint[];
};

export type LiveSyncStatus = {
  queued: number;
  failed: number;
  lastStatus: string;
  lastSyncAt: string;
  hasIssue: boolean;
  message: string;
};

export type LiveDashboardWarning = { source: string; message: string } | string;

export type LiveDashboardPayload = {
  ok: boolean;
  cached?: boolean;
  stale?: boolean;
  generatedAt: string;
  metrics: LiveDashboardMetrics;
  today: LiveDashboardToday;
  actToday: LiveActTodayItem[];
  compliance: LiveCompliance;
  riskByArea: LiveRiskArea[];
  riskEmptyMessage: string;
  sections: {
    outstandingActions: LiveOutstandingAction[];
    overdueInspections: LiveOverdueInspection[];
    currentIncidents: LiveCurrentIncident[];
    briefings: LiveBriefingItem[];
  };
  charts: LiveDashboardCharts;
  sync: LiveSyncStatus;
  warnings: LiveDashboardWarning[];
  emptyState: "no-data" | "all-clear" | null;
  loadError?: string;
};

export type LiveDashboardContext = {
  companyId?: string;
  companyFolderId?: string;
  companyName?: string;
  masterSheetId?: string;
};

export type LiveDashboardQuery = {
  refresh?: boolean;
  syncQueued?: number;
  syncFailed?: number;
  lastSyncAt?: string;
};
