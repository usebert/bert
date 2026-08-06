/**
 * Shared mock HTTP transport for Briefing / Toolbox Talk workflow unit tests.
 */
import { COMPANY_SESSION_COOKIE } from "./production-auth-health-core.mjs";
import { DEFAULT_BRIEFING_VERIFICATION_PROFILE } from "./production-briefing-workflow-core.mjs";
import {
  isActiveVerificationBriefing,
  isVerificationBriefing,
  PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_BRIEFING_SIGNATURE_NAME,
} from "../../shared/production-verification-briefing.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeStatus(value) {
  return trim(value).toLowerCase();
}

function customerBriefing() {
  return {
    briefingId: "briefing-customer-1",
    title: "Weekly safety update",
    type: "Safety",
    status: "Sent",
    message: "Customer briefing for assembly team",
    verificationSource: "",
    targetUserEmails: "worker@example.com",
    requiresRead: true,
    requiresAcknowledgement: true,
    requiresSignature: false,
    recipients: [],
  };
}

function toTrackerItem(briefing) {
  return {
    briefingId: briefing.briefingId,
    title: briefing.title,
    type: briefing.type,
    status: briefing.status,
    message: briefing.message,
    verificationSource: briefing.verificationSource || "",
    targetUserEmails: briefing.targetUserEmails || "",
    requiresRead: briefing.requiresRead !== false,
    requiresAcknowledgement: briefing.requiresAcknowledgement !== false,
    requiresSignature: briefing.requiresSignature !== false,
    recipients: Array.isArray(briefing.recipients) ? briefing.recipients : [],
  };
}

function successLoginJson(config) {
  return {
    ok: true,
    user: {
      email: config.expectedEmail,
      role: "Admin",
      name: "Mr Important",
      companyFolderId: config.companyFolderId,
    },
    company: {
      companyFolderId: config.companyFolderId,
      companyName: "Dovecote Demo",
      live: true,
    },
    masterSheetId: config.masterSheetId,
  };
}

export function createBriefingWorkflowMockTransport(config, options = {}) {
  const profile = options.verificationProfile || DEFAULT_BRIEFING_VERIFICATION_PROFILE;
  const cookies = new Map();
  const runId = options.runId ?? 12345;
  const verificationBriefingId = profile.buildId(runId);
  const verificationTemplate = profile.buildPayload({
    runId,
    briefingId: verificationBriefingId,
    createdByEmail: config.expectedEmail,
    createdByName: "Mr Important",
    requiresSignature: options.requiresSignature !== false,
  });
  const recipientEmail = trim(config.expectedEmail).toLowerCase();

  let briefings = options.initialBriefings
    ? [...options.initialBriefings]
    : [customerBriefing()];
  const briefingStore = new Map();
  for (const item of briefings) {
    briefingStore.set(item.briefingId, { ...item });
  }

  let mineItems = [];
  let loginAttempts = 0;
  let recipientLoginAttempts = 0;
  let createAttempts = 0;
  let publishAttempts = 0;
  let readAttempts = 0;
  let acknowledgeAttempts = 0;
  let signAttempts = 0;
  let cleanupAttempts = 0;
  let create502Attempts = 0;
  let suppressVerificationInListCount = options.listStaleUntilAttempt || 0;
  let baselinePendingBriefings = options.baselinePendingBriefings ?? 0;

  function getBriefing(briefingId) {
    return briefingStore.get(briefingId) || null;
  }

  function upsertBriefing(record) {
    briefingStore.set(record.briefingId, { ...record });
    const listEntry = toTrackerItem(record);
    const idx = briefings.findIndex((item) => item.briefingId === record.briefingId);
    if (idx >= 0) {
      briefings[idx] = listEntry;
    } else {
      briefings.push(listEntry);
    }
  }

  function syncRecipientViews(briefingId) {
    const briefing = getBriefing(briefingId);
    if (!briefing) {
      return;
    }
    const recipients = (Array.isArray(briefing.recipients) ? briefing.recipients : []).map((recipient) => {
      const needsAction =
        options.completionMismatch && briefingId === verificationBriefingId
          ? true
          : computeNeedsAction(recipient, briefing);
      let status = trim(recipient.status) || "New";
      if (!needsAction) {
        if (recipient.signedAt) {
          status = "Signed";
        } else if (recipient.acknowledgedAt) {
          status = "Acknowledged";
        } else if (recipient.readAt) {
          status = "Read";
        } else {
          status = "Complete";
        }
      }
      return {
        ...recipient,
        needsAction,
        status,
      };
    });
    upsertBriefing({ ...briefing, recipients });
    mineItems = recipients.map((recipient) => ({
      briefingId,
      recipientEmail: recipient.recipientEmail,
      email: recipient.recipientEmail,
      readAt: recipient.readAt || "",
      acknowledgedAt: recipient.acknowledgedAt || "",
      signedAt: recipient.signedAt || "",
      needsAction: recipient.needsAction,
      briefing: {
        requiresRead: briefing.requiresRead !== false,
        requiresAcknowledgement: briefing.requiresAcknowledgement !== false,
        requiresSignature: briefing.requiresSignature !== false,
      },
    }));
  }

  function computeNeedsAction(recipient, briefing) {
    if (briefing.requiresRead && !recipient.readAt) {
      return true;
    }
    if (briefing.requiresAcknowledgement && !recipient.acknowledgedAt) {
      return true;
    }
    if (briefing.requiresSignature && !recipient.signedAt) {
      return true;
    }
    return false;
  }

  function listBriefingsForResponse() {
    let items = briefings.map((item) => {
      const stored = getBriefing(item.briefingId) || item;
      return toTrackerItem(stored);
    });
    if (suppressVerificationInListCount > 0) {
      suppressVerificationInListCount -= 1;
      items = items.filter((item) => item.briefingId !== verificationBriefingId);
    }
    if (options.hideCleanedVerificationInList === true) {
      items = items.filter(
        (item) =>
          !(
            isVerificationBriefing(item) &&
            normalizeStatus(item.status) === PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS
          ),
      );
    }
    return items;
  }

  function dashboardPayload(includeVerification = false) {
    const verificationItem = getBriefing(verificationBriefingId);
    const pendingBriefings = [];
    if (includeVerification && verificationItem) {
      const recipient = (verificationItem.recipients || [])[0];
      pendingBriefings.push({
        id: `${verificationBriefingId}::${recipient?.recipientEmail || recipientEmail}`,
        title: verificationItem.title,
        subtitle: recipient?.recipientEmail || recipientEmail,
        owner: recipient?.recipientEmail || recipientEmail,
      });
    }
    const actToday =
      includeVerification && verificationItem
        ? [{ id: `briefing-${verificationBriefingId}`, type: "briefing" }]
        : [];
    const pendingCount = includeVerification
      ? baselinePendingBriefings + 1
      : baselinePendingBriefings;
    return {
      ok: true,
      metrics: {
        pendingBriefings: pendingCount,
        openActions: 1,
        currentIncidents: 1,
      },
      actToday,
      pendingBriefings,
    };
  }

  const request = async (method, path, body, requestOptions = {}) => {
    const pathname = (path.split("?")[0] || path).replace(/\/$/, "");
    const companyBase = `/api/companies/${encodeURIComponent(config.companyFolderId)}/briefings`;

    if (method === "GET" && pathname === "/api/health") {
      return {
        status: 200,
        json: { ok: true, version: "2026.08.01", gitSha: "abc123def456", shortSha: "abc123d" },
      };
    }

    if (method === "POST" && pathname === "/api/auth/company/login") {
      loginAttempts += 1;
      if (options.loginFails) {
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      if (options.recipientLoginFails && loginAttempts > 1) {
        recipientLoginAttempts += 1;
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
      const email =
        loginAttempts > 1 && options.recipientExpectedEmail
          ? options.recipientExpectedEmail
          : config.expectedEmail;
      return {
        status: 200,
        json: {
          ...successLoginJson(config),
          user: { ...successLoginJson(config).user, email },
        },
      };
    }

    if (method === "GET" && pathname === "/api/auth/company/session") {
      return {
        status: 200,
        json: {
          ok: true,
          user: { email: config.expectedEmail, role: "Admin" },
          company: { companyFolderId: config.companyFolderId },
        },
      };
    }

    if (method === "GET" && pathname === `${companyBase}/tracker`) {
      if (options.briefingsResponse) {
        return options.briefingsResponse();
      }
      return {
        status: options.briefingsUnavailable ? 503 : 200,
        json: options.briefingsUnavailable
          ? { ok: false, code: "BRIEFINGS_UNAVAILABLE" }
          : {
              ok: true,
              items: listBriefingsForResponse(),
              companyFolderId: config.companyFolderId,
            },
      };
    }

    if (method === "GET" && (pathname === `${companyBase}/mine` || pathname.startsWith(`${companyBase}/todo`))) {
      if (options.mineUnavailable) {
        return { status: 503, json: { ok: false, code: "BRIEFINGS_MINE_UNAVAILABLE" } };
      }
      if (options.todoMissingBriefing) {
        return { status: 200, json: { ok: true, items: [] } };
      }
      return { status: 200, json: { ok: true, items: [...mineItems] } };
    }

    if (
      method === "POST" &&
      pathname === `${companyBase}/verification-cleanup` &&
      !pathname.includes(verificationBriefingId)
    ) {
      if (!options.staleCleanupNoOp) {
        for (const [briefingId, record] of briefingStore.entries()) {
          if (
            isVerificationBriefing(record) &&
            isActiveVerificationBriefing(record) &&
            briefingId !== verificationBriefingId
          ) {
            upsertBriefing({
              ...record,
              status: PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS,
            });
          }
        }
      }
      return {
        status: 200,
        json: {
          ok: true,
          cleanedCount: options.staleCleanupNoOp ? 0 : 1,
          results: [{ briefingId: verificationBriefingId, ok: true }],
        },
      };
    }

    if (method === "POST" && pathname === companyBase) {
      createAttempts += 1;
      if (options.createResponse) {
        return options.createResponse(body);
      }
      if (options.createFails) {
        return { status: 500, json: { ok: false, code: "BRIEFING_CREATE_FAILED" } };
      }
      if (options.create502Once && create502Attempts === 0) {
        create502Attempts += 1;
        const requestedId = trim(body?.briefingId) || verificationBriefingId;
        if (!getBriefing(requestedId)) {
          const created = {
            ...verificationTemplate,
            ...body,
            briefingId: requestedId,
            status: "Draft",
            recipients: [],
          };
          upsertBriefing(created);
        }
        return { status: 502, json: null };
      }
      const requestedId = trim(body?.briefingId) || verificationBriefingId;
      const existing = getBriefing(requestedId);
      if (existing) {
        return {
          status: 200,
          json: {
            ok: true,
            alreadyExists: true,
            briefingId: existing.briefingId,
            briefing: existing,
            updatedRows: 0,
          },
        };
      }
      if (options.createSuccessButNotVisible) {
        return {
          status: 200,
          json: { ok: true, briefingId: requestedId, updatedRows: 1 },
        };
      }
      const created = {
        ...verificationTemplate,
        ...body,
        briefingId: requestedId,
        status: "Draft",
        recipients: [],
      };
      upsertBriefing(created);
      suppressVerificationInListCount = Number(options.listStaleUntilAttempt) || 0;
      return {
        status: 200,
        json: { ok: true, briefingId: requestedId, updatedRows: 1, briefing: created },
      };
    }

    if (method === "PATCH" && pathname.startsWith(`${companyBase}/`)) {
      const briefingId = decodeURIComponent(pathname.slice(`${companyBase}/`.length));
      const current = getBriefing(briefingId);
      if (!current) {
        return { status: 404, json: { ok: false, code: "BRIEFING_NOT_FOUND" } };
      }
      if (options.editFails && trim(body?.title || "").includes("(edited)")) {
        return { status: 500, json: { ok: false, code: "BRIEFING_PATCH_FAILED" } };
      }
      const updated = {
        ...current,
        title: body?.title !== undefined ? body.title : current.title,
        message: body?.message !== undefined ? body.message : current.message,
        updatedAt: new Date().toISOString(),
      };
      upsertBriefing(updated);
      return { status: 200, json: { ok: true, briefingId, briefing: updated, updatedRows: 1 } };
    }

    if (method === "POST" && pathname.endsWith("/recipients")) {
      const briefingId = decodeURIComponent(pathname.split("/briefings/")[1]?.replace(/\/recipients$/, "") || "");
      const current = getBriefing(briefingId);
      if (!current) {
        return { status: 404, json: { ok: false, code: "BRIEFING_NOT_FOUND" } };
      }
      const targetEmails = (body?.targetUserEmails || []).map((entry) => trim(entry).toLowerCase()).filter(Boolean);
      if (options.broadRecipients || targetEmails.length > 3) {
        return {
          status: 403,
          json: { ok: false, code: "BRIEFING_RECIPIENTS_TOO_BROAD", error: "Verification briefings cannot assign broad recipient groups." },
        };
      }
      if (options.recipientMissing) {
        return {
          status: 404,
          json: { ok: false, code: "BRIEFING_RECIPIENT_NOT_FOUND", error: "Recipient not found." },
        };
      }
      const existingEmails = trim(current.targetUserEmails || "")
        .split(",")
        .map((entry) => trim(entry).toLowerCase())
        .filter(Boolean);
      if (options.duplicateRecipients && existingEmails.length > 0) {
        const allPresent = targetEmails.every((email) => existingEmails.includes(email));
        if (!allPresent) {
          return {
            status: 409,
            json: { ok: false, code: "BRIEFING_RECIPIENT_DUPLICATE", error: "Recipient assignment already exists for this briefing." },
          };
        }
      }
      const existingRecipientEmails = (current.recipients || []).map((entry) => trim(entry.recipientEmail).toLowerCase());
      if (options.duplicateRecipients && existingRecipientEmails.length > 0) {
        const allPresent = targetEmails.every((email) => existingRecipientEmails.includes(email));
        if (!allPresent) {
          return {
            status: 409,
            json: { ok: false, code: "BRIEFING_RECIPIENT_DUPLICATE", error: "Recipient assignment already exists for this briefing." },
          };
        }
      }
      const updated = {
        ...current,
        targetUserEmails: targetEmails.join(", "),
        recipients: targetEmails.map((email) => ({
          recipientEmail: email,
          status: "Assigned",
          needsAction: true,
        })),
      };
      upsertBriefing(updated);
      syncRecipientViews(briefingId);
      return { status: 200, json: { ok: true, briefingId, recipientCount: targetEmails.length, updatedRows: 1 } };
    }

    if (method === "POST" && pathname.endsWith("/publish")) {
      publishAttempts += 1;
      const briefingId = decodeURIComponent(pathname.split("/briefings/")[1]?.replace(/\/publish$/, "") || "");
      const current = getBriefing(briefingId);
      if (!current) {
        return { status: 404, json: { ok: false, code: "BRIEFING_NOT_FOUND" } };
      }
      if (options.publishFails && publishAttempts === 1) {
        return { status: 500, json: { ok: false, code: "BRIEFING_PUBLISH_FAILED" } };
      }
      const publishedStatus = normalizeStatus(current.status);
      if (publishedStatus === "sent" || publishedStatus === "active" || publishedStatus === "published") {
        return {
          status: 200,
          json: { ok: true, alreadyPublished: true, briefingId, briefing: current, updatedRows: 0 },
        };
      }
      const sentAt = new Date().toISOString();
      const recipients = (current.targetUserEmails || "")
        .split(",")
        .map((entry) => trim(entry).toLowerCase())
        .filter(Boolean)
        .map((email) => ({
          recipientEmail: email,
          recipientName: "Mr Important",
          status: "New",
          sentAt,
          needsAction: true,
        }));
      const published = {
        ...current,
        status: "Sent",
        sentAt,
        recipients,
      };
      upsertBriefing(published);
      if (!options.todoMissingBriefing) {
        syncRecipientViews(briefingId);
      } else {
        mineItems = [];
      }
      return { status: 200, json: { ok: true, briefingId, briefing: published, updatedRows: 1 + recipients.length } };
    }

    if (method === "POST" && pathname.endsWith("/read")) {
      readAttempts += 1;
      const briefingId = decodeURIComponent(pathname.split("/briefings/")[1]?.replace(/\/read$/, "") || "");
      if (options.readFails && readAttempts === 1) {
        return { status: 500, json: { ok: false, code: "BRIEFING_READ_FAILED" } };
      }
      const current = getBriefing(briefingId);
      if (!current) {
        return { status: 404, json: { ok: false, code: "BRIEFING_NOT_FOUND" } };
      }
      const recipients = (current.recipients || []).map((recipient) => {
        if (trim(recipient.recipientEmail).toLowerCase() !== recipientEmail) {
          return recipient;
        }
        if (recipient.readAt) {
          return recipient;
        }
        return { ...recipient, readAt: new Date().toISOString(), status: "Read" };
      });
      const updated = { ...current, recipients };
      upsertBriefing(updated);
      syncRecipientViews(briefingId);
      return {
        status: 200,
        json: {
          ok: true,
          unchanged: readAttempts > 1,
          briefingId,
        },
      };
    }

    if (method === "POST" && pathname.endsWith("/acknowledge")) {
      acknowledgeAttempts += 1;
      const briefingId = decodeURIComponent(pathname.split("/briefings/")[1]?.replace(/\/acknowledge$/, "") || "");
      if (options.acknowledgeFails && acknowledgeAttempts === 1) {
        return { status: 500, json: { ok: false, code: "BRIEFING_ACK_FAILED" } };
      }
      const current = getBriefing(briefingId);
      if (!current) {
        return { status: 404, json: { ok: false, code: "BRIEFING_NOT_FOUND" } };
      }
      const recipients = (current.recipients || []).map((recipient) => {
        if (trim(recipient.recipientEmail).toLowerCase() !== recipientEmail) {
          return recipient;
        }
        if (recipient.acknowledgedAt) {
          return recipient;
        }
        return {
          ...recipient,
          readAt: recipient.readAt || new Date().toISOString(),
          acknowledgedAt: new Date().toISOString(),
          status: "Acknowledged",
        };
      });
      const updated = { ...current, recipients };
      upsertBriefing(updated);
      syncRecipientViews(briefingId);
      return {
        status: 200,
        json: {
          ok: true,
          unchanged: acknowledgeAttempts > 1,
          briefingId,
        },
      };
    }

    if (method === "POST" && pathname.endsWith("/sign")) {
      signAttempts += 1;
      const briefingId = decodeURIComponent(pathname.split("/briefings/")[1]?.replace(/\/sign$/, "") || "");
      const current = getBriefing(briefingId);
      if (!current) {
        return { status: 404, json: { ok: false, code: "BRIEFING_NOT_FOUND" } };
      }
      if (!current.requiresSignature) {
        return {
          status: 400,
          json: { ok: false, code: "BRIEFING_SIGNATURE_NOT_REQUIRED", error: "This briefing does not require a signature." },
        };
      }
      if (options.signFails && signAttempts === 1) {
        return { status: 500, json: { ok: false, code: "BRIEFING_SIGN_FAILED" } };
      }
      const recipients = (current.recipients || []).map((recipient) => {
        if (trim(recipient.recipientEmail).toLowerCase() !== recipientEmail) {
          return recipient;
        }
        if (recipient.signedAt) {
          return recipient;
        }
        return {
          ...recipient,
          readAt: recipient.readAt || new Date().toISOString(),
          acknowledgedAt: recipient.acknowledgedAt || new Date().toISOString(),
          signedAt: new Date().toISOString(),
          signatureName: trim(body?.signatureName) || PRODUCTION_VERIFICATION_BRIEFING_SIGNATURE_NAME,
          status: "Signed",
        };
      });
      const updated = { ...current, recipients };
      upsertBriefing(updated);
      syncRecipientViews(briefingId);
      return {
        status: 200,
        json: {
          ok: true,
          unchanged: signAttempts > 1,
          briefingId,
        },
      };
    }

    if (method === "POST" && pathname.endsWith("/verification-cleanup")) {
      cleanupAttempts += 1;
      if (options.cleanupResponse) {
        return options.cleanupResponse(body);
      }
      if (options.cleanupFails) {
        return { status: 500, json: { ok: false, code: "BRIEFING_CLEANUP_FAILED" } };
      }
      if (options.cleanupRejectsNonVerification) {
        return { status: 403, json: { ok: false, code: "CLEANUP_NOT_VERIFICATION_BRIEFING" } };
      }
      const briefingId = pathname.split("/").filter(Boolean).at(-2);
      const current = getBriefing(briefingId);
      if (current) {
        upsertBriefing({
          ...current,
          status: PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS,
          recipients: (current.recipients || []).map((recipient) => ({
            ...recipient,
            status: "Complete",
            needsAction: false,
          })),
        });
        syncRecipientViews(briefingId);
      }
      return {
        status: 200,
        json: {
          ok: true,
          briefingId,
          cleaned: true,
          status: PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS,
        },
      };
    }

    if (method === "GET" && pathname.includes("/dashboard/live")) {
      if (options.dashboardFails) {
        return { status: 500, json: { ok: false } };
      }
      return {
        status: 200,
        json: dashboardPayload(options.dashboardIncludesVerification === true),
      };
    }

    throw new Error(`Unexpected request ${method} ${path}`);
  };

  return {
    request,
    getCookies: () => Object.fromEntries(cookies.entries()),
    getBriefings: () => briefings,
    getBriefing,
    getMineItems: () => mineItems,
    verificationBriefingId,
    get publishAttempts() {
      return publishAttempts;
    },
    get readAttempts() {
      return readAttempts;
    },
    get acknowledgeAttempts() {
      return acknowledgeAttempts;
    },
    get signAttempts() {
      return signAttempts;
    },
  };
}
