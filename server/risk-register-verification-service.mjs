/**
 * Production verification Risk Register mutations — idempotent create, controls, submit, approve, review, cleanup.
 */
import { calculateRiskScore, getRiskBand } from "../shared/risk-assessments.mjs";
import {
  RISK_REGISTER_CONTROLS_TAB,
  RISK_REGISTER_CONTROLS_TAB_COLUMNS,
  RISK_REGISTER_REVIEWS_TAB,
  RISK_REGISTER_REVIEWS_TAB_COLUMNS,
  RISK_REGISTER_TAB,
  RISK_REGISTER_TAB_COLUMNS,
  buildRiskRegisterReviewId,
  mapRiskRegisterControlRecord,
  mapRiskRegisterRecord,
  mapRiskRegisterReviewRecord,
  normalizeRiskRegisterDateKey,
} from "../shared/risk-register.mjs";
import {
  buildProductionVerificationRiskRegister,
  isActiveVerificationRiskRegisterItem,
  isVerificationRiskRegisterControlId,
  isVerificationRiskRegisterId,
  isVerificationRiskRegisterItem,
  PRODUCTION_VERIFICATION_RISK_REGISTER_CLEANED_MARKER,
  PRODUCTION_VERIFICATION_RISK_REGISTER_NOTES_MARKER,
  PRODUCTION_VERIFICATION_RISK_REGISTER_REVIEW_SUMMARY,
  PRODUCTION_VERIFICATION_RISK_REGISTER_SOURCE,
  riskApprovedMarker,
  riskReviewedMarker,
  riskSubmittedMarker,
} from "../shared/production-verification-risk-register.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import { canManageHealthSafety, healthSafetyApiFailure } from "./health-safety-service.mjs";
import {
  ensureRiskRegisterTabs,
  loadRiskRegisterContext,
} from "./risk-register-service.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
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

function resolvePatchTabRowByHeader(deps) {
  return typeof deps?.patchTabRowByHeader === "function" ? deps.patchTabRowByHeader : workbookPatchTabRowByHeader;
}

export function logRiskRegisterMutationTiming(operation, stage, details = {}) {
  console.info("[risk-register:mutation-timing]", {
    operation,
    stage,
    riskId: trim(details.riskId) || undefined,
    controlId: trim(details.controlId) || undefined,
    workbookId: trim(details.workbookId) || undefined,
    updatedRows: Number(details.updatedRows) || 0,
    durationMs: Number(details.durationMs) || 0,
    totalMs: Number(details.totalMs) || 0,
  });
}

function appendVerificationMarker(existing = "", marker = "") {
  const base = trim(existing);
  if (!base) {
    return marker;
  }
  if (base.includes(marker)) {
    return base;
  }
  return `${base} ${marker}`;
}

function riskRowFromPayload(payload = {}, actor = {}, companyFolderId = "", timestamp = nowIso()) {
  const initialLikelihood = Number(payload.initialLikelihood || 0);
  const initialImpact = Number(payload.initialImpact || 0);
  const residualLikelihood = Number(payload.residualLikelihood || 0);
  const residualImpact = Number(payload.residualImpact || 0);
  const initialRiskScore = Number(payload.initialRiskScore) || calculateRiskScore(initialLikelihood, initialImpact);
  const residualRiskScore = Number(payload.residualRiskScore) || calculateRiskScore(residualLikelihood, residualImpact);
  return {
    RiskId: trim(payload.riskId),
    CompanyFolderId: companyFolderId,
    RiskReference: trim(payload.riskReference),
    Title: trim(payload.title),
    Description: trim(payload.description),
    Category: trim(payload.category),
    Department: trim(payload.department),
    SiteId: trim(payload.siteId),
    OwnerUserId: trim(payload.ownerUserId),
    OwnerName: trim(payload.ownerName) || trim(actor.name) || normalizeEmail(actor.email),
    Cause: trim(payload.cause),
    Consequence: trim(payload.consequence),
    InitialLikelihood: String(initialLikelihood || ""),
    InitialImpact: String(initialImpact || ""),
    InitialRiskScore: String(initialRiskScore || ""),
    InitialRiskBand: trim(payload.initialRiskBand) || getRiskBand(initialRiskScore).label,
    ResidualLikelihood: String(residualLikelihood || ""),
    ResidualImpact: String(residualImpact || ""),
    ResidualRiskScore: String(residualRiskScore || ""),
    ResidualRiskBand: trim(payload.residualRiskBand) || getRiskBand(residualRiskScore).label,
    Status: trim(payload.status) || "Draft",
    ReviewDate: normalizeRiskRegisterDateKey(payload.reviewDate),
    SubmittedAt: trim(payload.submittedAt),
    SubmittedBy: trim(payload.submittedBy),
    ApprovedAt: trim(payload.approvedAt),
    ApprovedBy: trim(payload.approvedBy),
    Notes: trim(payload.notes),
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  };
}

function controlRowFromPayload(payload = {}, actor = {}, companyFolderId = "", timestamp = nowIso()) {
  return {
    ControlId: trim(payload.controlId),
    RiskId: trim(payload.riskId),
    CompanyFolderId: companyFolderId,
    ControlType: trim(payload.controlType),
    Description: trim(payload.description),
    OwnerName: trim(payload.ownerName),
    DueDate: normalizeRiskRegisterDateKey(payload.dueDate),
    SortOrder: String(Number(payload.sortOrder) || 0),
    Status: trim(payload.status) || "active",
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  };
}

async function findVerificationRiskParent(auth, deps, loaded, riskId) {
  const target = trim(riskId);
  let parent = loaded.risks.find((item) => trim(item.id) === target);
  if (parent && isVerificationRiskRegisterItem(parent)) {
    return parent;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const readTabRecords = resolveReadTabRecords(deps);
    const riskRecords = await readTabRecords(auth, deps, loaded.masterSheetId, RISK_REGISTER_TAB, {
      expectedHeaders: RISK_REGISTER_TAB_COLUMNS,
    });
    const risks = (riskRecords?.records || riskRecords || [])
      .map((record) => mapRiskRegisterRecord(record, { todayKey: loaded.todayKey }))
      .filter((item) => item.id);
    parent = risks.find((item) => trim(item.id) === target);
    if (parent && isVerificationRiskRegisterItem(parent)) {
      return parent;
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return parent || null;
}

export async function createVerificationRiskRegisterItem(auth, deps, actor, companyFolderId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("RISK_REGISTER_FORBIDDEN", "You do not have permission to create verification risks.", 403);
  }
  const riskId = trim(input.riskId);
  if (!isVerificationRiskRegisterId(riskId)) {
    return healthSafetyApiFailure("RISK_REGISTER_NOT_VERIFICATION", "Risk ID must use the verification prefix.", 400);
  }
  const loaded = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const existing = loaded.risks.find((item) => trim(item.id) === riskId);
  if (existing && isVerificationRiskRegisterItem(existing)) {
    logRiskRegisterMutationTiming("create", "idempotent", {
      riskId,
      workbookId: loaded.masterSheetId,
      updatedRows: 0,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return { ok: true, item: existing, alreadyExists: true, updatedRows: 0 };
  }
  const timestamp = nowIso();
  const row = riskRowFromPayload(input, actor, loaded.companyFolderId, timestamp);
  const appendTabRows = resolveAppendTabRows(deps);
  const writeResult = await appendTabRows(auth, deps, loaded.masterSheetId, RISK_REGISTER_TAB, RISK_REGISTER_TAB_COLUMNS, [row]);
  const written = Number(writeResult?.written) || 0;
  if (written <= 0) {
    return healthSafetyApiFailure("RISK_REGISTER_WRITE_ZERO_ROWS", "Risk create returned zero-row acknowledgement.", 500);
  }
  logRiskRegisterMutationTiming("create", "risk", {
    riskId,
    workbookId: loaded.masterSheetId,
    updatedRows: written,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item: mapRiskRegisterRecord(row, { todayKey: loaded.todayKey }), updatedRows: written };
}

export async function patchVerificationRiskRegisterItem(auth, deps, actor, companyFolderId, riskId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("RISK_REGISTER_FORBIDDEN", "You do not have permission to update verification risks.", 403);
  }
  const id = trim(riskId);
  if (!isVerificationRiskRegisterId(id)) {
    return healthSafetyApiFailure("RISK_REGISTER_NOT_VERIFICATION", "Only verification risks can be patched through this path.", 403);
  }
  const loaded = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const current = loaded.risks.find((item) => trim(item.id) === id);
  if (!current || !isVerificationRiskRegisterItem(current)) {
    return healthSafetyApiFailure("RISK_REGISTER_NOT_FOUND", "Verification risk not found.", 404);
  }
  const initialLikelihood = Number(input.initialLikelihood ?? current.initialLikelihood);
  const initialImpact = Number(input.initialImpact ?? current.initialImpact);
  const residualLikelihood = Number(input.residualLikelihood ?? current.residualLikelihood);
  const residualImpact = Number(input.residualImpact ?? current.residualImpact);
  const initialRiskScore = calculateRiskScore(initialLikelihood, initialImpact);
  const residualRiskScore = calculateRiskScore(residualLikelihood, residualImpact);
  const patch = {
    Title: input.title ?? current.title,
    Description: input.description ?? current.description,
    Category: input.category ?? current.category,
    Department: input.department ?? current.department,
    SiteId: input.siteId ?? current.siteId,
    OwnerName: input.ownerName ?? current.ownerName,
    Cause: input.cause ?? current.cause,
    Consequence: input.consequence ?? current.consequence,
    InitialLikelihood: String(initialLikelihood || ""),
    InitialImpact: String(initialImpact || ""),
    InitialRiskScore: String(initialRiskScore || ""),
    InitialRiskBand: getRiskBand(initialRiskScore).label,
    ResidualLikelihood: String(residualLikelihood || ""),
    ResidualImpact: String(residualImpact || ""),
    ResidualRiskScore: String(residualRiskScore || ""),
    ResidualRiskBand: getRiskBand(residualRiskScore).label,
    ReviewDate: normalizeRiskRegisterDateKey(input.reviewDate ?? current.reviewDate),
    Notes: input.notes ?? current.notes,
    UpdatedAt: nowIso(),
    UpdatedBy: normalizeEmail(actor.email),
  };
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, RISK_REGISTER_TAB, "RiskId", id, patch);
  const refreshed = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: loaded.masterSheetId });
  const item = refreshed.risks.find((entry) => trim(entry.id) === id);
  logRiskRegisterMutationTiming("patch", "risk", {
    riskId: id,
    workbookId: loaded.masterSheetId,
    updatedRows: 1,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item };
}

export async function upsertVerificationRiskRegisterControl(auth, deps, actor, companyFolderId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("RISK_REGISTER_FORBIDDEN", "You do not have permission to manage verification controls.", 403);
  }
  const controlId = trim(input.controlId);
  const riskId = trim(input.riskId);
  if (!isVerificationRiskRegisterControlId(controlId) || !isVerificationRiskRegisterId(riskId)) {
    return healthSafetyApiFailure("RISK_REGISTER_NOT_VERIFICATION", "Control and risk IDs must use verification prefixes.", 400);
  }
  const loaded = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const parent = await findVerificationRiskParent(auth, deps, loaded, riskId);
  if (!parent || !isVerificationRiskRegisterItem(parent)) {
    return healthSafetyApiFailure("RISK_REGISTER_NOT_FOUND", "Verification risk parent not found.", 404);
  }
  const existing = loaded.controls.find((item) => trim(item.id) === controlId);
  if (existing && isVerificationRiskRegisterControlId(existing.id)) {
    const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
    await patchTabRowByHeader(auth, deps, loaded.masterSheetId, RISK_REGISTER_CONTROLS_TAB, "ControlId", controlId, {
      Description: input.description ?? existing.description,
      OwnerName: input.ownerName ?? existing.ownerName,
      DueDate: normalizeRiskRegisterDateKey(input.dueDate ?? existing.dueDate),
      ControlType: input.controlType ?? existing.controlType,
      UpdatedAt: nowIso(),
      UpdatedBy: normalizeEmail(actor.email),
    });
    const refreshed = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: loaded.masterSheetId });
    const item = refreshed.controls.find((entry) => trim(entry.id) === controlId);
    logRiskRegisterMutationTiming("patch", "control", {
      riskId,
      controlId,
      workbookId: loaded.masterSheetId,
      updatedRows: 1,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return { ok: true, item, alreadyExists: true, updatedRows: 1 };
  }
  const timestamp = nowIso();
  const row = controlRowFromPayload(input, actor, loaded.companyFolderId, timestamp);
  const appendTabRows = resolveAppendTabRows(deps);
  const writeResult = await appendTabRows(auth, deps, loaded.masterSheetId, RISK_REGISTER_CONTROLS_TAB, RISK_REGISTER_CONTROLS_TAB_COLUMNS, [row]);
  const written = Number(writeResult?.written) || 0;
  if (written <= 0) {
    return healthSafetyApiFailure("RISK_REGISTER_WRITE_ZERO_ROWS", "Control create returned zero-row acknowledgement.", 500);
  }
  logRiskRegisterMutationTiming("create", "control", {
    riskId,
    controlId,
    workbookId: loaded.masterSheetId,
    updatedRows: written,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item: mapRiskRegisterControlRecord(row), updatedRows: written };
}

export async function submitVerificationRiskRegisterItem(auth, deps, actor, companyFolderId, riskId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("RISK_REGISTER_FORBIDDEN", "You do not have permission to submit verification risks.", 403);
  }
  const id = trim(riskId);
  const loaded = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const current = loaded.risks.find((item) => trim(item.id) === id);
  if (!current || !isVerificationRiskRegisterItem(current)) {
    return healthSafetyApiFailure("RISK_REGISTER_NOT_FOUND", "Verification risk not found.", 404);
  }
  if (riskSubmittedMarker(current.notes) || normalize(current.status) === "submitted") {
    logRiskRegisterMutationTiming("submit", "idempotent", {
      riskId: id,
      workbookId: loaded.masterSheetId,
      updatedRows: 0,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return { ok: true, item: current, alreadySubmitted: true, updatedRows: 0 };
  }
  if (normalize(current.status) !== "draft") {
    return healthSafetyApiFailure("RISK_REGISTER_NOT_DRAFT", "Only draft risks can be submitted.", 400);
  }
  const timestamp = nowIso();
  const submitMarker = `${PRODUCTION_VERIFICATION_RISK_REGISTER_NOTES_MARKER} submitted=true submittedAt=${timestamp}`;
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, RISK_REGISTER_TAB, "RiskId", id, {
    Status: "Submitted",
    SubmittedAt: timestamp,
    SubmittedBy: normalizeEmail(actor.email),
    Notes: appendVerificationMarker(current.notes, submitMarker),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  const refreshed = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: loaded.masterSheetId });
  const item = refreshed.risks.find((entry) => trim(entry.id) === id);
  logRiskRegisterMutationTiming("submit", "submit", {
    riskId: id,
    workbookId: loaded.masterSheetId,
    updatedRows: 1,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item, updatedRows: 1 };
}

export async function approveVerificationRiskRegisterItem(auth, deps, actor, companyFolderId, riskId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("RISK_REGISTER_FORBIDDEN", "You do not have permission to approve verification risks.", 403);
  }
  const id = trim(riskId);
  const loaded = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const current = loaded.risks.find((item) => trim(item.id) === id);
  if (!current || !isVerificationRiskRegisterItem(current)) {
    return healthSafetyApiFailure("RISK_REGISTER_NOT_FOUND", "Verification risk not found.", 404);
  }
  if (riskApprovedMarker(current.notes) || normalize(current.status) === "active") {
    logRiskRegisterMutationTiming("approve", "idempotent", {
      riskId: id,
      workbookId: loaded.masterSheetId,
      updatedRows: 0,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return { ok: true, item: current, alreadyApproved: true, updatedRows: 0 };
  }
  if (!riskSubmittedMarker(current.notes) && normalize(current.status) !== "submitted") {
    return healthSafetyApiFailure("RISK_REGISTER_NOT_SUBMITTED", "Risk must be submitted before approval.", 400);
  }
  const timestamp = nowIso();
  const approveMarker = `${PRODUCTION_VERIFICATION_RISK_REGISTER_NOTES_MARKER} approved=true approvedAt=${timestamp}`;
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, RISK_REGISTER_TAB, "RiskId", id, {
    Status: "Active",
    ApprovedAt: timestamp,
    ApprovedBy: normalizeEmail(actor.email),
    Notes: appendVerificationMarker(current.notes, approveMarker),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  const refreshed = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: loaded.masterSheetId });
  const item = refreshed.risks.find((entry) => trim(entry.id) === id);
  logRiskRegisterMutationTiming("approve", "approve", {
    riskId: id,
    workbookId: loaded.masterSheetId,
    updatedRows: 1,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item, updatedRows: 1 };
}

export async function reviewVerificationRiskRegisterItem(auth, deps, actor, companyFolderId, riskId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("RISK_REGISTER_FORBIDDEN", "You do not have permission to review verification risks.", 403);
  }
  const id = trim(riskId);
  const loaded = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const current = loaded.risks.find((item) => trim(item.id) === id);
  if (!current || !isVerificationRiskRegisterItem(current)) {
    return healthSafetyApiFailure("RISK_REGISTER_NOT_FOUND", "Verification risk not found.", 404);
  }
  if (riskReviewedMarker(current.notes)) {
    logRiskRegisterMutationTiming("review", "idempotent", {
      riskId: id,
      workbookId: loaded.masterSheetId,
      updatedRows: 0,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return { ok: true, item: current, alreadyReviewed: true, updatedRows: 0 };
  }
  if (normalize(current.status) !== "active") {
    return healthSafetyApiFailure("RISK_REGISTER_NOT_ACTIVE", "Only active risks can be reviewed.", 400);
  }
  const nextReviewDate = normalizeRiskRegisterDateKey(input.reviewDate) || normalizeRiskRegisterDateKey(current.reviewDate);
  const timestamp = nowIso();
  const reviewMarker = `${PRODUCTION_VERIFICATION_RISK_REGISTER_NOTES_MARKER} reviewed=true reviewedAt=${timestamp} reviewSummary=${PRODUCTION_VERIFICATION_RISK_REGISTER_REVIEW_SUMMARY}`;
  const reviewId = buildRiskRegisterReviewId();
  const reviewRow = {
    ReviewId: reviewId,
    RiskId: id,
    CompanyFolderId: loaded.companyFolderId,
    ReviewDate: getUkTodayKey(),
    ReviewerName: trim(actor.name) || normalizeEmail(actor.email),
    Outcome: trim(input.outcome) || "no_change",
    Summary: trim(input.summary) || PRODUCTION_VERIFICATION_RISK_REGISTER_REVIEW_SUMMARY,
    NextReviewDate: nextReviewDate,
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
  };
  const appendTabRows = resolveAppendTabRows(deps);
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await appendTabRows(auth, deps, loaded.masterSheetId, RISK_REGISTER_REVIEWS_TAB, RISK_REGISTER_REVIEWS_TAB_COLUMNS, [reviewRow]);
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, RISK_REGISTER_TAB, "RiskId", id, {
    ReviewDate: nextReviewDate,
    Notes: appendVerificationMarker(current.notes, reviewMarker),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  const refreshed = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: loaded.masterSheetId });
  const item = refreshed.risks.find((entry) => trim(entry.id) === id);
  logRiskRegisterMutationTiming("review", "review", {
    riskId: id,
    workbookId: loaded.masterSheetId,
    updatedRows: 2,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item, review: mapRiskRegisterReviewRecord(reviewRow), updatedRows: 2 };
}

async function archiveVerificationControlsForRisk(auth, deps, masterSheetId, actor, companyFolderId, riskId, timestamp) {
  const loaded = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId });
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  let cleaned = 0;
  for (const control of loaded.controls) {
    if (trim(control.riskId) !== trim(riskId) || !isVerificationRiskRegisterControlId(control.id)) {
      continue;
    }
    await patchTabRowByHeader(auth, deps, masterSheetId, RISK_REGISTER_CONTROLS_TAB, "ControlId", control.id, {
      Status: PRODUCTION_VERIFICATION_RISK_REGISTER_CLEANED_MARKER,
      ArchivedAt: timestamp,
      ArchivedBy: normalizeEmail(actor.email),
      UpdatedAt: timestamp,
      UpdatedBy: normalizeEmail(actor.email),
    });
    cleaned += 1;
  }
  return cleaned;
}

export async function cleanupVerificationRiskRegisterItem(auth, deps, actor, companyFolderId, riskId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("RISK_REGISTER_FORBIDDEN", "You do not have permission to clean up verification risks.", 403);
  }
  const id = trim(riskId);
  if (!isVerificationRiskRegisterId(id)) {
    return healthSafetyApiFailure("CLEANUP_NOT_VERIFICATION_RISK", "Only verification risks can be cleaned up through this path.", 403);
  }
  const loaded = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const current = loaded.risks.find((item) => trim(item.id) === id);
  if (!current) {
    return { ok: true, cleaned: false, alreadyCleaned: true, riskId: id };
  }
  if (!isVerificationRiskRegisterItem(current)) {
    return healthSafetyApiFailure("CLEANUP_NOT_VERIFICATION_RISK", "Only verification risks can be cleaned up through this path.", 403);
  }
  const notes = trim(current.notes);
  const description = trim(current.description);
  if (
    normalize(notes).includes(PRODUCTION_VERIFICATION_RISK_REGISTER_CLEANED_MARKER) ||
    normalize(description).includes(PRODUCTION_VERIFICATION_RISK_REGISTER_CLEANED_MARKER) ||
    current.archivedAt
  ) {
    return { ok: true, cleaned: false, alreadyCleaned: true, riskId: id };
  }
  const timestamp = nowIso();
  const cleanedControls = await archiveVerificationControlsForRisk(auth, deps, loaded.masterSheetId, actor, loaded.companyFolderId, id, timestamp);
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, RISK_REGISTER_TAB, "RiskId", id, {
    ArchivedAt: timestamp,
    ArchivedBy: normalizeEmail(actor.email),
    Status: "Archived",
    Description: appendVerificationMarker(description, PRODUCTION_VERIFICATION_RISK_REGISTER_CLEANED_MARKER),
    Notes: appendVerificationMarker(notes, PRODUCTION_VERIFICATION_RISK_REGISTER_CLEANED_MARKER),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  logRiskRegisterMutationTiming("cleanup", "single", {
    riskId: id,
    workbookId: loaded.masterSheetId,
    updatedRows: 1 + cleanedControls,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, cleaned: true, riskId: id, cleanedControls, updatedRows: 1 + cleanedControls };
}

export async function cleanupStaleVerificationRiskRegister(auth, deps, actor, companyFolderId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("RISK_REGISTER_FORBIDDEN", "You do not have permission to clean up verification risks.", 403);
  }
  const loaded = await loadRiskRegisterContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const keepRiskId = trim(input.keepRiskId);
  const stale = loaded.risks.filter((item) => {
    if (!isActiveVerificationRiskRegisterItem(item)) {
      return false;
    }
    if (keepRiskId && trim(item.id) === keepRiskId) {
      return false;
    }
    return true;
  });
  const results = [];
  for (const item of stale) {
    const cleaned = await cleanupVerificationRiskRegisterItem(auth, deps, actor, companyFolderId, item.id, input);
    results.push({ riskId: item.id, ok: cleaned.ok, alreadyCleaned: Boolean(cleaned.alreadyCleaned) });
  }
  logRiskRegisterMutationTiming("cleanup", "stale-cleanup", {
    workbookId: loaded.masterSheetId,
    updatedRows: results.filter((item) => item.ok).length,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, results, cleanedCount: results.filter((item) => item.ok).length };
}
