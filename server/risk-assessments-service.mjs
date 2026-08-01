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
  validateRiskAssessmentForSubmit,
  dedupeHazardsById,
} from "../shared/risk-assessments.mjs";
import {
  isVerificationAssessmentNumber,
  isVerificationRiskAssessment,
  isVerificationRiskAssessmentId,
  isActiveVerificationRiskAssessment,
  PRODUCTION_VERIFICATION_RA_CLEANED_STATUS,
} from "../shared/production-verification-risk-assessment.mjs";
import { cleanupVerificationAction } from "./actions-service.mjs";
import { isCompanyInviteActor, isGodmodeInviteSession } from "../shared/company-invite-permissions.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import { actorCanAccessCompanyHealthSafety, healthSafetyApiFailure } from "./health-safety-service.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  batchPatchTabRowsByHeader as workbookBatchPatchTabRowsByHeader,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

export const RISK_ASSESSMENT_ROUTE_TIMEOUT_MS = 90_000;

const STAGE_BUDGET_MS = {
  "ensure-tabs": 5_000,
  "patch-assessment": 10_000,
  "read-hazards": 10_000,
  "append-hazards": 15_000,
  "patch-hazards": 15_000,
  "patch-assessment-risk": 10_000,
  complete: 30_000,
};

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

const ensuredRiskAssessmentWorkbooks = new Set();
const ensuringRiskAssessmentWorkbooks = new Map();

function trim(value) {
  return String(value ?? "").trim();
}

function createRiskAssessmentTiming(operation, context = {}) {
  const startedAt = Date.now();
  let lastStageAt = startedAt;
  const base = {
    operation,
    assessmentId: trim(context.assessmentId) || undefined,
    companyFolderId: trim(context.companyFolderId) || undefined,
    workbookId: trim(context.workbookId) || undefined,
  };
  return {
    log(stage, extra = {}) {
      const now = Date.now();
      const stageDurationMs = now - lastStageAt;
      const totalMs = now - startedAt;
      lastStageAt = now;
      const entry = {
        ...base,
        stage,
        durationMs: stageDurationMs,
        totalMs,
        ...extra,
      };
      console.info("[risk-assessment:timing]", JSON.stringify(entry));
      const budget = STAGE_BUDGET_MS[stage];
      if (budget && stageDurationMs > budget) {
        console.warn(
          "[risk-assessment:slow-stage]",
          JSON.stringify({
            operation: base.operation,
            stage,
            durationMs: stageDurationMs,
            budgetMs: budget,
            totalMs,
            rowCount: extra.rowCount ?? extra.appended ?? extra.patched ?? undefined,
            companyFolderId: base.companyFolderId,
            workbookId: base.workbookId,
          }),
        );
      }
    },
    startedAt,
  };
}

function riskAssessmentValidationFailure(validation) {
  return {
    ok: false,
    code: "risk_assessment_validation_failed",
    error: validation.message || "The risk assessment cannot be submitted.",
    message: validation.message || "The risk assessment cannot be submitted.",
    fieldErrors: validation.fieldErrors || [],
    httpStatus: 400,
  };
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

function resolveBatchPatchTabRowsByHeader(deps) {
  return typeof deps?.batchPatchTabRowsByHeader === "function"
    ? deps.batchPatchTabRowsByHeader
    : workbookBatchPatchTabRowsByHeader;
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
  const sheetId = trim(masterSheetId);
  if (!sheetId) return;
  if (ensuredRiskAssessmentWorkbooks.has(sheetId)) return;

  let inFlight = ensuringRiskAssessmentWorkbooks.get(sheetId);
  if (!inFlight) {
    inFlight = (async () => {
      const ensureTabColumns = resolveEnsureTabColumns(deps);
      const tabMap = [
        [RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS],
        [RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS],
        [RISK_ASSESSMENT_LINKS_TAB, RISK_ASSESSMENT_LINKS_TAB_COLUMNS],
        [RISK_ASSESSMENT_REVIEWS_TAB, RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS],
      ];
      await Promise.all(tabMap.map(([tab, columns]) => ensureTabColumns(auth, deps, sheetId, tab, columns)));
      ensuredRiskAssessmentWorkbooks.add(sheetId);
    })().finally(() => {
      ensuringRiskAssessmentWorkbooks.delete(sheetId);
    });
    ensuringRiskAssessmentWorkbooks.set(sheetId, inFlight);
  }
  await inFlight;
}

function buildHazardRow(riskAssessmentId, resolved, actor, input = {}, sortOrder = 1) {
  const id = trim(input.id) || trim(input.hazardId) || buildRiskHazardId();
  const initialLikelihood = Number(input.initialLikelihood) || 0;
  const initialSeverity = Number(input.initialSeverity) || 0;
  const residualLikelihood = Number(input.residualLikelihood) || 0;
  const residualSeverity = Number(input.residualSeverity) || 0;
  const timestamp = nowIso();
  return {
    row: {
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
      SortOrder: String(Number(input.sortOrder) || sortOrder),
      Status: "active",
      CreatedAt: timestamp,
      CreatedBy: normalizeEmail(actor.email),
      UpdatedAt: timestamp,
      UpdatedBy: normalizeEmail(actor.email),
    },
    id,
    mapped: mapRiskHazardRecord({
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
      SortOrder: String(Number(input.sortOrder) || sortOrder),
      Status: "active",
      CreatedAt: timestamp,
      CreatedBy: normalizeEmail(actor.email),
      UpdatedAt: timestamp,
      UpdatedBy: normalizeEmail(actor.email),
    }),
  };
}

async function readAssessmentRecord(auth, deps, masterSheetId, riskAssessmentId) {
  await ensureRiskAssessmentTabs(auth, deps, masterSheetId);
  const records = await readTab(auth, deps, masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS);
  const found = records.find((record) => trim(record.RiskAssessmentId) === trim(riskAssessmentId));
  return found ? mapRiskAssessmentRecord(found) : null;
}

async function buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId, options = {}) {
  const timer = options.timer || createRiskAssessmentTiming("build-detail", {
    assessmentId: riskAssessmentId,
    companyFolderId: resolved.companyFolderId,
  });
  if (!actorCanAccessCompanyHealthSafety(actor, resolved.companyFolderId, resolved.alternateCompanyIds)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have access to this company.", 403);
  }
  timer.log("auth");
  await ensureRiskAssessmentTabs(auth, deps, resolved.masterSheetId);
  timer.log("ensure-tabs");
  const [assessmentRecords, hazardRecords, linkRecords, reviewRecords] = await Promise.all([
    readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS),
    readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS),
    readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_LINKS_TAB, RISK_ASSESSMENT_LINKS_TAB_COLUMNS),
    readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_REVIEWS_TAB, RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS),
  ]);
  timer.log("read-tabs");
  const item = assessmentRecords.map((record) => mapRiskAssessmentRecord(record)).find((entry) => entry.id === trim(riskAssessmentId));
  if (!item) return healthSafetyApiFailure("RISK_ASSESSMENT_NOT_FOUND", "Risk assessment not found.", 404);
  const hazards = dedupeHazardsById(
    hazardRecords
      .map((record) => mapRiskHazardRecord(record))
      .filter((hazard) => hazard.riskAssessmentId === trim(riskAssessmentId) && !hazard.archivedAt),
  ).sort((left, right) => left.sortOrder - right.sortOrder || left.hazardTitle.localeCompare(right.hazardTitle));
  const links = linkRecords
    .map((record) => mapRiskLinkRecord(record))
    .filter((link) => link.riskAssessmentId === trim(riskAssessmentId) && !link.archivedAt);
  const reviews = reviewRecords
    .map((record) => mapRiskReviewRecord(record))
    .filter((review) => review.riskAssessmentId === trim(riskAssessmentId))
    .sort((left, right) => trim(right.createdAt).localeCompare(trim(left.createdAt)));
  const summary = summariseAssessmentRisk(hazards);
  timer.log("assemble");
  return {
    ok: true,
    item: {
      ...item,
      ...summary,
      highestResidualBand: summary.highestResidualBand,
      highestInitialBand: summary.highestInitialBand,
    },
    hazards,
    links,
    reviews,
  };
}

async function syncRiskAssessmentHazards(auth, deps, resolved, actor, riskAssessmentId, hazardInputs = [], options = {}) {
  const timer = options.timer || createRiskAssessmentTiming("sync-hazards", {
    assessmentId: riskAssessmentId,
    companyFolderId: resolved.companyFolderId,
    workbookId: resolved.masterSheetId,
  });
  const assessment = await readAssessmentRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  if (!assessment) return healthSafetyApiFailure("RISK_ASSESSMENT_NOT_FOUND", "Risk assessment not found.", 404);
  if (!canEditRiskAssessment(actor, assessment)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot edit hazards on this assessment.", 403);
  }
  timer.log("read-assessment");
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS);
  timer.log("read-hazards", { rowCount: records.length });

  const existingById = new Map();
  const duplicateArchivePatches = [];
  for (const record of records) {
    const hazard = mapRiskHazardRecord(record);
    if (hazard.riskAssessmentId !== trim(riskAssessmentId) || hazard.archivedAt) continue;
    const prior = existingById.get(hazard.id);
    if (!prior) {
      existingById.set(hazard.id, hazard);
      continue;
    }
    const priorUpdated = trim(prior.updatedAt);
    const nextUpdated = trim(hazard.updatedAt);
    if (nextUpdated >= priorUpdated) {
      duplicateArchivePatches.push({
        matchValue: prior.id,
        updates: {
          Status: "archived",
          ArchivedAt: nowIso(),
          ArchivedBy: normalizeEmail(actor.email),
          UpdatedAt: nowIso(),
          UpdatedBy: normalizeEmail(actor.email),
        },
      });
      existingById.set(hazard.id, hazard);
    } else {
      duplicateArchivePatches.push({
        matchValue: hazard.id,
        updates: {
          Status: "archived",
          ArchivedAt: nowIso(),
          ArchivedBy: normalizeEmail(actor.email),
          UpdatedAt: nowIso(),
          UpdatedBy: normalizeEmail(actor.email),
        },
      });
    }
  }

  const inputIds = new Set();
  const rowsToAppend = [];
  const mappedResults = [];
  const patchRows = [...duplicateArchivePatches];
  const batchPatchTabRowsByHeader = resolveBatchPatchTabRowsByHeader(deps);
  const appendTabRows = resolveAppendTabRows(deps);

  hazardInputs.forEach((input, index) => {
    const hazardId = trim(input.id) || trim(input.hazardId);
    if (hazardId) inputIds.add(hazardId);
    const existing = hazardId ? existingById.get(hazardId) : null;
    const initialLikelihood = Number(input.initialLikelihood ?? existing?.initialLikelihood) || 0;
    const initialSeverity = Number(input.initialSeverity ?? existing?.initialSeverity) || 0;
    const residualLikelihood = Number(input.residualLikelihood ?? existing?.residualLikelihood) || 0;
    const residualSeverity = Number(input.residualSeverity ?? existing?.residualSeverity) || 0;
    const mapped = mapRiskHazardRecord({
      HazardId: hazardId || buildRiskHazardId(),
      RiskAssessmentId: trim(riskAssessmentId),
      CompanyFolderId: resolved.companyFolderId,
      HazardType: trim(input.hazardType ?? existing?.hazardType),
      HazardTitle: trim(input.hazardTitle ?? existing?.hazardType) || trim(input.hazardType) || "Hazard",
      HazardDescription: trim(input.hazardDescription ?? existing?.hazardDescription),
      WhoMightBeHarmed: trim(input.whoMightBeHarmed ?? existing?.whoMightBeHarmed),
      HowMightTheyBeHarmed: trim(input.howMightTheyBeHarmed ?? existing?.howMightTheyBeHarmed),
      ExistingControls: trim(input.existingControls ?? existing?.existingControls),
      InitialLikelihood: String(initialLikelihood || ""),
      InitialSeverity: String(initialSeverity || ""),
      InitialRiskScore: String(calculateRiskScore(initialLikelihood, initialSeverity)),
      AdditionalControls: trim(input.additionalControls ?? existing?.additionalControls),
      ResidualLikelihood: String(residualLikelihood || ""),
      ResidualSeverity: String(residualSeverity || ""),
      ResidualRiskScore: String(calculateRiskScore(residualLikelihood, residualSeverity)),
      ControlOwnerUserId: trim(input.controlOwnerUserId ?? existing?.controlOwnerUserId),
      ControlOwnerName: trim(input.controlOwnerName ?? existing?.controlOwnerName),
      ControlDueDate: trim(input.controlDueDate ?? existing?.controlDueDate),
      ActionRequired: String(Boolean(input.actionRequired ?? existing?.actionRequired)),
      LinkedActionId: trim(input.linkedActionId ?? existing?.linkedActionId),
      SortOrder: String(Number(input.sortOrder ?? existing?.sortOrder) || index + 1),
      Status: "active",
      CreatedAt: existing?.createdAt || nowIso(),
      CreatedBy: existing?.createdBy || normalizeEmail(actor.email),
      UpdatedAt: nowIso(),
      UpdatedBy: normalizeEmail(actor.email),
    });
    mappedResults.push(mapped);
    inputIds.add(mapped.id);

    if (existing) {
      patchRows.push({
        matchValue: mapped.id,
        updates: {
          HazardType: mapped.hazardType,
          HazardTitle: mapped.hazardTitle,
          HazardDescription: mapped.hazardDescription,
          WhoMightBeHarmed: mapped.whoMightBeHarmed,
          HowMightTheyBeHarmed: mapped.howMightTheyBeHarmed,
          ExistingControls: mapped.existingControls,
          InitialLikelihood: String(mapped.initialLikelihood || ""),
          InitialSeverity: String(mapped.initialSeverity || ""),
          InitialRiskScore: String(mapped.initialRiskScore || ""),
          AdditionalControls: mapped.additionalControls,
          ResidualLikelihood: String(mapped.residualLikelihood || ""),
          ResidualSeverity: String(mapped.residualSeverity || ""),
          ResidualRiskScore: String(mapped.residualRiskScore || ""),
          ControlOwnerUserId: mapped.controlOwnerUserId,
          ControlOwnerName: mapped.controlOwnerName,
          ControlDueDate: mapped.controlDueDate,
          ActionRequired: String(Boolean(mapped.actionRequired)),
          LinkedActionId: mapped.linkedActionId,
          SortOrder: String(mapped.sortOrder || index + 1),
          UpdatedAt: mapped.updatedAt,
          UpdatedBy: mapped.updatedBy,
        },
      });
      return;
    }

    rowsToAppend.push({
      HazardId: mapped.id,
      RiskAssessmentId: trim(riskAssessmentId),
      CompanyFolderId: resolved.companyFolderId,
      HazardType: mapped.hazardType,
      HazardTitle: mapped.hazardTitle,
      HazardDescription: mapped.hazardDescription,
      WhoMightBeHarmed: mapped.whoMightBeHarmed,
      HowMightTheyBeHarmed: mapped.howMightTheyBeHarmed,
      ExistingControls: mapped.existingControls,
      InitialLikelihood: String(mapped.initialLikelihood || ""),
      InitialSeverity: String(mapped.initialSeverity || ""),
      InitialRiskScore: String(mapped.initialRiskScore || ""),
      AdditionalControls: mapped.additionalControls,
      ResidualLikelihood: String(mapped.residualLikelihood || ""),
      ResidualSeverity: String(mapped.residualSeverity || ""),
      ResidualRiskScore: String(mapped.residualRiskScore || ""),
      ControlOwnerUserId: mapped.controlOwnerUserId,
      ControlOwnerName: mapped.controlOwnerName,
      ControlDueDate: mapped.controlDueDate,
      ActionRequired: String(Boolean(mapped.actionRequired)),
      LinkedActionId: mapped.linkedActionId,
      SortOrder: String(mapped.sortOrder || index + 1),
      Status: "active",
      CreatedAt: mapped.createdAt,
      CreatedBy: mapped.createdBy,
      UpdatedAt: mapped.updatedAt,
      UpdatedBy: mapped.updatedBy,
    });
  });

  if (rowsToAppend.length > 0) {
    await appendTabRows(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, rowsToAppend, {
      expectedHeaders: RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS,
    });
  }
  timer.log("append-hazards", { appended: rowsToAppend.length, rowCount: hazardInputs.length });

  for (const [hazardId] of existingById.entries()) {
    if (inputIds.has(hazardId)) continue;
    patchRows.push({
      matchValue: hazardId,
      updates: {
        Status: "archived",
        ArchivedAt: nowIso(),
        ArchivedBy: normalizeEmail(actor.email),
        UpdatedAt: nowIso(),
        UpdatedBy: normalizeEmail(actor.email),
      },
    });
  }

  if (patchRows.length > 0) {
    await batchPatchTabRowsByHeader(
      auth,
      deps,
      resolved.masterSheetId,
      RISK_ASSESSMENT_HAZARDS_TAB,
      "HazardId",
      patchRows,
    );
  }
  timer.log("patch-hazards", { patched: patchRows.length, rowCount: hazardInputs.length });

  const dedupedHazards = dedupeHazardsById(mappedResults);
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
    ...recalculateAssessmentRiskFields(dedupedHazards),
    UpdatedAt: nowIso(),
    UpdatedBy: normalizeEmail(actor.email),
  });
  timer.log("patch-assessment-risk", { rowCount: dedupedHazards.length });
  return { ok: true, hazards: dedupedHazards, summary: summariseAssessmentRisk(dedupedHazards) };
}

function buildDraftSaveResponse(assessment, hazards = [], links = []) {
  const summary = summariseAssessmentRisk(hazards);
  return {
    ok: true,
    item: {
      ...assessment,
      ...summary,
      highestResidualBand: summary.highestResidualBand,
      highestInitialBand: summary.highestInitialBand,
    },
    hazards: dedupeHazardsById(hazards),
    links: links || [],
    reviews: [],
    savedAt: nowIso(),
  };
}

async function patchAssessmentFieldsOnly(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const assessment = await readAssessmentRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  if (!assessment) return healthSafetyApiFailure("RISK_ASSESSMENT_NOT_FOUND", "Risk assessment not found.", 404);
  if (!canEditRiskAssessment(actor, assessment)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have permission to edit this assessment.", 403);
  }
  const patch = rowToPatch(
    {
      Title: input.title ?? assessment.title,
      Description: input.description ?? assessment.description,
      AssessmentType: input.assessmentType ?? assessment.assessmentType,
      Activity: input.activity ?? assessment.activity,
      Department: input.department ?? assessment.department,
      SiteId: input.siteId ?? assessment.siteId,
      AreaId: input.areaId ?? assessment.areaId,
      OwnerUserId: input.ownerUserId ?? assessment.ownerUserId,
      OwnerName: input.ownerName ?? assessment.ownerName,
      AssessorUserId: input.assessorUserId ?? assessment.assessorUserId,
      AssessorName: input.assessorName ?? assessment.assessorName,
      AssessmentDate: input.assessmentDate ?? assessment.assessmentDate,
      ReviewDate: input.reviewDate ?? assessment.reviewDate,
      NextReviewReason: input.nextReviewReason ?? assessment.nextReviewReason,
      PeopleAtRisk: input.peopleAtRisk ?? assessment.peopleAtRisk,
      ExistingGeneralControls: input.existingGeneralControls ?? assessment.existingGeneralControls,
      EmergencyArrangements: input.emergencyArrangements ?? assessment.emergencyArrangements,
      PpeSummary: input.ppeSummary ?? assessment.ppeSummary,
      Status: input.status ?? assessment.status,
      UpdatedAt: nowIso(),
      UpdatedBy: normalizeEmail(actor.email),
    },
    RISK_ASSESSMENTS_TAB_COLUMNS,
  );
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, patch);
  const updated = {
    ...assessment,
    title: patch.Title ?? assessment.title,
    description: patch.Description ?? assessment.description,
    assessmentType: patch.AssessmentType ?? assessment.assessmentType,
    activity: patch.Activity ?? assessment.activity,
    department: patch.Department ?? assessment.department,
    siteId: patch.SiteId ?? assessment.siteId,
    areaId: patch.AreaId ?? assessment.areaId,
    ownerUserId: patch.OwnerUserId ?? assessment.ownerUserId,
    ownerName: patch.OwnerName ?? assessment.ownerName,
    assessorUserId: patch.AssessorUserId ?? assessment.assessorUserId,
    assessorName: patch.AssessorName ?? assessment.assessorName,
    assessmentDate: patch.AssessmentDate ?? assessment.assessmentDate,
    reviewDate: patch.ReviewDate ?? assessment.reviewDate,
    nextReviewReason: patch.NextReviewReason ?? assessment.nextReviewReason,
    peopleAtRisk: patch.PeopleAtRisk ?? assessment.peopleAtRisk,
    existingGeneralControls: patch.ExistingGeneralControls ?? assessment.existingGeneralControls,
    emergencyArrangements: patch.EmergencyArrangements ?? assessment.emergencyArrangements,
    ppeSummary: patch.PpeSummary ?? assessment.ppeSummary,
    status: patch.Status ?? assessment.status,
    updatedAt: patch.UpdatedAt,
    updatedBy: patch.UpdatedBy,
  };
  return { ok: true, item: updated };
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
  return validateRiskAssessmentForSubmit(assessment, hazards, { todayKey: getUkTodayKey() });
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
  return buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId);
}

export async function createCompanyRiskAssessment(auth, deps, resolved, actor, input = {}) {
  const timer = createRiskAssessmentTiming("create", { companyFolderId: resolved.companyFolderId });
  if (!canCreateRiskAssessment(actor)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have permission to create risk assessments.", 403);
  }
  await ensureRiskAssessmentTabs(auth, deps, resolved.masterSheetId);
  timer.log("ensure-tabs");
  const existing = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS);
  timer.log("read-assessments");
  const requestedId = trim(input.riskAssessmentId) || trim(input.id);
  const requestedNumber = trim(input.assessmentNumber);
  const existingMatch = requestedId
    ? existing.find((row) => trim(row.RiskAssessmentId) === requestedId)
    : null;
  if (existingMatch) {
    const mapped = mapRiskAssessmentRecord(existingMatch);
    if (isVerificationRiskAssessment(mapped)) {
      timer.log("existing-verification");
      return buildDraftSaveResponse(mapped, []);
    }
    return healthSafetyApiFailure(
      "RISK_ASSESSMENT_EXISTS",
      "A risk assessment with this ID already exists.",
      409,
    );
  }
  const assessmentNumber = isVerificationAssessmentNumber(requestedNumber)
    ? requestedNumber
    : nextAssessmentNumber(existing.map((row) => trim(row.AssessmentNumber)));
  const id = isVerificationRiskAssessmentId(requestedId) ? requestedId : buildRiskAssessmentId();
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
    NextReviewReason: trim(input.nextReviewReason),
    Status: "Draft",
    Version: trim(input.version) || "1.0",
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
  timer.log("append-assessment");
  let syncedHazards = [];
  if (Array.isArray(input.hazards) && input.hazards.length > 0) {
    const synced = await syncRiskAssessmentHazards(auth, deps, resolved, actor, id, input.hazards, { timer });
    if (!synced.ok) return synced;
    syncedHazards = synced.hazards || [];
  }
  timer.log("complete");
  return buildDraftSaveResponse(mapRiskAssessmentRecord(row), syncedHazards);
}

export async function saveCompanyRiskAssessmentDraft(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const timer = createRiskAssessmentTiming("save-draft", {
    assessmentId: riskAssessmentId,
    companyFolderId: resolved.companyFolderId,
    workbookId: resolved.masterSheetId,
  });
  const id = trim(riskAssessmentId);
  if (!id) {
    return createCompanyRiskAssessment(auth, deps, resolved, actor, input);
  }
  const patched = await patchAssessmentFieldsOnly(auth, deps, resolved, actor, id, input);
  if (!patched.ok) return patched;
  timer.log("patch-assessment");
  let syncedHazards = patched.hazards || [];
  if (Array.isArray(input.hazards)) {
    const synced = await syncRiskAssessmentHazards(auth, deps, resolved, actor, id, input.hazards, { timer });
    if (!synced.ok) return synced;
    syncedHazards = synced.hazards || [];
  }
  timer.log("complete");
  return buildDraftSaveResponse(patched.item, syncedHazards);
}

export async function patchCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  if (Array.isArray(input.hazards)) {
    return saveCompanyRiskAssessmentDraft(auth, deps, resolved, actor, riskAssessmentId, input);
  }
  const timer = createRiskAssessmentTiming("patch", {
    assessmentId: riskAssessmentId,
    companyFolderId: resolved.companyFolderId,
  });
  const current = await buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId, { timer });
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
  timer.log("patch-assessment");
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
  timer.log("complete");
  return buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId, { timer });
}

export async function submitCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId) {
  const timer = createRiskAssessmentTiming("submit", {
    assessmentId: riskAssessmentId,
    companyFolderId: resolved.companyFolderId,
  });
  const current = await buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId, { timer });
  if (!current.ok) return current;
  if (current.item.status === "Submitted") {
    timer.log("already-submitted");
    return { ...current, alreadySubmitted: true };
  }
  if (!canSubmitRiskAssessmentStatus(current.item.status)) {
    timer.log("validation-failed");
    return riskAssessmentValidationFailure({
      ok: false,
      message: "The risk assessment cannot be submitted.",
      fieldErrors: [{ step: "details", field: "status", message: "This assessment is not in a submittable status." }],
    });
  }
  if (!canSubmitRiskAssessment(actor, current.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot submit this assessment.", 403);
  }
  const validation = validateAssessmentForSubmit(current.item, current.hazards || []);
  if (!validation.ok) {
    timer.log("validation-failed");
    return riskAssessmentValidationFailure(validation);
  }
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
  timer.log("patch-status");
  for (const hazard of current.hazards || []) {
    if (hazard.actionRequired && !trim(hazard.linkedActionId)) {
      const actionResult = await createActionForHazard(auth, deps, resolved, actor, current.item, hazard);
      if (actionResult.actionId) {
        await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, "HazardId", hazard.id, {
          LinkedActionId: actionResult.actionId,
          UpdatedAt: timestamp,
          UpdatedBy: normalizeEmail(actor.email),
        });
      }
    }
  }
  timer.log("complete");
  return buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId, { timer });
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
  const timer = createRiskAssessmentTiming("create-hazard", {
    assessmentId: riskAssessmentId,
    companyFolderId: resolved.companyFolderId,
  });
  const assessment = await readAssessmentRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  if (!assessment) return healthSafetyApiFailure("RISK_ASSESSMENT_NOT_FOUND", "Risk assessment not found.", 404);
  if (!canEditRiskAssessment(actor, assessment)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot add hazards to this assessment.", 403);
  }
  timer.log("read-assessment");
  const synced = await syncRiskAssessmentHazards(auth, deps, resolved, actor, riskAssessmentId, [input], { timer });
  if (!synced.ok) return synced;
  const item = synced.hazards[synced.hazards.length - 1];
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

async function archiveVerificationHazardsForAssessment(auth, deps, resolved, actor, riskAssessmentId, timestamp) {
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS);
  const batchPatchTabRowsByHeader = resolveBatchPatchTabRowsByHeader(deps);
  const patchRows = [];
  for (const record of records) {
    const hazard = mapRiskHazardRecord(record);
    if (hazard.riskAssessmentId !== trim(riskAssessmentId) || hazard.archivedAt) continue;
    patchRows.push({
      matchValue: hazard.id,
      updates: {
        Status: "archived",
        ArchivedAt: timestamp,
        ArchivedBy: normalizeEmail(actor.email),
        UpdatedAt: timestamp,
        UpdatedBy: normalizeEmail(actor.email),
      },
    });
  }
  if (patchRows.length > 0) {
    await batchPatchTabRowsByHeader(
      auth,
      deps,
      resolved.masterSheetId,
      RISK_ASSESSMENT_HAZARDS_TAB,
      "HazardId",
      patchRows,
    );
  }
  return patchRows.length;
}

async function archiveVerificationLinksForAssessment(auth, deps, resolved, actor, riskAssessmentId, timestamp) {
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_LINKS_TAB, RISK_ASSESSMENT_LINKS_TAB_COLUMNS);
  const batchPatchTabRowsByHeader = resolveBatchPatchTabRowsByHeader(deps);
  const patchRows = [];
  for (const record of records) {
    const link = mapRiskLinkRecord(record);
    if (link.riskAssessmentId !== trim(riskAssessmentId) || link.archivedAt) continue;
    patchRows.push({
      matchValue: link.id,
      updates: {
        ArchivedAt: timestamp,
        ArchivedBy: normalizeEmail(actor.email),
      },
    });
  }
  if (patchRows.length > 0) {
    await batchPatchTabRowsByHeader(
      auth,
      deps,
      resolved.masterSheetId,
      RISK_ASSESSMENT_LINKS_TAB,
      "LinkId",
      patchRows,
    );
  }
  return patchRows.length;
}

async function cleanupLinkedVerificationActions(auth, deps, resolved, actor, riskAssessmentId) {
  const hazardRecords = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS);
  const linkedActionIds = new Set();
  for (const record of hazardRecords) {
    const hazard = mapRiskHazardRecord(record);
    if (hazard.riskAssessmentId !== trim(riskAssessmentId)) continue;
    const linkedActionId = trim(hazard.linkedActionId);
    if (linkedActionId) {
      linkedActionIds.add(linkedActionId);
    }
  }
  let cleanedActions = 0;
  for (const actionId of linkedActionIds) {
    const result = await cleanupVerificationAction(auth, deps, {
      actionId,
      companyFolderId: resolved.companyFolderId,
      companyId: resolved.companyFolderId,
      masterSheetId: resolved.masterSheetId,
      trustSessionContext: true,
    });
    if (result.ok) {
      cleanedActions += 1;
    }
  }
  return cleanedActions;
}

export async function cleanupVerificationRiskAssessment(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const id = trim(riskAssessmentId);
  if (!id) {
    return healthSafetyApiFailure("CLEANUP_CONTEXT_MISSING", "Risk assessment ID is required.", 400);
  }
  if (!canViewRiskAssessments(actor)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have access to risk assessments.", 403);
  }
  await ensureRiskAssessmentTabs(auth, deps, resolved.masterSheetId);
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS);
  const found = records.find((record) => trim(record.RiskAssessmentId) === id);
  if (!found) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_NOT_FOUND", "Risk assessment not found.", 404);
  }
  const assessment = mapRiskAssessmentRecord(found);
  if (!isVerificationRiskAssessment(assessment)) {
    return healthSafetyApiFailure(
      "CLEANUP_NOT_VERIFICATION_RISK_ASSESSMENT",
      "Only verification risk assessments can be cleaned up through this path.",
      403,
    );
  }
  const timestamp = nowIso();
  const cleanedHazards = await archiveVerificationHazardsForAssessment(auth, deps, resolved, actor, id, timestamp);
  const cleanedLinks = await archiveVerificationLinksForAssessment(auth, deps, resolved, actor, id, timestamp);
  const cleanedActions = await cleanupLinkedVerificationActions(auth, deps, resolved, actor, id);
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", id, {
    Status: PRODUCTION_VERIFICATION_RA_CLEANED_STATUS,
    ArchivedAt: timestamp,
    ArchivedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  return {
    ok: true,
    riskAssessmentId: id,
    cleaned: true,
    status: PRODUCTION_VERIFICATION_RA_CLEANED_STATUS,
    cleanedHazards,
    cleanedLinks,
    cleanedActions,
    companyFolderId: resolved.companyFolderId,
    masterSheetId: resolved.masterSheetId,
  };
}

export async function cleanupStaleVerificationRiskAssessments(auth, deps, resolved, actor) {
  if (!canViewRiskAssessments(actor)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have access to risk assessments.", 403);
  }
  await ensureRiskAssessmentTabs(auth, deps, resolved.masterSheetId);
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS);
  const stale = records
    .map((record) => mapRiskAssessmentRecord(record))
    .filter((item) => isActiveVerificationRiskAssessment(item));
  if (stale.length === 0) {
    return {
      ok: true,
      cleanedCount: 0,
      cleanedRiskAssessmentIds: [],
      companyFolderId: resolved.companyFolderId,
      masterSheetId: resolved.masterSheetId,
    };
  }
  const cleanedRiskAssessmentIds = [];
  let cleanedHazards = 0;
  let cleanedLinks = 0;
  let cleanedActions = 0;
  for (const assessment of stale) {
    const result = await cleanupVerificationRiskAssessment(auth, deps, resolved, actor, assessment.id);
    if (result.ok) {
      cleanedRiskAssessmentIds.push(assessment.id);
      cleanedHazards += Number(result.cleanedHazards) || 0;
      cleanedLinks += Number(result.cleanedLinks) || 0;
      cleanedActions += Number(result.cleanedActions) || 0;
    }
  }
  return {
    ok: true,
    cleanedCount: cleanedRiskAssessmentIds.length,
    cleanedRiskAssessmentIds,
    cleanedHazards,
    cleanedLinks,
    cleanedActions,
    companyFolderId: resolved.companyFolderId,
    masterSheetId: resolved.masterSheetId,
  };
}

export { resolveCompanyScheduleContext, RISK_ASSESSMENT_REQUIRED_TABS };
