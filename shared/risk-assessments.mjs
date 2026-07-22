/**
 * Risk Assessments Phase 2 — workbook tabs, columns, statuses, risk matrix, and mappers.
 */
import { getUkTodayKey } from "./uk-date-time.mjs";

export const RISK_ASSESSMENTS_TAB = "RiskAssessments";
export const RISK_ASSESSMENT_HAZARDS_TAB = "RiskAssessmentHazards";
export const RISK_ASSESSMENT_LINKS_TAB = "RiskAssessmentLinks";
export const RISK_ASSESSMENT_REVIEWS_TAB = "RiskAssessmentReviews";

export const RISK_ASSESSMENT_REQUIRED_TABS = [
  RISK_ASSESSMENTS_TAB,
  RISK_ASSESSMENT_HAZARDS_TAB,
  RISK_ASSESSMENT_LINKS_TAB,
  RISK_ASSESSMENT_REVIEWS_TAB,
];

export const RISK_ASSESSMENTS_TAB_COLUMNS = [
  "RiskAssessmentId",
  "CompanyFolderId",
  "AssessmentNumber",
  "Title",
  "Description",
  "AssessmentType",
  "Activity",
  "Department",
  "SiteId",
  "AreaId",
  "OwnerUserId",
  "OwnerName",
  "AssessorUserId",
  "AssessorName",
  "AssessmentDate",
  "ReviewDate",
  "NextReviewReason",
  "Status",
  "Version",
  "PreviousVersionId",
  "InitialOverallRiskScore",
  "ResidualOverallRiskScore",
  "HighestInitialRiskScore",
  "HighestResidualRiskScore",
  "PeopleAtRisk",
  "ExistingGeneralControls",
  "EmergencyArrangements",
  "PpeSummary",
  "ApprovalRequired",
  "SubmittedAt",
  "SubmittedBy",
  "ApprovedAt",
  "ApprovedBy",
  "RejectedAt",
  "RejectedBy",
  "RejectionReason",
  "ActivatedAt",
  "SupersededAt",
  "ArchivedAt",
  "ArchivedBy",
  "CreatedAt",
  "CreatedBy",
  "UpdatedAt",
  "UpdatedBy",
];

export const RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS = [
  "HazardId",
  "RiskAssessmentId",
  "CompanyFolderId",
  "HazardType",
  "HazardTitle",
  "HazardDescription",
  "WhoMightBeHarmed",
  "HowMightTheyBeHarmed",
  "ExistingControls",
  "InitialLikelihood",
  "InitialSeverity",
  "InitialRiskScore",
  "AdditionalControls",
  "ResidualLikelihood",
  "ResidualSeverity",
  "ResidualRiskScore",
  "ControlOwnerUserId",
  "ControlOwnerName",
  "ControlDueDate",
  "ActionRequired",
  "LinkedActionId",
  "SortOrder",
  "Status",
  "CreatedAt",
  "CreatedBy",
  "UpdatedAt",
  "UpdatedBy",
  "ArchivedAt",
  "ArchivedBy",
];

export const RISK_ASSESSMENT_LINKS_TAB_COLUMNS = [
  "LinkId",
  "RiskAssessmentId",
  "CompanyFolderId",
  "LinkedRecordType",
  "LinkedRecordId",
  "LinkedRecordTitle",
  "RelationshipType",
  "Notes",
  "CreatedAt",
  "CreatedBy",
  "ArchivedAt",
  "ArchivedBy",
];

export const RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS = [
  "ReviewId",
  "RiskAssessmentId",
  "CompanyFolderId",
  "ReviewDate",
  "ReviewerUserId",
  "ReviewerName",
  "ReviewType",
  "Outcome",
  "ChangesRequired",
  "Summary",
  "PreviousVersion",
  "NewVersion",
  "LinkedIncidentId",
  "LinkedAuditId",
  "CreatedAt",
  "CreatedBy",
];

export const RISK_ASSESSMENT_STATUSES = [
  "Draft",
  "Submitted",
  "Rejected",
  "Approved",
  "Active",
  "Review Due",
  "Overdue",
  "Superseded",
  "Archived",
];

export const RISK_ASSESSMENT_TYPES = [
  "General",
  "Activity",
  "Task",
  "Site",
  "Equipment",
  "Manual Handling",
  "Working at Height",
  "Fire",
  "Environmental",
  "Other",
];

export const RISK_LINKED_RECORD_TYPES = [
  "coshh",
  "equipment",
  "incident",
  "document",
  "action",
  "audit",
  "site",
  "area",
];

export const RISK_LINK_RELATIONSHIP_TYPES = [
  "applies_to",
  "involves",
  "created_from",
  "supporting_evidence",
  "related_action",
  "reviewed_after",
  "other",
];

export const RISK_REVIEW_TYPES = ["scheduled", "incident_triggered", "audit_triggered", "change_triggered", "manual"];

export const RISK_REVIEW_OUTCOMES = ["no_change", "minor_update", "major_update", "superseded", "withdrawn"];

export const HAZARD_LIBRARY = [
  "Slips, trips and falls",
  "Working at height",
  "Manual handling",
  "Vehicles and workplace transport",
  "Machinery",
  "Electricity",
  "Fire",
  "Noise",
  "Vibration",
  "Dust and fumes",
  "Hazardous substances",
  "Biological hazards",
  "Confined spaces",
  "Pressure systems",
  "Falling objects",
  "Sharp objects",
  "Temperature",
  "Ergonomics",
  "Stress and fatigue",
  "Violence and aggression",
  "Lone working",
  "Other",
];

export const PEOPLE_AT_RISK_OPTIONS = [
  "Employees",
  "Contractors",
  "Visitors",
  "Members of the public",
  "Young persons",
  "Expectant mothers",
  "New or inexperienced workers",
  "Disabled persons",
  "Lone workers",
  "Other",
];

export const LIKELIHOOD_LABELS = {
  1: "Rare",
  2: "Unlikely",
  3: "Possible",
  4: "Likely",
  5: "Almost Certain",
};

export const SEVERITY_LABELS = {
  1: "Insignificant",
  2: "Minor",
  3: "Moderate",
  4: "Major",
  5: "Catastrophic",
};

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function pickField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) return direct;
    const lower = trim(key).toLowerCase();
    for (const [entryKey, value] of Object.entries(record)) {
      if (trim(entryKey).toLowerCase() === lower && trim(value)) {
        return trim(value);
      }
    }
  }
  return "";
}

function parseBool(value) {
  const raw = trim(value).toLowerCase();
  return raw === "true" || raw === "yes" || raw === "1";
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildRiskAssessmentId() {
  return `ra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildRiskHazardId() {
  return `rah-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Collapse duplicate HazardId rows — keeps the latest UpdatedAt. */
export function dedupeHazardsById(hazards = []) {
  const byId = new Map();
  for (const hazard of hazards) {
    const id = trim(hazard?.id || hazard?.HazardId);
    if (!id) continue;
    const current = byId.get(id);
    if (!current) {
      byId.set(id, hazard);
      continue;
    }
    const currentUpdated = trim(current.updatedAt || current.UpdatedAt);
    const nextUpdated = trim(hazard.updatedAt || hazard.UpdatedAt);
    if (!currentUpdated || nextUpdated >= currentUpdated) {
      byId.set(id, hazard);
    }
  }
  return Array.from(byId.values());
}

export function buildRiskLinkId() {
  return `ral-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildRiskReviewId() {
  return `rar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function validateRiskValue(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5;
}

export function calculateRiskScore(likelihood, severity) {
  const l = Number(likelihood);
  const s = Number(severity);
  if (!validateRiskValue(l) || !validateRiskValue(s)) return 0;
  return l * s;
}

export function getRiskBand(score) {
  const value = Number(score);
  if (!Number.isFinite(value) || value <= 0) {
    return { band: "unknown", label: "Not assessed", level: "neutral" };
  }
  if (value <= 4) return { band: "low", label: "Low", level: "success" };
  if (value <= 9) return { band: "moderate", label: "Moderate", level: "info" };
  if (value <= 16) return { band: "high", label: "High", level: "warning" };
  return { band: "very_high", label: "Very High", level: "danger" };
}

export function isHighOrVeryHighRisk(score) {
  const value = Number(score);
  return value >= 10;
}

export function summariseAssessmentRisk(hazards = []) {
  const active = hazards.filter((h) => !h.archivedAt && trim(h.status).toLowerCase() !== "archived");
  const initialScores = active.map((h) => Number(h.initialRiskScore) || calculateRiskScore(h.initialLikelihood, h.initialSeverity));
  const residualScores = active.map(
    (h) => Number(h.residualRiskScore) || calculateRiskScore(h.residualLikelihood, h.residualSeverity),
  );
  const highestInitial = initialScores.length ? Math.max(...initialScores) : 0;
  const highestResidual = residualScores.length ? Math.max(...residualScores) : 0;
  const highResidualCount = residualScores.filter((score) => isHighOrVeryHighRisk(score)).length;
  const veryHighResidualCount = residualScores.filter((score) => score >= 17).length;
  const outstandingActions = active.filter((h) => parseBool(h.actionRequired) && !trim(h.linkedActionId)).length;
  return {
    highestInitialRiskScore: highestInitial,
    highestResidualRiskScore: highestResidual,
    initialOverallRiskScore: highestInitial,
    residualOverallRiskScore: highestResidual,
    highResidualCount,
    veryHighResidualCount,
    outstandingActions,
    hazardCount: active.length,
    highestInitialBand: getRiskBand(highestInitial),
    highestResidualBand: getRiskBand(highestResidual),
  };
}

export function deriveRiskAssessmentStatus(record, todayKey = getUkTodayKey()) {
  const archivedAt = trim(record.archivedAt || record.ArchivedAt);
  if (archivedAt) return "Archived";
  const stored = trim(record.status || record.Status);
  if (stored === "Superseded" || stored === "superseded") return "Superseded";
  if (stored === "Draft" || stored === "Submitted" || stored === "Rejected" || stored === "Approved") {
    return stored;
  }
  const reviewDate = trim(record.reviewDate || record.ReviewDate);
  if (stored === "Active" || stored === "Approved") {
    if (reviewDate && reviewDate < todayKey) return "Overdue";
    if (reviewDate) {
      const dueSoon = new Date();
      dueSoon.setDate(dueSoon.getDate() + 30);
      if (reviewDate <= dueSoon.toISOString().slice(0, 10)) return "Review Due";
    }
    return stored === "Approved" ? "Approved" : "Active";
  }
  return stored || "Draft";
}

export function bumpVersion(currentVersion, type = "major") {
  const match = trim(currentVersion).match(/^(\d+)\.(\d+)$/);
  if (!match) return type === "minor" ? "1.1" : "2.0";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (type === "minor") return `${major}.${minor + 1}`;
  return `${major + 1}.0`;
}

export function nextAssessmentNumber(existingNumbers = []) {
  const numeric = existingNumbers
    .map((entry) => {
      const match = trim(entry).match(/(\d+)/);
      return match ? Number(match[1]) : 0;
    })
    .filter((value) => value > 0);
  const next = numeric.length ? Math.max(...numeric) + 1 : 1;
  return `RA-${String(next).padStart(4, "0")}`;
}

export function mapRiskAssessmentRecord(record = {}) {
  const id = pickField(record, "RiskAssessmentId", "riskAssessmentId");
  const reviewDate = pickField(record, "ReviewDate", "reviewDate");
  const mapped = {
    id,
    companyFolderId: pickField(record, "CompanyFolderId", "companyFolderId"),
    assessmentNumber: pickField(record, "AssessmentNumber", "assessmentNumber"),
    title: pickField(record, "Title", "title"),
    description: pickField(record, "Description", "description"),
    assessmentType: pickField(record, "AssessmentType", "assessmentType") || "General",
    activity: pickField(record, "Activity", "activity"),
    department: pickField(record, "Department", "department"),
    siteId: pickField(record, "SiteId", "siteId"),
    areaId: pickField(record, "AreaId", "areaId"),
    ownerUserId: pickField(record, "OwnerUserId", "ownerUserId"),
    ownerName: pickField(record, "OwnerName", "ownerName"),
    assessorUserId: pickField(record, "AssessorUserId", "assessorUserId"),
    assessorName: pickField(record, "AssessorName", "assessorName"),
    assessmentDate: pickField(record, "AssessmentDate", "assessmentDate"),
    reviewDate,
    nextReviewReason: pickField(record, "NextReviewReason", "nextReviewReason"),
    status: pickField(record, "Status", "status") || "Draft",
    version: pickField(record, "Version", "version") || "1.0",
    previousVersionId: pickField(record, "PreviousVersionId", "previousVersionId"),
    initialOverallRiskScore: parseNumber(pickField(record, "InitialOverallRiskScore", "initialOverallRiskScore")),
    residualOverallRiskScore: parseNumber(pickField(record, "ResidualOverallRiskScore", "residualOverallRiskScore")),
    highestInitialRiskScore: parseNumber(pickField(record, "HighestInitialRiskScore", "highestInitialRiskScore")),
    highestResidualRiskScore: parseNumber(pickField(record, "HighestResidualRiskScore", "highestResidualRiskScore")),
    peopleAtRisk: pickField(record, "PeopleAtRisk", "peopleAtRisk"),
    existingGeneralControls: pickField(record, "ExistingGeneralControls", "existingGeneralControls"),
    emergencyArrangements: pickField(record, "EmergencyArrangements", "emergencyArrangements"),
    ppeSummary: pickField(record, "PpeSummary", "ppeSummary"),
    approvalRequired: parseBool(pickField(record, "ApprovalRequired", "approvalRequired")),
    submittedAt: pickField(record, "SubmittedAt", "submittedAt"),
    submittedBy: normalizeEmail(pickField(record, "SubmittedBy", "submittedBy")),
    approvedAt: pickField(record, "ApprovedAt", "approvedAt"),
    approvedBy: normalizeEmail(pickField(record, "ApprovedBy", "approvedBy")),
    rejectedAt: pickField(record, "RejectedAt", "rejectedAt"),
    rejectedBy: normalizeEmail(pickField(record, "RejectedBy", "rejectedBy")),
    rejectionReason: pickField(record, "RejectionReason", "rejectionReason"),
    activatedAt: pickField(record, "ActivatedAt", "activatedAt"),
    supersededAt: pickField(record, "SupersededAt", "supersededAt"),
    archivedAt: pickField(record, "ArchivedAt", "archivedAt"),
    archivedBy: normalizeEmail(pickField(record, "ArchivedBy", "archivedBy")),
    createdAt: pickField(record, "CreatedAt", "createdAt"),
    createdBy: normalizeEmail(pickField(record, "CreatedBy", "createdBy")),
    updatedAt: pickField(record, "UpdatedAt", "updatedAt"),
    updatedBy: normalizeEmail(pickField(record, "UpdatedBy", "updatedBy")),
  };
  mapped.status = deriveRiskAssessmentStatus(mapped);
  return mapped;
}

export function mapRiskHazardRecord(record = {}) {
  const initialLikelihood = parseNumber(pickField(record, "InitialLikelihood", "initialLikelihood"));
  const initialSeverity = parseNumber(pickField(record, "InitialSeverity", "initialSeverity"));
  const residualLikelihood = parseNumber(pickField(record, "ResidualLikelihood", "residualLikelihood"));
  const residualSeverity = parseNumber(pickField(record, "ResidualSeverity", "residualSeverity"));
  const initialRiskScore =
    parseNumber(pickField(record, "InitialRiskScore", "initialRiskScore")) || calculateRiskScore(initialLikelihood, initialSeverity);
  const residualRiskScore =
    parseNumber(pickField(record, "ResidualRiskScore", "residualRiskScore")) ||
    calculateRiskScore(residualLikelihood, residualSeverity);
  return {
    id: pickField(record, "HazardId", "hazardId"),
    riskAssessmentId: pickField(record, "RiskAssessmentId", "riskAssessmentId"),
    companyFolderId: pickField(record, "CompanyFolderId", "companyFolderId"),
    hazardType: pickField(record, "HazardType", "hazardType"),
    hazardTitle: pickField(record, "HazardTitle", "hazardTitle"),
    hazardDescription: pickField(record, "HazardDescription", "hazardDescription"),
    whoMightBeHarmed: pickField(record, "WhoMightBeHarmed", "whoMightBeHarmed"),
    howMightTheyBeHarmed: pickField(record, "HowMightTheyBeHarmed", "howMightTheyBeHarmed"),
    existingControls: pickField(record, "ExistingControls", "existingControls"),
    initialLikelihood,
    initialSeverity,
    initialRiskScore,
    additionalControls: pickField(record, "AdditionalControls", "additionalControls"),
    residualLikelihood,
    residualSeverity,
    residualRiskScore,
    controlOwnerUserId: pickField(record, "ControlOwnerUserId", "controlOwnerUserId"),
    controlOwnerName: pickField(record, "ControlOwnerName", "controlOwnerName"),
    controlDueDate: pickField(record, "ControlDueDate", "controlDueDate"),
    actionRequired: parseBool(pickField(record, "ActionRequired", "actionRequired")),
    linkedActionId: pickField(record, "LinkedActionId", "linkedActionId"),
    sortOrder: parseNumber(pickField(record, "SortOrder", "sortOrder")),
    status: pickField(record, "Status", "status") || "active",
    createdAt: pickField(record, "CreatedAt", "createdAt"),
    createdBy: normalizeEmail(pickField(record, "CreatedBy", "createdBy")),
    updatedAt: pickField(record, "UpdatedAt", "updatedAt"),
    updatedBy: normalizeEmail(pickField(record, "UpdatedBy", "updatedBy")),
    archivedAt: pickField(record, "ArchivedAt", "archivedAt"),
    archivedBy: normalizeEmail(pickField(record, "ArchivedBy", "archivedBy")),
    initialBand: getRiskBand(initialRiskScore),
    residualBand: getRiskBand(residualRiskScore),
  };
}

export function mapRiskLinkRecord(record = {}) {
  return {
    id: pickField(record, "LinkId", "linkId"),
    riskAssessmentId: pickField(record, "RiskAssessmentId", "riskAssessmentId"),
    companyFolderId: pickField(record, "CompanyFolderId", "companyFolderId"),
    linkedRecordType: pickField(record, "LinkedRecordType", "linkedRecordType"),
    linkedRecordId: pickField(record, "LinkedRecordId", "linkedRecordId"),
    linkedRecordTitle: pickField(record, "LinkedRecordTitle", "linkedRecordTitle"),
    relationshipType: pickField(record, "RelationshipType", "relationshipType") || "applies_to",
    notes: pickField(record, "Notes", "notes"),
    createdAt: pickField(record, "CreatedAt", "createdAt"),
    createdBy: normalizeEmail(pickField(record, "CreatedBy", "createdBy")),
    archivedAt: pickField(record, "ArchivedAt", "archivedAt"),
    archivedBy: normalizeEmail(pickField(record, "ArchivedBy", "archivedBy")),
  };
}

export function mapRiskReviewRecord(record = {}) {
  return {
    id: pickField(record, "ReviewId", "reviewId"),
    riskAssessmentId: pickField(record, "RiskAssessmentId", "riskAssessmentId"),
    companyFolderId: pickField(record, "CompanyFolderId", "companyFolderId"),
    reviewDate: pickField(record, "ReviewDate", "reviewDate"),
    reviewerUserId: pickField(record, "ReviewerUserId", "reviewerUserId"),
    reviewerName: pickField(record, "ReviewerName", "reviewerName"),
    reviewType: pickField(record, "ReviewType", "reviewType") || "manual",
    outcome: pickField(record, "Outcome", "outcome") || "no_change",
    changesRequired: pickField(record, "ChangesRequired", "changesRequired"),
    summary: pickField(record, "Summary", "summary"),
    previousVersion: pickField(record, "PreviousVersion", "previousVersion"),
    newVersion: pickField(record, "NewVersion", "newVersion"),
    linkedIncidentId: pickField(record, "LinkedIncidentId", "linkedIncidentId"),
    linkedAuditId: pickField(record, "LinkedAuditId", "linkedAuditId"),
    createdAt: pickField(record, "CreatedAt", "createdAt"),
    createdBy: normalizeEmail(pickField(record, "CreatedBy", "createdBy")),
  };
}

export function validateRiskAssessmentForSubmit(assessment = {}, hazards = [], options = {}) {
  const todayKey = trim(options.todayKey) || getUkTodayKey();
  const fieldErrors = [];
  const push = (step, field, message) => fieldErrors.push({ step, field, message });

  if (!trim(assessment.title)) push("details", "title", "Title is required.");
  if (!trim(assessment.assessmentType)) push("details", "assessmentType", "Assessment type is required.");
  if (!trim(assessment.assessmentDate)) push("details", "assessmentDate", "Assessment date is required.");
  if (!trim(assessment.reviewDate)) push("details", "reviewDate", "Review date is required.");

  const assessmentDate = trim(assessment.assessmentDate);
  const reviewDate = trim(assessment.reviewDate);
  if (assessmentDate && reviewDate && reviewDate <= assessmentDate) {
    push("details", "reviewDate", "Review date must be after the assessment date.");
  }
  if (reviewDate && reviewDate < todayKey) {
    push("details", "reviewDate", "Review date cannot be in the past.");
  }

  const activeHazards = (Array.isArray(hazards) ? hazards : []).filter((hazard) => !trim(hazard.archivedAt));
  if (activeHazards.length === 0) {
    push("hazards", "hazards", "At least one hazard is required.");
  }

  for (const hazard of activeHazards) {
    const label = trim(hazard.hazardTitle) || trim(hazard.hazardType) || "Hazard";
    if (!trim(hazard.hazardTitle) && !trim(hazard.hazardType)) {
      push("hazards", "hazardTitle", "Hazard title is required.");
    }
    if (!trim(hazard.whoMightBeHarmed)) {
      push("hazards", "whoMightBeHarmed", `Who might be harmed is required for "${label}".`);
    }
    if (!trim(hazard.existingControls)) {
      push("hazards", "existingControls", `Existing controls are required for "${label}".`);
    }
    if (!validateRiskValue(hazard.initialLikelihood) || !validateRiskValue(hazard.initialSeverity)) {
      push("controls", "initialRisk", `Initial risk scores are required for "${label}".`);
    }
    if (!validateRiskValue(hazard.residualLikelihood) || !validateRiskValue(hazard.residualSeverity)) {
      push("residual", "residualRisk", `Residual risk scores are required for "${label}".`);
    }
    if (parseBool(hazard.actionRequired)) {
      if (!trim(hazard.controlOwnerName)) {
        push("controls", "controlOwnerName", `Control owner is required for "${label}".`);
      }
      if (!trim(hazard.controlDueDate)) {
        push("controls", "controlDueDate", `Control due date is required for "${label}".`);
      }
    }
  }

  return {
    ok: fieldErrors.length === 0,
    message: fieldErrors.length ? "The risk assessment cannot be submitted." : "",
    fieldErrors,
  };
}

export function canEditRiskAssessmentStatus(status) {
  return ["Draft", "Rejected"].includes(status);
}

export function canSubmitRiskAssessmentStatus(status) {
  return ["Draft", "Rejected"].includes(status);
}

export function canApproveRiskAssessmentStatus(status) {
  return status === "Submitted";
}

export function canReviewRiskAssessmentStatus(status) {
  return ["Active", "Review Due", "Overdue", "Approved"].includes(status);
}
