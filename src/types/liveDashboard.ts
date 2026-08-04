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
  itemType?: string;
  recordType?: string;
  recordId?: string;
  route?: string;
  companyFolderId?: string;
  navigate?: import("../presentation/searchPresentation").SearchNavigateTarget;
  sourceType?: string;
  sourceId?: string;
  sourceRoute?: string;
  sourceTitle?: string;
  scheduleId?: string;
  templateId?: string;
  auditId?: string;
};

export type LiveOperationalNavItem = {
  id: string;
  title: string;
  subtitle?: string;
  area?: string;
  owner?: string;
  dueLabel?: string;
  status?: string;
  dueDate?: string;
  itemType?: string;
  recordType?: string;
  recordId?: string;
  route?: string;
  companyFolderId?: string;
  navigate?: import("../presentation/searchPresentation").SearchNavigateTarget;
  sourceType?: string;
  sourceId?: string;
  sourceRoute?: string;
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

export type LiveOverdueInspection = LiveOperationalNavItem & {
  hoursLate: number;
  priority: LiveRiskLevel;
};

export type LiveOutstandingAction = LiveOperationalNavItem & {
  severity: LiveRiskLevel;
};

export type LiveCurrentIncident = LiveOperationalNavItem & {
  severity: LiveRiskLevel;
  daysOpen: number;
};

export type LiveBriefingItem = LiveOperationalNavItem & {
  priority: LiveRiskLevel;
  mandatory: boolean;
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
