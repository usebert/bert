/**
 * Canonical company registry lookups and LIVE persistence — main sheet + fallback JSON.
 */
import { canInviteUsersForCompanyFromData } from "../shared/company-invite-readiness.mjs";
import { makeCompanyUsable } from "./godmode-registry-actions.mjs";
import {
  findCompanyWorkspaceRegistryRecordInMap,
  getCanonicalCompanyRegistryRecord,
  getCompanyWorkspaceRegistryRecord,
  readCanonicalCompanyWorkspaceRegistryMap,
} from "./company-workspace-registry.mjs";

export async function resolveCompanyById(auth, deps, companyId) {
  const id = String(companyId || "").trim();
  if (!id) {
    return null;
  }
  return getCanonicalCompanyRegistryRecord(auth, deps, id);
}

export async function resolveCompanyByWorkspace(auth, deps, workspace = {}) {
  const { map } = await readCanonicalCompanyWorkspaceRegistryMap(auth, deps).catch(() => ({
    map: new Map(),
  }));
  const match = findCompanyWorkspaceRegistryRecordInMap(map, workspace);
  if (!match?.record) {
    const companyId = String(workspace.companyId || workspace.companyFolderId || workspace.workspaceId || "").trim();
    if (companyId) {
      return resolveCompanyById(auth, deps, companyId);
    }
    return null;
  }
  const registryCompanyId = String(match.record.companyId || workspace.companyId || "").trim();
  if (registryCompanyId) {
    const canonical = await resolveCompanyById(auth, deps, registryCompanyId);
    if (canonical) {
      return canonical;
    }
  }
  return match.record;
}

export async function persistCompanyUsable(auth, deps, workspace = {}) {
  return makeCompanyUsable(auth, deps, workspace);
}

export function isCompanyUsable(record = {}) {
  return canInviteUsersForCompanyFromData({ record });
}

export async function getCompanyRegistryRecord(auth, deps, companyId) {
  return getCompanyWorkspaceRegistryRecord(auth, deps, companyId);
}
