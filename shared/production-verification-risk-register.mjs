/**
 * Production smoke verification Risk Register records — workflow gate (bert-smoke-risk-*).
 */
import { calculateRiskScore, getRiskBand } from "./risk-assessments.mjs";
import { addMonthsToDateKey } from "./loler.mjs";
import { getUkTodayKey } from "./uk-date-time.mjs";

export const PRODUCTION_VERIFICATION_RISK_REGISTER_ID_PREFIX = "bert-smoke-risk-";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_CONTROL_ID_PREFIX = "bert-smoke-risk-control-";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_REFERENCE_PREFIX = "BERT-VERIFY-RISK-";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_TITLE = "BERT Verification Business Risk";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_DESCRIPTION =
  "Automated production Risk Register workflow verification. Safe to remove.";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_CATEGORY = "Operational";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_DEPARTMENT = "Verification";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_SITE = "Rugby";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_CAUSE =
  "Temporary loss of access to a verification-only system";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_CONSEQUENCE =
  "Short delay to non-critical verification activity";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_EXISTING_CONTROL =
  "Documented recovery procedure and named owner";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_FURTHER_CONTROL =
  "Verify recovery checklist and perform monthly test";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_INITIAL_LIKELIHOOD = 3;
export const PRODUCTION_VERIFICATION_RISK_REGISTER_INITIAL_IMPACT = 3;
export const PRODUCTION_VERIFICATION_RISK_REGISTER_RESIDUAL_LIKELIHOOD = 1;
export const PRODUCTION_VERIFICATION_RISK_REGISTER_RESIDUAL_IMPACT = 2;
export const PRODUCTION_VERIFICATION_RISK_REGISTER_SOURCE = "production-risk-register-workflow";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_MARKER = "verification";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_CLEANED_MARKER = "verification-cleaned";
export const PRODUCTION_VERIFICATION_RISK_REGISTER_NOTES_MARKER =
  `[bert-verification] source=${PRODUCTION_VERIFICATION_RISK_REGISTER_SOURCE} marker=${PRODUCTION_VERIFICATION_RISK_REGISTER_MARKER}`;
export const PRODUCTION_VERIFICATION_RISK_REGISTER_REVIEW_SUMMARY =
  "Production Risk Register smoke verification review";

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

function pickField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) {
      return direct;
    }
  }
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = normalize(header).replace(/[^a-z0-9]/g, "");
    for (const key of keys) {
      const normalizedKey = normalize(key).replace(/[^a-z0-9]/g, "");
      if (normalizedHeader === normalizedKey || normalizedHeader.includes(normalizedKey)) {
        const text = trim(value);
        if (text) {
          return text;
        }
      }
    }
  }
  return "";
}

export function buildProductionVerificationRiskRegisterId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_RISK_REGISTER_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationRiskRegisterControlId(runId = Date.now(), controlType = "existing") {
  return `${PRODUCTION_VERIFICATION_RISK_REGISTER_CONTROL_ID_PREFIX}${controlType}-${runId}`;
}

export function buildProductionVerificationRiskRegisterReference(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_RISK_REGISTER_REFERENCE_PREFIX}${runId}`;
}

export function isVerificationRiskRegisterId(riskId = "") {
  return trim(riskId).startsWith(PRODUCTION_VERIFICATION_RISK_REGISTER_ID_PREFIX);
}

export function isVerificationRiskRegisterControlId(controlId = "") {
  return trim(controlId).startsWith(PRODUCTION_VERIFICATION_RISK_REGISTER_CONTROL_ID_PREFIX);
}

export function isVerificationRiskRegisterReference(reference = "") {
  return trim(reference).toUpperCase().startsWith(PRODUCTION_VERIFICATION_RISK_REGISTER_REFERENCE_PREFIX);
}

function notesContainVerificationMarker(notes = "") {
  const text = normalize(notes);
  return (
    text.includes(normalize(PRODUCTION_VERIFICATION_RISK_REGISTER_SOURCE)) &&
    text.includes(`marker=${PRODUCTION_VERIFICATION_RISK_REGISTER_MARKER}`)
  );
}

export function isVerificationRiskRegisterItem(record = {}) {
  const id = pickField(record, "id", "RiskId", "riskId");
  if (isVerificationRiskRegisterId(id)) {
    return true;
  }
  const reference = pickField(record, "riskReference", "RiskReference");
  if (isVerificationRiskRegisterReference(reference)) {
    return true;
  }
  const title = normalize(pickField(record, "title", "Title"));
  if (title === normalize(PRODUCTION_VERIFICATION_RISK_REGISTER_TITLE)) {
    return true;
  }
  const description = pickField(record, "description", "Description");
  if (notesContainVerificationMarker(description)) {
    return true;
  }
  const notes = pickField(record, "notes", "Notes");
  if (notesContainVerificationMarker(notes)) {
    return true;
  }
  return false;
}

export function isActiveVerificationRiskRegisterItem(record = {}) {
  if (!isVerificationRiskRegisterItem(record)) {
    return false;
  }
  if (trim(record.archivedAt || record.ArchivedAt)) {
    return false;
  }
  const notes = pickField(record, "notes", "Notes");
  const description = pickField(record, "description", "Description");
  if (
    normalize(notes).includes(PRODUCTION_VERIFICATION_RISK_REGISTER_CLEANED_MARKER) ||
    normalize(description).includes(PRODUCTION_VERIFICATION_RISK_REGISTER_CLEANED_MARKER)
  ) {
    return false;
  }
  const status = normalize(pickField(record, "status", "Status"));
  return status !== "archived";
}

export function isOperationalRiskRegisterItem(record = {}) {
  if (!isVerificationRiskRegisterItem(record)) {
    return true;
  }
  const notes = pickField(record, "notes", "Notes");
  const description = pickField(record, "description", "Description");
  if (
    normalize(notes).includes(PRODUCTION_VERIFICATION_RISK_REGISTER_CLEANED_MARKER) ||
    normalize(description).includes(PRODUCTION_VERIFICATION_RISK_REGISTER_CLEANED_MARKER)
  ) {
    return true;
  }
  return Boolean(trim(record.archivedAt || record.ArchivedAt));
}

export function defaultVerificationRiskReviewDate(todayKey = getUkTodayKey()) {
  return addMonthsToDateKey(todayKey, 12);
}

export function riskSubmittedMarker(notes = "") {
  return normalize(notes).includes("submitted=true");
}

export function riskApprovedMarker(notes = "") {
  return normalize(notes).includes("approved=true");
}

export function riskReviewedMarker(notes = "") {
  return normalize(notes).includes("reviewed=true");
}

export function buildProductionVerificationRiskRegister({
  runId = Date.now(),
  riskId = buildProductionVerificationRiskRegisterId(runId),
  companyFolderId = "",
  ownerName = "",
  todayKey = getUkTodayKey(),
  reviewDate = defaultVerificationRiskReviewDate(todayKey),
} = {}) {
  const riskReference = buildProductionVerificationRiskRegisterReference(runId);
  const initialScore = calculateRiskScore(
    PRODUCTION_VERIFICATION_RISK_REGISTER_INITIAL_LIKELIHOOD,
    PRODUCTION_VERIFICATION_RISK_REGISTER_INITIAL_IMPACT,
  );
  const residualScore = calculateRiskScore(
    PRODUCTION_VERIFICATION_RISK_REGISTER_RESIDUAL_LIKELIHOOD,
    PRODUCTION_VERIFICATION_RISK_REGISTER_RESIDUAL_IMPACT,
  );
  return {
    riskId,
    companyFolderId: trim(companyFolderId),
    riskReference,
    title: PRODUCTION_VERIFICATION_RISK_REGISTER_TITLE,
    description: `${PRODUCTION_VERIFICATION_RISK_REGISTER_DESCRIPTION} ${PRODUCTION_VERIFICATION_RISK_REGISTER_NOTES_MARKER}`,
    category: PRODUCTION_VERIFICATION_RISK_REGISTER_CATEGORY,
    department: PRODUCTION_VERIFICATION_RISK_REGISTER_DEPARTMENT,
    siteId: PRODUCTION_VERIFICATION_RISK_REGISTER_SITE,
    ownerName: trim(ownerName),
    cause: PRODUCTION_VERIFICATION_RISK_REGISTER_CAUSE,
    consequence: PRODUCTION_VERIFICATION_RISK_REGISTER_CONSEQUENCE,
    initialLikelihood: PRODUCTION_VERIFICATION_RISK_REGISTER_INITIAL_LIKELIHOOD,
    initialImpact: PRODUCTION_VERIFICATION_RISK_REGISTER_INITIAL_IMPACT,
    initialRiskScore: initialScore,
    initialRiskBand: getRiskBand(initialScore).label,
    residualLikelihood: PRODUCTION_VERIFICATION_RISK_REGISTER_RESIDUAL_LIKELIHOOD,
    residualImpact: PRODUCTION_VERIFICATION_RISK_REGISTER_RESIDUAL_IMPACT,
    residualRiskScore: residualScore,
    residualRiskBand: getRiskBand(residualScore).label,
    status: "Draft",
    reviewDate,
    notes: PRODUCTION_VERIFICATION_RISK_REGISTER_NOTES_MARKER,
  };
}

export function buildProductionVerificationExistingControl({
  runId = Date.now(),
  riskId = buildProductionVerificationRiskRegisterId(runId),
  companyFolderId = "",
  controlId = buildProductionVerificationRiskRegisterControlId(runId, "existing"),
} = {}) {
  return {
    controlId,
    riskId,
    companyFolderId: trim(companyFolderId),
    controlType: "existing",
    description: PRODUCTION_VERIFICATION_RISK_REGISTER_EXISTING_CONTROL,
    ownerName: "",
    dueDate: "",
    sortOrder: 1,
    status: "active",
  };
}

export function buildProductionVerificationFurtherControl({
  runId = Date.now(),
  riskId = buildProductionVerificationRiskRegisterId(runId),
  companyFolderId = "",
  controlId = buildProductionVerificationRiskRegisterControlId(runId, "further"),
  ownerName = "",
  dueDate = "",
} = {}) {
  return {
    controlId,
    riskId,
    companyFolderId: trim(companyFolderId),
    controlType: "further",
    description: PRODUCTION_VERIFICATION_RISK_REGISTER_FURTHER_CONTROL,
    ownerName: trim(ownerName),
    dueDate: trim(dueDate),
    sortOrder: 2,
    status: "active",
  };
}

export function findRiskRegisterById(items = [], riskId = "") {
  const target = trim(riskId);
  return items.find((item) => trim(item.id) === target) || null;
}

export function listActiveVerificationRiskRegisterItems(items = []) {
  return items.filter((item) => isActiveVerificationRiskRegisterItem(item));
}

export function countRiskRegisterBaselines(items = [], todayKey = getUkTodayKey()) {
  const operational = items.filter((item) => isOperationalRiskRegisterItem(item) && normalize(item.status) !== "archived");
  const verificationCount = items.filter((item) => isActiveVerificationRiskRegisterItem(item)).length;
  return {
    total: operational.length,
    draft: operational.filter((item) => normalize(item.status) === "draft").length,
    active: operational.filter((item) => ["active", "open"].includes(normalize(item.status))).length,
    highCritical: operational.filter((item) => Number(item.residualRiskScore) >= 10).length,
    reviewDue: operational.filter((item) => normalize(item.status) === "review due").length,
    overdue: operational.filter((item) => normalize(item.status) === "overdue").length,
    verificationCount,
    todayKey,
  };
}
