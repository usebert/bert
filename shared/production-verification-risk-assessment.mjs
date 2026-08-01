/**
 * Dedicated production smoke verification Risk Assessment for Dovecote Manufacturing Ltd.
 * Stable markers — safe to rerun; identifies verification-only workbook rows.
 */
import { getUkTodayKey } from "./uk-date-time.mjs";

export const PRODUCTION_VERIFICATION_RA_ID_PREFIX = "bert-smoke-ra-";
export const PRODUCTION_VERIFICATION_RA_ASSESSMENT_NUMBER_PREFIX = "BERT-VERIFY-RA-";
export const PRODUCTION_VERIFICATION_RA_HAZARD_ID_PREFIX = "bert-smoke-ra-hazard-";
export const PRODUCTION_VERIFICATION_RA_TITLE = "BERT Verification Risk Assessment";
export const PRODUCTION_VERIFICATION_RA_DESCRIPTION =
  "Automated production Risk Assessment workflow verification. Safe to remove.";
export const PRODUCTION_VERIFICATION_RA_ACTIVITY = "Production smoke verification";
export const PRODUCTION_VERIFICATION_RA_DEPARTMENT = "Verification";
export const PRODUCTION_VERIFICATION_RA_ASSESSMENT_TYPE = "General";
export const PRODUCTION_VERIFICATION_RA_MARKER = "verification";
export const PRODUCTION_VERIFICATION_RA_SOURCE_REFERENCE = "production-risk-assessment-workflow";
export const PRODUCTION_VERIFICATION_RA_CLEANED_STATUS = "verification-cleaned";
export const PRODUCTION_VERIFICATION_RA_REVIEW_SUMMARY = "Production smoke verification review";

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
  return "";
}

export function isVerificationRiskAssessmentId(riskAssessmentId = "") {
  return trim(riskAssessmentId).startsWith(PRODUCTION_VERIFICATION_RA_ID_PREFIX);
}

export function isVerificationAssessmentNumber(assessmentNumber = "") {
  return trim(assessmentNumber).startsWith(PRODUCTION_VERIFICATION_RA_ASSESSMENT_NUMBER_PREFIX);
}

export function isVerificationHazardId(hazardId = "") {
  return trim(hazardId).startsWith(PRODUCTION_VERIFICATION_RA_HAZARD_ID_PREFIX);
}

export function isVerificationRiskAssessment(record = {}) {
  const id = pickField(record, "id", "RiskAssessmentId", "riskAssessmentId");
  if (isVerificationRiskAssessmentId(id)) {
    return true;
  }

  const assessmentNumber = pickField(record, "assessmentNumber", "AssessmentNumber");
  if (isVerificationAssessmentNumber(assessmentNumber)) {
    return true;
  }

  const title = normalize(pickField(record, "title", "Title"));
  const activity = normalize(pickField(record, "activity", "Activity"));
  const department = normalize(pickField(record, "department", "Department"));
  const marker = normalize(pickField(record, "nextReviewReason", "NextReviewReason"));
  const source = normalize(pickField(record, "peopleAtRisk", "PeopleAtRisk"));
  const description = normalize(pickField(record, "description", "Description"));

  if (title === normalize(PRODUCTION_VERIFICATION_RA_TITLE)) {
    return true;
  }
  if (
    marker === PRODUCTION_VERIFICATION_RA_MARKER &&
    source === normalize(PRODUCTION_VERIFICATION_RA_SOURCE_REFERENCE)
  ) {
    return true;
  }
  if (
    activity === normalize(PRODUCTION_VERIFICATION_RA_ACTIVITY) &&
    department === normalize(PRODUCTION_VERIFICATION_RA_DEPARTMENT) &&
    description.includes("automated production risk assessment workflow verification")
  ) {
    return true;
  }

  return false;
}

export function isActiveVerificationRiskAssessment(record = {}) {
  if (!isVerificationRiskAssessment(record)) {
    return false;
  }
  const status = normalize(pickField(record, "status", "Status"));
  if (status === PRODUCTION_VERIFICATION_RA_CLEANED_STATUS) {
    return false;
  }
  if (trim(record.archivedAt || record.ArchivedAt)) {
    return false;
  }
  return status !== "archived";
}

export function isOperationalRiskAssessment(record = {}) {
  if (!isVerificationRiskAssessment(record)) {
    return true;
  }
  const status = normalize(pickField(record, "status", "Status"));
  return status === PRODUCTION_VERIFICATION_RA_CLEANED_STATUS || Boolean(trim(record.archivedAt || record.ArchivedAt));
}

export function buildProductionVerificationRiskAssessmentId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_RA_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationAssessmentNumber(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_RA_ASSESSMENT_NUMBER_PREFIX}${runId}`;
}

export function buildProductionVerificationHazardId(runId = Date.now(), index = 1) {
  return `${PRODUCTION_VERIFICATION_RA_HAZARD_ID_PREFIX}${runId}-${index}`;
}

function addDaysToUkKey(days = 365) {
  const base = new Date(`${getUkTodayKey()}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function buildProductionVerificationHazard(runId, index, overrides = {}) {
  const templates = [
    {
      hazardType: "Slips, trips and falls",
      hazardTitle: "Slips, trips and falls",
      whoMightBeHarmed: "Employees",
      howMightTheyBeHarmed: "Minor injury from a fall",
      existingControls: "Work area kept clear",
      initialLikelihood: 3,
      initialSeverity: 2,
      additionalControls: "Confirm floor inspection completed",
      residualLikelihood: 1,
      residualSeverity: 2,
      actionRequired: false,
      sortOrder: 1,
    },
    {
      hazardType: "Manual handling",
      hazardTitle: "Manual handling",
      whoMightBeHarmed: "Employees",
      howMightTheyBeHarmed: "Musculoskeletal injury",
      existingControls: "Use appropriate lifting technique",
      initialLikelihood: 3,
      initialSeverity: 3,
      additionalControls: "Use two-person lift for awkward loads",
      residualLikelihood: 2,
      residualSeverity: 2,
      actionRequired: false,
      sortOrder: 2,
    },
  ];
  const template = templates[index - 1] || templates[0];
  return {
    id: buildProductionVerificationHazardId(runId, index),
    hazardId: buildProductionVerificationHazardId(runId, index),
    ...template,
    ...overrides,
  };
}

export function buildProductionVerificationRiskAssessment({
  runId = Date.now(),
  companyFolderId = "",
  ownerUserId = "",
  ownerName = "",
  assessorUserId = "",
  assessorName = "",
  now = new Date(),
} = {}) {
  const iso = now.toISOString();
  const id = buildProductionVerificationRiskAssessmentId(runId);
  const assessmentNumber = buildProductionVerificationAssessmentNumber(runId);
  return {
    riskAssessmentId: id,
    id,
    assessmentNumber,
    companyFolderId: trim(companyFolderId),
    title: PRODUCTION_VERIFICATION_RA_TITLE,
    description: PRODUCTION_VERIFICATION_RA_DESCRIPTION,
    assessmentType: PRODUCTION_VERIFICATION_RA_ASSESSMENT_TYPE,
    activity: PRODUCTION_VERIFICATION_RA_ACTIVITY,
    department: PRODUCTION_VERIFICATION_RA_DEPARTMENT,
    ownerUserId: trim(ownerUserId),
    ownerName: trim(ownerName),
    assessorUserId: trim(assessorUserId),
    assessorName: trim(assessorName),
    assessmentDate: getUkTodayKey(),
    reviewDate: addDaysToUkKey(365),
    nextReviewReason: PRODUCTION_VERIFICATION_RA_MARKER,
    peopleAtRisk: PRODUCTION_VERIFICATION_RA_SOURCE_REFERENCE,
    status: "Draft",
    version: "1.0",
    approvalRequired: true,
    createdAt: iso,
    updatedAt: iso,
  };
}

export function listActiveVerificationRiskAssessments(assessments = []) {
  return (Array.isArray(assessments) ? assessments : []).filter((item) => isActiveVerificationRiskAssessment(item));
}

export function countRiskAssessmentBaselines(assessments = []) {
  const operational = (Array.isArray(assessments) ? assessments : []).filter((item) => isOperationalRiskAssessment(item));
  let draft = 0;
  let submitted = 0;
  let active = 0;
  let reviewDue = 0;
  let overdue = 0;
  let verification = 0;

  for (const item of operational) {
    const status = trim(item.status);
    if (status === "Draft") draft += 1;
    else if (status === "Submitted") submitted += 1;
    else if (status === "Active" || status === "Approved") active += 1;
    else if (status === "Review Due") reviewDue += 1;
    else if (status === "Overdue") overdue += 1;
  }

  for (const item of Array.isArray(assessments) ? assessments : []) {
    if (isActiveVerificationRiskAssessment(item)) {
      verification += 1;
    }
  }

  return {
    total: operational.length,
    draft,
    submitted,
    active,
    reviewDue,
    overdue,
    verification,
  };
}
