import type { User } from "./dashboardScreenProps";

export type IncidentStatus = "Open" | "Under Investigation" | "Closed";
export type IncidentPriority = "Normal" | "High";
export type IncidentType = "Accident" | "Near Miss" | "Dangerous Occurrence" | "Property Damage" | "Environmental";
export type IncidentSeverity =
  | "Minor"
  | "Medical Treatment"
  | "Lost Time Injury"
  | "Major Incident"
  | "Fatality";

export type IncidentEvidenceItem = {
  id: string;
  name: string;
  mimeType: string;
  previewUrl: string;
  addedAt: string;
  driveFileId?: string;
  driveLink?: string;
};

export type IncidentEvidenceFileAttachment = {
  id: string;
  name: string;
  mimeType: string;
  addedAt: string;
  file: File;
};

/** JSON-serialisable evidence payload sent to the incident submit API. */
export type IncidentEvidenceUploadFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  addedAt: string;
};

export type IncidentAssignmentHistoryEntry = {
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName: string;
  byEmail: string;
  byName: string;
  at: string;
  reason?: string;
};

export type IncidentRecord = {
  id: string;
  incidentId: string;
  status: IncidentStatus;
  priority: IncidentPriority;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  incidentDate: string;
  incidentTime: string;
  reporterName: string;
  reporterEmail: string;
  department: string;
  location: string;
  description: string;
  immediateAction: string;
  injured: boolean;
  injuryDetails: string;
  contributingFactors: string;
  witnesses: string;
  evidenceUrls: IncidentEvidenceItem[];
  investigationNotes: string;
  rootCause: string;
  correctiveActions: string;
  preventiveActions: string;
  assignedTo: string;
  assignedToEmail?: string;
  assignedToName?: string;
  assignedByEmail?: string;
  assignedByName?: string;
  assignedAt?: string;
  receivedByEmail?: string;
  receivedByName?: string;
  reassignedFromEmail?: string;
  reassignedFromName?: string;
  reassignedToEmail?: string;
  reassignedToName?: string;
  reassignedByEmail?: string;
  reassignedByName?: string;
  reassignedAt?: string;
  reassignmentReason?: string;
  assignmentHistory?: IncidentAssignmentHistoryEntry[];
  actionOwner: string;
  dueDate: string;
  completionDate: string;
  riddorRequired: boolean;
  closedBy: string;
  closedAt: string;
  notificationStatus: string;
  statusHistory: { at: string; from: IncidentStatus | ""; to: IncidentStatus; by: string; note: string }[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type IncidentCorrectiveAction = {
  id: string;
  incidentId: string;
  description: string;
  owner: string;
  dueDate: string;
  status: "Open" | "In Progress" | "Complete";
  completedAt: string;
  completedBy: string;
};

export type IncidentSubmitPayload = {
  incidentType: IncidentType;
  severity: IncidentSeverity;
  incidentDate: string;
  incidentTime: string;
  reporterName: string;
  reporterEmail: string;
  department: string;
  location: string;
  description: string;
  immediateAction: string;
  injured: boolean;
  injuryDetails: string;
  contributingFactors: string;
  witnesses: string;
  evidenceUrls: IncidentEvidenceItem[];
  evidenceFiles?: IncidentEvidenceFileAttachment[];
  evidenceUploadFiles?: IncidentEvidenceUploadFile[];
};

export type IncidentReassignTarget = {
  email: string;
  name: string;
  role: string;
};

export type IncidentReportingScreenProps = {
  currentUser: User;
  incidents: IncidentRecord[];
  incidentActions: IncidentCorrectiveAction[];
  reassignTargets: IncidentReassignTarget[];
  onSubmitIncident: (
    payload: IncidentSubmitPayload,
    options?: { onPhase?: (phase: string) => void },
  ) => Promise<IncidentRecord>;
  onUpdateIncident: (incidentId: string, patch: Partial<IncidentRecord>, options?: { statusNote?: string }) => void;
  onReassignIncident: (
    incidentId: string,
    input: { toEmail: string; toName: string; toRole: string; reason?: string },
  ) => Promise<IncidentRecord>;
  onAddIncidentAction: (incidentId: string, payload: { description: string; owner: string; dueDate: string }) => void;
  onUpdateIncidentAction: (actionId: string, patch: Partial<IncidentCorrectiveAction>) => void;
};
