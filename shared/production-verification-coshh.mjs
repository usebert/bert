/**
 * Production smoke verification COSHH records — workflow gate (bert-smoke-coshh-*).
 */
import { addMonthsToDateKey } from "./loler.mjs";
import { getUkTodayKey } from "./uk-date-time.mjs";

export const PRODUCTION_VERIFICATION_COSHH_ID_PREFIX = "bert-smoke-coshh-";
export const PRODUCTION_VERIFICATION_COSHH_SUBSTANCE_ID_PREFIX = "bert-smoke-substance-";
export const PRODUCTION_VERIFICATION_COSHH_ASSESSMENT_ID_PREFIX = "bert-smoke-coshh-assess-";
export const PRODUCTION_VERIFICATION_COSHH_ASSESSMENT_NUMBER_PREFIX = "BERT-VERIFY-COSHH-";
export const PRODUCTION_VERIFICATION_COSHH_PRODUCT_NAME = "BERT Verification Cleaning Product";
export const PRODUCTION_VERIFICATION_COSHH_DESCRIPTION =
  "Automated production COSHH workflow verification. Safe to remove.";
export const PRODUCTION_VERIFICATION_COSHH_SUPPLIER = "BERT Demo Supplier";
export const PRODUCTION_VERIFICATION_COSHH_PRIMARY_USE = "General surface cleaning";
export const PRODUCTION_VERIFICATION_COSHH_DEPARTMENT = "Verification";
export const PRODUCTION_VERIFICATION_COSHH_LOCATION = "Rugby";
export const PRODUCTION_VERIFICATION_COSHH_HAZARD_CLASSIFICATION = "Irritant";
export const PRODUCTION_VERIFICATION_COSHH_SIGNAL_WORD = "Warning";
export const PRODUCTION_VERIFICATION_COSHH_EXPOSURE_ROUTES = "Skin contact, eye contact";
export const PRODUCTION_VERIFICATION_COSHH_PPE = "Protective gloves, safety glasses";
export const PRODUCTION_VERIFICATION_COSHH_STORAGE = "Keep sealed in a cool, dry place";
export const PRODUCTION_VERIFICATION_COSHH_SPILL = "Absorb with inert material and dispose safely";
export const PRODUCTION_VERIFICATION_COSHH_FIRST_AID = "Rinse affected area with water";
export const PRODUCTION_VERIFICATION_COSHH_SOURCE = "production-coshh-workflow";
export const PRODUCTION_VERIFICATION_COSHH_MARKER = "verification";
export const PRODUCTION_VERIFICATION_COSHH_CLEANED_MARKER = "verification-cleaned";
export const PRODUCTION_VERIFICATION_COSHH_NOTES_MARKER =
  `[bert-verification] source=${PRODUCTION_VERIFICATION_COSHH_SOURCE} marker=${PRODUCTION_VERIFICATION_COSHH_MARKER}`;
export const PRODUCTION_VERIFICATION_COSHH_REVIEW_SUMMARY = "Production COSHH smoke verification review";
export const PRODUCTION_VERIFICATION_COSHH_SDS_FILENAME_PREFIX = "BERT-VERIFICATION-SDS-";

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

export function buildProductionVerificationCoshhId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_COSHH_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationSubstanceId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_COSHH_SUBSTANCE_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationCoshhAssessmentId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_COSHH_ASSESSMENT_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationCoshhAssessmentNumber(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_COSHH_ASSESSMENT_NUMBER_PREFIX}${runId}`;
}

export function buildProductionVerificationSdsDocumentId(runId = Date.now()) {
  return `bert-verification-sds-${runId}`;
}

export function buildProductionVerificationSdsFileName(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_COSHH_SDS_FILENAME_PREFIX}${runId}.pdf`;
}

export function isVerificationCoshhId(coshhId = "") {
  const id = trim(coshhId);
  return id.startsWith(PRODUCTION_VERIFICATION_COSHH_ID_PREFIX) || id.startsWith(PRODUCTION_VERIFICATION_COSHH_SUBSTANCE_ID_PREFIX);
}

export function isVerificationCoshhAssessmentId(assessmentId = "") {
  return trim(assessmentId).startsWith(PRODUCTION_VERIFICATION_COSHH_ASSESSMENT_ID_PREFIX);
}

export function isVerificationCoshhAssessmentNumber(assessmentNumber = "") {
  return trim(assessmentNumber).toUpperCase().startsWith(PRODUCTION_VERIFICATION_COSHH_ASSESSMENT_NUMBER_PREFIX);
}

function descriptionContainsVerificationMarker(description = "") {
  const text = normalize(description);
  return text.includes(normalize(PRODUCTION_VERIFICATION_COSHH_SOURCE)) && text.includes(`marker=${PRODUCTION_VERIFICATION_COSHH_MARKER}`);
}

export function isVerificationCoshhRegister(record = {}) {
  const id = pickField(record, "id", "CoshhId", "coshhId");
  if (isVerificationCoshhId(id)) {
    return true;
  }
  const productCode = pickField(record, "productCode", "ProductCode");
  if (isVerificationCoshhAssessmentNumber(productCode)) {
    return true;
  }
  const productName = normalize(pickField(record, "productName", "ProductName"));
  if (productName === normalize(PRODUCTION_VERIFICATION_COSHH_PRODUCT_NAME)) {
    return true;
  }
  const description = pickField(record, "description", "Description");
  if (descriptionContainsVerificationMarker(description)) {
    return true;
  }
  return false;
}

export function isActiveVerificationCoshhRegister(record = {}) {
  if (!isVerificationCoshhRegister(record)) {
    return false;
  }
  if (trim(record.archivedAt || record.ArchivedAt)) {
    return false;
  }
  const description = pickField(record, "description", "Description");
  if (normalize(description).includes(PRODUCTION_VERIFICATION_COSHH_CLEANED_MARKER)) {
    return false;
  }
  const status = normalize(pickField(record, "status", "Status"));
  return status !== "archived";
}

export function isOperationalCoshhRegister(record = {}) {
  if (!isVerificationCoshhRegister(record)) {
    return true;
  }
  const description = pickField(record, "description", "Description");
  if (normalize(description).includes(PRODUCTION_VERIFICATION_COSHH_CLEANED_MARKER)) {
    return true;
  }
  return Boolean(trim(record.archivedAt || record.ArchivedAt));
}

export function isVerificationCoshhAssessment(record = {}) {
  const assessmentId = pickField(record, "id", "AssessmentId", "assessmentId");
  if (isVerificationCoshhAssessmentId(assessmentId)) {
    return true;
  }
  const coshhId = pickField(record, "coshhId", "CoshhId");
  if (isVerificationCoshhId(coshhId)) {
    return true;
  }
  const title = pickField(record, "assessmentTitle", "AssessmentTitle");
  if (isVerificationCoshhAssessmentNumber(title.split(":")[0])) {
    return true;
  }
  const additionalActions = pickField(record, "additionalActions", "AdditionalActions");
  if (additionalActions.includes(PRODUCTION_VERIFICATION_COSHH_SOURCE)) {
    return true;
  }
  return false;
}

export function isActiveVerificationCoshhAssessment(record = {}) {
  if (!isVerificationCoshhAssessment(record)) {
    return false;
  }
  if (trim(record.archivedAt || record.ArchivedAt)) {
    return false;
  }
  const additionalActions = pickField(record, "additionalActions", "AdditionalActions");
  if (normalize(additionalActions).includes(PRODUCTION_VERIFICATION_COSHH_CLEANED_MARKER)) {
    return false;
  }
  const status = normalize(pickField(record, "status", "Status"));
  return status !== "archived" && status !== PRODUCTION_VERIFICATION_COSHH_CLEANED_MARKER;
}

export function isOperationalCoshhAssessment(record = {}) {
  if (!isVerificationCoshhAssessment(record)) {
    return true;
  }
  const additionalActions = pickField(record, "additionalActions", "AdditionalActions");
  if (normalize(additionalActions).includes(PRODUCTION_VERIFICATION_COSHH_CLEANED_MARKER)) {
    return true;
  }
  return Boolean(trim(record.archivedAt || record.ArchivedAt));
}

export function defaultVerificationReviewDate(todayKey = getUkTodayKey()) {
  return addMonthsToDateKey(todayKey, 12);
}

export function buildProductionVerificationCoshhSubstance({
  runId = Date.now(),
  coshhId = buildProductionVerificationCoshhId(runId),
  companyFolderId = "",
  todayKey = getUkTodayKey(),
  reviewDate = defaultVerificationReviewDate(todayKey),
  sdsDocumentId = buildProductionVerificationSdsDocumentId(runId),
  sdsFileName = buildProductionVerificationSdsFileName(runId),
  sdsIssueDate = todayKey,
  sdsVersion = "verification-1",
} = {}) {
  const assessmentNumber = buildProductionVerificationCoshhAssessmentNumber(runId);
  return {
    coshhId,
    companyFolderId: trim(companyFolderId),
    productName: PRODUCTION_VERIFICATION_COSHH_PRODUCT_NAME,
    manufacturer: PRODUCTION_VERIFICATION_COSHH_SUPPLIER,
    supplier: PRODUCTION_VERIFICATION_COSHH_SUPPLIER,
    productCode: assessmentNumber,
    description: `${PRODUCTION_VERIFICATION_COSHH_DESCRIPTION} ${PRODUCTION_VERIFICATION_COSHH_NOTES_MARKER}`,
    physicalForm: "Liquid",
    signalWord: PRODUCTION_VERIFICATION_COSHH_SIGNAL_WORD,
    hazardStatements: PRODUCTION_VERIFICATION_COSHH_HAZARD_CLASSIFICATION,
    precautionaryStatements: "Wear protective gloves and eye protection.",
    primaryUse: PRODUCTION_VERIFICATION_COSHH_PRIMARY_USE,
    storageLocation: PRODUCTION_VERIFICATION_COSHH_LOCATION,
    assessmentRequired: false,
    approvedForUse: false,
    reviewDate,
    sdsDocumentId: trim(sdsDocumentId),
    sdsFileName: trim(sdsFileName),
    sdsIssueDate: trim(sdsIssueDate) || todayKey,
    sdsVersion: trim(sdsVersion),
  };
}

export function buildProductionVerificationCoshhAssessment({
  runId = Date.now(),
  coshhId = buildProductionVerificationCoshhId(runId),
  assessmentId = buildProductionVerificationCoshhAssessmentId(runId),
  companyFolderId = "",
  assessorName = "",
  todayKey = getUkTodayKey(),
  reviewDate = defaultVerificationReviewDate(todayKey),
} = {}) {
  const assessmentNumber = buildProductionVerificationCoshhAssessmentNumber(runId);
  return {
    assessmentId,
    coshhId,
    companyFolderId: trim(companyFolderId),
    assessmentTitle: `${assessmentNumber}: ${PRODUCTION_VERIFICATION_COSHH_PRODUCT_NAME}`,
    activity: PRODUCTION_VERIFICATION_COSHH_PRIMARY_USE,
    personsAtRisk: "Employees",
    frequencyOfUse: "Occasional",
    quantityUsed: "Small",
    durationOfExposure: "Short",
    exposureRoutes: PRODUCTION_VERIFICATION_COSHH_EXPOSURE_ROUTES,
    hazards: PRODUCTION_VERIFICATION_COSHH_HAZARD_CLASSIFICATION,
    existingControls: "Use in ventilated area",
    engineeringControls: "Local ventilation where required",
    ppeRequired: PRODUCTION_VERIFICATION_COSHH_PPE,
    storageControls: PRODUCTION_VERIFICATION_COSHH_STORAGE,
    spillProcedure: PRODUCTION_VERIFICATION_COSHH_SPILL,
    firstAid: PRODUCTION_VERIFICATION_COSHH_FIRST_AID,
    fireResponse: "Use appropriate extinguisher",
    disposalMethod: "Dispose according to local regulations",
    emergencyActions: "Evacuate if necessary",
    initialLikelihood: 2,
    initialSeverity: 2,
    residualLikelihood: 1,
    residualSeverity: 2,
    additionalActions: PRODUCTION_VERIFICATION_COSHH_NOTES_MARKER,
    assessorName: trim(assessorName),
    assessmentDate: todayKey,
    reviewDate,
    status: "draft",
  };
}

export function countCoshhBaselines(coshhItems = [], assessments = [], todayKey = getUkTodayKey()) {
  const operational = coshhItems.filter((item) => isOperationalCoshhRegister(item));
  const verificationCount = coshhItems.filter((item) => isActiveVerificationCoshhRegister(item)).length;
  const draftAssessments = assessments.filter(
    (item) => isOperationalCoshhAssessment(item) && normalize(item.status) === "draft",
  ).length;
  const activeAssessments = assessments.filter(
    (item) => isOperationalCoshhAssessment(item) && normalize(item.status) === "active",
  ).length;
  return {
    totalCoshh: operational.length,
    draftCount: draftAssessments,
    activeCount: activeAssessments,
    reviewDueCount: operational.filter((item) => item.status === "review_due").length,
    overdueCount: operational.filter((item) => item.status === "overdue").length,
    missingSdsCount: operational.filter((item) => item.status === "missing_sds").length,
    verificationCount,
    todayKey,
  };
}

export function findCoshhById(items = [], coshhId = "") {
  const target = trim(coshhId);
  return items.find((item) => trim(item.id) === target) || null;
}

export function findCoshhAssessmentById(assessments = [], assessmentId = "") {
  const target = trim(assessmentId);
  return assessments.find((item) => trim(item.id) === target) || null;
}

export function listActiveVerificationCoshhRegisters(items = []) {
  return items.filter((item) => isActiveVerificationCoshhRegister(item));
}

export function assessmentSubmittedMarker(additionalActions = "") {
  return normalize(additionalActions).includes("submitted=true");
}

export function assessmentReviewedMarker(additionalActions = "") {
  return normalize(additionalActions).includes("reviewed=true");
}
