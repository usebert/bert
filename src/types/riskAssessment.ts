/** Risk Assessments Phase 2 — client types aligned with shared/risk-assessments.mjs. */

export type RiskAssessmentStatus =
  | "Draft"
  | "Submitted"
  | "Rejected"
  | "Approved"
  | "Active"
  | "Review Due"
  | "Overdue"
  | "Superseded"
  | "Archived";

export type RiskAssessmentType =
  | "General"
  | "Activity"
  | "Task"
  | "Site"
  | "Equipment"
  | "Manual Handling"
  | "Working at Height"
  | "Fire"
  | "Environmental"
  | "Other";

export type RiskBand = {
  band: string;
  label: string;
  level: "success" | "info" | "warning" | "danger" | "neutral";
};

export type RiskAssessmentRecord = {
  id: string;
  companyFolderId: string;
  assessmentNumber: string;
  title: string;
  description: string;
  assessmentType: RiskAssessmentType | string;
  activity: string;
  department: string;
  siteId: string;
  areaId: string;
  ownerUserId: string;
  ownerName: string;
  assessorUserId: string;
  assessorName: string;
  assessmentDate: string;
  reviewDate: string;
  nextReviewReason: string;
  status: RiskAssessmentStatus;
  version: string;
  previousVersionId: string;
  initialOverallRiskScore: number;
  residualOverallRiskScore: number;
  highestInitialRiskScore: number;
  highestResidualRiskScore: number;
  peopleAtRisk: string;
  existingGeneralControls: string;
  emergencyArrangements: string;
  ppeSummary: string;
  approvalRequired: boolean;
  submittedAt: string;
  submittedBy: string;
  approvedAt: string;
  approvedBy: string;
  rejectedAt: string;
  rejectedBy: string;
  rejectionReason: string;
  activatedAt: string;
  supersededAt: string;
  archivedAt: string;
  archivedBy: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  hazardCount?: number;
  highestResidualBand?: RiskBand;
  highestInitialBand?: RiskBand;
  highResidualCount?: number;
  veryHighResidualCount?: number;
};

export type RiskHazardRecord = {
  id: string;
  riskAssessmentId: string;
  companyFolderId: string;
  hazardType: string;
  hazardTitle: string;
  hazardDescription: string;
  whoMightBeHarmed: string;
  howMightTheyBeHarmed: string;
  existingControls: string;
  initialLikelihood: number;
  initialSeverity: number;
  initialRiskScore: number;
  additionalControls: string;
  residualLikelihood: number;
  residualSeverity: number;
  residualRiskScore: number;
  controlOwnerUserId: string;
  controlOwnerName: string;
  controlDueDate: string;
  actionRequired: boolean;
  linkedActionId: string;
  sortOrder: number;
  status: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt: string;
  archivedBy: string;
  initialBand?: RiskBand;
  residualBand?: RiskBand;
};

export type RiskLinkRecord = {
  id: string;
  riskAssessmentId: string;
  companyFolderId: string;
  linkedRecordType: string;
  linkedRecordId: string;
  linkedRecordTitle: string;
  relationshipType: string;
  notes: string;
  createdAt: string;
  createdBy: string;
  archivedAt: string;
  archivedBy: string;
};

export type RiskReviewRecord = {
  id: string;
  riskAssessmentId: string;
  companyFolderId: string;
  reviewDate: string;
  reviewerUserId: string;
  reviewerName: string;
  reviewType: string;
  outcome: string;
  changesRequired: string;
  summary: string;
  previousVersion: string;
  newVersion: string;
  linkedIncidentId: string;
  linkedAuditId: string;
  createdAt: string;
  createdBy: string;
};

export type RiskAssessmentInput = {
  title?: string;
  description?: string;
  assessmentType?: string;
  activity?: string;
  department?: string;
  siteId?: string;
  areaId?: string;
  ownerUserId?: string;
  ownerName?: string;
  assessorUserId?: string;
  assessorName?: string;
  assessmentDate?: string;
  reviewDate?: string;
  peopleAtRisk?: string;
  existingGeneralControls?: string;
  emergencyArrangements?: string;
  ppeSummary?: string;
};

export type RiskHazardInput = {
  hazardType?: string;
  hazardTitle?: string;
  hazardDescription?: string;
  whoMightBeHarmed?: string;
  howMightTheyBeHarmed?: string;
  existingControls?: string;
  initialLikelihood?: number;
  initialSeverity?: number;
  additionalControls?: string;
  residualLikelihood?: number;
  residualSeverity?: number;
  controlOwnerUserId?: string;
  controlOwnerName?: string;
  controlDueDate?: string;
  actionRequired?: boolean;
  sortOrder?: number;
};

export type RiskLinkInput = {
  linkedRecordType: string;
  linkedRecordId: string;
  linkedRecordTitle?: string;
  relationshipType?: string;
  notes?: string;
};

export type RiskReviewInput = {
  reviewType?: string;
  outcome?: string;
  summary?: string;
  changesRequired?: string;
  reviewDate?: string;
  nextReviewDate?: string;
  linkedIncidentId?: string;
  linkedAuditId?: string;
};

export type RiskAssessmentDetail = {
  item: RiskAssessmentRecord;
  hazards: RiskHazardRecord[];
  links: RiskLinkRecord[];
  reviews: RiskReviewRecord[];
};

export type RiskAssessmentListTab =
  | "active"
  | "drafts"
  | "awaiting_approval"
  | "review_due"
  | "overdue"
  | "archived";
