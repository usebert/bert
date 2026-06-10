#!/usr/bin/env node
/** Mirrors src/utils/resolveInviteWorkspace.ts — keep invite workspace rules in sync. */
import {
  canInviteCompanyUsers,
  INVITE_ROLE_FORBIDDEN_MESSAGE,
} from "../shared/company-invite-permissions.mjs";

const ADMIN_INVITE_NO_COMPANY_MESSAGE =
  "Your admin account is not linked to a company workspace yet. Ask the platform owner to complete company setup.";

const LIVE_WORKSPACE_INVITE_REQUIRED_MESSAGE =
  "Select a live company workspace before inviting users.";

const ADMIN_INVITE_INCOMPLETE_SETUP_MESSAGE =
  "Company workspace setup is not complete yet. Complete workspace setup before inviting users.";

function canOpenInviteWorkspace(role) {
  return role === "Master" || role === "Admin";
}

function trimId(value) {
  return String(value || "").trim();
}

function isCompanyRegistryLive(company = {}) {
  const status = String(company.status || company.registryStatus || "")
    .trim()
    .toLowerCase();
  return status === "live";
}

function resolveCompanyActorInviteWorkspace(input) {
  const active = input.activeCompany;
  const ctx = input.companyContext || {};
  const companyFolderId = trimId(active?.id || ctx.companyFolderId);
  const masterSheetId = trimId(active?.masterSheetId || ctx.masterSheetId);
  const companyName = trimId(active?.name || ctx.companyName);
  const registryStatus = trimId(ctx.registryStatus);

  if (!companyFolderId || !masterSheetId) {
    return { ok: false, message: ADMIN_INVITE_NO_COMPANY_MESSAGE };
  }

  if (ctx.workspaceSetupComplete === false) {
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

function resolveMasterInviteWorkspace(input) {
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
    companyName: companyName || "Company workspace",
    displayCompanyName: companyName || "Company workspace",
  };
}

function resolveInviteWorkspace(input) {
  const role = input.currentUser?.role;
  if (!role || !canOpenInviteWorkspace(role)) {
    return { ok: false, message: INVITE_ROLE_FORBIDDEN_MESSAGE };
  }
  if (role === "Master") {
    return resolveMasterInviteWorkspace(input);
  }
  return resolveCompanyActorInviteWorkspace(input);
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

assert(
  canInviteCompanyUsers({ role: "Manager" }, { status: "Live" }),
  "Manager can invite Auditors when company is Live",
);

const adminFromHint = resolveInviteWorkspace({
  currentUser: { role: "Admin" },
  selectedCompany: { id: "wrong-folder", name: "Other Co", masterSheetId: "sheet-other" },
  activeCompany: {
    id: "own-folder",
    name: "Acme Precast",
    masterSheetId: "sheet-own",
  },
  companyContext: {
    companyFolderId: "own-folder",
    masterSheetId: "sheet-own",
    companyName: "Acme Precast",
    workspaceSetupComplete: true,
    registryStatus: "Live",
  },
});
assert(
  adminFromHint.ok && adminFromHint.companyFolderId === "own-folder",
  "Admin invite uses linked company context with registry Live",
);

const adminNotLive = resolveInviteWorkspace({
  currentUser: { role: "Admin" },
  companyContext: {
    companyFolderId: "own-folder",
    masterSheetId: "sheet-own",
    registryStatus: "Setup in progress",
    workspaceSetupComplete: false,
  },
});
assert(!adminNotLive.ok, "Admin blocked when workspace setup is explicitly incomplete");

const adminLinkedWithoutRegistryLive = resolveInviteWorkspace({
  currentUser: { role: "Admin" },
  activeCompany: { id: "own-folder", name: "Acme", masterSheetId: "sheet-own" },
  companyContext: {
    companyFolderId: "own-folder",
    masterSheetId: "sheet-own",
    registryStatus: "Setup in progress",
  },
});
assert(
  adminLinkedWithoutRegistryLive.ok && adminLinkedWithoutRegistryLive.companyFolderId === "own-folder",
  "Admin workspace resolves when linked; invite readiness is checked separately",
);

const masterNeedsSelection = resolveInviteWorkspace({
  currentUser: { role: "Master" },
  selectedCompany: null,
  companyContext: { companyFolderId: "hint-folder", masterSheetId: "sheet-hint" },
});
assert(!masterNeedsSelection.ok, "Master still requires explicit company selection");

const masterBypassesLive = resolveInviteWorkspace({
  currentUser: { role: "Master" },
  selectedCompany: { id: "folder-1", name: "Acme", masterSheetId: "sheet-1" },
  companyContext: { registryStatus: "Setup in progress" },
});
assert(masterBypassesLive.ok, "Master bypasses registry LIVE when folder and sheet are selected");

const auditorBlocked = resolveInviteWorkspace({
  currentUser: { role: "Auditor" },
  activeCompany: { id: "folder", name: "Co", masterSheetId: "sheet" },
  companyContext: { companyFolderId: "folder", masterSheetId: "sheet", registryStatus: "Live" },
});
assert(
  !auditorBlocked.ok && auditorBlocked.message === INVITE_ROLE_FORBIDDEN_MESSAGE,
  "Auditor cannot resolve invite workspace",
);

console.log("[verify:invite-workspace] OK");
