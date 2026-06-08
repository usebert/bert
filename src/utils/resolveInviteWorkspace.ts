import type { Role } from "../permissions";
import { canInviteUsers as canOpenInviteWorkspace } from "../permissions";
import {
  INVITE_ROLE_FORBIDDEN_MESSAGE,
  isArchiveOrNonLiveWorkspaceName,
  isCompanyRegistryLive,
  LIVE_WORKSPACE_INVITE_REQUIRED_MESSAGE,
} from "./companyWorkspaceInvite";

export const ADMIN_INVITE_NO_COMPANY_MESSAGE =
  "Your admin account is not linked to a company workspace yet. Ask the platform owner to complete company setup.";

export const ADMIN_INVITE_INCOMPLETE_SETUP_MESSAGE =
  "Company workspace setup is not complete yet. Complete workspace setup before inviting users.";

export type InviteWorkspaceCompany = {
  id: string;
  name: string;
  masterSheetId?: string;
};

export type InviteCompanyContext = {
  companyFolderId?: string;
  masterSheetId?: string;
  companyName?: string;
  workspaceSetupComplete?: boolean;
  registryStatus?: string;
};

export type ResolveInviteWorkspaceInput = {
  currentUser: { role: Role } | null;
  selectedCompany: InviteWorkspaceCompany | null | undefined;
  activeCompany?: InviteWorkspaceCompany | null;
  companyContext?: InviteCompanyContext | null;
};

export type ResolvedInviteWorkspace =
  | {
      ok: true;
      companyFolderId: string;
      masterSheetId: string;
      companyName: string;
      displayCompanyName: string;
    }
  | { ok: false; message: string };

function trimId(value: string | undefined) {
  return String(value || "").trim();
}

/** Company Admin and Manager: derive workspace from session hint / linked company, not Godmode selection. */
function resolveCompanyActorInviteWorkspace(input: ResolveInviteWorkspaceInput): ResolvedInviteWorkspace {
  const active = input.activeCompany;
  const ctx = input.companyContext || {};
  const companyFolderId = trimId(active?.id || ctx.companyFolderId);
  const masterSheetId = trimId(active?.masterSheetId || ctx.masterSheetId);
  const companyName = trimId(active?.name || ctx.companyName);

  if (!companyFolderId || !masterSheetId) {
    return { ok: false, message: ADMIN_INVITE_NO_COMPANY_MESSAGE };
  }

  const registryStatus = String(ctx.registryStatus || "").trim();
  if (
    ctx.workspaceSetupComplete === false ||
    !isCompanyRegistryLive({ status: registryStatus, registryStatus }) ||
    isArchiveOrNonLiveWorkspaceName(companyName)
  ) {
    return { ok: false, message: ADMIN_INVITE_INCOMPLETE_SETUP_MESSAGE };
  }

  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    companyName: companyName || "Company workspace",
    displayCompanyName: companyName || "Company workspace",
  };
}

function resolveMasterInviteWorkspace(input: ResolveInviteWorkspaceInput): ResolvedInviteWorkspace {
  const selected = input.selectedCompany;
  const companyFolderId = trimId(selected?.id);
  const masterSheetId = trimId(selected?.masterSheetId);
  const companyName = trimId(selected?.name);

  if (!companyFolderId || !masterSheetId) {
    return { ok: false, message: LIVE_WORKSPACE_INVITE_REQUIRED_MESSAGE };
  }
  const registryStatus = String(input.companyContext?.registryStatus || "").trim();
  if (!isCompanyRegistryLive({ status: registryStatus, registryStatus })) {
    return { ok: false, message: ADMIN_INVITE_INCOMPLETE_SETUP_MESSAGE };
  }

  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    companyName: companyName || "Company workspace",
    displayCompanyName: companyName || "Company workspace",
  };
}

/** Resolves the company workspace used for company-user invites (Master vs company Admin/Manager). */
export function resolveInviteWorkspace(input: ResolveInviteWorkspaceInput): ResolvedInviteWorkspace {
  const role = input.currentUser?.role;
  if (!role || !canOpenInviteWorkspace(role)) {
    return { ok: false, message: INVITE_ROLE_FORBIDDEN_MESSAGE };
  }
  if (role === "Master") {
    return resolveMasterInviteWorkspace(input);
  }
  return resolveCompanyActorInviteWorkspace(input);
}
