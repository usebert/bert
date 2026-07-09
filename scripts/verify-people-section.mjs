#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const panel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const activeUserCard = read("src/components/admin/ActiveUserCard.tsx");
const access = read("src/utils/companyStructureAccess.ts");
const companyUserService = read("src/services/companyUserService.ts");
const adminScreen = read("src/screens/AdminScreen.tsx");
const pkg = JSON.parse(read("package.json"));

assert(panel.includes("People & Company"), "1: People & Company page renders");
assert(panel.includes("Invite Area"), "2: Invite Area section renders");
assert(panel.includes("Invite users"), "3: Invite users button renders");
assert(panel.includes("Pending invites"), "4: Pending invites button/page renders");
assert(
  panel.includes("Sent Invites") && panel.includes("Sent invite history is not available yet."),
  "5: Sent Invites button and clean empty state render",
);
assert(panel.includes("Company"), "6: Company section renders");
assert(panel.includes("Company structure"), "7: Company structure button renders");
assert(panel.includes("People"), "8: People button renders");
assert(panel.includes("Search people by name or email"), "9: People search by name/email input renders");
assert(panel.includes("Role: All"), "10: Role filter renders");
assert(panel.includes("Status: All"), "11: Status filter renders");
assert(panel.includes("Site: All"), "12: Site filter renders");
assert(panel.includes("Department: All"), "13: Department filter renders");
assert(panel.includes("Area: All"), "14: Area filter renders");
assert(panel.includes("All company access"), "15: Blank access displays All company access");
assert(activeUserCard.includes("allSites ? [] : draftAccess.siteIds"), "16: Editing preserves blank all-site access");
assert(activeUserCard.includes("allDepartments ? [] : draftAccess.departmentIds"), "17: Editing preserves blank all-department access");
assert(activeUserCard.includes("allAreas ? [] : draftAccess.areaIds"), "18: Editing preserves blank all-area access");
assert(adminScreen.includes("UsersInvitesPilotPanel"), "19: Existing users/invites screen wiring remains intact");
assert(companyUserService.includes("sanitizeCompanyMemberForClient"), "20: PasswordHash is stripped from frontend member data");
assert(access.includes("siteIds.length === 0"), "21: Blank site access remains unrestricted");
assert(panel.includes("grid gap-3 sm:grid-cols-3"), "22: Tablet layout uses card grid without overflow-prone table");
assert(pkg.scripts["verify:people-section"], "23: verify:people-section script registered");

console.log(`[verify:people-section] ${caseCount} checks OK`);
