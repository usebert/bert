import type { User } from "./dashboardScreenProps";
import type { Answer } from "./reportsScreenProps";

export type NonConformanceEvidence = {
  id: string;
  name: string;
  previewUrl: string;
  addedAt: string;
  note?: string;
};

export type NonConformanceRecord = {
  id: string;
  reference: string;
  auditId: string;
  auditName: string;
  auditQuestionId: string;
  auditQuestion: string;
  selectedAnswer: Answer;
  auditorName: string;
  auditorUserId: string;
  site: string;
  raisedAt: string;
  status: "Raised" | "In Progress" | "Completed";
  assignedLineManager: string;
  assignedLineManagerUserId: string;
  assignedLineManagerEmail: string;
  investigationIsoClause: string;
  investigationNotes: string;
  rootCause: string;
  correctiveAction: string;
  investigationExtraNotes: string;
  evidence: NonConformanceEvidence[];
  completionDateTime?: string;
  completedByName?: string;
  completedByUserId?: string;
};

export type NonConformanceInvestigationPayload = Pick<
  NonConformanceRecord,
  "investigationIsoClause" | "investigationNotes" | "rootCause" | "correctiveAction" | "investigationExtraNotes"
>;

export type NonConformanceScreenProps = {
  currentUser: User;
  nonConformances: NonConformanceRecord[];
  canViewCompletedReports: boolean;
  onSaveProgress: (ncrId: string, payload: NonConformanceInvestigationPayload) => void;
  onComplete: (ncrId: string, payload: NonConformanceInvestigationPayload) => boolean;
  onAddEvidence: (ncrId: string, files: FileList) => void;
  onExportReport: (record: NonConformanceRecord) => void;
};
