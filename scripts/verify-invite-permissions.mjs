#!/usr/bin/env node
/** Seven invite permission cases — shared rules mirrored in server and client. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canInviteCompanyUsers,
  COMPANY_NOT_LIVE_INVITE_MESSAGE,
  COMPANY_REGISTRY_STATUS_LIVE,
  getCanonicalCompanyStatus,
  INVITE_ROLE_FORBIDDEN_MESSAGE,
  isCompanyAdminInviteRole,
  isCompanyRegistryLive,
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

/** 1: Manager cannot invite (role gate). */
assert(
  !canInviteCompanyUsers({ role: "Manager", accessLevel: "operational" }, { status: "Live" }),
  "1: Manager cannot invite even when company is Live",
);

/** 2: Auditor cannot invite. */
assert(
  !canInviteCompanyUsers({ role: "Auditor" }, { status: "Live" }),
  "2: Auditor cannot invite",
);

/** 3: Company Admin + not Live → blocked. */
assert(
  !canInviteCompanyUsers({ role: "Admin", accessLevel: "full" }, { status: "Setup in progress" }),
  "3: Company Admin blocked when registry is not Live",
);

/** 4: Company Admin + Live → allowed. */
assert(
  canInviteCompanyUsers({ role: "Admin", accessLevel: "full" }, { status: "Live" }),
  "4: Company Admin can invite when registry is Live",
);

/** 5: accessLevel Company Admin without role Admin still allowed. */
assert(
  canInviteCompanyUsers({ role: "User", accessLevel: "Company Admin" }, { registryStatus: "Live" }),
  "5: accessLevel Company Admin can invite when Live",
);

/** 6: Backend uses FORBIDDEN_ROLE + COMPANY_NOT_LIVE codes. */
const serverMain = read("server/server.mjs");
const companyOnboarding = read("server/company-onboarding.mjs");
assert(serverMain.includes('code: "FORBIDDEN_ROLE"'), "6: backend returns FORBIDDEN_ROLE");
assert(
  companyOnboarding.includes('code: "COMPANY_NOT_LIVE"') || serverMain.includes('code: "COMPANY_NOT_LIVE"'),
  "6b: backend returns COMPANY_NOT_LIVE",
);

/** 7: Frontend central helper + panel uses registry LIVE (not Manager not-live copy). */
const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const inviteHelpers = read("src/utils/companyWorkspaceInvite.ts");
assert(inviteHelpers.includes("canInviteCompanyUsers"), "7: frontend canInviteCompanyUsers helper");
assert(usersPanel.includes("canInviteCompanyUsers") || usersPanel.includes("isCompanyAdminInviteRole"), "7b: invite panel uses admin/live gates");
assert(
  usersPanel.includes("INVITE_ROLE_FORBIDDEN_MESSAGE") || usersPanel.includes(INVITE_ROLE_FORBIDDEN_MESSAGE),
  "7c: non-admin sees forbidden message",
);
assert(
  usersPanel.includes("COMPANY_NOT_LIVE_INVITE_MESSAGE") || usersPanel.includes(COMPANY_NOT_LIVE_INVITE_MESSAGE),
  "7d: admin-not-live message present",
);
assert(!usersPanel.includes("canInviteUsers(currentUser.role)"), "7e: removed role-only invite gate");

assert(isCompanyAdminInviteRole({ role: "Admin" }), "admin role recognized");
assert(isCompanyRegistryLive({ status: "Live" }), "registry Live recognized");
assert(isCompanyRegistryLive({ status: "LIVE" }), "registry LIVE alias recognized");
assert(!isCompanyRegistryLive({ status: "Ready" }), "registry Ready is not Live");
assert(getCanonicalCompanyStatus({ status: "LIVE" }) === COMPANY_REGISTRY_STATUS_LIVE, "canonical status normalizes LIVE");
assert(getCanonicalCompanyStatus({ registryStatus: "live" }) === COMPANY_REGISTRY_STATUS_LIVE, "canonical status normalizes live");

const registry = read("server/company-workspace-registry.mjs");
assert(registry.includes("getCanonicalCompanyStatus"), "registry uses canonical status helper");
assert(registry.includes("ensureCompanyLiveIfReady"), "registry can persist Live when ready");
assert(registry.includes("evaluateCompanyWorkspaceReadiness"), "registry readiness evaluation helper");
assert(serverMain.includes("/api/company/registry-status"), "company admin fresh registry status endpoint");
assert(usersPanel.includes("/api/company/registry-status") || usersPanel.includes("freshRegistryStatus"), "invite panel fetches fresh registry status");
assert(read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx").includes("Mark company LIVE if ready"), "godmode mark-live action");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:invite-permissions"], "npm script registered");

console.log("[verify:invite-permissions] OK (7 cases)");
