/**
 * Production Documents workflow checks — shared by live verifier and unit tests.
 */
import { buildRevisionId } from "../../shared/document-control.mjs";
import {
  buildProductionVerificationDocument,
  buildProductionVerificationDocumentId,
  buildProductionVerificationDocumentNumber,
  buildVerificationFileDataUrl,
  buildVerificationFileName,
  countDocumentBaselines,
  findDocumentById,
  isActiveVerificationDocument,
  isOperationalDocument,
  isVerificationDocument,
  listActiveVerificationDocuments,
  PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_DOCUMENT_DESCRIPTION,
  PRODUCTION_VERIFICATION_DOCUMENT_SOURCE,
  PRODUCTION_VERIFICATION_DOCUMENT_TITLE,
} from "../../shared/production-verification-document.mjs";
import { assertNoPasswordHash } from "./live-http-client.mjs";
import {
  createFetchTransport,
  loadSmokeConfig,
  maskEmail,
  performProductionSmokeLogin,
} from "./production-auth-health-core.mjs";
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

export { performProductionSmokeLogin, maskEmail, createFetchTransport };

export const DOCUMENTS_VERIFIER_BUDGET_MS = 12 * 60 * 1000;

export const DEFAULT_DOCUMENTS_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  documentsApi: 60_000,
  baseline: 60_000,
  staleCleanup: 120_000,
  createDraft: 120_000,
  readback: 60_000,
  fileUpload: 120_000,
  editDraft: 120_000,
  submit: 120_000,
  reviewerLogin: 90_000,
  approval: 120_000,
  detail: 60_000,
  libraryVisibility: 60_000,
  review: 120_000,
  newRevision: 120_000,
  dashboard: 60_000,
  search: 5_000,
  cleanup: 120_000,
};

export const CHECK_KEYS = [
  "authentication",
  "documentsApi",
  "baseline",
  "staleCleanup",
  "createDraft",
  "readback",
  "fileUpload",
  "editDraft",
  "submit",
  "reviewerLogin",
  "approval",
  "detail",
  "libraryVisibility",
  "review",
  "newRevision",
  "dashboard",
  "search",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  documentsApi: "Document APIs",
  baseline: "Baseline",
  staleCleanup: "Stale Cleanup",
  createDraft: "Create Draft",
  readback: "Readback",
  fileUpload: "File Upload",
  editDraft: "Edit Draft",
  submit: "Submit",
  reviewerLogin: "Approver Login",
  approval: "Approve / Activate",
  detail: "Detail Verification",
  libraryVisibility: "Document Library",
  review: "Review",
  newRevision: "New Revision",
  dashboard: "Dashboard",
  search: "Search",
  cleanup: "Cleanup",
};

const MUTATION_CHECK_KEYS = new Set([
  "staleCleanup",
  "createDraft",
  "readback",
  "fileUpload",
  "editDraft",
  "submit",
  "reviewerLogin",
  "approval",
  "detail",
  "libraryVisibility",
  "review",
  "newRevision",
  "dashboard",
  "cleanup",
]);

const REPORT_LABEL_WIDTH = 24;

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeStatus(value) {
  return trim(value).toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withMasterSheet(path, masterSheetId) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}masterSheetId=${encodeURIComponent(trim(masterSheetId))}`;
}

function documentsListPath(companyFolderId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/documents`,
    masterSheetId,
  );
}

function documentDetailPath(companyFolderId, documentId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/documents/${encodeURIComponent(documentId)}`,
    masterSheetId,
  );
}

function documentIndexPath(companyFolderId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/index`,
    masterSheetId,
  );
}

function revisionSubmitPath(companyFolderId, revisionId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/revisions/${encodeURIComponent(revisionId)}/submit`,
    masterSheetId,
  );
}

function revisionApprovePath(companyFolderId, revisionId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/revisions/${encodeURIComponent(revisionId)}/approve`,
    masterSheetId,
  );
}

function revisionUploadPath(companyFolderId, revisionId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/revisions/${encodeURIComponent(revisionId)}/upload`,
    masterSheetId,
  );
}

function documentLibraryPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/documents`, masterSheetId);
}

function documentReviewPath(companyFolderId, documentId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/documents/${encodeURIComponent(documentId)}/review`,
    masterSheetId,
  );
}

function dashboardPath(companyFolderId, masterSheetId, refresh = false) {
  const base = withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/dashboard/live`,
    masterSheetId,
  );
  return refresh ? `${base}&refresh=1` : base;
}

function documentsFromListResponse(response) {
  return Array.isArray(response?.json?.documents) ? response.json.documents : [];
}

function revisionIdForDocument(documentId, revisionLabel = "1") {
  const sequence = Number.parseInt(String(revisionLabel), 10) || 1;
  return buildRevisionId(documentId, sequence);
}

function documentAlreadyVisible(detailResponse, documentId) {
  return (
    detailResponse?.status === 200 &&
    detailResponse?.json?.ok === true &&
    trim(detailResponse?.json?.document?.documentId) === trim(documentId)
  );
}

function documentAppearsInDashboard(payload = {}, documentId = "") {
  const id = trim(documentId);
  if (!id) {
    return false;
  }
  const actToday = Array.isArray(payload.actToday) ? payload.actToday : [];
  return actToday.some((item) => {
    const itemId = trim(item?.id || "");
    return itemId.includes(id) || itemId === `document-${id}` || itemId === `document-control-${id}`;
  });
}

function documentAppearsInPendingDocuments(payload = {}, documentId = "") {
  const id = trim(documentId);
  const pendingItems = Array.isArray(payload?.sections?.documents)
    ? payload.sections.documents
    : Array.isArray(payload.pendingDocuments)
      ? payload.pendingDocuments
      : [];
  return pendingItems.some((item) => {
    const itemId = trim(item?.id || "");
    return itemId.includes(id) || itemId.startsWith(`document-${id}`);
  });
}

function countOperationalAwaitingApproval(documents = []) {
  return documents.filter(
    (item) => isOperationalDocument(item) && normalizeStatus(item.documentStatus) === "awaiting_approval",
  ).length;
}

export function loadDocumentsWorkflowConfig(env = process.env) {
  const base = loadSmokeConfig(env);
  const allowDocumentMutation =
    trim(env.BERT_SMOKE_ALLOW_DOCUMENT_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_DOCUMENT_MUTATION).toLowerCase() === "true";
  const reviewerUsername = trim(env.BERT_SMOKE_DOCUMENT_REVIEWER_USERNAME);
  const reviewerPassword = trim(env.BERT_SMOKE_DOCUMENT_REVIEWER_PASSWORD);
  const reviewerExpectedEmail = trim(env.BERT_SMOKE_DOCUMENT_REVIEWER_EXPECTED_EMAIL).toLowerCase();
  const hasReviewerCredentials = Boolean(reviewerUsername && reviewerPassword);
  return {
    ...base,
    allowDocumentMutation,
    reviewerUsername,
    reviewerPassword,
    reviewerExpectedEmail,
    hasReviewerCredentials,
    selfApprovalMode: !hasReviewerCredentials,
    totalBudgetMs: DOCUMENTS_VERIFIER_BUDGET_MS,
  };
}

export function redactSafeResponseBody(value) {
  if (!value || typeof value !== "object") {
    return String(value ?? "");
  }
  try {
    return JSON.stringify(value, (key, val) => {
      if (/password|token|cookie|hash|secret/i.test(key)) {
        return "***";
      }
      if (typeof val === "string" && /bert_company_session=|bert_master_session=/i.test(val)) {
        return "***";
      }
      return val;
    });
  } catch {
    return "[unserializable response]";
  }
}

function assertResponseSafe(json, label = "response") {
  assertNoPasswordHash(json, label);
}

export function formatDocumentsWorkflowReport(result) {
  const lines = [
    "==========================================",
    "BERT Production Documents Workflow",
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
  if (result.creatorEmail || result.accountEmail) {
    lines.push(`Creator: ${maskEmail(result.creatorEmail || result.accountEmail)}`);
  }
  if (result.approverEmail) {
    lines.push(`Approver: ${maskEmail(result.approverEmail)}`);
  } else if (result.selfApprovalMode && result.checks.authentication?.status === "PASS") {
    lines.push("Approver: self");
  }
  if (result.documentId && result.checks.authentication?.status === "PASS") {
    lines.push(`Document ID: ${result.documentId}`);
  }
  if (result.documentNumber && result.checks.authentication?.status === "PASS") {
    lines.push(`Document Number: ${result.documentNumber}`);
  }
  if (result.durationMs) {
    lines.push(`Duration: ${result.durationMs}ms`);
  }
  lines.push("");

  if (result.timedOut) {
    lines.push("Timed out:");
    lines.push(`Stage: ${result.failedStage || result.failedKey || "unknown"}`);
    if (result.timeoutMethod && result.timeoutSafeUrl) {
      lines.push(`Request: ${result.timeoutMethod} ${result.timeoutSafeUrl}`);
    }
    if (result.timeoutElapsedMs) {
      lines.push(`Elapsed: ${result.timeoutElapsedMs}ms`);
    }
    if (result.timeoutMs) {
      lines.push(`Timeout limit: ${result.timeoutMs}ms`);
    }
    lines.push("");
  }

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
    if (result.httpStatus) {
      lines.push(`HTTP status: ${result.httpStatus}`);
    }
    lines.push("");
    lines.push("Safe response body:");
    lines.push(result.safeResponseBody || "(none)");
    lines.push("");
    lines.push("Likely cause:");
    lines.push(result.failureReason || "Unknown failure");
    if (result.remediation) {
      lines.push("");
      lines.push("Suggested remediation:");
      lines.push(result.remediation);
    }
  }

  return lines.join("\n");
}

export async function fetchDocumentControlList(request, companyFolderId, masterSheetId, stageKey = "documentsApi") {
  const response = await request("GET", documentsListPath(companyFolderId, masterSheetId), undefined, { stageKey });
  assertResponseSafe(response.json, "document control list");
  return response;
}

export async function pollDocumentListForId(request, companyFolderId, masterSheetId, documentId, options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 15;
  const intervalMs = Number(options.intervalMs) ?? 1000;
  const stageKey = options.stageKey || "readback";
  const attempts = [];
  let lastListResponse = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1 && intervalMs > 0) {
      await sleep(intervalMs);
    }
    lastListResponse = await fetchDocumentControlList(request, companyFolderId, masterSheetId, stageKey);
    const documents = documentsFromListResponse(lastListResponse);
    const matches = documents.filter((item) => trim(item.documentId || item.id) === trim(documentId));
    attempts.push({
      attempt,
      status: lastListResponse.status,
      itemCount: documents.length,
      matchCount: matches.length,
    });
    if (matches.length === 1) {
      return { ok: true, matches, attempts, listResponse: lastListResponse };
    }
  }
  return { ok: false, matches: [], attempts, listResponse: lastListResponse };
}

export async function attemptVerificationDocumentCleanup(request, context = {}) {
  const companyFolderId = trim(context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  const verificationDocumentId = trim(context.verificationDocumentId);
  if (!companyFolderId) {
    return { ok: false, reason: "missing_company_folder_id", results: [] };
  }

  const results = [];
  try {
    const bulk = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/documents/verification-cleanup`,
      { companyFolderId, masterSheetId },
      { stageKey: "cleanup", timeoutMs: DEFAULT_DOCUMENTS_STAGE_TIMEOUTS_MS.cleanup },
    );
    results.push({ kind: "bulk", ok: bulk.json?.ok === true, status: bulk.status });
  } catch (error) {
    results.push({
      kind: "bulk",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (verificationDocumentId) {
    try {
      const single = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/documents/${encodeURIComponent(verificationDocumentId)}/verification-cleanup`,
        { companyFolderId, masterSheetId },
        { stageKey: "cleanup", timeoutMs: DEFAULT_DOCUMENTS_STAGE_TIMEOUTS_MS.cleanup },
      );
      results.push({
        kind: "single",
        documentId: verificationDocumentId,
        ok: single.json?.ok === true,
        status: single.status,
      });
    } catch (error) {
      results.push({
        kind: "single",
        documentId: verificationDocumentId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: results.some((item) => item.ok) && (!verificationDocumentId || results.some((item) => item.kind === "single" && item.ok)),
    results,
  };
}

export async function runProductionDocumentsWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const runId = options.runId || Date.now();
  const workflowContext = {
    companyFolderId: "",
    masterSheetId: "",
    verificationDocumentId: "",
  };
  let currentStageKey = "authentication";
  const diagnostics =
    options.diagnostics ||
    createWorkflowDiagnostics({
      log: options.logStage || ((line) => console.log(line)),
      prefix: "[documents-workflow]",
      stageLabels: CHECK_LABELS,
      startedAt,
      totalBudgetMs: Number(config.totalBudgetMs) || DOCUMENTS_VERIFIER_BUDGET_MS,
      stageTimeouts: DEFAULT_DOCUMENTS_STAGE_TIMEOUTS_MS,
    });
  const timedTransport = wrapTransportWithTimeouts(transport, {
    apiBase: config.apiBase,
    getStageKey: () => currentStageKey,
    getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey),
  });
  const request = timedTransport.request.bind(timedTransport);

  if (typeof options.registerInterruptCleanup === "function") {
    options.registerInterruptCleanup(async () => attemptVerificationDocumentCleanup(request, workflowContext));
  }

  const result = {
    ok: false,
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PENDING" }])),
    accountEmail: config.expectedEmail || "",
    selfApprovalMode: config.selfApprovalMode,
    durationMs: 0,
  };

  const pass = (key, status = "PASS") => {
    result.checks[key] = { status };
  };

  const skip = (key, reason = "SKIPPED") => {
    result.checks[key] = { status: "SKIP", reason };
  };

  let login = null;
  let approverRequest = request;
  let documentsListCache = [];
  let verificationDocument = null;
  let verificationRevisionId = "";
  let canApproveFromApi = true;
  let mustRunCleanup = false;
  let deferredFailure = null;
  let baselineOperationalAwaitingApproval = null;
  let baselineDashboardPendingDocuments = null;

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

  const failFromTimeout = (stageKey, error, stageDurationMs) => {
    diagnostics.failStage(stageKey, "TIMEOUT", stageDurationMs);
    const timeoutMeta = buildTimeoutFailureResult({
      stageKey,
      stageLabel: CHECK_LABELS[stageKey],
      method: error.method,
      safeUrl: error.safeUrl,
      elapsedMs: error.elapsedMs,
      timeoutMs: error.timeoutMs,
      totalElapsedMs: diagnostics.elapsedMs(),
    });
    return fail(
      stageKey,
      `${timeoutMeta.failureReason} (${error.method} ${error.safeUrl}, elapsed ${error.elapsedMs}ms).`,
      timeoutMeta.remediation,
      timeoutMeta.httpStatus,
      {
        timeout: true,
        stage: CHECK_LABELS[stageKey],
        method: error.method,
        safeUrl: error.safeUrl,
        elapsedMs: error.elapsedMs,
        timeoutMs: error.timeoutMs,
        totalElapsedMs: diagnostics.elapsedMs(),
      },
      {
        timedOut: true,
        timeoutMethod: error.method,
        timeoutSafeUrl: error.safeUrl,
        timeoutElapsedMs: error.elapsedMs,
        timeoutMs: error.timeoutMs,
      },
    );
  };

  async function runStage(stageKey, fn) {
    currentStageKey = stageKey;
    diagnostics.beginStage(stageKey, CHECK_LABELS[stageKey]);
    const stageStarted = Date.now();
    try {
      const earlyExit = await fn();
      if (earlyExit?.failedKey) {
        diagnostics.failStage(stageKey, "FAIL", Date.now() - stageStarted);
        return earlyExit;
      }
      const status = result.checks[stageKey]?.status || "PASS";
      if (status === "SKIP") {
        diagnostics.endStage(stageKey, "SKIP", Date.now() - stageStarted);
      } else if (status === "FAIL") {
        diagnostics.failStage(stageKey, "FAIL", Date.now() - stageStarted);
      } else {
        diagnostics.endStage(stageKey, status, Date.now() - stageStarted);
      }
      return null;
    } catch (error) {
      if (isStageTimeoutError(error)) {
        return failFromTimeout(stageKey, error, Date.now() - stageStarted);
      }
      if (error?.code === "VERIFIER_BUDGET_EXCEEDED") {
        diagnostics.failStage(stageKey, "TIMEOUT", Date.now() - stageStarted);
        return fail(
          stageKey,
          error.message,
          "Reduce workflow scope or increase the verifier total budget if appropriate.",
          408,
          { budgetExceeded: true, elapsedMs: diagnostics.elapsedMs() },
        );
      }
      diagnostics.failStage(stageKey, "FAIL", Date.now() - stageStarted);
      return fail(stageKey, error instanceof Error ? error.message : String(error));
    }
  }

  async function runPostCreateStage(stageKey, fn) {
    if (deferredFailure) {
      skip(stageKey, `Skipped after ${deferredFailure.failedStage} failure.`);
      return null;
    }
    const stageResult = await runStage(stageKey, fn);
    if (stageResult?.failedKey) {
      if (mustRunCleanup) {
        if (!deferredFailure) {
          deferredFailure = {
            failedKey: stageResult.failedKey,
            failedStage: stageResult.failedStage,
            failureReason: stageResult.failureReason,
            remediation: stageResult.remediation,
            httpStatus: stageResult.httpStatus,
            safeResponseBody: stageResult.safeResponseBody,
          };
        }
        return null;
      }
      return stageResult;
    }
    return null;
  }

  async function runMandatoryCleanupStage() {
    const cleanupResult = await runStage("cleanup", async () => {
      const cleanup = await attemptVerificationDocumentCleanup(request, workflowContext);
      if (!cleanup.ok) {
        return fail(
          "cleanup",
          "Verification cleanup did not succeed.",
          "Inspect POST /api/companies/:id/document-control/documents/verification-cleanup and single-document cleanup.",
          500,
          cleanup,
        );
      }

      const listAfterCleanup = await fetchDocumentControlList(request, companyFolderId, masterSheetId, "cleanup");
      const remaining = listActiveVerificationDocuments(documentsFromListResponse(listAfterCleanup));
      if (remaining.length > 0) {
        return fail(
          "cleanup",
          `Active verification documents remain after cleanup (${remaining.length}).`,
          "Inspect verification cleanup archive behaviour.",
          listAfterCleanup.status,
          { remainingIds: remaining.map((item) => trim(item.documentId || item.id)) },
        );
      }
      pass("cleanup");
      return null;
    });
    return cleanupResult;
  }

  async function finalizeMutationWorkflow() {
    if (!deferredFailure) {
      const searchSkipped = await runStage("search", async () => {
        skip("search", "Document Control search is client-cache only; no server search API.");
        return null;
      });
      if (searchSkipped) {
        return searchSkipped;
      }
    } else if (result.checks.search.status === "PENDING") {
      await runStage("search", async () => {
        skip("search", `Skipped after ${deferredFailure.failedStage} failure.`);
        return null;
      });
    }

    if (mustRunCleanup) {
      const cleanupResult = await runMandatoryCleanupStage();
      if (deferredFailure) {
        if (cleanupResult?.failedKey) {
          deferredFailure.cleanupAlsoFailed = true;
          deferredFailure.cleanupFailureReason = cleanupResult.failureReason;
        }
        return {
          ...result,
          ...deferredFailure,
          checks: { ...result.checks },
          durationMs: Date.now() - startedAt,
        };
      }
      if (cleanupResult) {
        return cleanupResult;
      }
    } else if (result.checks.cleanup.status === "PENDING") {
      skip("cleanup");
    }

    return null;
  }

  const companyFolderId = trim(config.companyFolderId);
  const masterSheetId = trim(config.masterSheetId);
  const verificationDocumentId = buildProductionVerificationDocumentId(runId);
  const verificationDocumentNumber = buildProductionVerificationDocumentNumber(runId);
  verificationRevisionId = revisionIdForDocument(verificationDocumentId, "1");
  result.documentId = verificationDocumentId;
  result.documentNumber = verificationDocumentNumber;
  workflowContext.companyFolderId = companyFolderId;
  workflowContext.masterSheetId = masterSheetId;
  workflowContext.verificationDocumentId = verificationDocumentId;

  const authFail = await runStage("authentication", async () => {
    let health;
    try {
      health = await request("GET", "/api/health", undefined, { stageKey: "authentication" });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "authentication",
        `API health request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Confirm the production API is reachable.",
      );
    }
    result.apiVersion = trim(health.json?.version);
    result.apiSha = trim(health.json?.gitSha || health.json?.sha);
    result.shortSha = trim(health.json?.shortSha);

    const loginResult = await performProductionSmokeLogin(config, timedTransport, options);
    if (!loginResult.ok) {
      return fail(
        "authentication",
        loginResult.failureReason || "Production login failed.",
        loginResult.remediation || "Inspect smoke credentials and company session enrichment.",
        loginResult.httpStatus,
        loginResult.responseBody,
      );
    }
    login = loginResult;
    result.accountEmail = login.accountEmail || config.expectedEmail;
    result.creatorEmail = result.accountEmail;
    pass("authentication");
    return null;
  });
  if (authFail) {
    return authFail;
  }

  const documentsApiFail = await runStage("documentsApi", async () => {
    let listResponse;
    let indexResponse;
    try {
      const [listResult, indexResult] = await Promise.all([
        requestWithTransientRetries(request, "GET", documentsListPath(companyFolderId, masterSheetId), undefined, {
          stageKey: "documentsApi",
          maxRetries: 2,
        }),
        requestWithTransientRetries(request, "GET", documentIndexPath(companyFolderId, masterSheetId), undefined, {
          stageKey: "documentsApi",
          maxRetries: 2,
        }),
      ]);
      listResponse = listResult.response;
      indexResponse = indexResult.response;
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "documentsApi",
        `Document API request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:id/document-control/documents and /document-control/index.",
      );
    }
    if (listResponse.status !== 200 || listResponse.json?.ok !== true) {
      return fail(
        "documentsApi",
        `Document Control list returned HTTP ${listResponse.status}.`,
        "Inspect folder-first Document Control list route and workbook tab access.",
        listResponse.status,
        listResponse.json,
      );
    }
    if (!Array.isArray(listResponse.json?.documents)) {
      return fail(
        "documentsApi",
        "Document Control list response is missing the documents array.",
        "Inspect GET /api/companies/:id/document-control/documents response shape.",
        listResponse.status,
        listResponse.json,
      );
    }
    if (indexResponse.status !== 200 || indexResponse.json?.ok !== true) {
      return fail(
        "documentsApi",
        `Document Control index returned HTTP ${indexResponse.status}.`,
        "Inspect GET /api/companies/:id/document-control/index.",
        indexResponse.status,
        indexResponse.json,
      );
    }
    if (!Array.isArray(indexResponse.json?.index)) {
      return fail(
        "documentsApi",
        "Document Control index response is missing the index array.",
        "Inspect GET /api/companies/:id/document-control/index response shape.",
        indexResponse.status,
        indexResponse.json,
      );
    }
    documentsListCache = documentsFromListResponse(listResponse);
    canApproveFromApi = listResponse.json?.canApprove !== false;
    pass("documentsApi");
    return null;
  });
  if (documentsApiFail) {
    return documentsApiFail;
  }

  const baselineFail = await runStage("baseline", async () => {
    result.baseline = countDocumentBaselines(documentsListCache);
    baselineOperationalAwaitingApproval = countOperationalAwaitingApproval(documentsListCache);
    let dashboardResponse;
    try {
      dashboardResponse = await request("GET", dashboardPath(companyFolderId, masterSheetId, true), undefined, {
        stageKey: "baseline",
      });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "baseline",
        `Dashboard baseline request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:id/dashboard/live.",
      );
    }
    assertResponseSafe(dashboardResponse.json, "dashboard baseline");
    if (dashboardResponse.status !== 200 || dashboardResponse.json?.ok !== true) {
      return fail(
        "baseline",
        `Dashboard baseline returned HTTP ${dashboardResponse.status}.`,
        "Inspect live dashboard service for the smoke company.",
        dashboardResponse.status,
        dashboardResponse.json,
      );
    }
    baselineDashboardPendingDocuments = Number(dashboardResponse.json?.metrics?.pendingDocuments);
    pass("baseline");
    return null;
  });
  if (baselineFail) {
    return baselineFail;
  }

  if (!config.allowDocumentMutation) {
    result.mutationSkipped = true;
    for (const key of MUTATION_CHECK_KEYS) {
      const skipped = await runStage(key, async () => {
        skip(key);
        return null;
      });
      if (skipped) {
        return skipped;
      }
    }
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const staleCleanupFail = await runStage("staleCleanup", async () => {
    let staleCleanup;
    try {
      staleCleanup = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/documents/verification-cleanup`,
        { companyFolderId, masterSheetId },
        { stageKey: "staleCleanup" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "staleCleanup",
        `Stale verification cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:id/document-control/documents/verification-cleanup.",
      );
    }
    assertResponseSafe(staleCleanup.json, "stale cleanup");
    if (staleCleanup.status !== 200 || staleCleanup.json?.ok !== true) {
      return fail(
        "staleCleanup",
        `Stale verification cleanup returned HTTP ${staleCleanup.status}.`,
        "Inspect verification cleanup route and marker guards.",
        staleCleanup.status,
        staleCleanup.json,
      );
    }
    pass("staleCleanup");
    return null;
  });
  if (staleCleanupFail) {
    return staleCleanupFail;
  }

  const createDraftFail = await runStage("createDraft", async () => {
    mustRunCleanup = true;
    const payload = buildProductionVerificationDocument({
      runId,
      documentId: verificationDocumentId,
      documentNumber: verificationDocumentNumber,
      ownerEmail: result.accountEmail,
      ownerName: login?.userName || "Smoke Verifier",
    });
    let createResponse;
    try {
      const createResult = await requestWithTransientRetries(
        request,
        "POST",
        documentsListPath(companyFolderId, masterSheetId),
        payload,
        {
          stageKey: "createDraft",
          maxRetries: 2,
          shouldRetry: (response, error) => {
            if (error && isTransientNetworkError(error)) {
              return true;
            }
            return isTransientWorkflowFailure(response);
          },
          beforeRetry: async () => {
            const detail = await request(
              "GET",
              documentDetailPath(companyFolderId, verificationDocumentId, masterSheetId),
              undefined,
              { stageKey: "createDraft" },
            );
            return documentAlreadyVisible(detail, verificationDocumentId);
          },
        },
      );
      createResponse = createResult.response;
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "createDraft",
        `Create draft request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:id/document-control/documents with verification markers.",
      );
    }
    assertResponseSafe(createResponse.json, "create draft");
    if (createResponse.status !== 200 || createResponse.json?.ok !== true) {
      return fail(
        "createDraft",
        `Create draft returned HTTP ${createResponse.status}.`,
        "Inspect createDraftVerificationDocument service and verification ID/number guards.",
        createResponse.status,
        createResponse.json,
      );
    }
    const updatedRows = Number(createResponse.json?.updatedRows);
    if (!createResponse.json?.alreadyExists && !(updatedRows > 0)) {
      return fail(
        "createDraft",
        "Create draft returned zero-row acknowledgement.",
        "Inspect controlled document workbook writes.",
        createResponse.status,
        createResponse.json,
      );
    }
    verificationDocument = createResponse.json?.document || payload;
    verificationRevisionId =
      trim(createResponse.json?.revision?.revisionId) ||
      trim(verificationDocument?.currentRevisionId) ||
      verificationRevisionId;
    pass("createDraft");
    return null;
  });
  if (createDraftFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || createDraftFail;
  }

  const readbackFail = await runPostCreateStage("readback", async () => {
    const poll = await pollDocumentListForId(request, companyFolderId, masterSheetId, verificationDocumentId, {
      maxAttempts: options.listPollMaxAttempts ?? 15,
      intervalMs: options.listPollIntervalMs ?? 1000,
      stageKey: "readback",
    });
    if (!poll.ok) {
      return fail(
        "readback",
        "Verification document was not visible in Document Control list after create.",
        "Inspect read-after-write confirmation and index rebuild.",
        poll.listResponse?.status,
        { attempts: poll.attempts },
      );
    }
    const detail = await request(
      "GET",
      documentDetailPath(companyFolderId, verificationDocumentId, masterSheetId),
      undefined,
      { stageKey: "readback" },
    );
    if (!documentAlreadyVisible(detail, verificationDocumentId)) {
      return fail(
        "readback",
        "Verification document detail was not readable after create.",
        "Inspect GET /api/companies/:id/document-control/documents/:documentId.",
        detail.status,
        detail.json,
      );
    }
    const status = normalizeStatus(detail.json?.document?.documentStatus);
    if (status !== "draft") {
      return fail(
        "readback",
        `Expected Draft status after create, got "${detail.json?.document?.documentStatus}".`,
        "Inspect verification document initial status.",
        detail.status,
        detail.json?.document,
      );
    }
    pass("readback");
    return null;
  });
  if (readbackFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || readbackFail;
  }

  const fileUploadFail = await runPostCreateStage("fileUpload", async () => {
    let uploadResponse;
    try {
      uploadResponse = await requestWithTransientRetries(
        request,
        "POST",
        revisionUploadPath(companyFolderId, verificationRevisionId, masterSheetId),
        {
          fileName: buildVerificationFileName(runId),
          fileDataUrl: buildVerificationFileDataUrl(runId),
          mimeType: "application/pdf",
        },
        {
          stageKey: "fileUpload",
          maxRetries: 2,
          beforeRetry: async () => {
            const detail = await request(
              "GET",
              documentDetailPath(companyFolderId, verificationDocumentId, masterSheetId),
              undefined,
              { stageKey: "fileUpload" },
            );
            const revision = detail.json?.currentRevision || {};
            return Boolean(trim(revision.fileId) || trim(revision.fileUrl));
          },
        },
      ).then((item) => item.response);
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/404|not found|unsupported/i.test(message)) {
        skip("fileUpload", "No safe production upload path is available for verification revisions.");
        return null;
      }
      return fail(
        "fileUpload",
        `Verification file upload failed: ${message}`,
        "Inspect POST /api/companies/:id/document-control/revisions/:revisionId/upload.",
      );
    }
    assertResponseSafe(uploadResponse.json, "file upload");
    if (uploadResponse.status === 404 || uploadResponse.json?.code === "DRIVE_UNAVAILABLE") {
      skip("fileUpload", "File upload is not available in production (Drive unavailable or route missing).");
      return null;
    }
    if (uploadResponse.status !== 200 || uploadResponse.json?.ok !== true) {
      if (uploadResponse.status === 503 || uploadResponse.json?.code === "DRIVE_UNAVAILABLE") {
        skip("fileUpload", "File upload skipped because Google Drive is unavailable.");
        return null;
      }
      return fail(
        "fileUpload",
        `File upload returned HTTP ${uploadResponse.status}.`,
        "Inspect uploadVerificationRevisionFile and Drafts folder access.",
        uploadResponse.status,
        uploadResponse.json,
      );
    }
    const revision = uploadResponse.json?.revision || {};
    if (!uploadResponse.json?.alreadyUploaded && !(trim(revision.fileId) || trim(revision.fileUrl))) {
      return fail(
        "fileUpload",
        "Upload response did not include linked file metadata.",
        "Inspect revision file patch after upload.",
        uploadResponse.status,
        uploadResponse.json,
      );
    }
    pass("fileUpload");
    return null;
  });
  if (fileUploadFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || fileUploadFail;
  }

  const editDraftFail = await runPostCreateStage("editDraft", async () => {
    const editedTitle = `${PRODUCTION_VERIFICATION_DOCUMENT_TITLE} (edited)`;
    const editedKeywords = `verification production-documents-workflow edited-${runId}`;
    let editResponse;
    try {
      editResponse = await request(
        "PATCH",
        documentDetailPath(companyFolderId, verificationDocumentId, masterSheetId),
        {
          title: editedTitle,
          keywords: editedKeywords,
        },
        { stageKey: "editDraft" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "editDraft",
        `Edit draft request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect PATCH /api/companies/:id/document-control/documents/:documentId.",
      );
    }
    assertResponseSafe(editResponse.json, "edit draft");
    if (editResponse.status !== 200 || editResponse.json?.ok !== true) {
      return fail(
        "editDraft",
        `Edit draft returned HTTP ${editResponse.status}.`,
        "Inspect updateControlledDocument for draft edits.",
        editResponse.status,
        editResponse.json,
      );
    }
    const detail = await request(
      "GET",
      documentDetailPath(companyFolderId, verificationDocumentId, masterSheetId),
      undefined,
      { stageKey: "editDraft" },
    );
    const document = detail.json?.document || {};
    if (!String(document.title || "").includes("(edited)")) {
      return fail(
        "editDraft",
        "Edited title did not persist on readback.",
        "Inspect controlled document patch persistence.",
        detail.status,
        document,
      );
    }
    if (!String(document.keywords || "").includes("edited-")) {
      return fail(
        "editDraft",
        "Edited keywords did not persist on readback.",
        "Inspect controlled document patch persistence.",
        detail.status,
        document,
      );
    }
    if (normalizeStatus(document.documentStatus) !== "draft") {
      return fail(
        "editDraft",
        `Expected Draft status after edit, got "${document.documentStatus}".`,
        "Inspect draft edit lifecycle rules.",
        detail.status,
        document,
      );
    }
    pass("editDraft");
    return null;
  });
  if (editDraftFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || editDraftFail;
  }

  const submitFail = await runPostCreateStage("submit", async () => {
    let submitResponse;
    try {
      const submitResult = await requestWithTransientRetries(
        request,
        "POST",
        revisionSubmitPath(companyFolderId, verificationRevisionId, masterSheetId),
        {},
        {
          stageKey: "submit",
          maxRetries: 2,
          beforeRetry: async () => {
            const detail = await request(
              "GET",
              documentDetailPath(companyFolderId, verificationDocumentId, masterSheetId),
              undefined,
              { stageKey: "submit" },
            );
            return normalizeStatus(detail.json?.document?.documentStatus) === "awaiting_approval";
          },
        },
      );
      submitResponse = submitResult.response;
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "submit",
        `Submit request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:id/document-control/revisions/:revisionId/submit.",
      );
    }
    assertResponseSafe(submitResponse.json, "submit");
    if (submitResponse.status !== 200 || submitResponse.json?.ok !== true) {
      return fail(
        "submit",
        `Submit returned HTTP ${submitResponse.status}.`,
        "Inspect submitDocumentRevision and revision file requirements.",
        submitResponse.status,
        submitResponse.json,
      );
    }
    const status = normalizeStatus(submitResponse.json?.document?.documentStatus);
    if (status !== "awaiting_approval") {
      return fail(
        "submit",
        `Expected Awaiting Approval after submit, got "${submitResponse.json?.document?.documentStatus}".`,
        "Inspect revision submission status transition.",
        submitResponse.status,
        submitResponse.json?.document,
      );
    }
    pass("submit");
    return null;
  });
  if (submitFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || submitFail;
  }

  const reviewerLoginFail = await runPostCreateStage("reviewerLogin", async () => {
    if (config.hasReviewerCredentials) {
      const reviewerConfig = {
        ...config,
        username: config.reviewerUsername,
        password: config.reviewerPassword,
        expectedEmail: config.reviewerExpectedEmail || config.expectedEmail,
      };
      const reviewerLoginResult = await performProductionSmokeLogin(reviewerConfig, timedTransport, {
        ...options,
        skipHealthCheck: true,
      });
      if (!reviewerLoginResult.ok) {
        return fail(
          "reviewerLogin",
          reviewerLoginResult.failureReason || "Reviewer login failed.",
          "Inspect BERT_SMOKE_DOCUMENT_REVIEWER_* credentials and company permissions.",
          reviewerLoginResult.httpStatus,
          reviewerLoginResult.responseBody,
        );
      }
      result.approverEmail = reviewerLoginResult.accountEmail || config.reviewerExpectedEmail;
      approverRequest = timedTransport.request.bind(timedTransport);
      pass("reviewerLogin");
      return null;
    }

    skip("reviewerLogin", "Self-approval mode (Admin approver).");
    return null;
  });
  if (reviewerLoginFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || reviewerLoginFail;
  }

  const approvalFail = await runPostCreateStage("approval", async () => {
    let approveResponse;
    try {
      const approveResult = await requestWithTransientRetries(
        approverRequest,
        "POST",
        revisionApprovePath(companyFolderId, verificationRevisionId, masterSheetId),
        {},
        {
          stageKey: "approval",
          maxRetries: 2,
          beforeRetry: async () => {
            const detail = await approverRequest(
              "GET",
              documentDetailPath(companyFolderId, verificationDocumentId, masterSheetId),
              undefined,
              { stageKey: "approval" },
            );
            return normalizeStatus(detail.json?.document?.documentStatus) === "current";
          },
        },
      );
      approveResponse = approveResult.response;
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "approval",
        `Approve request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:id/document-control/revisions/:revisionId/approve.",
      );
    }
    assertResponseSafe(approveResponse.json, "approve");
    if (approveResponse.status === 403 && approveResponse.json?.code === "DOCUMENT_SELF_APPROVAL_BLOCKED") {
      if (!config.hasReviewerCredentials) {
        return fail(
          "reviewerLogin",
          "Reviewer credentials are required because self-approval is blocked.",
          "Set BERT_SMOKE_DOCUMENT_REVIEWER_USERNAME and BERT_SMOKE_DOCUMENT_REVIEWER_PASSWORD for a separate approver account.",
          approveResponse.status,
          approveResponse.json,
        );
      }
      return fail(
        "approval",
        "Self-approval is blocked for the current approver session.",
        "Inspect reviewer account approval permissions.",
        approveResponse.status,
        approveResponse.json,
      );
    }
    if (approveResponse.status !== 200 || approveResponse.json?.ok !== true) {
      return fail(
        "approval",
        `Approve returned HTTP ${approveResponse.status}.`,
        "Inspect approveDocumentRevision and revision file requirements.",
        approveResponse.status,
        approveResponse.json,
      );
    }
    const status = normalizeStatus(approveResponse.json?.document?.documentStatus);
    if (status !== "current") {
      return fail(
        "approval",
        `Expected Current/Approved after approval, got "${approveResponse.json?.document?.documentStatus}".`,
        "Inspect approval status transition.",
        approveResponse.status,
        approveResponse.json?.document,
      );
    }
    if (!result.approverEmail && config.selfApprovalMode) {
      result.approverEmail = result.accountEmail;
    }
    pass("approval");
    return null;
  });
  if (approvalFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || approvalFail;
  }

  const detailFail = await runPostCreateStage("detail", async () => {
    const detail = await request(
      "GET",
      documentDetailPath(companyFolderId, verificationDocumentId, masterSheetId),
      undefined,
      { stageKey: "detail" },
    );
    assertResponseSafe(detail.json, "detail verification");
    if (!documentAlreadyVisible(detail, verificationDocumentId)) {
      return fail(
        "detail",
        "Verification document detail was not available after approval.",
        "Inspect getDocumentControlDocument after approval.",
        detail.status,
        detail.json,
      );
    }
    const document = detail.json?.document || {};
    if (trim(document.documentNumber) !== verificationDocumentNumber) {
      return fail(
        "detail",
        `Document number mismatch (expected ${verificationDocumentNumber}).`,
        "Inspect controlled document number persistence.",
        detail.status,
        document,
      );
    }
    if (!String(document.title || "").includes(PRODUCTION_VERIFICATION_DOCUMENT_TITLE)) {
      return fail(
        "detail",
        "Verification document title mismatch after approval.",
        "Inspect controlled document title persistence.",
        detail.status,
        document,
      );
    }
    if (normalizeStatus(document.documentStatus) !== "current") {
      return fail(
        "detail",
        `Expected current status in detail verification, got "${document.documentStatus}".`,
        "Inspect post-approval detail response.",
        detail.status,
        document,
      );
    }
    pass("detail");
    return null;
  });
  if (detailFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || detailFail;
  }

  const libraryFail = await runPostCreateStage("libraryVisibility", async () => {
    let libraryResponse;
    try {
      libraryResponse = await request("GET", documentLibraryPath(companyFolderId, masterSheetId), undefined, {
        stageKey: "libraryVisibility",
      });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      skip("libraryVisibility", "Document Library API is unavailable; controlled documents use Document Control index only.");
      return null;
    }
    if (libraryResponse.status === 404 || libraryResponse.status === 503) {
      skip("libraryVisibility", "Document Library is separate from Document Control; library index not linked.");
      return null;
    }
    if (libraryResponse.status !== 200 || libraryResponse.json?.ok !== true) {
      skip("libraryVisibility", "Document Library read API is not available for controlled document linkage.");
      return null;
    }
    const libraryDocuments = Array.isArray(libraryResponse.json?.documents) ? libraryResponse.json.documents : [];
    const match = findDocumentById(libraryDocuments, verificationDocumentId);
    if (!match) {
      const indexResponse = await request("GET", documentIndexPath(companyFolderId, masterSheetId), undefined, {
        stageKey: "libraryVisibility",
      });
      const indexRows = Array.isArray(indexResponse.json?.index) ? indexResponse.json.index : [];
      const indexMatch = indexRows.find(
        (row) =>
          trim(row.documentNumber || row.DocumentNumber).toUpperCase() === verificationDocumentNumber.toUpperCase(),
      );
      if (indexMatch) {
        pass("libraryVisibility");
        return null;
      }
      return fail(
        "libraryVisibility",
        "Verification document is not visible in Document Library or Document Control index.",
        "Inspect Document Control index rebuild after approval.",
        libraryResponse.status,
        { libraryCount: libraryDocuments.length },
      );
    }
    pass("libraryVisibility");
    return null;
  });
  if (libraryFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || libraryFail;
  }

  const reviewFail = await runPostCreateStage("review", async () => {
    let reviewResponse;
    try {
      reviewResponse = await request(
        "POST",
        documentReviewPath(companyFolderId, verificationDocumentId, masterSheetId),
        {
          outcome: "no_change",
          summary: "Production document smoke verification review",
        },
        { stageKey: "review" },
      );
    } catch (error) {
      skip("review", "Document review workflow is not implemented as a separate API.");
      return null;
    }
    if (reviewResponse.status === 404 || reviewResponse.json?.code === "DOCUMENT_CONTROL_REVIEW_UNSUPPORTED") {
      skip("review", "Document review workflow is not implemented as a separate API.");
      return null;
    }
    if (reviewResponse.status !== 200 || reviewResponse.json?.ok !== true) {
      skip("review", "Document review workflow is not implemented as a separate API.");
      return null;
    }
    pass("review");
    return null;
  });
  if (reviewFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || reviewFail;
  }

  const newRevisionFail = await runPostCreateStage("newRevision", async () => {
    skip("newRevision", "Safe multi-revision verification cleanup is not ready.");
    return null;
  });
  if (newRevisionFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || newRevisionFail;
  }

  const dashboardFail = await runPostCreateStage("dashboard", async () => {
    let dashboardResponse;
    try {
      dashboardResponse = await request("GET", dashboardPath(companyFolderId, masterSheetId, true), undefined, {
        stageKey: "dashboard",
      });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "dashboard",
        `Dashboard verification request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:id/dashboard/live.",
      );
    }
    assertResponseSafe(dashboardResponse.json, "dashboard after workflow");
    if (dashboardResponse.status !== 200 || dashboardResponse.json?.ok !== true) {
      return fail(
        "dashboard",
        `Dashboard verification returned HTTP ${dashboardResponse.status}.`,
        "Inspect live dashboard aggregation.",
        dashboardResponse.status,
        dashboardResponse.json,
      );
    }
    if (documentAppearsInDashboard(dashboardResponse.json, verificationDocumentId)) {
      return fail(
        "dashboard",
        "Verification document still appears in dashboard Act Today operational items.",
        "Inspect live dashboard exclusion for verification documents.",
        dashboardResponse.status,
        dashboardResponse.json,
      );
    }
    if (documentAppearsInPendingDocuments(dashboardResponse.json, verificationDocumentId)) {
      return fail(
        "dashboard",
        "Verification document still appears in dashboard pendingDocuments.",
        "Inspect isOperationalDocument exclusion for verification rows.",
        dashboardResponse.status,
        dashboardResponse.json,
      );
    }

    const listAfterWorkflow = await fetchDocumentControlList(request, companyFolderId, masterSheetId, "dashboard");
    const visibleVerification = findDocumentById(documentsFromListResponse(listAfterWorkflow), verificationDocumentId);
    if (visibleVerification && isOperationalDocument(visibleVerification)) {
      return fail(
        "dashboard",
        "Verification document is treated as operational in Document Control list data.",
        "Ensure isOperationalDocument excludes verification rows from operational dashboard inputs.",
        listAfterWorkflow.status,
        { documentId: verificationDocumentId, status: visibleVerification.documentStatus },
      );
    }
    const operationalAwaiting = countOperationalAwaitingApproval(documentsFromListResponse(listAfterWorkflow));
    if (
      Number.isFinite(baselineOperationalAwaitingApproval) &&
      operationalAwaiting > baselineOperationalAwaitingApproval &&
      normalizeStatus(visibleVerification?.documentStatus) === "awaiting_approval"
    ) {
      return fail(
        "dashboard",
        "Operational awaiting-approval count increased because the verification document remains in approval queues.",
        "Inspect verification document exclusion from operational approval metrics.",
        listAfterWorkflow.status,
        {
          baselineAwaitingApproval: baselineOperationalAwaitingApproval,
          awaitingApproval: operationalAwaiting,
        },
      );
    }
    if (
      Number.isFinite(baselineDashboardPendingDocuments) &&
      Number.isFinite(dashboardResponse.json?.metrics?.pendingDocuments) &&
      dashboardResponse.json.metrics.pendingDocuments > baselineDashboardPendingDocuments &&
      (documentAppearsInPendingDocuments(dashboardResponse.json, verificationDocumentId) ||
        documentAppearsInDashboard(dashboardResponse.json, verificationDocumentId))
    ) {
      return fail(
        "dashboard",
        "Dashboard pendingDocuments increased because the verification document remains in operational metrics.",
        "Inspect verification document exclusion from operational dashboard metrics.",
        dashboardResponse.status,
        {
          baselinePendingDocuments: baselineDashboardPendingDocuments,
          pendingDocuments: dashboardResponse.json.metrics.pendingDocuments,
        },
      );
    }
    pass("dashboard");
    return null;
  });
  if (dashboardFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || dashboardFail;
  }

  const terminalResult = await finalizeMutationWorkflow();
  if (terminalResult) {
    return terminalResult;
  }

  result.ok = true;
  result.durationMs = Date.now() - startedAt;
  return result;
}
