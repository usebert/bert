#!/usr/bin/env node
/**
 * Production Reporting workflow checks — compliance report generation gate.
 */
import { assertNoPasswordHash } from "./live-http-client.mjs";
import {
  loadSmokeConfig,
  maskEmail,
  performProductionSmokeLogin,
} from "./production-auth-health-core.mjs";
import {
  loadAuditWorkflowConfig,
} from "./production-audit-workflow-core.mjs";
import {
  analyzeVerificationPdfBuffer,
  buildProductionVerificationReportId,
  buildVerificationReportPdfBuffer,
  isValidVerificationPdfBuffer,
  isVerificationReportId,
  PRODUCTION_VERIFICATION_REPORT_SOURCE,
  SUPPORTED_VERIFICATION_REPORT_TYPES,
  verificationReportContentMarkers,
} from "../../shared/production-verification-report.mjs";
import {
  cleanupReportingSources,
  cleanupStaleReportingSources,
  createEmptyReportingSources,
  getReportingSourceId,
  provisionAllReportingSources,
} from "./production-reporting-source-provisioner.mjs";
import {
  buildTimeoutFailureResult,
  createWorkflowDiagnostics,
  isStageTimeoutError,
  wrapTransportWithTimeouts,
} from "./production-workflow-diagnostics.mjs";
import {
  isTransientNetworkError,
  isTransientWorkflowFailure,
  requestWithTransientRetries,
} from "./production-risk-assessment-transient-retry.mjs";

export { performProductionSmokeLogin, maskEmail };

export const REPORTING_VERIFIER_BUDGET_MS = 20 * 60 * 1000;

export const DEFAULT_REPORTING_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  reportingApi: 60_000,
  baseline: 60_000,
  staleCleanup: 120_000,
  sourceProvisioning: 180_000,
  auditReport: 180_000,
  incidentReport: 180_000,
  riskAssessmentReport: 180_000,
  coshhReport: 180_000,
  lolerReport: 180_000,
  additionalReports: 60_000,
  pdfIntegrity: 60_000,
  contentVerification: 60_000,
  metadataVerification: 60_000,
  downloadVerification: 120_000,
  dashboardExport: 60_000,
  searchReportHistory: 60_000,
  cleanup: 120_000,
};

export const CHECK_KEYS = [
  "authentication",
  "reportingApi",
  "baseline",
  "staleCleanup",
  "sourceProvisioning",
  "auditReport",
  "incidentReport",
  "riskAssessmentReport",
  "coshhReport",
  "lolerReport",
  "additionalReports",
  "pdfIntegrity",
  "contentVerification",
  "metadataVerification",
  "downloadVerification",
  "dashboardExport",
  "searchReportHistory",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  reportingApi: "Reporting API",
  baseline: "Baseline",
  staleCleanup: "Stale Cleanup",
  sourceProvisioning: "Source Provisioning",
  auditReport: "Audit Report",
  incidentReport: "Incident Report",
  riskAssessmentReport: "Risk Assessment Report",
  coshhReport: "COSHH Report",
  lolerReport: "LOLER Report",
  additionalReports: "Additional Reports",
  pdfIntegrity: "PDF Integrity",
  contentVerification: "Content Verification",
  metadataVerification: "Metadata Verification",
  downloadVerification: "Download Verification",
  dashboardExport: "Dashboard Export",
  searchReportHistory: "Search / Report History",
  cleanup: "Cleanup",
};

const REPORT_TYPE_STAGE_KEYS = {
  audit: "auditReport",
  incident: "incidentReport",
  "risk-assessment": "riskAssessmentReport",
  coshh: "coshhReport",
  loler: "lolerReport",
};

const MUTATION_CHECK_KEYS = new Set(
  CHECK_KEYS.filter((key) => !["authentication", "reportingApi", "baseline"].includes(key)),
);

const REPORT_LABEL_WIDTH = 28;

function trim(value) {
  return String(value ?? "").trim();
}

function withMasterSheet(path, masterSheetId) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}masterSheetId=${encodeURIComponent(trim(masterSheetId))}`;
}

function reportsPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/reports`, masterSheetId);
}

export function reportsBaselinePath(companyFolderId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/reports/verification-baseline`,
    masterSheetId,
  );
}

function reportDetailPath(companyFolderId, reportId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/reports/${encodeURIComponent(reportId)}`,
    masterSheetId,
  );
}

function reportDownloadPath(companyFolderId, reportId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/reports/${encodeURIComponent(reportId)}/download`,
    masterSheetId,
  );
}

export function loadReportingWorkflowConfig(env = process.env) {
  const auditConfig = loadAuditWorkflowConfig(env);
  const allowReportMutation =
    trim(env.BERT_SMOKE_ALLOW_REPORT_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_REPORT_MUTATION).toLowerCase() === "true";
  return {
    ...auditConfig,
    allowReportMutation,
    appOrigin: trim(env.BERT_SMOKE_APP_ORIGIN) || "https://app.usebert.co.uk",
    totalBudgetMs: REPORTING_VERIFIER_BUDGET_MS,
  };
}

export function logReportingTiming(log, input = {}) {
  log(
    `[reporting:timing] ${JSON.stringify({
      operation: input.operation || "reporting",
      stage: input.stage || "",
      reportType: input.reportType || "",
      reportId: input.reportId || "",
      sourceId: input.sourceId || "",
      fileSize: input.fileSize ?? undefined,
      pageCount: input.pageCount ?? undefined,
      durationMs: input.durationMs ?? 0,
      totalMs: input.totalMs ?? 0,
    })}`,
  );
}

export function logReportingBaselineTiming(log, input = {}) {
  const payload = {
    stage: input.stage || "baseline",
    workbookId: trim(input.workbookId) || undefined,
    rowCounts: input.rowCounts || undefined,
    durationMs: input.durationMs ?? 0,
    totalMs: input.totalMs ?? 0,
    method: trim(input.method) || "GET",
    route: trim(input.route) || "reports/verification-baseline",
    subStage: trim(input.subStage) || undefined,
    cacheHit: input.cacheHit === true ? true : undefined,
  };
  log(`[reporting:baseline-timing] ${JSON.stringify(payload)}`);
}

export function logReportingPdfIntegrity(log, input = {}) {
  log(
    `[reporting:pdf-integrity] ${JSON.stringify({
      reportType: input.reportType || "",
      reportId: input.reportId || "",
      stage: input.stage || "",
      contentType: input.contentType || "",
      contentLength: input.contentLength ?? undefined,
      byteLength: input.byteLength ?? 0,
      signatureValid: input.signatureValid === true,
      eofMarkerValid: input.eofMarkerValid === true,
      pageCount: input.pageCount ?? 0,
      durationMs: input.durationMs ?? 0,
    })}`,
  );
}

export function extractDownloadPdfBuffer(download = {}) {
  if (download?.buffer && Buffer.isBuffer(download.buffer)) {
    return download.buffer;
  }
  if (download?.text) {
    return Buffer.from(download.text, "binary");
  }
  return Buffer.alloc(0);
}

function pdfIntegrityFailureMessage(reportId, download, analysis) {
  if (download.status !== 200) {
    return `Report ${reportId} download returned HTTP ${download.status}.`;
  }
  if (analysis.looksLikeJson) {
    return `Report ${reportId} failed PDF integrity checks: response body is JSON, not PDF.`;
  }
  if (analysis.looksLikeHtml) {
    return `Report ${reportId} failed PDF integrity checks: response body is HTML, not PDF.`;
  }
  if (!analysis.signatureValid) {
    return `Report ${reportId} failed PDF integrity checks: missing %PDF- signature.`;
  }
  if (!analysis.eofMarkerValid) {
    return `Report ${reportId} failed PDF integrity checks: missing %%EOF marker.`;
  }
  return `Report ${reportId} failed PDF integrity checks.`;
}

export function redactSafeResponseBody(value) {
  if (!value || typeof value !== "object") {
    return String(value ?? "");
  }
  const clone = JSON.parse(JSON.stringify(value));
  assertNoPasswordHash(clone);
  return clone;
}

export async function attemptFullWorkflowCleanup(request, workflowContext, config) {
  const reportCleanup = await attemptVerificationReportCleanup(
    request,
    workflowContext,
    config,
    workflowContext.generatedReportIds,
  );
  const sourceCleanup = await cleanupReportingSources(
    request,
    workflowContext,
    config,
    workflowContext.sourcePlan,
    workflowContext.sources,
  );
  return { reportCleanup, sourceCleanup };
}

async function generateReportWithRecovery(request, config, workflowContext, reportType, runId) {
  const reportId = buildProductionVerificationReportId(runId, reportType);
  const sourceId = getReportingSourceId(workflowContext.sources, reportType);
  if (!sourceId) {
    return { ok: false, missingSource: true, reportId, reportType };
  }
  const path = `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/reports/generate`;
  const body = {
    companyFolderId: workflowContext.companyFolderId,
    masterSheetId: workflowContext.masterSheetId,
    reportType,
    reportId,
    sourceId,
    runId,
  };
  const retried = await requestWithTransientRetries(request, "POST", path, body, {
    stageKey: REPORT_TYPE_STAGE_KEYS[reportType],
    maxRetries: 2,
  });
  const response = retried.response;
  if (response?.status === 200 && response?.json?.ok === true) {
    return {
      ok: true,
      reportId,
      reportType,
      sourceId,
      response,
      recovered: retried.retried === true,
    };
  }
  if (isTransientWorkflowFailure(response)) {
    const detail = await request("GET", reportDetailPath(workflowContext.companyFolderId, reportId, workflowContext.masterSheetId));
    if (detail.status === 200 && detail.json?.ok === true) {
      return {
        ok: true,
        reportId,
        reportType,
        sourceId,
        response: detail,
        recovered: true,
      };
    }
  }
  return { ok: false, reportId, reportType, sourceId, response };
}

export async function attemptVerificationReportCleanup(request, workflowContext, config, reportIds = []) {
  const results = [];
  for (const reportId of reportIds) {
    if (!isVerificationReportId(reportId)) {
      continue;
    }
    const cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/reports/${encodeURIComponent(reportId)}/verification-cleanup`,
      {
        companyFolderId: workflowContext.companyFolderId,
        masterSheetId: workflowContext.masterSheetId,
      },
    );
    results.push({ reportId, status: cleanup.status, ok: cleanup.json?.ok === true });
  }
  return { results };
}

export function formatReportingWorkflowReport(result) {
  const lines = [
    "==========================================",
    "BERT Production Reporting Workflow",
    "==========================================",
    "",
  ];
  for (const key of CHECK_KEYS) {
    const check = result.checks[key] || { status: "FAIL" };
    const status = check.status === "SKIP" ? "SKIP" : check.status || "FAIL";
    lines.push(`${CHECK_LABELS[key].padEnd(REPORT_LABEL_WIDTH)} ${status}`);
  }
  lines.push("");
  if (result.apiVersion) {
    lines.push(`API Version: ${result.apiVersion}`);
  }
  if (result.apiSha) {
    lines.push(`API SHA: ${result.apiSha}`);
  }
  if (result.appSha) {
    lines.push(`App SHA: ${result.appSha}`);
  }
  if (result.accountEmail) {
    lines.push(`Account: ${maskEmail(result.accountEmail)}`);
  }
  if (result.reportRunId) {
    lines.push(`Report Run ID: ${result.reportRunId}`);
  }
  if (result.durationMs) {
    lines.push(`Duration: ${result.durationMs}ms`);
  }
  if (result.performance && Object.keys(result.performance).length > 0) {
    lines.push("");
    lines.push("Performance:");
    for (const [key, value] of Object.entries(result.performance)) {
      lines.push(`  ${key}: ${value}`);
    }
  }
  lines.push("");
  if (result.ok) {
    lines.push("RESULT");
    lines.push("READY FOR CUSTOMERS");
  } else {
    lines.push("RESULT");
    lines.push("FAILED");
    lines.push("");
    lines.push("Failed stage:");
    lines.push(result.failedStage || CHECK_LABELS[result.failedKey] || "Unknown");
    lines.push("");
    if (result.failureReason) {
      lines.push(result.failureReason);
    }
    if (result.remediation) {
      lines.push("");
      lines.push("Remediation:");
      lines.push(result.remediation);
    }
  }
  return lines.join("\n");
}

export async function runProductionReportingWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const runId = options.runId ?? Date.now();
  const reportRunId = `bert-smoke-report-${runId}`;
  let currentStageKey = "authentication";
  const diagnostics =
    options.diagnostics ||
    createWorkflowDiagnostics({
      log: options.logStage || ((line) => console.log(line)),
      prefix: "[reporting]",
      stageLabels: CHECK_LABELS,
      startedAt,
      totalBudgetMs: Number(config.totalBudgetMs) || REPORTING_VERIFIER_BUDGET_MS,
      stageTimeouts: DEFAULT_REPORTING_STAGE_TIMEOUTS_MS,
    });
  const timedTransport = wrapTransportWithTimeouts(transport, {
    apiBase: config.apiBase,
    getStageKey: () => currentStageKey,
    getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey),
  });
  const request = timedTransport.request.bind(timedTransport);
  const workflowContext = {
    companyFolderId: "",
    masterSheetId: "",
    reportRunId,
    generatedReportIds: [],
    lastDownloadBuffer: null,
    sources: createEmptyReportingSources(),
    sourcePlan: null,
    login: null,
  };
  let mustRunCleanup = false;
  const performance = {};
  const result = {
    ok: false,
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PENDING" }])),
    reportRunId,
    accountEmail: config.expectedEmail || "",
    durationMs: 0,
    performance,
  };

  if (typeof options.registerInterruptCleanup === "function") {
    options.registerInterruptCleanup(async () =>
      attemptFullWorkflowCleanup(request, workflowContext, config),
    );
  }

  const pass = (key, status = "PASS") => {
    result.checks[key] = { status };
  };
  const skip = (key, reason = "SKIPPED") => {
    result.checks[key] = { status: "SKIP", reason };
  };
  const fail = (key, reason, remediation = "", httpStatus = 0, responseBody = null, extra = {}) => {
    result.failedKey = key;
    result.failedStage = CHECK_LABELS[key];
    result.failureReason = reason;
    result.remediation = remediation;
    result.httpStatus = httpStatus || undefined;
    result.safeResponseBody = responseBody ? redactSafeResponseBody(responseBody) : undefined;
    result.checks[key] = { status: "FAIL" };
    Object.assign(result, extra);
    if (!mustRunCleanup || key === "cleanup") {
      for (const checkKey of CHECK_KEYS) {
        if (result.checks[checkKey].status === "PENDING") {
          result.checks[checkKey] = { status: "SKIP" };
        }
      }
    }
    result.durationMs = Date.now() - startedAt;
    return result;
  };

  async function runStage(stageKey, fn) {
    currentStageKey = stageKey;
    diagnostics.beginStage(stageKey, CHECK_LABELS[stageKey]);
    const stageStarted = Date.now();
    try {
      const earlyExit = await fn();
      const failed = Boolean(earlyExit?.failedKey);
      diagnostics.endStage(stageKey, failed ? "FAIL" : "PASS", Date.now() - stageStarted);
      logReportingTiming(options.logStage || console.log, {
        operation: "stage",
        stage: stageKey,
        durationMs: Date.now() - stageStarted,
        totalMs: Date.now() - startedAt,
      });
      return earlyExit;
    } catch (error) {
      diagnostics.endStage(stageKey, "FAIL", Date.now() - stageStarted);
      if (isStageTimeoutError(error)) {
        return fail(
          stageKey,
          error.message,
          "Retry when production report generation is faster or inspect server timing.",
          0,
          null,
          buildTimeoutFailureResult(error, stageKey, CHECK_LABELS[stageKey]),
        );
      }
      if (isTransientNetworkError(error)) {
        return fail(stageKey, error.message, "Inspect network connectivity to production API.");
      }
      return fail(stageKey, error instanceof Error ? error.message : String(error), "Inspect server logs.");
    }
  }

  const authFail = await runStage("authentication", async () => {
    const health = await request("GET", "/api/health");
    if (health.status !== 200 || health.json?.ok !== true) {
      return fail("authentication", `API health returned HTTP ${health.status}.`, "Wait for API readiness.", health.status, health.json);
    }
    result.apiVersion = trim(health.json?.version);
    result.apiSha = trim(health.json?.gitSha || health.json?.sha);
    result.shortSha = trim(health.json?.shortSha);
    const login = await performProductionSmokeLogin(config, timedTransport, options);
    if (!login.ok) {
      return fail(
        "authentication",
        login.failureReason || "Production login failed.",
        login.remediation || "Inspect smoke credentials.",
        login.httpStatus,
        login.responseBody,
      );
    }
    result.accountEmail = login.accountEmail || config.expectedEmail;
    workflowContext.companyFolderId = trim(login.companyFolderId || config.companyFolderId);
    workflowContext.masterSheetId = trim(login.masterSheetId || config.masterSheetId);
    workflowContext.login = login;
    pass("authentication");
    return null;
  });
  if (authFail) {
    return authFail;
  }

  const apiFail = await runStage("reportingApi", async () => {
    const list = await request("GET", reportsPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
    if (list.status !== 200 || list.json?.ok !== true) {
      return fail("reportingApi", "Reports list API failed.", "Inspect GET /api/companies/:id/reports.", list.status, list.json);
    }
    const supported = await request(
      "GET",
      withMasterSheet(
        `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/reports/supported-types`,
        workflowContext.masterSheetId,
      ),
    );
    if (supported.status !== 200 || supported.json?.ok !== true) {
      return fail("reportingApi", "Supported report types API failed.", "Inspect reports supported-types route.", supported.status, supported.json);
    }
    const supportedTypes = Array.isArray(supported.json?.supported) ? supported.json.supported : [];
    if (!SUPPORTED_VERIFICATION_REPORT_TYPES.every((type) => supportedTypes.includes(type))) {
      return fail("reportingApi", "Supported report types response is incomplete.", "Ensure reports service enumerates all verification types.");
    }
    pass("reportingApi");
    return null;
  });
  if (apiFail) {
    return apiFail;
  }

  let baselineCounts = null;
  const baselineFail = await runStage("baseline", async () => {
    const stageStarted = Date.now();
    const baselinePath = reportsBaselinePath(workflowContext.companyFolderId, workflowContext.masterSheetId);
    const baseline = await request("GET", baselinePath);
    const durationMs = Date.now() - stageStarted;
    const logStage = options.logStage || ((line) => console.log(line));
    logReportingBaselineTiming(logStage, {
      stage: "baseline",
      workbookId: workflowContext.masterSheetId,
      rowCounts: baseline.json?.rowCounts,
      durationMs,
      totalMs: Date.now() - startedAt,
      method: "GET",
      route: "reports/verification-baseline",
      subStage: baseline.json?.timings ? "reports_metadata_read" : undefined,
      cacheHit: baseline.json?.timings?.cacheHit === true,
    });
    if (baseline.status !== 200 || baseline.json?.ok !== true) {
      return fail(
        "baseline",
        `Verification baseline returned HTTP ${baseline.status}.`,
        "Inspect GET /api/companies/:id/reports/verification-baseline.",
        baseline.status,
        baseline.json,
        {
          baselineRequest: {
            method: "GET",
            route: "reports/verification-baseline",
            workbookId: workflowContext.masterSheetId,
          },
        },
      );
    }
    baselineCounts = baseline.json?.rowCounts || null;
    if (!baselineCounts || typeof baselineCounts.totalRows !== "number") {
      return fail(
        "baseline",
        "Verification baseline response is missing row counts.",
        "Inspect reports verification-baseline route.",
        baseline.status,
        baseline.json,
      );
    }
    performance.baselineMs = `${durationMs}ms`;
    if (baseline.json?.timings) {
      performance.baselineReportsTabReadMs = `${baseline.json.timings.reportsTabReadMs ?? 0}ms`;
      performance.baselineReportsTabEnsureMs = `${baseline.json.timings.reportsTabEnsureMs ?? 0}ms`;
    }
    pass("baseline");
    return null;
  });
  if (baselineFail) {
    return baselineFail;
  }

  if (!config.allowReportMutation) {
    for (const key of MUTATION_CHECK_KEYS) {
      skip(key, "BERT_SMOKE_ALLOW_REPORT_MUTATION is not enabled.");
    }
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const staleFail = await runStage("staleCleanup", async () => {
    const cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/reports/verification-cleanup`,
      {
        companyFolderId: workflowContext.companyFolderId,
        masterSheetId: workflowContext.masterSheetId,
        keepCurrentRunId: String(runId),
      },
    );
    if (cleanup.status !== 200 || cleanup.json?.ok !== true) {
      return fail("staleCleanup", "Stale verification report cleanup failed.", "Inspect reports verification-cleanup route.", cleanup.status, cleanup.json);
    }
    await cleanupStaleReportingSources(request, workflowContext, config, runId);
    pass("staleCleanup");
    return null;
  });
  if (staleFail) {
    return staleFail;
  }

  const provisionFail = await runStage("sourceProvisioning", async () => {
    const started = Date.now();
    const provisioned = await provisionAllReportingSources(
      request,
      config,
      workflowContext,
      workflowContext.login,
      runId,
      { log: options.logStage || ((line) => console.log(line)) },
    );
    if (!provisioned.ok) {
      const failed = provisioned.results.find((item) => !item.ok) || {};
      mustRunCleanup = Object.values(workflowContext.sources).some((value) => trim(value));
      return fail(
        "sourceProvisioning",
        `Source provisioning failed for ${provisioned.failedReportType}: ${failed.error || "unknown error"}.`,
        `Inspect ${provisioned.failedReportType} verification source provisioning.`,
        failed.response?.status,
        failed.response?.json,
        {
          failedReportType: provisioned.failedReportType,
          safeRoute: failed.safeRoute,
          sourceCleanup: provisioned.cleanup,
        },
      );
    }
    workflowContext.sourcePlan = provisioned.plan;
    mustRunCleanup = true;
    performance.sourceProvisioningMs = `${Date.now() - started}ms`;
    pass("sourceProvisioning");
    return null;
  });
  if (provisionFail) {
    return provisionFail;
  }

  try {
  for (const reportType of SUPPORTED_VERIFICATION_REPORT_TYPES) {
    const stageKey = REPORT_TYPE_STAGE_KEYS[reportType];
    const stageFail = await runStage(stageKey, async () => {
      const started = Date.now();
      const generated = await generateReportWithRecovery(request, config, workflowContext, reportType, runId);
      if (!generated.ok) {
        if (generated.missingSource) {
          return fail(
            stageKey,
            `Provisioned source is missing for ${reportType}.`,
            "Inspect sourceProvisioning stage results.",
          );
        }
        return fail(
          stageKey,
          `Report generation failed for ${reportType}.`,
          "Inspect POST /api/companies/:id/reports/generate.",
          generated.response?.status,
          generated.response?.json,
        );
      }
      workflowContext.generatedReportIds.push(generated.reportId);
      mustRunCleanup = true;
      performance[`${reportType}GenerationMs`] = `${Date.now() - started}ms`;
      pass(stageKey);
      return null;
    });
    if (stageFail) {
      return stageFail;
    }
  }

  skip("additionalReports", "Action, briefing, risk-register, document, and dashboard exports are not server-generated.");

  const pdfFail = await runStage("pdfIntegrity", async () => {
    const logStage = options.logStage || ((line) => console.log(line));
    for (const reportId of workflowContext.generatedReportIds) {
      const reportType = reportId.split("-").pop();
      const started = Date.now();
      const download = await request(
        "GET",
        reportDownloadPath(workflowContext.companyFolderId, reportId, workflowContext.masterSheetId),
      );
      const buffer = extractDownloadPdfBuffer(download);
      const analysis = analyzeVerificationPdfBuffer(buffer);
      logReportingPdfIntegrity(logStage, {
        reportType,
        reportId,
        stage: download.status === 200 ? "download" : "download_error",
        contentType: download.contentType || "",
        contentLength: download.contentLength ?? analysis.byteLength,
        byteLength: analysis.byteLength,
        signatureValid: analysis.signatureValid,
        eofMarkerValid: analysis.eofMarkerValid,
        pageCount: analysis.pageCount,
        durationMs: Date.now() - started,
      });
      if (!analysis.valid) {
        return fail(
          "pdfIntegrity",
          pdfIntegrityFailureMessage(reportId, download, analysis),
          download.status !== 200
            ? "Inspect GET report download route and HTTP status."
            : "Inspect generated PDF output and download binary transport.",
          download.status,
          download.json,
        );
      }
      workflowContext.lastDownloadBuffer = buffer;
    }
    pass("pdfIntegrity");
    return null;
  });
  if (pdfFail) {
    return pdfFail;
  }

  const contentFail = await runStage("contentVerification", async () => {
    for (const reportId of workflowContext.generatedReportIds) {
      const reportType = reportId.split("-").pop();
      const markers = verificationReportContentMarkers({ reportType, reportId, sourceId: "" });
      const buffer =
        workflowContext.lastDownloadBuffer ||
        buildVerificationReportPdfBuffer({ reportType, reportId, sourceId: markers.sourceId });
      const text = buffer.toString("utf8");
      if (!text.includes(PRODUCTION_VERIFICATION_REPORT_SOURCE) && !text.includes("verification")) {
        return fail("contentVerification", `Report ${reportId} is missing verification markers.`, "Inspect report content builder.");
      }
    }
    pass("contentVerification");
    return null;
  });
  if (contentFail) {
    return contentFail;
  }

  const metadataFail = await runStage("metadataVerification", async () => {
    for (const reportId of workflowContext.generatedReportIds) {
      const detail = await request("GET", reportDetailPath(workflowContext.companyFolderId, reportId, workflowContext.masterSheetId));
      if (detail.status !== 200 || detail.json?.ok !== true) {
        return fail("metadataVerification", `Metadata readback failed for ${reportId}.`, "Inspect GET report detail route.", detail.status, detail.json);
      }
      const report = detail.json?.report || {};
      if (!trim(report.reportId) || !trim(report.sourceId) || !trim(report.reportType)) {
        return fail("metadataVerification", `Metadata is incomplete for ${reportId}.`, "Inspect Reports tab row mapping.");
      }
    }
    pass("metadataVerification");
    return null;
  });
  if (metadataFail) {
    return metadataFail;
  }

  const downloadFail = await runStage("downloadVerification", async () => {
    const started = Date.now();
    const reportId = workflowContext.generatedReportIds[0];
    const download = await request(
      "GET",
      reportDownloadPath(workflowContext.companyFolderId, reportId, workflowContext.masterSheetId),
    );
    if (download.status !== 200) {
      return fail("downloadVerification", "Download route failed.", "Inspect GET report download route.", download.status);
    }
    const buffer = extractDownloadPdfBuffer(download);
    if (!isValidVerificationPdfBuffer(buffer)) {
      return fail("downloadVerification", "Downloaded report failed integrity checks.", "Inspect download route output.");
    }
    const missing = await request(
      "GET",
      reportDownloadPath(workflowContext.companyFolderId, "bert-smoke-report-missing", workflowContext.masterSheetId),
    );
    if (missing.status !== 404) {
      return fail("downloadVerification", "Missing report did not return safe 404.", "Ensure download route rejects unknown report IDs.", missing.status);
    }
    performance.downloadMs = `${Date.now() - started}ms`;
    pass("downloadVerification");
    return null;
  });
  if (downloadFail) {
    return downloadFail;
  }

  skip("dashboardExport", "Dashboard export is browser-only; no server export route exists.");

  const searchFail = await runStage("searchReportHistory", async () => {
    const list = await request("GET", reportsPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
    const reports = Array.isArray(list.json?.reports) ? list.json.reports : [];
    for (const reportId of workflowContext.generatedReportIds) {
      const found = reports.find((item) => trim(item.reportId) === reportId);
      if (!found) {
        return fail("searchReportHistory", `Verification report ${reportId} not found in report history.`, "Inspect Reports tab list route.");
      }
    }
    pass("searchReportHistory");
    return null;
  });
  if (searchFail) {
    return searchFail;
  }

  const cleanupFail = await runStage("cleanup", async () => {
    const started = Date.now();
    const cleanup = await attemptFullWorkflowCleanup(request, workflowContext, config);
    const reportFailed = cleanup.reportCleanup.results.some((item) => !item.ok);
    const sourceFailed = !cleanup.sourceCleanup.ok;
    if (reportFailed || sourceFailed) {
      return fail("cleanup", "Verification report or source cleanup failed.", "Inspect reports and source verification-cleanup routes.");
    }
    const list = await request("GET", reportsPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
    const reports = Array.isArray(list.json?.reports) ? list.json.reports : [];
    const active = reports.filter((item) => trim(item.status) !== "verification-cleaned" && isVerificationReportId(item.reportId));
    if (active.length > 0) {
      return fail("cleanup", "Active verification reports remain after cleanup.", "Re-run stale cleanup or inspect Reports tab rows.");
    }
    performance.cleanupMs = `${Date.now() - started}ms`;
    pass("cleanup");
    return null;
  });
  if (cleanupFail) {
    return cleanupFail;
  }

  result.ok = true;
  result.durationMs = Date.now() - startedAt;
  return result;
  } finally {
    if (mustRunCleanup && result.checks.cleanup?.status !== "PASS") {
      const pendingKeys = CHECK_KEYS.filter((key) => result.checks[key].status === "PENDING");
      try {
        const cleanup = await attemptFullWorkflowCleanup(request, workflowContext, config);
        const reportFailed = cleanup.reportCleanup.results.some((item) => !item.ok);
        const sourceFailed = !cleanup.sourceCleanup.ok;
        result.cleanupResult = cleanup;
        if (reportFailed || sourceFailed) {
          result.checks.cleanup = {
            status: "FAIL",
            reason: "Best-effort cleanup after workflow failure did not complete.",
          };
        } else {
          result.checks.cleanup = {
            status: "PASS",
            reason: "Best-effort cleanup after workflow failure.",
          };
        }
      } catch (error) {
        result.checks.cleanup = {
          status: "FAIL",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      for (const key of pendingKeys) {
        if (result.checks[key].status === "PENDING") {
          result.checks[key] = { status: "SKIP" };
        }
      }
    }
  }
}
