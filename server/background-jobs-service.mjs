/**
 * Persistent background job queue — setup, invites, schedule sync, health checks.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BACKGROUND_JOB_INITIAL_RETRY_MS,
  BACKGROUND_JOB_MAX_ATTEMPTS,
  BACKGROUND_JOB_STATUSES,
  BACKGROUND_JOB_TYPES,
  backgroundJobStatusBadge,
} from "../shared/background-jobs.mjs";
import { ensureRequiredTabs } from "./ensure-required-tabs.mjs";
import { saveCompanySchedules } from "./schedule-save-service.mjs";
import {
  evaluateCompanyWorkspaceReadiness,
  getCanonicalCompanyRegistryRecord,
} from "./company-workspace-registry.mjs";

const PROCESS_INTERVAL_MS = 2_000;

function nowIso() {
  return new Date().toISOString();
}

function readJsonFile(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function computeNextRetryAt(attempts) {
  const delayMs = BACKGROUND_JOB_INITIAL_RETRY_MS * Math.pow(2, Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMs).toISOString();
}

function isGoogleTimeoutError(error) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || error || "").toLowerCase();
  return (
    code === "REGISTRY_ACTION_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    message.includes("timed out") ||
    message.includes("timeout")
  );
}

export function createBackgroundJobsService(sessionDir, deps = {}) {
  const storePath = path.join(sessionDir, "background-jobs.json");
  const pendingSchedulesDir = path.join(sessionDir, "schedule-pending");
  let processorTimer = null;
  let processing = false;

  function readStore() {
    const store = readJsonFile(storePath, { jobs: {} });
    if (!store.jobs || typeof store.jobs !== "object") {
      store.jobs = {};
    }
    return store;
  }

  function writeStore(store) {
    writeJsonFile(storePath, store);
  }

  function publicJob(job) {
    if (!job) {
      return null;
    }
    return {
      jobId: job.jobId,
      type: job.type,
      companyId: job.companyId,
      requestedBy: job.requestedBy,
      status: job.status,
      userMessage: job.userMessage,
      technicalError: job.technicalError,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      attempts: job.attempts,
      nextRetryAt: job.nextRetryAt,
      statusBadge: backgroundJobStatusBadge(job),
    };
  }

  function enqueueJob(input = {}) {
    const type = String(input.type || "").trim();
    if (!Object.values(BACKGROUND_JOB_TYPES).includes(type)) {
      throw new Error(`Unknown background job type: ${type}`);
    }

    const store = readStore();
    const jobId = crypto.randomBytes(12).toString("hex");
    const timestamp = nowIso();
    const job = {
      jobId,
      type,
      companyId: String(input.companyId || "").trim(),
      requestedBy: String(input.requestedBy || "").trim(),
      status: BACKGROUND_JOB_STATUSES.QUEUED,
      userMessage: String(input.userMessage || "").trim(),
      technicalError: "",
      payload: input.payload && typeof input.payload === "object" ? input.payload : {},
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      attempts: 0,
      nextRetryAt: null,
    };
    store.jobs[jobId] = job;
    writeStore(store);
    return publicJob(job);
  }

  function updateJob(jobId, patch = {}) {
    const store = readStore();
    const existing = store.jobs[jobId];
    if (!existing) {
      return null;
    }
    const next = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
    };
    store.jobs[jobId] = next;
    writeStore(store);
    return next;
  }

  function getJob(jobId) {
    const store = readStore();
    return publicJob(store.jobs[String(jobId || "").trim()]);
  }

  function listJobs(filters = {}) {
    const store = readStore();
    const companyId = String(filters.companyId || "").trim();
    const status = String(filters.status || "").trim();
    const type = String(filters.type || "").trim();
    const limit = Number(filters.limit) > 0 ? Number(filters.limit) : 100;

    let jobs = Object.values(store.jobs);
    if (companyId) {
      jobs = jobs.filter((job) => String(job.companyId || "").trim() === companyId);
    }
    if (status) {
      jobs = jobs.filter((job) => job.status === status);
    }
    if (type) {
      jobs = jobs.filter((job) => job.type === type);
    }
    jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return jobs.slice(0, limit).map(publicJob);
  }

  function persistPendingSchedules(companyId, payload = {}) {
    const id = String(companyId || "").trim();
    if (!id) {
      return "";
    }
    const filePath = path.join(pendingSchedulesDir, `${id}.json`);
    writeJsonFile(filePath, {
      companyId: id,
      savedAt: nowIso(),
      ...payload,
    });
    return filePath;
  }

  function readPendingSchedules(companyId) {
    const filePath = path.join(pendingSchedulesDir, `${String(companyId || "").trim()}.json`);
    return readJsonFile(filePath, null);
  }

  async function runCompleteCompanySetup(job) {
    const auth = deps.getAuthedClient?.();
    if (!auth) {
      throw Object.assign(new Error("Google Workspace is not connected."), { code: "GOOGLE_NOT_CONNECTED" });
    }

    const payload = job.payload || {};
    const masterSheetId = String(payload.masterSheetId || "").trim();
    const workspaceId = String(payload.workspaceId || job.companyId || "").trim();

    if (masterSheetId && deps.google) {
      await ensureRequiredTabs(
        auth,
        { ...deps, requiredTabs: ["Users"], timeoutMs: 30_000 },
        masterSheetId,
      );
    }

    if (typeof deps.relinkCompanyRegistryForWorkspace === "function" && workspaceId) {
      await deps.relinkCompanyRegistryForWorkspace(auth, deps, {
        workspaceId,
        companyId: workspaceId,
        companyFolderId: String(payload.companyFolderId || workspaceId).trim(),
        masterSheetId,
        companyName: String(payload.companyName || "").trim(),
      });
    }

    return { userMessage: "Company setup finished in the background." };
  }

  async function runVerifyCompanyHealth(job) {
    const auth = deps.getAuthedClient?.();
    if (!auth) {
      throw Object.assign(new Error("Google Workspace is not connected."), { code: "GOOGLE_NOT_CONNECTED" });
    }

    const companyId = String(job.companyId || "").trim();
    const record = await getCanonicalCompanyRegistryRecord(auth, deps, companyId);
    if (!record) {
      return {
        userMessage: "Company is live but some health checks need attention.",
        needsAttention: true,
        technicalError: "registry_record_missing",
      };
    }

    const readiness = evaluateCompanyWorkspaceReadiness(record, job.payload?.checks || {});
    if (!readiness.ready) {
      return {
        userMessage: "Company is live but some health checks need attention.",
        needsAttention: true,
        technicalError: (readiness.blockers || readiness.setupBlockers || []).join("; ") || "health_checks_incomplete",
      };
    }

    return { userMessage: "Company health verified." };
  }

  async function runSendInviteEmail(job) {
    const payload = job.payload || {};
    const toEmail = String(payload.toEmail || "").trim();
    const companyName = String(payload.companyName || "").trim();
    const inviteUrl = String(payload.inviteUrl || "").trim();

    if (!toEmail || !inviteUrl) {
      throw new Error("Invite email job missing recipient or invite URL.");
    }

    if (typeof deps.sendCompanyUserInviteEmail !== "function") {
      throw new Error("Invite email sender is not configured.");
    }

    if (typeof deps.emailConfigured === "function" && !deps.emailConfigured()) {
      throw Object.assign(new Error("SMTP is not configured."), { code: "SMTP_NOT_CONFIGURED" });
    }

    await deps.sendCompanyUserInviteEmail({ toEmail, companyName, inviteUrl });
    return { userMessage: `Invite email sent to ${toEmail}.` };
  }

  async function runSyncSchedules(job) {
    const auth = deps.getAuthedClient?.();
    const pending = readPendingSchedules(job.companyId);
    const payload = pending || job.payload || {};

    if (!auth) {
      throw Object.assign(new Error("Google Workspace is not connected."), { code: "GOOGLE_NOT_CONNECTED" });
    }

    const result = await saveCompanySchedules(auth, deps, {
      companyId: job.companyId,
      companyFolderId: String(payload.companyFolderId || job.companyId).trim(),
      masterSheetId: String(payload.masterSheetId || "").trim(),
      schedules: Array.isArray(payload.schedules) ? payload.schedules : [],
      createdBy: String(payload.createdBy || job.requestedBy || "").trim(),
    });

    if (!result.ok) {
      throw Object.assign(new Error(result.message || result.error || "Schedule sync failed."), {
        code: result.code || "SCHEDULE_SYNC_FAILED",
        technicalError: result.technicalError,
      });
    }

    return {
      userMessage: "Schedules synced to the company workbook.",
      written: result.written,
    };
  }

  async function runVerifyGoogleConnection() {
    const auth = deps.getAuthedClient?.();
    if (!auth) {
      throw Object.assign(new Error("Google Workspace is not connected."), { code: "GOOGLE_NOT_CONNECTED" });
    }
    if (typeof deps.envConfigured === "function" && !deps.envConfigured()) {
      throw Object.assign(new Error("Google OAuth env is not configured."), { code: "GOOGLE_ENV_MISSING" });
    }
    return { userMessage: "Google Workspace connection verified." };
  }

  async function runRebuildAuthIndex(job) {
    const auth = deps.getAuthedClient?.();
    if (!auth) {
      throw Object.assign(new Error("Google Workspace is not connected."), { code: "GOOGLE_NOT_CONNECTED" });
    }
    const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
    const masterSheetId = String(payload.masterSheetId || "").trim();
    const companyFolderId = String(payload.companyFolderId || job.companyId || "").trim();
    const companyName = String(payload.companyName || "").trim();
    if (!deps.authIndex || typeof deps.authIndex.rebuildCompanyAuthIndexFromSheet !== "function") {
      throw new Error("Auth index is not configured.");
    }
    if (!masterSheetId && !companyFolderId) {
      throw new Error("masterSheetId or companyFolderId is required for auth index rebuild.");
    }
    const result = await deps.authIndex.rebuildCompanyAuthIndexFromSheet(auth, deps, {
      masterSheetId,
      companyFolderId,
      companyId: companyFolderId,
      companyName,
    });
    return {
      userMessage: "Sign-in index rebuilt.",
      upserted: result.upserted,
      removed: result.removed,
    };
  }

  async function runSyncPendingCompletion(job) {
    const auth = deps.getAuthedClient?.();
    if (!auth) {
      throw Object.assign(new Error("Google Workspace is not connected."), { code: "GOOGLE_NOT_CONNECTED" });
    }
    if (typeof deps.syncPendingCompletion !== "function") {
      throw new Error("Pending completion sync is not configured.");
    }
    const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
    const resultId = String(payload.resultId || "").trim();
    const outcome = await deps.syncPendingCompletion(resultId);
    if (!outcome?.ok) {
      const technicalError = String(outcome?.lastError || outcome?.technicalError || "workbook_sync_failed").trim();
      if (outcome?.retryable) {
        throw Object.assign(new Error(technicalError), { code: "GOOGLE_TIMEOUT" });
      }
      return {
        needsAttention: true,
        userMessage: "Check saved, but workbook sync needs attention.",
        technicalError,
      };
    }
    return { userMessage: "Check result synced to the company workbook." };
  }

  async function runVerifyAuthIndex(job) {
    const auth = deps.getAuthedClient?.();
    if (!auth) {
      throw Object.assign(new Error("Google Workspace is not connected."), { code: "GOOGLE_NOT_CONNECTED" });
    }
    const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
    const email = String(payload.email || job.requestedBy || "").trim().toLowerCase();
    if (!email || !deps.authIndex || typeof deps.authIndex.verifyAuthIndexEntryFromSheet !== "function") {
      throw new Error("Auth index verification requires email and configured index.");
    }
    const result = await deps.authIndex.verifyAuthIndexEntryFromSheet(auth, deps, email, {
      masterSheetId: String(payload.masterSheetId || "").trim(),
      companyFolderId: String(payload.companyFolderId || job.companyId || "").trim(),
      companyName: String(payload.companyName || "").trim(),
    });
    if (result.expired) {
      return {
        userMessage: "Sign-in index verified; inactive account removed from index.",
        expired: true,
        reason: result.reason,
      };
    }
    return { userMessage: "Sign-in index verified.", expired: false };
  }

  async function executeJob(job) {
    switch (job.type) {
      case BACKGROUND_JOB_TYPES.COMPLETE_COMPANY_SETUP:
        return runCompleteCompanySetup(job);
      case BACKGROUND_JOB_TYPES.VERIFY_COMPANY_HEALTH:
        return runVerifyCompanyHealth(job);
      case BACKGROUND_JOB_TYPES.SEND_INVITE_EMAIL:
        return runSendInviteEmail(job);
      case BACKGROUND_JOB_TYPES.SYNC_SCHEDULES:
        return runSyncSchedules(job);
      case BACKGROUND_JOB_TYPES.VERIFY_GOOGLE_CONNECTION:
        return runVerifyGoogleConnection(job);
      case BACKGROUND_JOB_TYPES.REBUILD_AUTH_INDEX:
        return runRebuildAuthIndex(job);
      case BACKGROUND_JOB_TYPES.VERIFY_AUTH_INDEX:
        return runVerifyAuthIndex(job);
      case BACKGROUND_JOB_TYPES.SYNC_PENDING_COMPLETION:
        return runSyncPendingCompletion(job);
      case BACKGROUND_JOB_TYPES.REPAIR_COMPANY_STRUCTURE:
      case BACKGROUND_JOB_TYPES.SYNC_COMPANY_USERS:
      case BACKGROUND_JOB_TYPES.GENERATE_REPORT:
        return { userMessage: `${job.type} completed (no-op stub).` };
      default:
        throw new Error(`Unhandled job type: ${job.type}`);
    }
  }

  async function processNextJob() {
    if (processing) {
      return;
    }
    processing = true;
    try {
      const store = readStore();
      const now = Date.now();
      const candidates = Object.values(store.jobs)
        .filter((job) => job.status === BACKGROUND_JOB_STATUSES.QUEUED)
        .filter((job) => {
          if (!job.nextRetryAt) {
            return true;
          }
          const retryAt = Date.parse(job.nextRetryAt);
          return !Number.isFinite(retryAt) || retryAt <= now;
        })
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

      const job = candidates[0];
      if (!job) {
        return;
      }

      updateJob(job.jobId, {
        status: BACKGROUND_JOB_STATUSES.RUNNING,
        attempts: Number(job.attempts || 0) + 1,
      });

      try {
        const outcome = await executeJob(job);
        if (outcome?.needsAttention) {
          updateJob(job.jobId, {
            status: BACKGROUND_JOB_STATUSES.NEEDS_ATTENTION,
            userMessage: outcome.userMessage || job.userMessage,
            technicalError: String(outcome.technicalError || "").trim(),
            completedAt: nowIso(),
            nextRetryAt: null,
          });
          return;
        }

        updateJob(job.jobId, {
          status: BACKGROUND_JOB_STATUSES.COMPLETED,
          userMessage: outcome?.userMessage || job.userMessage,
          technicalError: "",
          completedAt: nowIso(),
          nextRetryAt: null,
        });
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        const technicalError = error instanceof Error ? error.message : String(error);
        const retryable = isGoogleTimeoutError(error) && attempts < BACKGROUND_JOB_MAX_ATTEMPTS;

        if (retryable) {
          updateJob(job.jobId, {
            status: BACKGROUND_JOB_STATUSES.QUEUED,
            technicalError,
            nextRetryAt: computeNextRetryAt(attempts),
            attempts,
          });
          console.warn("[background-jobs] retry scheduled", {
            jobId: job.jobId,
            type: job.type,
            attempts,
            technicalError,
          });
          return;
        }

        const terminalStatus =
          attempts >= BACKGROUND_JOB_MAX_ATTEMPTS || isGoogleTimeoutError(error)
            ? BACKGROUND_JOB_STATUSES.NEEDS_ATTENTION
            : BACKGROUND_JOB_STATUSES.FAILED;

        updateJob(job.jobId, {
          status: terminalStatus,
          technicalError,
          completedAt: nowIso(),
          nextRetryAt: null,
          attempts,
        });
        console.warn("[background-jobs] job failed", {
          jobId: job.jobId,
          type: job.type,
          status: terminalStatus,
          technicalError,
        });
      }
    } finally {
      processing = false;
    }
  }

  function startProcessor() {
    if (processorTimer) {
      return;
    }
    processorTimer = setInterval(() => {
      void processNextJob();
    }, PROCESS_INTERVAL_MS);
    if (typeof processorTimer.unref === "function") {
      processorTimer.unref();
    }
    void processNextJob();
  }

  function stopProcessor() {
    if (processorTimer) {
      clearInterval(processorTimer);
      processorTimer = null;
    }
  }

  function installRoutes(app, routeDeps = {}) {
    const requireMasterOnlyActor = routeDeps.requireMasterOnlyActor;
    if (typeof requireMasterOnlyActor !== "function") {
      return;
    }

    const listHandler = (req, res) => {
      const companyId = String(req.params?.companyId || req.query?.companyId || "").trim();
      const jobs = listJobs({
        companyId,
        status: String(req.query?.status || "").trim(),
        type: String(req.query?.type || "").trim(),
        limit: Number(req.query?.limit || 100),
      });
      return res.json({ ok: true, jobs });
    };

    app.get("/api/godmode/background-jobs", requireMasterOnlyActor, listHandler);
    app.get("/api/companies/:companyId/background-jobs", requireMasterOnlyActor, listHandler);
  }

  function hasActiveJobForCompany(companyId, type) {
    const id = String(companyId || "").trim();
    if (!id) {
      return false;
    }
    const store = readStore();
    return Object.values(store.jobs).some(
      (job) =>
        String(job.companyId || "").trim() === id &&
        job.type === type &&
        (job.status === BACKGROUND_JOB_STATUSES.QUEUED || job.status === BACKGROUND_JOB_STATUSES.RUNNING),
    );
  }

  function queueCompanyHealthCheckIfReady(input = {}) {
    if (!input.autoQueue) {
      return null;
    }
    const companyId = String(input.companyId || input.workspaceId || "").trim();
    if (!companyId) {
      return null;
    }
    if (hasActiveJobForCompany(companyId, BACKGROUND_JOB_TYPES.VERIFY_COMPANY_HEALTH)) {
      return null;
    }
    return enqueueJob({
      type: BACKGROUND_JOB_TYPES.VERIFY_COMPANY_HEALTH,
      companyId,
      requestedBy: String(input.requestedBy || "system").trim(),
      userMessage: "",
      payload: input.payload && typeof input.payload === "object" ? input.payload : {},
    });
  }

  function queueCompanySetupJobs(input = {}) {
    const companyId = String(input.companyId || input.workspaceId || "").trim();
    const requestedBy = String(input.requestedBy || "").trim();
    const payload = {
      workspaceId: companyId,
      companyFolderId: String(input.companyFolderId || companyId).trim(),
      masterSheetId: String(input.masterSheetId || "").trim(),
      companyName: String(input.companyName || "").trim(),
      checks: input.checks || {},
    };

    const setupJob = enqueueJob({
      type: BACKGROUND_JOB_TYPES.COMPLETE_COMPANY_SETUP,
      companyId,
      requestedBy,
      payload,
    });
    const healthJob = enqueueJob({
      type: BACKGROUND_JOB_TYPES.VERIFY_COMPANY_HEALTH,
      companyId,
      requestedBy,
      payload,
    });
    return [setupJob, healthJob];
  }

  function queueInviteEmailJob(input = {}) {
    return enqueueJob({
      type: BACKGROUND_JOB_TYPES.SEND_INVITE_EMAIL,
      companyId: String(input.companyId || input.companyFolderId || "").trim(),
      requestedBy: String(input.requestedBy || "").trim(),
      payload: {
        toEmail: String(input.toEmail || "").trim(),
        companyName: String(input.companyName || "").trim(),
        inviteUrl: String(input.inviteUrl || "").trim(),
        tokenId: String(input.tokenId || "").trim(),
      },
    });
  }

  function queueScheduleSyncJob(input = {}) {
    const companyId = String(input.companyId || input.companyFolderId || "").trim();
    persistPendingSchedules(companyId, input);
    return enqueueJob({
      type: BACKGROUND_JOB_TYPES.SYNC_SCHEDULES,
      companyId,
      requestedBy: String(input.requestedBy || input.createdBy || "").trim(),
      payload: {
        companyFolderId: String(input.companyFolderId || companyId).trim(),
        masterSheetId: String(input.masterSheetId || "").trim(),
        schedules: Array.isArray(input.schedules) ? input.schedules : [],
        createdBy: String(input.createdBy || "").trim(),
      },
    });
  }

  function queueCompletionSyncJob(input = {}) {
    const companyId = String(input.companyId || input.companyFolderId || "").trim();
    const resultId = String(input.resultId || "").trim();
    if (!companyId || !resultId) {
      return null;
    }
    return enqueueJob({
      type: BACKGROUND_JOB_TYPES.SYNC_PENDING_COMPLETION,
      companyId,
      requestedBy: String(input.requestedBy || "").trim(),
      userMessage: "Syncing completed check to the company workbook.",
      payload: {
        resultId,
        companyFolderId: companyId,
        scheduleId: String(input.scheduleId || "").trim(),
      },
    });
  }

  return {
    enqueueJob,
    getJob,
    listJobs,
    updateJob,
    persistPendingSchedules,
    readPendingSchedules,
    queueCompanySetupJobs,
    queueCompanyHealthCheckIfReady,
    queueInviteEmailJob,
    queueScheduleSyncJob,
    queueCompletionSyncJob,
    processNextJob,
    startProcessor,
    stopProcessor,
    installRoutes,
  };
}

export { BACKGROUND_JOB_TYPES, BACKGROUND_JOB_STATUSES };
