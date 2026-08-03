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
  buildRiskAssessmentListItemFromRecord,
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
  normalizeAssessmentVersion,
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
  analyzeTabHeaderAlignment,
  appendTabRows as workbookAppendTabRows,
  batchPatchTabRowsByHeader as workbookBatchPatchTabRowsByHeader,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readAppendedRowByRange as workbookReadAppendedRowByRange,
  readTabRecords as workbookReadTabRecords,
  readTabValueRange as workbookReadTabValueRange,
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
const RISK_ASSESSMENT_LIST_CACHE_TTL_MS = 30_000;
const RISK_ASSESSMENT_DETAIL_CACHE_TTL_MS = 30_000;
/** @type {Map<string, { expiresAt: number, payload: object }>} */
const riskAssessmentListCache = new Map();
/** @type {Map<string, Promise<object>>} */
const riskAssessmentListInFlight = new Map();
/** @type {Map<string, { expiresAt: number, payload: object }>} */
const riskAssessmentDetailCache = new Map();

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

export function createRiskAssessmentListTiming(companyFolderId) {
  const startedAt = Date.now();
  let lastStageAt = startedAt;
  let lastStage = "start";
  const baseCompanyFolderId = trim(companyFolderId) || undefined;
  return {
    log(stage, extra = {}) {
      const now = Date.now();
      const durationMs = now - lastStageAt;
      const totalMs = now - startedAt;
      lastStageAt = now;
      lastStage = stage;
      const entry = {
        stage,
        durationMs,
        totalMs,
        companyFolderId: baseCompanyFolderId,
      };
      if (extra.rowCounts !== undefined) {
        entry.rowCounts = extra.rowCounts;
      }
      console.info("[risk-assessment:list-timing]", JSON.stringify(entry));
      return entry;
    },
    getLastStage() {
      return lastStage;
    },
    getTotalMs() {
      return Date.now() - startedAt;
    },
    startedAt,
  };
}

function riskAssessmentListCacheKey(resolved, actor, includeArchived) {
  const role = String(actor?.role || "").trim();
  const scopeEmail = role === "Auditor" ? normalizeEmail(actor?.email) : "*";
  return `${trim(resolved.companyFolderId)}::${trim(resolved.masterSheetId)}::${includeArchived ? "1" : "0"}::${role}::${scopeEmail}`;
}

export function invalidateRiskAssessmentListCache(resolved, reason = "mutation") {
  const companyFolderId = trim(resolved?.companyFolderId);
  const masterSheetId = trim(resolved?.masterSheetId);
  if (!companyFolderId || !masterSheetId) {
    return { companyFolderId: companyFolderId || undefined, masterSheetId: masterSheetId || undefined, reason, clearedKeys: 0 };
  }
  const prefix = `${companyFolderId}::${masterSheetId}::`;
  let clearedKeys = 0;
  for (const key of riskAssessmentListCache.keys()) {
    if (key.startsWith(prefix)) {
      riskAssessmentListCache.delete(key);
      clearedKeys += 1;
    }
  }
  for (const key of riskAssessmentListInFlight.keys()) {
    if (key.startsWith(prefix)) {
      riskAssessmentListInFlight.delete(key);
      clearedKeys += 1;
    }
  }
  console.info(
    "[risk-assessment:list-cache-invalidate]",
    JSON.stringify({
      companyFolderId,
      masterSheetId,
      reason,
      clearedKeys,
    }),
  );
  return { companyFolderId, masterSheetId, reason, clearedKeys };
}

function riskAssessmentDetailCacheKey(resolved, riskAssessmentId) {
  return `${trim(resolved.companyFolderId)}::${trim(resolved.masterSheetId)}::${trim(riskAssessmentId)}`;
}

export function invalidateRiskAssessmentDetailCache(resolved, riskAssessmentId, reason = "mutation") {
  const companyFolderId = trim(resolved?.companyFolderId);
  const masterSheetId = trim(resolved?.masterSheetId);
  const id = trim(riskAssessmentId);
  let clearedKeys = 0;
  if (!companyFolderId || !masterSheetId) {
    return { companyFolderId: companyFolderId || undefined, masterSheetId: masterSheetId || undefined, riskAssessmentId: id || undefined, reason, clearedKeys };
  }
  const prefix = `${companyFolderId}::${masterSheetId}::`;
  if (id) {
    const key = riskAssessmentDetailCacheKey(resolved, id);
    if (riskAssessmentDetailCache.delete(key)) {
      clearedKeys = 1;
    }
  } else {
    for (const key of riskAssessmentDetailCache.keys()) {
      if (key.startsWith(prefix)) {
        riskAssessmentDetailCache.delete(key);
        clearedKeys += 1;
      }
    }
  }
  console.info(
    "[risk-assessment:detail-cache-invalidate]",
    JSON.stringify({
      companyFolderId,
      masterSheetId,
      riskAssessmentId: id || undefined,
      reason,
      clearedKeys,
    }),
  );
  return { companyFolderId, masterSheetId, riskAssessmentId: id || undefined, reason, clearedKeys };
}

function getCachedRiskAssessmentDetail(resolved, riskAssessmentId) {
  const key = riskAssessmentDetailCacheKey(resolved, riskAssessmentId);
  const cached = riskAssessmentDetailCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) {
      riskAssessmentDetailCache.delete(key);
    }
    return null;
  }
  return cached.payload;
}

function setCachedRiskAssessmentDetail(resolved, riskAssessmentId, payload) {
  const key = riskAssessmentDetailCacheKey(resolved, riskAssessmentId);
  riskAssessmentDetailCache.set(key, {
    expiresAt: Date.now() + RISK_ASSESSMENT_DETAIL_CACHE_TTL_MS,
    payload,
  });
}

function publishRiskAssessmentListMutation(resolved, reason, result, riskAssessmentId) {
  if (result?.ok !== false) {
    invalidateRiskAssessmentListCache(resolved, reason);
    invalidateRiskAssessmentDetailCache(resolved, riskAssessmentId, reason);
  }
  return result;
}

export function resetRiskAssessmentListCachesForTests() {
  ensuredRiskAssessmentWorkbooks.clear();
  ensuringRiskAssessmentWorkbooks.clear();
  riskAssessmentListCache.clear();
  riskAssessmentListInFlight.clear();
  riskAssessmentDetailCache.clear();
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

function resolveReadAppendedRowByRange(deps) {
  return typeof deps?.readAppendedRowByRange === "function" ? deps.readAppendedRowByRange : workbookReadAppendedRowByRange;
}

function resolveReadTabValueRange(deps) {
  return typeof deps?.readTabValueRange === "function" ? deps.readTabValueRange : workbookReadTabValueRange;
}

function resolveAppendTabRows(deps) {
  return typeof deps?.appendTabRows === "function" ? deps.appendTabRows : workbookAppendTabRows;
}

function logRiskAssessmentCreatePersist(stage, payload = {}) {
  console.info(
    "[risk-assessment:create-persist]",
    JSON.stringify({
      stage,
      companyFolderId: trim(payload.companyFolderId) || undefined,
      writeMasterSheetId: trim(payload.writeMasterSheetId) || undefined,
      readMasterSheetId: trim(payload.readMasterSheetId) || undefined,
      tabName: trim(payload.tabName) || undefined,
      riskAssessmentId: trim(payload.riskAssessmentId) || undefined,
      updatedRange: trim(payload.updatedRange) || undefined,
      updatedRows: Number.isFinite(payload.updatedRows) ? payload.updatedRows : undefined,
      updatedColumns: Number.isFinite(payload.updatedColumns) ? payload.updatedColumns : undefined,
      written: Number.isFinite(payload.written) ? payload.written : undefined,
      exactRowFound: payload.exactRowFound === true ? true : payload.exactRowFound === false ? false : undefined,
      fullTabFound: payload.fullTabFound === true ? true : payload.fullTabFound === false ? false : undefined,
      headerMissing: Array.isArray(payload.headerMissing) ? payload.headerMissing : undefined,
      headerDuplicates: Array.isArray(payload.headerDuplicates) ? payload.headerDuplicates : undefined,
      attempt: Number.isFinite(payload.attempt) ? payload.attempt : undefined,
      error: trim(payload.error) || undefined,
    }),
  );
}

function logRiskAssessmentHazardPersist(stage, payload = {}) {
  const startedAt = Number(payload.startedAt);
  const durationMs = Number.isFinite(payload.durationMs)
    ? payload.durationMs
    : Number.isFinite(startedAt)
      ? Date.now() - startedAt
      : undefined;
  console.info(
    "[risk-assessment:hazard-persist]",
    JSON.stringify({
      stage,
      riskAssessmentId: trim(payload.riskAssessmentId) || undefined,
      hazardId: trim(payload.hazardId) || undefined,
      workbookId: trim(payload.workbookId) || undefined,
      tabName: RISK_ASSESSMENT_HAZARDS_TAB,
      updatedRange: trim(payload.updatedRange) || undefined,
      updatedRows: Number.isFinite(payload.updatedRows) ? payload.updatedRows : undefined,
      exactRowFound: payload.exactRowFound === true ? true : payload.exactRowFound === false ? false : undefined,
      fullTabFound: payload.fullTabFound === true ? true : payload.fullTabFound === false ? false : undefined,
      durationMs,
      attempt: Number.isFinite(payload.attempt) ? payload.attempt : undefined,
      error: trim(payload.error) || undefined,
    }),
  );
}

async function readHazardRecord(auth, deps, masterSheetId, hazardId) {
  const records = await readTab(auth, deps, masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS);
  const found = records.find((record) => trim(record.HazardId) === trim(hazardId));
  return found ? mapRiskHazardRecord(found) : null;
}

async function waitForHazardRecordAfterWrite(auth, deps, masterSheetId, hazardId, options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 15;
  const intervalMs = Number(options.intervalMs) || 1000;
  const appendResult = options.appendResult || null;
  const readAppendedRowByRange = resolveReadAppendedRowByRange(deps);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleepMs(intervalMs);
    }
    if (appendResult?.updatedRange) {
      const exactRecord = await readAppendedRowByRange(
        auth,
        deps,
        masterSheetId,
        RISK_ASSESSMENT_HAZARDS_TAB,
        appendResult,
        "HazardId",
        hazardId,
      );
      if (exactRecord) {
        logRiskAssessmentHazardPersist("exact-row-readback", {
          riskAssessmentId: options.riskAssessmentId,
          hazardId,
          workbookId: masterSheetId,
          updatedRange: appendResult.updatedRange,
          exactRowFound: true,
          attempt,
        });
        return { ok: true, record: mapRiskHazardRecord(exactRecord), attempts: attempt, source: "exact-range" };
      }
      logRiskAssessmentHazardPersist("exact-row-readback", {
        riskAssessmentId: options.riskAssessmentId,
        hazardId,
        workbookId: masterSheetId,
        updatedRange: appendResult.updatedRange,
        exactRowFound: false,
        attempt,
      });
    }
    const record = await readHazardRecord(auth, deps, masterSheetId, hazardId);
    if (record && !record.archivedAt) {
      logRiskAssessmentHazardPersist("full-tab-readback", {
        riskAssessmentId: options.riskAssessmentId,
        hazardId,
        workbookId: masterSheetId,
        fullTabFound: true,
        attempt,
      });
      return { ok: true, record, attempts: attempt, source: "full-tab" };
    }
    logRiskAssessmentHazardPersist("full-tab-readback", {
      riskAssessmentId: options.riskAssessmentId,
      hazardId,
      workbookId: masterSheetId,
      fullTabFound: false,
      attempt,
    });
  }
  return { ok: false, record: null, attempts: maxAttempts, source: "none" };
}

async function appendAndConfirmHazardRows(auth, deps, resolved, riskAssessmentId, rows, options = {}) {
  const appendTabRows = resolveAppendTabRows(deps);
  const workbookId = trim(resolved.masterSheetId);
  const confirmed = [];
  for (const row of rows) {
    const hazardId = trim(row.HazardId);
    const startedAt = Date.now();
    logRiskAssessmentHazardPersist("append-start", {
      riskAssessmentId,
      hazardId,
      workbookId,
      startedAt,
    });
    let appendResult;
    try {
      appendResult = await appendTabRows(
        auth,
        deps,
        workbookId,
        RISK_ASSESSMENT_HAZARDS_TAB,
        RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS,
        [row],
      );
    } catch (error) {
      logRiskAssessmentHazardPersist("append-failed", {
        riskAssessmentId,
        hazardId,
        workbookId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      return healthSafetyApiFailure(
        "RISK_HAZARD_CREATE_WRITE_FAILED",
        "Hazard could not be written to the workbook.",
        500,
        error instanceof Error ? error.message : String(error),
      );
    }
    logRiskAssessmentHazardPersist("append-ack", {
      riskAssessmentId,
      hazardId,
      workbookId,
      updatedRange: appendResult?.updatedRange,
      updatedRows: appendResult?.updatedRows,
      durationMs: Date.now() - startedAt,
    });
    if (!appendResult?.ok || Number(appendResult?.updatedRows) <= 0) {
      return healthSafetyApiFailure(
        "RISK_HAZARD_CREATE_WRITE_FAILED",
        "Hazard write was not acknowledged by Google Sheets.",
        500,
      );
    }
    const visibility = await waitForHazardRecordAfterWrite(auth, deps, workbookId, hazardId, {
      appendResult,
      riskAssessmentId,
      maxAttempts: options.maxAttempts,
      intervalMs: options.intervalMs,
    });
    if (!visibility.ok) {
      logRiskAssessmentHazardPersist("readback-failed", {
        riskAssessmentId,
        hazardId,
        workbookId,
        updatedRange: appendResult?.updatedRange,
        durationMs: Date.now() - startedAt,
      });
      return healthSafetyApiFailure(
        "RISK_HAZARD_CREATE_NOT_VISIBLE",
        "Hazard could not be confirmed after create.",
        500,
      );
    }
    confirmed.push(visibility.record);
  }
  return { ok: true, hazards: confirmed };
}

async function appendAndConfirmReviewRow(auth, deps, resolved, riskAssessmentId, reviewRow, options = {}) {
  const appendTabRows = resolveAppendTabRows(deps);
  const readAppendedRowByRange = resolveReadAppendedRowByRange(deps);
  const workbookId = trim(resolved.masterSheetId);
  const reviewId = trim(reviewRow.ReviewId);
  const startedAt = Date.now();
  logRiskAssessmentReview("append-start", {
    riskAssessmentId,
    reviewId,
    outcome: trim(reviewRow.Outcome),
    durationMs: Date.now() - startedAt,
  });
  let appendResult;
  try {
    appendResult = await appendTabRows(
      auth,
      deps,
      workbookId,
      RISK_ASSESSMENT_REVIEWS_TAB,
      RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS,
      [reviewRow],
    );
  } catch (error) {
    logRiskAssessmentReview("append-failed", {
      riskAssessmentId,
      reviewId,
      durationMs: Date.now() - startedAt,
    });
    return healthSafetyApiFailure(
      "RISK_REVIEW_CREATE_WRITE_FAILED",
      "Review could not be written to the workbook.",
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
  logRiskAssessmentReview("append-ack", {
    riskAssessmentId,
    reviewId,
    updatedRows: appendResult?.updatedRows,
    durationMs: Date.now() - startedAt,
  });
  if (!appendResult?.ok || Number(appendResult?.updatedRows) <= 0) {
    return healthSafetyApiFailure(
      "RISK_REVIEW_CREATE_WRITE_FAILED",
      "Review write was not acknowledged by Google Sheets.",
      500,
    );
  }
  let readback = null;
  if (appendResult?.updatedRange) {
    readback = await readAppendedRowByRange(
      auth,
      deps,
      workbookId,
      RISK_ASSESSMENT_REVIEWS_TAB,
      appendResult,
      "ReviewId",
      reviewId,
    );
  }
  if (!readback) {
    const records = await readTab(auth, deps, workbookId, RISK_ASSESSMENT_REVIEWS_TAB, RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS);
    readback = records.find((record) => trim(record.ReviewId) === reviewId) || null;
  }
  logRiskAssessmentReview("exact-row-readback", {
    riskAssessmentId,
    reviewId,
    outcome: readback ? trim(readback.Outcome) : undefined,
    durationMs: Date.now() - startedAt,
  });
  if (!readback || trim(readback.ReviewId) !== reviewId) {
    return healthSafetyApiFailure(
      "RISK_REVIEW_CREATE_NOT_VISIBLE",
      "Review could not be confirmed after write.",
      500,
    );
  }
  return { ok: true, record: readback, appendResult };
}

async function readRiskAssessmentTabHeaders(auth, deps, masterSheetId) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  const ensured = await ensureTabColumns(auth, deps, masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS);
  const headers = Array.isArray(ensured?.headers) && ensured.headers.length > 0 ? ensured.headers : RISK_ASSESSMENTS_TAB_COLUMNS;
  return headers.map((header) => trim(header)).filter(Boolean);
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

async function readAssessmentRawRecord(auth, deps, masterSheetId, riskAssessmentId) {
  await ensureRiskAssessmentTabs(auth, deps, masterSheetId);
  const records = await readTab(auth, deps, masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS);
  const matches = records.filter((record) => trim(record.RiskAssessmentId) === trim(riskAssessmentId));
  return matches.length ? matches[matches.length - 1] : null;
}

async function readAssessmentRecord(auth, deps, masterSheetId, riskAssessmentId) {
  const found = await readAssessmentRawRecord(auth, deps, masterSheetId, riskAssessmentId);
  return found ? mapRiskAssessmentRecord(found) : null;
}

const DRAFT_EDITABLE_ASSESSMENT_FIELDS = [
  ["title", "Title"],
  ["description", "Description"],
  ["assessmentType", "AssessmentType"],
  ["activity", "Activity"],
  ["department", "Department"],
  ["siteId", "SiteId"],
  ["areaId", "AreaId"],
  ["ownerUserId", "OwnerUserId"],
  ["ownerName", "OwnerName"],
  ["assessorUserId", "AssessorUserId"],
  ["assessorName", "AssessorName"],
  ["assessmentDate", "AssessmentDate"],
  ["reviewDate", "ReviewDate"],
  ["nextReviewReason", "NextReviewReason"],
  ["peopleAtRisk", "PeopleAtRisk"],
  ["existingGeneralControls", "ExistingGeneralControls"],
  ["emergencyArrangements", "EmergencyArrangements"],
  ["ppeSummary", "PpeSummary"],
];

function pickRawAssessmentField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) return direct;
  }
  return "";
}

function logRiskAssessmentSaveDraft(stage, payload = {}) {
  console.info(
    "[risk-assessment:save-draft]",
    JSON.stringify({
      stage,
      riskAssessmentId: payload.riskAssessmentId,
      incomingStatus: payload.incomingStatus,
      storedStatus: payload.storedStatus,
      incomingVersion: payload.incomingVersion,
      storedVersion: payload.storedVersion,
      updatedRows: payload.updatedRows,
      durationMs: payload.durationMs,
      hazardSyncMode: payload.hazardSyncMode,
      archiveMissingHazards: payload.archiveMissingHazards,
      assessmentRowCount: payload.assessmentRowCount,
      operation: payload.operation,
    }),
  );
}

function logRiskAssessmentSubmit(stage, payload = {}) {
  console.info(
    "[risk-assessment:submit]",
    JSON.stringify({
      stage,
      riskAssessmentId: payload.riskAssessmentId,
      storedStatus: payload.storedStatus,
      storedVersion: payload.storedVersion,
      incomingStatus: payload.incomingStatus,
      updatedRows: payload.updatedRows,
      submittedAt: payload.submittedAt ? true : undefined,
      submittedBy: payload.submittedBy ? true : undefined,
      hazardCount: payload.hazardCount,
      validationOk: payload.validationOk,
      alreadySubmitted: payload.alreadySubmitted,
      durationMs: payload.durationMs,
    }),
  );
}

function logRiskAssessmentApprove(stage, payload = {}) {
  console.info(
    "[risk-assessment:approve]",
    JSON.stringify({
      stage,
      riskAssessmentId: payload.riskAssessmentId,
      actorRole: payload.actorRole,
      sameActorAsSubmitter: payload.sameActorAsSubmitter,
      beforeStatus: payload.beforeStatus,
      afterStatus: payload.afterStatus,
      approvedAt: payload.approvedAt ? true : undefined,
      activatedAt: payload.activatedAt ? true : undefined,
      activateNow: payload.activateNow,
      selfApprovalBlocked: payload.selfApprovalBlocked,
      alreadyApproved: payload.alreadyApproved,
      updatedRows: payload.updatedRows,
      durationMs: payload.durationMs,
    }),
  );
}

function logRiskAssessmentReview(stage, payload = {}) {
  console.info(
    "[risk-assessment:review]",
    JSON.stringify({
      stage,
      riskAssessmentId: payload.riskAssessmentId,
      reviewId: payload.reviewId,
      beforeStatus: payload.beforeStatus,
      afterStatus: payload.afterStatus,
      beforeVersion: payload.beforeVersion,
      afterVersion: payload.afterVersion,
      outcome: payload.outcome,
      nextReviewDate: payload.nextReviewDate,
      previousReviewDate: payload.previousReviewDate,
      updatedRows: payload.updatedRows,
      reviewHistoryCount: payload.reviewHistoryCount,
      alreadyReviewed: payload.alreadyReviewed,
      durationMs: payload.durationMs,
    }),
  );
}

function logRiskAssessmentMutationTiming(operation, stage, payload = {}) {
  console.info(
    "[risk-assessment:mutation-timing]",
    JSON.stringify({
      operation: trim(operation) || undefined,
      stage: trim(stage) || undefined,
      durationMs: Number.isFinite(payload.durationMs) ? payload.durationMs : undefined,
      totalMs: Number.isFinite(payload.totalMs) ? payload.totalMs : undefined,
      riskAssessmentId: trim(payload.riskAssessmentId) || undefined,
      workbookId: trim(payload.workbookId) || undefined,
      updatedRows: Number.isFinite(payload.updatedRows) ? payload.updatedRows : undefined,
    }),
  );
}

function createMutationTimingContext(operation, context = {}) {
  const startedAt = Date.now();
  let lastStageAt = startedAt;
  const base = {
    operation: trim(operation) || undefined,
    riskAssessmentId: trim(context.riskAssessmentId) || undefined,
    workbookId: trim(context.workbookId) || undefined,
  };
  return {
    startedAt,
    log(stage, extra = {}) {
      const now = Date.now();
      const durationMs = now - lastStageAt;
      const totalMs = now - startedAt;
      lastStageAt = now;
      logRiskAssessmentMutationTiming(base.operation, stage, {
        ...base,
        durationMs,
        totalMs,
        ...extra,
      });
    },
  };
}

async function readAssessmentHazardsForAssessment(auth, deps, masterSheetId, riskAssessmentId, options = {}) {
  if (!options.skipEnsure) {
    await ensureRiskAssessmentTabs(auth, deps, masterSheetId);
  }
  const hazardRecords = await readTab(
    auth,
    deps,
    masterSheetId,
    RISK_ASSESSMENT_HAZARDS_TAB,
    RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS,
  );
  return dedupeHazardsById(
    hazardRecords
      .map((record) => mapRiskHazardRecord(record))
      .filter((hazard) => hazard.riskAssessmentId === trim(riskAssessmentId) && !hazard.archivedAt),
  ).sort((left, right) => left.sortOrder - right.sortOrder || left.hazardTitle.localeCompare(right.hazardTitle));
}

function buildAssessmentMutationResponse(assessment, hazards = [], links = [], reviews = []) {
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
    reviews: reviews || [],
  };
}

function mapReviewRecordsForAssessment(reviewRecords = [], riskAssessmentId) {
  return reviewRecords
    .map((record) => mapRiskReviewRecord(record))
    .filter((review) => review.riskAssessmentId === trim(riskAssessmentId))
    .sort((left, right) => trim(right.createdAt).localeCompare(trim(left.createdAt)));
}

function buildEditableDraftAssessmentPatch(mappedAssessment, rawRecord, input = {}, actor, options = {}) {
  const storedStatus = pickRawAssessmentField(rawRecord, "Status") || "Draft";
  const storedVersion = normalizeAssessmentVersion(pickRawAssessmentField(rawRecord, "Version") || "1.0");
  const row = {};
  for (const [inputKey, column] of DRAFT_EDITABLE_ASSESSMENT_FIELDS) {
    if (input[inputKey] !== undefined) {
      row[column] = trim(input[inputKey]);
    } else {
      row[column] = trim(mappedAssessment[inputKey]);
    }
  }
  if (options.riskFields) {
    Object.assign(row, options.riskFields);
  }
  row.Status = storedStatus;
  row.UpdatedAt = nowIso();
  row.UpdatedBy = normalizeEmail(actor.email);
  return {
    patch: rowToPatch(row, RISK_ASSESSMENTS_TAB_COLUMNS),
    storedStatus,
    storedVersion,
  };
}

function isRecalculateRiskOnlyPatch(input = {}) {
  const keys = Object.keys(input).filter((key) => input[key] !== undefined);
  return keys.length === 1 && keys[0] === "recalculateRisk";
}

function mapAssessmentRecordFromPatch(mappedAssessment, patch, rawRecord) {
  const storedStatus = pickRawAssessmentField(rawRecord, "Status") || mappedAssessment.status || "Draft";
  const storedVersion = normalizeAssessmentVersion(
    pickRawAssessmentField(rawRecord, "Version") || mappedAssessment.version || "1.0",
  );
  return {
    ...mappedAssessment,
    title: patch.Title ?? mappedAssessment.title,
    description: patch.Description ?? mappedAssessment.description,
    assessmentType: patch.AssessmentType ?? mappedAssessment.assessmentType,
    activity: patch.Activity ?? mappedAssessment.activity,
    department: patch.Department ?? mappedAssessment.department,
    siteId: patch.SiteId ?? mappedAssessment.siteId,
    areaId: patch.AreaId ?? mappedAssessment.areaId,
    ownerUserId: patch.OwnerUserId ?? mappedAssessment.ownerUserId,
    ownerName: patch.OwnerName ?? mappedAssessment.ownerName,
    assessorUserId: patch.AssessorUserId ?? mappedAssessment.assessorUserId,
    assessorName: patch.AssessorName ?? mappedAssessment.assessorName,
    assessmentDate: patch.AssessmentDate ?? mappedAssessment.assessmentDate,
    reviewDate: patch.ReviewDate ?? mappedAssessment.reviewDate,
    nextReviewReason: patch.NextReviewReason ?? mappedAssessment.nextReviewReason,
    peopleAtRisk: patch.PeopleAtRisk ?? mappedAssessment.peopleAtRisk,
    existingGeneralControls: patch.ExistingGeneralControls ?? mappedAssessment.existingGeneralControls,
    emergencyArrangements: patch.EmergencyArrangements ?? mappedAssessment.emergencyArrangements,
    ppeSummary: patch.PpeSummary ?? mappedAssessment.ppeSummary,
    status: storedStatus,
    version: storedVersion,
    updatedAt: patch.UpdatedAt ?? mappedAssessment.updatedAt,
    updatedBy: patch.UpdatedBy ?? mappedAssessment.updatedBy,
  };
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAssessmentRecordAfterWrite(auth, deps, masterSheetId, riskAssessmentId, options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 15;
  const intervalMs = Number(options.intervalMs) || 1000;
  const appendResult = options.appendResult || null;
  const readAppendedRowByRange = resolveReadAppendedRowByRange(deps);
  let lastRecord = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleepMs(intervalMs);
    }
    if (appendResult?.updatedRange) {
      const exactRecord = await readAppendedRowByRange(
        auth,
        deps,
        masterSheetId,
        RISK_ASSESSMENTS_TAB,
        appendResult,
        "RiskAssessmentId",
        riskAssessmentId,
      );
      if (exactRecord) {
        logRiskAssessmentCreatePersist("exact-row-readback", {
          companyFolderId: options.companyFolderId,
          writeMasterSheetId: masterSheetId,
          readMasterSheetId: masterSheetId,
          tabName: RISK_ASSESSMENTS_TAB,
          riskAssessmentId,
          updatedRange: appendResult.updatedRange,
          exactRowFound: true,
          attempt,
        });
        return { ok: true, record: mapRiskAssessmentRecord(exactRecord), attempts: attempt, source: "exact-range" };
      }
      logRiskAssessmentCreatePersist("exact-row-readback", {
        companyFolderId: options.companyFolderId,
        writeMasterSheetId: masterSheetId,
        readMasterSheetId: masterSheetId,
        tabName: RISK_ASSESSMENTS_TAB,
        riskAssessmentId,
        updatedRange: appendResult.updatedRange,
        exactRowFound: false,
        attempt,
      });
    }
    lastRecord = await readAssessmentRecord(auth, deps, masterSheetId, riskAssessmentId);
    if (lastRecord) {
      logRiskAssessmentCreatePersist("full-tab-readback", {
        companyFolderId: options.companyFolderId,
        writeMasterSheetId: masterSheetId,
        readMasterSheetId: masterSheetId,
        tabName: RISK_ASSESSMENTS_TAB,
        riskAssessmentId,
        fullTabFound: true,
        attempt,
      });
      return { ok: true, record: lastRecord, attempts: attempt, source: "full-tab" };
    }
    logRiskAssessmentCreatePersist("full-tab-readback", {
      companyFolderId: options.companyFolderId,
      writeMasterSheetId: masterSheetId,
      readMasterSheetId: masterSheetId,
      tabName: RISK_ASSESSMENTS_TAB,
      riskAssessmentId,
      fullTabFound: false,
      attempt,
    });
  }
  return { ok: false, record: lastRecord, attempts: maxAttempts, source: "none" };
}

async function buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId, options = {}) {
  const timer = options.timer || createRiskAssessmentTiming("build-detail", {
    assessmentId: riskAssessmentId,
    companyFolderId: resolved.companyFolderId,
  });
  if (!actorCanAccessCompanyHealthSafety(actor, resolved.companyFolderId, resolved.alternateCompanyIds)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have access to this company.", 403);
  }
  if (!options.skipCache) {
    const cached = getCachedRiskAssessmentDetail(resolved, riskAssessmentId);
    if (cached) {
      timer.log("detail-cache-hit");
      return cached;
    }
  }
  timer.log("auth");
  await ensureRiskAssessmentTabs(auth, deps, resolved.masterSheetId);
  timer.log("ensure-tabs");
  const assessmentRecords = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS);
  timer.log("read-assessments-tab");
  const matchingAssessments = assessmentRecords
    .map((record) => mapRiskAssessmentRecord(record))
    .filter((entry) => entry.id === trim(riskAssessmentId));
  const item = matchingAssessments.at(-1);
  if (!item) return healthSafetyApiFailure("RISK_ASSESSMENT_NOT_FOUND", "Risk assessment not found.", 404);
  const [hazardRecords, linkRecords, reviewRecords] = await Promise.all([
    readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS),
    readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_LINKS_TAB, RISK_ASSESSMENT_LINKS_TAB_COLUMNS),
    readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_REVIEWS_TAB, RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS),
  ]);
  timer.log("read-related-tabs");
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
  const response = {
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
  if (!options.skipCache) {
    setCachedRiskAssessmentDetail(resolved, riskAssessmentId, response);
  }
  return response;
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
    const appendConfirmed = await appendAndConfirmHazardRows(auth, deps, resolved, riskAssessmentId, rowsToAppend, {
      maxAttempts: options.readAfterWriteMaxAttempts,
      intervalMs: options.readAfterWriteIntervalMs,
    });
    if (!appendConfirmed.ok) return appendConfirmed;
  }
  timer.log("append-hazards", { appended: rowsToAppend.length, rowCount: hazardInputs.length });

  const shouldArchiveMissing = options.archiveMissingHazards === true;
  if (shouldArchiveMissing) {
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

async function patchAssessmentFieldsOnly(auth, deps, resolved, actor, riskAssessmentId, input = {}, options = {}) {
  const rawRecord = await readAssessmentRawRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  if (!rawRecord) return healthSafetyApiFailure("RISK_ASSESSMENT_NOT_FOUND", "Risk assessment not found.", 404);
  const assessment = mapRiskAssessmentRecord(rawRecord);
  if (!canEditRiskAssessment(actor, assessment)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have permission to edit this assessment.", 403);
  }
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS);
  const assessmentRowCount = records.filter((record) => trim(record.RiskAssessmentId) === trim(riskAssessmentId)).length;
  const { patch, storedStatus, storedVersion } = buildEditableDraftAssessmentPatch(assessment, rawRecord, input, actor, {
    riskFields: options.riskFields,
  });
  logRiskAssessmentSaveDraft("patch-built", {
    riskAssessmentId,
    incomingStatus: trim(input.status) || undefined,
    storedStatus,
    incomingVersion: trim(input.version) || undefined,
    storedVersion,
    assessmentRowCount,
    operation: "patch-assessment-fields",
  });
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const patchResult = await patchTabRowByHeader(
    auth,
    deps,
    resolved.masterSheetId,
    RISK_ASSESSMENTS_TAB,
    "RiskAssessmentId",
    riskAssessmentId,
    patch,
  );
  logRiskAssessmentSaveDraft("patch-ack", {
    riskAssessmentId,
    storedStatus,
    storedVersion,
    updatedRows: patchResult?.patched ?? patchResult?.updatedRows ?? 1,
    assessmentRowCount,
    operation: "patch-assessment-fields",
  });
  const readback = await readAssessmentRawRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  const readbackStatus = pickRawAssessmentField(readback, "Status") || storedStatus;
  const readbackVersion = normalizeAssessmentVersion(pickRawAssessmentField(readback, "Version") || storedVersion);
  logRiskAssessmentSaveDraft("exact-row-readback", {
    riskAssessmentId,
    storedStatus: readbackStatus,
    storedVersion: readbackVersion,
    assessmentRowCount,
    operation: "patch-assessment-fields",
  });
  const updated = mapAssessmentRecordFromPatch(assessment, patch, readback || rawRecord);
  return { ok: true, item: updated, storedStatus: readbackStatus, storedVersion: readbackVersion, assessmentRowCount };
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
  await appendTabRows(auth, deps, resolved.masterSheetId, ACTIONS_TAB, ACTIONS_TAB_COLUMNS, [row]);
  return { ok: true, actionId };
}

function validateAssessmentForSubmit(assessment, hazards) {
  return validateRiskAssessmentForSubmit(assessment, hazards, { todayKey: getUkTodayKey() });
}

export async function listCompanyRiskAssessments(auth, deps, resolved, actor, options = {}) {
  const includeArchived = options.includeArchived === true;
  const timer = options.timer || createRiskAssessmentListTiming(resolved.companyFolderId);
  const skipCache = options.skipCache === true;

  if (!skipCache) {
    const cacheKey = riskAssessmentListCacheKey(resolved, actor, includeArchived);
    const cached = riskAssessmentListCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      timer.log("cache-hit", { rowCounts: { items: cached.payload.items?.length || 0 } });
      return cached.payload;
    }
    let inFlight = riskAssessmentListInFlight.get(cacheKey);
    if (!inFlight) {
      inFlight = listCompanyRiskAssessmentsUncached(auth, deps, resolved, actor, {
        ...options,
        timer,
        skipCache: true,
      }).finally(() => {
        riskAssessmentListInFlight.delete(cacheKey);
      });
      riskAssessmentListInFlight.set(cacheKey, inFlight);
    } else {
      timer.log("in-flight-wait");
    }
    const result = await inFlight;
    if (result?.ok) {
      riskAssessmentListCache.set(cacheKey, {
        expiresAt: Date.now() + RISK_ASSESSMENT_LIST_CACHE_TTL_MS,
        payload: result,
      });
    }
    return result;
  }

  return listCompanyRiskAssessmentsUncached(auth, deps, resolved, actor, { ...options, timer, skipCache: true });
}

async function listCompanyRiskAssessmentsUncached(auth, deps, resolved, actor, options = {}) {
  const timer = options.timer || createRiskAssessmentListTiming(resolved.companyFolderId);
  const includeArchived = options.includeArchived === true;

  if (!actorCanAccessCompanyHealthSafety(actor, resolved.companyFolderId, resolved.alternateCompanyIds)) {
    timer.log("permission-filtering", { rowCounts: { items: 0 } });
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have access to this company.", 403);
  }
  timer.log("permission-filtering", { rowCounts: { items: 0 } });

  await ensureRiskAssessmentTabs(auth, deps, resolved.masterSheetId);
  timer.log("ensure-risk-assessment-tabs");

  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS);
  timer.log("read-risk-assessments-tab", { rowCounts: { assessments: records.length } });
  timer.log("read-risk-assessment-hazards-tab", { rowCounts: { hazards: 0 } });
  timer.log("read-risk-assessment-links-tab", { rowCounts: { links: 0 } });
  timer.log("read-risk-assessment-reviews-tab", { rowCounts: { reviews: 0 } });

  const items = records
    .map((record) => buildRiskAssessmentListItemFromRecord(record))
    .filter((item) => item.id && (includeArchived || !item.archivedAt));
  timer.log("parsing-normalisation", {
    rowCounts: { assessments: records.length, items: items.length },
  });

  timer.log("derived-status-risk", { rowCounts: { items: items.length } });

  const response = { ok: true, items };
  timer.log("response-serialisation", { rowCounts: { items: items.length } });
  return response;
}

export async function getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId) {
  return buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId);
}

export async function createCompanyRiskAssessment(auth, deps, resolved, actor, input = {}) {
  const timer = createRiskAssessmentTiming("create", { companyFolderId: resolved.companyFolderId });
  const writeMasterSheetId = trim(resolved.masterSheetId);
  logRiskAssessmentCreatePersist("validation-start", {
    companyFolderId: resolved.companyFolderId,
    writeMasterSheetId,
    readMasterSheetId: writeMasterSheetId,
    tabName: RISK_ASSESSMENTS_TAB,
    riskAssessmentId: trim(input.riskAssessmentId) || trim(input.id) || undefined,
  });
  if (!canCreateRiskAssessment(actor)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have permission to create risk assessments.", 403);
  }
  if (!writeMasterSheetId) {
    logRiskAssessmentCreatePersist("workbook-resolution-failed", {
      companyFolderId: resolved.companyFolderId,
      error: "missing_master_sheet_id",
    });
    return healthSafetyApiFailure("RISK_ASSESSMENT_WORKBOOK_MISSING", "Company workbook could not be resolved.", 400);
  }
  logRiskAssessmentCreatePersist("workbook-resolved", {
    companyFolderId: resolved.companyFolderId,
    writeMasterSheetId,
    readMasterSheetId: writeMasterSheetId,
    tabName: RISK_ASSESSMENTS_TAB,
  });
  await ensureRiskAssessmentTabs(auth, deps, writeMasterSheetId);
  timer.log("ensure-tabs");
  logRiskAssessmentCreatePersist("tab-ensured", {
    companyFolderId: resolved.companyFolderId,
    writeMasterSheetId,
    readMasterSheetId: writeMasterSheetId,
    tabName: RISK_ASSESSMENTS_TAB,
  });
  const liveHeaders = await readRiskAssessmentTabHeaders(auth, deps, writeMasterSheetId);
  const headerAlignment = analyzeTabHeaderAlignment(RISK_ASSESSMENTS_TAB_COLUMNS, liveHeaders);
  logRiskAssessmentCreatePersist("header-alignment", {
    companyFolderId: resolved.companyFolderId,
    writeMasterSheetId,
    readMasterSheetId: writeMasterSheetId,
    tabName: RISK_ASSESSMENTS_TAB,
    headerMissing: headerAlignment.missing,
    headerDuplicates: headerAlignment.duplicates,
  });
  const existing = await readTab(auth, deps, writeMasterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS);
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
      logRiskAssessmentCreatePersist("idempotent-existing", {
        companyFolderId: resolved.companyFolderId,
        writeMasterSheetId,
        readMasterSheetId: writeMasterSheetId,
        tabName: RISK_ASSESSMENTS_TAB,
        riskAssessmentId: mapped.id,
        fullTabFound: true,
      });
      return publishRiskAssessmentListMutation(
        resolved,
        "create-existing-verification",
        buildDraftSaveResponse(mapped, []),
      );
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
  logRiskAssessmentCreatePersist("row-constructed", {
    companyFolderId: resolved.companyFolderId,
    writeMasterSheetId,
    readMasterSheetId: writeMasterSheetId,
    tabName: RISK_ASSESSMENTS_TAB,
    riskAssessmentId: id,
  });
  const appendTabRows = resolveAppendTabRows(deps);
  let appendResult;
  try {
    appendResult = await appendTabRows(auth, deps, writeMasterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS, [row]);
  } catch (error) {
    logRiskAssessmentCreatePersist("append-failed", {
      companyFolderId: resolved.companyFolderId,
      writeMasterSheetId,
      readMasterSheetId: writeMasterSheetId,
      tabName: RISK_ASSESSMENTS_TAB,
      riskAssessmentId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return healthSafetyApiFailure(
      "RISK_ASSESSMENT_CREATE_WRITE_FAILED",
      "Risk assessment could not be written to the workbook.",
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
  timer.log("append-assessment");
  logRiskAssessmentCreatePersist("append-ack", {
    companyFolderId: resolved.companyFolderId,
    writeMasterSheetId: appendResult?.masterSheetId || writeMasterSheetId,
    readMasterSheetId: writeMasterSheetId,
    tabName: RISK_ASSESSMENTS_TAB,
    riskAssessmentId: id,
    updatedRange: appendResult?.updatedRange,
    updatedRows: appendResult?.updatedRows,
    updatedColumns: appendResult?.updatedColumns,
    written: appendResult?.written,
  });
  if (!appendResult?.ok || Number(appendResult?.written) <= 0) {
    logRiskAssessmentCreatePersist("append-not-acknowledged", {
      companyFolderId: resolved.companyFolderId,
      writeMasterSheetId,
      readMasterSheetId: writeMasterSheetId,
      tabName: RISK_ASSESSMENTS_TAB,
      riskAssessmentId: id,
      written: appendResult?.written,
    });
    return healthSafetyApiFailure(
      "RISK_ASSESSMENT_CREATE_WRITE_FAILED",
      "Risk assessment write was not acknowledged by Google Sheets.",
      500,
    );
  }
  const visibility = await waitForAssessmentRecordAfterWrite(auth, deps, writeMasterSheetId, id, {
    maxAttempts: 15,
    intervalMs: 1000,
    appendResult,
    companyFolderId: resolved.companyFolderId,
  });
  timer.log("read-after-write", { attempts: visibility.attempts, visible: visibility.ok, source: visibility.source });
  if (!visibility.ok) {
    timer.log("create-not-visible");
    logRiskAssessmentCreatePersist("readback-failed", {
      companyFolderId: resolved.companyFolderId,
      writeMasterSheetId,
      readMasterSheetId: writeMasterSheetId,
      tabName: RISK_ASSESSMENTS_TAB,
      riskAssessmentId: id,
      updatedRange: appendResult?.updatedRange,
      attempt: visibility.attempts,
    });
    return healthSafetyApiFailure(
      "RISK_ASSESSMENT_CREATE_NOT_VISIBLE",
      "Risk assessment could not be confirmed after create.",
      500,
    );
  }
  const persisted = visibility.record;
  const detailLookup = await buildAssessmentDetail(auth, deps, resolved, actor, id, { timer, skipCache: true });
  logRiskAssessmentCreatePersist("detail-lookup", {
    companyFolderId: resolved.companyFolderId,
    writeMasterSheetId,
    readMasterSheetId: writeMasterSheetId,
    tabName: RISK_ASSESSMENTS_TAB,
    riskAssessmentId: id,
    fullTabFound: detailLookup?.ok === true,
  });
  if (!detailLookup?.ok) {
    return detailLookup;
  }
  let syncedHazards = [];
  if (Array.isArray(input.hazards) && input.hazards.length > 0) {
    const synced = await syncRiskAssessmentHazards(auth, deps, resolved, actor, id, input.hazards, {
      timer,
      archiveMissingHazards: true,
    });
    if (!synced.ok) return synced;
    syncedHazards = synced.hazards || [];
  }
  timer.log("complete");
  logRiskAssessmentCreatePersist("complete", {
    companyFolderId: resolved.companyFolderId,
    writeMasterSheetId,
    readMasterSheetId: writeMasterSheetId,
    tabName: RISK_ASSESSMENTS_TAB,
    riskAssessmentId: id,
    fullTabFound: true,
  });
  return publishRiskAssessmentListMutation(
    resolved,
    "create",
    buildDraftSaveResponse(persisted, syncedHazards),
    id,
  );
}

export async function saveCompanyRiskAssessmentDraft(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const startedAt = Date.now();
  const timer = createRiskAssessmentTiming("save-draft", {
    assessmentId: riskAssessmentId,
    companyFolderId: resolved.companyFolderId,
    workbookId: resolved.masterSheetId,
  });
  const id = trim(riskAssessmentId);
  logRiskAssessmentSaveDraft("validation-start", {
    riskAssessmentId: id || undefined,
    incomingStatus: trim(input.status) || undefined,
    incomingVersion: trim(input.version) || undefined,
    hazardSyncMode: Array.isArray(input.hazards) ? "full-sync" : "assessment-only",
    archiveMissingHazards: Array.isArray(input.hazards) ? true : false,
    durationMs: Date.now() - startedAt,
  });
  if (!id) {
    return createCompanyRiskAssessment(auth, deps, resolved, actor, input);
  }
  const patched = await patchAssessmentFieldsOnly(auth, deps, resolved, actor, id, input);
  if (!patched.ok) return patched;
  timer.log("patch-assessment");
  let syncedHazards = patched.hazards || [];
  if (Array.isArray(input.hazards)) {
    const synced = await syncRiskAssessmentHazards(auth, deps, resolved, actor, id, input.hazards, {
      timer,
      archiveMissingHazards: true,
    });
    if (!synced.ok) return synced;
    syncedHazards = synced.hazards || [];
    logRiskAssessmentSaveDraft("hazard-sync-complete", {
      riskAssessmentId: id,
      storedStatus: patched.storedStatus,
      storedVersion: patched.storedVersion,
      hazardSyncMode: "full-sync",
      archiveMissingHazards: true,
      durationMs: Date.now() - startedAt,
    });
  }
  const detailLookup = await buildAssessmentDetail(auth, deps, resolved, actor, id, { timer, skipCache: true });
  logRiskAssessmentSaveDraft("detail-lookup", {
    riskAssessmentId: id,
    storedStatus: detailLookup?.item?.status,
    storedVersion: detailLookup?.item?.version,
    durationMs: Date.now() - startedAt,
  });
  if (!detailLookup?.ok) {
    return detailLookup;
  }
  timer.log("complete");
  logRiskAssessmentSaveDraft("complete", {
    riskAssessmentId: id,
    storedStatus: detailLookup.item?.status,
    storedVersion: detailLookup.item?.version,
    assessmentRowCount: patched.assessmentRowCount,
    durationMs: Date.now() - startedAt,
  });
  return publishRiskAssessmentListMutation(
    resolved,
    "save-draft",
    buildDraftSaveResponse(detailLookup.item, syncedHazards, detailLookup.links),
    id,
  );
}

export async function patchCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  if (Array.isArray(input.hazards)) {
    return saveCompanyRiskAssessmentDraft(auth, deps, resolved, actor, riskAssessmentId, input);
  }
  const startedAt = Date.now();
  const timer = createRiskAssessmentTiming("patch", {
    assessmentId: riskAssessmentId,
    companyFolderId: resolved.companyFolderId,
  });
  const current = await buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId, { timer, skipCache: true });
  if (!current.ok) return current;
  if (!canEditRiskAssessment(actor, current.item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You do not have permission to edit this assessment.", 403);
  }
  const rawRecord = await readAssessmentRawRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  const records = await readTab(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS);
  const assessmentRowCount = records.filter((record) => trim(record.RiskAssessmentId) === trim(riskAssessmentId)).length;
  const storedStatus = pickRawAssessmentField(rawRecord, "Status") || current.item.status || "Draft";
  const storedVersion = normalizeAssessmentVersion(pickRawAssessmentField(rawRecord, "Version") || current.item.version || "1.0");
  logRiskAssessmentSaveDraft("validation-start", {
    riskAssessmentId,
    incomingStatus: trim(input.status) || undefined,
    storedStatus,
    incomingVersion: trim(input.version) || undefined,
    storedVersion,
    assessmentRowCount,
    operation: "patch",
    durationMs: Date.now() - startedAt,
  });
  const hazards = current.hazards || [];
  const riskFields = input.recalculateRisk === false ? {} : recalculateAssessmentRiskFields(hazards);
  let patch;
  if (isRecalculateRiskOnlyPatch(input)) {
    patch = rowToPatch(
      {
        ...riskFields,
        UpdatedAt: nowIso(),
        UpdatedBy: normalizeEmail(actor.email),
      },
      RISK_ASSESSMENTS_TAB_COLUMNS,
    );
  } else {
    const built = buildEditableDraftAssessmentPatch(current.item, rawRecord, input, actor, { riskFields });
    patch = built.patch;
  }
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const patchResult = await patchTabRowByHeader(
    auth,
    deps,
    resolved.masterSheetId,
    RISK_ASSESSMENTS_TAB,
    "RiskAssessmentId",
    riskAssessmentId,
    patch,
  );
  logRiskAssessmentSaveDraft("patch-ack", {
    riskAssessmentId,
    storedStatus,
    storedVersion,
    updatedRows: patchResult?.patched ?? patchResult?.updatedRows ?? 1,
    assessmentRowCount,
    operation: "patch",
    durationMs: Date.now() - startedAt,
  });
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
  const readback = await readAssessmentRawRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  const readbackStatus = pickRawAssessmentField(readback, "Status") || storedStatus;
  const readbackVersion = normalizeAssessmentVersion(pickRawAssessmentField(readback, "Version") || storedVersion);
  logRiskAssessmentSaveDraft("exact-row-readback", {
    riskAssessmentId,
    storedStatus: readbackStatus,
    storedVersion: readbackVersion,
    assessmentRowCount,
    operation: "patch",
    durationMs: Date.now() - startedAt,
  });
  timer.log("complete");
  const detail = await buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId, { timer, skipCache: true });
  logRiskAssessmentSaveDraft("detail-lookup", {
    riskAssessmentId,
    storedStatus: detail?.item?.status,
    storedVersion: detail?.item?.version,
    assessmentRowCount,
    operation: "patch",
    durationMs: Date.now() - startedAt,
  });
  return publishRiskAssessmentListMutation(resolved, "patch", detail, riskAssessmentId);
}

export async function submitCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId) {
  const startedAt = Date.now();
  const timer = createRiskAssessmentTiming("submit", {
    assessmentId: riskAssessmentId,
    companyFolderId: resolved.companyFolderId,
  });
  const current = await buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId, { timer, skipCache: true });
  if (!current.ok) return current;
  const rawBefore = await readAssessmentRawRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  const storedStatusBefore = pickRawAssessmentField(rawBefore, "Status") || current.item.status || "Draft";
  const storedVersionBefore = normalizeAssessmentVersion(
    pickRawAssessmentField(rawBefore, "Version") || current.item.version || "1.0",
  );
  logRiskAssessmentSubmit("validation-start", {
    riskAssessmentId,
    storedStatus: storedStatusBefore,
    storedVersion: storedVersionBefore,
    hazardCount: (current.hazards || []).length,
    durationMs: Date.now() - startedAt,
  });
  if (storedStatusBefore === "Submitted" || current.item.status === "Submitted") {
    timer.log("already-submitted");
    const fresh = await buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId, { timer, skipCache: true });
    logRiskAssessmentSubmit("already-submitted", {
      riskAssessmentId,
      storedStatus: fresh.item?.status,
      storedVersion: fresh.item?.version,
      alreadySubmitted: true,
      durationMs: Date.now() - startedAt,
    });
    return publishRiskAssessmentListMutation(
      resolved,
      "submit",
      { ...fresh, alreadySubmitted: true },
      riskAssessmentId,
    );
  }
  if (!canSubmitRiskAssessmentStatus(current.item.status)) {
    timer.log("validation-failed");
    logRiskAssessmentSubmit("validation-failed", {
      riskAssessmentId,
      storedStatus: storedStatusBefore,
      validationOk: false,
      durationMs: Date.now() - startedAt,
    });
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
    logRiskAssessmentSubmit("validation-failed", {
      riskAssessmentId,
      storedStatus: storedStatusBefore,
      validationOk: false,
      durationMs: Date.now() - startedAt,
    });
    return riskAssessmentValidationFailure(validation);
  }
  logRiskAssessmentSubmit("validation-passed", {
    riskAssessmentId,
    storedStatus: storedStatusBefore,
    storedVersion: storedVersionBefore,
    validationOk: true,
    hazardCount: (current.hazards || []).length,
    durationMs: Date.now() - startedAt,
  });
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const timestamp = nowIso();
  const submittedBy = normalizeEmail(actor.email);
  const patchResult = await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
    Status: "Submitted",
    SubmittedAt: timestamp,
    SubmittedBy: submittedBy,
    UpdatedAt: timestamp,
    UpdatedBy: submittedBy,
    ...recalculateAssessmentRiskFields(current.hazards),
  });
  logRiskAssessmentSubmit("patch-ack", {
    riskAssessmentId,
    storedStatus: "Submitted",
    storedVersion: storedVersionBefore,
    updatedRows: patchResult?.patched ?? patchResult?.updatedRows ?? 1,
    durationMs: Date.now() - startedAt,
  });
  timer.log("patch-status");
  const rawAfterPatch = await readAssessmentRawRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  const readbackStatus = pickRawAssessmentField(rawAfterPatch, "Status");
  const readbackSubmittedAt = pickRawAssessmentField(rawAfterPatch, "SubmittedAt");
  const readbackSubmittedBy = pickRawAssessmentField(rawAfterPatch, "SubmittedBy");
  const readbackVersion = normalizeAssessmentVersion(pickRawAssessmentField(rawAfterPatch, "Version") || storedVersionBefore);
  logRiskAssessmentSubmit("exact-row-readback", {
    riskAssessmentId,
    storedStatus: readbackStatus,
    storedVersion: readbackVersion,
    submittedAt: Boolean(readbackSubmittedAt),
    submittedBy: Boolean(readbackSubmittedBy),
    durationMs: Date.now() - startedAt,
  });
  if (readbackStatus !== "Submitted" || !readbackSubmittedAt || !readbackSubmittedBy) {
    return healthSafetyApiFailure(
      "RISK_ASSESSMENT_SUBMIT_NOT_VISIBLE",
      "Risk assessment submit could not be confirmed after write.",
      500,
    );
  }
  for (const hazard of current.hazards || []) {
    if (hazard.actionRequired && !trim(hazard.linkedActionId)) {
      const actionResult = await createActionForHazard(auth, deps, resolved, actor, current.item, hazard);
      if (actionResult.actionId) {
        await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_HAZARDS_TAB, "HazardId", hazard.id, {
          LinkedActionId: actionResult.actionId,
          UpdatedAt: timestamp,
          UpdatedBy: submittedBy,
        });
      }
    }
  }
  const detail = await buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId, { timer, skipCache: true });
  logRiskAssessmentSubmit("detail-lookup", {
    riskAssessmentId,
    storedStatus: detail?.item?.status,
    storedVersion: detail?.item?.version,
    submittedAt: Boolean(detail?.item?.submittedAt),
    submittedBy: Boolean(detail?.item?.submittedBy),
    hazardCount: (detail?.hazards || []).length,
    durationMs: Date.now() - startedAt,
  });
  if (!detail?.ok || trim(detail.item?.status) !== "Submitted") {
    return healthSafetyApiFailure(
      "RISK_ASSESSMENT_SUBMIT_NOT_VISIBLE",
      "Risk assessment submit could not be confirmed on detail readback.",
      500,
    );
  }
  timer.log("complete");
  logRiskAssessmentSubmit("complete", {
    riskAssessmentId,
    storedStatus: detail.item.status,
    storedVersion: detail.item.version,
    submittedAt: Boolean(detail.item.submittedAt),
    submittedBy: Boolean(detail.item.submittedBy),
    hazardCount: (detail.hazards || []).length,
    durationMs: Date.now() - startedAt,
  });
  return publishRiskAssessmentListMutation(resolved, "submit", detail, riskAssessmentId);
}

export async function approveCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const mutationTimer = createMutationTimingContext("approve", {
    riskAssessmentId,
    workbookId: resolved.masterSheetId,
  });
  const startedAt = mutationTimer.startedAt;
  mutationTimer.log("pre-read-start");
  const rawBefore = await readAssessmentRawRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  if (!rawBefore) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_NOT_FOUND", "Risk assessment not found.", 404);
  }
  const item = mapRiskAssessmentRecord(rawBefore);
  const hazards = await readAssessmentHazardsForAssessment(auth, deps, resolved.masterSheetId, riskAssessmentId, {
    skipEnsure: true,
  });
  mutationTimer.log("pre-read-complete", { hazardCount: hazards.length });
  const storedStatusBefore = pickRawAssessmentField(rawBefore, "Status") || item.status || "";
  const storedVersionBefore = normalizeAssessmentVersion(
    pickRawAssessmentField(rawBefore, "Version") || item.version || "1.0",
  );
  const submitterEmail = normalizeEmail(item.submittedBy || pickRawAssessmentField(rawBefore, "SubmittedBy"));
  const actorEmail = normalizeEmail(actor.email);
  const sameActorAsSubmitter = Boolean(submitterEmail && actorEmail && submitterEmail === actorEmail);
  logRiskAssessmentApprove("validation-start", {
    riskAssessmentId,
    actorRole: trim(actor.role),
    sameActorAsSubmitter,
    beforeStatus: storedStatusBefore,
    activateNow: input.activateNow !== false,
    durationMs: Date.now() - startedAt,
  });
  const activateNow = input.activateNow !== false;
  const targetStatus = activateNow ? "Active" : "Approved";
  if (storedStatusBefore === "Active" || storedStatusBefore === "Approved") {
    mutationTimer.log("already-approved");
    const freshItem = mapRiskAssessmentRecord(rawBefore);
    logRiskAssessmentApprove("already-approved", {
      riskAssessmentId,
      actorRole: trim(actor.role),
      beforeStatus: storedStatusBefore,
      afterStatus: freshItem.status,
      alreadyApproved: true,
      approvedAt: Boolean(freshItem.approvedAt),
      activatedAt: Boolean(freshItem.activatedAt),
      durationMs: Date.now() - startedAt,
    });
    return publishRiskAssessmentListMutation(
      resolved,
      "approve",
      { ...buildAssessmentMutationResponse(freshItem, hazards, [], []), alreadyApproved: true },
      riskAssessmentId,
    );
  }
  mutationTimer.log("validation-start");
  if (!canApproveRiskAssessment(actor, item)) {
    logRiskAssessmentApprove("permission-denied", {
      riskAssessmentId,
      actorRole: trim(actor.role),
      beforeStatus: storedStatusBefore,
      durationMs: Date.now() - startedAt,
    });
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot approve this assessment.", 403);
  }
  if (!canSelfApproveRiskAssessment(actor, item)) {
    logRiskAssessmentApprove("self-approval-blocked", {
      riskAssessmentId,
      actorRole: trim(actor.role),
      sameActorAsSubmitter: true,
      beforeStatus: storedStatusBefore,
      selfApprovalBlocked: true,
      durationMs: Date.now() - startedAt,
    });
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot approve your own submission.", 403);
  }
  if (storedStatusBefore !== "Submitted" && item.status !== "Submitted") {
    logRiskAssessmentApprove("validation-failed", {
      riskAssessmentId,
      beforeStatus: storedStatusBefore,
      durationMs: Date.now() - startedAt,
    });
    return healthSafetyApiFailure(
      "RISK_ASSESSMENT_VALIDATION",
      "Only submitted assessments can be approved.",
      400,
    );
  }
  const timestamp = nowIso();
  const approvedBy = normalizeEmail(actor.email);
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  mutationTimer.log("assessment-patch-start");
  const patchResult = await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
    Status: targetStatus,
    ApprovedAt: timestamp,
    ApprovedBy: approvedBy,
    ActivatedAt: activateNow ? timestamp : "",
    UpdatedAt: timestamp,
    UpdatedBy: approvedBy,
  });
  mutationTimer.log("assessment-patch-ack", {
    updatedRows: patchResult?.patched ?? patchResult?.updatedRows ?? 1,
  });
  logRiskAssessmentApprove("patch-ack", {
    riskAssessmentId,
    beforeStatus: storedStatusBefore,
    afterStatus: targetStatus,
    activateNow,
    updatedRows: patchResult?.patched ?? patchResult?.updatedRows ?? 1,
    durationMs: Date.now() - startedAt,
  });
  if (trim(item.previousVersionId) && activateNow) {
    await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", item.previousVersionId, {
      Status: "Superseded",
      SupersededAt: timestamp,
      UpdatedAt: timestamp,
      UpdatedBy: approvedBy,
    });
  }
  mutationTimer.log("exact-row-readback-start");
  const rawAfterPatch = await readAssessmentRawRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  const readbackStatus = pickRawAssessmentField(rawAfterPatch, "Status");
  const readbackApprovedAt = pickRawAssessmentField(rawAfterPatch, "ApprovedAt");
  const readbackApprovedBy = pickRawAssessmentField(rawAfterPatch, "ApprovedBy");
  const readbackActivatedAt = pickRawAssessmentField(rawAfterPatch, "ActivatedAt");
  mutationTimer.log("exact-row-readback-complete");
  logRiskAssessmentApprove("exact-row-readback", {
    riskAssessmentId,
    beforeStatus: storedStatusBefore,
    afterStatus: readbackStatus,
    approvedAt: Boolean(readbackApprovedAt),
    activatedAt: Boolean(readbackActivatedAt),
    durationMs: Date.now() - startedAt,
  });
  if (
    readbackStatus !== targetStatus ||
    !readbackApprovedAt ||
    !readbackApprovedBy ||
    (activateNow && !readbackActivatedAt)
  ) {
    return healthSafetyApiFailure(
      "RISK_ASSESSMENT_APPROVE_NOT_VISIBLE",
      "Risk assessment approval could not be confirmed after write.",
      500,
    );
  }
  const updatedItem = mapRiskAssessmentRecord(rawAfterPatch);
  const detailStatus = trim(updatedItem.status);
  mutationTimer.log("response-build-start");
  const response = buildAssessmentMutationResponse(updatedItem, hazards, [], []);
  mutationTimer.log("response-build-complete", { hazardCount: hazards.length });
  logRiskAssessmentApprove("detail-lookup", {
    riskAssessmentId,
    beforeStatus: storedStatusBefore,
    afterStatus: detailStatus,
    approvedAt: Boolean(updatedItem.approvedAt),
    activatedAt: Boolean(updatedItem.activatedAt),
    durationMs: Date.now() - startedAt,
  });
  if (detailStatus !== "Active" && detailStatus !== "Approved") {
    return healthSafetyApiFailure(
      "RISK_ASSESSMENT_APPROVE_NOT_VISIBLE",
      "Risk assessment approval could not be confirmed on detail readback.",
      500,
    );
  }
  if (normalizeAssessmentVersion(updatedItem.version) !== storedVersionBefore) {
    return healthSafetyApiFailure(
      "RISK_ASSESSMENT_APPROVE_NOT_VISIBLE",
      "Risk assessment version changed unexpectedly during approval.",
      500,
    );
  }
  mutationTimer.log("cache-invalidation-start");
  mutationTimer.log("complete");
  logRiskAssessmentApprove("complete", {
    riskAssessmentId,
    actorRole: trim(actor.role),
    sameActorAsSubmitter,
    beforeStatus: storedStatusBefore,
    afterStatus: detailStatus,
    approvedAt: Boolean(updatedItem.approvedAt),
    activatedAt: Boolean(updatedItem.activatedAt),
    durationMs: Date.now() - startedAt,
  });
  return publishRiskAssessmentListMutation(resolved, "approve", response, riskAssessmentId);
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
  return publishRiskAssessmentListMutation(
    resolved,
    "reject",
    await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId),
  );
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
  return publishRiskAssessmentListMutation(
    resolved,
    "archive",
    await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId),
  );
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
  return publishRiskAssessmentListMutation(
    resolved,
    "restore",
    await getCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId),
  );
}

export async function reviewCompanyRiskAssessment(auth, deps, resolved, actor, riskAssessmentId, input = {}) {
  const mutationTimer = createMutationTimingContext("review", {
    riskAssessmentId,
    workbookId: resolved.masterSheetId,
  });
  const startedAt = mutationTimer.startedAt;
  mutationTimer.log("pre-read-start");
  const rawBefore = await readAssessmentRawRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  if (!rawBefore) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_NOT_FOUND", "Risk assessment not found.", 404);
  }
  const item = mapRiskAssessmentRecord(rawBefore);
  const beforeStatus = pickRawAssessmentField(rawBefore, "Status") || item.status || "";
  const beforeVersion = normalizeAssessmentVersion(
    pickRawAssessmentField(rawBefore, "Version") || item.version || "1.0",
  );
  const previousReviewDate = pickRawAssessmentField(rawBefore, "ReviewDate") || item.reviewDate || "";
  const outcome = trim(input.outcome) || "no_change";
  const reviewType = trim(input.reviewType) || "manual";
  const requestedReviewId = trim(input.reviewId) || trim(input.id);
  mutationTimer.log("validation-start");
  logRiskAssessmentReview("validation-start", {
    riskAssessmentId,
    reviewId: requestedReviewId || undefined,
    beforeStatus,
    beforeVersion,
    outcome,
    previousReviewDate,
    durationMs: Date.now() - startedAt,
  });
  if (!canReviewRiskAssessment(actor, item)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_FORBIDDEN", "You cannot review this assessment.", 403);
  }
  if (!RISK_REVIEW_OUTCOMES.includes(outcome)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_VALIDATION", "Invalid review outcome.", 400);
  }
  if (!RISK_REVIEW_TYPES.includes(reviewType)) {
    return healthSafetyApiFailure("RISK_ASSESSMENT_VALIDATION", "Invalid review type.", 400);
  }
  mutationTimer.log("review-tab-read-start");
  const reviewRecords = await readTab(
    auth,
    deps,
    resolved.masterSheetId,
    RISK_ASSESSMENT_REVIEWS_TAB,
    RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS,
  );
  mutationTimer.log("review-tab-read-complete", { reviewHistoryCount: reviewRecords.length });
  if (requestedReviewId) {
    const existingReview = reviewRecords.find((record) => trim(record.ReviewId) === requestedReviewId);
    if (existingReview) {
      mutationTimer.log("already-reviewed");
      const hazards = await readAssessmentHazardsForAssessment(auth, deps, resolved.masterSheetId, riskAssessmentId, {
        skipEnsure: true,
      });
      const reviews = mapReviewRecordsForAssessment(reviewRecords, riskAssessmentId);
      const freshItem = mapRiskAssessmentRecord(rawBefore);
      logRiskAssessmentReview("already-reviewed", {
        riskAssessmentId,
        reviewId: requestedReviewId,
        beforeStatus,
        afterStatus: freshItem.status,
        beforeVersion,
        afterVersion: freshItem.version,
        outcome: trim(existingReview.Outcome),
        nextReviewDate: freshItem.reviewDate,
        reviewHistoryCount: reviews.length,
        alreadyReviewed: true,
        durationMs: Date.now() - startedAt,
      });
      return publishRiskAssessmentListMutation(
        resolved,
        "review",
        { ...buildAssessmentMutationResponse(freshItem, hazards, [], reviews), alreadyReviewed: true },
        riskAssessmentId,
      );
    }
  }
  const timestamp = nowIso();
  const reviewId = requestedReviewId || buildRiskReviewId();
  const nextReviewDate = trim(input.nextReviewDate) || item.reviewDate;
  const reviewRow = {
    ReviewId: reviewId,
    RiskAssessmentId: riskAssessmentId,
    CompanyFolderId: resolved.companyFolderId,
    ReviewDate: trim(input.reviewDate) || getUkTodayKey(),
    ReviewerUserId: normalizeEmail(actor.email),
    ReviewerName: trim(actor.name),
    ReviewType: reviewType,
    Outcome: outcome,
    ChangesRequired: trim(input.changesRequired),
    Summary: trim(input.summary),
    PreviousVersion: beforeVersion,
    NewVersion: outcome === "major_update" ? bumpVersion(beforeVersion, "major") : beforeVersion,
    LinkedIncidentId: trim(input.linkedIncidentId),
    LinkedAuditId: trim(input.linkedAuditId),
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
  };
  mutationTimer.log("review-append-start");
  const appended = await appendAndConfirmReviewRow(auth, deps, resolved, riskAssessmentId, reviewRow);
  if (!appended.ok) return appended;
  mutationTimer.log("review-append-ack", {
    updatedRows: appended.appendResult?.updatedRows,
  });
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  if (outcome === "no_change") {
    mutationTimer.log("assessment-patch-start");
    const patchResult = await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
      ReviewDate: nextReviewDate,
      Status: "Active",
      UpdatedAt: timestamp,
      UpdatedBy: normalizeEmail(actor.email),
    });
    mutationTimer.log("assessment-patch-ack", {
      updatedRows: patchResult?.patched ?? patchResult?.updatedRows ?? 1,
    });
    logRiskAssessmentReview("assessment-patch-ack", {
      riskAssessmentId,
      reviewId,
      beforeStatus,
      afterStatus: "Active",
      beforeVersion,
      afterVersion: beforeVersion,
      outcome,
      nextReviewDate,
      previousReviewDate,
      updatedRows: patchResult?.patched ?? patchResult?.updatedRows ?? 1,
      durationMs: Date.now() - startedAt,
    });
  } else if (outcome === "minor_update") {
    await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RISK_ASSESSMENTS_TAB, "RiskAssessmentId", riskAssessmentId, {
      Version: bumpVersion(beforeVersion, "minor"),
      ReviewDate: nextReviewDate,
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
  mutationTimer.log("exact-row-readback-start");
  const rawAfter = await readAssessmentRawRecord(auth, deps, resolved.masterSheetId, riskAssessmentId);
  const afterStatus = pickRawAssessmentField(rawAfter, "Status") || beforeStatus;
  const afterVersion = normalizeAssessmentVersion(pickRawAssessmentField(rawAfter, "Version") || beforeVersion);
  const afterReviewDate = pickRawAssessmentField(rawAfter, "ReviewDate") || nextReviewDate;
  mutationTimer.log("exact-row-readback-complete");
  logRiskAssessmentReview("assessment-readback", {
    riskAssessmentId,
    reviewId,
    beforeStatus,
    afterStatus,
    beforeVersion,
    afterVersion,
    outcome,
    nextReviewDate: afterReviewDate,
    previousReviewDate,
    durationMs: Date.now() - startedAt,
  });
  if (outcome === "no_change" && (afterStatus !== "Active" || afterVersion !== beforeVersion)) {
    return healthSafetyApiFailure(
      "RISK_REVIEW_NOT_VISIBLE",
      "Risk assessment review could not be confirmed after assessment update.",
      500,
    );
  }
  mutationTimer.log("response-build-start");
  const hazards = await readAssessmentHazardsForAssessment(auth, deps, resolved.masterSheetId, riskAssessmentId, {
    skipEnsure: true,
  });
  const mappedReview = mapRiskReviewRecord(appended.record);
  const reviews = [
    mappedReview,
    ...mapReviewRecordsForAssessment(reviewRecords, riskAssessmentId).filter((entry) => trim(entry.id) !== reviewId),
  ].sort((left, right) => trim(right.createdAt).localeCompare(trim(left.createdAt)));
  const updatedItem = mapRiskAssessmentRecord(rawAfter);
  const response = buildAssessmentMutationResponse(updatedItem, hazards, [], reviews);
  mutationTimer.log("response-build-complete", {
    reviewHistoryCount: reviews.length,
    hazardCount: hazards.length,
  });
  const reviewVisible = reviews.some((entry) => trim(entry.id) === reviewId);
  logRiskAssessmentReview("detail-lookup", {
    riskAssessmentId,
    reviewId,
    beforeStatus,
    afterStatus: updatedItem.status,
    beforeVersion,
    afterVersion: updatedItem.version,
    outcome,
    nextReviewDate: updatedItem.reviewDate,
    previousReviewDate,
    reviewHistoryCount: reviews.length,
    durationMs: Date.now() - startedAt,
  });
  if (!reviewVisible) {
    return healthSafetyApiFailure(
      "RISK_REVIEW_NOT_VISIBLE",
      "Risk assessment review could not be confirmed on detail readback.",
      500,
    );
  }
  mutationTimer.log("complete");
  logRiskAssessmentReview("complete", {
    riskAssessmentId,
    reviewId,
    beforeStatus,
    afterStatus: updatedItem.status,
    beforeVersion,
    afterVersion: updatedItem.version,
    outcome,
    nextReviewDate: updatedItem.reviewDate,
    previousReviewDate,
    reviewHistoryCount: reviews.length,
    durationMs: Date.now() - startedAt,
  });
  return publishRiskAssessmentListMutation(resolved, "review", response, riskAssessmentId);
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
  return publishRiskAssessmentListMutation(
    resolved,
    "new-version",
    await getCompanyRiskAssessment(auth, deps, resolved, actor, created.item.id),
  );
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
  const requestedHazardId = trim(input.id) || trim(input.hazardId);
  logRiskAssessmentHazardPersist("validation-start", {
    riskAssessmentId,
    hazardId: requestedHazardId || undefined,
    workbookId: resolved.masterSheetId,
  });
  const synced = await syncRiskAssessmentHazards(auth, deps, resolved, actor, riskAssessmentId, [input], {
    timer,
    archiveMissingHazards: false,
  });
  if (!synced.ok) return synced;
  const item =
    synced.hazards.find((hazard) => hazard.id === requestedHazardId) || synced.hazards[synced.hazards.length - 1];
  if (!item) {
    return healthSafetyApiFailure("RISK_HAZARD_CREATE_NOT_VISIBLE", "Hazard could not be confirmed after create.", 500);
  }
  const detailLookup = await buildAssessmentDetail(auth, deps, resolved, actor, riskAssessmentId, { timer, skipCache: true });
  logRiskAssessmentHazardPersist("detail-lookup", {
    riskAssessmentId,
    hazardId: item.id,
    workbookId: resolved.masterSheetId,
    fullTabFound: detailLookup?.ok === true && (detailLookup.hazards || []).some((hazard) => hazard.id === item.id),
  });
  if (!detailLookup?.ok) {
    return detailLookup;
  }
  return publishRiskAssessmentListMutation(resolved, "create-hazard", { ok: true, item }, riskAssessmentId);
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
  return publishRiskAssessmentListMutation(resolved, "patch-hazard", { ok: true, item }, current.riskAssessmentId);
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
  return publishRiskAssessmentListMutation(resolved, "archive-hazard", { ok: true, hazardId }, current.riskAssessmentId);
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
  await appendTabRows(auth, deps, resolved.masterSheetId, RISK_ASSESSMENT_LINKS_TAB, RISK_ASSESSMENT_LINKS_TAB_COLUMNS, [row]);
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
  return publishRiskAssessmentListMutation(resolved, "verification-cleanup", {
    ok: true,
    riskAssessmentId: id,
    cleaned: true,
    status: PRODUCTION_VERIFICATION_RA_CLEANED_STATUS,
    cleanedHazards,
    cleanedLinks,
    cleanedActions,
    companyFolderId: resolved.companyFolderId,
    masterSheetId: resolved.masterSheetId,
  });
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
  return publishRiskAssessmentListMutation(resolved, "verification-cleanup-stale", {
    ok: true,
    cleanedCount: cleanedRiskAssessmentIds.length,
    cleanedRiskAssessmentIds,
    cleanedHazards,
    cleanedLinks,
    cleanedActions,
    companyFolderId: resolved.companyFolderId,
    masterSheetId: resolved.masterSheetId,
  });
}

export { resolveCompanyScheduleContext, RISK_ASSESSMENT_REQUIRED_TABS };
