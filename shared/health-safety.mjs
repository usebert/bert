/**
 * Health & Safety Phase 1 — workbook tabs, columns, statuses, and record mappers.
 */

export const COSHH_REGISTER_TAB = "COSHHRegister";
export const COSHH_ASSESSMENTS_TAB = "COSHHAssessments";
export const RIDDOR_REPORTS_TAB = "RIDDORReports";

export const HEALTH_SAFETY_REQUIRED_TABS = [COSHH_REGISTER_TAB, COSHH_ASSESSMENTS_TAB, RIDDOR_REPORTS_TAB];

export const COSHH_REGISTER_TAB_COLUMNS = [
  "CoshhId",
  "CompanyFolderId",
  "ProductName",
  "Manufacturer",
  "Supplier",
  "ProductCode",
  "Description",
  "PhysicalForm",
  "SignalWord",
  "HazardPictograms",
  "HazardStatements",
  "PrecautionaryStatements",
  "PrimaryUse",
  "SiteId",
  "AreaId",
  "StorageLocation",
  "SdsDocumentId",
  "SdsFileName",
  "SdsIssueDate",
  "SdsVersion",
  "AssessmentRequired",
  "ApprovedForUse",
  "Status",
  "ReviewDate",
  "CreatedAt",
  "CreatedBy",
  "UpdatedAt",
  "UpdatedBy",
  "ArchivedAt",
  "ArchivedBy",
];

export const COSHH_ASSESSMENTS_TAB_COLUMNS = [
  "AssessmentId",
  "CoshhId",
  "CompanyFolderId",
  "AssessmentTitle",
  "Activity",
  "PersonsAtRisk",
  "FrequencyOfUse",
  "QuantityUsed",
  "DurationOfExposure",
  "ExposureRoutes",
  "Hazards",
  "ExistingControls",
  "EngineeringControls",
  "PpeRequired",
  "StorageControls",
  "SpillProcedure",
  "FirstAid",
  "FireResponse",
  "DisposalMethod",
  "EmergencyActions",
  "InitialLikelihood",
  "InitialSeverity",
  "InitialRiskScore",
  "ResidualLikelihood",
  "ResidualSeverity",
  "ResidualRiskScore",
  "AdditionalActions",
  "AssessorName",
  "AssessmentDate",
  "ReviewDate",
  "Status",
  "ApprovedBy",
  "ApprovedAt",
  "CreatedAt",
  "CreatedBy",
  "UpdatedAt",
  "UpdatedBy",
  "ArchivedAt",
  "ArchivedBy",
];

export const RIDDOR_REPORTS_TAB_COLUMNS = [
  "RiddorId",
  "IncidentId",
  "CompanyFolderId",
  "DecisionStatus",
  "DecisionDate",
  "DecisionBy",
  "ReportableOutcome",
  "ReportableCategory",
  "Fatality",
  "SpecifiedInjury",
  "OverSevenDayInjury",
  "DangerousOccurrence",
  "OccupationalDisease",
  "GasIncident",
  "MemberOfPublicHospitalTreatment",
  "SupportingReason",
  "FurtherInformationRequired",
  "SubmissionStatus",
  "SubmissionReference",
  "SubmittedAt",
  "SubmittedBy",
  "AuthorityNotificationMethod",
  "FollowUpRequired",
  "FollowUpDate",
  "LinkedActionIds",
  "CreatedAt",
  "CreatedBy",
  "UpdatedAt",
  "UpdatedBy",
  "ArchivedAt",
  "ArchivedBy",
];

export const COSHH_STATUSES = [
  "current",
  "review_due",
  "overdue",
  "missing_sds",
  "assessment_required",
  "archived",
];

export const COSHH_ASSESSMENT_STATUSES = ["draft", "active", "review_due", "superseded", "archived"];

export const RIDDOR_DECISION_STATUSES = [
  "decision_required",
  "information_required",
  "likely_reportable",
  "not_reportable",
  "confirmed_reportable",
];

export const RIDDOR_SUBMISSION_STATUSES = [
  "not_started",
  "in_preparation",
  "submitted",
  "follow_up_required",
  "closed",
];

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

export function normalizeHealthSafetyDateKey(value) {
  const raw = trim(value);
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return "";
}

export function buildCoshhId() {
  return `coshh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildCoshhAssessmentId() {
  return `coshh-assess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildRiddorId() {
  return `riddor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function calculateRiskScore(likelihood, severity) {
  const l = Number(likelihood);
  const s = Number(severity);
  if (!Number.isFinite(l) || !Number.isFinite(s) || l < 1 || l > 5 || s < 1 || s > 5) {
    return 0;
  }
  return l * s;
}

export function mapCoshhRegisterRecord(record = {}) {
  const archivedAt = trim(record.ArchivedAt || record.archivedAt);
  const reviewDate = normalizeHealthSafetyDateKey(record.ReviewDate || record.reviewDate);
  const hasSds = Boolean(trim(record.SdsDocumentId || record.sdsDocumentId) || trim(record.SdsFileName || record.sdsFileName));
  const assessmentRequired = String(record.AssessmentRequired ?? record.assessmentRequired).toLowerCase() === "true";
  const statusRaw = trim(record.Status || record.status).toLowerCase();
  let status = statusRaw || "current";
  if (archivedAt) status = "archived";
  else if (!hasSds) status = "missing_sds";
  else if (assessmentRequired) status = "assessment_required";
  else if (reviewDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (reviewDate < today) status = "overdue";
    else {
      const dueSoon = new Date();
      dueSoon.setDate(dueSoon.getDate() + 30);
      if (reviewDate <= dueSoon.toISOString().slice(0, 10)) status = "review_due";
      else status = "current";
    }
  }
  return {
    id: trim(record.CoshhId || record.coshhId),
    companyFolderId: trim(record.CompanyFolderId || record.companyFolderId),
    productName: trim(record.ProductName || record.productName),
    manufacturer: trim(record.Manufacturer || record.manufacturer),
    supplier: trim(record.Supplier || record.supplier),
    productCode: trim(record.ProductCode || record.productCode),
    description: trim(record.Description || record.description),
    physicalForm: trim(record.PhysicalForm || record.physicalForm),
    signalWord: trim(record.SignalWord || record.signalWord),
    hazardPictograms: trim(record.HazardPictograms || record.hazardPictograms),
    hazardStatements: trim(record.HazardStatements || record.hazardStatements),
    precautionaryStatements: trim(record.PrecautionaryStatements || record.precautionaryStatements),
    primaryUse: trim(record.PrimaryUse || record.primaryUse),
    siteId: trim(record.SiteId || record.siteId),
    areaId: trim(record.AreaId || record.areaId),
    storageLocation: trim(record.StorageLocation || record.storageLocation),
    sdsDocumentId: trim(record.SdsDocumentId || record.sdsDocumentId),
    sdsFileName: trim(record.SdsFileName || record.sdsFileName),
    sdsIssueDate: normalizeHealthSafetyDateKey(record.SdsIssueDate || record.sdsIssueDate),
    sdsVersion: trim(record.SdsVersion || record.sdsVersion),
    assessmentRequired,
    approvedForUse: String(record.ApprovedForUse ?? record.approvedForUse).toLowerCase() === "true",
    status,
    reviewDate,
    createdAt: trim(record.CreatedAt || record.createdAt),
    createdBy: normalizeEmail(record.CreatedBy || record.createdBy),
    updatedAt: trim(record.UpdatedAt || record.updatedAt),
    updatedBy: normalizeEmail(record.UpdatedBy || record.updatedBy),
    archivedAt,
    archivedBy: normalizeEmail(record.ArchivedBy || record.archivedBy),
  };
}

export function mapCoshhAssessmentRecord(record = {}) {
  const initialLikelihood = Number(record.InitialLikelihood ?? record.initialLikelihood ?? 0);
  const initialSeverity = Number(record.InitialSeverity ?? record.initialSeverity ?? 0);
  const residualLikelihood = Number(record.ResidualLikelihood ?? record.residualLikelihood ?? 0);
  const residualSeverity = Number(record.ResidualSeverity ?? record.residualSeverity ?? 0);
  return {
    id: trim(record.AssessmentId || record.assessmentId),
    coshhId: trim(record.CoshhId || record.coshhId),
    companyFolderId: trim(record.CompanyFolderId || record.companyFolderId),
    assessmentTitle: trim(record.AssessmentTitle || record.assessmentTitle),
    activity: trim(record.Activity || record.activity),
    personsAtRisk: trim(record.PersonsAtRisk || record.personsAtRisk),
    frequencyOfUse: trim(record.FrequencyOfUse || record.frequencyOfUse),
    quantityUsed: trim(record.QuantityUsed || record.quantityUsed),
    durationOfExposure: trim(record.DurationOfExposure || record.durationOfExposure),
    exposureRoutes: trim(record.ExposureRoutes || record.exposureRoutes),
    hazards: trim(record.Hazards || record.hazards),
    existingControls: trim(record.ExistingControls || record.existingControls),
    engineeringControls: trim(record.EngineeringControls || record.engineeringControls),
    ppeRequired: trim(record.PpeRequired || record.ppeRequired),
    storageControls: trim(record.StorageControls || record.storageControls),
    spillProcedure: trim(record.SpillProcedure || record.spillProcedure),
    firstAid: trim(record.FirstAid || record.firstAid),
    fireResponse: trim(record.FireResponse || record.fireResponse),
    disposalMethod: trim(record.DisposalMethod || record.disposalMethod),
    emergencyActions: trim(record.EmergencyActions || record.emergencyActions),
    initialLikelihood,
    initialSeverity,
    initialRiskScore: Number(record.InitialRiskScore ?? record.initialRiskScore) || calculateRiskScore(initialLikelihood, initialSeverity),
    residualLikelihood,
    residualSeverity,
    residualRiskScore: Number(record.ResidualRiskScore ?? record.residualRiskScore) || calculateRiskScore(residualLikelihood, residualSeverity),
    additionalActions: trim(record.AdditionalActions || record.additionalActions),
    assessorName: trim(record.AssessorName || record.assessorName),
    assessmentDate: normalizeHealthSafetyDateKey(record.AssessmentDate || record.assessmentDate),
    reviewDate: normalizeHealthSafetyDateKey(record.ReviewDate || record.reviewDate),
    status: trim(record.Status || record.status).toLowerCase() || "draft",
    approvedBy: normalizeEmail(record.ApprovedBy || record.approvedBy),
    approvedAt: trim(record.ApprovedAt || record.approvedAt),
    createdAt: trim(record.CreatedAt || record.createdAt),
    createdBy: normalizeEmail(record.CreatedBy || record.createdBy),
    updatedAt: trim(record.UpdatedAt || record.updatedAt),
    updatedBy: normalizeEmail(record.UpdatedBy || record.updatedBy),
    archivedAt: trim(record.ArchivedAt || record.archivedAt),
    archivedBy: normalizeEmail(record.ArchivedBy || record.archivedBy),
  };
}

export function mapRiddorReportRecord(record = {}) {
  return {
    id: trim(record.RiddorId || record.riddorId),
    incidentId: trim(record.IncidentId || record.incidentId),
    companyFolderId: trim(record.CompanyFolderId || record.companyFolderId),
    decisionStatus: trim(record.DecisionStatus || record.decisionStatus).toLowerCase() || "decision_required",
    decisionDate: normalizeHealthSafetyDateKey(record.DecisionDate || record.decisionDate),
    decisionBy: normalizeEmail(record.DecisionBy || record.decisionBy),
    reportableOutcome: trim(record.ReportableOutcome || record.reportableOutcome),
    reportableCategory: trim(record.ReportableCategory || record.reportableCategory),
    fatality: String(record.Fatality ?? record.fatality).toLowerCase() === "true",
    specifiedInjury: String(record.SpecifiedInjury ?? record.specifiedInjury).toLowerCase() === "true",
    overSevenDayInjury: String(record.OverSevenDayInjury ?? record.overSevenDayInjury).toLowerCase() === "true",
    dangerousOccurrence: String(record.DangerousOccurrence ?? record.dangerousOccurrence).toLowerCase() === "true",
    occupationalDisease: String(record.OccupationalDisease ?? record.occupationalDisease).toLowerCase() === "true",
    gasIncident: String(record.GasIncident ?? record.gasIncident).toLowerCase() === "true",
    memberOfPublicHospitalTreatment:
      String(record.MemberOfPublicHospitalTreatment ?? record.memberOfPublicHospitalTreatment).toLowerCase() === "true",
    supportingReason: trim(record.SupportingReason || record.supportingReason),
    furtherInformationRequired: String(record.FurtherInformationRequired ?? record.furtherInformationRequired).toLowerCase() === "true",
    submissionStatus: trim(record.SubmissionStatus || record.submissionStatus).toLowerCase() || "not_started",
    submissionReference: trim(record.SubmissionReference || record.submissionReference),
    submittedAt: trim(record.SubmittedAt || record.submittedAt),
    submittedBy: normalizeEmail(record.SubmittedBy || record.submittedBy),
    authorityNotificationMethod: trim(record.AuthorityNotificationMethod || record.authorityNotificationMethod),
    followUpRequired: String(record.FollowUpRequired ?? record.followUpRequired).toLowerCase() === "true",
    followUpDate: normalizeHealthSafetyDateKey(record.FollowUpDate || record.followUpDate),
    linkedActionIds: trim(record.LinkedActionIds || record.linkedActionIds),
    createdAt: trim(record.CreatedAt || record.createdAt),
    createdBy: normalizeEmail(record.CreatedBy || record.createdBy),
    updatedAt: trim(record.UpdatedAt || record.updatedAt),
    updatedBy: normalizeEmail(record.UpdatedBy || record.updatedBy),
    archivedAt: trim(record.ArchivedAt || record.archivedAt),
    archivedBy: normalizeEmail(record.ArchivedBy || record.archivedBy),
  };
}

export function evaluateRiddorDecision(answers = {}) {
  const fatality = Boolean(answers.fatality);
  const specifiedInjury = Boolean(answers.specifiedInjury);
  const overSevenDayInjury = Boolean(answers.overSevenDayInjury);
  const dangerousOccurrence = Boolean(answers.dangerousOccurrence);
  const occupationalDisease = Boolean(answers.occupationalDisease);
  const gasIncident = Boolean(answers.gasIncident);
  const memberOfPublicHospitalTreatment = Boolean(answers.memberOfPublicHospitalTreatment);
  const furtherInformationRequired = Boolean(answers.furtherInformationRequired);

  if (furtherInformationRequired) {
    return { decisionStatus: "information_required", likelyReportable: false };
  }
  const likelyReportable =
    fatality ||
    specifiedInjury ||
    overSevenDayInjury ||
    dangerousOccurrence ||
    occupationalDisease ||
    gasIncident ||
    memberOfPublicHospitalTreatment;
  return {
    decisionStatus: likelyReportable ? "likely_reportable" : "not_reportable",
    likelyReportable,
  };
}

export const RIDDOR_DISCLAIMER =
  "Based on the information entered, this incident may be reportable under RIDDOR. Final determination must be confirmed by an authorised person. This workflow supports decision-making and does not replace competent legal or Health & Safety advice.";

export const COSHH_SDS_DRIVE_PATH = "Health & Safety/COSHH/Safety Data Sheets";
export const COSHH_ASSESSMENTS_DRIVE_PATH = "Health & Safety/COSHH/Assessments";
