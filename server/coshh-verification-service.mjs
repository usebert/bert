/**
 * Production verification COSHH mutations — idempotent create, submit, approve, review, cleanup.
 */
import {
  COSHH_ASSESSMENTS_TAB,
  COSHH_ASSESSMENTS_TAB_COLUMNS,
  COSHH_REGISTER_TAB,
  COSHH_REGISTER_TAB_COLUMNS,
  calculateRiskScore,
  mapCoshhAssessmentRecord,
  mapCoshhRegisterRecord,
  normalizeHealthSafetyDateKey,
} from "../shared/health-safety.mjs";
import {
  assessmentReviewedMarker,
  assessmentSubmittedMarker,
  buildProductionVerificationCoshhAssessment,
  buildProductionVerificationCoshhSubstance,
  isActiveVerificationCoshhAssessment,
  isActiveVerificationCoshhRegister,
  isVerificationCoshhAssessment,
  isVerificationCoshhAssessmentId,
  isVerificationCoshhId,
  isVerificationCoshhRegister,
  PRODUCTION_VERIFICATION_COSHH_CLEANED_MARKER,
  PRODUCTION_VERIFICATION_COSHH_NOTES_MARKER,
  PRODUCTION_VERIFICATION_COSHH_REVIEW_SUMMARY,
  PRODUCTION_VERIFICATION_COSHH_SOURCE,
} from "../shared/production-verification-coshh.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import {
  canManageHealthSafety,
  ensureHealthSafetyTabs,
  healthSafetyApiFailure,
} from "./health-safety-service.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
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

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

function resolvePatchTabRowByHeader(deps) {
  return typeof deps?.patchTabRowByHeader === "function" ? deps.patchTabRowByHeader : workbookPatchTabRowByHeader;
}

export function logCoshhMutationTiming(operation, stage, details = {}) {
  console.info("[coshh:mutation-timing]", {
    operation,
    stage,
    coshhId: trim(details.coshhId) || undefined,
    substanceId: trim(details.substanceId) || undefined,
    assessmentId: trim(details.assessmentId) || undefined,
    workbookId: trim(details.workbookId) || undefined,
    updatedRows: Number(details.updatedRows) || 0,
    durationMs: Number(details.durationMs) || 0,
    totalMs: Number(details.totalMs) || 0,
  });
}

async function readRegisterRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, COSHH_REGISTER_TAB, {
    expectedHeaders: COSHH_REGISTER_TAB_COLUMNS,
  });
  return result?.records || [];
}

async function readAssessmentRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, COSHH_ASSESSMENTS_TAB, {
    expectedHeaders: COSHH_ASSESSMENTS_TAB_COLUMNS,
  });
  return result?.records || [];
}

function mapRegisterRecordsSafely(records = []) {
  const items = [];
  for (const record of records) {
    try {
      const mapped = mapCoshhRegisterRecord(record);
      if (mapped?.id) {
        items.push(mapped);
      }
    } catch {
      /* skip malformed */
    }
  }
  return items;
}

function mapAssessmentRecordsSafely(records = []) {
  const items = [];
  for (const record of records) {
    try {
      const mapped = mapCoshhAssessmentRecord(record);
      if (mapped?.id) {
        items.push(mapped);
      }
    } catch {
      /* skip malformed */
    }
  }
  return items;
}

async function findVerificationCoshhParent(auth, deps, loaded, coshhId) {
  const target = trim(coshhId);
  let parent = loaded.register.find((item) => trim(item.id) === target);
  if (parent && isVerificationCoshhRegister(parent)) {
    return parent;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const registerRecords = await readRegisterRecords(auth, deps, loaded.masterSheetId);
    parent = mapRegisterRecordsSafely(registerRecords).find((item) => trim(item.id) === target);
    if (parent && isVerificationCoshhRegister(parent)) {
      return parent;
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return parent || null;
}

async function loadCoshhContext(auth, deps, input = {}) {
  const resolved = await resolveCompanyScheduleContext(auth, deps, input);
  if (!resolved.ok) {
    return resolved;
  }
  const masterSheetId = trim(resolved.masterSheetId);
  await ensureHealthSafetyTabs(auth, deps, masterSheetId);
  const [registerRecords, assessmentRecords] = await Promise.all([
    readRegisterRecords(auth, deps, masterSheetId),
    readAssessmentRecords(auth, deps, masterSheetId),
  ]);
  return {
    ok: true,
    companyFolderId: resolved.companyFolderId,
    masterSheetId,
    register: mapRegisterRecordsSafely(registerRecords),
    assessments: mapAssessmentRecordsSafely(assessmentRecords),
    registerRecords,
    assessmentRecords,
  };
}

function registerRowFromPayload(payload = {}, actor = {}, companyFolderId = "", timestamp = nowIso()) {
  return {
    CoshhId: trim(payload.coshhId),
    CompanyFolderId: companyFolderId,
    ProductName: trim(payload.productName),
    Manufacturer: trim(payload.manufacturer),
    Supplier: trim(payload.supplier),
    ProductCode: trim(payload.productCode),
    Description: trim(payload.description),
    PhysicalForm: trim(payload.physicalForm),
    SignalWord: trim(payload.signalWord),
    HazardPictograms: trim(payload.hazardPictograms),
    HazardStatements: trim(payload.hazardStatements),
    PrecautionaryStatements: trim(payload.precautionaryStatements),
    PrimaryUse: trim(payload.primaryUse),
    SiteId: trim(payload.siteId),
    AreaId: trim(payload.areaId),
    StorageLocation: trim(payload.storageLocation),
    SdsDocumentId: trim(payload.sdsDocumentId),
    SdsFileName: trim(payload.sdsFileName),
    SdsIssueDate: normalizeHealthSafetyDateKey(payload.sdsIssueDate),
    SdsVersion: trim(payload.sdsVersion),
    AssessmentRequired: String(Boolean(payload.assessmentRequired)),
    ApprovedForUse: String(Boolean(payload.approvedForUse)),
    Status: "current",
    ReviewDate: normalizeHealthSafetyDateKey(payload.reviewDate),
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  };
}

function assessmentRowFromPayload(payload = {}, actor = {}, companyFolderId = "", timestamp = nowIso()) {
  const initialLikelihood = Number(payload.initialLikelihood || 0);
  const initialSeverity = Number(payload.initialSeverity || 0);
  const residualLikelihood = Number(payload.residualLikelihood || 0);
  const residualSeverity = Number(payload.residualSeverity || 0);
  return {
    AssessmentId: trim(payload.assessmentId),
    CoshhId: trim(payload.coshhId),
    CompanyFolderId: companyFolderId,
    AssessmentTitle: trim(payload.assessmentTitle),
    Activity: trim(payload.activity),
    PersonsAtRisk: trim(payload.personsAtRisk),
    FrequencyOfUse: trim(payload.frequencyOfUse),
    QuantityUsed: trim(payload.quantityUsed),
    DurationOfExposure: trim(payload.durationOfExposure),
    ExposureRoutes: trim(payload.exposureRoutes),
    Hazards: trim(payload.hazards),
    ExistingControls: trim(payload.existingControls),
    EngineeringControls: trim(payload.engineeringControls),
    PpeRequired: trim(payload.ppeRequired),
    StorageControls: trim(payload.storageControls),
    SpillProcedure: trim(payload.spillProcedure),
    FirstAid: trim(payload.firstAid),
    FireResponse: trim(payload.fireResponse),
    DisposalMethod: trim(payload.disposalMethod),
    EmergencyActions: trim(payload.emergencyActions),
    InitialLikelihood: String(initialLikelihood || ""),
    InitialSeverity: String(initialSeverity || ""),
    InitialRiskScore: String(calculateRiskScore(initialLikelihood, initialSeverity) || ""),
    ResidualLikelihood: String(residualLikelihood || ""),
    ResidualSeverity: String(residualSeverity || ""),
    ResidualRiskScore: String(calculateRiskScore(residualLikelihood, residualSeverity) || ""),
    AdditionalActions: trim(payload.additionalActions),
    AssessorName: trim(payload.assessorName) || trim(actor.name) || normalizeEmail(actor.email),
    AssessmentDate: normalizeHealthSafetyDateKey(payload.assessmentDate) || getUkTodayKey(),
    ReviewDate: normalizeHealthSafetyDateKey(payload.reviewDate),
    Status: trim(payload.status) || "draft",
    ApprovedBy: trim(payload.approvedBy),
    ApprovedAt: trim(payload.approvedAt),
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  };
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

export async function createVerificationCoshhSubstance(auth, deps, actor, companyFolderId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("COSHH_FORBIDDEN", "You do not have permission to create verification COSHH records.", 403);
  }
  const coshhId = trim(input.coshhId);
  if (!isVerificationCoshhId(coshhId)) {
    return healthSafetyApiFailure("COSHH_NOT_VERIFICATION", "COSHH ID must use the verification prefix.", 400);
  }
  const loaded = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const existing = loaded.register.find((item) => trim(item.id) === coshhId);
  if (existing && isVerificationCoshhRegister(existing)) {
    logCoshhMutationTiming("create", "idempotent", {
      coshhId,
      substanceId: coshhId,
      workbookId: loaded.masterSheetId,
      updatedRows: 0,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return { ok: true, item: existing, alreadyExists: true, updatedRows: 0 };
  }
  const timestamp = nowIso();
  const row = registerRowFromPayload(input, actor, loaded.companyFolderId, timestamp);
  const appendTabRows = resolveAppendTabRows(deps);
  const writeResult = await appendTabRows(auth, deps, loaded.masterSheetId, COSHH_REGISTER_TAB, COSHH_REGISTER_TAB_COLUMNS, [row]);
  const written = Number(writeResult?.written) || 0;
  if (written <= 0) {
    return healthSafetyApiFailure("COSHH_WRITE_ZERO_ROWS", "COSHH substance create returned zero-row acknowledgement.", 500);
  }
  logCoshhMutationTiming("create", "substance", {
    coshhId,
    substanceId: coshhId,
    workbookId: loaded.masterSheetId,
    updatedRows: written,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item: mapCoshhRegisterRecord(row), updatedRows: written };
}

export async function patchVerificationCoshhSubstance(auth, deps, actor, companyFolderId, coshhId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("COSHH_FORBIDDEN", "You do not have permission to update verification COSHH records.", 403);
  }
  const id = trim(coshhId);
  if (!isVerificationCoshhId(id)) {
    return healthSafetyApiFailure("COSHH_NOT_VERIFICATION", "Only verification COSHH records can be patched through this path.", 403);
  }
  const loaded = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const current = loaded.register.find((item) => trim(item.id) === id);
  if (!current || !isVerificationCoshhRegister(current)) {
    return healthSafetyApiFailure("COSHH_NOT_FOUND", "Verification COSHH record not found.", 404);
  }
  const patch = {
    ProductName: input.productName ?? current.productName,
    Supplier: input.supplier ?? current.supplier,
    PrimaryUse: input.primaryUse ?? current.primaryUse,
    StorageLocation: input.storageLocation ?? current.storageLocation,
    SignalWord: input.signalWord ?? current.signalWord,
    HazardStatements: input.hazardStatements ?? current.hazardStatements,
    PrecautionaryStatements: input.precautionaryStatements ?? current.precautionaryStatements,
    ReviewDate: normalizeHealthSafetyDateKey(input.reviewDate ?? current.reviewDate),
    SdsDocumentId: input.sdsDocumentId ?? current.sdsDocumentId,
    SdsFileName: input.sdsFileName ?? current.sdsFileName,
    SdsIssueDate: normalizeHealthSafetyDateKey(input.sdsIssueDate ?? current.sdsIssueDate),
    SdsVersion: input.sdsVersion ?? current.sdsVersion,
    UpdatedAt: nowIso(),
    UpdatedBy: normalizeEmail(actor.email),
  };
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, COSHH_REGISTER_TAB, "CoshhId", id, patch);
  const refreshed = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: loaded.masterSheetId });
  const item = refreshed.register.find((entry) => trim(entry.id) === id);
  logCoshhMutationTiming("patch", "substance", {
    coshhId: id,
    substanceId: id,
    workbookId: loaded.masterSheetId,
    updatedRows: 1,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item };
}

export async function createVerificationCoshhAssessment(auth, deps, actor, companyFolderId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("COSHH_FORBIDDEN", "You do not have permission to create verification assessments.", 403);
  }
  const assessmentId = trim(input.assessmentId);
  const coshhId = trim(input.coshhId);
  if (!isVerificationCoshhAssessmentId(assessmentId) || !isVerificationCoshhId(coshhId)) {
    return healthSafetyApiFailure("COSHH_NOT_VERIFICATION", "Assessment and COSHH IDs must use verification prefixes.", 400);
  }
  const loaded = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const parent = await findVerificationCoshhParent(auth, deps, loaded, coshhId);
  if (!parent || !isVerificationCoshhRegister(parent)) {
    return healthSafetyApiFailure("COSHH_NOT_FOUND", "Verification COSHH parent record not found.", 404);
  }
  const existing = loaded.assessments.find((item) => trim(item.id) === assessmentId);
  if (existing && isVerificationCoshhAssessment(existing)) {
    logCoshhMutationTiming("create", "assessment-idempotent", {
      coshhId,
      assessmentId,
      workbookId: loaded.masterSheetId,
      updatedRows: 0,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return { ok: true, item: existing, alreadyExists: true, updatedRows: 0 };
  }
  const timestamp = nowIso();
  const row = assessmentRowFromPayload(input, actor, loaded.companyFolderId, timestamp);
  const appendTabRows = resolveAppendTabRows(deps);
  const writeResult = await appendTabRows(auth, deps, loaded.masterSheetId, COSHH_ASSESSMENTS_TAB, COSHH_ASSESSMENTS_TAB_COLUMNS, [row]);
  const written = Number(writeResult?.written) || 0;
  if (written <= 0) {
    return healthSafetyApiFailure("COSHH_WRITE_ZERO_ROWS", "COSHH assessment create returned zero-row acknowledgement.", 500);
  }
  logCoshhMutationTiming("create", "assessment", {
    coshhId,
    assessmentId,
    workbookId: loaded.masterSheetId,
    updatedRows: written,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item: mapCoshhAssessmentRecord(row), updatedRows: written };
}

export async function patchVerificationCoshhAssessment(auth, deps, actor, companyFolderId, assessmentId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("COSHH_FORBIDDEN", "You do not have permission to update verification assessments.", 403);
  }
  const id = trim(assessmentId);
  if (!isVerificationCoshhAssessmentId(id)) {
    return healthSafetyApiFailure("COSHH_NOT_VERIFICATION", "Only verification assessments can be patched through this path.", 403);
  }
  const loaded = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const current = loaded.assessments.find((item) => trim(item.id) === id);
  if (!current || !isVerificationCoshhAssessment(current)) {
    return healthSafetyApiFailure("COSHH_ASSESSMENT_NOT_FOUND", "Verification COSHH assessment not found.", 404);
  }
  const initialLikelihood = Number(input.initialLikelihood ?? current.initialLikelihood);
  const initialSeverity = Number(input.initialSeverity ?? current.initialSeverity);
  const residualLikelihood = Number(input.residualLikelihood ?? current.residualLikelihood);
  const residualSeverity = Number(input.residualSeverity ?? current.residualSeverity);
  const patch = {
    Activity: input.activity ?? current.activity,
    ExposureRoutes: input.exposureRoutes ?? current.exposureRoutes,
    Hazards: input.hazards ?? current.hazards,
    ExistingControls: input.existingControls ?? current.existingControls,
    EngineeringControls: input.engineeringControls ?? current.engineeringControls,
    PpeRequired: input.ppeRequired ?? current.ppeRequired,
    StorageControls: input.storageControls ?? current.storageControls,
    SpillProcedure: input.spillProcedure ?? current.spillProcedure,
    FirstAid: input.firstAid ?? current.firstAid,
    EmergencyActions: input.emergencyActions ?? current.emergencyActions,
    AssessorName: input.assessorName ?? current.assessorName,
    ReviewDate: normalizeHealthSafetyDateKey(input.reviewDate ?? current.reviewDate),
    AdditionalActions: input.additionalActions ?? current.additionalActions,
    InitialLikelihood: String(initialLikelihood || ""),
    InitialSeverity: String(initialSeverity || ""),
    InitialRiskScore: String(calculateRiskScore(initialLikelihood, initialSeverity) || ""),
    ResidualLikelihood: String(residualLikelihood || ""),
    ResidualSeverity: String(residualSeverity || ""),
    ResidualRiskScore: String(calculateRiskScore(residualLikelihood, residualSeverity) || ""),
    Status: input.status ?? current.status,
    UpdatedAt: nowIso(),
    UpdatedBy: normalizeEmail(actor.email),
  };
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, COSHH_ASSESSMENTS_TAB, "AssessmentId", id, patch);
  const refreshed = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: loaded.masterSheetId });
  const item = refreshed.assessments.find((entry) => trim(entry.id) === id);
  logCoshhMutationTiming("patch", "assessment", {
    coshhId: item?.coshhId,
    assessmentId: id,
    workbookId: loaded.masterSheetId,
    updatedRows: 1,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item };
}

export async function submitVerificationCoshhAssessment(auth, deps, actor, companyFolderId, assessmentId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("COSHH_FORBIDDEN", "You do not have permission to submit verification assessments.", 403);
  }
  const id = trim(assessmentId);
  const loaded = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const current = loaded.assessments.find((item) => trim(item.id) === id);
  if (!current || !isVerificationCoshhAssessment(current)) {
    return healthSafetyApiFailure("COSHH_ASSESSMENT_NOT_FOUND", "Verification COSHH assessment not found.", 404);
  }
  if (assessmentSubmittedMarker(current.additionalActions) && trim(current.status) === "draft") {
    logCoshhMutationTiming("submit", "idempotent", {
      coshhId: current.coshhId,
      assessmentId: id,
      workbookId: loaded.masterSheetId,
      updatedRows: 0,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return { ok: true, item: current, alreadySubmitted: true, updatedRows: 0 };
  }
  const parent = loaded.register.find((item) => trim(item.id) === current.coshhId);
  if (!parent?.sdsDocumentId && !parent?.sdsFileName) {
    return healthSafetyApiFailure("COSHH_SDS_REQUIRED", "Verification assessment requires linked SDS metadata before submit.", 400);
  }
  const submittedMarker = `${PRODUCTION_VERIFICATION_COSHH_NOTES_MARKER} submitted=true submittedAt=${nowIso()} submittedBy=${normalizeEmail(actor.email)}`;
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, COSHH_ASSESSMENTS_TAB, "AssessmentId", id, {
    Status: "draft",
    AdditionalActions: appendVerificationMarker(current.additionalActions, submittedMarker),
    UpdatedAt: nowIso(),
    UpdatedBy: normalizeEmail(actor.email),
  });
  const refreshed = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: loaded.masterSheetId });
  const item = refreshed.assessments.find((entry) => trim(entry.id) === id);
  logCoshhMutationTiming("submit", "submit", {
    coshhId: item?.coshhId,
    assessmentId: id,
    workbookId: loaded.masterSheetId,
    updatedRows: 1,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item, updatedRows: 1 };
}

export async function approveVerificationCoshhAssessment(auth, deps, actor, companyFolderId, assessmentId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("COSHH_FORBIDDEN", "You do not have permission to approve verification assessments.", 403);
  }
  const id = trim(assessmentId);
  const loaded = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const current = loaded.assessments.find((item) => trim(item.id) === id);
  if (!current || !isVerificationCoshhAssessment(current)) {
    return healthSafetyApiFailure("COSHH_ASSESSMENT_NOT_FOUND", "Verification COSHH assessment not found.", 404);
  }
  if (trim(current.status) === "active" && trim(current.approvedAt)) {
    logCoshhMutationTiming("approve", "idempotent", {
      coshhId: current.coshhId,
      assessmentId: id,
      workbookId: loaded.masterSheetId,
      updatedRows: 0,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return { ok: true, item: current, alreadyApproved: true, updatedRows: 0 };
  }
  if (!assessmentSubmittedMarker(current.additionalActions)) {
    return healthSafetyApiFailure("COSHH_NOT_SUBMITTED", "Assessment must be submitted before approval.", 400);
  }
  const timestamp = nowIso();
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, COSHH_ASSESSMENTS_TAB, "AssessmentId", id, {
    Status: "active",
    ApprovedBy: normalizeEmail(actor.email),
    ApprovedAt: timestamp,
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, COSHH_REGISTER_TAB, "CoshhId", current.coshhId, {
    ApprovedForUse: "true",
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  const refreshed = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: loaded.masterSheetId });
  const item = refreshed.assessments.find((entry) => trim(entry.id) === id);
  logCoshhMutationTiming("approve", "approve", {
    coshhId: item?.coshhId,
    assessmentId: id,
    workbookId: loaded.masterSheetId,
    updatedRows: 2,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item, updatedRows: 2 };
}

export async function reviewVerificationCoshhAssessment(auth, deps, actor, companyFolderId, assessmentId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("COSHH_FORBIDDEN", "You do not have permission to review verification assessments.", 403);
  }
  const id = trim(assessmentId);
  const loaded = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const current = loaded.assessments.find((item) => trim(item.id) === id);
  if (!current || !isVerificationCoshhAssessment(current)) {
    return healthSafetyApiFailure("COSHH_ASSESSMENT_NOT_FOUND", "Verification COSHH assessment not found.", 404);
  }
  if (assessmentReviewedMarker(current.additionalActions)) {
    logCoshhMutationTiming("review", "idempotent", {
      coshhId: current.coshhId,
      assessmentId: id,
      workbookId: loaded.masterSheetId,
      updatedRows: 0,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return { ok: true, item: current, alreadyReviewed: true, updatedRows: 0 };
  }
  if (trim(current.status) !== "active") {
    return healthSafetyApiFailure("COSHH_NOT_ACTIVE", "Only active assessments can be reviewed.", 400);
  }
  const nextReviewDate = normalizeHealthSafetyDateKey(input.reviewDate) || normalizeHealthSafetyDateKey(current.reviewDate);
  const reviewMarker = `${PRODUCTION_VERIFICATION_COSHH_NOTES_MARKER} reviewed=true reviewedAt=${nowIso()} reviewSummary=${PRODUCTION_VERIFICATION_COSHH_REVIEW_SUMMARY}`;
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, COSHH_ASSESSMENTS_TAB, "AssessmentId", id, {
    ReviewDate: nextReviewDate,
    AdditionalActions: appendVerificationMarker(current.additionalActions, reviewMarker),
    UpdatedAt: nowIso(),
    UpdatedBy: normalizeEmail(actor.email),
  });
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, COSHH_REGISTER_TAB, "CoshhId", current.coshhId, {
    ReviewDate: nextReviewDate,
    UpdatedAt: nowIso(),
    UpdatedBy: normalizeEmail(actor.email),
  });
  const refreshed = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: loaded.masterSheetId });
  const item = refreshed.assessments.find((entry) => trim(entry.id) === id);
  logCoshhMutationTiming("review", "review", {
    coshhId: item?.coshhId,
    assessmentId: id,
    workbookId: loaded.masterSheetId,
    updatedRows: 2,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, item, updatedRows: 2 };
}

async function archiveVerificationAssessmentsForCoshh(auth, deps, masterSheetId, actor, coshhId, timestamp) {
  const assessments = mapAssessmentRecordsSafely(await readAssessmentRecords(auth, deps, masterSheetId));
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  let cleaned = 0;
  for (const assessment of assessments) {
    if (trim(assessment.coshhId) !== trim(coshhId) || !isVerificationCoshhAssessment(assessment)) {
      continue;
    }
    await patchTabRowByHeader(auth, deps, masterSheetId, COSHH_ASSESSMENTS_TAB, "AssessmentId", assessment.id, {
      Status: PRODUCTION_VERIFICATION_COSHH_CLEANED_MARKER,
      ArchivedAt: timestamp,
      ArchivedBy: normalizeEmail(actor.email),
      AdditionalActions: appendVerificationMarker(assessment.additionalActions, PRODUCTION_VERIFICATION_COSHH_CLEANED_MARKER),
      UpdatedAt: timestamp,
      UpdatedBy: normalizeEmail(actor.email),
    });
    cleaned += 1;
  }
  return cleaned;
}

export async function cleanupVerificationCoshh(auth, deps, actor, companyFolderId, coshhId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("COSHH_FORBIDDEN", "You do not have permission to clean up verification COSHH records.", 403);
  }
  const id = trim(coshhId);
  if (!isVerificationCoshhId(id)) {
    return healthSafetyApiFailure("CLEANUP_NOT_VERIFICATION_COSHH", "Only verification COSHH records can be cleaned up through this path.", 403);
  }
  const loaded = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const current = loaded.register.find((item) => trim(item.id) === id);
  if (!current) {
    return { ok: true, cleaned: false, alreadyCleaned: true, coshhId: id };
  }
  if (!isVerificationCoshhRegister(current)) {
    return healthSafetyApiFailure("CLEANUP_NOT_VERIFICATION_COSHH", "Only verification COSHH records can be cleaned up through this path.", 403);
  }
  const description = trim(current.description);
  if (normalize(description).includes(PRODUCTION_VERIFICATION_COSHH_CLEANED_MARKER) || current.archivedAt) {
    return { ok: true, cleaned: false, alreadyCleaned: true, coshhId: id };
  }
  const timestamp = nowIso();
  const cleanedAssessments = await archiveVerificationAssessmentsForCoshh(auth, deps, loaded.masterSheetId, actor, id, timestamp);
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, loaded.masterSheetId, COSHH_REGISTER_TAB, "CoshhId", id, {
    ArchivedAt: timestamp,
    ArchivedBy: normalizeEmail(actor.email),
    Status: "archived",
    Description: appendVerificationMarker(description, PRODUCTION_VERIFICATION_COSHH_CLEANED_MARKER),
    SdsDocumentId: "",
    SdsFileName: "",
    SdsIssueDate: "",
    SdsVersion: "",
    ApprovedForUse: "false",
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  });
  logCoshhMutationTiming("cleanup", "single", {
    coshhId: id,
    substanceId: id,
    workbookId: loaded.masterSheetId,
    updatedRows: 1 + cleanedAssessments,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, cleaned: true, coshhId: id, cleanedAssessments, updatedRows: 1 + cleanedAssessments };
}

export async function cleanupStaleVerificationCoshh(auth, deps, actor, companyFolderId, input = {}) {
  const startedAt = Date.now();
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("COSHH_FORBIDDEN", "You do not have permission to clean up verification COSHH records.", 403);
  }
  const loaded = await loadCoshhContext(auth, deps, { companyFolderId, masterSheetId: trim(input.masterSheetId) });
  if (!loaded.ok) {
    return loaded;
  }
  const keepCoshhId = trim(input.keepCoshhId);
  const stale = loaded.register.filter((item) => {
    if (!isActiveVerificationCoshhRegister(item)) {
      return false;
    }
    if (keepCoshhId && trim(item.id) === keepCoshhId) {
      return false;
    }
    return true;
  });
  const results = [];
  for (const item of stale) {
    const cleaned = await cleanupVerificationCoshh(auth, deps, actor, companyFolderId, item.id, input);
    results.push({ coshhId: item.id, ok: cleaned.ok, alreadyCleaned: Boolean(cleaned.alreadyCleaned) });
  }
  logCoshhMutationTiming("cleanup", "stale-cleanup", {
    workbookId: loaded.masterSheetId,
    updatedRows: results.filter((item) => item.ok).length,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, results, cleanedCount: results.filter((item) => item.ok).length };
}
