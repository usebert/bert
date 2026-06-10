#!/usr/bin/env node
/**
 * Canonical invite readiness — shared helper, API route, and UI/API gates stay aligned.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canInviteUsersForCompanyFromData,
  evaluateCompanyInviteReadiness,
  INVITE_READINESS_SOURCE,
} from "../shared/company-invite-readiness.mjs";

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

const shared = read("shared/company-invite-readiness.mjs");
const serverModule = read("server/company-invite-readiness.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const inviteService = read("server/invite-service.mjs");
const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const readinessService = read("src/services/companyInviteReadinessService.ts");
const pkg = JSON.parse(read("package.json"));

assert(shared.includes("export function evaluateCompanyInviteReadiness"), "1: shared evaluateCompanyInviteReadiness");
assert(shared.includes("export function canInviteUsersForCompanyFromData"), "2: shared canInviteUsersForCompanyFromData");
assert(serverModule.includes("export async function canInviteUsersForCompany"), "3: server canInviteUsersForCompany");
assert(serverModule.includes("export async function resolveCompanyInviteReadiness"), "4: server resolveCompanyInviteReadiness");
assert(serverModule.includes("export async function assertCompanyInviteReady"), "5: server assertCompanyInviteReady");

assert(coreRoutes.includes("/api/companies/:companyId/invite-readiness"), "6: invite-readiness GET route");
assert(coreRoutes.includes("canInvite: readiness.canInvite"), "7: invite-readiness returns canInvite");
assert(inviteService.includes("assertCompanyInviteReady"), "8: invite service delegates to assertCompanyInviteReady");

assert(usersPanel.includes("fetchCompanyInviteReadiness"), "9: Users panel uses invite-readiness endpoint");
assert(!usersPanel.includes("/api/company/registry-status"), "10: Users panel no longer uses registry-status for gating");
assert(!usersPanel.includes("Not live"), "10b: Users panel no longer shows Not live invite gate");
assert(!usersPanel.includes("isCompanyRegistryLive"), "10c: Users panel no longer gates on registry Live");
assert(usersPanel.includes("inviteReadiness?.canInvite"), "10d: Users panel enables form from invite-readiness");
assert(readinessService.includes("/invite-readiness"), "11: frontend service calls invite-readiness");

assert(
  canInviteUsersForCompanyFromData({ record: { status: "Live", registrySource: "main", rootFolderId: "f1", masterSheetId: "s1" } }),
  "12: main registry Live allows invites",
);
assert(
  canInviteUsersForCompanyFromData({
    record: { status: "Live", registrySource: "fallback", fallbackRegistry: true, rootFolderId: "f1", masterSheetId: "s1" },
  }),
  "13: fallback registry Live allows invites",
);
assert(
  canInviteUsersForCompanyFromData({
    record: { status: "Setup in progress", setupCompletedAt: "2026-01-01T00:00:00.000Z", rootFolderId: "f1", masterSheetId: "s1" },
  }),
  "14: setupCompletedAt allows invites without explicit registry Live",
);
assert(
  canInviteUsersForCompanyFromData({
    record: { status: "Setup in progress", rootFolderId: "f1", masterSheetId: "s1" },
  }),
  "15: linked folder + master sheet allows invites",
);
assert(
  canInviteUsersForCompanyFromData({
    context: { companyId: "f1", companyFolderId: "f1", masterSheetId: "s1" },
  }),
  "16: company context with ids allows invites",
);
assert(
  canInviteUsersForCompanyFromData({
    context: {
      companyId: "f1",
      companyFolderId: "f1",
      masterSheetId: "s1",
      workspaceSetupComplete: false,
      registryStatus: "Setup in progress",
    },
  }),
  "16b: non-Live registry with linked workspace still allows invites",
);
assert(
  !canInviteUsersForCompanyFromData({ record: { status: "Archived", rootFolderId: "f1", masterSheetId: "s1" } }),
  "17: archived company blocked",
);
assert(
  !canInviteUsersForCompanyFromData({ record: { status: "Setup in progress" } }),
  "18: missing workspace blocked",
);

const healthFailedLive = evaluateCompanyInviteReadiness({
  record: {
    status: "Live",
    rootFolderId: "f1",
    masterSheetId: "s1",
    lastHealthCheckAt: "2026-01-02T00:00:00.000Z",
    unlinkReason: "health_check_failed",
  },
});
assert(healthFailedLive.canInvite === true, "19: health check failure does not block invites");

assert(pkg.scripts["verify:invite-readiness"], "20: npm script registered");

console.log(`OK: verify-invite-readiness (${caseCount} cases)`);
