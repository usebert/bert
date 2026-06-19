#!/usr/bin/env node
/**
 * Hotfix contract: Users & Invites never blocks on LIVE/health/setup/registry.
 * Form enabled when companyId + companyName + invite permission; API skips live gate.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canCreateCompanyInvite,
  canInviteCompanyUsers,
  INVITE_COMPANY_CONTEXT_REQUIRED_MESSAGE,
  INVITE_ROLE_FORBIDDEN_MESSAGE,
} from "../shared/company-invite-permissions.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const coreRoutes = read("server/core-workflow-routes.mjs");
const godmodeActions = read("server/godmode-registry-actions.mjs");
const inviteHelpers = read("src/utils/companyWorkspaceInvite.ts");
const pkg = JSON.parse(read("package.json"));

const ownCompany = "company-folder-own";
const adminSession = { role: "Admin", accessLevel: "full", companyId: ownCompany };
const managerSession = { role: "Manager", companyId: ownCompany };
const notLiveCompany = { status: "Setup in progress" };

assert(
  !usersPanel.includes("fetchCompanyInviteReadiness"),
  "1: Users panel does not gate on invite-readiness fetch",
);
assert(
  !usersPanel.includes("COMPANY_NOT_LIVE_INVITE_MESSAGE"),
  "2: Users panel does not show not-live banner message",
);
assert(
  usersPanel.includes("INVITE_COMPANY_CONTEXT_REQUIRED_MESSAGE"),
  "3: Users panel uses company-context required message",
);
assert(
  usersPanel.includes("canCreateCompanyInvite"),
  "4: Users panel gates on canCreateCompanyInvite",
);
assert(
  usersPanel.includes("hasCompanyContext") && usersPanel.includes("hasInvitePermission"),
  "5: Users panel derives enablement from company context + permission",
);
assert(
  inviteHelpers.includes(INVITE_COMPANY_CONTEXT_REQUIRED_MESSAGE),
  "6: frontend exports company-context required message",
);

assert(
  !coreRoutes.includes("assertCompanyLiveForInvite"),
  "7: auditor invite API does not call assertCompanyLiveForInvite",
);
const auditorRouteBlock = coreRoutes.slice(
  coreRoutes.indexOf("/api/companies/:companyId/invites/auditor"),
  coreRoutes.indexOf("/api/invites/company-user/:token"),
);
assert(
  !auditorRouteBlock.includes("COMPANY_NOT_LIVE"),
  "8: auditor invite route does not return COMPANY_NOT_LIVE",
);
assert(
  !godmodeActions.includes("canInviteUsersForCompany"),
  "9: godmode invite-user route does not gate on canInviteUsersForCompany",
);

assert(
  canInviteCompanyUsers(adminSession, notLiveCompany),
  "10: Company Admin can invite when registry is not Live",
);
assert(
  canInviteCompanyUsers(managerSession, notLiveCompany),
  "11: Manager can invite when registry is not Live",
);
assert(
  canCreateCompanyInvite(adminSession, ownCompany, "Auditor"),
  "12: Admin can create Auditor invite without Live registry",
);
assert(
  !canCreateCompanyInvite(adminSession, ownCompany, "Manager"),
  "13: Admin still cannot invite Manager",
);

assert(INVITE_COMPANY_CONTEXT_REQUIRED_MESSAGE.includes("not linked to a company"), "14: company context copy");
assert(INVITE_ROLE_FORBIDDEN_MESSAGE.includes("permission"), "15: permission copy");

assert(pkg.scripts["verify:invite-hotfix"], "16: npm script registered");

console.log(`OK: verify-invite-hotfix (${caseCount} cases)`);
