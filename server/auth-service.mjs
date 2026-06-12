/**
 * Auth service — fast company login from workbook Users tab.
 * No registry live/health/setup gates on login; registry is cache/diagnostics only.
 */
import { isPlatformOwnerEmail } from "../shared/platform-owner.mjs";
import { readCompanyUsersTabRecord, touchCompanyUserLastLogin } from "./company-users.mjs";
import { resolveCompanyContextForUser } from "./company-users.mjs";
import { enrichCompanyContextFromRegistry } from "./company-context-service.mjs";
import { canLoginCompanyUser } from "./company-user-sheet-flow.mjs";

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

/**
 * Probe workbook Users tab for login — ACTIVE row + PasswordHash only.
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

function folderFirstCompanyContext(successRec, resolvedContext, masterSheetId) {
  const companyFolderId = String(
    successRec?.companyId || resolvedContext?.companyFolderId || resolvedContext?.companyId || "",
  ).trim();
  return {
    companyId: companyFolderId,
    companyFolderId,
    companyName: String(resolvedContext?.companyName || "").trim(),
    masterSheetId: String(masterSheetId || "").trim(),
  };
}

/**
 * Company login — workbook Users tab only; registry enrichment is non-blocking.
 */
export async function performCompanyLogin(auth, deps, input = {}) {
  const {
    email: rawEmail,
    password,
    masterSheetId: requestedSheetId = "",
    findMasterSheetIdsForCompanyLoginEmail,
    getCompanyUsersDeps,
    getCompanyContextResolutionDeps,
    getCompanyWorkspaceRegistryDeps,
    isPlatformOwner = isPlatformOwnerEmail,
  } = deps;

  const email = String(rawEmail || "").trim().toLowerCase();
  const pwd = String(password || "");
  if (!email || !pwd) {
    return {
      ok: false,
      httpStatus: 400,
      blocker: "missing_fields",
      error: "Email and password are required.",
    };
  }
  if (!email.includes("@")) {
    return {
      ok: false,
      httpStatus: 400,
      blocker: "invalid_email",
      error: "A valid email address is required.",
    };
  }

  if (isPlatformOwner(email, process.env)) {
    return {
      ok: false,
      httpStatus: 401,
      blocker: "invalid_credentials",
      error: "Invalid email or password.",
    };
  }

  const inviteSheetCandidates =
    typeof findMasterSheetIdsForCompanyLoginEmail === "function"
      ? findMasterSheetIdsForCompanyLoginEmail(email)
      : [];
  const sheetIdsToTry = [];
  const requested = String(requestedSheetId || "").trim();
  if (requested) {
    sheetIdsToTry.push(requested);
  }
  for (const candidateId of inviteSheetCandidates) {
    if (!sheetIdsToTry.includes(candidateId)) {
      sheetIdsToTry.push(candidateId);
    }
  }

  let resolvedContext = null;
  const companyUsersDeps = getCompanyUsersDeps();
  const contextDeps = getCompanyContextResolutionDeps();

  if (sheetIdsToTry.length === 0) {
    resolvedContext = await resolveCompanyContextForUser(auth, email, contextDeps).catch(() => null);
    if (resolvedContext?.masterSheetId && !sheetIdsToTry.includes(resolvedContext.masterSheetId)) {
      sheetIdsToTry.push(resolvedContext.masterSheetId);
    }
  }

  if (sheetIdsToTry.length === 0) {
    return {
      ok: false,
      httpStatus: 400,
      blocker: "company_not_identified",
      error: "Select your company or use your invite link before signing in.",
    };
  }

  let successSheetId = "";
  let successRec = null;
  let lastProbe = null;
  for (const sheetId of sheetIdsToTry) {
    const probe = await probeCompanyLoginSheet(auth, sheetId, email, pwd, companyUsersDeps);
    lastProbe = probe;
    if (probe.passwordVerified && probe.rec) {
      successSheetId = sheetId;
      successRec = probe.rec;
      break;
    }
  }

  if (!successSheetId || !successRec) {
    if (lastProbe?.inactive) {
      return {
        ok: false,
        httpStatus: 403,
        blocker: "inactive",
        error: "This account is inactive. Contact your company administrator.",
      };
    }
    if (lastProbe?.setupIncomplete) {
      return {
        ok: false,
        httpStatus: 403,
        blocker: "setup_incomplete",
        error:
          "Your account setup is incomplete. Open your invite link again or ask an administrator to resend it.",
      };
    }
    if (!lastProbe?.passwordVerified) {
      return {
        ok: false,
        httpStatus: 401,
        blocker: "invalid_credentials",
        error: "Invalid email or password.",
      };
    }
    return {
      ok: false,
      httpStatus: 403,
      blocker: lastProbe?.usersRowFound ? "role_unsupported" : "setup_incomplete",
      error: lastProbe?.usersRowFound
        ? "This account role is not supported for sign in."
        : "Your account setup is incomplete. Open your invite link again or ask an administrator to resend it.",
    };
  }

  await touchCompanyUserLastLogin(auth, successSheetId, email, companyUsersDeps);

  const baseContext = folderFirstCompanyContext(successRec, resolvedContext, successSheetId);
  const enrichedContext = await enrichCompanyContextFromRegistry(
    auth,
    getCompanyWorkspaceRegistryDeps(),
    {
      companyId: baseContext.companyFolderId,
      companyFolderId: baseContext.companyFolderId,
      companyName: baseContext.companyName,
      masterSheetId: successSheetId,
    },
  ).catch(() => baseContext);

  const sessionCompanyId = String(
    enrichedContext.companyFolderId || enrichedContext.companyId || baseContext.companyFolderId,
  ).trim();
  const companyAreas = Array.isArray(successRec.companyAreas) ? successRec.companyAreas : [];

  return {
    ok: true,
    email,
    masterSheetId: successSheetId,
    user: {
      email,
      role: successRec.role,
      name: successRec.name,
      accessLevel: successRec.accessLevel || "",
      companyAreas,
    },
    company: {
      companyId: sessionCompanyId,
      companyFolderId: sessionCompanyId,
      companyName: String(enrichedContext.companyName || baseContext.companyName || "").trim(),
      masterSheetId: successSheetId,
      registryStatus: String(enrichedContext.registryStatus || "").trim() || undefined,
    },
    sessionPayload: buildCompanySessionPayload({
      email,
      masterSheetId: successSheetId,
      companyId: sessionCompanyId,
      companyName: enrichedContext.companyName || baseContext.companyName || "",
      role: successRec.role,
      name: successRec.name,
      accessLevel: successRec.accessLevel || "",
      companyAreas,
    }),
  };
}
