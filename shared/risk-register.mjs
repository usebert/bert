/**
 * Risk Register — workbook tabs, columns, statuses, scoring, and record mappers.
 */
import { calculateRiskScore, getRiskBand } from "./risk-assessments.mjs";
import { getUkTodayKey } from "./uk-date-time.mjs";

export const RISK_REGISTER_TAB = "RiskRegister";
export const RISK_REGISTER_CONTROLS_TAB = "RiskRegisterControls";
export const RISK_REGISTER_REVIEWS_TAB = "RiskRegisterReviews";

export const RISK_REGISTER_REQUIRED_TABS = [RISK_REGISTER_TAB, RISK_REGISTER_CONTROLS_TAB, RISK_REGISTER_REVIEWS_TAB];

export const RISK_REGISTER_TAB_COLUMNS = [
  "RiskId",
  "CompanyFolderId",
  "RiskReference",
  "Title",
  "Description",
  "Category",
  "Department",
  "SiteId",
  "OwnerUserId",
  "OwnerName",
  "Cause",
  "Consequence",
  "InitialLikelihood",
  "InitialImpact",
  "InitialRiskScore",
  "InitialRiskBand",
  "ResidualLikelihood",
  "ResidualImpact",
  "ResidualRiskScore",
  "ResidualRiskBand",
  "Status",
  "ReviewDate",
  "SubmittedAt",
  "SubmittedBy",
  "ApprovedAt",
  "ApprovedBy",
  "Notes",
  "CreatedAt",
  "CreatedBy",
  "UpdatedAt",
  "UpdatedBy",
  "ArchivedAt",
  "ArchivedBy",
];

export const RISK_REGISTER_CONTROLS_TAB_COLUMNS = [
  "ControlId",
  "RiskId",
  "CompanyFolderId",
  "ControlType",
  "Description",
  "OwnerName",
  "DueDate",
  "SortOrder",
  "Status",
  "CreatedAt",
  "CreatedBy",
  "UpdatedAt",
  "UpdatedBy",
  "ArchivedAt",
  "ArchivedBy",
];

export const RISK_REGISTER_REVIEWS_TAB_COLUMNS = [
  "ReviewId",
  "RiskId",
  "CompanyFolderId",
  "ReviewDate",
  "ReviewerName",
  "Outcome",
  "Summary",
  "NextReviewDate",
  "CreatedAt",
  "CreatedBy",
];

export const RISK_REGISTER_STATUSES = ["Draft", "Submitted", "Active", "Review Due", "Overdue", "Archived"];

export const RISK_REGISTER_CONTROL_TYPES = ["existing", "further"];

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

export function normalizeRiskRegisterDateKey(value) {
  const text = trim(value);
  if (!text) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

export function buildRiskRegisterId() {
  return `risk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildRiskRegisterControlId() {
  return `rrc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildRiskRegisterReviewId() {
  return `rrr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveRiskRegisterStatus(record = {}, todayKey = getUkTodayKey()) {
  const archivedAt = trim(record.archivedAt || record.ArchivedAt);
  if (archivedAt) {
    return "Archived";
  }
  const statusRaw = trim(record.status || record.Status);
  if (statusRaw) {
    return statusRaw;
  }
  const reviewDate = normalizeRiskRegisterDateKey(record.reviewDate || record.ReviewDate);
  if (!reviewDate) {
    return "Draft";
  }
  if (reviewDate < todayKey) {
    return "Overdue";
  }
  const dueSoon = new Date(`${todayKey}T00:00:00.000Z`);
  dueSoon.setUTCDate(dueSoon.getUTCDate() + 30);
  if (reviewDate <= dueSoon.toISOString().slice(0, 10)) {
    return "Review Due";
  }
  return "Active";
}

export function mapRiskRegisterControlRecord(record = {}) {
  const archivedAt = trim(record.ArchivedAt || record.archivedAt);
  return {
    id: trim(record.ControlId || record.controlId),
    riskId: trim(record.RiskId || record.riskId),
    companyFolderId: trim(record.CompanyFolderId || record.companyFolderId),
    controlType: normalize(record.ControlType || record.controlType),
    description: trim(record.Description || record.description),
    ownerName: trim(record.OwnerName || record.ownerName),
    dueDate: normalizeRiskRegisterDateKey(record.DueDate || record.dueDate),
    sortOrder: Number(record.SortOrder ?? record.sortOrder) || 0,
    status: archivedAt ? "archived" : trim(record.Status || record.status) || "active",
    createdAt: trim(record.CreatedAt || record.createdAt),
    createdBy: trim(record.CreatedBy || record.createdBy),
    updatedAt: trim(record.UpdatedAt || record.updatedAt),
    updatedBy: trim(record.UpdatedBy || record.updatedBy),
    archivedAt,
    archivedBy: trim(record.ArchivedBy || record.archivedBy),
  };
}

export function mapRiskRegisterRecord(record = {}, options = {}) {
  const todayKey = options.todayKey || getUkTodayKey();
  const archivedAt = trim(record.ArchivedAt || record.archivedAt);
  const initialLikelihood = Number(record.InitialLikelihood ?? record.initialLikelihood) || 0;
  const initialImpact = Number(record.InitialImpact ?? record.initialImpact) || 0;
  const residualLikelihood = Number(record.ResidualLikelihood ?? record.residualLikelihood) || 0;
  const residualImpact = Number(record.ResidualImpact ?? record.residualImpact) || 0;
  const initialRiskScore =
    Number(record.InitialRiskScore ?? record.initialRiskScore) || calculateRiskScore(initialLikelihood, initialImpact);
  const residualRiskScore =
    Number(record.ResidualRiskScore ?? record.residualRiskScore) || calculateRiskScore(residualLikelihood, residualImpact);
  const initialRiskBand = trim(record.InitialRiskBand || record.initialRiskBand) || getRiskBand(initialRiskScore).label;
  const residualRiskBand = trim(record.ResidualRiskBand || record.residualRiskBand) || getRiskBand(residualRiskScore).label;
  const mapped = {
    id: trim(record.RiskId || record.riskId),
    companyFolderId: trim(record.CompanyFolderId || record.companyFolderId),
    riskReference: trim(record.RiskReference || record.riskReference),
    title: trim(record.Title || record.title),
    description: trim(record.Description || record.description),
    category: trim(record.Category || record.category),
    department: trim(record.Department || record.department),
    siteId: trim(record.SiteId || record.siteId),
    ownerUserId: trim(record.OwnerUserId || record.ownerUserId),
    ownerName: trim(record.OwnerName || record.ownerName),
    cause: trim(record.Cause || record.cause),
    consequence: trim(record.Consequence || record.consequence),
    initialLikelihood,
    initialImpact,
    initialRiskScore,
    initialRiskBand,
    residualLikelihood,
    residualImpact,
    residualRiskScore,
    residualRiskBand,
    status: deriveRiskRegisterStatus(record, todayKey),
    reviewDate: normalizeRiskRegisterDateKey(record.ReviewDate || record.reviewDate),
    submittedAt: trim(record.SubmittedAt || record.submittedAt),
    submittedBy: trim(record.SubmittedBy || record.submittedBy),
    approvedAt: trim(record.ApprovedAt || record.approvedAt),
    approvedBy: trim(record.ApprovedBy || record.approvedBy),
    notes: trim(record.Notes || record.notes),
    createdAt: trim(record.CreatedAt || record.createdAt),
    createdBy: trim(record.CreatedBy || record.createdBy),
    updatedAt: trim(record.UpdatedAt || record.updatedAt),
    updatedBy: trim(record.UpdatedBy || record.updatedBy),
    archivedAt,
    archivedBy: trim(record.ArchivedBy || record.archivedBy),
  };
  return mapped;
}

export function mapRiskRegisterReviewRecord(record = {}) {
  return {
    id: trim(record.ReviewId || record.reviewId),
    riskId: trim(record.RiskId || record.riskId),
    companyFolderId: trim(record.CompanyFolderId || record.companyFolderId),
    reviewDate: normalizeRiskRegisterDateKey(record.ReviewDate || record.reviewDate),
    reviewerName: trim(record.ReviewerName || record.reviewerName),
    outcome: trim(record.Outcome || record.outcome),
    summary: trim(record.Summary || record.summary),
    nextReviewDate: normalizeRiskRegisterDateKey(record.NextReviewDate || record.nextReviewDate),
    createdAt: trim(record.CreatedAt || record.createdAt),
    createdBy: trim(record.CreatedBy || record.createdBy),
  };
}

export function isHighOrCriticalRiskRegisterScore(score) {
  const value = Number(score);
  return value >= 10;
}
