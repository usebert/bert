/** Health & Safety Phase 1 — client types aligned with shared/health-safety.mjs. */

export type CoshhStatus =
  | "current"
  | "review_due"
  | "overdue"
  | "missing_sds"
  | "assessment_required"
  | "archived";

export type CoshhAssessmentStatus = "draft" | "active" | "review_due" | "superseded" | "archived";

export type RiddorDecisionStatus =
  | "decision_required"
  | "information_required"
  | "likely_reportable"
  | "not_reportable"
  | "confirmed_reportable";

export type RiddorSubmissionStatus =
  | "not_started"
  | "in_preparation"
  | "submitted"
  | "follow_up_required"
  | "closed";

export type CoshhRecord = {
  id: string;
  companyFolderId: string;
  productName: string;
  manufacturer: string;
  supplier: string;
  productCode: string;
  description: string;
  physicalForm: string;
  signalWord: string;
  hazardPictograms: string;
  hazardStatements: string;
  precautionaryStatements: string;
  primaryUse: string;
  siteId: string;
  areaId: string;
  storageLocation: string;
  sdsDocumentId: string;
  sdsFileName: string;
  sdsIssueDate: string;
  sdsVersion: string;
  assessmentRequired: boolean;
  approvedForUse: boolean;
  status: CoshhStatus;
  reviewDate: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt: string;
  archivedBy: string;
};

export type CoshhRecordInput = {
  productName: string;
  manufacturer?: string;
  supplier?: string;
  productCode?: string;
  description?: string;
  physicalForm?: string;
  signalWord?: string;
  hazardPictograms?: string;
  hazardStatements?: string;
  precautionaryStatements?: string;
  primaryUse?: string;
  siteId?: string;
  areaId?: string;
  storageLocation?: string;
  sdsDocumentId?: string;
  sdsFileName?: string;
  sdsIssueDate?: string;
  sdsVersion?: string;
  assessmentRequired?: boolean;
  approvedForUse?: boolean;
  reviewDate?: string;
};

export type CoshhAssessment = {
  id: string;
  coshhId: string;
  companyFolderId: string;
  assessmentTitle: string;
  activity: string;
  personsAtRisk: string;
  frequencyOfUse: string;
  quantityUsed: string;
  durationOfExposure: string;
  exposureRoutes: string;
  hazards: string;
  existingControls: string;
  engineeringControls: string;
  ppeRequired: string;
  storageControls: string;
  spillProcedure: string;
  firstAid: string;
  fireResponse: string;
  disposalMethod: string;
  emergencyActions: string;
  initialLikelihood: number;
  initialSeverity: number;
  initialRiskScore: number;
  residualLikelihood: number;
  residualSeverity: number;
  residualRiskScore: number;
  additionalActions: string;
  assessorName: string;
  assessmentDate: string;
  reviewDate: string;
  status: CoshhAssessmentStatus;
  approvedBy: string;
  approvedAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt: string;
  archivedBy: string;
};

export type CoshhAssessmentInput = {
  assessmentTitle?: string;
  activity?: string;
  personsAtRisk?: string;
  frequencyOfUse?: string;
  quantityUsed?: string;
  durationOfExposure?: string;
  exposureRoutes?: string;
  hazards?: string;
  existingControls?: string;
  engineeringControls?: string;
  ppeRequired?: string;
  storageControls?: string;
  spillProcedure?: string;
  firstAid?: string;
  fireResponse?: string;
  disposalMethod?: string;
  emergencyActions?: string;
  initialLikelihood?: number;
  initialSeverity?: number;
  residualLikelihood?: number;
  residualSeverity?: number;
  additionalActions?: string;
  assessorName?: string;
  assessmentDate?: string;
  reviewDate?: string;
  status?: CoshhAssessmentStatus;
};

export type RiddorRecord = {
  id: string;
  incidentId: string;
  companyFolderId: string;
  decisionStatus: RiddorDecisionStatus;
  decisionDate: string;
  decisionBy: string;
  reportableOutcome: string;
  reportableCategory: string;
  fatality: boolean;
  specifiedInjury: boolean;
  overSevenDayInjury: boolean;
  dangerousOccurrence: boolean;
  occupationalDisease: boolean;
  gasIncident: boolean;
  memberOfPublicHospitalTreatment: boolean;
  supportingReason: string;
  furtherInformationRequired: boolean;
  submissionStatus: RiddorSubmissionStatus;
  submissionReference: string;
  submittedAt: string;
  submittedBy: string;
  authorityNotificationMethod: string;
  followUpRequired: boolean;
  followUpDate: string;
  linkedActionIds: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt: string;
  archivedBy: string;
};

export type RiddorRecordInput = {
  incidentId?: string;
  decisionStatus?: RiddorDecisionStatus;
  decisionDate?: string;
  decisionBy?: string;
  reportableOutcome?: string;
  reportableCategory?: string;
  supportingReason?: string;
  furtherInformationRequired?: boolean;
  submissionStatus?: RiddorSubmissionStatus;
  submissionReference?: string;
  submittedAt?: string;
  submittedBy?: string;
  authorityNotificationMethod?: string;
  followUpRequired?: boolean;
  followUpDate?: string;
  linkedActionIds?: string;
  confirmedDecisionStatus?: RiddorDecisionStatus;
};

export type RiddorAssessmentInput = {
  fatality?: boolean;
  specifiedInjury?: boolean;
  overSevenDayInjury?: boolean;
  dangerousOccurrence?: boolean;
  occupationalDisease?: boolean;
  gasIncident?: boolean;
  memberOfPublicHospitalTreatment?: boolean;
  furtherInformationRequired?: boolean;
  supportingReason?: string;
  confirmedDecisionStatus?: RiddorDecisionStatus;
  submissionStatus?: RiddorSubmissionStatus;
  submissionReference?: string;
  followUpRequired?: boolean;
  followUpDate?: string;
};

export type RiddorEvaluation = {
  decisionStatus: RiddorDecisionStatus;
  likelyReportable: boolean;
};

export type HealthSafetyStatusLevel = "good" | "attention" | "urgent";

export type HealthSafetyStatusSummary = {
  level: HealthSafetyStatusLevel;
  urgentCount: number;
  attentionCount: number;
  explanation: string;
  updatedAt: string;
};

export type HealthSafetyOverviewMetrics = {
  openIncidents: number;
  highRiskIncidents: number;
  incidentsAwaitingInvestigation: number;
  riddorDecisionsRequired: number;
  openRiddorReports: number;
  riddorFollowUpsDue: number;
  riddorReportableActionsDue: number;
  coshhReviewsOverdue: number;
  coshhReviewsDueSoon: number;
  chemicalsMissingSds: number;
  coshhAssessmentsDue: number;
  equipmentInspectionsOverdue: number;
  equipmentInspectionsDueSoon: number;
  equipmentOutOfService: number;
  overdueHealthSafetyActions: number;
  highPriorityOverdueActions: number;
};

export type HealthSafetyAttentionItemType =
  | "high_risk_incident_investigation"
  | "riddor_reportable_action"
  | "riddor_decision"
  | "equipment_overdue"
  | "coshh_review_overdue"
  | "missing_sds"
  | "hs_action_overdue"
  | "equipment_due_soon"
  | "coshh_review_due_soon";

export type HealthSafetyAttentionItemSeverity = "urgent" | "attention";

export type HealthSafetyAttentionItemDetail = {
  id: string;
  type: HealthSafetyAttentionItemType;
  title: string;
  reason: string;
  priority: number;
  severity: HealthSafetyAttentionItemSeverity;
  siteId: string;
  siteName: string;
  areaId: string;
  areaName: string;
  dueDate: string;
  route: string;
  recordId: string;
  actionLabel: string;
};

export type HealthSafetyRecentActivityItem = {
  id: string;
  type: string;
  summary: string;
  actorName: string;
  occurredAt: string;
  siteName: string;
  areaName: string;
  route: string;
  recordId: string;
};

export type HealthSafetyOverviewSummary = {
  openIncidents: number;
  highRiskIncidents: number;
  riddorDecisionsRequired: number;
  openRiddorReports: number;
  coshhAssessmentsOverdue: number;
  chemicalsMissingSds: number;
  equipmentInspectionsOverdue: number;
  openHealthSafetyActions: number;
};

export type HealthSafetyAttentionKind =
  | "incident_investigation"
  | "riddor_decision"
  | "coshh_review"
  | "missing_sds"
  | "equipment_overdue"
  | "hs_action_overdue";

export type HealthSafetyAttentionItem = {
  id: string;
  kind: HealthSafetyAttentionKind;
  title: string;
  status: string;
  site: string;
  dueDate: string;
  navigate: {
    screen: string;
    incidentId?: string;
    riddorId?: string;
    coshhId?: string;
    equipmentId?: string;
  };
  rank: number;
};

export type HealthSafetyOverview = {
  updatedAt?: string;
  statusSummary?: HealthSafetyStatusSummary;
  metrics?: HealthSafetyOverviewMetrics;
  attentionItems?: HealthSafetyAttentionItemDetail[];
  recentActivity?: HealthSafetyRecentActivityItem[];
  summary: HealthSafetyOverviewSummary;
  attention: HealthSafetyAttentionItem[];
};

export type CoshhListSummary = {
  total: number;
  current: number;
  reviewDue: number;
  overdue: number;
  missingSds: number;
  assessmentRequired: number;
  archived: number;
};
