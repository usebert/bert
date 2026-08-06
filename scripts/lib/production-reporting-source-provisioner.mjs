/**
 * Reporting workflow source provisioning — temporary verification records for report generation.
 */
import {
  buildQuestionsForAssignedAudit,
  cleanupStaleVerificationResults,
  flattenAssignedAudits,
  pickSafeAnswer,
  pickWorkflowTarget,
} from "./production-audit-workflow-core.mjs";
import {
  buildReportingAuditLocalSubmissionId,
  PRODUCTION_VERIFICATION_REPORTING_SOURCE_MODE,
  SUPPORTED_VERIFICATION_REPORT_TYPES,
} from "../../shared/production-verification-report.mjs";
import {
  buildProductionVerificationIncident,
  buildProductionVerificationIncidentId,
} from "../../shared/production-verification-incident.mjs";
import {
  buildProductionVerificationRiskAssessment,
  buildProductionVerificationRiskAssessmentId,
} from "../../shared/production-verification-risk-assessment.mjs";
import {
  buildProductionVerificationCoshhSubstance,
  buildProductionVerificationCoshhId,
} from "../../shared/production-verification-coshh.mjs";
import {
  buildProductionVerificationLolerEquipment,
  buildProductionVerificationLolerEquipmentId,
} from "../../shared/production-verification-loler.mjs";
import {
  isTransientWorkflowFailure,
  requestWithTransientRetries,
} from "./production-risk-assessment-transient-retry.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function withMasterSheet(path, masterSheetId) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}masterSheetId=${encodeURIComponent(trim(masterSheetId))}`;
}

export function buildReportingSourcePlan(runId = Date.now()) {
  return {
    audit: {
      localSubmissionId: buildReportingAuditLocalSubmissionId(runId),
      resultId: "",
    },
    incident: {
      incidentId: buildProductionVerificationIncidentId(runId),
    },
    "risk-assessment": {
      riskAssessmentId: buildProductionVerificationRiskAssessmentId(runId),
    },
    coshh: {
      coshhId: buildProductionVerificationCoshhId(runId),
    },
    loler: {
      equipmentId: buildProductionVerificationLolerEquipmentId(runId),
    },
  };
}

export function createEmptyReportingSources() {
  return Object.fromEntries(SUPPORTED_VERIFICATION_REPORT_TYPES.map((type) => [type, ""]));
}

export function getReportingSourceId(sources = {}, reportType = "") {
  const type = trim(reportType);
  if (type === "audit") {
    return trim(sources.audit);
  }
  if (type === "incident") {
    return trim(sources.incident);
  }
  if (type === "risk-assessment") {
    return trim(sources["risk-assessment"]);
  }
  if (type === "coshh") {
    return trim(sources.coshh);
  }
  if (type === "loler") {
    return trim(sources.loler);
  }
  return "";
}

export async function cleanupStaleReportingSources(request, workflowContext, config, runId) {
  const { companyFolderId, masterSheetId } = workflowContext;
  const plan = buildReportingSourcePlan(runId);
  const results = [];

  await cleanupStaleVerificationResults(request, companyFolderId, masterSheetId, config);

  const bulkCleanups = [
    request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/incidents/verification-cleanup`,
      { companyFolderId, masterSheetId, keepIncidentId: plan.incident.incidentId },
    ),
    request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/verification-cleanup`,
      { companyFolderId, masterSheetId, keepRiskAssessmentId: plan["risk-assessment"].riskAssessmentId },
    ),
    request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/verification-cleanup`,
      { companyFolderId, masterSheetId, keepCoshhId: plan.coshh.coshhId },
    ),
    request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/loler/verification-cleanup`,
      { companyFolderId, masterSheetId, keepEquipmentId: plan.loler.equipmentId },
    ),
  ];
  const settled = await Promise.allSettled(bulkCleanups);
  for (const item of settled) {
    if (item.status === "fulfilled") {
      results.push({ ok: item.value?.status === 200 && item.value?.json?.ok === true });
    } else {
      results.push({ ok: false });
    }
  }
  return { ok: true, results };
}

async function provisionAuditSource(request, config, workflowContext, login, runId, plan) {
  const { companyFolderId, masterSheetId } = workflowContext;
  const assigned = await request(
    "GET",
    withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/me/assigned-checks`, masterSheetId),
  );
  if (assigned.status !== 200 || assigned.json?.ok !== true) {
    return {
      ok: false,
      reportType: "audit",
      error: `Assigned checks returned HTTP ${assigned.status}.`,
    };
  }
  const schedules = Array.isArray(assigned.json?.schedules) ? assigned.json.schedules : [];
  const assignedRows = flattenAssignedAudits(schedules);
  const { submitTarget } = pickWorkflowTarget(assignedRows, config);
  if (!submitTarget) {
    return {
      ok: false,
      reportType: "audit",
      error: "Verification audit schedule is not assigned to the smoke account.",
    };
  }
  const questions = buildQuestionsForAssignedAudit(submitTarget.auditName, submitTarget.auditId);
  const answers = {};
  for (const question of questions) {
    const answer = pickSafeAnswer(question);
    answers[question.id] = answer.response;
    if (answer.textResponse) {
      answers[`${question.id}__text`] = answer.textResponse;
    }
  }
  const localSubmissionId = plan.audit.localSubmissionId;
  const retried = await requestWithTransientRetries(
    request,
    "POST",
    `/api/companies/${encodeURIComponent(companyFolderId)}/checks/${encodeURIComponent(submitTarget.scheduleId)}/complete`,
    {
      companyFolderId,
      masterSheetId,
      auditId: submitTarget.auditId,
      auditName: submitTarget.auditName,
      status: "completed",
      answers,
      findings: [],
      evidenceRefs: [],
      evidenceFiles: [],
      localSubmissionId,
      completedByName: login.userName || login.accountEmail,
      verificationSource: PRODUCTION_VERIFICATION_REPORTING_SOURCE_MODE,
    },
    { stageKey: "sourceProvisioning", maxRetries: 2 },
  );
  const response = retried.response;
  if (!(response?.status === 200 && response?.json?.ok === true)) {
    return {
      ok: false,
      reportType: "audit",
      error: `Audit source provisioning returned HTTP ${response?.status || 0}.`,
      response,
    };
  }
  const resultId = trim(response.json?.resultId);
  if (!resultId) {
    return {
      ok: false,
      reportType: "audit",
      error: "Audit source provisioning did not return a result ID.",
      response,
    };
  }
  plan.audit.resultId = resultId;
  return { ok: true, reportType: "audit", sourceId: resultId, idempotent: response.json?.alreadyExists === true };
}

async function provisionIncidentSource(request, config, workflowContext, login, runId, plan) {
  const { companyFolderId, masterSheetId } = workflowContext;
  const incidentId = plan.incident.incidentId;
  const payload = buildProductionVerificationIncident({
    runId,
    incidentId,
    reporterName: login.userName || login.accountEmail,
    reporterEmail: login.accountEmail || config.expectedEmail,
    verificationSource: PRODUCTION_VERIFICATION_REPORTING_SOURCE_MODE,
  });
  const retried = await requestWithTransientRetries(
    request,
    "POST",
    `/api/companies/${encodeURIComponent(companyFolderId)}/incidents`,
    { ...payload, companyFolderId, masterSheetId },
    { stageKey: "sourceProvisioning", maxRetries: 2 },
  );
  const response = retried.response;
  if (!(response?.status === 200 && response?.json?.ok === true)) {
    return {
      ok: false,
      reportType: "incident",
      error: `Incident source provisioning returned HTTP ${response?.status || 0}.`,
      response,
    };
  }
  const returnedId = trim(response.json?.incidentId || response.json?.incident?.incidentId) || incidentId;
  if (returnedId !== incidentId) {
    return {
      ok: false,
      reportType: "incident",
      error: `Expected incident source ID ${incidentId}, got ${returnedId || "(missing)"}.`,
      response,
    };
  }
  return { ok: true, reportType: "incident", sourceId: incidentId, idempotent: response.json?.alreadyExists === true };
}

async function provisionRiskAssessmentSource(request, config, workflowContext, login, runId, plan) {
  const { companyFolderId, masterSheetId } = workflowContext;
  const riskAssessmentId = plan["risk-assessment"].riskAssessmentId;
  const payload = buildProductionVerificationRiskAssessment({
    runId,
    companyFolderId,
    ownerUserId: login.userId || config.username,
    ownerName: login.userName || config.username,
    assessorUserId: login.userId || config.username,
    assessorName: login.userName || config.username,
  });
  const retried = await requestWithTransientRetries(
    request,
    "POST",
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments`,
    { ...payload, masterSheetId, verificationSource: PRODUCTION_VERIFICATION_REPORTING_SOURCE_MODE },
    { stageKey: "sourceProvisioning", maxRetries: 2 },
  );
  const response = retried.response;
  if (!(response?.status === 200 && response?.json?.ok === true)) {
    return {
      ok: false,
      reportType: "risk-assessment",
      error: `Risk Assessment source provisioning returned HTTP ${response?.status || 0}.`,
      response,
    };
  }
  const returnedId = trim(response.json?.item?.id || response.json?.riskAssessmentId) || riskAssessmentId;
  if (returnedId !== riskAssessmentId) {
    return {
      ok: false,
      reportType: "risk-assessment",
      error: `Expected risk assessment source ID ${riskAssessmentId}, got ${returnedId || "(missing)"}.`,
      response,
    };
  }
  return {
    ok: true,
    reportType: "risk-assessment",
    sourceId: riskAssessmentId,
    idempotent: response.json?.alreadyExists === true,
  };
}

async function provisionCoshhSource(request, config, workflowContext, login, runId, plan) {
  const { companyFolderId, masterSheetId } = workflowContext;
  const coshhId = plan.coshh.coshhId;
  const payload = buildProductionVerificationCoshhSubstance({
    runId,
    coshhId,
    companyFolderId,
  });
  const retried = await requestWithTransientRetries(
    request,
    "POST",
    withMasterSheet(
      `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/verification/substance`,
      masterSheetId,
    ),
    { ...payload, companyFolderId, masterSheetId, verificationSource: PRODUCTION_VERIFICATION_REPORTING_SOURCE_MODE },
    { stageKey: "sourceProvisioning", maxRetries: 2 },
  );
  const response = retried.response;
  if (!(response?.status === 200 && response?.json?.ok === true)) {
    return {
      ok: false,
      reportType: "coshh",
      error: `COSHH source provisioning returned HTTP ${response?.status || 0}.`,
      response,
    };
  }
  const returnedId = trim(response.json?.coshhId || response.json?.item?.coshhId) || coshhId;
  if (returnedId !== coshhId) {
    return {
      ok: false,
      reportType: "coshh",
      error: `Expected COSHH source ID ${coshhId}, got ${returnedId || "(missing)"}.`,
      response,
    };
  }
  return { ok: true, reportType: "coshh", sourceId: coshhId, idempotent: response.json?.alreadyExists === true };
}

async function provisionLolerSource(request, config, workflowContext, login, runId, plan) {
  const { companyFolderId, masterSheetId } = workflowContext;
  const equipmentId = plan.loler.equipmentId;
  const payload = buildProductionVerificationLolerEquipment({
    runId,
    equipmentId,
    companyFolderId,
    assignedEmail: login.accountEmail || config.expectedEmail,
    assignedPersonName: login.userName || login.accountEmail,
    verificationSource: PRODUCTION_VERIFICATION_REPORTING_SOURCE_MODE,
  });
  const retried = await requestWithTransientRetries(
    request,
    "POST",
    withMasterSheet(
      `/api/companies/${encodeURIComponent(companyFolderId)}/loler/verification/equipment`,
      masterSheetId,
    ),
    { ...payload, companyFolderId, masterSheetId },
    { stageKey: "sourceProvisioning", maxRetries: 2 },
  );
  const response = retried.response;
  if (!(response?.status === 200 && response?.json?.ok === true)) {
    return {
      ok: false,
      reportType: "loler",
      error: `LOLER source provisioning returned HTTP ${response?.status || 0}.`,
      response,
    };
  }
  const returnedId = trim(response.json?.equipmentId || response.json?.item?.equipmentId) || equipmentId;
  if (returnedId !== equipmentId) {
    return {
      ok: false,
      reportType: "loler",
      error: `Expected LOLER source ID ${equipmentId}, got ${returnedId || "(missing)"}.`,
      response,
    };
  }
  return {
    ok: true,
    reportType: "loler",
    sourceId: equipmentId,
    idempotent: response.json?.alreadyExists === true,
  };
}

const PROVISIONERS = {
  audit: provisionAuditSource,
  incident: provisionIncidentSource,
  "risk-assessment": provisionRiskAssessmentSource,
  coshh: provisionCoshhSource,
  loler: provisionLolerSource,
};

export async function provisionReportingSource(request, config, workflowContext, login, reportType, runId, plan) {
  const provisioner = PROVISIONERS[trim(reportType)];
  if (!provisioner) {
    return { ok: false, reportType, error: `Unsupported report type '${reportType}'.` };
  }
  return provisioner(request, config, workflowContext, login, runId, plan);
}

export async function provisionAllReportingSources(request, config, workflowContext, login, runId) {
  const plan = buildReportingSourcePlan(runId);
  const results = [];
  for (const reportType of SUPPORTED_VERIFICATION_REPORT_TYPES) {
    const result = await provisionReportingSource(request, config, workflowContext, login, reportType, runId, plan);
    results.push(result);
    if (!result.ok) {
      return { ok: false, failedReportType: reportType, plan, results };
    }
    workflowContext.sources[reportType] = result.sourceId;
  }
  workflowContext.sourcePlan = plan;
  return { ok: true, plan, results };
}

export async function cleanupReportingSources(request, workflowContext, config, plan, sources = {}) {
  const { companyFolderId, masterSheetId } = workflowContext;
  const results = [];
  const auditResultId = trim(plan?.audit?.resultId || sources.audit);
  if (auditResultId) {
    const cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/audit-results/${encodeURIComponent(auditResultId)}/verification-cleanup`,
      { companyFolderId, masterSheetId, localSubmissionId: plan?.audit?.localSubmissionId },
    );
    results.push({ kind: "audit", sourceId: auditResultId, ok: cleanup.status === 200 && cleanup.json?.ok === true });
  }
  const incidentId = trim(plan?.incident?.incidentId || sources.incident);
  if (incidentId) {
    const cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/incidents/${encodeURIComponent(incidentId)}/verification-cleanup`,
      { companyFolderId, masterSheetId },
    );
    results.push({ kind: "incident", sourceId: incidentId, ok: cleanup.status === 200 && cleanup.json?.ok === true });
  }
  const riskAssessmentId = trim(plan?.["risk-assessment"]?.riskAssessmentId || sources["risk-assessment"]);
  if (riskAssessmentId) {
    const cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/verification-cleanup`,
      { companyFolderId, masterSheetId },
    );
    results.push({
      kind: "risk-assessment",
      sourceId: riskAssessmentId,
      ok: cleanup.status === 200 && cleanup.json?.ok === true,
    });
  }
  const coshhId = trim(plan?.coshh?.coshhId || sources.coshh);
  if (coshhId) {
    const cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/${encodeURIComponent(coshhId)}/verification-cleanup`,
      { companyFolderId, masterSheetId },
    );
    results.push({ kind: "coshh", sourceId: coshhId, ok: cleanup.status === 200 && cleanup.json?.ok === true });
  }
  const equipmentId = trim(plan?.loler?.equipmentId || sources.loler);
  if (equipmentId) {
    const cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/loler/equipment/${encodeURIComponent(equipmentId)}/verification-cleanup`,
      { companyFolderId, masterSheetId },
    );
    results.push({ kind: "loler", sourceId: equipmentId, ok: cleanup.status === 200 && cleanup.json?.ok === true });
  }
  return { ok: results.every((item) => item.ok), results };
}
