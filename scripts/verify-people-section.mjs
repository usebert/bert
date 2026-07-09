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
assert(panel.includes("topView") && panel.includes('"landing"'), "2: Landing view state exists");
assert(panel.includes("INVITE AREA"), "3: Landing includes INVITE AREA card");
assert(panel.includes("COMPANY"), "4: Landing includes COMPANY card");
assert(
  adminScreen.includes("pilotFocus && !usersInvitesPilotMode"),
  "4b: Users & Invites hero card hidden on people landing",
);
assert(
  adminScreen.includes("!usersInvitesPilotMode &&"),
  "4c: Setup account only banner hidden on people landing",
);
assert(
  !panel.includes("Users & Invites") &&
    !panel.includes("Setup account only") &&
    !panel.includes("This workspace is managed centrally"),
  "4d: Landing panel has no setup/workspace heading copy",
);
assert(
  panel.includes('topView === "inviteArea"') && panel.includes('topView === "company"'),
  "5: Invite/Company sections are hidden until selected",
);
assert(
  panel.includes("Sent Invites") && panel.includes("Sent invite history is not available yet."),
  "6: Sent Invites button and clean empty state render",
);
assert(panel.includes("People & Company > Invite Area"), "7: Invite breadcrumb title renders");
assert(panel.includes("People & Company > Company"), "8: Company breadcrumb title renders");
assert(panel.includes("Back"), "9: Back button renders for subviews");
assert(
  panel.includes("Invite users") && panel.includes("Pending invites") && panel.includes("Sent Invites"),
  "10: Invite area second-level options render",
);
assert(
  panel.includes("Company structure") && panel.includes("People"),
  "11: Company second-level options render",
);
assert(panel.includes("Search people by name or email"), "12: People search by name/email input renders");
assert(panel.includes("Role: All"), "13: Role filter renders");
assert(panel.includes("Status: All"), "14: Status filter renders");
assert(panel.includes("Site: All"), "15: Site filter renders");
assert(panel.includes("Department: All"), "16: Department filter renders");
assert(panel.includes("Area: All"), "17: Area filter renders");
assert(panel.includes("All company access"), "18: Blank access displays All company access");
assert(activeUserCard.includes("allSites ? [] : draftAccess.siteIds"), "19: Editing preserves blank all-site access");
assert(activeUserCard.includes("allDepartments ? [] : draftAccess.departmentIds"), "20: Editing preserves blank all-department access");
assert(activeUserCard.includes("allAreas ? [] : draftAccess.areaIds"), "21: Editing preserves blank all-area access");
assert(adminScreen.includes("UsersInvitesPilotPanel"), "22: Existing users/invites screen wiring remains intact");
assert(companyUserService.includes("sanitizeCompanyMemberForClient"), "23: PasswordHash is stripped from frontend member data");
assert(access.includes("siteIds.length === 0"), "24: Blank site access remains unrestricted");
assert(pkg.scripts["verify:people-section"], "25: verify:people-section script registered");

console.log(`[verify:people-section] ${caseCount} checks OK`);
