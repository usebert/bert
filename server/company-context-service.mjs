/**
 * Company context resolution for signed-in users and session enrichment.
 */
import { getCanonicalCompanyStatus } from "../shared/company-invite-permissions.mjs";
import { resolveCompanyById } from "./company-registry-service.mjs";
import { resolveCompanyContextForUser } from "./company-users.mjs";
import { readCanonicalCompanyWorkspaceRegistryMap } from "./company-workspace-registry.mjs";

export async function resolveCompanyForUser(auth, email, deps) {
  return resolveCompanyContextForUser(auth, email, deps);
}

export async function enrichCompanyContextFromRegistry(auth, deps, partial = {}) {
  const companyId = String(partial.companyId || partial.companyFolderId || "").trim();
  const masterSheetId = String(partial.masterSheetId || "").trim();
  if (!companyId && !masterSheetId) {
    return partial;
  }

  let registryRecord = null;
  if (companyId) {
    registryRecord = await resolveCompanyById(auth, deps, companyId).catch(() => null);
  }
  if (!registryRecord && masterSheetId) {
    const { map } = await readCanonicalCompanyWorkspaceRegistryMap(auth, deps).catch(() => ({
      map: new Map(),
    }));
    for (const record of map.values()) {
      if (String(record.masterSheetId || "").trim() === masterSheetId) {
        registryRecord = record;
        break;
      }
    }
  }

  const resolvedCompanyId = String(
    companyId || registryRecord?.companyId || registryRecord?.rootFolderId || "",
  ).trim();
  const companyFolderId = String(
    partial.companyFolderId || registryRecord?.companyFolderId || registryRecord?.rootFolderId || resolvedCompanyId,
  ).trim();

  return {
    ...partial,
    companyId: resolvedCompanyId,
    companyFolderId,
    companyName: String(partial.companyName || registryRecord?.companyName || registryRecord?.name || "").trim(),
    masterSheetId: String(partial.masterSheetId || registryRecord?.masterSheetId || "").trim(),
    registryStatus: getCanonicalCompanyStatus(registryRecord || { status: partial.registryStatus }),
    registrySource: String(registryRecord?.registrySource || partial.registrySource || "").trim() || undefined,
  };
}
