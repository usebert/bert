/**
 * Auth service — fast company login from workbook Users tab.
 * No registry live/health/setup gates on login; registry is cache/diagnostics only.
 */
import { isPlatformOwnerEmail } from "../shared/platform-owner.mjs";
import {
  migrateUsersTabColumns,
  readCompanyUsersTabRecord,
  touchCompanyUserLastLogin,
  verifyCompanyUserPassword,
} from "./company-users.mjs";
import { resolveCompanyContextForUser } from "./company-users.mjs";
import { enrichCompanyContextFromRegistry } from "./company-context-service.mjs";

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
  let usersRowFound = false;
  let roleFound = "";
  let passwordVerified = false;
  let setupIncomplete = false;
  let inactive = false;

  try {
    await migrateUsersTabColumns(auth, sheetId, companyUsersDeps);
    const login = await verifyCompanyUserPassword(auth, sheetId, emailNorm, password, companyUsersDeps);
    passwordVerified = Boolean(login.ok);
    if (login.reason === "inactive") {
      inactive = true;
      return {
        usersRowFound: true,
        roleFound: login.rec?.role || "",
        passwordVerified: false,
        setupIncomplete: false,
        inactive: true,
        rec: null,
        migrated: false,
      };
    }
    if (!passwordVerified) {
      const recPeek = await readCompanyUsersTabRecord(auth, sheetId, emailNorm, companyUsersDeps);
      usersRowFound = Boolean(recPeek);
      setupIncomplete = login.reason === "setup_incomplete" || !usersRowFound;
      return {
        usersRowFound,
        roleFound: recPeek?.role || "",
        passwordVerified,
        setupIncomplete,
        inactive: false,
        rec: null,
        migrated: false,
      };
    }
    const rec = login.rec || (await readCompanyUsersTabRecord(auth, sheetId, emailNorm, companyUsersDeps));
    usersRowFound = Boolean(rec);
    roleFound = rec?.role || "";
    if (!usersRowFound) {
      setupIncomplete = true;
    }
    return {
      usersRowFound,
      roleFound,
      passwordVerified,
      setupIncomplete,
      inactive: false,
      rec,
      migrated: Boolean(login.migrated),
    };
  } catch {
    return {
      usersRowFound,
      roleFound,
      passwordVerified,
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
