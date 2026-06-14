/**
 * Auth service — fast company login from auth index (Users tab is source of truth).
 * No Sheets/Drive/registry/setup/health/repair during login request.
 */
import {
  isPlatformOwnerEmail,
  normalizePlatformOwnerEmail,
  resolvePlatformOwnerEmail,
} from "../shared/platform-owner.mjs";
import { isKnownStaleAuthIndexPairing } from "../shared/auth-index-trust.mjs";
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

/**
 * Godmode / platform Master login — master-operators.json only; never auth index or company Users tab.
 * @param {object} deps
 * @param {string} deps.sessionDir
 * @param {(sessionDir: string, identity: string) => { operator: object; matchedBy: string } | null} deps.findOperatorByIdentity
 * @param {(plain: string, stored: string) => boolean} deps.verifyPassword
 * @param {(input: { sessionDir: string; email: string; name: string; password: string }) => object} [deps.upsertMasterOperator]
 * @param {typeof isPlatformOwnerEmail} [deps.isPlatformOwner]
 * @param {NodeJS.ProcessEnv} [deps.env]
 */
export function performMasterLogin(deps = {}, input = {}) {
  const loginStarted = Date.now();
  const timing = {};
  console.log("[login] start");

  const {
    sessionDir,
    findOperatorByIdentity,
    verifyPassword,
    upsertMasterOperator,
    isPlatformOwner = isPlatformOwnerEmail,
    env = process.env,
  } = deps;

  const tNormalize = Date.now();
  const identity = String(input.email || input.username || "").trim();
  const password = String(input.password || "");
  const identityKind = identity.includes("@") ? "email" : identity ? "username" : "missing";
  timing.normalise_email = logLoginPhase("normalise_email", tNormalize);

  if (!identity || !password) {
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 400,
      error: "Email or username and password are required.",
      timing,
    };
  }

  const tPlatform = Date.now();
  const platformOwnerLogin =
    identity.includes("@") && isPlatformOwner(identity, env);
  timing.platform_auth_check = logLoginPhase("platform_auth_check", tPlatform);

  const tLookup = Date.now();
  let found = findOperatorByIdentity(sessionDir, identity);
  if (!found?.operator && platformOwnerLogin) {
    const platformEmail = resolvePlatformOwnerEmail(env);
    if (platformEmail !== normalizePlatformOwnerEmail(identity)) {
      found = findOperatorByIdentity(sessionDir, platformEmail);
    }
  }
  let op = found?.operator;
  timing.auth_index_lookup = logLoginPhase("auth_index_lookup", tLookup);
  console.log(`[login] auth_index_lookup durationMs=${timing.auth_index_lookup} (master-operators only)`);

  const tPassword = Date.now();
  let passwordOk = Boolean(op && verifyPassword(password, op.passwordHash));
  if (!passwordOk && platformOwnerLogin && typeof upsertMasterOperator === "function") {
    const envPassword = String(env.MASTER_PASSWORD || env.BERT_INITIAL_MASTER_PASSWORD || "").trim();
    if (envPassword && password === envPassword) {
      const platformEmail = resolvePlatformOwnerEmail(env);
      const displayName = String(env.BERT_INITIAL_MASTER_USERNAME || "").trim() || platformEmail;
      upsertMasterOperator({ sessionDir, email: platformEmail, name: displayName, password });
      found = findOperatorByIdentity(sessionDir, platformEmail);
      op = found?.operator;
      passwordOk = Boolean(op && verifyPassword(password, op.passwordHash));
    }
  }
  timing.password_verify = logLoginPhase("password_verify", tPassword);
  const tContext = Date.now();
  timing.company_context_load = logLoginPhase("company_context_load", tContext);
  console.log(`[login] company_context_load durationMs=0 (no company context)`);

  console.log(
    `[master-auth] login identityKind=${identityKind} platformOwner=${platformOwnerLogin} matchedBy=${found?.matchedBy || "none"} found=${Boolean(op)} passwordOk=${passwordOk}`,
  );

  if (!passwordOk) {
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 401,
      error: "Sign in failed.",
      timing,
    };
  }

  const tSession = Date.now();
  const sessionPayload = buildMasterSessionPayload({ email: op.email, name: op.name });
  timing.session_create = logLoginPhase("session_create", tSession);
  const tJobs = Date.now();
  timing.background_jobs_queued = logLoginPhase("background_jobs_queued", tJobs);
  console.log(`[login] background_jobs_queued durationMs=0`);
  timing.response_sent = 0;
  timing.total = Date.now() - loginStarted;
  console.log(`[login] total durationMs=${timing.total}`);

  return {
    ok: true,
    email: op.email,
    name: op.name,
    sessionPayload,
    timing,
  };
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

export const INVALID_CREDENTIALS = "INVALID_CREDENTIALS";
export const LOGIN_CONTEXT_FAILED = "LOGIN_CONTEXT_FAILED";

function buildInvalidCredentialsFailure(timing, loginStarted) {
  timing.total = logLoginPhase("total", loginStarted);
  return {
    ok: false,
    httpStatus: 401,
    code: INVALID_CREDENTIALS,
    blocker: "invalid_credentials",
    error: "Email or password is incorrect.",
    message: "Email or password is incorrect.",
    timing,
  };
}

function buildLoginContextFailure({
  timing,
  loginStarted,
  email,
  failedStep,
  reasonCode,
  indexEntry = {},
  usersTabRec = null,
}) {
  const rowCols =
    usersTabRec && typeof usersTabRec === "object"
      ? {
          companyName: String(usersTabRec.companyName || "").trim(),
          companyId: String(usersTabRec.companyId || "").trim(),
          companyFolderId: String(usersTabRec.companyFolderId || usersTabRec.companyId || "").trim(),
        }
      : {
          companyName: String(indexEntry.companyName || "").trim(),
          companyId: String(indexEntry.companyId || "").trim(),
          companyFolderId: String(indexEntry.companyFolderId || indexEntry.companyId || "").trim(),
        };
  timing.total = logLoginPhase("total", loginStarted);
  return {
    ok: false,
    httpStatus: 409,
    code: LOGIN_CONTEXT_FAILED,
    blocker: "login_context_failed",
    error: "Unable to complete sign in.",
    message: "Unable to complete sign in.",
    reasonCode: String(reasonCode || failedStep || "company_context_invalid").trim(),
    companyContextValid: false,
    diagnostics: {
      email: String(email || "").trim().toLowerCase(),
      failedStep: String(failedStep || "company_context_resolve").trim(),
      companyName: rowCols.companyName,
      companyId: rowCols.companyId,
      companyFolderId: rowCols.companyFolderId,
      masterSheetId: String(indexEntry.masterSheetId || "").trim(),
      reasonCode: String(reasonCode || failedStep || "company_context_invalid").trim(),
    },
    timing,
  };
}

/**
 * Company login — auth index + Users tab row company columns; live Drive validation runs after response.
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
    sessionRevocation,
    queueLoginBackgroundJobs,
    getCompanyUsersDeps,
    isPlatformOwner = isPlatformOwnerEmail,
  } = deps;

  const tNormalize = Date.now();
  const email = String(rawEmail || input.email || "").trim().toLowerCase();
  const pwd = String(password || input.password || "");
  timing.normalise_email = logLoginPhase("normalise_email", tNormalize);

  if (!email || !pwd) {
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 400,
      code: "MISSING_FIELDS",
      blocker: "missing_fields",
      error: "Email and password are required.",
      message: "Email and password are required.",
      timing,
    };
  }
  if (!email.includes("@")) {
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 400,
      code: "INVALID_EMAIL",
      blocker: "invalid_email",
      error: "A valid email address is required.",
      message: "A valid email address is required.",
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
      blocker: "platform_owner_master_only",
      error: "Platform owner must use master auth.",
      message: "Platform owner must use master auth.",
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
      message: "Sign in is temporarily unavailable.",
      timing,
    };
  }

  const tLookup = Date.now();
  let indexEntry = authIndex.lookupByEmail(email);
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
    return buildInvalidCredentialsFailure(timing, loginStarted);
  }

  if (requested && indexEntry.masterSheetId && requested !== indexEntry.masterSheetId) {
    return buildInvalidCredentialsFailure(timing, loginStarted);
  }

  let usersTabRec = null;
  let sessionCompanyName = String(indexEntry.companyName || "").trim();
  let sessionCompanyId = String(indexEntry.companyFolderId || indexEntry.companyId || "").trim();
  let masterSheetId = String(indexEntry.masterSheetId || requested || "").trim();

  const tUsersTab = Date.now();
  if (
    auth &&
    masterSheetId &&
    typeof authIndex.reconcileLoginEntryFromUsersTab === "function"
  ) {
    const reconcileDeps = {
      ...deps,
      getCompanyUsersDeps: getCompanyUsersDeps || deps.getCompanyUsersDeps,
    };
    const reconciled = await authIndex
      .reconcileLoginEntryFromUsersTab(auth, reconcileDeps, email, indexEntry)
      .catch(() => ({ ok: false, failedStep: "user_lookup", reason: "reconcile_failed" }));
    timing.users_tab_reconcile = logLoginPhase("users_tab_reconcile", tUsersTab);

    if (!reconciled.ok) {
      if (reconciled.failedStep === "user_lookup" && reconciled.reason === "inactive") {
        timing.total = logLoginPhase("total", loginStarted);
        return {
          ok: false,
          httpStatus: 403,
          blocker: "inactive",
          error: "This account is inactive. Contact your company administrator.",
          message: "This account is inactive. Contact your company administrator.",
          timing,
        };
      }
      return buildLoginContextFailure({
        timing,
        loginStarted,
        email,
        failedStep: reconciled.failedStep || "user_lookup",
        reasonCode: reconciled.reason || "user_not_in_workbook",
        indexEntry,
        usersTabRec: reconciled.rec,
      });
    }

    indexEntry = reconciled.entry || indexEntry;
    usersTabRec = reconciled.rec || null;
    const rowCols = reconciled.rowCols || {};
    sessionCompanyName = String(rowCols.companyName || indexEntry.companyName || "").trim();
    sessionCompanyId = String(
      rowCols.companyFolderId || rowCols.companyId || indexEntry.companyFolderId || indexEntry.companyId || "",
    ).trim();
    masterSheetId = String(indexEntry.masterSheetId || requested || "").trim();
    if (reconciled.reconciled) {
      timing.auth_index_update = logLoginPhase("auth_index_update", tUsersTab);
    }
  } else {
    timing.users_tab_reconcile = logLoginPhase("users_tab_reconcile", tUsersTab);
  }

  const tPassword = Date.now();
  const passwordEntry = {
    ...indexEntry,
    passwordHash: String(usersTabRec?.passwordHash || indexEntry.passwordHash || "").trim(),
  };
  const passwordVerified = authIndex.verifyPasswordForEntry(passwordEntry, pwd);
  timing.password_verify = logLoginPhase("password_verify", tPassword);

  if (!passwordVerified) {
    return buildInvalidCredentialsFailure(timing, loginStarted);
  }

  if (String(indexEntry.status || usersTabRec?.status || "").toUpperCase() !== "ACTIVE") {
    timing.total = logLoginPhase("total", loginStarted);
    return {
      ok: false,
      httpStatus: 403,
      blocker: "inactive",
      error: "This account is inactive. Contact your company administrator.",
      message: "This account is inactive. Contact your company administrator.",
      timing,
    };
  }

  if (
    sessionRevocation &&
    typeof sessionRevocation.isCompanyUserSessionRevoked === "function" &&
    sessionRevocation.isCompanyUserSessionRevoked(email, sessionCompanyId, masterSheetId)
  ) {
    authIndex.removeEntry?.(email);
    return buildInvalidCredentialsFailure(timing, loginStarted);
  }

  if (isKnownStaleAuthIndexPairing(email, sessionCompanyName)) {
    authIndex.removeEntry?.(email);
    return buildLoginContextFailure({
      timing,
      loginStarted,
      email,
      failedStep: "stale_company_context_detected",
      reasonCode: COMPANY_CONTEXT_INVALID,
      indexEntry,
      usersTabRec,
    });
  }

  if (!masterSheetId) {
    return buildLoginContextFailure({
      timing,
      loginStarted,
      email,
      failedStep: "master_sheet_resolve",
      reasonCode: "MASTER_SHEET_MISSING",
      indexEntry,
      usersTabRec,
    });
  }
  if (!sessionCompanyId) {
    return buildLoginContextFailure({
      timing,
      loginStarted,
      email,
      failedStep: "company_folder_resolve",
      reasonCode: "COMPANY_FOLDER_MISSING",
      indexEntry,
      usersTabRec,
    });
  }
  if (!sessionCompanyName) {
    return buildLoginContextFailure({
      timing,
      loginStarted,
      email,
      failedStep: "company_context_resolve",
      reasonCode: "COMPANY_NAME_MISSING",
      indexEntry,
      usersTabRec,
    });
  }

  const tContext = Date.now();
  const companyAreas = Array.isArray(usersTabRec?.companyAreas)
    ? usersTabRec.companyAreas
    : Array.isArray(indexEntry.companyAreas)
      ? indexEntry.companyAreas
      : [];
  timing.company_context_load = logLoginPhase("company_context_load", tContext);

  const tSession = Date.now();
  const sessionPayload = buildCompanySessionPayload({
    email,
    masterSheetId,
    companyId: sessionCompanyId,
    companyName: sessionCompanyName,
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
    companyName: sessionCompanyName,
    indexStale: authIndex.isEntryStale(indexEntry),
    validateLiveCompany: Boolean(auth),
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
      companyName: sessionCompanyName,
      masterSheetId,
    },
    sessionPayload,
    backgroundJobs,
    clearClientHints: true,
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

  if (jobs.validateLiveCompany && typeof enqueueBackgroundJob === "function") {
    enqueueBackgroundJob({
      type: "VERIFY_AUTH_INDEX",
      companyId: companyFolderId,
      requestedBy: email,
      userMessage: "Verifying company workspace.",
      payload: {
        email,
        masterSheetId,
        companyFolderId,
        companyName: jobs.companyName || "",
        reason: "post_login_validate",
      },
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
 * After password verify — resolve company via Users tab row + live Drive/workbook checks.
 * Returns validated fields or an invalid-context error payload.
 */
export async function resolveValidatedCompanyLoginContext(auth, deps, indexEntry = {}, options = {}) {
  const email = String(options.email || indexEntry.email || "").trim().toLowerCase();
  const authIndex = options.authIndex || deps.authIndex;

  if (isKnownStaleAuthIndexPairing(email, indexEntry.companyName)) {
    authIndex?.removeEntry?.(email);
    return {
      ok: false,
      httpStatus: 409,
      blocker: "company_context_invalid",
      reasonCode: COMPANY_CONTEXT_INVALID,
      error: COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
      companyContextValid: false,
    };
  }

  if (authIndex && typeof authIndex.verifyAuthIndexEntryMatchesUsersWorkbook === "function" && email) {
    const trusted = await authIndex
      .verifyAuthIndexEntryMatchesUsersWorkbook(auth, deps, email, indexEntry)
      .catch(() => ({ ok: false, reason: "verify_failed", removeEntry: true }));
    if (!trusted.ok) {
      if (trusted.removeEntry) {
        authIndex.removeEntry?.(email);
      }
      return {
        ok: false,
        httpStatus: 409,
        blocker: "company_context_invalid",
        reasonCode: COMPANY_CONTEXT_INVALID,
        error: COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
        companyContextValid: false,
      };
    }
    const validation = trusted.validation || {};
    const rowCompanyFolderId = String(
      trusted.rec?.companyFolderId || trusted.rec?.companyId || validation.companyFolderId || "",
    ).trim();
    const rowCompanyName = String(trusted.rec?.companyName || validation.companyName || "").trim();
    authIndex.upsertEntry?.({
      email,
      name: String(indexEntry.name || trusted.rec?.name || email).trim() || email,
      role: String(trusted.rec?.role || indexEntry.role || "User").trim() || "User",
      accessLevel: String(trusted.rec?.accessLevel || indexEntry.accessLevel || "").trim(),
      companyId: rowCompanyFolderId || validation.companyFolderId,
      companyFolderId: rowCompanyFolderId || validation.companyFolderId,
      companyName: rowCompanyName || validation.companyName,
      masterSheetId: validation.masterSheetId,
      status: trusted.rec?.status || indexEntry.status || "ACTIVE",
      passwordHash: String(indexEntry.passwordHash || "").trim(),
      companyAreas: Array.isArray(trusted.rec?.companyAreas)
        ? trusted.rec.companyAreas
        : Array.isArray(indexEntry.companyAreas)
          ? indexEntry.companyAreas
          : [],
    });
    return {
      ok: true,
      companyContextValid: true,
      companyId: rowCompanyFolderId || validation.companyFolderId,
      companyFolderId: rowCompanyFolderId || validation.companyFolderId,
      companyName: rowCompanyName || validation.companyName,
      masterSheetId: validation.masterSheetId,
      folderPlacementOk: true,
      folderPlacement: validation.folderPlacement,
      registryStatus: validation.registryStatus,
    };
  }

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
  if (isKnownStaleAuthIndexPairing(email, validation.companyName)) {
    authIndex?.removeEntry?.(email);
    return {
      ok: false,
      httpStatus: 409,
      blocker: "company_context_invalid",
      reasonCode: COMPANY_CONTEXT_INVALID,
      error: COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
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
