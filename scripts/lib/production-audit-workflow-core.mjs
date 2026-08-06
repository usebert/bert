/**
 * Production audit workflow checks — shared by live verifier and unit tests.
 *
 * Check drafts mirror the SPA: answers are held in a client-local draft store
 * (localStorage in the browser; ephemeral store in this verifier) until submit.
 */
import { assertNoPasswordHash } from "./live-http-client.mjs";
import {
  loadSmokeConfig,
  maskEmail,
  performProductionSmokeLogin,
} from "./production-auth-health-core.mjs";
import {
  PRODUCTION_VERIFICATION_AUDIT_ID,
  PRODUCTION_VERIFICATION_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_RESULT_STATUS,
  PRODUCTION_VERIFICATION_SCHEDULE_ID,
  PRODUCTION_VERIFICATION_SMOKE_LOCAL_SUBMISSION_PREFIX,
} from "../../shared/production-verification-audit.mjs";

export { loadSmokeConfig, performProductionSmokeLogin, maskEmail };

export const CHECK_KEYS = [
  "authentication",
  "assignedAudits",
  "openAudit",
  "saveDraft",
  "resumeDraft",
  "editDraft",
  "submit",
  "auditResults",
  "dashboard",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  assignedAudits: "Assigned Audits",
  openAudit: "Open Audit",
  saveDraft: "Save Draft",
  resumeDraft: "Resume Draft",
  editDraft: "Edit Draft",
  submit: "Submit",
  auditResults: "Audit Results",
  dashboard: "Dashboard",
  cleanup: "Cleanup",
};

const VERIFICATION_SCHEDULE_PATTERNS = [
  /bert\s+verification/i,
  /verification\s+audit/i,
  /deploy(ment)?\s+verification/i,
  /smoke\s+test\s+check/i,
  /workflow\s+verification/i,
];

const DEFAULT_TIMEOUT_MS = 180_000;

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeIdentity(value) {
  return trim(value).toLowerCase().replace(/\s+/g, " ");
}

export function loadAuditWorkflowConfig(env = process.env) {
  const base = loadSmokeConfig(env);
  const verificationScheduleId =
    trim(env.BERT_SMOKE_VERIFICATION_SCHEDULE_ID) || PRODUCTION_VERIFICATION_SCHEDULE_ID;
  const verificationAuditId =
    trim(env.BERT_SMOKE_VERIFICATION_AUDIT_ID) || PRODUCTION_VERIFICATION_AUDIT_ID;
  const allowVerificationSubmit =
    trim(env.BERT_SMOKE_ALLOW_VERIFICATION_SUBMIT).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_VERIFICATION_SUBMIT).toLowerCase() === "true";
  return {
    ...base,
    verificationScheduleId,
    verificationAuditId,
    allowVerificationSubmit,
  };
}

export function isSafeVerificationSchedule(schedule = {}, config = {}) {
  const explicitId = trim(config.verificationScheduleId);
  const scheduleId = trim(schedule.id || schedule.scheduleId);
  if (explicitId && scheduleId === explicitId) {
    return true;
  }
  const name = trim(schedule.scheduleName || schedule.name);
  return VERIFICATION_SCHEDULE_PATTERNS.some((pattern) => pattern.test(name));
}

export function resolveAssignedCheckAuditId(auditId, auditName) {
  const trimmedId = trim(auditId);
  if (trimmedId) {
    return trimmedId;
  }
  const name = trim(auditName);
  if (!name) {
    return "scheduled-check";
  }
  return normalizeIdentity(name).replace(/\s+/g, "-") || "scheduled-check";
}

export function buildQuestionsForAudit(auditName, templates = [], auditId = "") {
  const normalizedName = normalizeIdentity(auditName);
  const normalizedAuditId = trim(auditId).toLowerCase();
  const template = templates.find((item) => {
    const id = trim(item.id || item.formId || item.driveFileId || item.auditId);
    const name = normalizeIdentity(item.name || item.templateName || item.template_name || item.auditName);
    if (normalizedAuditId && id && id.toLowerCase() === normalizedAuditId) {
      return true;
    }
    return name === normalizedName;
  });

  if (template && Array.isArray(template.questions) && template.questions.length > 0) {
    return template.questions.map((question, index) => ({
      id: trim(question.id || question.questionId || `q-${index + 1}`),
      text: trim(question.text || question.questionText || question.label || `Question ${index + 1}`),
      fieldType: trim(question.fieldType || question.type || "Pass / Fail"),
      required: question.required !== false,
      requiresPhotoEvidence: Boolean(question.requiresPhotoEvidence),
    }));
  }

  const builderQuestions = flattenAuditBuilderTemplateQuestions(template);
  if (builderQuestions.length > 0) {
    return builderQuestions;
  }

  const safeName = trim(auditName) || "scheduled-check";
  return [
    {
      id: `${safeName.replace(/\s+/g, "-").toLowerCase()}-check`,
      text: `Complete check: ${safeName}`,
      fieldType: "Pass / Fail",
      required: true,
      requiresPhotoEvidence: false,
    },
  ];
}

export function flattenAuditBuilderTemplateQuestions(template) {
  if (!template || typeof template !== "object") {
    return [];
  }
  const sections = Array.isArray(template.sections) ? template.sections : [];
  const flattened = [];
  for (const section of sections) {
    for (const [index, question] of (section.questions || []).entries()) {
      const text = trim(question.question_text || question.text || question.label);
      if (!text) {
        continue;
      }
      flattened.push({
        id: trim(question.id || question.questionId || `q-${flattened.length + 1}`),
        text,
        fieldType: trim(question.fieldType || question.answer_type || "Pass / Fail"),
        required: question.required !== false,
        requiresPhotoEvidence: Boolean(question.requiresPhotoEvidence || question.allows_photo_evidence),
      });
    }
  }
  return flattened;
}

export function buildQuestionsForAssignedAudit(auditName, auditId, googleForms = [], auditBuilderTemplates = []) {
  const fromForms = buildQuestionsForAudit(auditName, googleForms, auditId);
  if (fromForms.length === 1 && fromForms[0]?.text?.startsWith("Complete check:")) {
    const fromBuilder = buildQuestionsForAudit(auditName, auditBuilderTemplates, auditId);
    if (fromBuilder.length > 0 && !fromBuilder[0]?.text?.startsWith("Complete check:")) {
      return fromBuilder;
    }
  }
  return fromForms;
}

export function pickSafeAnswer(question) {
  const fieldType = trim(question.fieldType).toLowerCase();
  if (fieldType.includes("text")) {
    return { response: "pass", textResponse: "BERT smoke verification — no issues observed." };
  }
  return { response: "pass", textResponse: "" };
}

export function createDraftStore() {
  const drafts = new Map();

  return {
    save(auditId, payload) {
      const id = trim(auditId);
      if (!id) {
        throw new Error("auditId is required to save a draft");
      }
      const draftId = `draft-${id}-${Date.now()}`;
      const record = {
        draftId,
        auditId: id,
        savedAt: new Date().toISOString(),
        responses: { ...(payload.responses || {}) },
        textResponses: { ...(payload.textResponses || {}) },
        notes: { ...(payload.notes || {}) },
        evidence: { ...(payload.evidence || {}) },
        questionIndex: Number(payload.questionIndex) || 0,
      };
      drafts.set(id, record);
      return record;
    },
    load(auditId) {
      return drafts.get(trim(auditId)) || null;
    },
    update(auditId, patch) {
      const existing = drafts.get(trim(auditId));
      if (!existing) {
        throw new Error("Draft not found");
      }
      const next = {
        ...existing,
        savedAt: new Date().toISOString(),
        responses: { ...existing.responses, ...(patch.responses || {}) },
        textResponses: { ...existing.textResponses, ...(patch.textResponses || {}) },
        notes: { ...existing.notes, ...(patch.notes || {}) },
        evidence: { ...existing.evidence, ...(patch.evidence || {}) },
        questionIndex:
          typeof patch.questionIndex === "number" ? patch.questionIndex : existing.questionIndex,
      };
      drafts.set(trim(auditId), next);
      return next;
    },
    clear(auditId) {
      drafts.delete(trim(auditId));
    },
    clearAll() {
      drafts.clear();
    },
    size() {
      return drafts.size;
    },
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

export function formatAuditWorkflowReport(result) {
  const lines = [
    "==========================================",
    "BERT Production Audit Workflow",
    "==========================================",
    "",
  ];

  for (const key of CHECK_KEYS) {
    const status = result.checks[key]?.status || "FAIL";
    const label = CHECK_LABELS[key];
    lines.push(`${label.padEnd(18)} ${status}`);
  }

  lines.push("");
  if (result.apiVersion) {
    lines.push(`API Version: ${result.apiVersion}`);
  }
  if (result.apiSha) {
    lines.push(`API SHA: ${result.apiSha}`);
  }
  if (result.accountEmail) {
    lines.push(`Account: ${maskEmail(result.accountEmail)}`);
  }
  if (result.durationMs) {
    lines.push(`Duration: ${result.durationMs}ms`);
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

export function flattenAssignedAudits(schedules = []) {
  const rows = [];
  for (const schedule of schedules) {
    const scheduleId = trim(schedule.id || schedule.scheduleId);
    const scheduleName = trim(schedule.scheduleName || schedule.name);
    const audits = Array.isArray(schedule.audits) ? schedule.audits : [];
    if (audits.length === 0) {
      rows.push({
        schedule,
        scheduleId,
        scheduleName,
        auditId: resolveAssignedCheckAuditId("", scheduleName),
        auditName: scheduleName || "Scheduled check",
      });
      continue;
    }
    for (const audit of audits) {
      const auditId = trim(audit.auditId);
      const auditName = trim(audit.auditName || scheduleName);
      rows.push({
        schedule,
        scheduleId,
        scheduleName,
        auditId: resolveAssignedCheckAuditId(auditId, auditName),
        auditName,
      });
    }
  }
  return rows;
}

export function pickWorkflowTarget(assignedRows, config) {
  const verification = assignedRows.find((row) => isSafeVerificationSchedule(row.schedule, config));
  const nonVerification = assignedRows.find((row) => !isSafeVerificationSchedule(row.schedule, config));
  return {
    draftTarget: nonVerification || assignedRows[0],
    submitTarget: verification || null,
  };
}

function assertResponseSafe(json, label) {
  assertNoPasswordHash(json, label);
  const raw = JSON.stringify(json || {});
  if (/scrypt\$|argon2\$|bcrypt\$/i.test(raw)) {
    throw new Error(`${label} appears to expose a password hash`);
  }
  if (/bert_company_session=/.test(raw)) {
    throw new Error(`${label} appears to expose a session cookie value`);
  }
}

function dashboardCompletionCount(payload = {}) {
  const metrics = payload.metrics || {};
  const today = payload.today || {};
  const candidates = [
    metrics.todayCompleted,
    metrics.completedChecks,
    metrics.completedChecksToday,
    metrics.checksCompletedToday,
    today.completedChecks,
    today.checksCompleted,
  ];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function extractResultField(record = {}, keys = []) {
  const normalizedKeys = keys.map((key) => normalizeIdentity(key).replace(/[^a-z0-9]/g, ""));
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = normalizeIdentity(header).replace(/[^a-z0-9]/g, "");
    if (normalizedKeys.some((key) => normalizedHeader === key || normalizedHeader.includes(key))) {
      const text = trim(value);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

export function countVerificationAuditResults(results = [], config = {}) {
  const scheduleId = trim(config.verificationScheduleId);
  const auditId = trim(config.verificationAuditId);
  return results.filter((row) => {
    const rowScheduleId = extractResultField(row, ["schedule id", "scheduleid"]);
    const rowAuditId = extractResultField(row, ["audit id", "auditid"]);
    const status = normalizeIdentity(extractResultField(row, ["status"]));
    if (status === PRODUCTION_VERIFICATION_CLEANED_STATUS) {
      return false;
    }
    return rowScheduleId === scheduleId && rowAuditId === auditId;
  }).length;
}

export function findVerificationAuditResult(results = [], config = {}, resultId = "") {
  const targetId = trim(resultId);
  const scheduleId = trim(config.verificationScheduleId);
  const auditId = trim(config.verificationAuditId);
  return results.find((row) => {
    const rowResultId = extractResultField(row, ["result id", "resultid", "id"]);
    const rowScheduleId = extractResultField(row, ["schedule id", "scheduleid"]);
    const rowAuditId = extractResultField(row, ["audit id", "auditid"]);
    if (targetId && rowResultId !== targetId) {
      return false;
    }
    return rowScheduleId === scheduleId && rowAuditId === auditId;
  });
}

export function listActiveVerificationAuditResults(results = [], config = {}) {
  const scheduleId = trim(config.verificationScheduleId);
  const auditId = trim(config.verificationAuditId);
  return results.filter((row) => {
    const status = normalizeIdentity(extractResultField(row, ["status"]));
    if (status === PRODUCTION_VERIFICATION_CLEANED_STATUS) {
      return false;
    }
    const rowScheduleId = extractResultField(row, ["schedule id", "scheduleid"]);
    const rowAuditId = extractResultField(row, ["audit id", "auditid"]);
    return rowScheduleId === scheduleId && rowAuditId === auditId;
  });
}

export async function cleanupStaleVerificationResults(request, companyFolderId, masterSheetId, config = {}) {
  let auditResults;
  try {
    auditResults = await request(
      "GET",
      `/api/companies/${encodeURIComponent(companyFolderId)}/audit-results?masterSheetId=${encodeURIComponent(masterSheetId)}`,
    );
  } catch {
    return { ok: true, cleanedCount: 0 };
  }
  if (auditResults.status !== 200 || auditResults.json?.ok !== true) {
    return { ok: true, cleanedCount: 0 };
  }
  const results = Array.isArray(auditResults.json?.results) ? auditResults.json.results : [];
  const staleRows = listActiveVerificationAuditResults(results, config);
  let cleanedCount = 0;
  for (const row of staleRows) {
    const resultId = extractResultField(row, ["result id", "resultid", "id"]);
    if (!resultId) {
      continue;
    }
    try {
      const cleanup = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/audit-results/${encodeURIComponent(resultId)}/verification-cleanup`,
        {
          companyFolderId,
          masterSheetId,
          localSubmissionId: extractResultField(row, ["local submission id", "localsubmissionid"]),
        },
      );
      if (cleanup.status === 200 && cleanup.json?.ok === true) {
        cleanedCount += 1;
      }
    } catch {
      /* best-effort stale cleanup */
    }
  }
  return { ok: true, cleanedCount };
}

/**
 * @param {ReturnType<typeof loadAuditWorkflowConfig>} config
 * @param {{ request: Function, getCookies?: Function, clearCookies?: Function }} transport
 * @param {{ draftStore?: ReturnType<typeof createDraftStore> }} options
 */
export async function runProductionAuditWorkflowChecks(config, transport, options = {}) {
  const checks = Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PENDING" }]));
  const draftStore = options.draftStore || createDraftStore();
  const startedAt = Date.now();
  const result = {
    ok: false,
    checks,
    apiSha: "",
    apiVersion: "",
    shortSha: "",
    accountEmail: "",
    durationMs: 0,
    failedKey: "",
    failedStage: "",
    failureReason: "",
    remediation: "",
    httpStatus: 0,
    safeResponseBody: "",
    submissionSkipped: false,
    cleanupDraftRemoved: false,
  };

  const fail = (key, reason, remediation = "", httpStatus = 0, responseBody = null) => {
    checks[key].status = "FAIL";
    result.failedKey = key;
    result.failedStage = CHECK_LABELS[key];
    result.failureReason = reason;
    result.remediation = remediation;
    result.httpStatus = httpStatus;
    result.safeResponseBody = responseBody ? redactSafeResponseBody(responseBody) : "";
    for (const other of CHECK_KEYS) {
      if (other !== key && checks[other].status === "PENDING") {
        checks[other].status = "SKIP";
      }
    }
    result.durationMs = Date.now() - startedAt;
    return result;
  };

  const pass = (key, status = "PASS") => {
    checks[key].status = status;
  };

  const skipRemaining = (fromKey) => {
    const start = CHECK_KEYS.indexOf(fromKey);
    for (let index = start + 1; index < CHECK_KEYS.length; index += 1) {
      const key = CHECK_KEYS[index];
      if (checks[key].status === "PENDING") {
        checks[key].status = "SKIP";
      }
    }
  };

  const request = transport.request;

  // Authentication
  let health;
  try {
    health = await request("GET", "/api/health");
  } catch (error) {
    return fail(
      "authentication",
      `API health unreachable: ${error instanceof Error ? error.message : String(error)}`,
      "Confirm the API host is deployed and accepting traffic.",
    );
  }
  if (health.status !== 200 || health.json?.ok !== true) {
    return fail(
      "authentication",
      `Expected GET /api/health HTTP 200 with ok:true (got ${health.status}).`,
      "Wait for startup boot gate to complete, then retry.",
      health.status,
      health.json,
    );
  }
  result.apiSha = trim(health.json?.gitSha);
  result.apiVersion = trim(health.json?.version);
  result.shortSha = trim(health.json?.shortSha) || (result.apiSha ? result.apiSha.slice(0, 7) : "");

  const login = await performProductionSmokeLogin(config, transport);
  if (!login.ok) {
    return fail(
      "authentication",
      login.failureReason,
      login.remediation,
      login.httpStatus,
      login.responseBody,
    );
  }
  result.accountEmail = login.accountEmail;
  pass("authentication");

  const companyFolderId = login.companyFolderId || config.companyFolderId;
  const masterSheetId = login.masterSheetId || config.masterSheetId;

  // Assigned audits
  let assigned;
  try {
    assigned = await request("GET", "/api/me/assigned-checks");
  } catch (error) {
    return fail(
      "assignedAudits",
      `Assigned checks request failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect GET /api/me/assigned-checks on the API host.",
    );
  }
  assertResponseSafe(assigned.json, "assigned checks");
  if (assigned.status !== 200 || assigned.json?.ok !== true) {
    return fail(
      "assignedAudits",
      `Could not load assigned checks (HTTP ${assigned.status}).`,
      "Verify the smoke account has at least one live schedule assigned in the company workbook.",
      assigned.status,
      assigned.json,
    );
  }

  const schedules = Array.isArray(assigned.json?.schedules) ? assigned.json.schedules : [];
  const assignedRows = flattenAssignedAudits(schedules);
  if (assignedRows.length === 0) {
    return fail(
      "assignedAudits",
      "No assigned audits were returned for the smoke account.",
      "Assign at least one live schedule to the smoke user in the company workbook Schedules tab.",
      assigned.status,
      { scheduleCount: schedules.length },
    );
  }
  pass("assignedAudits");

  const { draftTarget, submitTarget } = pickWorkflowTarget(assignedRows, config);
  if (!draftTarget) {
    return fail("openAudit", "Could not select an assigned audit for draft workflow.");
  }

  // Open audit — load templates/questions from google-forms
  let forms;
  try {
    forms = await request(
      "GET",
      `/api/companies/${encodeURIComponent(companyFolderId)}/google-forms?masterSheetId=${encodeURIComponent(masterSheetId)}`,
    );
  } catch (error) {
    return fail(
      "openAudit",
      `Google forms request failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect GET /api/companies/:id/google-forms and Google Drive folder access.",
    );
  }
  assertResponseSafe(forms.json, "google forms");
  if (forms.status !== 200 || forms.json?.ok === false) {
    return fail(
      "openAudit",
      `Could not load audit templates/forms (HTTP ${forms.status}).`,
      "Verify the company Google Forms folder is reachable and synced.",
      forms.status,
      forms.json,
    );
  }

  const googleForms = Array.isArray(forms.json?.forms)
    ? forms.json.forms
    : Array.isArray(forms.json?.templates)
      ? forms.json.templates
      : [];

  let auditBuilderTemplates = [];
  try {
    const templatesResponse = await request(
      "GET",
      `/api/audits/templates?masterSheetId=${encodeURIComponent(masterSheetId)}`,
    );
    assertResponseSafe(templatesResponse.json, "audit templates");
    if (templatesResponse.status === 200 && templatesResponse.json?.ok !== false) {
      auditBuilderTemplates = Array.isArray(templatesResponse.json?.templates)
        ? templatesResponse.json.templates
        : [];
    }
  } catch {
    auditBuilderTemplates = [];
  }

  const questions = buildQuestionsForAssignedAudit(
    draftTarget.auditName,
    draftTarget.auditId,
    googleForms,
    auditBuilderTemplates,
  );
  if (!questions.length || !questions[0]?.id) {
    return fail(
      "openAudit",
      "Assigned audit did not resolve to any questions.",
      "Verify the schedule audit maps to a template or Google Form in the company folder.",
      forms.status,
      {
        auditName: draftTarget.auditName,
        googleFormCount: googleForms.length,
        auditBuilderTemplateCount: auditBuilderTemplates.length,
      },
    );
  }

  if (assigned.json?.companyFolderId && assigned.json.companyFolderId !== companyFolderId) {
    return fail(
      "openAudit",
      "Assigned checks company context does not match the signed-in session.",
      "Inspect company session enrichment and assigned-checks scoping.",
      assigned.status,
      { sessionFolderId: companyFolderId, responseFolderId: assigned.json.companyFolderId },
    );
  }
  pass("openAudit");

  const firstQuestion = questions[0];
  const safeAnswer = pickSafeAnswer(firstQuestion);
  const initialResponses = { [firstQuestion.id]: safeAnswer.response };
  const initialTextResponses = safeAnswer.textResponse
    ? { [firstQuestion.id]: safeAnswer.textResponse }
    : {};

  // Save draft (client-local parity)
  let savedDraft;
  try {
    savedDraft = draftStore.save(draftTarget.auditId, {
      responses: initialResponses,
      textResponses: initialTextResponses,
      notes: {},
      evidence: {},
      questionIndex: 0,
    });
  } catch (error) {
    return fail(
      "saveDraft",
      error instanceof Error ? error.message : String(error),
      "Inspect draft payload shaping in the workflow verifier.",
    );
  }
  if (!savedDraft?.draftId || !savedDraft.savedAt) {
    return fail("saveDraft", "Draft save did not record a draft ID and timestamp.");
  }
  pass("saveDraft");

  // Resume draft
  const resumed = draftStore.load(draftTarget.auditId);
  if (!resumed) {
    return fail(
      "resumeDraft",
      "Saved draft could not be reloaded.",
      "Inspect draft store persistence between save and resume steps.",
    );
  }
  if (resumed.responses[firstQuestion.id] !== safeAnswer.response) {
    return fail(
      "resumeDraft",
      "Reloaded draft did not preserve the saved answer.",
      "Inspect draft answer map keys against audit question IDs.",
      0,
      { expected: safeAnswer.response, got: resumed.responses[firstQuestion.id] },
    );
  }
  pass("resumeDraft");

  // Edit draft
  const editQuestion = questions[1] || firstQuestion;
  const editAnswer = pickSafeAnswer(editQuestion);
  let editedDraft;
  try {
    editedDraft = draftStore.update(draftTarget.auditId, {
      responses: { [editQuestion.id]: editAnswer.response },
      textResponses: editAnswer.textResponse ? { [editQuestion.id]: editAnswer.textResponse } : {},
      questionIndex: 1,
    });
  } catch (error) {
    return fail(
      "editDraft",
      error instanceof Error ? error.message : String(error),
      "Inspect draft update logic.",
    );
  }
  if (editedDraft.responses[editQuestion.id] !== editAnswer.response) {
    return fail(
      "editDraft",
      "Edited answer was not persisted in the draft.",
      "Inspect draft merge behaviour for responses.",
      0,
      { questionId: editQuestion.id },
    );
  }
  pass("editDraft");

  // Submit / results / dashboard / cleanup — only when explicitly enabled and verification schedule exists
  if (!submitTarget || !config.allowVerificationSubmit) {
    result.submissionSkipped = true;
    pass("submit", "SKIPPED");
    pass("auditResults", "SKIPPED");
    pass("dashboard", "SKIPPED");
    pass("cleanup", "SKIPPED");
    draftStore.clear(draftTarget.auditId);
    result.cleanupDraftRemoved = draftStore.load(draftTarget.auditId) === null;
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const submitAudit = submitTarget;
  const submitQuestions = buildQuestionsForAssignedAudit(
    submitAudit.auditName,
    submitAudit.auditId,
    googleForms,
    auditBuilderTemplates,
  );
  const submitAnswers = {};
  for (const question of submitQuestions) {
    const answer = pickSafeAnswer(question);
    submitAnswers[question.id] = answer.response;
    if (answer.textResponse) {
      submitAnswers[`${question.id}__text`] = answer.textResponse;
    }
  }

  await cleanupStaleVerificationResults(request, companyFolderId, masterSheetId, config);

  let dashboardBefore;
  try {
    dashboardBefore = await request(
      "GET",
      `/api/companies/${encodeURIComponent(companyFolderId)}/dashboard/live?masterSheetId=${encodeURIComponent(masterSheetId)}`,
    );
  } catch (error) {
    return fail(
      "dashboard",
      `Dashboard pre-submit request failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect GET /api/companies/:id/dashboard/live.",
    );
  }
  assertResponseSafe(dashboardBefore.json, "dashboard before submit");
  const beforeCount = dashboardCompletionCount(dashboardBefore.json);

  const localSubmissionId = `${PRODUCTION_VERIFICATION_SMOKE_LOCAL_SUBMISSION_PREFIX}${Date.now()}`;
  let complete;
  try {
    complete = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/checks/${encodeURIComponent(submitAudit.scheduleId)}/complete`,
      {
        companyFolderId,
        masterSheetId,
        auditId: submitAudit.auditId,
        auditName: submitAudit.auditName,
        status: "completed",
        answers: submitAnswers,
        findings: [],
        evidenceRefs: [],
        evidenceFiles: [],
        localSubmissionId,
        completedByName: login.user?.name || login.accountEmail,
      },
    );
  } catch (error) {
    return fail(
      "submit",
      `Check submission failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect POST /api/companies/:id/checks/:scheduleId/complete.",
    );
  }
  assertResponseSafe(complete.json, "check complete");
  if (complete.status !== 200 || complete.json?.ok !== true) {
    return fail(
      "submit",
      `Verification audit submission was rejected (HTTP ${complete.status}).`,
      "Inspect schedule assignment, completion eligibility, and workbook write permissions.",
      complete.status,
      complete.json,
    );
  }
  pass("submit");

  const resultId = trim(complete.json?.resultId);
  let auditResults;
  try {
    auditResults = await request(
      "GET",
      `/api/companies/${encodeURIComponent(companyFolderId)}/audit-results?masterSheetId=${encodeURIComponent(masterSheetId)}`,
    );
  } catch (error) {
    return fail(
      "auditResults",
      `Audit results request failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect GET /api/companies/:id/audit-results.",
    );
  }
  assertResponseSafe(auditResults.json, "audit results");
  if (auditResults.status !== 200 || auditResults.json?.ok !== true) {
    return fail(
      "auditResults",
      `Could not load audit results after submission (HTTP ${auditResults.status}).`,
      "Inspect AuditResults tab reads for the company workbook.",
      auditResults.status,
      auditResults.json,
    );
  }
  const results = Array.isArray(auditResults.json?.results) ? auditResults.json.results : [];
  const activeVerificationResults = listActiveVerificationAuditResults(results, config);
  const foundResult = findVerificationAuditResult(results, config, resultId);
  if (!foundResult) {
    return fail(
      "auditResults",
      "Submitted verification check does not appear in AuditResults with the expected schedule and audit IDs.",
      "Inspect AuditResults append path and list filtering for the company workbook.",
      auditResults.status,
      { resultId, resultCount: results.length, activeVerificationResultCount: activeVerificationResults.length },
    );
  }
  if (activeVerificationResults.length !== 1) {
    return fail(
      "auditResults",
      `Expected exactly one active verification AuditResults row after submit, found ${activeVerificationResults.length}.`,
      "Inspect duplicate verification submissions and cleanup of prior smoke rows.",
      auditResults.status,
      { resultId, activeVerificationResultCount: activeVerificationResults.length },
    );
  }
  const foundStatus = normalizeIdentity(extractResultField(foundResult, ["status"]));
  if (foundStatus && foundStatus !== PRODUCTION_VERIFICATION_RESULT_STATUS && foundStatus !== "completed") {
    return fail(
      "auditResults",
      `Verification AuditResults row has unexpected status "${foundStatus}".`,
      "Inspect verification result status tagging during completion.",
      auditResults.status,
      { resultId, status: foundStatus },
    );
  }
  pass("auditResults");

  let dashboardAfter;
  try {
    dashboardAfter = await request(
      "GET",
      `/api/companies/${encodeURIComponent(companyFolderId)}/dashboard/live?masterSheetId=${encodeURIComponent(masterSheetId)}&refresh=1`,
    );
  } catch (error) {
    return fail(
      "dashboard",
      `Dashboard post-submit request failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect GET /api/companies/:id/dashboard/live.",
    );
  }
  assertResponseSafe(dashboardAfter.json, "dashboard after submit");
  if (dashboardAfter.status !== 200 || dashboardAfter.json?.ok !== true) {
    return fail(
      "dashboard",
      `Dashboard did not load after submission (HTTP ${dashboardAfter.status}).`,
      "Inspect live dashboard aggregation after check completion.",
      dashboardAfter.status,
      dashboardAfter.json,
    );
  }
  const afterCount = dashboardCompletionCount(dashboardAfter.json);
  if (beforeCount !== null && afterCount !== null && afterCount > beforeCount) {
    return fail(
      "dashboard",
      "Dashboard completion count increased after verification submit.",
      "Inspect live dashboard aggregation excludes verification audit results.",
      dashboardAfter.status,
      { beforeCount, afterCount },
    );
  }
  if (beforeCount !== null && afterCount !== null && afterCount < beforeCount) {
    return fail(
      "dashboard",
      "Dashboard completion count decreased after verification submit.",
      "Inspect live dashboard metrics aggregation for completed checks.",
      dashboardAfter.status,
      { beforeCount, afterCount },
    );
  }
  pass("dashboard");

  let cleanup;
  try {
    cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/audit-results/${encodeURIComponent(resultId)}/verification-cleanup`,
      {
        companyFolderId,
        masterSheetId,
        localSubmissionId,
      },
    );
  } catch (error) {
    return fail(
      "cleanup",
      `Verification cleanup request failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect POST /api/companies/:id/audit-results/:resultId/verification-cleanup.",
    );
  }
  assertResponseSafe(cleanup.json, "verification cleanup");
  if (cleanup.status !== 200 || cleanup.json?.ok !== true) {
    return fail(
      "cleanup",
      `Verification cleanup was rejected (HTTP ${cleanup.status}).`,
      "Inspect verification cleanup permissions and AuditResults patch path.",
      cleanup.status,
      cleanup.json,
    );
  }

  let auditResultsAfterCleanup;
  try {
    auditResultsAfterCleanup = await request(
      "GET",
      `/api/companies/${encodeURIComponent(companyFolderId)}/audit-results?masterSheetId=${encodeURIComponent(masterSheetId)}`,
    );
  } catch (error) {
    return fail(
      "cleanup",
      `Post-cleanup audit results request failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect GET /api/companies/:id/audit-results after cleanup.",
    );
  }
  assertResponseSafe(auditResultsAfterCleanup.json, "audit results after cleanup");
  const resultsAfterCleanup = Array.isArray(auditResultsAfterCleanup.json?.results)
    ? auditResultsAfterCleanup.json.results
    : [];
  const cleanedRow = resultsAfterCleanup.find(
    (row) => trim(row?.id || row?.resultId || row?.["Result ID"]) === resultId,
  );
  const cleanedStatus = normalizeIdentity(extractResultField(cleanedRow || {}, ["status"]));
  if (
    listActiveVerificationAuditResults(resultsAfterCleanup, config).length !== 0 &&
    cleanedStatus !== PRODUCTION_VERIFICATION_CLEANED_STATUS
  ) {
    return fail(
      "cleanup",
      "Verification AuditResults row was not marked cleaned after cleanup.",
      "Inspect verification cleanup status patch and operational result filtering.",
      cleanup.status,
      { resultId, cleanedStatus, verificationResultCount: countVerificationAuditResults(resultsAfterCleanup, config) },
    );
  }
  pass("cleanup");

  draftStore.clear(draftTarget.auditId);
  result.cleanupDraftRemoved = draftStore.load(draftTarget.auditId) === null;
  result.submittedResultId = resultId;
  result.ok = true;
  result.durationMs = Date.now() - startedAt;
  return result;
}
