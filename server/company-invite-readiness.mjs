/**
 * Async invite readiness — resolves registry + fallback + context for a companyId.
 */
import { evaluateCompanyInviteReadiness } from "../shared/company-invite-readiness.mjs";
import { getFallbackRegistryRecord } from "./company-registry-fallback.mjs";
import { getCanonicalCompanyRegistryRecord } from "./company-workspace-registry.mjs";

function resolveSessionDir(deps = {}) {
  return String(deps.sessionDir || "").trim();
}

/**
 * @param {import('google-auth-library').OAuth2Client | null} auth
 * @param {object} deps
 * @param {string} companyId
 * @param {{ companyId?: string; companyFolderId?: string; masterSheetId?: string; registryStatus?: string; workspaceSetupComplete?: boolean; usable?: boolean; archived?: boolean; godmodeUsersTabWritable?: boolean }} [context]
 */
export async function resolveCompanyInviteReadiness(auth, deps, companyId, context = {}) {
  const id = String(companyId || context.companyId || context.companyFolderId || "").trim();
  if (!id) {
    return {
      ok: true,
      canInvite: false,
      companyStatus: "Not set up",
      source: "",
      userMessage: evaluateCompanyInviteReadiness({ context }).userMessage,
      reasonCode: "COMPANY_NOT_USABLE",
      nextAction: "make_usable",
      record: null,
    };
  }

  let record = null;
  if (auth) {
    record = await getCanonicalCompanyRegistryRecord(auth, deps, id).catch(() => null);
  }
  if (!record) {
    const sessionDir = resolveSessionDir(deps);
    if (sessionDir) {
      record = getFallbackRegistryRecord(sessionDir, id);
    }
  }

  const evaluation = evaluateCompanyInviteReadiness({
    record: record || {},
    context: { ...context, companyId: id, companyFolderId: context.companyFolderId || id },
    godmodeUsersTabWritable: context.godmodeUsersTabWritable,
  });

  return {
    ok: true,
    record,
    ...evaluation,
  };
}

export async function canInviteUsersForCompany(auth, deps, companyId, context = {}) {
  const result = await resolveCompanyInviteReadiness(auth, deps, companyId, context);
  return result.canInvite;
}

export async function assertCompanyInviteReady(auth, deps, companyId, context = {}) {
  const result = await resolveCompanyInviteReadiness(auth, deps, companyId, context);
  if (!result.canInvite) {
    return {
      ok: false,
      code: result.reasonCode || "COMPANY_NOT_LIVE",
      message: result.userMessage,
      httpStatus: 409,
      ...result,
    };
  }
  return { ok: true, ...result };
}
