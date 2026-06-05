/**
 * Structural props types for ReportsScreen — mirrors App.tsx domain types so the screen
 * does not import App.tsx. Keep aligned when workspace models change.
 */

export type AuditStatus = "green" | "amber" | "red";
export type Answer = "pass" | "nc" | "fail";
export type Priority = "High" | "Medium" | "Low";
export type RiskLevel = "Low" | "Medium" | "High" | "Critical";
export type RiskCategory = "Health & Safety" | "Quality" | "Environmental" | "Operational" | "Other";
export type ActionStatus = "Open" | "In Progress" | "Awaiting Verification" | "Closed" | "Rejected";
export type ScheduleFrequency = "Daily" | "Weekly" | "Bi-Weekly" | "Monthly";
export type ScheduleDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type ScheduleLifecycle = "Live" | "Archived";
export type ScheduleHealthState = "Healthy" | "Due Soon" | "Overdue" | "Failing" | "Paused";

export type AuditQuestion = {
  id: string;
  text: string;
  fieldType?: "Traffic light" | "Text note" | "Photo evidence" | "Pass / Fail";
  riskLevel?: RiskLevel;
  riskCategory?: RiskCategory;
  autoActionRequired?: boolean;
  requiresPhotoEvidence?: boolean;
  requiresManagerReview?: boolean;
  answerPrompts?: Partial<Record<Answer, string[]>>;
};

export type Audit = {
  id: string;
  name: string;
  category: string;
  siteArea: string;
  dueLabel: string;
  dueHours: number;
  priority: Priority;
  owner: string;
  templateVersion: string;
  status: AuditStatus;
  lastCompletedAt: string;
  questions: AuditQuestion[];
  totalRiskScore?: number;
  highestRiskLevel?: RiskLevel;
  numberOfCriticalFindings?: number;
  numberOfHighFindings?: number;
  scheduleHealthState?: ScheduleHealthState;
};

export type HistoryEntry = {
  id: string;
  auditId: string;
  auditName: string;
  completedAt: string;
  completedBy: string;
  status: AuditStatus;
};

export type SuggestionStatus = "suggested" | "accepted" | "edited" | "ignored";

export type ActionItem = {
  id: string;
  companyId: string;
  siteArea?: string;
  auditId: string;
  auditName: string;
  questionId: string;
  questionText: string;
  sourceAnswer: string;
  nonConformanceId?: string;
  severity: RiskLevel;
  owner: string;
  assignedToUserId: string;
  assignedToName: string;
  createdByUserId: string;
  createdAt: string;
  dueDate: string;
  closedAt: string;
  verifiedByUserId: string;
  verificationNotes: string;
  evidenceLinks: string[];
  localEvidenceRefs: string[];
  comments: string;
  recurrenceFlag: boolean;
  rootCause: string;
  correctiveAction: string;
  preventiveAction: string;
  dueLabel: string;
  dueHours: number;
  status: ActionStatus;
  evidenceCount: number;
  noteIncluded: boolean;
  riskCategory: RiskCategory;
  escalated?: boolean;
  isStuck?: boolean;
  evidenceRequired?: boolean;
  requiresManagerReview?: boolean;
  suggestedActionTitle?: string;
  suggestedActionDescription?: string;
  suggestedOwnerRole?: string;
  suggestedDueDate?: string;
  suggestedEvidence?: string[];
  suggestionReason?: string;
  suggestionRuleId?: string;
  suggestionStatus?: SuggestionStatus;
  similarIssueCount30d?: number;
};

export type ManagedScheduleAudit = {
  id: string;
  auditId: string;
  auditName: string;
  days: ScheduleDay[];
  frequency: ScheduleFrequency;
  liveTime: string;
  completionHours: number;
};

export type ManagedSchedule = {
  id: string;
  rootId: string;
  parentScheduleId?: string;
  versionNumber: number;
  versionLabel: string;
  lifecycle: ScheduleLifecycle;
  companyFolderId: string;
  scheduleName: string;
  audits: ManagedScheduleAudit[];
  auditors: string[];
  startDate: string;
  endDate: string;
  updatedAt: string;
  archivedAt?: string;
  reactivatedAt?: string;
  escalationUserIds?: string[];
  triggerReauditOnFailure?: boolean;
  reauditDelayHours?: number;
  missedAuditCount?: number;
  lastCompletedAt?: string;
  nextDueAt?: string;
  healthState?: ScheduleHealthState;
};

export type AuditTemplateGoogleFormMeta = {
  formId: string;
  driveFileId?: string;
  editUrl?: string;
  responderUrl?: string;
  folderId?: string;
  folderName?: string;
  folderPath?: string;
  syncStatus?: string;
  notes?: string;
};

export type AuditTemplate = {
  id: string;
  name: string;
  active: boolean;
  questions: AuditQuestion[];
  source: "Google Drive" | "Built in app";
  category?: string;
  language?: string;
  defaultLanguage?: string;
  translationStatus?: string;
  googleForm?: AuditTemplateGoogleFormMeta;
};
