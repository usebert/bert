#!/usr/bin/env node
/** Nineteen invite permission cases — shared rules mirrored in server and client. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canCreateCompanyInvite,
  canInviteCompanyUsers,
  canRevokeInvite,
  canViewInvite,
  COMPANY_NOT_LIVE_INVITE_MESSAGE,
  COMPANY_REGISTRY_STATUS_LIVE,
  COMPANY_USER_INVITE_TYPE,
  FORBIDDEN_INVITE_ROLE_MESSAGE,
  getCanonicalCompanyStatus,
  INVITE_EMAIL_UNAVAILABLE_COMPANY_MESSAGE,
  INVITE_GOOGLE_UNAVAILABLE_GODMODE_MESSAGE,
  INVITE_MANAGE_AUDITOR_ONLY_MESSAGE,
  INVITE_PARTIAL_SUCCESS_USER_MESSAGE,
  INVITE_ROLE_FORBIDDEN_MESSAGE,
  INVITE_SENT_USER_MESSAGE,
  isCompanyAdminInviteRole,
  isCompanyInviteActor,
  isCompanyManagerInviteRole,
  isCompanyRegistryLive,
  isGodmodeInviteSession,
} from "../shared/company-invite-permissions.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const ownCompany = "company-folder-own";
const otherCompany = "company-folder-other";

const adminSession = { role: "Admin", accessLevel: "full", companyId: ownCompany };
const managerSession = { role: "Manager", companyId: ownCompany };
const auditorSession = { role: "Auditor", companyId: ownCompany };
const godmodeSession = { kind: "master", role: "Master" };

const auditorInviteOwn = {
  kind: "company_user",
  inviteType: COMPANY_USER_INVITE_TYPE,
  role: "Auditor",
  companyId: ownCompany,
};
const managerInviteOwn = {
  kind: "company_user",
  inviteType: COMPANY_USER_INVITE_TYPE,
  role: "Manager",
  companyId: ownCompany,
};
const auditorInviteOther = {
  kind: "company_user",
  inviteType: COMPANY_USER_INVITE_TYPE,
  role: "Auditor",
  companyId: otherCompany,
};

/** 1: Godmode can invite any role to any company. */
assert(canCreateCompanyInvite(godmodeSession, otherCompany, "Admin"), "1: Godmode can invite Admin");
assert(canCreateCompanyInvite(godmodeSession, ownCompany, "Manager"), "1b: Godmode can invite Manager");

/** 2: Godmode can view/revoke all invites. */
assert(canViewInvite(godmodeSession, managerInviteOwn), "2: Godmode can view Manager invite");
assert(canRevokeInvite(godmodeSession, auditorInviteOther), "2b: Godmode can revoke other-company invite");

/** 3: Company Admin can invite Auditor for own company when Live. */
assert(
  canInviteCompanyUsers(adminSession, { status: "Live" }),
  "3: Company Admin can invite when registry is Live",
);

/** 4: Company Admin can invite when not Live (permission-only gate). */
assert(
  canInviteCompanyUsers(adminSession, { status: "Setup in progress" }),
  "4: Company Admin can invite when registry is not Live",
);

/** 5: Manager can invite Auditor for own company when Live. */
assert(
  canInviteCompanyUsers(managerSession, { status: "Live" }),
  "5: Manager can invite when registry is Live",
);

/** 6: Manager can invite when not Live (permission-only gate). */
assert(
  canInviteCompanyUsers(managerSession, { status: "Setup in progress" }),
  "6: Manager can invite when registry is not Live",
);

/** 7: Company Admin can create Auditor invite for own company only. */
assert(canCreateCompanyInvite(adminSession, ownCompany, "Auditor"), "7: Admin can create Auditor invite");
assert(!canCreateCompanyInvite(adminSession, ownCompany, "Manager"), "7b: Admin cannot create Manager invite");
assert(!canCreateCompanyInvite(adminSession, ownCompany, "Admin"), "7c: Admin cannot create Admin invite");
assert(!canCreateCompanyInvite(adminSession, otherCompany, "Auditor"), "7d: Admin cannot invite other company");

/** 8: Manager same create rules as Admin. */
assert(canCreateCompanyInvite(managerSession, ownCompany, "Auditor"), "8: Manager can create Auditor invite");
assert(!canCreateCompanyInvite(managerSession, ownCompany, "Manager"), "8b: Manager cannot create Manager invite");
assert(!canCreateCompanyInvite(managerSession, otherCompany, "Auditor"), "8c: Manager cannot invite other company");

/** 9: Auditor/User cannot create invites. */
assert(!canCreateCompanyInvite(auditorSession, ownCompany, "Auditor"), "9: Auditor cannot create invites");
assert(!canCreateCompanyInvite({ role: "User" }, ownCompany, "Auditor"), "9b: User cannot create invites");

/** 10: Company Admin/Manager can view/revoke Auditor invites own company only. */
assert(canViewInvite(adminSession, auditorInviteOwn), "10: Admin can view Auditor invite own company");
assert(canRevokeInvite(managerSession, auditorInviteOwn), "10b: Manager can revoke Auditor invite own company");
assert(!canViewInvite(adminSession, managerInviteOwn), "10c: Admin cannot view Manager invite");
assert(!canViewInvite(managerSession, auditorInviteOther), "10d: Manager cannot view other-company Auditor invite");
assert(!canRevokeInvite(adminSession, managerInviteOwn), "10e: Admin cannot revoke Manager invite");

/** 11: Auditor cannot view or revoke. */
assert(!canViewInvite(auditorSession, auditorInviteOwn), "11: Auditor cannot view invites");
assert(!canRevokeInvite(auditorSession, auditorInviteOwn), "11b: Auditor cannot revoke invites");

/** 12: Shared actor helpers. */
assert(isCompanyAdminInviteRole({ role: "Admin" }), "12: admin role recognized");
assert(isCompanyManagerInviteRole({ role: "Manager" }), "12b: manager role recognized");
assert(isCompanyInviteActor(adminSession), "12c: admin is invite actor");
assert(isCompanyInviteActor(managerSession), "12d: manager is invite actor");
assert(isGodmodeInviteSession(godmodeSession), "12e: godmode session recognized");

/** 13: Registry status helpers unchanged. */
assert(isCompanyRegistryLive({ status: "Live" }), "13: registry Live recognized");
assert(isCompanyRegistryLive({ status: "LIVE" }), "13b: registry LIVE alias recognized");
assert(!isCompanyRegistryLive({ status: "Ready" }), "13c: registry Ready is not Live");
assert(getCanonicalCompanyStatus({ status: "LIVE" }) === COMPANY_REGISTRY_STATUS_LIVE, "13d: canonical status normalizes LIVE");

/** 14: Backend uses FORBIDDEN_INVITE_ROLE + FORBIDDEN_ROLE + COMPANY_NOT_LIVE codes. */
const serverMain = read("server/server.mjs");
const companyOnboarding = read("server/company-onboarding.mjs");
assert(serverMain.includes('"FORBIDDEN_INVITE_ROLE"'), "14: backend returns FORBIDDEN_INVITE_ROLE");
assert(serverMain.includes('code: "FORBIDDEN_ROLE"'), "14b: backend returns FORBIDDEN_ROLE");
assert(
  companyOnboarding.includes('code: "COMPANY_NOT_LIVE"') || serverMain.includes('code: "COMPANY_NOT_LIVE"'),
  "14c: backend returns COMPANY_NOT_LIVE",
);
assert(serverMain.includes("canCreateCompanyInvite"), "14d: server uses canCreateCompanyInvite");
assert(serverMain.includes("canViewInvite"), "14e: server uses canViewInvite");
assert(serverMain.includes("canRevokeInvite"), "14f: server uses canRevokeInvite");
assert(serverMain.includes('app.get("/api/onboarding/app-invites"'), "14g: invite list GET route wired");

/** 15: Frontend central helpers + panel gates. */
const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const inviteHelpers = read("src/utils/companyWorkspaceInvite.ts");
assert(inviteHelpers.includes("canCreateCompanyInvite"), "15: frontend canCreateCompanyInvite helper");
assert(inviteHelpers.includes("canViewInvite"), "15b: frontend canViewInvite helper");
assert(inviteHelpers.includes("canRevokeInvite"), "15c: frontend canRevokeInvite helper");
assert(usersPanel.includes("canInviteCompanyUsers") || usersPanel.includes("isCompanyInviteActor"), "15d: invite panel uses invite actor gates");
assert(
  usersPanel.includes("INVITE_ROLE_FORBIDDEN_MESSAGE") || usersPanel.includes(INVITE_ROLE_FORBIDDEN_MESSAGE),
  "15e: non-actor sees forbidden message",
);
assert(
  usersPanel.includes("INVITE_MANAGE_AUDITOR_ONLY_MESSAGE") ||
    usersPanel.includes(INVITE_MANAGE_AUDITOR_ONLY_MESSAGE),
  "15f: auditor-only manage message present",
);
assert(
  !usersPanel.includes("COMPANY_NOT_LIVE_INVITE_MESSAGE"),
  "15g: Users panel no longer blocks with not-live message",
);
assert(!usersPanel.includes("canInviteUsers(currentUser.role)"), "15h: removed role-only invite gate");

/** 16: Messages exported for API + UI. */
assert(FORBIDDEN_INVITE_ROLE_MESSAGE.includes("Auditor"), "16: forbidden invite role message mentions Auditor");
assert(INVITE_MANAGE_AUDITOR_ONLY_MESSAGE.includes("Auditor"), "16b: manage message mentions Auditor");

/** 17: Registry + godmode wiring unchanged. */
const registry = read("server/company-workspace-registry.mjs");
assert(registry.includes("getCanonicalCompanyStatus"), "17: registry uses canonical status helper");
assert(read("server/godmode-registry-actions.mjs").includes("/api/godmode/companies/:companyId/invite-user"), "17b: godmode invite-user route");
assert(usersPanel.includes("canCreateCompanyInvite"), "17c: invite panel uses permission-based gating");

/** 18: Permissions module exports. */
const permissions = read("src/permissions.ts");
assert(permissions.includes('role === "Manager"') && permissions.includes("Auditor"), "18: Manager creatable roles Auditor only");
assert(permissions.includes('role === "Master"') && permissions.includes('"Admin", "Manager", "Auditor"'), "18b: Godmode creatable roles all");

/** 19: npm script registered. */
const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:invite-permissions"], "19: npm script registered");

/** 20: Invite API decoupled from Google OAuth for company actors. */
const appMain = read("App.tsx");
assert(
  appMain.includes('currentUser.role === "Master" && !googleConnected'),
  "20: Google gate limited to Master on invite send",
);
assert(!appMain.includes('if (!googleConnected) {\n      pushToast("Google not connected", "Connect Google in Setup before sending invite links."'), "20b: removed blanket Google gate on invite send");
assert(serverMain.includes("buildCompanyUserInviteApiPayload"), "20c: server builds inviteCreated/emailSent payload");
assert(serverMain.includes("inviteCreated: true"), "20d: server returns inviteCreated");
assert(serverMain.includes("emailSent"), "20e: server returns emailSent");
assert(serverMain.includes("userMessage"), "20f: server returns userMessage");
assert(serverMain.includes("createInviteRecord("), "20g: server creates invite record");
assert(
  serverMain.indexOf("createInviteRecord(") < serverMain.indexOf("sendCompanyUserInviteEmail"),
  "20h: invite record created before SMTP send",
);
assert(serverMain.includes('code: "FORBIDDEN_COMPANY"'), "20i: backend returns FORBIDDEN_COMPANY");
assert(serverMain.includes("isCompanyActor)"), "20j: company actor fallback when Google unavailable");

/** 21: Role-specific user messages exported. */
assert(INVITE_SENT_USER_MESSAGE.includes("Invite sent"), "21: invite sent message");
assert(INVITE_PARTIAL_SUCCESS_USER_MESSAGE.includes("Copy"), "21b: partial success mentions copy");
assert(INVITE_EMAIL_UNAVAILABLE_COMPANY_MESSAGE.includes("BERT Admin"), "21c: company email unavailable message");
assert(INVITE_GOOGLE_UNAVAILABLE_GODMODE_MESSAGE.includes("Google"), "21d: godmode Google message");

/** 22: Frontend result panel uses userMessage, hides SMTP for company actors. */
assert(appMain.includes("userMessage"), "22: App handles userMessage from API");
assert(appMain.includes("showTechnicalErrors"), "22b: technical errors gated to Master");
assert(usersPanel.includes("Copy link") || usersPanel.includes("copyTextToClipboard"), "22c: invite list can copy link");

console.log("[verify:invite-permissions] OK (22 cases)");
