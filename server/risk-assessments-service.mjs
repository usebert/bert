/**
 * Risk Assessments Phase 2 service — workbook CRUD, workflow, hazards, links, reviews.
 */
import {
  RISK_ASSESSMENT_HAZARDS_TAB,
  RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS,
  RISK_ASSESSMENT_LINKS_TAB,
  RISK_ASSESSMENT_LINKS_TAB_COLUMNS,
  RISK_ASSESSMENT_REQUIRED_TABS,
  RISK_ASSESSMENT_REVIEWS_TAB,
  RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS,
  RISK_ASSESSMENTS_TAB,
  RISK_ASSESSMENTS_TAB_COLUMNS,
  RISK_LINKED_RECORD_TYPES,
  RISK_LINK_RELATIONSHIP_TYPES,
  RISK_REVIEW_OUTCOMES,
  RISK_REVIEW_TYPES,
  buildRiskAssessmentId,
  buildRiskHazardId,
  buildRiskLinkId,
  buildRiskReviewId,
  bumpVersion,
  calculateRiskScore,
  canApproveRiskAssessmentStatus,
  canEditRiskAssessmentStatus,
  canReviewRiskAssessmentStatus,
  canSubmitRiskAssessmentStatus,
  deriveRiskAssessmentStatus,
  getRiskBand,
  isHighOrVeryHighRisk,
  mapRiskAssessmentRecord,
  mapRiskHazardRecord,
  mapRiskLinkRecord,
  mapRiskReviewRecord,
  nextAssessmentNumber,
  summariseAssessmentRisk,
  validateRiskValue,
} from "../shared/risk-assessments.mjs";
import { isCompanyInviteActor, isGodmodeInviteSession } from "../shared/company-invite-permissions.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import { actorCanAccessCompanyHealthSafety, healthSafetyApiFailure } from "./health-safety-service.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

export const RISK_ASSESSMENT_ROUTE_TIMEOUT_MS = 90_000;

const ACTIONS_TAB = "Actions";
const ACTIONS_TAB_COLUMNS = [
  "Action ID",
  "Company ID",
  "Source Audit ID",
  "Source Audit Name",
  "Source Question ID",
  "Source Question Text",
  "Source Answer",
  "Non Conformance ID",
  "Severity",
  "Status",
  "Assigned To User ID",
  "Assigned To Name",
  "Created By User ID",
  "Created At",
  "Updated At",
  "Due Date",
  "Closed At",
  "Verified By User ID",
  "Verification Notes",
  "Evidence Links",
  "Local Evidence Refs",
  "Comments",
  "Recurrence Flag",
  "Root Cause",
  "Corrective Action",
  "Preventive Action",
  "Risk Category",
  "Requires Manager Review",
  "Suggestion JSON",
  "Sync Status",
  "Sync Attempts",
  "Last Sync Error",
  "Remote Row ID",
  "Schema Version",
];

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveAppendTabRows(deps) {
  return typeof deps?.appendTabRows === "function" ? deps.appendTabRows : workbookAppendTabRows;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

function resolvePatchTabRowByHeader(deps) {
  return typeof deps?.patchTabRowByHeader === "function" ? deps.patchTabRowByHeader : workbookPatchTabRowByHeader;
}

export function canViewRiskAssessments(actor) {
  if (!actor?.email) return false;
  return actor.kind === "company" || actor.kind === "godmode" || isCompanyInviteActor(actor);
}

export function canCreateRiskAssessment(actor) {
  if (!canViewRiskAssessments(actor)) return false;
  const role = trim(actor.role);
  return role === "Master" || role === "Admin" || role === "Manager" || role === "Auditor";
}

export function canEditRiskAssessment(actor, assessment, options = {}) {
  if (!canViewRiskAssessments(actor)) return false;
  const role = trim(actor.role);
  if (role === "Master" || role === "Admin" || role === "Manager") {
    return canEditRiskAssessmentStatus(assessment?.status);
  }
  if (role === "Auditor") {
    if (!canEditRiskAssessmentStatus(assessment?.status)) return false;
    return normalizeEmail(assessment?.createdBy) === normalizeEmail(actor.email) || options.ownDraftOnly !== true;
  }
  return false;
}

export function canSubmitRiskAssessment(actor, assessment) {
  if (!canEditRiskAssessment(actor, assessment)) return false;
  const role = trim(actor.role);
  return role === "Master" || role === "Admin" || role === "Manager" || role === "Auditor";
}

export function canApproveRiskAssessment(actor, assessment) {
  if (!canViewRiskAssessments(actor)) return false;
  const role = trim(actor.role);
  if (!canApproveRiskAssessmentStatus(assessment?.status)) return false;
  if (role === "Master" || role === "Admin") return true;
  if (role === "Manager") return true;
  if (role === "Auditor") return false;
  return false;
}

export function canRejectRiskAssessment(actor, assessment) {
  return canApproveRiskAssessment(actor, assessment);
}

export function canSelfApproveRiskAssessment(actor, assessment) {
  const role = trim(actor.role);
  if (role === "Master" || role === "Admin") return true;
  if (role === "Auditor") return false;
  return normalizeEmail(assessment?.submittedBy) !== normalizeEmail(actor.email);
}

export function canArchiveRiskAssessment(actor) {
  const role = trim(actor.role);
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canReviewRiskAssessment(actor, assessment) {
  if (!canViewRiskAssessments(actor)) return false;
  const role = trim(actor.role);
  if (!canReviewRiskAssessmentStatus(assessment?.status)) return false;
  return role === "Master" || role === "Admin" || role === "Manager";
}

async function readTab(auth, deps, masterSheetId, tabName, columns) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, tabName, { expectedHeaders: columns });
  return result?.records || [];
}

function rowToPatch(row, columns) {
  const patch = {};
  for (const column of columns) {
    if (row[column] !== undefined) patch[column] = row[column];
  }
  return patch;
}

export async function ensureRiskAssessmentTabs(auth, deps, masterSheetId) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  const tabMap = [
    [RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS],
    [RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS],
    [RISK_ASSESSMENT_LINKS_TAB, RISK_ASSESSMENT_LINKS_TAB_COLUMNS],
    [RISK_ASSESSMENT_REVIEWS_TAB, RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS],
  ];
  for (const [tab, columns] of tabMap) {
    await ensureTabColumns(auth, deps, masterSheetId, tab, columns);
  }
}

function recalculateAssessmentRiskFields(hazards = []) {
  const summary = summariseAssessmentRisk(hazards);
  return {
    InitialOverallRiskScore: String(summary.initialOverallRiskScore),
    ResidualOverallRiskScore: String(summary.residualOverallRiskScore),
    HighestInitialRiskScore: String(summary.highestInitialRiskScore),
    HighestResidualRiskScore: String(summary.highestResidualRiskScore),
  };
}

function severityFromResidualScore(score) {
  if (score >= 17) return "Critical";
  if (score >= 10) return "High";
  if (score >= 5) return "Medium";
  return "Low";
}

async function createActionForHazard(auth, deps, resolved, actor, assessment, hazard) {
  if (!hazard.actionRequired || trim(hazard.linkedActionId)) {
    return { ok: true, actionId: trim(hazard.linkedActionId) };
  }
  const actionId = `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = nowIso();
  const row = {
    "Action ID": actionId,
    "Company ID": resolved.companyFolderId,
    "Source Audit ID": assessment.id,
    "Source Audit Name": `Risk Assessment: ${assessment.assessmentNumber || assessment.title}`,
    "Source Question ID": hazard.id,
    "Source Question Text": hazard.hazardTitle,
    "Source Answer": hazard.additionalControls,
    Severity: severityFromResidualScore(hazard.residualRiskScore),
    Status: "Open",
    "Assigned To User ID": trim(hazard.controlOwnerUserId),
    "Assigned To Name": trim(hazard.controlOwnerName),
    "Created By User ID": normalizeEmail(actor.email),
    "Created At": timestamp,
    "Updated At": timestamp,
    "Due Date": trim(hazard.controlDueDate),
    Comments: `Risk assessment control action for hazard ${hazard.hazardTitle}`,
    "Corrective Action": trim(hazard.additionalControls),
    "Risk Category": "Health & Safety",
    "Requires Manager Review": "false",
    "Sync Status": "Synced",
    "Sync Attempts": "0",
    "Schema Version": "1",
  };
  const appendTabRows = resolveAppendTabRows(deps);
  await appendTabRows(auth, deps, resolved.masterSheetId, ACTIONS_TAB, [row], { expectedHeaders: ACTIONS_TAB_COLUMNS });
  return { ok: true, actionId };
}

function validateAssessmentForSubmit(assessment, hazards) {
  if (!trim(assessment.title)) return "Title is required.";
  if (!trim(assessment.reviewDate)) return "Review date is required.";
  const activeHazards = hazards.filter((h) => !h.archivedAt);
  if (activeHazards.length === 0) return "At least one hazard is required.";
  for (const hazard of activeHazards) {
    if (!validateRiskValue(hazard.initialLikelihood) || !validateRiskValue(hazard.initialSeverity)) {
      return `Initial risk scores are required for hazard "${hazard.hazardTitle || hazard.id}".`;
    }
    if (!validateRiskValue(hazard.residualLikelihood) || !validateRiskValue(hazard.residualSeverity)) {
      return `Residual risk scores are required for hazard "${hazard.hazardTitle || hazard.id}".`;
    }
    if (hazard.actionRequired && !trim(hazard.controlOwnerName)) {
      return `Control owner is required for hazard "${hazard.hazardTitle || hazard.id}".`;
    }
  }
  return "";
}

export async function listCompanyRiskAssessments(auth, deps, resolved, actor, options = {}) {
  if (!actorCanAccessCompanyHealthSafety(actor, resolved.companyFolderId, resolved.alternateCompanyIds)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have access to this company.", 403);
  }
  await ensureRiskAssessmentTabs(auth, deps, resolved.masterSheetId);
  const [records, hazardRecords] = await Promise.all([
    readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS),
    readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS),
  ]);
  const hazardsByAssessment = new Map();
  for (const record of hazardRecords) {
    const hazard = mapRiskHazardRecord(record);
    if (!hazard.riskAssessmentId || hazard.archivedAt) continue;
    const bucket = hazardsByAssessment.get(hazard.riskAssessmentId) || [];
    bucket.push(hazard);
    hazardsByAssessment.set(hazard.riskAssessmentId, bucket);
  }
  const includeArchived = options.includeArchived === true;
  const items = records
    .map((record) => {
      const item = mapRiskAssessmentRecord(record);
      const hazards = hazardsByAssessment.get(item.id) || [];
      const summary = summariseAssessmentRisk(hazards);
      return {
        ...item,
        hazardCount: summary.hazardCount,
        highestResidualRiskScore: summary.highestResidualRiskScore,
        highestResidualBand: summary.highestResidualBand,
        highResidualCount: summary.highResidualCount,
        veryHighResidualCount: summary.veryHighResidualCount,
      };
    })
    .filter((item) => item.id && (includeArchived || !item.archivedAt));
  return { ok: true, items };
}

export async function getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId) {
  const listed = await listCompanyRiskAssessments(auth, deps, resolved, actor, { includeArchived: true });
  if (!listed.ok) return listed;
  const item = listed.items.find((entry) => entry.id === trim(riskAssessmentId));
  if (!item) return healthSafetyApiFailure("RISK_ASSESSMENT_NOT_FOUND", "Risk assessment not found.", 404);
  const [hazards, links, reviews] = await Promise.all([
    listRiskAssessmentHazards(auth, deps, resolved, actor, item.id, { includeArchived: true }),
    listRiskAssessmentLinks(auth, deps, resolved, actor, item.id, { includeArchived: true }),
    listRiskAssessmentReviews(auth, deps, resolved, actor, item.id),
  ]);
  if (!hazards.ok) return hazards;
  if (!links.ok) return links;
  if (!reviews.ok) return reviews;
  const summary = summariseAssessmentRisk(hazards.items);
  return {
    ok: true,
    item: {
      ...item,
      ...summary,
      highestResidualBand: summary.highestResidualBand,
      highestInitialBand: summary.highestInitialBand,
    },
    hazards: hazards.items,
    links: links.items,
    reviews: reviews.items,
  };
}

export async function createCompanyRiskAssessment(auth, deps, resolved, actor, input = {}) {
  if (!canCreateRiskAssessment(actor)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have permission to create risk assessments.", 403);
  }
  await ensureRiskAssessmentTabs(auth, deps, resolved.masterSheetId);
  const existing = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS);
  const assessmentNumber = nextAssessmentNumber(existing.map((row) => trim(row.AssessmentNumber)));
  const id = buildRiskAssessmentId();
  const timestamp = nowIso();
  const row = {
    RiskAssessmentId: id,
    CompanyFolderId: resolved.companyFolderId,
    AssessmentNumber: assessmentNumber,
    Title: trim(input.title) || "Untitled risk assessment",
    Description: trim(input.description),
    AssessmentType: trim(input.assessmentType) || "General",
    Activity: trim(input.activity),
    Department: trim(input.department),
    SiteId: trim(input.siteId),
    AreaId: trim(input.areaId),
    OwnerUserId: trim(input.ownerUserId),
    OwnerName: trim(input.ownerName),
    AssessorUserId: trim(input.assessorUserId) || normalizeEmail(actor.email),
    AssessorName: trim(input.assessorName) || trim(actor.name),
    AssessmentDate: trim(input.assessmentDate) || getUkTodayKey(),
    ReviewDate: trim(input.reviewDate),
    Status: "Draft",
    Version: "1.0",
    PeopleAtRisk: trim(input.peopleAtRisk),
    ExistingGeneralControls: trim(input.existingGeneralControls),
    EmergencyArrangements: trim(input.emergencyArrangements),
    PpeSummary: trim(input.ppeSummary),
    ApprovalRequired: "true",
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  };
  const appendTabRows = resolveAppendTabRows(deps);
  await appendTabRows(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, [row], {
    expectedHeaders: RISK_ASSESSMENTS_TAB_COLUMNS,
  });
  return getCompanyRiskAssessment(auth, deps, resolved, actor, id);
}

export async function patchCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const current = await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
  if (!current.ok) return current;
  if (!canEditRiskAssessment(actor, current.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have permission to edit this assessment.", 403);
  }
  const hazards = current.hazards || [];
  const riskFields = input.recalculateRisk === false ? {} : recalculateAssessmentRiskFields(hazards);
  const patch = rowToPatch(
    {
      Title: input.title ?? current.item.title,
      Description: input.description ?? current.item.description,
      AssessmentType: input.assessmentType ?? current.item.assessmentType,
      Activity: input.activity ?? current.item.activity,
      Department: input.department ?? current.item.department,
      SiteId: input.siteId ?? current.item.siteId,
      AreaId: input.areaId ?? current.item.areaId,
      OwnerUserId: input.ownerUserId ?? current.item.ownerUserId,
      OwnerName: input.ownerName ?? current.item.ownerName,
      AssessorUserId: input.assessorUserId ?? current.item.assessorUserId,
      AssessorName: input.assessorName ?? current.item.assessorName,
      AssessmentDate: input.assessmentDate ?? current.item.assessmentDate,
      ReviewDate: input.reviewDate ?? current.item.reviewDate,
      NextReviewReason: input.nextReviewReason ?? current.item.nextReviewReason,
      PeopleAtRisk: input.peopleAtRisk ?? current.item.peopleAtRisk,
      ExistingGeneralControls: input.existingGeneralControls ?? current.item.existingGeneralControls,
      EmergencyArrangements: input.emergencyArrangements ?? current.item.emergencyArrangements,
      PpeSummary: input.ppeSummary ?? current.item.ppeSummary,
      Status: input.status ?? current.item.status,
      ...riskFields,
      UpdatedAt: nowIso(),
      UpdatedBy: normalizeEmail(actor.email),
    },
    RISK_ASSESSMENTS_TAB_COLUMNS,
  );
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, patch);
  if (input.createActions === true) {
    for (const hazard of hazards) {
      if (hazard.actionRequired && !trim(hazard.linkedActionId)) {
        const actionResult = await createActionForHazard(auth, deps, resolved, actor, current.item, hazard);
        if (actionResult.actionId) {
          await patchRiskAssessmentHazard(auth, deps, resolved, actor, hazard.id, { linkedActionId: actionResult.actionId });
        }
      }
    }
  }
  return getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
}

export async function submitCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId) {
  const current = await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
  if (!current.ok) return current;
  if (!canSubmitRiskAssessment(actor, current.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot submit this assessment.", 403);
  }
  const validationError = validateAssessmentForSubmit(current.item, current.hazards || []);
  if (validationError) return healthSafetyApiFailure("RISK_ASSESSMENT_VALIDATION", validationError, 400);
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const timestamp = nowIso();
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
    Status: "Submitted",
    SubmittedAt: timestamp,
    SubmittedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
    ...recalculateAssessmentRiskFields(current.hazards),
  });
  for (const hazard of current.hazards || []) {
    if (hazard.actionRequired && !trim(hazard.linkedActionId)) {
      const actionResult = await createActionForHazard(auth, deps, resolved, actor, current.item, hazard);
      if (actionResult.actionId) {
        await patchRiskAssessmentHazard(auth, deps, resolved, actor, hazard.id, { linkedActionId: actionResult.actionId });
      }
    }
  }
  return getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
}

export async function approveCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const current = await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
  if (!current.ok) return current;
  if (!canApproveRiskAssessment(actor, current.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot approve this assessment.", 403);
  }
  if (!canSelfApproveRiskAssessment(actor, current.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot approve your own submission.", 403);
  }
  const timestamp = nowIso();
  const activateNow = input.activateNow !== false;
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
    Status: activateNow ? "Active" : "Approved",
    ApprovedAt: timestamp,
    ApprovedBy: normalizeEmail(actor.email),
    ActivatedAt: activateNow ? timestamp : "",
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  if (trim(current.item.previousVersionId) && activateNow) {
    await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", current.item.previousVersionId, {
      Status: "Superseded",
      SupersededAt: timestamp,
      UpdatedAt: timestamp,
      UpdatedBy: normalizeEmail(actor.email),
    });
  }
  return getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
}

export async function rejectCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const current = await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
  if (!current.ok) return current;
  if (!canRejectRiskAssessment(actor, current.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot reject this assessment.", 403);
  }
  const reason = trim(input.rejectionReason);
  if (!reason) return healthSafetyApiFailure("RISK_ASSESSMENT_VALIDATION", "Rejection reason is required.", 400);
  const timestamp = nowIso();
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
    Status: "Rejected",
    RejectedAt: timestamp,
    RejectedBy: normalizeEmail(actor.email),
    RejectionReason: reason,
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  return getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
}

export async function archiveCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId) {
  if (!canArchiveRiskAssessment(actor)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have permission to archive assessments.", 403);
  }
  const current = await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
  if (!current.ok) return current;
  const timestamp = nowIso();
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
    Status: "Archived",
    ArchivedAt: timestamp,
    ArchivedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  return getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
}

export async function restoreCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId) {
  if (!canArchiveRiskAssessment(actor)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have permission to restore assessments.", 403);
  }
  const current = await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
  if (!current.ok) return current;
  const timestamp = nowIso();
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
    Status: "Draft",
    ArchivedAt: "",
    ArchivedBy: "",
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  return getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
}

export async function reviewCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const current = await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
  if (!current.ok) return current;
  if (!canReviewRiskAssessment(actor, current.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot review this assessment.", 403);
  }
  const outcome = trim(input.outcome) || "no_change";
  if (!RISK_REVIEW_OUTCOMES.includes(outcome)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_VALIDATION", "Invalid review outcome.", 400);
  }
  const reviewType = trim(input.reviewType) || "manual";
  if (!RISK_REVIEW_TYPES.includes(reviewType)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_VALIDATION", "Invalid review type.", 400);
  }
  const timestamp = nowIso();
  const reviewRow = {
    ReviewId: buildRiskReviewId(),
    RiskAssessmentId: riskAssessmentId,
    CompanyFolderId: resolved.companyFolderId,
    ReviewDate: trim(input.reviewDate) || getUkTodayKey(),
    ReviewerUserId: normalizeEmail(actor.email),
    ReviewerName: trim(actor.name),
    ReviewType: reviewType,
    Outcome: outcome,
    ChangesRequired: trim(input.changesRequired),
    Summary: trim(input.summary),
    PreviousVersion: current.item.version,
    NewVersion: outcome === "major_update" ? bumpVersion(current.item.version, "major") : current.item.version,
    LinkedIncidentId: trim(input.linkedIncidentId),
    LinkedAuditId: trim(input.linkedAuditId),
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
  };
  const appendTabRows = resolveAppendTabRows(deps);
  await appendTabRows(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_REVIEWS_TAB, [reviewRow], {
    expectedHeaders: RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS,
  });
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  if (outcome === "no_change") {
    await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
      ReviewDate: trim(input.nextReviewDate) || current.item.reviewDate,
      Status: "Active",
      UpdatedAt: timestamp,
      UpdatedBy: normalizeEmail(actor.email),
    });
  } else if (outcome === "minor_update") {
    await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
      Version: bumpVersion(current.item.version, "minor"),
      ReviewDate: trim(input.nextReviewDate) || current.item.reviewDate,
      Status: "Active",
      UpdatedAt: timestamp,
      UpdatedBy: normalizeEmail(actor.email),
    });
  } else if (outcome === "major_update" || outcome === "superseded") {
    const versionResult = await createNewVersionCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId, {
      reviewType,
      linkedIncidentId: input.linkedIncidentId,
      linkedAuditId: input.linkedAuditId,
    });
    if (!versionResult.ok) return versionResult;
    return versionResult;
  } else if (outcome === "withdrawn") {
    await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
      Status: "Archived",
      ArchivedAt: timestamp,
      ArchivedBy: normalizeEmail(actor.email),
      UpdatedAt: timestamp,
      UpdatedBy: normalizeEmail(actor.email),
    });
  }
  return getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
}

export async function createNewVersionCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const current = await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
  if (!current.ok) return current;
  if (!canReviewRiskAssessment(actor, current.item) && !canEditRiskAssessment(actor, current.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot create a new version.", 403);
  }
  const newVersion = bumpVersion(current.item.version, "major");
  const created = await createCompanyRiskAssessment(auth, deps, resolved, actor, {
    title: current.item.title,
    description: current.item.description,
    assessmentType: current.item.assessmentType,
    activity: current.item.activity,
    department: current.item.department,
    siteId: current.item.siteId,
    areaId: current.item.areaId,
    ownerUserId: current.item.ownerUserId,
    ownerName: current.item.ownerName,
    assessorUserId: current.item.assessorUserId,
    assessorName: current.item.assessorName,
    assessmentDate: getUkTodayKey(),
    reviewDate: current.item.reviewDate,
    peopleAtRisk: current.item.peopleAtRisk,
    existingGeneralControls: current.item.existingGeneralControls,
    emergencyArrangements: current.item.emergencyArrangements,
    ppeSummary: current.item.ppeSummary,
  });
  if (!created.ok) return created;
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", created.item.id, {
    Version: newVersion,
    PreviousVersionId: current.item.id,
    Status: "Draft",
    UpdatedAt: nowIso(),
    UpdatedBy: normalizeEmail(actor.email),
  });
  for (const hazard of current.hazards || []) {
    await createRiskAssessmentHazard(auth, deps, resolved, actor, created.item.id, hazard);
  }
  for (const link of current.links || []) {
    await createRiskAssessmentLink(auth, deps, resolved, actor, created.item.id, link);
  }
  return getCompanyRiskAssessment(auth, deps, resolved, actor, created.item.id);
}

export async function listRiskAssessmentHazards(auth, deps, resolved, actor, riskAssessmentId, options = {}) {
  if (!actorCanAccessCompanyHealthSafety(actor, resolved.companyFolderId, resolved.alternateCompanyIds)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have access to this company.", 403);
  }
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS);
  const includeArchived = options.includeArchived === true;
  const items = records
    .map((record) => mapRiskHazardRecord(record))
    .filter(
      (item) =>
        item.id &&
        item.riskAssessmentId === trim(riskAssessmentId) &&
        (includeArchived || !item.archivedAt),
    )
    .sort((left, right) => left.sortOrder - right.sortOrder || left.hazardTitle.localeCompare(right.hazardTitle));
  return { ok: true, items };
}

export async function createRiskAssessmentHazard(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const current = await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
  if (!current.ok) return current;
  if (!canEditRiskAssessment(actor, current.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot add hazards to this assessment.", 403);
  }
  const initialLikelihood = Number(input.initialLikelihood) || 0;
  const initialSeverity = Number(input.initialSeverity) || 0;
  const residualLikelihood = Number(input.residualLikelihood) || 0;
  const residualSeverity = Number(input.residualSeverity) || 0;
  const id = buildRiskHazardId();
  const timestamp = nowIso();
  const row = {
    HazardId: id,
    RiskAssessmentId: trim(riskAssessmentId),
    CompanyFolderId: resolved.companyFolderId,
    HazardType: trim(input.hazardType),
    HazardTitle: trim(input.hazardTitle) || trim(input.hazardType) || "Hazard",
    HazardDescription: trim(input.hazardDescription),
    WhoMightBeHarmed: trim(input.whoMightBeHarmed),
    HowMightTheyBeHarmed: trim(input.howMightTheyBeHarmed),
    ExistingControls: trim(input.existingControls),
    InitialLikelihood: String(initialLikelihood || ""),
    InitialSeverity: String(initialSeverity || ""),
    InitialRiskScore: String(calculateRiskScore(initialLikelihood, initialSeverity)),
    AdditionalControls: trim(input.additionalControls),
    ResidualLikelihood: String(residualLikelihood || ""),
    ResidualSeverity: String(residualSeverity || ""),
    ResidualRiskScore: String(calculateRiskScore(residualLikelihood, residualSeverity)),
    ControlOwnerUserId: trim(input.controlOwnerUserId),
    ControlOwnerName: trim(input.controlOwnerName),
    ControlDueDate: trim(input.controlDueDate),
    ActionRequired: String(Boolean(input.actionRequired)),
    LinkedActionId: trim(input.linkedActionId),
    SortOrder: String(Number(input.sortOrder) || (current.hazards?.length || 0) + 1),
    Status: "active",
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  };
  const appendTabRows = resolveAppendTabRows(deps);
  await appendTabRows(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, [row], {
    expectedHeaders: RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS,
  });
  await patchCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId, { recalculateRisk: true });
  const hazards = await listRiskAssessmentHazards(auth, deps, resolved, actor, riskAssessmentId, { includeArchived: true });
  const item = hazards.items.find((entry) => entry.id === id);
  return { ok: true, item };
}

export async function patchRiskAssessmentHazard(auth, deps, resolved, actor, hazardId, input = {}) {
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS);
  const found = records.find((record) => trim(record.HazardId) === trim(hazardId));
  if (!found) return healthSafetyApiFailure("RISK_HAZARD_NOT_FOUND", "Hazard not found.", 404);
  const current = mapRiskHazardRecord(found);
  const assessment = await getCompanyRiskAssessment(auth, deps, resolved, actor, current.riskAssessmentId);
  if (!assessment.ok) return assessment;
  if (!canEditRiskAssessment(actor, assessment.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot edit this hazard.", 403);
  }
  const initialLikelihood = input.initialLikelihood ?? current.initialLikelihood;
  const initialSeverity = input.initialSeverity ?? current.initialSeverity;
  const residualLikelihood = input.residualLikelihood ?? current.residualLikelihood;
  const residualSeverity = input.residualSeverity ?? current.residualSeverity;
  const patch = rowToPatch(
    {
      HazardType: input.hazardType ?? current.hazardType,
      HazardTitle: input.hazardTitle ?? current.hazardTitle,
      HazardDescription: input.hazardDescription ?? current.hazardDescription,
      WhoMightBeHarmed: input.whoMightBeHarmed ?? current.whoMightBeHarmed,
      HowMightTheyBeHarmed: input.howMightTheyBeHarmed ?? current.howMightTheyBeHarmed,
      ExistingControls: input.existingControls ?? current.existingControls,
      InitialLikelihood: String(initialLikelihood || ""),
      InitialSeverity: String(initialSeverity || ""),
      InitialRiskScore: String(calculateRiskScore(initialLikelihood, initialSeverity)),
      AdditionalControls: input.additionalControls ?? current.additionalControls,
      ResidualLikelihood: String(residualLikelihood || ""),
      ResidualSeverity: String(residualSeverity || ""),
      ResidualRiskScore: String(calculateRiskScore(residualLikelihood, residualSeverity)),
      ControlOwnerUserId: input.controlOwnerUserId ?? current.controlOwnerUserId,
      ControlOwnerName: input.controlOwnerName ?? current.controlOwnerName,
      ControlDueDate: input.controlDueDate ?? current.controlDueDate,
      ActionRequired: String(input.actionRequired ?? current.actionRequired),
      LinkedActionId: input.linkedActionId ?? current.linkedActionId,
      SortOrder: String(input.sortOrder ?? current.sortOrder),
      UpdatedAt: nowIso(),
      UpdatedBy: normalizeEmail(actor.email),
    },
    RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS,
  );
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, "HazardId", hazardId, patch);
  await patchCompanyRiskAssessment(auth, deps, resolved, actor, current.riskAssessmentId, { recalculateRisk: true });
  const hazards = await listRiskAssessmentHazards(auth, deps, resolved, actor, current.riskAssessmentId, { includeArchived: true });
  const item = hazards.items.find((entry) => entry.id === hazardId);
  return { ok: true, item };
}

export async function archiveRiskAssessmentHazard(auth, deps, resolved, actor, hazardId) {
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS);
  const found = records.find((record) => trim(record.HazardId) === trim(hazardId));
  if (!found) return healthSafetyApiFailure("RISK_HAZARD_NOT_FOUND", "Hazard not found.", 404);
  const current = mapRiskHazardRecord(found);
  const assessment = await getCompanyRiskAssessment(auth, deps, resolved, actor, current.riskAssessmentId);
  if (!assessment.ok) return assessment;
  if (!canEditRiskAssessment(actor, assessment.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot archive this hazard.", 403);
  }
  const timestamp = nowIso();
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, "HazardId", hazardId, {
    Status: "archived",
    ArchivedAt: timestamp,
    ArchivedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  await patchCompanyRiskAssessment(auth, deps, resolved, actor, current.riskAssessmentId, { recalculateRisk: true });
  return { ok: true };
}

export async function listRiskAssessmentLinks(auth, deps, resolved, actor, riskAssessmentId, options = {}) {
  if (!actorCanAccessCompanyHealthSafety(actor, resolved.companyFolderId, resolved.alternateCompanyIds)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have access to this company.", 403);
  }
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_LINKS_TAB, RISK_ASSESSMENT_LINKS_TAB_COLUMNS);
  const includeArchived = options.includeArchived === true;
  const items = records
    .map((record) => mapRiskLinkRecord(record))
    .filter(
      (item) =>
        item.id &&
        item.riskAssessmentId === trim(riskAssessmentId) &&
        (includeArchived || !item.archivedAt),
    );
  return { ok: true, items };
}

export async function createRiskAssessmentLink(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const current = await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId);
  if (!current.ok) return current;
  if (!canEditRiskAssessment(actor, current.item) && !canReviewRiskAssessment(actor, current.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot link records to this assessment.", 403);
  }
  const linkedRecordType = trim(input.linkedRecordType).toLowerCase();
  const linkedRecordId = trim(input.linkedRecordId);
  if (!RISK_LINKED_RECORD_TYPES.includes(linkedRecordType) || !linkedRecordId) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_VALIDATION", "Valid linked record type and ID are required.", 400);
  }
  const relationshipType = trim(input.relationshipType) || "applies_to";
  if (!RISK_LINK_RELATIONSHIP_TYPES.includes(relationshipType)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_VALIDATION", "Invalid relationship type.", 400);
  }
  const duplicate = (current.links || []).find(
    (link) =>
      !link.archivedAt &&
      link.linkedRecordType === linkedRecordType &&
      link.linkedRecordId === linkedRecordId &&
      link.relationshipType === relationshipType,
  );
  if (duplicate) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_DUPLICATE_LINK", "This link already exists.", 409);
  }
  const id = buildRiskLinkId();
  const timestamp = nowIso();
  const row = {
    LinkId: id,
    RiskAssessmentId: trim(riskAssessmentId),
    CompanyFolderId: resolved.companyFolderId,
    LinkedRecordType: linkedRecordType,
    LinkedRecordId: linkedRecordId,
    LinkedRecordTitle: trim(input.linkedRecordTitle),
    RelationshipType: relationshipType,
    Notes: trim(input.notes),
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
  };
  const appendTabRows = resolveAppendTabRows(deps);
  await appendTabRows(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_LINKS_TAB, [row], {
    expectedHeaders: RISK_ASSESSMENT_LINKS_TAB_COLUMNS,
  });
  const links = await listRiskAssessmentLinks(auth, deps, resolved, actor, riskAssessmentId, { includeArchived: true });
  const item = links.items.find((entry) => entry.id === id);
  return { ok: true, item };
}

export async function archiveRiskAssessmentLink(auth, deps, resolved, actor, linkId) {
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_LINKS_TAB, RISK_ASSESSMENT_LINKS_TAB_COLUMNS);
  const found = records.find((record) => trim(record.LinkId) === trim(linkId));
  if (!found) return healthSafetyApiFailure("RISK_LINK_NOT_FOUND", "Link not found.", 404);
  const current = mapRiskLinkRecord(found);
  const assessment = await getCompanyRiskAssessment(auth, deps, resolved, actor, current.riskAssessmentId);
  if (!assessment.ok) return assessment;
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_LINKS_TAB, "LinkId", linkId, {
    ArchivedAt: nowIso(),
    ArchivedBy: normalizeEmail(actor.email),
  });
  return { ok: true };
}

export async function listRiskAssessmentReviews(auth, deps, resolved, actor, riskAssessmentId) {
  if (!actorCanAccessCompanyHealthSafety(actor, resolved.companyFolderId, resolved.alternateCompanyIds)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have access to this company.", 403);
  }
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_REVIEWS_TAB, RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS);
  const items = records
    .map((record) => mapRiskReviewRecord(record))
    .filter((item) => item.id && item.riskAssessmentId === trim(riskAssessmentId))
    .sort((left, right) => trim(right.createdAt).localeCompare(trim(left.createdAt)));
  return { ok: true, items };
}

export { resolveCompanyScheduleContext, RISK_ASSESSMENT_REQUIRED_TABS };
