import type { AuditStatus, RiskCategory, RiskLevel } from "./reportsScreenProps";

export type ComplianceScheduleRow = {
  scheduleId: string;
  areaId: string;
  auditId: string;
  auditName: string;
  areaName?: string;
  frequency: string;
  nextDueDate: string;
  assignedRole: string;
  assignedUser: string;
  companyFolderId: string;
  status?: string;
};

export type AuditFindingRecord = {
  id: string;
  resultId: string;
  auditId: string;
  companyId: string;
  areaId?: string;
  questionId: string;
  questionText: string;
  answer: string;
  riskLevel: RiskLevel;
  riskCategory: RiskCategory;
  autoActionRequired: boolean;
  requiresPhotoEvidence: boolean;
  requiresManagerReview: boolean;
  note: string;
  localEvidenceRefs: string[];
  createdAt: string;
  createdBy: string;
};

export type AuditSubmissionSyncPayload = {
  auditId: string;
  auditName: string;
  areaId: string;
  companyFolderId: string;
  resultId: string;
  completedAt: string;
  completedBy: string;
  completedByUserId: string;
  outcomeStatus: AuditStatus;
  signatureDataUrl?: string;
  answersJson: string;
  totalRiskScore: number;
  highestRiskLevel: RiskLevel;
  criticalFindingsCount: number;
  highFindingsCount: number;
  findings: AuditFindingRecord[];
  evidenceRecords: Record<string, unknown>[];
};
