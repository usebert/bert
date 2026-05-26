/** Health & safety readiness registers (workspace-local; optional sheet sync later). */

export type HazardSeverity = "Low" | "Medium" | "High" | "Critical";
export type HazardStatus = "Open" | "Under review" | "Closed";

export type HazardReport = {
  hazardId: string;
  areaId: string;
  description: string;
  severity: HazardSeverity;
  immediateAction: string;
  owner: string;
  status: HazardStatus;
  evidenceIds: string[];
  actionId?: string;
  createdAt: string;
  closedAt: string;
};

export type SafetyRiskLikelihood = 1 | 2 | 3 | 4 | 5;
export type SafetyRiskSeverity = 1 | 2 | 3 | 4 | 5;
export type SafetyRiskAssessmentStatus = "Draft" | "Active" | "Due review" | "Closed";

export type SafetyRiskAssessment = {
  riskAssessmentId: string;
  areaId: string;
  activity: string;
  hazards: string;
  existingControls: string;
  likelihood: SafetyRiskLikelihood;
  severity: SafetyRiskSeverity;
  riskScore: number;
  furtherControls: string;
  owner: string;
  reviewDate: string;
  status: SafetyRiskAssessmentStatus;
  createdAt: string;
  updatedAt: string;
};

export type SafetyObservationStatus = "Open" | "Actioned" | "Closed";

export type SafetyObservation = {
  observationId: string;
  areaId: string;
  reportedBy: string;
  observation: string;
  suggestion: string;
  status: SafetyObservationStatus;
  actionId: string;
  createdAt: string;
};

export type SafetyObjectiveStatus = "On track" | "At risk" | "Behind" | "Complete";

export type SafetyObjective = {
  objectiveId: string;
  objective: string;
  target: string;
  owner: string;
  currentValue: string;
  dueDate: string;
  status: SafetyObjectiveStatus;
  createdAt: string;
  updatedAt: string;
};
