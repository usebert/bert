import type { Role } from "../permissions";
import { canInviteUsers as canOpenInviteWorkspace } from "../permissions";
import {
  INVITE_ROLE_FORBIDDEN_MESSAGE,
  isArchiveOrNonLiveWorkspaceName,
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

/** Company Admin and Manager: derive workspace from validated session company context only. */
function resolveCompanyActorInviteWorkspace(input: ResolveInviteWorkspaceInput): ResolvedInviteWorkspace {
  const ctx = input.companyContext || {};
  const companyFolderId = trimId(ctx.companyFolderId);
  const masterSheetId = trimId(ctx.masterSheetId);
  const companyName = trimId(ctx.companyName);

  if (!companyFolderId || !masterSheetId) {
    return { ok: false, message: ADMIN_INVITE_NO_COMPANY_MESSAGE };
  }

  if (isArchiveOrNonLiveWorkspaceName(companyName)) {
    return { ok: false, message: ADMIN_INVITE_INCOMPLETE_SETUP_MESSAGE };
  }

  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    companyName: companyName || "No company linked",
    displayCompanyName: companyName || "No company linked",
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
  if (isArchiveOrNonLiveWorkspaceName(companyName)) {
    return { ok: false, message: LIVE_WORKSPACE_INVITE_REQUIRED_MESSAGE };
  }

  return {
    ok: true,
    companyFolderId,
    masterSheetId,
    companyName: companyName || "No company linked",
    displayCompanyName: companyName || "No company linked",
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
