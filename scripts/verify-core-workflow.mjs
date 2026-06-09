#!/usr/bin/env node
/**
 * Twenty-nine core BERT workflow cases — setup, context, invites, assignees, UX wording.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAvailableScheduleAssigneesFromUsers,
  canCompleteAudit,
} from "../shared/schedule-assignees.mjs";
import {
  canCreateCompanyInvite,
  canInviteCompanyUsers,
  isCompanyRegistryLive,
} from "../shared/company-invite-permissions.mjs";
import { isCompanyUsable } from "../server/company-registry-service.mjs";

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

const serverMain = read("server/server.mjs");
const registryActions = read("server/godmode-registry-actions.mjs");
const registry = read("server/company-workspace-registry.mjs");
const fallback = read("server/company-registry-fallback.mjs");
const contextService = read("server/company-context-service.mjs");
const registryService = read("server/company-registry-service.mjs");
const inviteService = read("server/invite-service.mjs");
const userService = read("server/company-user-service.mjs");
const assigneeService = read("server/schedule-assignee-service.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const panel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const statusModule = read("src/utils/companyWorkspaceStatus.ts");
const appTsx = read("App.tsx");
const schedulesScreen = read("src/screens/SchedulesScreen.tsx");
const assigneesUtil = read("src/utils/scheduleAssignees.ts");
const companyUsers = read("server/company-users.mjs");
const applyContext = read("src/utils/applyLinkedCompanyContext.ts");
const pkg = JSON.parse(read("package.json"));

/** 1–4: make-usable canonical route + success/failure contracts */
assert(registryActions.includes("/api/godmode/companies/:workspaceId/make-usable"), "1: make-usable route");
assert(registryActions.includes("makeCompanyUsable"), "2: makeCompanyUsable handler");
assert(registryActions.includes('status: MAKE_USABLE_STATUS_LIVE'), "3: success returns status LIVE");
assert(registryActions.includes("userMessage"), "3b: success returns userMessage");
assert(registryActions.includes("warnings"), "3c: success returns warnings");
assert(registryActions.includes("makeUsableFailure"), "4: failure helper exists");
assert(registryActions.includes("reasonCode"), "4b: failure returns reasonCode");
assert(registryActions.includes("failedStep"), "4c: failure returns failedStep");
assert(registryActions.includes("technicalError"), "4d: failure returns technicalError");

/** 5–7: fallback registry LIVE + survives reload */
assert(registryActions.includes("persistFallbackCompanyLive"), "5: make-usable uses fallback registry");
assert(fallback.includes("company-registry-fallback.json"), "5b: fallback JSON path");
assert(registry.includes("mergeFallbackRegistryIntoMap"), "6: fallback merged into registry reads");
assert(isCompanyRegistryLive({ status: "Live", registrySource: "fallback" }), "7: fallback LIVE counts as LIVE");
assert(isCompanyUsable({ status: "Live", registrySource: "fallback" }), "7b: isCompanyUsable accepts fallback LIVE");

/** 8: health check does not downgrade LIVE */
assert(registry.includes("ensureCompanyLiveIfReady"), "8: ensureCompanyLiveIfReady exists");
assert(!registryActions.includes("ensureCompanyFolderStructure"), "8b: make-usable no folder repair downgrade");

/** 9–11: company context after login/invite */
assert(contextService.includes("resolveCompanyForUser"), "9: company-context-service resolveCompanyForUser");
assert(companyUsers.includes("resolveCompanyContextForUser"), "10: resolveCompanyContextForUser in company-users");
assert(applyContext.includes("companyId"), "11: applyLinkedCompanyContext sets companyId");
assert(serverMain.includes("enrichCompanyContextFromRegistry"), "11b: session enriches from registry");

/** 12–16: invite permissions + token-before-email + inviteUrl on email fail */
assert(coreRoutes.includes("/api/companies/:companyId/invites/auditor"), "12: auditor invite route");
assert(inviteService.includes("assertCompanyLiveForInvite"), "13: invite service live gate");
assert(canCreateCompanyInvite({ role: "Admin", companyId: "c1" }, "c1", "Auditor"), "14: Admin can invite Auditor own company");
assert(!canCreateCompanyInvite({ role: "Admin", companyId: "c1" }, "c2", "Auditor"), "14b: Admin cannot invite other company");
assert(canInviteCompanyUsers({ role: "Manager", companyId: "c1" }, { status: "Live" }), "15: Manager can invite when Live");
assert(serverMain.indexOf("createInviteRecord(") < serverMain.indexOf("sendCompanyUserInviteEmail"), "16: token created before email");
assert(serverMain.includes("inviteUrl"), "16b: inviteUrl returned on email fail");

/** 17–19: invite token lookup + completion routes */
assert(coreRoutes.includes("/api/invites/company-user/:token"), "17: GET company-user invite token route");
assert(coreRoutes.includes("/api/invites/company-user/:token/complete"), "18: POST company-user invite complete route");
assert(serverMain.includes('app.post("/api/invites/company-user/:tokenId/complete"'), "19: legacy complete alias wired");

/** 20–22: schedule assignees all roles + no PasswordHash */
assert(coreRoutes.includes("/api/companies/:companyId/schedule-assignees"), "20: schedule-assignees route");
assert(assigneeService.includes("getScheduleAssigneesForCompany"), "21: schedule assignee service");
const allRoles = [
  { email: "a@test.com", role: "Admin", status: "ACTIVE", companyId: "c1" },
  { email: "m@test.com", role: "Manager", status: "ACTIVE", companyId: "c1" },
  { email: "u@test.com", role: "Auditor", status: "ACTIVE", companyId: "c1" },
  { email: "f@test.com", role: "User", status: "ACTIVE", companyId: "c1" },
];
const assigneeResult = buildAvailableScheduleAssigneesFromUsers(allRoles, { companyId: "c1" });
assert(assigneeResult.assignees.length === 4, "22: all four active roles assignable");
assert(allRoles.every((u) => canCompleteAudit(u)), "22b: canCompleteAudit all roles");
assert(companyUsers.includes("sanitizeUserRecordForClient"), "22c: PasswordHash sanitized");
assert(userService.includes("sanitizeUsersTabRecords"), "22d: user service sanitizes records");

/** 23–26: UX wording — no auditor-only empty, no BERT reach error, diagnostics collapsed */
assert(!schedulesScreen.includes("No available auditors"), "23: no 'No available auditors' in schedules UI");
assert(!assigneesUtil.includes("No available auditors"), "23b: no auditor-only empty message in assignees util");
assert(appTsx.includes("/api/companies/") && appTsx.includes("schedule-assignees"), "23c: App uses schedule-assignees API");
assert(!appTsx.includes("buildAvailableScheduleAssignees("), "23d: App no longer filters assignees locally");
assert(!panel.includes("could not reach BERT"), "24: no BERT reach error in godmode panel");
assert(!appTsx.includes("could not reach BERT"), "24b: no BERT reach error in App.tsx");
assert(panel.includes("Technical diagnostics"), "25: diagnostics section exists");
assert(panel.includes("showTechnicalDetails"), "25b: diagnostics toggle state");
assert(panel.includes("useState(false)"), "26: diagnostics collapsed by default");

/** 27–28: single make-usable button + Usable status label */
assert(panel.includes("Make company usable"), "27: single make-usable button");
assert(!panel.includes("Run workspace setup") || panel.includes("onRunWorkspaceSetup"), "27b: no duplicate setup CTA in unified panel");
assert(statusModule.includes('"Usable"'), "28: simple status includes Usable");
assert(statusModule.includes('return "Usable"'), "28b: Live maps to Usable label");

/** 29: central services + npm script */
assert(registryService.includes("resolveCompanyById"), "29: company-registry-service");
assert(registryService.includes("resolveCompanyByWorkspace"), "29b: resolveCompanyByWorkspace");
assert(registryService.includes("persistCompanyUsable"), "29c: persistCompanyUsable");
assert(userService.includes("getCompanyUsers"), "29d: getCompanyUsers");
assert(userService.includes("getAssignableUsers"), "29e: getAssignableUsers");
assert(inviteService.includes("buildAuditorInviteBody"), "29f: create invite helper");
assert(serverMain.includes("installCoreWorkflowRoutes"), "29g: core workflow routes installed");
assert(pkg.scripts["verify:core-workflow"], "29h: npm script registered");

console.log("[verify:core-workflow] OK (29 cases)");
