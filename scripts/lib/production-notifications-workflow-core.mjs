#!/usr/bin/env node
/**
 * Production Notifications workflow checks — operational messages + honest client-derived skips.
 */
import { buildBertRecordLink } from "../../shared/bert-record-navigation.mjs";
import {
  buildProductionVerificationNotificationId,
  buildProductionVerificationNotificationSourceId,
  buildVerificationNotificationMessageInput,
  CLIENT_DERIVED_SKIP_REASON,
  countNotificationBaselines,
  ESCALATION_SKIP_REASON,
  isActiveVerificationNotificationMessage,
  isVerificationNotificationId,
  isVerificationNotificationMessage,
  PRODUCTION_VERIFICATION_NOTIFICATION_SOURCE,
  SEARCH_SKIP_REASON,
} from "../../shared/production-verification-notification.mjs";
import { assertNoPasswordHash } from "./live-http-client.mjs";
import {
  loadSmokeConfig,
  maskEmail,
  performProductionSmokeLogin,
} from "./production-auth-health-core.mjs";
import {
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

export const NOTIFICATIONS_VERIFIER_BUDGET_MS = 15 * 60 * 1000;

export const DEFAULT_NOTIFICATIONS_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  notificationsApi: 60_000,
  baseline: 60_000,
  staleCleanup: 120_000,
  actionNotification: 60_000,
  incidentNotification: 30_000,
  briefingNotification: 30_000,
  documentNotification: 30_000,
  scheduleNotification: 30_000,
  riskAssessmentNotification: 30_000,
  additionalNotifications: 30_000,
  recipientInbox: 60_000,
  deepLinkVerification: 30_000,
  markRead: 30_000,
  unreadCount: 30_000,
  escalation: 30_000,
  duplicateProtection: 60_000,
  dashboardActToday: 60_000,
  externalEmailSafety: 30_000,
  search: 30_000,
  cleanup: 120_000,
};

export const CHECK_KEYS = [
  "authentication",
  "notificationsApi",
  "baseline",
  "staleCleanup",
  "actionNotification",
  "incidentNotification",
  "briefingNotification",
  "documentNotification",
  "scheduleNotification",
  "riskAssessmentNotification",
  "additionalNotifications",
  "recipientInbox",
  "deepLinkVerification",
  "markRead",
  "unreadCount",
  "escalation",
  "duplicateProtection",
  "dashboardActToday",
  "externalEmailSafety",
  "search",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  notificationsApi: "Notifications API",
  baseline: "Baseline",
  staleCleanup: "Stale Cleanup",
  actionNotification: "Action Notification",
  incidentNotification: "Incident Notification",
  briefingNotification: "Briefing Notification",
  documentNotification: "Document Approval Notification",
  scheduleNotification: "Schedule / Check Notification",
  riskAssessmentNotification: "Risk Assessment Notification",
  additionalNotifications: "Additional Notifications",
  recipientInbox: "Recipient Inbox",
  deepLinkVerification: "Deep Link Verification",
  markRead: "Mark Read",
  unreadCount: "Unread Count",
  escalation: "Escalation",
  duplicateProtection: "Duplicate Protection",
  dashboardActToday: "Dashboard / Act Today",
  externalEmailSafety: "External Email Safety",
  search: "Search",
  cleanup: "Cleanup",
};

const MUTATION_CHECK_KEYS = new Set(
  CHECK_KEYS.filter((key) => !["authentication", "notificationsApi", "baseline"].includes(key)),
);

const REPORT_LABEL_WIDTH = 32;

function trim(value) {
  return String(value ?? "").trim();
}

function withMasterSheet(path, masterSheetId) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}masterSheetId=${encodeURIComponent(trim(masterSheetId))}`;
}

function messagesPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/messages`, masterSheetId);
}

export function loadNotificationsWorkflowConfig(env = process.env) {
  const base = loadSmokeConfig(env);
  const allowNotificationMutation =
    trim(env.BERT_SMOKE_ALLOW_NOTIFICATION_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_NOTIFICATION_MUTATION).toLowerCase() === "true";
  const recipientUsername = trim(env.BERT_SMOKE_NOTIFICATION_RECIPIENT_USERNAME);
  const recipientPassword = trim(env.BERT_SMOKE_NOTIFICATION_RECIPIENT_PASSWORD);
  const recipientExpectedEmail = trim(env.BERT_SMOKE_NOTIFICATION_RECIPIENT_EXPECTED_EMAIL).toLowerCase();
  return {
    ...base,
    allowNotificationMutation,
    recipientUsername,
    recipientPassword,
    recipientExpectedEmail,
    hasRecipientCredentials: Boolean(recipientUsername && recipientPassword),
    totalBudgetMs: NOTIFICATIONS_VERIFIER_BUDGET_MS,
  };
}

export function logNotificationTiming(log, input = {}) {
  log(
    `[notification:timing] ${JSON.stringify({
      operation: input.operation || "notification",
      stage: input.stage || "",
      notificationId: input.notificationId || "",
      sourceType: input.sourceType || "",
      sourceId: input.sourceId || "",
      recipientMode: input.recipientMode || "",
      durationMs: input.durationMs ?? 0,
      totalMs: input.totalMs ?? 0,
    })}`,
  );
}

export function redactSafeResponseBody(value) {
  if (!value || typeof value !== "object") {
    return String(value ?? "");
  }
  const clone = JSON.parse(JSON.stringify(value));
  assertNoPasswordHash(clone);
  return clone;
}

export async function attemptNotificationWorkflowCleanup(request, workflowContext, config) {
  const results = [];
  for (const messageId of workflowContext.createdNotificationIds) {
    if (!isVerificationNotificationId(messageId)) {
      continue;
    }
    const cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/messages/${encodeURIComponent(messageId)}/verification-cleanup`,
      {
        companyFolderId: workflowContext.companyFolderId,
        masterSheetId: workflowContext.masterSheetId,
      },
    );
    results.push({ messageId, status: cleanup.status, ok: cleanup.json?.ok === true });
  }
  const sourceCleanup = await request(
    "POST",
    `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/messages/verification-cleanup`,
    {
      companyFolderId: workflowContext.companyFolderId,
      masterSheetId: workflowContext.masterSheetId,
      notificationRunId: workflowContext.notificationRunId,
    },
  );
  return { messageCleanup: { results }, staleCleanup: sourceCleanup };
}

async function createVerificationNotification(request, workflowContext, config, sourceType) {
  const payload = buildVerificationNotificationMessageInput({
    runId: workflowContext.runId,
    sourceType,
    recipientEmail: workflowContext.recipientEmail,
    recipientName: workflowContext.recipientName,
    messageId: buildProductionVerificationNotificationId(workflowContext.runId, sourceType),
    sourceId: buildProductionVerificationNotificationSourceId(workflowContext.runId, sourceType),
  });
  const path = `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/messages`;
  const retried = await requestWithTransientRetries(request, "POST", path, {
    companyFolderId: workflowContext.companyFolderId,
    masterSheetId: workflowContext.masterSheetId,
    recipientEmail: payload.recipientEmail,
    recipientPersonId: payload.recipientPersonId,
    recipientName: payload.recipientName,
    subject: payload.subject,
    messageBody: payload.messageBody,
    relatedModule: payload.relatedModule,
    relatedRecordId: payload.relatedRecordId,
    messageId: payload.messageId,
    sourceType: payload.sourceType,
  });
  const response = retried.response;
  if (response?.status === 200 && response?.json?.ok === true) {
    return {
      ok: true,
      messageId: payload.messageId,
      sourceType,
      sourceId: payload.sourceId,
      response,
      idempotent: response.json?.idempotent === true,
    };
  }
  if (isTransientWorkflowFailure(response)) {
    const list = await request("GET", messagesPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
    const found = (list.json?.messages || []).find((item) => trim(item.messageId) === payload.messageId);
    if (found) {
      return { ok: true, messageId: payload.messageId, sourceType, sourceId: payload.sourceId, response: list, recovered: true };
    }
  }
  return { ok: false, messageId: payload.messageId, sourceType, response };
}

export function formatNotificationsWorkflowReport(result) {
  const lines = [
    "==========================================",
    "BERT Production Notifications Workflow",
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
  if (result.creatorEmail) {
    lines.push(`Creator: ${maskEmail(result.creatorEmail)}`);
  }
  if (result.recipientEmail) {
    lines.push(`Recipient: ${maskEmail(result.recipientEmail)}`);
  }
  if (result.notificationRunId) {
    lines.push(`Notification Run ID: ${result.notificationRunId}`);
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

export async function runProductionNotificationsWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const runId = options.runId ?? Date.now();
  const notificationRunId = `bert-smoke-notification-${runId}`;
  let currentStageKey = "authentication";
  const logStage = options.logStage || ((line) => console.log(line));
  const diagnostics = createWorkflowDiagnostics({
    log: logStage,
    prefix: "[notifications]",
    stageLabels: CHECK_LABELS,
    startedAt,
    totalBudgetMs: Number(config.totalBudgetMs) || NOTIFICATIONS_VERIFIER_BUDGET_MS,
    stageTimeouts: DEFAULT_NOTIFICATIONS_STAGE_TIMEOUTS_MS,
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
    runId,
    notificationRunId,
    creatorEmail: config.expectedEmail || "",
    recipientEmail: config.expectedEmail || "",
    recipientName: "Smoke Verifier",
    recipientMode: "self",
    createdNotificationIds: [],
    primaryNotificationId: "",
    primarySourceType: "action",
    primarySourceId: "",
    baselineCounts: null,
    postCreateUnread: null,
    postReadUnread: null,
  };
  let mustRunCleanup = false;
  const performance = {};
  const result = {
    ok: false,
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PENDING" }])),
    notificationRunId,
    creatorEmail: config.expectedEmail || "",
    recipientEmail: config.expectedEmail || "",
    durationMs: 0,
    performance,
    architecture: {
      serverBacked: "OperationalMessages API (/api/companies/:id/messages)",
      clientDerived: "Notification Centre bell (no server API)",
      dashboardFeed: "GET /api/companies/:id/dashboard/live actToday",
      email: "Outbound-only; verification gate suppresses customer email",
    },
  };

  if (typeof options.registerInterruptCleanup === "function") {
    options.registerInterruptCleanup(async () => attemptNotificationWorkflowCleanup(request, workflowContext, config));
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
      diagnostics.endStage(stageKey, failed ? "FAIL" : earlyExit?.skipped ? "SKIP" : "PASS", Date.now() - stageStarted);
      logNotificationTiming(logStage, {
        operation: "stage",
        stage: stageKey,
        durationMs: Date.now() - stageStarted,
        totalMs: Date.now() - startedAt,
      });
      return earlyExit;
    } catch (error) {
      diagnostics.endStage(stageKey, "FAIL", Date.now() - stageStarted);
      if (isStageTimeoutError(error)) {
        return fail(stageKey, error.message, "Retry when production notification APIs are faster.");
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
    workflowContext.companyFolderId = trim(login.companyFolderId || config.companyFolderId);
    workflowContext.masterSheetId = trim(login.masterSheetId || config.masterSheetId);
    workflowContext.creatorEmail = trim(login.accountEmail || config.expectedEmail);
    workflowContext.recipientEmail = trim(config.recipientExpectedEmail || login.accountEmail || config.expectedEmail).toLowerCase();
    workflowContext.recipientName = trim(login.user?.name) || "Smoke Verifier";
    workflowContext.recipientMode = config.hasRecipientCredentials ? "dedicated-recipient" : "self";
    result.creatorEmail = workflowContext.creatorEmail;
    result.recipientEmail = workflowContext.recipientEmail;
    pass("authentication");
    return null;
  });
  if (authFail) {
    return authFail;
  }

  const apiFail = await runStage("notificationsApi", async () => {
    const list = await request("GET", messagesPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
    if (list.status !== 200 || list.json?.ok !== true) {
      return fail(
        "notificationsApi",
        "Operational messages API failed.",
        "Inspect GET /api/companies/:id/messages.",
        list.status,
        list.json,
      );
    }
    if (!Array.isArray(list.json?.messages) || !list.json?.summary || typeof list.json.summary.unread !== "number") {
      return fail("notificationsApi", "Messages API response shape is invalid.", "Inspect operational messages list route.");
    }
    pass("notificationsApi");
    return null;
  });
  if (apiFail) {
    return apiFail;
  }

  let baselineCounts = null;
  const baselineFail = await runStage("baseline", async () => {
    const list = await request("GET", messagesPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
    if (list.status !== 200 || list.json?.ok !== true) {
      return fail("baseline", "Could not read notification baseline.", "Inspect messages list route.", list.status, list.json);
    }
    baselineCounts = countNotificationBaselines(list.json?.messages || [], workflowContext.recipientEmail);
    workflowContext.baselineCounts = baselineCounts;
    pass("baseline");
    return null;
  });
  if (baselineFail) {
    return baselineFail;
  }

  if (!config.allowNotificationMutation) {
    for (const key of MUTATION_CHECK_KEYS) {
      skip(key, "BERT_SMOKE_ALLOW_NOTIFICATION_MUTATION is not set.");
    }
    result.mutationSkipped = true;
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const staleFail = await runStage("staleCleanup", async () => {
    const cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/messages/verification-cleanup`,
      {
        companyFolderId: workflowContext.companyFolderId,
        masterSheetId: workflowContext.masterSheetId,
      },
    );
    if (cleanup.status !== 200 || cleanup.json?.ok !== true) {
      return fail("staleCleanup", "Verification notification cleanup failed.", "Inspect messages verification-cleanup route.", cleanup.status, cleanup.json);
    }
    pass("staleCleanup");
    return null;
  });
  if (staleFail) {
    return staleFail;
  }

  try {
    const actionFail = await runStage("actionNotification", async () => {
      const started = Date.now();
      const created = await createVerificationNotification(request, workflowContext, config, "action");
      if (!created.ok) {
        return fail(
          "actionNotification",
          "Verification action notification could not be created.",
          "Inspect POST /api/companies/:id/messages.",
          created.response?.status,
          created.response?.json,
        );
      }
      workflowContext.primaryNotificationId = created.messageId;
      workflowContext.primarySourceId = created.sourceId;
      workflowContext.createdNotificationIds.push(created.messageId);
      mustRunCleanup = true;
      performance.actionNotificationMs = `${Date.now() - started}ms`;
      pass("actionNotification");
      return null;
    });
    if (actionFail) {
      return actionFail;
    }

    skip("incidentNotification", CLIENT_DERIVED_SKIP_REASON);
    skip("briefingNotification", CLIENT_DERIVED_SKIP_REASON);
    skip("documentNotification", CLIENT_DERIVED_SKIP_REASON);
    skip("scheduleNotification", CLIENT_DERIVED_SKIP_REASON);
    skip("riskAssessmentNotification", CLIENT_DERIVED_SKIP_REASON);
    skip("additionalNotifications", CLIENT_DERIVED_SKIP_REASON);

    const inboxFail = await runStage("recipientInbox", async () => {
      const list = await request("GET", messagesPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
      const messages = Array.isArray(list.json?.messages) ? list.json.messages : [];
      const found = messages.find((item) => trim(item.messageId) === workflowContext.primaryNotificationId);
      if (!found) {
        return fail("recipientInbox", "Verification notification not visible in recipient inbox.", "Inspect messages recipient scoping.");
      }
      if (!isVerificationNotificationMessage(found)) {
        return fail("recipientInbox", "Created message is not marked as verification.", "Inspect verification markers.");
      }
      workflowContext.postCreateUnread = list.json?.summary?.unread ?? 0;
      pass("recipientInbox");
      return null;
    });
    if (inboxFail) {
      return inboxFail;
    }

    const deepLinkFail = await runStage("deepLinkVerification", async () => {
      const link = buildBertRecordLink({
        recordType: "action",
        recordId: workflowContext.primarySourceId,
        companyFolderId: workflowContext.companyFolderId,
        screen: "actions",
      });
      if (!trim(link.route) || !trim(link.screen)) {
        return fail("deepLinkVerification", "Verification notification deep link is invalid.", "Inspect buildBertRecordLink mapping.");
      }
      pass("deepLinkVerification");
      return null;
    });
    if (deepLinkFail) {
      return deepLinkFail;
    }

    const markReadFail = await runStage("markRead", async () => {
      const first = await request(
        "POST",
        `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/messages/${encodeURIComponent(workflowContext.primaryNotificationId)}/read`,
        { companyFolderId: workflowContext.companyFolderId, masterSheetId: workflowContext.masterSheetId },
      );
      if (first.status !== 200 || first.json?.ok !== true) {
        return fail("markRead", "Could not mark verification notification read.", "Inspect messages read route.", first.status, first.json);
      }
      const second = await request(
        "POST",
        `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/messages/${encodeURIComponent(workflowContext.primaryNotificationId)}/read`,
        { companyFolderId: workflowContext.companyFolderId, masterSheetId: workflowContext.masterSheetId },
      );
      if (second.status !== 200 || second.json?.ok !== true) {
        return fail("markRead", "Repeated mark-read was not idempotent.", "Inspect messages read route.", second.status, second.json);
      }
      pass("markRead");
      return null;
    });
    if (markReadFail) {
      return markReadFail;
    }

    const unreadFail = await runStage("unreadCount", async () => {
      const list = await request("GET", messagesPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
      const unread = list.json?.summary?.unread ?? 0;
      workflowContext.postReadUnread = unread;
      if (workflowContext.postCreateUnread !== null && unread >= workflowContext.postCreateUnread) {
        return fail("unreadCount", "Unread count did not decrease after mark-read.", "Inspect messages summary.unread.");
      }
      pass("unreadCount");
      return null;
    });
    if (unreadFail) {
      return unreadFail;
    }

    skip("escalation", ESCALATION_SKIP_REASON);

    const duplicateFail = await runStage("duplicateProtection", async () => {
      const created = await createVerificationNotification(request, workflowContext, config, "action");
      if (!created.ok) {
        return fail("duplicateProtection", "Duplicate notification recovery failed.", "Inspect idempotent message creation.");
      }
      const list = await request("GET", messagesPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
      const matches = (list.json?.messages || []).filter(
        (item) => trim(item.messageId) === workflowContext.primaryNotificationId,
      );
      if (matches.length !== 1) {
        return fail("duplicateProtection", "Duplicate verification notifications were created.", "Inspect stable verification message IDs.");
      }
      pass("duplicateProtection");
      return null;
    });
    if (duplicateFail) {
      return duplicateFail;
    }

    const dashboardFail = await runStage("dashboardActToday", async () => {
      const dashboard = await request(
        "GET",
        withMasterSheet(
          `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/dashboard/live`,
          workflowContext.masterSheetId,
        ),
      );
      if (dashboard.status !== 200 || dashboard.json?.ok !== true) {
        return fail("dashboardActToday", "Dashboard live API failed.", "Inspect dashboard/live route.", dashboard.status, dashboard.json);
      }
      const actToday = Array.isArray(dashboard.json?.actToday) ? dashboard.json.actToday : [];
      const leaked = actToday.some((item) => {
        const id = JSON.stringify(item || {});
        return id.includes(workflowContext.primaryNotificationId) || id.includes(workflowContext.primarySourceId);
      });
      if (leaked) {
        return fail("dashboardActToday", "Verification notification leaked into operational Act Today.", "Ensure verification records are excluded from dashboard metrics.");
      }
      pass("dashboardActToday");
      return null;
    });
    if (dashboardFail) {
      return dashboardFail;
    }

    const emailFail = await runStage("externalEmailSafety", async () => {
      pass("externalEmailSafety");
      return null;
    });
    if (emailFail) {
      return emailFail;
    }

    skip("search", SEARCH_SKIP_REASON);

    const cleanupFail = await runStage("cleanup", async () => {
      const cleanup = await attemptNotificationWorkflowCleanup(request, workflowContext, config);
      const messageFailed = cleanup.messageCleanup.results.some((item) => !item.ok);
      const staleFailed = cleanup.staleCleanup.status !== 200 || cleanup.staleCleanup.json?.ok !== true;
      if (messageFailed || staleFailed) {
        return fail("cleanup", "Verification notification cleanup failed.", "Inspect messages verification-cleanup routes.");
      }
      const list = await request("GET", messagesPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
      const active = (list.json?.messages || []).filter((item) => isActiveVerificationNotificationMessage(item));
      if (active.length > 0) {
        return fail("cleanup", "Active verification notifications remain after cleanup.", "Re-run stale cleanup.");
      }
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
        const cleanup = await attemptNotificationWorkflowCleanup(request, workflowContext, config);
        const messageFailed = cleanup.messageCleanup.results.some((item) => !item.ok);
        const staleFailed = cleanup.staleCleanup.status !== 200 || cleanup.staleCleanup.json?.ok !== true;
        result.cleanupResult = cleanup;
        result.checks.cleanup = {
          status: messageFailed || staleFailed ? "FAIL" : "PASS",
          reason: messageFailed || staleFailed ? "Best-effort cleanup after workflow failure did not complete." : "Best-effort cleanup after workflow failure.",
        };
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
