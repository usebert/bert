/** Lightweight QMS readiness registers (workspace-local; optional sheet sync later). */

export type QmsDocumentStatus = "Draft" | "Active" | "Under review" | "Archived";

export type QMSDocument = {
  id: string;
  title: string;
  type: string;
  version: string;
  owner: string;
  status: QmsDocumentStatus;
  reviewDate: string;
  fileLink: string;
  createdAt: string;
  updatedAt: string;
};

export type QmsTrainingStatus = "Planned" | "In progress" | "Complete" | "Expired";

export type QMSTrainingRecord = {
  id: string;
  person: string;
  trainingName: string;
  status: QmsTrainingStatus;
  expiry: string;
  evidence: string;
  createdAt: string;
  updatedAt: string;
};

export type QmsRiskStatus = "Open" | "Mitigating" | "Accepted" | "Closed";

export type QMSRisk = {
  id: string;
  title: string;
  category: string;
  likelihood: "Low" | "Medium" | "High";
  impact: "Low" | "Medium" | "High";
  status: QmsRiskStatus;
  owner: string;
  reviewDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type QmsReadinessSummary = {
  documentsNeedingReview: number;
  trainingExpiringSoon: number;
  openNonConformances: number;
  overdueCorrectiveActions: number;
  risksNeedingReview: number;
  openHazards: number;
  openIncidentsAndNearMisses: number;
  overdueHsActions: number;
  riskAssessmentsDueReview: number;
  safetyObjectivesAtRisk: number;
  managementReviewStatus: "ready" | "attention" | "not_started";
  managementReviewDetail: string;
};
