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
import {
  authenticateCompanyUserLogin,
  rebuildAuthIndexFromUsersTab,
  resolveLoginCompanyFolderIdSource,
} from "./user-auth-service.mjs";
import {
  isValidCompanyFolderId,
  isValidGoogleSpreadsheetId,
  sanitizeCompanyFolderId,
  sanitizeGoogleSpreadsheetId,
} from "../shared/google-drive-id.mjs";
import {
  pickRowCompanyFolderId,
  pickRowCompanyId,
  pickRowCompanyName,
} from "./users-tab-schema.mjs";
import {
  createLoginTimingTrace,
  loginTimingEmailMeta,
  logLoginTimingMark,
  logLoginTimingPhase,
} from "./login-timing.mjs";

export { COMPANY_CONTEXT_INVALID, COMPANY_NO_LONGER_AVAILABLE_MESSAGE, FOLDER_NOT_IN_COMPANIES_ROOT, validateLiveCompanyContext };

export function buildCompanySessionPayload({
  email,
  masterSheetId,
  companyId,
  companyFolderId,
  companyName,
  role,
  name,
  accessLevel,
  companyAreas,
}) {
  const folderId = String(companyFolderId || companyId || "").trim();
  return JSON.stringify({
    v: 1,
    email: String(email || "").trim().toLowerCase(),
    masterSheetId: String(masterSheetId || "").trim(),
    companyId: folderId,
    companyFolderId: folderId,
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
  const companyFolderId = String(input.companyFolderId || input.companyId || "").trim();
  const companyId = String(input.companyId || companyFolderId).trim();
  const companyName = String(input.companyName || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  const reasonCode = folderPlacementOk ? undefined : String(input.reasonCode || "").trim() || undefined;
  const companyContextValid =
    input.companyContextValid !== false && Boolean(companyFolderId && masterSheetId);
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

function logLoginPhase(phase, startMs, loginTiming, meta = {}) {
  const durationMs = loginTiming?.phase?.(phase, startMs, meta) ?? logLoginTimingPhase(phase, startMs, meta);
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
  const loginTiming = deps.loginTiming || createLoginTimingTrace({ flow: "master" });
  logLoginTimingMark("route_processing_start", { flow: "master" });
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
  timing.normalise_email = logLoginPhase("email_normalised", tNormalize, loginTiming, {
    identityKind,
  });

  if (!identity || !password) {
    timing.total = logLoginPhase("total_login_duration", loginStarted, loginTiming);
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
  timing.platform_auth_check = logLoginPhase("platform_auth_check", tPlatform, loginTiming);

  const tLookup = Date.now();
  let found = findOperatorByIdentity(sessionDir, identity);
  if (!found?.operator && platformOwnerLogin) {
    const platformEmail = resolvePlatformOwnerEmail(env);
    if (platformEmail !== normalizePlatformOwnerEmail(identity)) {
      found = findOperatorByIdentity(sessionDir, platformEmail);
    }
  }
  let op = found?.operator;
  timing.auth_index_lookup = logLoginPhase("auth_index_lookup", tLookup, loginTiming, {
    scope: "master_operators_only",
  });
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
  timing.password_verify = logLoginPhase("password_check", tPassword, loginTiming);
  const tContext = Date.now();
  loginTiming.logMark("company_context_load_start");
  timing.company_context_load = logLoginPhase("company_context_load", tContext, loginTiming);
  loginTiming.logMark("company_context_load_end");
  console.log(`[login] company_context_load durationMs=0 (no company context)`);

  console.log(
    `[master-auth] login identityKind=${identityKind} platformOwner=${platformOwnerLogin} matchedBy=${found?.matchedBy || "none"} found=${Boolean(op)} passwordOk=${passwordOk}`,
  );

  if (!passwordOk) {
    timing.total = logLoginPhase("total_login_duration", loginStarted, loginTiming);
    return {
      ok: false,
      httpStatus: 401,
      error: "Sign in failed.",
      timing,
    };
  }

  const tSession = Date.now();
  loginTiming.logMark("session_create_start");
  const sessionPayload = buildMasterSessionPayload({ email: op.email, name: op.name });
  timing.session_create = logLoginPhase("session_create", tSession, loginTiming);
  loginTiming.logMark("session_create_end");
  const tJobs = Date.now();
  loginTiming.logMark("background_jobs_queued_start");
  timing.background_jobs_queued = logLoginPhase("background_jobs_queued", tJobs, loginTiming);
  loginTiming.logMark("background_jobs_queued_end");
  console.log(`[login] background_jobs_queued durationMs=0`);
  timing.response_sent = 0;
  timing.total = Date.now() - loginStarted;
  logLoginTimingMark("total_login_duration", { durationMs: timing.total, flow: "master" });
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

/** Queue a background job without failing login — enqueueJob is synchronous and does not return a Promise. */
export function safeEnqueueBackgroundJob(enqueueBackgroundJob, input = {}) {
  if (typeof enqueueBackgroundJob !== "function") {
    return;
  }
  const type = String(input.type || "").trim();
  if (type === "REBUILD_AUTH_INDEX") {
    const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
    const masterSheetId = String(payload.masterSheetId || "").trim();
    const companyFolderId = String(payload.companyFolderId || input.companyId || "").trim();
    if (!masterSheetId || !companyFolderId) {
      console.warn("[login] skip REBUILD_AUTH_INDEX — missing companyFolderId or masterSheetId", {
        masterSheetId: masterSheetId || "(missing)",
        companyFolderId: companyFolderId || "(missing)",
        reason: payload.reason || type,
      });
      return;
    }
  }
  try {
    enqueueBackgroundJob(input);
  } catch (error) {
    console.warn("[login] background job queue failed", error);
  }
}

function buildInvalidCredentialsFailure(timing, loginStarted, loginTiming) {
  timing.total = logLoginPhase("total_login_duration", loginStarted, loginTiming, { ok: false });
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

function collectLoginMasterSheetCandidates(email, deps, requested = "", indexEntry = {}) {
  const seen = new Set();
  const ordered = [];
  const push = (raw) => {
    const id = sanitizeGoogleSpreadsheetId(raw);
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    ordered.push(id);
  };
  push(requested);
  push(indexEntry?.masterSheetId);
  if (typeof deps.findMasterSheetIdsForCompanyLoginEmail === "function") {
    for (const sheetId of deps.findMasterSheetIdsForCompanyLoginEmail(email) || []) {
      push(sheetId);
    }
  }
  return ordered;
}

function resolveLoginCompanyName(deps, session = {}, usersTabRec = null, indexEntry = {}) {
  let companyName = String(session.sessionCompanyName || "").trim();
  if (companyName) {
    return companyName;
  }
  const companyFolderId = String(session.sessionCompanyId || indexEntry.companyFolderId || indexEntry.companyId || "").trim();
  const masterSheetId = String(indexEntry.masterSheetId || "").trim();
  const cache = deps?.masterSheetCache;
  if (cache && typeof cache.getEntry === "function" && companyFolderId) {
    companyName = String(cache.getEntry(companyFolderId)?.companyName || "").trim();
    if (companyName) {
      return companyName;
    }
  }
  if (usersTabRec) {
    const rowObj = usersTabRec.rowObject || usersTabRec;
    companyName = String(
      usersTabRec.companyName || pickRowCompanyName(rowObj) || usersTabRec.company || "",
    ).trim();
    if (companyName) {
      return companyName;
    }
  }
  return String(indexEntry.companyName || "").trim();
}

function mergeSessionCompanyContextFromUsersTab(usersTabRec, indexEntry = {}, session = {}) {
  if (!usersTabRec) {
    return session;
  }
  const rowObj = usersTabRec.rowObject || usersTabRec;
  const companyName = String(
    usersTabRec.companyName || pickRowCompanyName(rowObj) || session.sessionCompanyName || indexEntry.companyName || "",
  ).trim();
  const folderRaw = String(
    usersTabRec.companyFolderId ||
      pickRowCompanyFolderId(rowObj) ||
      usersTabRec.companyId ||
      pickRowCompanyId(rowObj) ||
      session.sessionCompanyId ||
      indexEntry.companyFolderId ||
      indexEntry.companyId ||
      "",
  ).trim();
  const sessionCompanyId = sanitizeCompanyFolderId(folderRaw) || session.sessionCompanyId || "";
  return {
    ...session,
    sessionCompanyName: companyName || session.sessionCompanyName || "",
    sessionCompanyId,
  };
}

function persistLoginAuthIndexEntry(authIndex, email, indexEntry = {}, session = {}) {
  if (!authIndex || typeof authIndex.upsertEntry !== "function") {
    return;
  }
  const key = String(email || "").trim().toLowerCase();
  const masterSheetId = sanitizeGoogleSpreadsheetId(session.masterSheetId || indexEntry.masterSheetId || "");
  const companyFolderId = sanitizeCompanyFolderId(
    session.sessionCompanyId || indexEntry.companyFolderId || indexEntry.companyId || "",
  );
  if (!key || !masterSheetId || !companyFolderId) {
    return;
  }
  authIndex.upsertEntry({
    ...indexEntry,
    email: key,
    name: String(indexEntry.name || key).trim() || key,
    role: String(indexEntry.role || "User").trim() || "User",
    accessLevel: String(indexEntry.accessLevel || "").trim(),
    companyId: companyFolderId,
    companyFolderId,
    companyName: String(session.sessionCompanyName || indexEntry.companyName || "").trim(),
    masterSheetId,
    status: indexEntry.status || "ACTIVE",
    passwordHash: String(indexEntry.passwordHash || "").trim(),
    companyAreas: Array.isArray(indexEntry.companyAreas) ? indexEntry.companyAreas : [],
  });
}

function buildLoginContextFailure({
  timing,
  loginStarted,
  loginTiming,
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
  timing.total = logLoginPhase("total_login_duration", loginStarted, loginTiming, {
    ok: false,
    failedStep,
  });
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
 * Company login — Users tab PasswordHash verified after folder-first company resolve.
 * Auth index is a hint/cache only; live Drive validation runs after response.
 */
export async function performCompanyLogin(auth, deps, input = {}) {
  const loginStarted = Date.now();
  const timing = {};
  const loginTiming = deps.loginTiming || createLoginTimingTrace({ flow: "company_login" });
  console.log("[login] start");

  const {
    email: rawEmail,
    password,
    masterSheetId: requestedSheetId = "",
    authIndex,
    sessionRevocation,
    getCompanyUsersDeps,
    findMasterSheetIdsForCompanyLoginEmail,
    isPlatformOwner = isPlatformOwnerEmail,
  } = deps;

  const tNormalize = Date.now();
  const email = String(rawEmail || input.email || "").trim().toLowerCase();
  const pwd = String(password || input.password || "");
  timing.normalise_email = logLoginPhase("email_normalised", tNormalize, loginTiming, loginTimingEmailMeta(email));

  if (!email || !pwd) {
    timing.total = logLoginPhase("total_login_duration", loginStarted, loginTiming, { ok: false });
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
    timing.total = logLoginPhase("total_login_duration", loginStarted, loginTiming, { ok: false });
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
    timing.platform_auth_check = logLoginPhase("platform_auth_check", tPlatform, loginTiming, { blocked: true });
    timing.total = logLoginPhase("total_login_duration", loginStarted, loginTiming, { ok: false });
    return {
      ok: false,
      httpStatus: 401,
      blocker: "platform_owner_master_only",
      error: "Platform owner must use master auth.",
      message: "Platform owner must use master auth.",
      timing,
    };
  }
  timing.platform_auth_check = logLoginPhase("platform_auth_check", tPlatform, loginTiming, { blocked: false });

  const requested = sanitizeGoogleSpreadsheetId(requestedSheetId);

  if (!auth) {
    timing.total = logLoginPhase("total_login_duration", loginStarted, loginTiming, {
      ok: false,
      blocker: "google_not_connected",
    });
    return {
      ok: false,
      httpStatus: 503,
      blocker: "google_not_connected",
      error: "Connect Google Workspace before signing in.",
      message: "Connect Google Workspace before signing in.",
      timing,
    };
  }

  const explicitFolderFirst = Boolean(
    sanitizeCompanyFolderId(input.companyFolderId || "") ||
      sanitizeCompanyFolderId(input.sessionCompanyFolderId || ""),
  );
  loginTiming.logMark("company_login_input_hints", {
    explicitFolderFirst,
    companyFolderIdSource: resolveLoginCompanyFolderIdSource(input, { authIndex, ...deps }, email),
    hasMasterSheetIdHint: Boolean(requested),
  });

  loginTiming.logMark("users_tab_auth_start", loginTimingEmailMeta(email));
  const tAuth = Date.now();
  const authResult = await authenticateCompanyUserLogin(
    auth,
    {
      ...deps,
      authIndex,
      getCompanyUsersDeps,
      findMasterSheetIdsForCompanyLoginEmail,
      loginTiming,
    },
    {
      email,
      password: pwd,
      masterSheetId: requested,
      companyFolderId: sanitizeCompanyFolderId(input.companyFolderId || ""),
      sessionCompanyFolderId: sanitizeCompanyFolderId(input.sessionCompanyFolderId || ""),
    },
  );
  timing.users_tab_auth = logLoginPhase("users_tab_auth", tAuth, loginTiming, { ok: authResult.ok === true });
  loginTiming.logMark("users_tab_auth_end", { ok: authResult.ok === true });

  if (!authResult.ok) {
    logLoginPhase("login_response_ready", loginStarted, loginTiming, {
      ok: false,
      blocker: authResult.blocker || authResult.reason,
    });
    timing.total = logLoginPhase("total_login_duration", loginStarted, loginTiming, {
      ok: false,
      blocker: authResult.blocker || authResult.reason,
    });
    if (authResult.blocker === "inactive" || authResult.reason === "inactive") {
      return {
        ok: false,
        httpStatus: 403,
        blocker: "inactive",
        error:
          authResult.error ||
          "This account is inactive. Contact your company administrator.",
        message:
          authResult.message ||
          "This account is inactive. Contact your company administrator.",
        timing,
      };
    }
    return {
      ok: false,
      httpStatus: authResult.httpStatus || 401,
      code: authResult.code,
      blocker: authResult.blocker || authResult.reason,
      error: authResult.error || authResult.message,
      message: authResult.message || authResult.error,
      reasonCode: authResult.reasonCode || authResult.diagnostics?.reasonCode,
      authFailureReason: authResult.authFailureReason,
      diagnostics: authResult.diagnostics,
      timing,
    };
  }

  const { row: usersTabRec, companyContext, entry: indexEntry } = authResult;
  const sessionCompanyId = sanitizeCompanyFolderId(
    companyContext.companyFolderId || companyContext.companyId || indexEntry.companyFolderId || "",
  );
  const masterSheetId = sanitizeGoogleSpreadsheetId(companyContext.masterSheetId || indexEntry.masterSheetId || "");
  let sessionCompanyName = String(
    companyContext.companyName || indexEntry.companyName || pickRowCompanyName(usersTabRec?.rowObject || usersTabRec) || "",
  ).trim();

  if (
    sessionRevocation &&
    typeof sessionRevocation.isCompanyUserSessionRevoked === "function" &&
    sessionRevocation.isCompanyUserSessionRevoked(email, sessionCompanyId, masterSheetId)
  ) {
    authIndex?.removeEntry?.(email);
    return buildInvalidCredentialsFailure(timing, loginStarted, loginTiming);
  }

  if (!isValidGoogleSpreadsheetId(masterSheetId)) {
    return buildLoginContextFailure({
      timing,
      loginStarted,
      loginTiming,
      email,
      failedStep: "master_sheet_resolve",
      reasonCode: "MASTER_SHEET_MISSING",
      indexEntry,
      usersTabRec,
    });
  }
  if (!isValidCompanyFolderId(sessionCompanyId)) {
    return buildLoginContextFailure({
      timing,
      loginStarted,
      loginTiming,
      email,
      failedStep: "company_folder_resolve",
      reasonCode: "COMPANY_FOLDER_MISSING",
      indexEntry,
      usersTabRec,
    });
  }

  sessionCompanyName = resolveLoginCompanyName(
    deps,
    { sessionCompanyName, sessionCompanyId },
    usersTabRec,
    indexEntry,
  );
  if (!sessionCompanyName) {
    return buildLoginContextFailure({
      timing,
      loginStarted,
      loginTiming,
      email,
      failedStep: "company_context_resolve",
      reasonCode: "COMPANY_NAME_MISSING",
      indexEntry,
      usersTabRec,
    });
  }

  if (authIndex && typeof authIndex.upsertEntry === "function") {
    persistLoginAuthIndexEntry(authIndex, email, indexEntry, {
      sessionCompanyId,
      sessionCompanyName,
      masterSheetId,
    });
  }

  const tContext = Date.now();
  loginTiming.logMark("company_context_load_start", { companyFolderId: sessionCompanyId, masterSheetId });
  const companyAreas = Array.isArray(usersTabRec?.companyAreas)
    ? usersTabRec.companyAreas
    : Array.isArray(indexEntry.companyAreas)
      ? indexEntry.companyAreas
      : [];
  timing.company_context_load = logLoginPhase("company_context_load", tContext, loginTiming, {
    companyFolderId: sessionCompanyId,
    masterSheetId,
  });
  loginTiming.logMark("company_context_load_end", { companyFolderId: sessionCompanyId, masterSheetId });

  const tSession = Date.now();
  loginTiming.logMark("session_create_start", { companyFolderId: sessionCompanyId });
  const sessionPayload = buildCompanySessionPayload({
    email,
    masterSheetId,
    companyId: sessionCompanyId,
    companyFolderId: sessionCompanyId,
    companyName: sessionCompanyName,
    role: indexEntry.role,
    name: indexEntry.name,
    accessLevel: indexEntry.accessLevel || "",
    companyAreas,
  });
  timing.session_create = logLoginPhase("session_create", tSession, loginTiming, { companyFolderId: sessionCompanyId });
  loginTiming.logMark("session_create_end", { companyFolderId: sessionCompanyId });

  const tJobs = Date.now();
  loginTiming.logMark("background_jobs_queued_start", { companyFolderId: sessionCompanyId });
  const backgroundJobs = {
    email,
    masterSheetId,
    companyFolderId: sessionCompanyId,
    companyName: sessionCompanyName,
    indexStale: authIndex?.isEntryStale?.(indexEntry) === true,
    validateLiveCompany: Boolean(auth),
    touchLastLogin: true,
  };
  timing.background_jobs_queued = logLoginPhase("background_jobs_queued", tJobs, loginTiming, {
    companyFolderId: sessionCompanyId,
  });
  loginTiming.logMark("background_jobs_queued_end", { companyFolderId: sessionCompanyId });

  timing.response_sent = 0;
  timing.total = Date.now() - loginStarted;
  logLoginPhase("login_response_ready", loginStarted, loginTiming, {
    ok: true,
    companyFolderId: sessionCompanyId,
    masterSheetId,
  });
  console.log(`[login] total durationMs=${timing.total}`);

  if (deps.masterSheetCache && typeof deps.masterSheetCache.setEntry === "function" && sessionCompanyId && masterSheetId) {
    deps.masterSheetCache.setEntry(sessionCompanyId, masterSheetId, {
      companyName: sessionCompanyName,
      source: "login_session",
    });
  }

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

  if (jobs.reason === "index_missing") {
    safeEnqueueBackgroundJob(enqueueBackgroundJob, {
      type: "REBUILD_AUTH_INDEX",
      companyId: companyFolderId,
      requestedBy: email || "login",
      userMessage: "Rebuilding sign-in index.",
      payload: {
        email,
        masterSheetId: jobs.requestedMasterSheetId || masterSheetId,
        companyFolderId,
        reason: "index_missing",
      },
    });
    return;
  }

  if (jobs.indexStale) {
    safeEnqueueBackgroundJob(enqueueBackgroundJob, {
      type: "VERIFY_AUTH_INDEX",
      companyId: companyFolderId,
      requestedBy: email,
      userMessage: "Verifying sign-in index.",
      payload: { email, masterSheetId, companyFolderId, companyName: jobs.companyName || "" },
    });
  }

  if (jobs.validateLiveCompany) {
    safeEnqueueBackgroundJob(enqueueBackgroundJob, {
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
    });
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
      folderPlacementOk: validation.folderPlacementOk !== false,
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

/** authService API aliases — platform (Godmode) vs company login paths. */
export { performMasterLogin as platformLogin, performCompanyLogin as companyLogin };
export {
  authenticateCompanyUserLogin,
  rebuildAuthIndexFromUsersTab,
  verifyPassword,
} from "./user-auth-service.mjs";
