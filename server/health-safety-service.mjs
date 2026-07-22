/**
 * Health & Safety Phase 1 service — COSHH register, assessments, RIDDOR, overview.
 */
import {
  COSHH_ASSESSMENTS_TAB,
  COSHH_ASSESSMENTS_TAB_COLUMNS,
  COSHH_REGISTER_TAB,
  COSHH_REGISTER_TAB_COLUMNS,
  HEALTH_SAFETY_REQUIRED_TABS,
  RIDDOR_REPORTS_TAB,
  RIDDOR_REPORTS_TAB_COLUMNS,
  buildCoshhAssessmentId,
  buildCoshhId,
  buildRiddorId,
  calculateRiskScore,
  evaluateRiddorDecision,
  mapCoshhAssessmentRecord,
  mapCoshhRegisterRecord,
  mapRiddorReportRecord,
  normalizeHealthSafetyDateKey,
} from "../shared/health-safety.mjs";
import { isCompanyInviteActor, isGodmodeInviteSession } from "../shared/company-invite-permissions.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";
import { listCompanyIncidents } from "./incidents-service.mjs";
import { listLolerEquipment } from "./loler-service.mjs";
import { lolerEquipmentComplianceStatus } from "../shared/loler.mjs";

export const HEALTH_SAFETY_ROUTE_TIMEOUT_MS = 90_000;

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

export function canViewHealthSafety(actor) {
  if (!actor?.email) return false;
  return actor.kind === "company" || actor.kind === "godmode" || isCompanyInviteActor(actor);
}

export function canManageHealthSafety(actor) {
  if (!canViewHealthSafety(actor)) return false;
  const role = trim(actor.role);
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function actorCanAccessCompanyHealthSafety(actor, companyFolderId, alternateIds = []) {
  if (!canViewHealthSafety(actor)) return false;
  if (isGodmodeInviteSession({ kind: actor?.kind, role: actor?.role }) || actor.kind === "godmode") {
    return Boolean(trim(companyFolderId));
  }
  const sessionCompanyId = trim(actor?.companyId || actor?.companyFolderId);
  if (!sessionCompanyId) return false;
  const targets = new Set([companyFolderId, ...alternateIds].map((entry) => trim(entry)).filter(Boolean));
  return targets.has(sessionCompanyId);
}

export function healthSafetyApiFailure(code, error, httpStatus = 400, details = "") {
  const safeError = trim(error) || "Request failed.";
  return { ok: false, code, error: safeError, message: safeError, details: trim(details) || undefined, httpStatus };
}

export async function ensureHealthSafetyTabs(auth, deps, masterSheetId) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  for (const tab of HEALTH_SAFETY_REQUIRED_TABS) {
    const columns =
      tab === COSHH_REGISTER_TAB
        ? COSHH_REGISTER_TAB_COLUMNS
        : tab === COSHH_ASSESSMENTS_TAB
          ? COSHH_ASSESSMENTS_TAB_COLUMNS
          : RIDDOR_REPORTS_TAB_COLUMNS;
    await ensureTabColumns(auth, deps, masterSheetId, tab, columns);
  }
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

function validateCoshhInput(input = {}) {
  const productName = trim(input.productName);
  if (!productName) return "Product name is required.";
  return "";
}

export async function listCompanyCoshh(auth, deps, resolved, actor, options = {}) {
  if (!actorCanAccessCompanyHealthSafety(actor, resolved.companyFolderId, resolved.alternateCompanyIds)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have access to this company.", 403);
  }
  await ensureHealthSafetyTabs(auth, deps, resolved.masterSheetId);
  const records = await readTab(auth, deps, resolved.masterSheetId, COSHH_REGISTER_TAB, COSHH_REGISTER_TAB_COLUMNS);
  const includeArchived = options.includeArchived === true;
  const items = records
    .map((record) => mapCoshhRegisterRecord(record))
    .filter((item) => item.id && (includeArchived || !item.archivedAt));
  return { ok: true, items };
}

export async function createCompanyCoshh(auth, deps, resolved, actor, input = {}) {
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have permission to manage COSHH records.", 403);
  }
  const validationError = validateCoshhInput(input);
  if (validationError) return healthSafetyApiFailure("COSHH_VALIDATION", validationError, 400);
  await ensureHealthSafetyTabs(auth, deps, resolved.masterSheetId);
  const id = buildCoshhId();
  const timestamp = nowIso();
  const row = {
    CoshhId: id,
    CompanyFolderId: resolved.companyFolderId,
    ProductName: trim(input.productName),
    Manufacturer: trim(input.manufacturer),
    Supplier: trim(input.supplier),
    ProductCode: trim(input.productCode),
    Description: trim(input.description),
    PhysicalForm: trim(input.physicalForm),
    SignalWord: trim(input.signalWord),
    HazardPictograms: trim(input.hazardPictograms),
    HazardStatements: trim(input.hazardStatements),
    PrecautionaryStatements: trim(input.precautionaryStatements),
    PrimaryUse: trim(input.primaryUse),
    SiteId: trim(input.siteId),
    AreaId: trim(input.areaId),
    StorageLocation: trim(input.storageLocation),
    AssessmentRequired: String(Boolean(input.assessmentRequired)),
    ApprovedForUse: String(Boolean(input.approvedForUse)),
    Status: "current",
    ReviewDate: normalizeHealthSafetyDateKey(input.reviewDate),
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  };
  const appendTabRows = resolveAppendTabRows(deps);
  await appendTabRows(auth, deps, resolved.masterSheetId, COSHH_REGISTER_TAB, [row], { expectedHeaders: COSHH_REGISTER_TAB_COLUMNS });
  return { ok: true, item: mapCoshhRegisterRecord(row) };
}

export async function getCompanyCoshh(auth, deps, resolved, actor, coshhId) {
  const listed = await listCompanyCoshh(auth, deps, resolved, actor, { includeArchived: true });
  if (!listed.ok) return listed;
  const item = listed.items.find((entry) => entry.id === trim(coshhId));
  if (!item) return healthSafetyApiFailure("COSHH_NOT_FOUND", "COSHH record not found.", 404);
  return { ok: true, item };
}

export async function patchCompanyCoshh(auth, deps, resolved, actor, coshhId, input = {}) {
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have permission to manage COSHH records.", 403);
  }
  const current = await getCompanyCoshh(auth, deps, resolved, actor, coshhId);
  if (!current.ok) return current;
  const patch = rowToPatch(
    {
      ProductName: input.productName ?? current.item.productName,
      Manufacturer: input.manufacturer ?? current.item.manufacturer,
      Supplier: input.supplier ?? current.item.supplier,
      ProductCode: input.productCode ?? current.item.productCode,
      Description: input.description ?? current.item.description,
      PhysicalForm: input.physicalForm ?? current.item.physicalForm,
      SignalWord: input.signalWord ?? current.item.signalWord,
      HazardPictograms: input.hazardPictograms ?? current.item.hazardPictograms,
      HazardStatements: input.hazardStatements ?? current.item.hazardStatements,
      PrecautionaryStatements: input.precautionaryStatements ?? current.item.precautionaryStatements,
      PrimaryUse: input.primaryUse ?? current.item.primaryUse,
      SiteId: input.siteId ?? current.item.siteId,
      AreaId: input.areaId ?? current.item.areaId,
      StorageLocation: input.storageLocation ?? current.item.storageLocation,
      SdsDocumentId: input.sdsDocumentId ?? current.item.sdsDocumentId,
      SdsFileName: input.sdsFileName ?? current.item.sdsFileName,
      SdsIssueDate: input.sdsIssueDate ?? current.item.sdsIssueDate,
      SdsVersion: input.sdsVersion ?? current.item.sdsVersion,
      AssessmentRequired: String(input.assessmentRequired ?? current.item.assessmentRequired),
      ApprovedForUse: String(input.approvedForUse ?? current.item.approvedForUse),
      ReviewDate: normalizeHealthSafetyDateKey(input.reviewDate ?? current.item.reviewDate),
      UpdatedAt: nowIso(),
      UpdatedBy: normalizeEmail(actor.email),
    },
    COSHH_REGISTER_TAB_COLUMNS,
  );
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, COSHH_REGISTER_TAB, "CoshhId", coshhId, patch);
  return getCompanyCoshh(auth, deps, resolved, actor, coshhId);
}

export async function archiveCompanyCoshh(auth, deps, resolved, actor, coshhId) {
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have permission to archive COSHH records.", 403);
  }
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, COSHH_REGISTER_TAB, "CoshhId", coshhId, {
    ArchivedAt: nowIso(),
    ArchivedBy: normalizeEmail(actor.email),
    Status: "archived",
    UpdatedAt: nowIso(),
    UpdatedBy: normalizeEmail(actor.email),
  });
  return getCompanyCoshh(auth, deps, resolved, actor, coshhId);
}

export async function restoreCompanyCoshh(auth, deps, resolved, actor, coshhId) {
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have permission to restore COSHH records.", 403);
  }
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, COSHH_REGISTER_TAB, "CoshhId", coshhId, {
    ArchivedAt: "",
    ArchivedBy: "",
    Status: "current",
    UpdatedAt: nowIso(),
    UpdatedBy: normalizeEmail(actor.email),
  });
  return getCompanyCoshh(auth, deps, resolved, actor, coshhId);
}

export async function listCoshhAssessments(auth, deps, resolved, actor, coshhId) {
  const listed = await listCompanyCoshh(auth, deps, resolved, actor, { includeArchived: true });
  if (!listed.ok) return listed;
  await ensureHealthSafetyTabs(auth, deps, resolved.masterSheetId);
  const records = await readTab(auth, deps, resolved.masterSheetId, COSHH_ASSESSMENTS_TAB, COSHH_ASSESSMENTS_TAB_COLUMNS);
  const items = records
    .map((record) => mapCoshhAssessmentRecord(record))
    .filter((item) => item.id && item.coshhId === trim(coshhId) && !item.archivedAt);
  return { ok: true, items };
}

export async function createCoshhAssessment(auth, deps, resolved, actor, coshhId, input = {}) {
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have permission to create COSHH assessments.", 403);
  }
  const parent = await getCompanyCoshh(auth, deps, resolved, actor, coshhId);
  if (!parent.ok) return parent;
  const id = buildCoshhAssessmentId();
  const timestamp = nowIso();
  const initialLikelihood = Number(input.initialLikelihood || 0);
  const initialSeverity = Number(input.initialSeverity || 0);
  const residualLikelihood = Number(input.residualLikelihood || 0);
  const residualSeverity = Number(input.residualSeverity || 0);
  const row = {
    AssessmentId: id,
    CoshhId: trim(coshhId),
    CompanyFolderId: resolved.companyFolderId,
    AssessmentTitle: trim(input.assessmentTitle) || `${parent.item.productName} assessment`,
    Activity: trim(input.activity),
    PersonsAtRisk: trim(input.personsAtRisk),
    FrequencyOfUse: trim(input.frequencyOfUse),
    QuantityUsed: trim(input.quantityUsed),
    DurationOfExposure: trim(input.durationOfExposure),
    ExposureRoutes: trim(input.exposureRoutes),
    Hazards: trim(input.hazards),
    ExistingControls: trim(input.existingControls),
    EngineeringControls: trim(input.engineeringControls),
    PpeRequired: trim(input.ppeRequired),
    StorageControls: trim(input.storageControls),
    SpillProcedure: trim(input.spillProcedure),
    FirstAid: trim(input.firstAid),
    FireResponse: trim(input.fireResponse),
    DisposalMethod: trim(input.disposalMethod),
    EmergencyActions: trim(input.emergencyActions),
    InitialLikelihood: String(initialLikelihood || ""),
    InitialSeverity: String(initialSeverity || ""),
    InitialRiskScore: String(calculateRiskScore(initialLikelihood, initialSeverity) || ""),
    ResidualLikelihood: String(residualLikelihood || ""),
    ResidualSeverity: String(residualSeverity || ""),
    ResidualRiskScore: String(calculateRiskScore(residualLikelihood, residualSeverity) || ""),
    AdditionalActions: trim(input.additionalActions),
    AssessorName: trim(input.assessorName) || trim(actor.name) || normalizeEmail(actor.email),
    AssessmentDate: normalizeHealthSafetyDateKey(input.assessmentDate) || getUkTodayKey(),
    ReviewDate: normalizeHealthSafetyDateKey(input.reviewDate),
    Status: trim(input.status) || "draft",
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  };
  const appendTabRows = resolveAppendTabRows(deps);
  await appendTabRows(auth, deps, resolved.masterSheetId, COSHH_ASSESSMENTS_TAB, [row], {
    expectedHeaders: COSHH_ASSESSMENTS_TAB_COLUMNS,
  });
  return { ok: true, item: mapCoshhAssessmentRecord(row) };
}

export async function getCoshhAssessment(auth, deps, resolved, actor, assessmentId) {
  if (!actorCanAccessCompanyHealthSafety(actor, resolved.companyFolderId, resolved.alternateCompanyIds)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have access to this company.", 403);
  }
  await ensureHealthSafetyTabs(auth, deps, resolved.masterSheetId);
  const records = await readTab(auth, deps, resolved.masterSheetId, COSHH_ASSESSMENTS_TAB, COSHH_ASSESSMENTS_TAB_COLUMNS);
  const item = records.map((record) => mapCoshhAssessmentRecord(record)).find((entry) => entry.id === trim(assessmentId));
  if (!item) return healthSafetyApiFailure("COSHH_ASSESSMENT_NOT_FOUND", "COSHH assessment not found.", 404);
  return { ok: true, item };
}

export async function patchCoshhAssessment(auth, deps, resolved, actor, assessmentId, input = {}) {
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have permission to update COSHH assessments.", 403);
  }
  const current = await getCoshhAssessment(auth, deps, resolved, actor, assessmentId);
  if (!current.ok) return current;
  const initialLikelihood = Number(input.initialLikelihood ?? current.item.initialLikelihood);
  const initialSeverity = Number(input.initialSeverity ?? current.item.initialSeverity);
  const residualLikelihood = Number(input.residualLikelihood ?? current.item.residualLikelihood);
  const residualSeverity = Number(input.residualSeverity ?? current.item.residualSeverity);
  const patch = rowToPatch(
    {
      AssessmentTitle: input.assessmentTitle ?? current.item.assessmentTitle,
      Activity: input.activity ?? current.item.activity,
      PersonsAtRisk: input.personsAtRisk ?? current.item.personsAtRisk,
      FrequencyOfUse: input.frequencyOfUse ?? current.item.frequencyOfUse,
      QuantityUsed: input.quantityUsed ?? current.item.quantityUsed,
      DurationOfExposure: input.durationOfExposure ?? current.item.durationOfExposure,
      ExposureRoutes: input.exposureRoutes ?? current.item.exposureRoutes,
      Hazards: input.hazards ?? current.item.hazards,
      ExistingControls: input.existingControls ?? current.item.existingControls,
      EngineeringControls: input.engineeringControls ?? current.item.engineeringControls,
      PpeRequired: input.ppeRequired ?? current.item.ppeRequired,
      StorageControls: input.storageControls ?? current.item.storageControls,
      SpillProcedure: input.spillProcedure ?? current.item.spillProcedure,
      FirstAid: input.firstAid ?? current.item.firstAid,
      FireResponse: input.fireResponse ?? current.item.fireResponse,
      DisposalMethod: input.disposalMethod ?? current.item.disposalMethod,
      EmergencyActions: input.emergencyActions ?? current.item.emergencyActions,
      InitialLikelihood: String(initialLikelihood || ""),
      InitialSeverity: String(initialSeverity || ""),
      InitialRiskScore: String(calculateRiskScore(initialLikelihood, initialSeverity) || ""),
      ResidualLikelihood: String(residualLikelihood || ""),
      ResidualSeverity: String(residualSeverity || ""),
      ResidualRiskScore: String(calculateRiskScore(residualLikelihood, residualSeverity) || ""),
      AdditionalActions: input.additionalActions ?? current.item.additionalActions,
      AssessorName: input.assessorName ?? current.item.assessorName,
      AssessmentDate: normalizeHealthSafetyDateKey(input.assessmentDate ?? current.item.assessmentDate),
      ReviewDate: normalizeHealthSafetyDateKey(input.reviewDate ?? current.item.reviewDate),
      Status: input.status ?? current.item.status,
      ApprovedBy: input.approvedBy ?? current.item.approvedBy,
      ApprovedAt: input.approvedAt ?? current.item.approvedAt,
      UpdatedAt: nowIso(),
      UpdatedBy: normalizeEmail(actor.email),
    },
    COSHH_ASSESSMENTS_TAB_COLUMNS,
  );
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, COSHH_ASSESSMENTS_TAB, "AssessmentId", assessmentId, patch);
  return getCoshhAssessment(auth, deps, resolved, actor, assessmentId);
}

export async function listCompanyRiddor(auth, deps, resolved, actor, options = {}) {
  if (!actorCanAccessCompanyHealthSafety(actor, resolved.companyFolderId, resolved.alternateCompanyIds)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have access to this company.", 403);
  }
  await ensureHealthSafetyTabs(auth, deps, resolved.masterSheetId);
  const records = await readTab(auth, deps, resolved.masterSheetId, RIDDOR_REPORTS_TAB, RIDDOR_REPORTS_TAB_COLUMNS);
  const includeArchived = options.includeArchived === true;
  const items = records
    .map((record) => mapRiddorReportRecord(record))
    .filter((item) => item.id && (includeArchived || !item.archivedAt));
  return { ok: true, items };
}

export async function createCompanyRiddor(auth, deps, resolved, actor, input = {}) {
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have permission to manage RIDDOR records.", 403);
  }
  const id = buildRiddorId();
  const timestamp = nowIso();
  const row = {
    RiddorId: id,
    IncidentId: trim(input.incidentId),
    CompanyFolderId: resolved.companyFolderId,
    DecisionStatus: trim(input.decisionStatus) || "decision_required",
    DecisionDate: normalizeHealthSafetyDateKey(input.decisionDate) || getUkTodayKey(),
    DecisionBy: normalizeEmail(input.decisionBy || actor.email),
    ReportableOutcome: trim(input.reportableOutcome),
    ReportableCategory: trim(input.reportableCategory),
    Fatality: String(Boolean(input.fatality)),
    SpecifiedInjury: String(Boolean(input.specifiedInjury)),
    OverSevenDayInjury: String(Boolean(input.overSevenDayInjury)),
    DangerousOccurrence: String(Boolean(input.dangerousOccurrence)),
    OccupationalDisease: String(Boolean(input.occupationalDisease)),
    GasIncident: String(Boolean(input.gasIncident)),
    MemberOfPublicHospitalTreatment: String(Boolean(input.memberOfPublicHospitalTreatment)),
    SupportingReason: trim(input.supportingReason),
    FurtherInformationRequired: String(Boolean(input.furtherInformationRequired)),
    SubmissionStatus: trim(input.submissionStatus) || "not_started",
    SubmissionReference: trim(input.submissionReference),
    SubmittedAt: trim(input.submittedAt),
    SubmittedBy: normalizeEmail(input.submittedBy),
    AuthorityNotificationMethod: trim(input.authorityNotificationMethod),
    FollowUpRequired: String(Boolean(input.followUpRequired)),
    FollowUpDate: normalizeHealthSafetyDateKey(input.followUpDate),
    LinkedActionIds: trim(input.linkedActionIds),
    CreatedAt: timestamp,
    CreatedBy: normalizeEmail(actor.email),
    UpdatedAt: timestamp,
    UpdatedBy: normalizeEmail(actor.email),
  };
  const appendTabRows = resolveAppendTabRows(deps);
  await appendTabRows(auth, deps, resolved.masterSheetId, RIDDOR_REPORTS_TAB, [row], {
    expectedHeaders: RIDDOR_REPORTS_TAB_COLUMNS,
  });
  return { ok: true, item: mapRiddorReportRecord(row) };
}

export async function getCompanyRiddor(auth, deps, resolved, actor, riddorId) {
  const listed = await listCompanyRiddor(auth, deps, resolved, actor, { includeArchived: true });
  if (!listed.ok) return listed;
  const item = listed.items.find((entry) => entry.id === trim(riddorId));
  if (!item) return healthSafetyApiFailure("RIDDOR_NOT_FOUND", "RIDDOR record not found.", 404);
  return { ok: true, item };
}

export async function patchCompanyRiddor(auth, deps, resolved, actor, riddorId, input = {}) {
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have permission to update RIDDOR records.", 403);
  }
  const current = await getCompanyRiddor(auth, deps, resolved, actor, riddorId);
  if (!current.ok) return current;
  const patch = rowToPatch(
    {
      DecisionStatus: input.decisionStatus ?? current.item.decisionStatus,
      DecisionDate: normalizeHealthSafetyDateKey(input.decisionDate ?? current.item.decisionDate),
      DecisionBy: normalizeEmail(input.decisionBy ?? current.item.decisionBy),
      ReportableOutcome: input.reportableOutcome ?? current.item.reportableOutcome,
      ReportableCategory: input.reportableCategory ?? current.item.reportableCategory,
      SupportingReason: input.supportingReason ?? current.item.supportingReason,
      FurtherInformationRequired: String(input.furtherInformationRequired ?? current.item.furtherInformationRequired),
      SubmissionStatus: input.submissionStatus ?? current.item.submissionStatus,
      SubmissionReference: input.submissionReference ?? current.item.submissionReference,
      SubmittedAt: input.submittedAt ?? current.item.submittedAt,
      SubmittedBy: normalizeEmail(input.submittedBy ?? current.item.submittedBy),
      AuthorityNotificationMethod: input.authorityNotificationMethod ?? current.item.authorityNotificationMethod,
      FollowUpRequired: String(input.followUpRequired ?? current.item.followUpRequired),
      FollowUpDate: normalizeHealthSafetyDateKey(input.followUpDate ?? current.item.followUpDate),
      LinkedActionIds: input.linkedActionIds ?? current.item.linkedActionIds,
      UpdatedAt: nowIso(),
      UpdatedBy: normalizeEmail(actor.email),
    },
    RIDDOR_REPORTS_TAB_COLUMNS,
  );
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await patchTabRowByHeader(auth, deps, resolved.masterSheetId, RIDDOR_REPORTS_TAB, "RiddorId", riddorId, patch);
  return getCompanyRiddor(auth, deps, resolved, actor, riddorId);
}

export async function assessIncidentRiddor(auth, deps, resolved, actor, incidentId, input = {}) {
  if (!canManageHealthSafety(actor)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have permission to assess RIDDOR.", 403);
  }
  const evaluation = evaluateRiddorDecision(input);
  const existing = (await listCompanyRiddor(auth, deps, resolved, actor, { includeArchived: true })).items.find(
    (item) => item.incidentId === trim(incidentId),
  );
  const payload = {
    incidentId: trim(incidentId),
    decisionStatus: input.confirmedDecisionStatus || evaluation.decisionStatus,
    reportableOutcome: evaluation.likelyReportable ? "may_be_reportable" : "not_reportable",
    fatality: Boolean(input.fatality),
    specifiedInjury: Boolean(input.specifiedInjury),
    overSevenDayInjury: Boolean(input.overSevenDayInjury),
    dangerousOccurrence: Boolean(input.dangerousOccurrence),
    occupationalDisease: Boolean(input.occupationalDisease),
    gasIncident: Boolean(input.gasIncident),
    memberOfPublicHospitalTreatment: Boolean(input.memberOfPublicHospitalTreatment),
    furtherInformationRequired: Boolean(input.furtherInformationRequired),
    supportingReason: trim(input.supportingReason),
    submissionStatus: input.submissionStatus,
    submissionReference: input.submissionReference,
    followUpRequired: Boolean(input.followUpRequired),
    followUpDate: input.followUpDate,
  };
  const result = existing
    ? await patchCompanyRiddor(auth, deps, resolved, actor, existing.id, payload)
    : await createCompanyRiddor(auth, deps, resolved, actor, payload);
  if (!result.ok) return result;
  return { ok: true, item: result.item, evaluation };
}

export async function buildHealthSafetyOverview(auth, deps, resolved, actor) {
  if (!actorCanAccessCompanyHealthSafety(actor, resolved.companyFolderId, resolved.alternateCompanyIds)) {
    return healthSafetyApiFailure("HEALTH_SAFETY_FORBIDDEN", "You do not have access to this company.", 403);
  }
  const [coshh, riddor, incidentsResult, lolerResult] = await Promise.all([
    listCompanyCoshh(auth, deps, resolved, actor, { includeArchived: false }),
    listCompanyRiddor(auth, deps, resolved, actor, { includeArchived: false }),
    listCompanyIncidents(auth, deps, {
      companyFolderId: resolved.companyFolderId,
      masterSheetId: resolved.masterSheetId,
    }, { resolvedContext: resolved }),
    listLolerEquipment(auth, deps, resolved, actor),
  ]);
  if (!coshh.ok) return coshh;
  if (!riddor.ok) return riddor;
  const incidents = incidentsResult?.ok ? incidentsResult.items || incidentsResult.incidents || [] : [];
  const equipment = lolerResult?.ok ? lolerResult.equipment || lolerResult.items || [] : [];
  const today = getUkTodayKey();
  const openIncidents = incidents.filter((item) => trim(item.status).toLowerCase() !== "closed");
  const highRiskIncidents = openIncidents.filter((item) => trim(item.priority || item.severity).toLowerCase() === "high");
  const riddorDecisionsRequired = riddor.items.filter((item) =>
    ["decision_required", "information_required", "likely_reportable"].includes(item.decisionStatus),
  );
  const openRiddorReports = riddor.items.filter((item) => item.submissionStatus !== "closed");
  const coshhOverdue = coshh.items.filter((item) => item.status === "overdue" || item.status === "review_due");
  const missingSds = coshh.items.filter((item) => item.status === "missing_sds");
  const equipmentOverdue = equipment.filter((item) => lolerEquipmentComplianceStatus(item, today) === "overdue");
  const attention = [
    ...openIncidents
      .filter((item) => trim(item.status).toLowerCase() === "investigation")
      .map((item) => ({
        id: `incident-${item.id}`,
        kind: "incident_investigation",
        title: item.title || item.description || "Incident awaiting investigation",
        status: item.status,
        site: item.location || item.department || "",
        dueDate: "",
        navigate: { screen: "incidents", incidentId: item.id },
        rank: 1,
      })),
    ...riddorDecisionsRequired.map((item) => ({
      id: `riddor-${item.id}`,
      kind: "riddor_decision",
      title: `RIDDOR decision required (${item.incidentId || item.id})`,
      status: item.decisionStatus,
      site: "",
      dueDate: item.followUpDate || item.decisionDate || "",
      navigate: { screen: "healthSafetyRiddor", riddorId: item.id },
      rank: 2,
    })),
    ...coshhOverdue.map((item) => ({
      id: `coshh-${item.id}`,
      kind: "coshh_review",
      title: `${item.productName} review ${item.status === "overdue" ? "overdue" : "due"}`,
      status: item.status,
      site: item.siteId || "",
      dueDate: item.reviewDate || "",
      navigate: { screen: "healthSafetyCoshh", coshhId: item.id },
      rank: 3,
    })),
    ...missingSds.map((item) => ({
      id: `sds-${item.id}`,
      kind: "missing_sds",
      title: `${item.productName} missing SDS`,
      status: "missing_sds",
      site: item.siteId || "",
      dueDate: "",
      navigate: { screen: "healthSafetyCoshh", coshhId: item.id },
      rank: 4,
    })),
    ...equipmentOverdue.map((item) => ({
      id: `equipment-${item.id}`,
      kind: "equipment_overdue",
      title: `${item.equipmentName || item.assetId} inspection overdue`,
      status: "overdue",
      site: item.siteName || item.siteId || "",
      dueDate: item.nextExaminationDueDate || "",
      navigate: { screen: "loler", equipmentId: item.id },
      rank: 5,
    })),
  ].sort((left, right) => left.rank - right.rank);

  return {
    ok: true,
    summary: {
      openIncidents: openIncidents.length,
      highRiskIncidents: highRiskIncidents.length,
      riddorDecisionsRequired: riddorDecisionsRequired.length,
      openRiddorReports: openRiddorReports.length,
      coshhAssessmentsOverdue: coshhOverdue.length,
      chemicalsMissingSds: missingSds.length,
      equipmentInspectionsOverdue: equipmentOverdue.length,
      openHealthSafetyActions: 0,
    },
    attention,
  };
}

export { resolveCompanyScheduleContext };
