export type AuditResultSummary = {
  resultId: string;
  scheduleId: string;
  auditId?: string;
  auditName?: string;
  completedAt: string;
  completedByEmail: string;
  completedByName: string;
  status: string;
  companyFolderId: string;
  nextDueAt?: string;
  frequency?: string;
  totalRiskScore?: string;
  highestRiskLevel?: string;
};

export type AuditResultDetail = AuditResultSummary & {
  answers: Record<string, unknown> | null;
  findings: unknown[] | null;
  evidenceRefs: unknown[] | null;
  answersDisplay: string;
  findingsDisplay: string;
  evidenceDisplay: string;
};

import type { ManagedSchedule } from "./reportsScreenProps";

export type ResultsScreenProps = {
  results: AuditResultSummary[];
  schedules?: ManagedSchedule[];
  resultsLoading: boolean;
  resultsLoadError?: string;
  selectedResultId: string | null;
  selectedResult: AuditResultDetail | null;
  selectedResultLoading: boolean;
  selectedResultLoadError?: string;
  onSelectResult: (resultId: string) => void;
  onClearSelectedResult: () => void;
};
