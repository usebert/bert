import type { Role } from "../permissions";
import { getCanonicalCompanyStatus } from "../utils/companyWorkspaceInvite";
import type { LinkedCompanyContextInput } from "../utils/applyLinkedCompanyContext";
import { isCompanyFolderLinkValid, isCompanyWorkspaceUsable } from "../utils/companyFolderContext";

export type ResolvedCompanyContext = {
  companyId: string;
  companyFolderId: string;
  companyName: string;
  masterSheetId: string;
  status?: string;
  usable?: boolean;
  registryStatus: string;
  workspaceSetupComplete: boolean;
  role?: Role;
  accessLevel?: string;
  companyAreas?: string[];
};

export type ResolveActiveCompanyContextInput = {
  currentUser?: {
    role: Role;
    accessLevel?: string;
    companyAreas?: string[];
  } | null;
  linkedCompany?: LinkedCompanyContextInput | null;
  selectedFolder?: {
    id: string;
    name: string;
    masterSheetId?: string;
    registryStatus?: string;
  } | null;
  companyRegistryStatus?: string;
};

/** Single resolver for companyId, masterSheetId, role, and access used across schedules, invites, and saves. */
export function resolveActiveCompanyContext(input: ResolveActiveCompanyContextInput): ResolvedCompanyContext {
  const isMasterActor = input.currentUser?.role === "Master";
  const linked = input.linkedCompany || {};
  const selected = input.selectedFolder;

  const linkedCompanyId = String(linked.companyId || "").trim();
  const linkedMasterSheetId = String(linked.masterSheetId || "").trim();
  const linkedCompanyName = String(linked.companyName || "").trim();

  const selectedCompanyId = String(selected?.id || "").trim();
  const selectedMasterSheetId = String(selected?.masterSheetId || "").trim();
  const selectedCompanyName = String(selected?.name || "").trim();

  const linkedPlacementOk = isCompanyFolderLinkValid(linked);
  const companyFolderId = isMasterActor
    ? selectedCompanyId || linkedCompanyId
    : linkedCompanyId || selectedCompanyId;
  const masterSheetId = isMasterActor
    ? selectedMasterSheetId || linkedMasterSheetId
    : linkedMasterSheetId || selectedMasterSheetId;
  const companyName = isMasterActor
    ? selectedCompanyName || linkedCompanyName
    : linkedCompanyName || selectedCompanyName;

  const registryStatus = getCanonicalCompanyStatus({
    status: isMasterActor
      ? input.companyRegistryStatus || selected?.registryStatus || linked.registryStatus
      : linked.registryStatus || input.companyRegistryStatus || selected?.registryStatus,
    registryStatus: isMasterActor
      ? input.companyRegistryStatus || selected?.registryStatus || linked.registryStatus
      : linked.registryStatus || input.companyRegistryStatus || selected?.registryStatus,
  });

  const workspaceSetupComplete = isCompanyWorkspaceUsable({
    companyId: companyFolderId,
    companyFolderId,
    masterSheetId,
    folderPlacementOk: linkedPlacementOk,
  });

  return {
    companyId: companyFolderId,
    companyFolderId,
    companyName,
    masterSheetId,
    status: workspaceSetupComplete ? "USABLE" : undefined,
    usable: workspaceSetupComplete,
    registryStatus,
    workspaceSetupComplete,
    role: input.currentUser?.role,
    accessLevel: input.currentUser?.accessLevel,
    companyAreas: Array.isArray(input.currentUser?.companyAreas) ? input.currentUser.companyAreas : undefined,
  };
}

export function toLinkedCompanyContextInput(context: ResolvedCompanyContext): LinkedCompanyContextInput {
  return {
    companyId: context.companyId,
    companyName: context.companyName,
    masterSheetId: context.masterSheetId,
    registryStatus: context.registryStatus,
  };
}

function extractGoogleResourceId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  const directIdMatch = trimmed.match(/^[A-Za-z0-9_-]{20,}$/);
  if (directIdMatch) {
    return directIdMatch[0];
  }

  const pathMatch = trimmed.match(/\/d\/([A-Za-z0-9_-]+)/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const folderMatch = trimmed.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folderMatch?.[1]) {
    return folderMatch[1];
  }

  const queryMatch = trimmed.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (queryMatch?.[1]) {
    return queryMatch[1];
  }

  return trimmed;
}

/** Same company folder + master sheet resolution as Re-sync users and refreshActiveCompanyMembers. */
export function resolveCompanyMembersLoadContext(input: {
  activeCompanyContext: ResolvedCompanyContext;
  selectedFolderId?: string;
  folderIdInput?: string;
  masterSheetInput?: string;
  companySheetSyncSheetId?: string;
}): {
  companyId: string;
  masterSheetId: string;
  companyName: string;
} {
  const companyId =
    input.activeCompanyContext.companyFolderId.trim() ||
    input.selectedFolderId?.trim() ||
    extractGoogleResourceId(input.folderIdInput || "") ||
    "";
  const masterSheetId =
    input.activeCompanyContext.masterSheetId.trim() ||
    extractGoogleResourceId(input.masterSheetInput || "") ||
    input.companySheetSyncSheetId?.trim() ||
    "";
  return {
    companyId,
    masterSheetId,
    companyName: input.activeCompanyContext.companyName,
  };
}
