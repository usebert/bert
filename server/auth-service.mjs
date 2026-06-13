/**
 * Auth service — fast company login from auth index (Users tab is source of truth).
 * No Sheets/Drive/registry/setup/health/repair during login request.
 */
import { isPlatformOwnerEmail } from "../shared/platform-owner.mjs";
import { COMPANY_CONTEXT_INVALID, COMPANY_NO_LONGER_AVAILABLE_MESSAGE } from "../shared/company-folder-context.mjs";
import { FOLDER_NOT_IN_COMPANIES_ROOT } from "../shared/company-folder-placement.mjs";
import { readCompanyUsersTabRecord, touchCompanyUserLastLogin } from "./company-users.mjs";
import { canLoginCompanyUser } from "./company-user-sheet-flow.mjs";
import { validateLiveCompanyContext } from "./company-context-service.mjs";

export { COMPANY_CONTEXT_INVALID, COMPANY_NO_LONGER_AVAILABLE_MESSAGE, FOLDER_NOT_IN_COMPANIES_ROOT, validateLiveCompanyContext };

export function buildCompanySessionPayload({
  email,
  masterSheetId,
  companyId,
  companyName,
  role,
  name,
  accessLevel,
  companyAreas,
}) {
  return JSON.stringify({
    v: 1,
    email: String(email || "").trim().toLowerCase(),
    masterSheetId: String(masterSheetId || "").trim(),
    companyId: String(companyId || "").trim(),
    companyName: String(companyName || "").trim(),
    role,
    name: name || email,
    accessLevel: accessLevel || "",
    companyAreas: Array.isArray(companyAreas) ? companyAreas : [],
  });
}

/** API session shape for company users — never includes PasswordHash. */
export function buildCompanySessionApiResponse(input = {}) {
  const email = String(input.email || "").trim().toLowerCase();
  const folderPlacementOk = input.folderPlacementOk !== false;
  const companyFolderId = folderPlacementOk
    ? String(input.companyFolderId || input.companyId || "").trim()
    : "";
  const companyId = folderPlacementOk ? String(input.companyId || companyFolderId).trim() : "";
  const companyName = folderPlacementOk ? String(input.companyName || "").trim() : "";
  const masterSheetId = String(input.masterSheetId || "").trim();
  const reasonCode = folderPlacementOk ? undefined : String(input.reasonCode || "").trim() || undefined;
  const companyContextValid = input.companyContextValid !== false && folderPlacementOk && Boolean(companyFolderId && masterSheetId);
  return {
    ok: true,
    companyContextValid,
    user: {
      email,
      name: String(input.name || email).trim() || email,
      role: input.role || "Admin",
      accessLevel: String(input.accessLevel || "").trim(),
      companyAreas: Array.isArray(input.companyAreas) ? input.companyAreas : [],
    },
    company: {
      companyId,
      companyFolderId: companyFolderId || companyId,
      companyName,
      masterSheetId,
      registryStatus: String(input.registryStatus || "").trim() || undefined,
      status: input.status,
      live: input.live,
      needsAttention: input.needsAttention,
      setupBlockers: input.setupBlockers,
      folderPlacementOk,
      folderPlacement: input.folderPlacement,
      reasonCode,
    },
    email,
    name: String(input.name || email).trim() || email,
    role: input.role || "Admin",
    accessLevel: String(input.accessLevel || "").trim(),
    companyId,
    companyFolderId: companyFolderId || companyId,
    companyName,
    masterSheetId,
    selectedCompanyName: companyName || undefined,
    folderPlacementOk,
    folderPlacement: input.folderPlacement,
    reasonCode,
    companyContextValid,
  };
}

/** API session shape for Godmode — selected company fields optional. */
export function buildMasterSessionApiResponse(input = {}) {
  const email = String(input.email || "").trim().toLowerCase();
  const name = String(input.name || email).trim() || email;
  const companyFolderId = String(input.companyFolderId || input.companyId || "").trim();
  const companyId = String(input.companyId || companyFolderId).trim();
  const companyName = String(input.companyName || input.selectedCompanyName || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  const selectedCompanyName = String(input.selectedCompanyName || companyName).trim();
  return {
    ok: true,
    operator: { email, name },
    user: {
      email,
      name,
      role: "Master",
      accessLevel: "Godmode",
    },
    email,
    name,
    role: "Master",
    accessLevel: "Godmode",
    companyId: companyId || undefined,
    companyFolderId: companyFolderId || companyId || undefined,
    companyName: companyName || undefined,
    masterSheetId: masterSheetId || undefined,
    selectedCompanyName: selectedCompanyName || undefined,
  };
}

export function buildMasterSessionPayload(input = {}) {
  return JSON.stringify({
    v: 1,
    email: String(input.email || "").trim().toLowerCase(),
    name: String(input.name || input.email || "").trim(),
    companyId: String(input.companyId || input.companyFolderId || "").trim() || undefined,
    companyFolderId: String(input.companyFolderId || input.companyId || "").trim() || undefined,
    companyName: String(input.companyName || input.selectedCompanyName || "").trim() || undefined,
    masterSheetId: String(input.masterSheetId || "").trim() || undefined,
    selectedCompanyName: String(input.selectedCompanyName || input.companyName || "").trim() || undefined,
  });
}

function logLoginPhase(phase, startMs) {
  const durationMs = Date.now() - startMs;
  console.log(`[login] ${phase} durationMs=${durationMs}`);
  return durationMs;
}

function logSlowServiceCall(serviceName) {
  console.warn(`[login] SLOW_SERVICE_CALLED service=${serviceName}`);
}

/**
 * Probe workbook Users tab for onboarding finalize — not used on login path.
 */
export async function probeCompanyLoginSheet(auth, masterSheetId, email, password, companyUsersDeps) {
  const emailNorm = String(email || "").trim().toLowerCase();
  const sheetId = String(masterSheetId || "").trim();

  try {
    const login = await canLoginCompanyUser(
      auth,
      emailNorm,
      password,
      { masterSheetId: sheetId },
      companyUsersDeps,
    );
    if (login.ok && login.user) {
      const rec =
        (await readCompanyUsersTabRecord(auth, sheetId, emailNorm, companyUsersDeps)) || login.user;
      return {
        usersRowFound: true,
        roleFound: rec?.role || login.user.role || "",
        passwordVerified: true,
        setupIncomplete: false,
        inactive: false,
        rec,
        migrated: Boolean(login.migrated),
      };
    }
    if (login.reason === "inactive") {
      return {
        usersRowFound: true,
        roleFound: "",
        passwordVerified: false,
        setupIncomplete: false,
        inactive: true,
        cacheOnly: false,
        rec: null,
        migrated: false,
      };
    }
    if (login.reason === "cache_only") {
      return {
        usersRowFound: false,
        roleFound: "",
        passwordVerified: false,
        setupIncomplete: false,
        inactive: false,
        cacheOnly: true,
        rec: null,
        migrated: false,
      };
    }
    const recPeek = await readCompanyUsersTabRecord(auth, sheetId, emailNorm, companyUsersDeps).catch(
      () => null,
    );
    const usersRowFound = Boolean(recPeek);
    const setupIncomplete =
      login.reason === "setup_incomplete" || login.reason === "user_not_found" || !usersRowFound;
    return {
      usersRowFound,
      roleFound: recPeek?.role || "",
      passwordVerified: false,
      setupIncomplete,
      inactive: false,
      rec: null,
      migrated: false,
    };
  } catch {
    return {
      usersRowFound: false,
      roleFound: "",
      passwordVerified: false,
      setupIncomplete: false,
      inactive: false,
      rec: null,
      migrated: false,
    };
  }
}

/**
 * Company login — auth index only; background jobs run after response.
 */
export async function performCompanyLogin(auth, deps, input = {}) {
  const loginStarted = Date.now();
  const timing = {};
  console.log("[login] start");

  const {
    email: rawEmail,
    password,
    masterSheetId: requestedSheetId = "",
    authIndex,
    queueLoginBackgroundJobs,
    isPlatformOwner = isPlatformOwnerEmail,
  } = deps;

  const tNormalize = Date.now();
  const email = String(rawEmail || "").trim().toLowerCase();
  const pwd = String(password || "");
  timing.normalise_email = logLoginPhase("normalise_email", tNormalize);

  if (!email || !pwd) {
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 400,
      blocker: "missing_fields",
      error: "Email and password are required.",
      timing,
    };
  }
  if (!email.includes("@")) {
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 400,
      blocker: "invalid_email",
      error: "A valid email address is required.",
      timing,
    };
  }

  const tPlatform = Date.now();
  if (isPlatformOwner(email, process.env)) {
    timing.platform_auth_check = logLoginPhase("platform_auth_check", tPlatform);
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 401,
      blocker: "invalid_credentials",
      error: "Invalid email or password.",
      timing,
    };
  }
  timing.platform_auth_check = logLoginPhase("platform_auth_check", tPlatform);

  if (!authIndex || typeof authIndex.lookupByEmail !== "function") {
    logSlowServiceCall("auth_index_missing");
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 503,
      blocker: "auth_index_unavailable",
      error: "Sign in is temporarily unavailable.",
      timing,
    };
  }

  const tLookup = Date.now();
  const indexEntry = authIndex.lookupByEmail(email);
  timing.auth_index_lookup = logLoginPhase("auth_index_lookup", tLookup);

  const requested = String(requestedSheetId || "").trim();
  if (!indexEntry) {
    if (typeof queueLoginBackgroundJobs === "function") {
      queueLoginBackgroundJobs({
        email,
        reason: "index_missing",
        requestedMasterSheetId: requested,
      });
    }
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 401,
      blocker: "invalid_credentials",
      error: "Invalid email or password.",
      timing,
    };
  }

  if (requested && indexEntry.masterSheetId && requested !== indexEntry.masterSheetId) {
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 401,
      blocker: "invalid_credentials",
      error: "Invalid email or password.",
      timing,
    };
  }

  const tPassword = Date.now();
  const passwordVerified = authIndex.verifyPasswordForEntry(indexEntry, pwd);
  timing.password_verify = logLoginPhase("password_verify", tPassword);

  if (!passwordVerified) {
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 401,
      blocker: "invalid_credentials",
      error: "Invalid email or password.",
      timing,
    };
  }

  if (String(indexEntry.status || "").toUpperCase() !== "ACTIVE") {
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 403,
      blocker: "inactive",
      error: "This account is inactive. Contact your company administrator.",
      timing,
    };
  }

  const tContext = Date.now();
  const masterSheetId = String(indexEntry.masterSheetId || requested || "").trim();
  const sessionCompanyId = String(indexEntry.companyFolderId || indexEntry.companyId || "").trim();
  const companyName = String(indexEntry.companyName || "").trim();
  const companyAreas = Array.isArray(indexEntry.companyAreas) ? indexEntry.companyAreas : [];
  timing.company_context_load = logLoginPhase("company_context_load", tContext);

  const tSession = Date.now();
  const sessionPayload = buildCompanySessionPayload({
    email,
    masterSheetId,
    companyId: sessionCompanyId,
    companyName,
    role: indexEntry.role,
    name: indexEntry.name,
    accessLevel: indexEntry.accessLevel || "",
    companyAreas,
  });
  timing.session_create = logLoginPhase("session_create", tSession);

  const tJobs = Date.now();
  const backgroundJobs = {
    email,
    masterSheetId,
    companyFolderId: sessionCompanyId,
    companyName,
    indexStale: authIndex.isEntryStale(indexEntry),
    touchLastLogin: true,
  };
  timing.background_jobs_queued = logLoginPhase("background_jobs_queued", tJobs);

  timing.response_sent = 0;
  timing.total = Date.now() - loginStarted;
  console.log(`[login] total durationMs=${timing.total}`);

  return {
    ok: true,
    email,
    masterSheetId,
    user: {
      email,
      role: indexEntry.role,
      name: indexEntry.name,
      accessLevel: indexEntry.accessLevel || "",
      companyAreas,
    },
    company: {
      companyId: sessionCompanyId,
      companyFolderId: sessionCompanyId,
      companyName,
      masterSheetId,
    },
    sessionPayload,
    backgroundJobs,
    timing,
  };
}

/** Queue post-login background work — must run after HTTP response. */
export function queueCompanyLoginBackgroundJobs(deps, jobs = {}) {
  const {
    authIndex,
    getAuthedClient,
    getCompanyUsersDeps,
    enqueueBackgroundJob,
    touchCompanyUserLastLogin: touchLastLoginFn = touchCompanyUserLastLogin,
  } = deps;

  const email = String(jobs.email || "").trim().toLowerCase();
  const masterSheetId = String(jobs.masterSheetId || "").trim();
  const companyFolderId = String(jobs.companyFolderId || "").trim();

  if (jobs.reason === "index_missing" && typeof enqueueBackgroundJob === "function") {
    enqueueBackgroundJob({
      type: "REBUILD_AUTH_INDEX",
      companyId: companyFolderId,
      requestedBy: email || "login",
      userMessage: "Rebuilding sign-in index.",
      payload: { email, masterSheetId: jobs.requestedMasterSheetId || masterSheetId, reason: "index_missing" },
    }).catch(() => null);
    return;
  }

  if (jobs.indexStale && typeof enqueueBackgroundJob === "function") {
    enqueueBackgroundJob({
      type: "VERIFY_AUTH_INDEX",
      companyId: companyFolderId,
      requestedBy: email,
      userMessage: "Verifying sign-in index.",
      payload: { email, masterSheetId, companyFolderId, companyName: jobs.companyName || "" },
    }).catch(() => null);
  }

  if (jobs.touchLastLogin && masterSheetId && email) {
    setImmediate(() => {
      const auth = typeof getAuthedClient === "function" ? getAuthedClient() : null;
      if (!auth) {
        return;
      }
      const companyUsersDeps = typeof getCompanyUsersDeps === "function" ? getCompanyUsersDeps() : {};
      touchLastLoginFn(auth, masterSheetId, email, companyUsersDeps).catch(() => null);
    });
  }

  if (jobs.rebuildAfterInvite && authIndex && masterSheetId) {
    setImmediate(async () => {
      const auth = typeof getAuthedClient === "function" ? getAuthedClient() : null;
      if (!auth || typeof authIndex.rebuildCompanyAuthIndexFromSheet !== "function") {
        return;
      }
      await authIndex
        .rebuildCompanyAuthIndexFromSheet(auth, deps, {
          masterSheetId,
          companyFolderId,
          companyName: jobs.companyName || "",
        })
        .catch(() => null);
    });
  }
}

export { logSlowServiceCall };

/**
 * After password verify — resolve company via live Drive/registry/workbook checks.
 * Returns validated fields or an invalid-context error payload.
 */
export async function resolveValidatedCompanyLoginContext(auth, deps, indexEntry = {}) {
  const masterSheetId = String(indexEntry.masterSheetId || "").trim();
  const companyFolderId = String(indexEntry.companyFolderId || indexEntry.companyId || "").trim();
  const validation = await validateLiveCompanyContext(auth, deps, {
    masterSheetId,
    companyFolderId,
    companyName: indexEntry.companyName,
  });
  if (!validation.companyContextValid) {
    return {
      ok: false,
      httpStatus: 409,
      blocker: "company_context_invalid",
      reasonCode: validation.reasonCode || COMPANY_CONTEXT_INVALID,
      error: validation.message || COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
      companyContextValid: false,
    };
  }
  return {
    ok: true,
    companyContextValid: true,
    companyId: validation.companyFolderId,
    companyFolderId: validation.companyFolderId,
    companyName: validation.companyName,
    masterSheetId: validation.masterSheetId,
    folderPlacementOk: true,
    folderPlacement: validation.folderPlacement,
    registryStatus: validation.registryStatus,
  };
}
