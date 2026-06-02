#!/usr/bin/env node
/** Mirrors src/utils/resolveInviteWorkspace.ts — keep invite workspace rules in sync. */

const ADMIN_INVITE_NO_COMPANY_MESSAGE =
  "Your admin account is not linked to a company workspace yet. Ask the platform owner to complete company setup.";

const INVITE_ROLE_FORBIDDEN_MESSAGE = "Only Company Admins can invite users.";

const LIVE_WORKSPACE_INVITE_REQUIRED_MESSAGE =
  "Select a live company workspace before inviting users.";

function canInviteUsers(role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

function trimId(value) {
  return String(value || "").trim();
}

function resolveCompanyActorInviteWorkspace(input) {
  const active = input.activeCompany;
  const ctx = input.companyContext || {};
  const companyFolderId = trimId(active?.id || ctx.companyFolderId);
  const masterSheetId = trimId(active?.masterSheetId || ctx.masterSheetId);
  const companyName = trimId(active?.name || ctx.companyName);

  if (!companyFolderId || !masterSheetId) {
    return { ok: false, message: ADMIN_INVITE_NO_COMPANY_MESSAGE };
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
  if (!role || !canInviteUsers(role)) {
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

const managerFromHint = resolveInviteWorkspace({
  currentUser: { role: "Manager" },
  selectedCompany: { id: "wrong-folder", name: "Other Co", masterSheetId: "sheet-other" },
  activeCompany: {
    id: "blank-company-folder",
    name: "BLANK COMPANY - BERT Folder Structure",
    masterSheetId: "sheet-blank",
  },
  companyContext: {
    companyFolderId: "blank-company-folder",
    masterSheetId: "sheet-blank",
    companyName: "BLANK COMPANY - BERT Folder Structure",
    workspaceSetupComplete: true,
  },
});
assert(
  managerFromHint.ok && managerFromHint.companyFolderId === "blank-company-folder",
  "Manager invite uses linked company context, not Godmode selected folder",
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
  },
});
assert(
  adminFromHint.ok && adminFromHint.companyFolderId === "own-folder",
  "Admin invite uses linked company context, not selected folder",
);

const masterNeedsSelection = resolveInviteWorkspace({
  currentUser: { role: "Master" },
  selectedCompany: null,
  companyContext: { companyFolderId: "hint-folder", masterSheetId: "sheet-hint" },
});
assert(!masterNeedsSelection.ok, "Master still requires explicit company selection");

const auditorBlocked = resolveInviteWorkspace({
  currentUser: { role: "Auditor" },
  activeCompany: { id: "folder", name: "Co", masterSheetId: "sheet" },
  companyContext: { companyFolderId: "folder", masterSheetId: "sheet" },
});
assert(
  !auditorBlocked.ok && auditorBlocked.message === INVITE_ROLE_FORBIDDEN_MESSAGE,
  "Auditor cannot resolve invite workspace",
);

console.log("[verify:invite-workspace] OK");
