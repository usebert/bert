/**
 * Production smoke verification offline sync — assigned audit/check path.
 * Reuses bert-verify-audit-v1 and bert-sch-production-verification assets.
 */
import {
  PRODUCTION_VERIFICATION_AUDIT_ID,
  PRODUCTION_VERIFICATION_QUESTIONS,
  PRODUCTION_VERIFICATION_SCHEDULE_ID,
  PRODUCTION_VERIFICATION_SMOKE_EMAIL,
  PRODUCTION_VERIFICATION_SMOKE_LOCAL_SUBMISSION_PREFIX,
  PRODUCTION_VERIFICATION_SMOKE_NAME,
} from "./production-verification-audit.mjs";

export const PRODUCTION_OFFLINE_RUN_ID_PREFIX = "bert-smoke-offline-";
export const PRODUCTION_OFFLINE_VERIFICATION_SOURCE = "production-offline-sync-workflow";
export const PRODUCTION_OFFLINE_DRAFT_MARKER = "verification-offline-draft";
export const OFFLINE_INDEXED_DB_NAME = "bert-tablet-offline-v1";
export const OFFLINE_QUEUE_STORE = "submissionQueue";
export const OFFLINE_SUBMISSION_STORE = "offlineSubmissions";
export const OFFLINE_ASSIGNED_WORK_STORE = "tabletAssignedWork";
export const WORKSPACE_STATE_KEY = "bert-workspace-state";
export const SUBMISSION_QUEUE_META_KEY = "bert-submission-queue-meta";

function trim(value) {
  return String(value ?? "").trim();
}

export function buildProductionOfflineRunId(runId = Date.now()) {
  return `${PRODUCTION_OFFLINE_RUN_ID_PREFIX}${runId}`;
}

export function isVerificationOfflineRunId(localSubmissionId = "") {
  const id = trim(localSubmissionId);
  return id.startsWith(PRODUCTION_OFFLINE_RUN_ID_PREFIX);
}

export function isVerificationOfflineQueueItem(item = {}) {
  const localId = trim(item.localId || item.id || item.localSubmissionId);
  if (isVerificationOfflineRunId(localId)) {
    return true;
  }
  const payload = item.payload || {};
  const embedded = payload.offlineSubmission || payload;
  const embeddedId = trim(embedded.localSubmissionId);
  return isVerificationOfflineRunId(embeddedId);
}

export function isVerificationOfflineDraft(draft = {}) {
  const marker = trim(draft.verificationMarker || draft.offlineRunMarker);
  if (marker === PRODUCTION_OFFLINE_DRAFT_MARKER) {
    return true;
  }
  const runId = trim(draft.offlineRunId || draft.runId);
  return isVerificationOfflineRunId(runId);
}

export function buildVerificationOfflineAnswers(questions = PRODUCTION_VERIFICATION_QUESTIONS) {
  const answers = {};
  const notes = {};
  for (const question of questions) {
    answers[question.id] = "pass";
    notes[question.id] = "BERT offline verification — no issues observed.";
  }
  return { answers, notes };
}

export function buildVerificationOfflineAuditStub(input = {}) {
  const auditId = trim(input.auditId) || PRODUCTION_VERIFICATION_AUDIT_ID;
  const scheduleId = trim(input.scheduleId) || PRODUCTION_VERIFICATION_SCHEDULE_ID;
  const questions = Array.isArray(input.questions) ? input.questions : PRODUCTION_VERIFICATION_QUESTIONS;
  return {
    id: auditId,
    name: trim(input.auditName) || "BERT Verification Audit",
    templateVersion: auditId,
    scheduleId,
    questions: questions.map((question, index) => ({
      id: trim(question.id) || `q-${index + 1}`,
      text: trim(question.text) || `Question ${index + 1}`,
      fieldType: trim(question.fieldType) || "Pass / Fail",
      required: question.required !== false,
    })),
  };
}

export function buildVerificationOfflineDraft(input = {}) {
  const runId = input.runId ?? Date.now();
  const offlineRunId = trim(input.offlineRunId) || buildProductionOfflineRunId(runId);
  const audit = buildVerificationOfflineAuditStub(input);
  const { answers, notes } = buildVerificationOfflineAnswers(audit.questions);
  const editedAnswers = { ...answers, ...(input.answers || {}) };
  const editedNotes = { ...notes, ...(input.notes || {}) };
  return {
    draftId: `draft-${audit.id}-${offlineRunId}`,
    auditId: audit.id,
    scheduleId: audit.scheduleId,
    offlineRunId,
    verificationMarker: PRODUCTION_OFFLINE_DRAFT_MARKER,
    verificationSource: PRODUCTION_OFFLINE_VERIFICATION_SOURCE,
    answers: editedAnswers,
    notes: editedNotes,
    responses: editedAnswers,
    progress: Object.keys(editedAnswers).length,
    updatedAt: new Date().toISOString(),
  };
}

export function buildVerificationOfflineSubmission(input = {}) {
  const runId = input.runId ?? Date.now();
  const offlineRunId = trim(input.offlineRunId) || buildProductionOfflineRunId(runId);
  const audit = buildVerificationOfflineAuditStub(input);
  const { answers, notes } = buildVerificationOfflineAnswers(audit.questions);
  const mergedAnswers = { ...answers, ...(input.answers || {}) };
  const mergedNotes = { ...notes, ...(input.notes || {}) };
  const createdAt = trim(input.createdAt) || new Date().toISOString();
  const companyFolderId = trim(input.companyFolderId);
  const masterSheetId = trim(input.masterSheetId);
  const scheduleId = trim(input.scheduleId) || PRODUCTION_VERIFICATION_SCHEDULE_ID;
  const userEmail = trim(input.userEmail) || PRODUCTION_VERIFICATION_SMOKE_EMAIL;
  const submittedBy = trim(input.submittedBy) || PRODUCTION_VERIFICATION_SMOKE_NAME;

  const submission = {
    localSubmissionId: offlineRunId,
    deviceId: trim(input.deviceId) || "bert-smoke-verifier",
    userId: trim(input.userId) || userEmail,
    companyFolderId,
    masterSheetId,
    scheduleId,
    checkId: audit.id,
    templateId: audit.id,
    answers: mergedAnswers,
    failedAnswers: {},
    notes: mergedNotes,
    promptFollowUps: {},
    evidenceRefs: [],
    signatureDataUrl: "audit-mode-signature-not-required",
    createdAt,
    syncStatus: "queued",
    retryCount: 0,
    lastError: "",
    submittedBy,
    audit,
    verificationSource: PRODUCTION_OFFLINE_VERIFICATION_SOURCE,
    offlineRunId,
  };

  const queueItem = {
    id: offlineRunId,
    type: "auditCompletion",
    companyFolderId,
    userEmail,
    createdAt,
    updatedAt: createdAt,
    status: "queued",
    attemptCount: 0,
    lastError: "",
    payload: { offlineSubmission: submission },
    evidenceRefs: [],
    idempotencyKey: `audit-completion-${offlineRunId}`,
    localId: offlineRunId,
    verificationSource: PRODUCTION_OFFLINE_VERIFICATION_SOURCE,
  };

  return { submission, queueItem };
}

export function offlineSubmissionToCompleteCheckBody(submission, input = {}) {
  const answers = submission.answers || {};
  const notes = submission.notes || {};
  const answersPayload = {};
  for (const [questionId, value] of Object.entries(answers)) {
    answersPayload[questionId] = value;
    const note = trim(notes[questionId]);
    if (note) {
      answersPayload[`${questionId}__text`] = note;
    }
  }
  return {
    companyFolderId: submission.companyFolderId,
    masterSheetId: submission.masterSheetId,
    auditId: submission.checkId,
    auditName: submission.audit?.name || "BERT Verification Audit",
    status: "completed",
    answers: answersPayload,
    findings: [],
    evidenceRefs: [],
    localSubmissionId: submission.localSubmissionId,
    completedByName: submission.submittedBy,
    verificationSource: PRODUCTION_OFFLINE_VERIFICATION_SOURCE,
    ...input,
  };
}

export function isOperationalOfflineQueueItem(item = {}) {
  return !isVerificationOfflineQueueItem(item);
}

export function matchesSmokeLocalSubmissionPrefix(localSubmissionId = "") {
  const id = trim(localSubmissionId);
  return (
    id.startsWith(PRODUCTION_VERIFICATION_SMOKE_LOCAL_SUBMISSION_PREFIX) ||
    id.startsWith(PRODUCTION_OFFLINE_RUN_ID_PREFIX)
  );
}
